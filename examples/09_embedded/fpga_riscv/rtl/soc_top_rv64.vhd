library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;
library unisim;
use unisim.vcomponents.all;

-- soc_top_rv64 — KV260 (Kria K26) board top for the hand-written rv64_exec_core.
--
-- Board variant (Vivado-only): clocked from the free-running STARTUPE3
-- CFGMCLK output (config-JTAG clock, ~50 MHz nominal on UltraScale+),
-- divided by 2 via BUFGCE_DIV for clk_core -- EXACTLY soc_top_rv32's own
-- clocking pattern, reused verbatim here after board bring-up (2026-07-24)
-- found that this design's original PS-block-design clock (pl_clk0) never
-- toggles under a JTAG-only bitstream download: a real ILA wired onto
-- clk_core (build/fpga evidence, ENABLE_UART_ILA build) showed HW_ILAS=0
-- (dbg_hub never enumerates => clk_core dead), and PS-side register
-- correctness (CRL_APB PL0_REF_CTRL, GPIO/EMIO pl_resetn0, PS-PL isolation)
-- verified via xsdb did not unstick it -- pl_clk0 delivery depends on PS
-- boot-time (FSBL) bring-up this JTAG-only flow bypasses. CFGMCLK has NO PS
-- dependency (same board, same chip, and soc_top_rv32 already completed a
-- real 981 s board soak on this exact clock source), so the PS block design
-- is dropped entirely: no k26_ps_bd, no pl_resetn0 handshake. Reset is a
-- plain free-running power-on release counter, identical to soc_top_rv32.
-- GHDL cannot elaborate this entity (STARTUPE3/BSCANE2 need unisim); use
-- soc_top_rv64_sim for simulation.
entity soc_top_rv64 is
  generic (
    RESET_RELEASE_COUNT : natural := 255
  );
  port (
    uart_tx : out std_logic;
    uart_rx : in  std_logic
  );
end entity soc_top_rv64;

