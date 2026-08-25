library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

-- rv32_ctrl_obs_slave: AXI4-Lite slave giving the Zynq PS (and therefore xsdb
-- over JTAG, via mrd/mwr) control over the rv32 soft-core and a window onto its
-- progress. This is the observation path on the KV260 carrier, where the fabric
-- UART TX lands on FPGA pin H12 (PMOD J2) and is NOT wired to the onboard
-- FT4232H -- so no host tty ever sees the core's UART bytes.
--
-- Instead the core's debug_uart_valid/debug_uart_byte side-channel is captured
-- into a 4096-byte buffer readable over this slave. The boot marker chain
-- ("SimpleOS RV32 boot OK" ... "TEST PASSED") fits comfortably in 4 KB, so a
-- JTAG readout reconstructs the console transcript verbatim.
--
-- Capture STOPS when the buffer fills (it does not wrap), which preserves the
-- earliest boot output -- exactly the markers we need -- rather than letting
-- later chatter overwrite it.
--
-- Register map (byte offsets):
--   0x0000 CTRL        bit0 = core_run. 0 holds the core in reset; write 1 to
--                      release it AFTER the DDR images are loaded.
--                      bit1 = capture_reset (self-clearing): zeroes the UART
--                      write pointer.
--   0x0004 UART_COUNT  bytes captured so far (saturates at 4096)
--   0x0008 DEBUG_PC    live program counter
--   0x000C DEBUG_INS   live instruction word
--   0x0010 DEBUG_A0    live x10
--   0x0014 DEBUG_SP    live x2
--   0x0018 DEBUG_RA    live x1
--   0x001C STAT_READS  AXI read transactions retired by the core
--   0x0020 STAT_WRITES AXI write transactions retired by the core
--   0x0024 MAGIC       constant 0x52563332 ("RV32") -- proves the slave is
--                      mapped and the PL is configured before trusting any
--                      other readout
--   0x8000 + 4*i       UART capture buffer word i, holding FOUR captured bytes
--                      little-endian: byte 4i in [7:0] .. byte 4i+3 in [31:24].
--                      i = 0..4095, so 16 KB of transcript. Bytes beyond
--                      UART_COUNT are stale and must be ignored by the reader.

entity rv32_ctrl_obs_slave is
  port (
    clk    : in std_logic;
    resetn : in std_logic;

    -- Control / observation to the core wrapper
    core_run    : out std_logic;
    debug_pc    : in  std_logic_vector(31 downto 0);
    debug_ins   : in  std_logic_vector(31 downto 0);
    debug_a0    : in  std_logic_vector(31 downto 0);
    debug_sp    : in  std_logic_vector(31 downto 0);
    debug_ra    : in  std_logic_vector(31 downto 0);
    stat_reads  : in  std_logic_vector(31 downto 0);
    stat_writes : in  std_logic_vector(31 downto 0);

    -- Core UART side-channel to capture
    uart_valid : in std_logic;
    uart_byte  : in std_logic_vector(7 downto 0);

    -- AXI4-Lite slave
    s_axi_ctrl_awaddr  : in  std_logic_vector(15 downto 0);
    s_axi_ctrl_awprot  : in  std_logic_vector(2 downto 0);
    s_axi_ctrl_awvalid : in  std_logic;
    s_axi_ctrl_awready : out std_logic;
    s_axi_ctrl_wdata   : in  std_logic_vector(31 downto 0);
    s_axi_ctrl_wstrb   : in  std_logic_vector(3 downto 0);
    s_axi_ctrl_wvalid  : in  std_logic;
    s_axi_ctrl_wready  : out std_logic;
    s_axi_ctrl_bresp   : out std_logic_vector(1 downto 0);
    s_axi_ctrl_bvalid  : out std_logic;
    s_axi_ctrl_bready  : in  std_logic;
    s_axi_ctrl_araddr  : in  std_logic_vector(15 downto 0);
    s_axi_ctrl_arprot  : in  std_logic_vector(2 downto 0);
    s_axi_ctrl_arvalid : in  std_logic;
    s_axi_ctrl_arready : out std_logic;
    s_axi_ctrl_rdata   : out std_logic_vector(31 downto 0);
    s_axi_ctrl_rresp   : out std_logic_vector(1 downto 0);
    s_axi_ctrl_rvalid  : out std_logic;
    s_axi_ctrl_rready  : in  std_logic
  );
end entity rv32_ctrl_obs_slave;

architecture rtl of rv32_ctrl_obs_slave is
  -- 4096 words x 4 byte lanes = 16 KB of transcript. Held as four independent
  -- byte arrays so a capture write touches exactly one lane -- no
  -- read-modify-write, and each lane infers a simple byte-wide BRAM.
  constant BUF_WORDS : natural := 4096;
  constant BUF_BYTES : natural := BUF_WORDS * 4;
  type lane_t is array(0 to BUF_WORDS - 1) of std_logic_vector(7 downto 0);
  signal lane0, lane1, lane2, lane3 : lane_t := (others => (others => '0'));

  signal wptr_q : unsigned(14 downto 0) := (others => '0');  -- byte count 0..16384
  signal core_run_q : std_logic := '0';

  signal awready_q : std_logic := '0';
  signal wready_q  : std_logic := '0';
  signal bvalid_q  : std_logic := '0';
  signal arready_q : std_logic := '0';
  signal rvalid_q  : std_logic := '0';
  signal rdata_q   : std_logic_vector(31 downto 0) := (others => '0');
  signal awaddr_q  : std_logic_vector(15 downto 0) := (others => '0');

  signal buf_rd_q : std_logic_vector(31 downto 0) := (others => '0');
  signal is_buf_q : std_logic := '0';
