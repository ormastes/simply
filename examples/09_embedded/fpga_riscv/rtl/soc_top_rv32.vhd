library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;
library unisim;
use unisim.vcomponents.all;

entity soc_top_rv32 is
  generic (
    RESET_RELEASE_COUNT : natural := 255;
    -- Lane B: optional in-fabric JTAG debug of the rv32 hart, reached through the
    -- Xilinx BSCANE2 USER tunnel (same FT4232H programming chain, no extra pins).
    -- DEFAULT OFF so Lane A's synth is byte-for-byte unaffected; a build knob
    -- (`-generic G_DEBUG_JTAG=true`) turns it on for a debug bitstream. Adds NO
    -- top-level ports — BSCANE2 taps the internal config-JTAG. See
    -- src/lib/hardware/debug/jtag_debug_chain.vhd + bscane2_tap_bridge.vhd.
    G_DEBUG_JTAG : boolean := false
  );
  port (
    uart_tx : out std_logic
  );
end entity soc_top_rv32;

architecture rtl of soc_top_rv32 is
  signal cfgclk  : std_logic;
  signal cfgmclk : std_logic;
  -- Core clock: cfgmclk (~50 MHz nominal) divided by 2 via BUFGCE_DIV.
  -- The rv32 core cannot close timing at 50 MHz (WNS probe => ~37 MHz max),
  -- so the whole design runs in the 25 MHz clk_core domain.
  signal clk_core : std_logic;
  signal di      : std_logic_vector(3 downto 0);
  signal eos     : std_logic;
  signal preq    : std_logic;
  signal rst_q   : std_logic := '1';
  signal rst_cnt : unsigned(31 downto 0) := (others => '0');
  signal uart_tx_core : std_logic;
  signal debug_uart_valid : std_logic;
  signal debug_uart_byte : std_logic_vector(7 downto 0);
  signal debug_pc : std_logic_vector(15 downto 0);
  signal debug_ins : std_logic_vector(31 downto 0);
  signal debug_a0 : std_logic_vector(7 downto 0);
  signal debug_ra : std_logic_vector(15 downto 0);
  signal debug_sp : std_logic_vector(15 downto 0);
  signal debug_phase : std_logic_vector(3 downto 0);
  signal marker_idx : natural range 0 to 8 := 0;
  signal marker_seen : std_logic := '0';
  signal uart_ila_probe : std_logic_vector(101 downto 0);
  function marker_byte(idx : natural) return std_logic_vector is
  begin
    case idx is
      when 0 => return x"46";
      when 1 => return x"50";
      when 2 => return x"47";
      when 3 => return x"41";
      when 4 => return x"2D";
      when 5 => return x"52";
      when 6 => return x"56";
      when 7 => return x"33";
      when others => return x"32";
    end case;
  end function;
  attribute dont_touch : string;
  attribute mark_debug : string;
  attribute dont_touch of uart_tx_core : signal is "true";
  attribute mark_debug of uart_tx_core : signal is "true";
  attribute dont_touch of uart_ila_probe : signal is "true";
  attribute mark_debug of uart_ila_probe : signal is "true";

  -- Lane B: BSCANE2 debug-tunnel plumbing (used only when G_DEBUG_JTAG = true).
  signal dbg_rst_n   : std_logic;
  signal bsc_sel     : std_logic;
  signal bsc_drck    : std_logic;
  signal bsc_capture : std_logic;
  signal bsc_shift   : std_logic;
  signal bsc_update  : std_logic;
  signal bsc_tdi     : std_logic;
  signal bsc_tdo     : std_logic;
  signal dbg_tck     : std_logic;
  signal dbg_tms     : std_logic;
  signal dbg_tdi     : std_logic;
  signal dbg_tdo     : std_logic;
