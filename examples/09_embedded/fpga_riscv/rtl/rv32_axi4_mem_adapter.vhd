library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

-- rv32_axi4_mem_adapter: bridges the rv32_exec_core_axi simple stalled
-- request/valid memory port onto a full AXI4 master (AW/W/B/AR/R), so the core
-- can reach Zynq UltraScale+ PS DDR4 through an S_AXI_HP slave port.
--
-- Core-side handshake (see rv32_exec_core_axi.vhd):
--   core holds mem_req='1' with stable word-aligned mem_addr until the slave
--   pulses mem_rvalid='1' for exactly ONE cycle; mem_req drops the cycle after,
--   so there is always a >=1-cycle idle gap between transactions.
-- Only ONE transaction is ever outstanding, which keeps this adapter tiny: no
-- reordering, no ID management, no write-data buffering.
--
-- Address remap. The rv32 SimpleOS image is linked at 0x80000000 (kernel) with
-- the FAT32 ramdisk window at 0x88000000. On ZynqMP the 0x80000000..0xFFFFFFFF
-- range is NOT DDR (it is PCIe/reserved), so raw pass-through would never hit
-- memory. We subtract G_CORE_BASE and add G_DDR_BASE, placing the whole
-- 8.19 MB kernel + ramdisk window inside DDR low:
--   core 0x80000000 -> DDR G_DDR_BASE + 0x00000000   (kernel, reset PC)
--   core 0x88000000 -> DDR G_DDR_BASE + 0x08000000   (ramdisk, FAT32 image)
-- G_DDR_BASE defaults to 0x10000000 (256 MB into DDR) to stay clear of the
-- FSBL/ATF/U-Boot low-DDR footprint used while loading the images over JTAG.
--
-- Burst shape is deliberately single-beat (AxLEN=0, AxSIZE=2 -> 4 bytes,
-- AxBURST=INCR). The AXI SmartConnect in the block design handles the 32-bit ->
-- 128-bit data upsizing and the 32-bit -> 49-bit address widening for HP_FPD.

entity rv32_axi4_mem_adapter is
  generic (
    G_CORE_BASE : unsigned(31 downto 0) := x"80000000";
    G_DDR_BASE  : unsigned(31 downto 0) := x"10000000"
  );
  port (
    clk    : in std_logic;
    resetn : in std_logic;

    -- Core-side simple memory port (from rv32_exec_core_axi)
    mem_req    : in  std_logic;
    mem_we     : in  std_logic;
    mem_addr   : in  std_logic_vector(31 downto 0);
    mem_wdata  : in  std_logic_vector(31 downto 0);
    mem_wstrb  : in  std_logic_vector(3 downto 0);
    mem_rdata  : out std_logic_vector(31 downto 0);
    mem_rvalid : out std_logic;

    -- Transaction counter, exposed for JTAG-visible liveness proof
    stat_reads  : out std_logic_vector(31 downto 0);
    stat_writes : out std_logic_vector(31 downto 0);

    -- AXI4 master (32-bit data). Write address channel
    m_axi_awaddr  : out std_logic_vector(31 downto 0);
    m_axi_awlen   : out std_logic_vector(7 downto 0);
    m_axi_awsize  : out std_logic_vector(2 downto 0);
    m_axi_awburst : out std_logic_vector(1 downto 0);
    m_axi_awcache : out std_logic_vector(3 downto 0);
    m_axi_awprot  : out std_logic_vector(2 downto 0);
    m_axi_awvalid : out std_logic;
    m_axi_awready : in  std_logic;
    -- Write data channel
    m_axi_wdata  : out std_logic_vector(31 downto 0);
    m_axi_wstrb  : out std_logic_vector(3 downto 0);
    m_axi_wlast  : out std_logic;
    m_axi_wvalid : out std_logic;
    m_axi_wready : in  std_logic;
    -- Write response channel
    m_axi_bresp  : in  std_logic_vector(1 downto 0);
    m_axi_bvalid : in  std_logic;
    m_axi_bready : out std_logic;
    -- Read address channel
    m_axi_araddr  : out std_logic_vector(31 downto 0);
    m_axi_arlen   : out std_logic_vector(7 downto 0);
    m_axi_arsize  : out std_logic_vector(2 downto 0);
    m_axi_arburst : out std_logic_vector(1 downto 0);
    m_axi_arcache : out std_logic_vector(3 downto 0);
    m_axi_arprot  : out std_logic_vector(2 downto 0);
    m_axi_arvalid : out std_logic;
    m_axi_arready : in  std_logic;
    -- Read data channel
    m_axi_rdata  : in  std_logic_vector(31 downto 0);
    m_axi_rresp  : in  std_logic_vector(1 downto 0);
    m_axi_rlast  : in  std_logic;
    m_axi_rvalid : in  std_logic;
    m_axi_rready : out std_logic
  );
end entity rv32_axi4_mem_adapter;