begin
  core_run <= core_run_q;

  s_axi_ctrl_awready <= awready_q;
  s_axi_ctrl_wready  <= wready_q;
  s_axi_ctrl_bvalid  <= bvalid_q;
  s_axi_ctrl_bresp   <= "00";
  s_axi_ctrl_arready <= arready_q;
  s_axi_ctrl_rvalid  <= rvalid_q;
  s_axi_ctrl_rresp   <= "00";
  -- Capture-buffer bytes resolve out of the registered BRAM read port; all
  -- other offsets come from the register mux latched at arready time.
  s_axi_ctrl_rdata <= buf_rd_q when is_buf_q = '1' else rdata_q;

  -- UART capture: one byte per debug_uart_valid pulse, stop when full.
  process(clk)
  begin
    if rising_edge(clk) then
      if resetn = '0' then
        wptr_q <= (others => '0');
      else
        if uart_valid = '1' and wptr_q < BUF_BYTES then
          case to_integer(wptr_q(1 downto 0)) is
            when 0 => lane0(to_integer(wptr_q(13 downto 2))) <= uart_byte;
            when 1 => lane1(to_integer(wptr_q(13 downto 2))) <= uart_byte;
            when 2 => lane2(to_integer(wptr_q(13 downto 2))) <= uart_byte;
            when others => lane3(to_integer(wptr_q(13 downto 2))) <= uart_byte;
          end case;
          wptr_q <= wptr_q + 1;
        end if;
      end if;
    end if;
  end process;

  -- AXI4-Lite write channel
  process(clk)
  begin
    if rising_edge(clk) then
      if resetn = '0' then
        awready_q  <= '0';
        wready_q   <= '0';
        bvalid_q   <= '0';
        core_run_q <= '0';
        awaddr_q   <= (others => '0');
      else
        if awready_q = '0' and s_axi_ctrl_awvalid = '1' then
          awready_q <= '1';
          awaddr_q  <= s_axi_ctrl_awaddr;
        else
          awready_q <= '0';
        end if;

        if wready_q = '0' and s_axi_ctrl_wvalid = '1' then
          wready_q <= '1';
          -- Only CTRL is writable.
          if awaddr_q(15) = '0' and awaddr_q(7 downto 2) = "000000" then
            core_run_q <= s_axi_ctrl_wdata(0);
          end if;
          bvalid_q <= '1';
        else
          wready_q <= '0';
        end if;

        if bvalid_q = '1' and s_axi_ctrl_bready = '1' then
          bvalid_q <= '0';
        end if;
      end if;
    end if;
  end process;

  -- AXI4-Lite read channel. Registered BRAM read of the capture buffer costs
  -- one extra cycle, absorbed by asserting rvalid the cycle after arready.
  process(clk)
  begin
    if rising_edge(clk) then
      if resetn = '0' then
        arready_q <= '0';
        rvalid_q  <= '0';
        rdata_q   <= (others => '0');
        buf_rd_q  <= (others => '0');
        is_buf_q  <= '0';
      else
        arready_q <= '0';
        if arready_q = '0' and s_axi_ctrl_arvalid = '1' and rvalid_q = '0' then
          arready_q <= '1';
          buf_rd_q  <= lane3(to_integer(unsigned(s_axi_ctrl_araddr(13 downto 2))))
                     & lane2(to_integer(unsigned(s_axi_ctrl_araddr(13 downto 2))))
                     & lane1(to_integer(unsigned(s_axi_ctrl_araddr(13 downto 2))))
                     & lane0(to_integer(unsigned(s_axi_ctrl_araddr(13 downto 2))));
          is_buf_q  <= s_axi_ctrl_araddr(15);
          if s_axi_ctrl_araddr(15) = '1' then
            rdata_q <= (others => '0');   -- unused; buf_rd_q drives the output
          else
            case s_axi_ctrl_araddr(7 downto 2) is
              when "000000" => rdata_q <= (0 => core_run_q, others => '0');
              when "000001" => rdata_q <= std_logic_vector(resize(wptr_q, 32));
              when "000010" => rdata_q <= debug_pc;
              when "000011" => rdata_q <= debug_ins;
              when "000100" => rdata_q <= debug_a0;
              when "000101" => rdata_q <= debug_sp;
              when "000110" => rdata_q <= debug_ra;
              when "000111" => rdata_q <= stat_reads;
              when "001000" => rdata_q <= stat_writes;
              when "001001" => rdata_q <= x"52563332";  -- "RV32"
              when others   => rdata_q <= (others => '0');
            end case;
          end if;
        end if;

        if arready_q = '1' then
          -- Buffer reads resolve one cycle later than register reads; by now
          -- buf_rd_q holds the addressed byte.
          rvalid_q <= '1';
        end if;

        if rvalid_q = '1' and s_axi_ctrl_rready = '1' then
          rvalid_q <= '0';
        end if;
      end if;
    end if;
  end process;
end architecture rtl;
