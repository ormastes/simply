library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;
library unisim;
use unisim.vcomponents.all;

-- soc_top_rv32_tiny_bram: Vivado top for booting the TINY rv32 SimpleOS config
-- on real KV260 (xck26) silicon out of on-chip BRAM ONLY.
--
--   NO DDR, NO block design, NO FSBL, NO PS dependency of any kind:
--   * clock  = STARTUPE3 CFGMCLK (~50 MHz nominal) / 2 via BUFGCE_DIV — the
--     same PS-free pattern the proven Adler-32 ROM design used on this board.
--   * memory = rv32_bram_soc BRAM banks, INIT'd from .mem files at synthesis
--     time, so the kernel + FAT32 ramdisk are alive the moment the bitstream
--     configures. The core starts booting right after the reset counter.
--   * observation = BSCANE2 USER4 data register (KV260 PL UART pin H12/PMOD J2
--     is not routed to any host tty). This is a plain 64-bit DR, NOT the DMI
--     tunnel: shift in a 32-bit obs command, and the response to the PREVIOUS
--     command shifts out (lag-by-one, same discipline as the proven DMI
--     tunnel). Response = A55A(16) | cmd-echo(16) | data(32); the signature +
--     echo let the host find the bit alignment past the ARM DAP bypass bit.
--     Command set: see rv32_bram_soc.vhd (magic/status/pc/uartbuf/...).
--
-- CDC: the DR lives in the DRCK (JTAG) domain. UPDATE-DR latches the shifted
-- command and flips cmd_toggle; a 3-FF synchronizer in clk_core turns that
-- into a one-cycle obs_cmd_valid pulse. The 64-bit response register is
-- written in clk_core and sampled raw by CAPTURE-DR: safe because the host
-- reads a response microseconds-to-milliseconds after it stabilized (responses
-- only change when a new command is issued).

entity soc_top_rv32_tiny_bram is
  generic (
    RESET_RELEASE_COUNT : natural := 255;
    G_CLK_FREQ    : natural := 25000000;
    G_BAUD_RATE   : natural := 115200;
    G_RAM_WORDS   : natural := 65536;
    G_RDISK_WORDS : natural := 81920;
    G_UARTBUF_WORDS : natural := 2048;
    G_RAM_INIT_FILE   : string := "rv32_flat.mem";
    G_RDISK_INIT_FILE : string := "rv32_ramdisk.mem"
  );
  port (
    uart_tx : out std_logic
  );
end entity soc_top_rv32_tiny_bram;

architecture rtl of soc_top_rv32_tiny_bram is
  signal cfgclk  : std_logic;
  signal cfgmclk : std_logic;
  signal clk_core : std_logic;
  signal di      : std_logic_vector(3 downto 0);
  signal eos     : std_logic;
  signal preq    : std_logic;
  signal rst_q   : std_logic := '1';
  signal rst_cnt : unsigned(31 downto 0) := (others => '0');

  -- BSCANE2 USER4 plumbing.
  signal bsc_sel     : std_logic;
  signal bsc_drck    : std_logic;
  signal bsc_capture : std_logic;
  signal bsc_shift   : std_logic;
  signal bsc_update  : std_logic;
  signal bsc_tdi     : std_logic;
  signal bsc_tdo     : std_logic;

  -- DRCK-domain shift register + UPDATE-domain command latch.
  signal dr_shift_q   : std_logic_vector(63 downto 0) := (others => '0');
  signal cmd_reg_q    : std_logic_vector(31 downto 0) := (others => '0');
  signal cmd_toggle_q : std_logic := '0';

  -- clk_core-domain synchronizer + pulse gen.
  signal tgl_sync_q : std_logic_vector(2 downto 0) := (others => '0');
  signal obs_cmd_valid : std_logic;
  signal obs_resp : std_logic_vector(63 downto 0);

  attribute ASYNC_REG : string;
  attribute ASYNC_REG of tgl_sync_q : signal is "TRUE";
begin
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

  u_bscan : BSCANE2
    generic map (JTAG_CHAIN => 4)
    port map (
      CAPTURE => bsc_capture, DRCK => bsc_drck, RESET => open, RUNTEST => open,
      SEL => bsc_sel, SHIFT => bsc_shift, TCK => open, TMS => open,
      UPDATE => bsc_update, TDI => bsc_tdi, TDO => bsc_tdo);

  -- DRCK domain: capture response, shift command in / response out.
  process(bsc_drck)
  begin
    if rising_edge(bsc_drck) then
      if bsc_sel = '1' then
        if bsc_capture = '1' then
          dr_shift_q <= obs_resp; -- raw cross-domain sample; quasi-static by protocol
        elsif bsc_shift = '1' then
          dr_shift_q <= bsc_tdi & dr_shift_q(63 downto 1);
        end if;
      end if;
    end if;
  end process;
  bsc_tdo <= dr_shift_q(0);

  -- UPDATE-DR: latch the shifted-in command (low 32 bits) and flag it.
  process(bsc_update)
  begin
    if rising_edge(bsc_update) then
      if bsc_sel = '1' then
        cmd_reg_q <= dr_shift_q(31 downto 0);
        cmd_toggle_q <= not cmd_toggle_q;
      end if;
    end if;
  end process;

  -- clk_core domain: toggle -> one-cycle obs_cmd_valid pulse.
  process(clk_core)
  begin
    if rising_edge(clk_core) then
      tgl_sync_q <= cmd_toggle_q & tgl_sync_q(2 downto 1);
    end if;
  end process;
  obs_cmd_valid <= tgl_sync_q(1) xor tgl_sync_q(0);

  u_soc : entity work.rv32_bram_soc
    generic map (
      CLK_FREQ => G_CLK_FREQ, BAUD_RATE => G_BAUD_RATE,
      RAM_WORDS => G_RAM_WORDS, RDISK_WORDS => G_RDISK_WORDS,
      UARTBUF_WORDS => G_UARTBUF_WORDS,
      RAM_INIT_FILE => G_RAM_INIT_FILE, RDISK_INIT_FILE => G_RDISK_INIT_FILE)
    port map (
      clk => clk_core, rst => rst_q, uart_tx => uart_tx,
      obs_cmd => cmd_reg_q, obs_cmd_valid => obs_cmd_valid, obs_resp => obs_resp,
      debug_uart_valid => open, debug_uart_byte => open, debug_pc => open);
end architecture rtl;