begin
  dbg_rst_n <= not rst_q;
  uart_tx <= uart_tx_core;
  uart_ila_probe(7 downto 0) <= debug_uart_byte;
  uart_ila_probe(8) <= debug_uart_valid;
  uart_ila_probe(9) <= marker_seen;
  uart_ila_probe(25 downto 10) <= debug_pc;
  uart_ila_probe(57 downto 26) <= debug_ins;
  uart_ila_probe(65 downto 58) <= debug_a0;
  uart_ila_probe(81 downto 66) <= debug_ra;
  uart_ila_probe(97 downto 82) <= debug_sp;
  uart_ila_probe(101 downto 98) <= debug_phase;

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
        marker_idx <= 0;
        marker_seen <= '0';
      elsif debug_uart_valid = '1' then
        if debug_uart_byte = marker_byte(marker_idx) then
          if marker_idx = 8 then
            marker_seen <= '1';
            marker_idx <= 0;
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

  ----------------------------------------------------------------------------
  -- DEFAULT (G_DEBUG_JTAG = false): the plain rv32 core, exactly as before.
  -- Lane A's synth resolves to this arm; nothing about it changes.
  ----------------------------------------------------------------------------
  gen_nodebug : if not G_DEBUG_JTAG generate
    u_core : entity work.rv32_exec_core
      generic map (
        -- Must equal the real clk_core frequency or the UART baud divisor is
        -- wrong: cfgmclk is ~50 MHz nominal, divided by 2 => 25 MHz.
        CLK_FREQ => 25_000_000,
        BAUD_RATE => 115_200
      )
      port map (
        clk => clk_core, rst => rst_q, uart_tx => uart_tx_core,
        debug_uart_valid => debug_uart_valid,
        debug_uart_byte => debug_uart_byte,
        debug_pc => debug_pc,
        debug_ins => debug_ins,
        debug_a0 => debug_a0,
        debug_ra => debug_ra,
        debug_sp => debug_sp,
        debug_phase => debug_phase
      );
  end generate gen_nodebug;

  ----------------------------------------------------------------------------
  -- DEBUG (G_DEBUG_JTAG = true): the SAME rv32 hart wrapped by the JTAG debug
  -- back-end (jtag_debug_chain: TAP -> DTM -> CDC -> DM -> clock-gated hart),
  -- reached through the Xilinx BSCANE2 USER4 tunnel + bscane2_tap_bridge. The
  -- soak UART still streams from the wrapped core (o_uart_tx) so the ILA/serial
  -- markers stay visible; OpenOCD independently halts/reads/steps the hart over
  -- the programming JTAG chain. See scripts/fpga/openocd_kv260_bscan.cfg.
  ----------------------------------------------------------------------------
  gen_debug : if G_DEBUG_JTAG generate
    -- Xilinx BSCANE2: USER4 data-register tap onto the config JTAG chain.
    u_bscan : BSCANE2
      generic map (JTAG_CHAIN => 4)
      port map (
        CAPTURE => bsc_capture, DRCK => bsc_drck, RESET => open, RUNTEST => open,
        SEL => bsc_sel, SHIFT => bsc_shift, TCK => open, TMS => open,
        UPDATE => bsc_update, TDI => bsc_tdi, TDO => bsc_tdo);

    u_bridge : entity work.bscane2_tap_bridge
      port map (
        clk => clk_core, rst_n => dbg_rst_n,
        bsc_sel => bsc_sel, bsc_drck => bsc_drck, bsc_capture => bsc_capture,
        bsc_shift => bsc_shift, bsc_update => bsc_update, bsc_tdi => bsc_tdi,
        bsc_tdo => bsc_tdo,
        tck_o => dbg_tck, tms_o => dbg_tms, tdi_o => dbg_tdi, tdo_i => dbg_tdo);

    u_chain : entity work.jtag_debug_chain
      port map (
        clk => clk_core, rst_n => dbg_rst_n,
        tck => dbg_tck, tms => dbg_tms, tdi => dbg_tdi, trst_n => dbg_rst_n,
        tdo => dbg_tdo,
        uart_tx => uart_tx_core,
        o_halted => open, o_running => open, o_step => open,
        o_dbg_pc_full => open, o_dbg_reg_data => open);

    -- The observation/ILA taps are driven from the core in the default arm; in
    -- the debug arm the JTAG DM is the inspection path, so tie them inactive.
    debug_uart_valid <= '0';
    debug_uart_byte  <= (others => '0');
    debug_pc         <= (others => '0');
    debug_ins        <= (others => '0');
    debug_a0         <= (others => '0');
    debug_ra         <= (others => '0');
    debug_sp         <= (others => '0');
    debug_phase      <= (others => '0');
  end generate gen_debug;
end architecture rtl;