architecture rtl of rv32_axi4_mem_adapter is
  type state_t is (S_IDLE, S_RD_ADDR, S_RD_DATA, S_WR_ADDR, S_WR_RESP, S_DONE);
  signal state_q : state_t := S_IDLE;

  signal awvalid_q : std_logic := '0';
  signal wvalid_q  : std_logic := '0';
  signal arvalid_q : std_logic := '0';
  signal rready_q  : std_logic := '0';
  signal bready_q  : std_logic := '0';

  signal axaddr_q : std_logic_vector(31 downto 0) := (others => '0');
  signal wdata_q  : std_logic_vector(31 downto 0) := (others => '0');
  signal wstrb_q  : std_logic_vector(3 downto 0)  := (others => '0');
  signal rdata_q  : std_logic_vector(31 downto 0) := (others => '0');
  signal rvalid_q : std_logic := '0';

  signal reads_q  : unsigned(31 downto 0) := (others => '0');
  signal writes_q : unsigned(31 downto 0) := (others => '0');

  -- Remap a core address into the DDR aperture.
  function remap(a : std_logic_vector(31 downto 0)) return std_logic_vector is
  begin
    return std_logic_vector((unsigned(a) - G_CORE_BASE) + G_DDR_BASE);
  end function;
begin
  -- Static AXI qualifiers: single-beat, 4-byte, INCR, bufferable+cacheable.
  m_axi_awlen   <= (others => '0');
  m_axi_awsize  <= "010";
  m_axi_awburst <= "01";
  m_axi_awcache <= "0011";
  m_axi_awprot  <= "000";
  m_axi_arlen   <= (others => '0');
  m_axi_arsize  <= "010";
  m_axi_arburst <= "01";
  m_axi_arcache <= "0011";
  m_axi_arprot  <= "000";
  m_axi_wlast   <= '1';

  m_axi_awaddr  <= axaddr_q;
  m_axi_araddr  <= axaddr_q;
  m_axi_awvalid <= awvalid_q;
  m_axi_wvalid  <= wvalid_q;
  m_axi_wdata   <= wdata_q;
  m_axi_wstrb   <= wstrb_q;
  m_axi_arvalid <= arvalid_q;
  m_axi_rready  <= rready_q;
  m_axi_bready  <= bready_q;

  mem_rdata   <= rdata_q;
  mem_rvalid  <= rvalid_q;
  stat_reads  <= std_logic_vector(reads_q);
  stat_writes <= std_logic_vector(writes_q);

  process(clk)
  begin
    if rising_edge(clk) then
      if resetn = '0' then
        state_q   <= S_IDLE;
        awvalid_q <= '0';
        wvalid_q  <= '0';
        arvalid_q <= '0';
        rready_q  <= '0';
        bready_q  <= '0';
        rvalid_q  <= '0';
        rdata_q   <= (others => '0');
        axaddr_q  <= (others => '0');
        wdata_q   <= (others => '0');
        wstrb_q   <= (others => '0');
        reads_q   <= (others => '0');
        writes_q  <= (others => '0');
      else
        -- mem_rvalid is a strict ONE-cycle pulse.
        rvalid_q <= '0';

        case state_q is
          when S_IDLE =>
            if mem_req = '1' then
              axaddr_q <= remap(mem_addr);
              if mem_we = '1' then
                wdata_q   <= mem_wdata;
                wstrb_q   <= mem_wstrb;
                awvalid_q <= '1';
                wvalid_q  <= '1';
                state_q   <= S_WR_ADDR;
              else
                arvalid_q <= '1';
                state_q   <= S_RD_ADDR;
              end if;
            end if;

          -- Read: hold ARVALID until accepted, then take one R beat.
          when S_RD_ADDR =>
            if m_axi_arready = '1' then
              arvalid_q <= '0';
              rready_q  <= '1';
              state_q   <= S_RD_DATA;
            end if;

          when S_RD_DATA =>
            if m_axi_rvalid = '1' then
              rready_q <= '0';
              rdata_q  <= m_axi_rdata;
              rvalid_q <= '1';          -- retire to the core
              reads_q  <= reads_q + 1;
              state_q  <= S_DONE;
            end if;

          -- Write: AW and W run concurrently; either may be accepted first.
          when S_WR_ADDR =>
            if m_axi_awready = '1' then
              awvalid_q <= '0';
            end if;
            if m_axi_wready = '1' then
              wvalid_q <= '0';
            end if;
            if (awvalid_q = '0' or m_axi_awready = '1') and
               (wvalid_q = '0' or m_axi_wready = '1') then
              bready_q <= '1';
              state_q  <= S_WR_RESP;
            end if;

          when S_WR_RESP =>
            if m_axi_bvalid = '1' then
              bready_q <= '0';
              rvalid_q <= '1';          -- write accepted; retire to the core
              writes_q <= writes_q + 1;
              state_q  <= S_DONE;
            end if;

          -- Wait for the core to drop mem_req before accepting a new request,
          -- so the one-cycle rvalid pulse is never mistaken for a second retire.
          when S_DONE =>
            if mem_req = '0' then
              state_q <= S_IDLE;
            end if;
        end case;
      end if;
    end if;
  end process;
end architecture rtl;
