library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

-- soc_top_rv64_k26_ddr: PL top for booting rv64 SimpleOS on real KV260 (xck26)
-- silicon out of Zynq UltraScale+ PS DDR4. Direct 64-bit widening of the
-- silicon-proven soc_top_rv32_k26_ddr (see that file for the full rationale).
--
-- Why DDR and not BRAM: the rv64 SimpleOS image spans core 0x80200000 (.text)
-- to ~0x84A20000 (.heap end) -- ~74 MB -- plus a FAT32 ramdisk window at
-- 0x88000000. An xck26 has ~2.9 MB of fabric BRAM total, so the working set
-- cannot live in the PL. rv64_axi4_mem_adapter turns the core's stalled mem_*
-- port (64-bit) into an AXI4 master that reaches PS DDR through S_AXI_HP0_FPD.
--
--   M_AXI_HP    (this module -> SmartConnect -> zynq S_AXI_HP0_FPD -> DDR4)
--   S_AXI_CTRL  (zynq M_AXI_HPM0_FPD -> this module) control + observation
--
-- Bring-up order enforced by hardware: core_run resets to '0', so the soft-core
-- is held in reset from the moment the bitstream configures. Only after the
-- kernel and ramdisk images have been written into DDR (over JTAG via xsdb
-- `dow -data`) AND .bss has been zeroed does software set CTRL bit0, releasing
-- the core. This makes it impossible for the core to fetch uninitialised DDR.
--
-- Observation reuses rv32_ctrl_obs_slave UNCHANGED (its interface is width-
-- agnostic except for the debug taps): the 64-bit debug values are TRUNCATED to
-- their low 32 bits for the observation registers. This is a documented,
-- deliberate loss: the whole rv64 SimpleOS address map lives under 4 GB, so the
-- low 32 PC/A0/SP/RA bits are fully identifying. MAGIC therefore still reads
-- 0x52563332 ("RV32") -- it proves slave reachability, not core width.
--
-- Default clock is 50 MHz (not the rv32 lane's 100 MHz): the rv32 build closed
-- at -0.115 ns WNS @100 MHz, so the wider 64-bit datapath is constrained to
-- 50 MHz to make timing MEET rather than repeating a negative-WNS gamble.

entity soc_top_rv64_k26_ddr is
  generic (
    G_CLK_FREQ  : natural := 50000000;
    G_BAUD_RATE : natural := 115200;
    G_CORE_BASE : unsigned(31 downto 0) := x"80000000";
    G_DDR_BASE  : unsigned(31 downto 0) := x"10000000"
  );
  port (
    clk    : in std_logic;
    rst_n  : in std_logic;

    uart_tx : out std_logic;

    -- AXI4 master into PS DDR (S_AXI_HP0_FPD), 64-bit data
    m_axi_hp_awaddr  : out std_logic_vector(31 downto 0);
    m_axi_hp_awlen   : out std_logic_vector(7 downto 0);
    m_axi_hp_awsize  : out std_logic_vector(2 downto 0);
    m_axi_hp_awburst : out std_logic_vector(1 downto 0);
    m_axi_hp_awcache : out std_logic_vector(3 downto 0);
    m_axi_hp_awprot  : out std_logic_vector(2 downto 0);
    m_axi_hp_awvalid : out std_logic;
    m_axi_hp_awready : in  std_logic;
    m_axi_hp_wdata   : out std_logic_vector(63 downto 0);
    m_axi_hp_wstrb   : out std_logic_vector(7 downto 0);
    m_axi_hp_wlast   : out std_logic;
    m_axi_hp_wvalid  : out std_logic;
    m_axi_hp_wready  : in  std_logic;
    m_axi_hp_bresp   : in  std_logic_vector(1 downto 0);
    m_axi_hp_bvalid  : in  std_logic;
    m_axi_hp_bready  : out std_logic;
    m_axi_hp_araddr  : out std_logic_vector(31 downto 0);
    m_axi_hp_arlen   : out std_logic_vector(7 downto 0);
    m_axi_hp_arsize  : out std_logic_vector(2 downto 0);
    m_axi_hp_arburst : out std_logic_vector(1 downto 0);
    m_axi_hp_arcache : out std_logic_vector(3 downto 0);
    m_axi_hp_arprot  : out std_logic_vector(2 downto 0);
    m_axi_hp_arvalid : out std_logic;
    m_axi_hp_arready : in  std_logic;
    m_axi_hp_rdata   : in  std_logic_vector(63 downto 0);
    m_axi_hp_rresp   : in  std_logic_vector(1 downto 0);
    m_axi_hp_rlast   : in  std_logic;
    m_axi_hp_rvalid  : in  std_logic;
    m_axi_hp_rready  : out std_logic;

    -- AXI4-Lite control / observation slave (from M_AXI_HPM0_FPD)
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
end entity soc_top_rv64_k26_ddr;

architecture rtl of soc_top_rv64_k26_ddr is
  component rv64_exec_core_axi is
    generic (CLK_FREQ : natural := 100000000; BAUD_RATE : natural := 115200);
    port (
      clk : in std_logic;
      rst : in std_logic;
      uart_tx : out std_logic;
      mem_req   : out std_logic;
      mem_we    : out std_logic;
      mem_addr  : out std_logic_vector(63 downto 0);
      mem_wdata : out std_logic_vector(63 downto 0);
      mem_wstrb : out std_logic_vector(7 downto 0);
      mem_rdata : in  std_logic_vector(63 downto 0);
      mem_rvalid: in  std_logic;
      debug_uart_valid : out std_logic;
      debug_uart_byte : out std_logic_vector(7 downto 0);
      debug_pc : out std_logic_vector(63 downto 0);
      debug_ins : out std_logic_vector(31 downto 0);
      debug_a0 : out std_logic_vector(63 downto 0);
      debug_ra : out std_logic_vector(63 downto 0);
      debug_sp : out std_logic_vector(63 downto 0));
  end component;

  signal core_rst  : std_logic;
  signal core_run  : std_logic;
  signal core_rstn : std_logic;

  signal mem_req    : std_logic;
  signal mem_we     : std_logic;
  signal mem_addr   : std_logic_vector(63 downto 0);
  signal mem_wdata  : std_logic_vector(63 downto 0);
  signal mem_wstrb  : std_logic_vector(7 downto 0);
  signal mem_rdata  : std_logic_vector(63 downto 0);
  signal mem_rvalid : std_logic;

  signal dbg_uart_valid : std_logic;
  signal dbg_uart_byte  : std_logic_vector(7 downto 0);
  signal dbg_pc, dbg_a0, dbg_sp, dbg_ra : std_logic_vector(63 downto 0);
  signal dbg_ins : std_logic_vector(31 downto 0);
  signal stat_reads, stat_writes : std_logic_vector(31 downto 0);
begin
  -- Core is held in reset until DDR is populated AND software sets CTRL bit0.
  core_rst  <= '1' when (rst_n = '0' or core_run = '0') else '0';
  core_rstn <= rst_n;

  u_core : rv64_exec_core_axi
    generic map (CLK_FREQ => G_CLK_FREQ, BAUD_RATE => G_BAUD_RATE)
    port map (
      clk => clk, rst => core_rst, uart_tx => uart_tx,
      mem_req => mem_req, mem_we => mem_we, mem_addr => mem_addr,
      mem_wdata => mem_wdata, mem_wstrb => mem_wstrb,
      mem_rdata => mem_rdata, mem_rvalid => mem_rvalid,
      debug_uart_valid => dbg_uart_valid, debug_uart_byte => dbg_uart_byte,
      debug_pc => dbg_pc, debug_ins => dbg_ins, debug_a0 => dbg_a0,
      debug_ra => dbg_ra, debug_sp => dbg_sp);

  u_axi : entity work.rv64_axi4_mem_adapter
    generic map (G_CORE_BASE => G_CORE_BASE, G_DDR_BASE => G_DDR_BASE)
    port map (
      clk => clk, resetn => core_rstn,
      mem_req => mem_req, mem_we => mem_we, mem_addr => mem_addr,
      mem_wdata => mem_wdata, mem_wstrb => mem_wstrb,
      mem_rdata => mem_rdata, mem_rvalid => mem_rvalid,
      stat_reads => stat_reads, stat_writes => stat_writes,
      m_axi_awaddr => m_axi_hp_awaddr, m_axi_awlen => m_axi_hp_awlen,
      m_axi_awsize => m_axi_hp_awsize, m_axi_awburst => m_axi_hp_awburst,
      m_axi_awcache => m_axi_hp_awcache, m_axi_awprot => m_axi_hp_awprot,
      m_axi_awvalid => m_axi_hp_awvalid, m_axi_awready => m_axi_hp_awready,
      m_axi_wdata => m_axi_hp_wdata, m_axi_wstrb => m_axi_hp_wstrb,
      m_axi_wlast => m_axi_hp_wlast, m_axi_wvalid => m_axi_hp_wvalid,
      m_axi_wready => m_axi_hp_wready,
      m_axi_bresp => m_axi_hp_bresp, m_axi_bvalid => m_axi_hp_bvalid,
      m_axi_bready => m_axi_hp_bready,
      m_axi_araddr => m_axi_hp_araddr, m_axi_arlen => m_axi_hp_arlen,
      m_axi_arsize => m_axi_hp_arsize, m_axi_arburst => m_axi_hp_arburst,
      m_axi_arcache => m_axi_hp_arcache, m_axi_arprot => m_axi_hp_arprot,
      m_axi_arvalid => m_axi_hp_arvalid, m_axi_arready => m_axi_hp_arready,
      m_axi_rdata => m_axi_hp_rdata, m_axi_rresp => m_axi_hp_rresp,
      m_axi_rlast => m_axi_hp_rlast, m_axi_rvalid => m_axi_hp_rvalid,
      m_axi_rready => m_axi_hp_rready);

  -- rv32_ctrl_obs_slave reused UNCHANGED; 64-bit debug taps truncated to their
  -- low 32 bits (the rv64 SimpleOS map fits under 4 GB, so nothing is lost).
  u_ctrl : entity work.rv32_ctrl_obs_slave
    port map (
      clk => clk, resetn => rst_n,
      core_run => core_run,
      debug_pc => dbg_pc(31 downto 0), debug_ins => dbg_ins,
      debug_a0 => dbg_a0(31 downto 0),
      debug_sp => dbg_sp(31 downto 0), debug_ra => dbg_ra(31 downto 0),
      stat_reads => stat_reads, stat_writes => stat_writes,
      uart_valid => dbg_uart_valid, uart_byte => dbg_uart_byte,
      s_axi_ctrl_awaddr => s_axi_ctrl_awaddr, s_axi_ctrl_awprot => s_axi_ctrl_awprot,
      s_axi_ctrl_awvalid => s_axi_ctrl_awvalid, s_axi_ctrl_awready => s_axi_ctrl_awready,
      s_axi_ctrl_wdata => s_axi_ctrl_wdata, s_axi_ctrl_wstrb => s_axi_ctrl_wstrb,
      s_axi_ctrl_wvalid => s_axi_ctrl_wvalid, s_axi_ctrl_wready => s_axi_ctrl_wready,
      s_axi_ctrl_bresp => s_axi_ctrl_bresp, s_axi_ctrl_bvalid => s_axi_ctrl_bvalid,
      s_axi_ctrl_bready => s_axi_ctrl_bready,
      s_axi_ctrl_araddr => s_axi_ctrl_araddr, s_axi_ctrl_arprot => s_axi_ctrl_arprot,
      s_axi_ctrl_arvalid => s_axi_ctrl_arvalid, s_axi_ctrl_arready => s_axi_ctrl_arready,
      s_axi_ctrl_rdata => s_axi_ctrl_rdata, s_axi_ctrl_rresp => s_axi_ctrl_rresp,
      s_axi_ctrl_rvalid => s_axi_ctrl_rvalid, s_axi_ctrl_rready => s_axi_ctrl_rready);
end architecture rtl;