architecture rtl of soc_top_rv64 is
  signal cfgclk    : std_logic;
  signal cfgmclk   : std_logic;
  -- Core clock: cfgmclk (~50 MHz nominal) divided by 2 via BUFGCE_DIV, same
  -- margin soc_top_rv32 uses (its 32-bit core cannot close timing at the raw
  -- ~50 MHz either). rv64's 64-bit datapath already needed /2 off a 100 MHz
  -- PS clock to meet timing (WNS -3.758 ns @ 100 MHz -> +1.420 ns @ 50 MHz),
  -- so /2 off the slower cfgmclk carries the same margin forward.
  signal clk_core  : std_logic;
  signal di        : std_logic_vector(3 downto 0);
  signal eos       : std_logic;
  signal preq      : std_logic;
  signal rst_q     : std_logic := '1';
  signal rst_cnt   : unsigned(31 downto 0) := (others => '0');
  signal uart_tx_core     : std_logic;
  signal debug_uart_valid : std_logic;
  signal debug_uart_byte  : std_logic_vector(7 downto 0);
  signal marker_idx  : natural range 0 to 17 := 0;
  signal marker_seen : std_logic := '0';
  signal uart_ila_probe : std_logic_vector(9 downto 0);

  -- No UART adapter / debug module exists on this board bring-up (2026-07-24):
  -- an always-on BSCANE2 (USER4) tap onto the config JTAG chain gives the host
  -- a read-only view of the soft-UART byte stream (byte_cnt + last 16 bytes)
  -- for board-origin soak evidence with zero extra cabling. See
  -- src/lib/hardware/debug/uart_bscan_log.vhd.
  signal dbg_rst_n   : std_logic;
  signal bsc_sel     : std_logic;
  signal bsc_drck    : std_logic;
  signal bsc_capture : std_logic;
  signal bsc_shift   : std_logic;
  signal bsc_update  : std_logic;
  signal bsc_tdi     : std_logic;
  signal bsc_tdo     : std_logic;

  -- Marker string "SimpleOS RV64 FPGA" (18 chars) as an ASCII lookup.
  function marker_byte(idx : natural) return std_logic_vector is
    constant MK : string := "SimpleOS RV64 FPGA";
  begin
    return std_logic_vector(to_unsigned(character'pos(MK(idx + 1)), 8));
  end function;

  attribute dont_touch : string;
  attribute mark_debug : string;
  attribute dont_touch of uart_tx_core   : signal is "true";
  attribute mark_debug of uart_tx_core   : signal is "true";
  attribute dont_touch of uart_ila_probe : signal is "true";
  attribute mark_debug of uart_ila_probe : signal is "true";
begin
  dbg_rst_n <= not rst_q;
  uart_tx <= uart_tx_core;
  uart_ila_probe(7 downto 0) <= debug_uart_byte;
  uart_ila_probe(8) <= debug_uart_valid;
  uart_ila_probe(9) <= marker_seen;

  u_bscan : BSCANE2
    generic map (JTAG_CHAIN => 4)
    port map (
      CAPTURE => bsc_capture, DRCK => bsc_drck, RESET => open, RUNTEST => open,
      SEL => bsc_sel, SHIFT => bsc_shift, TCK => open, TMS => open,
      UPDATE => bsc_update, TDI => bsc_tdi, TDO => bsc_tdo);

  u_uart_bscan_log : entity work.uart_bscan_log
    port map (
      clk => clk_core, rst_n => dbg_rst_n,
      debug_uart_valid => debug_uart_valid, debug_uart_byte => debug_uart_byte,
      bsc_sel => bsc_sel, bsc_drck => bsc_drck, bsc_capture => bsc_capture,
      bsc_shift => bsc_shift, bsc_update => bsc_update, bsc_tdi => bsc_tdi,
      bsc_tdo => bsc_tdo);

  u_startup : STARTUPE3
    generic map (PROG_USR => "FALSE", SIM_CCLK_FREQ => 0.0)
    port map (
      CFGCLK => cfgclk, CFGMCLK => cfgmclk, DI => di, EOS => eos, PREQ => preq,
      DO => "0000", DTS => "1111", FCSBO => '1', FCSBTS => '1', GSR => '0', GTS => '0',
      KEYCLEARB => '1', PACK => '0', USRCCLKO => '0', USRCCLKTS => '1',
      USRDONEO => '1', USRDONETS => '1'
    );

  u_clkdiv : BUFGCE_DIV
    generic map (BUFGCE_DIVIDE => 2)
    port map (I => cfgmclk, CE => '1', CLR => '0', O => clk_core);

  -- Free-running power-on reset release -- NO external PS handshake (this is
  -- exactly soc_top_rv32's reset process).
  process(clk_core)
  begin
    if rising_edge(clk_core) then
      if rst_cnt < to_unsigned(RESET_RELEASE_COUNT, rst_cnt'length) then
        rst_cnt <= rst_cnt + 1;
        rst_q <= '1';
      else
        rst_q <= '0';
      end if;
    end if;
  end process;

  process(clk_core)
  begin
    if rising_edge(clk_core) then
      if rst_q = '1' then
        marker_idx  <= 0;
        marker_seen <= '0';
      elsif debug_uart_valid = '1' then
        if debug_uart_byte = marker_byte(marker_idx) then
          if marker_idx = 17 then
            marker_seen <= '1';
            marker_idx  <= 0;
          else
            marker_idx <= marker_idx + 1;
          end if;
        elsif debug_uart_byte = marker_byte(0) then
          marker_idx <= 1;
        else
          marker_idx <= 0;
        end if;
      end if;
    end if;
  end process;

  u_core : entity work.rv64_exec_core
    generic map (
      CLK_FREQ  => 25_000_000,
      BAUD_RATE => 115_200
    )
    port map (
      clk              => clk_core,
      rst              => rst_q,
      uart_tx          => uart_tx_core,
      debug_uart_valid => debug_uart_valid,
      debug_uart_byte  => debug_uart_byte
    );
end architecture rtl;
