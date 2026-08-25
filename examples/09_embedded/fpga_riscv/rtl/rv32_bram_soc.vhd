library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;
use std.textio.all;
use ieee.std_logic_textio.all;

-- rv32_bram_soc: SYNTHESIZABLE BRAM-only SoC for the TINY rv32 SimpleOS config.
--
-- Path A of the KV260 silicon campaign: everything lives in PL fabric — NO DDR,
-- NO block design, NO FSBL, NO PS dependency. Pairs the proven synthesizable
-- rv32_exec_core_axi (stalled external-memory FSM, same decode/ALU/CSR/M logic
-- that difftested clean vs QEMU) with:
--
--   * main RAM  at 0x80000000 : RAM_WORDS   x32 BRAM, byte-write enables,
--                               INIT'd from RAM_INIT_FILE at synthesis time
--   * ramdisk   at 0x88000000 : RDISK_WORDS x32 BRAM ROM (read-only FAT32
--                               slice), INIT'd from RDISK_INIT_FILE
--   * UART capture buffer     : UARTBUF_WORDS x32 BRAM; every byte the kernel
--                               stores to the 16550 THR (0x10000000) is packed
--                               4-per-word so the whole boot transcript can be
--                               read back over JTAG (the KV260 carrier routes
--                               the PL UART TX pin to PMOD J2, not to any host
--                               tty, so JTAG readout is the observation path).
--   * observation port        : synchronous cmd/resp register interface, driven
--                               by the BSCANE2 USER4 DR logic in the Vivado top
--                               (soc_top_rv32_tiny_bram) or directly by a GHDL
--                               testbench (tb_rv32_tiny_bram_soc).
--
-- The memory slave answers the core's mem_req/mem_rvalid handshake with a
-- fixed 3-cycle read pipeline (registered index -> registered BRAM output ->
-- registered rdata+rvalid), which the core tolerates by design (it was proven
-- against a 1..4-cycle random-latency slave in tb_rv32_simpleos_boot_axi).
-- Out-of-range loads return 0 and out-of-range stores are dropped (both still
-- ack), matching the behavioral flat core.
--
-- Observation protocol (one command per obs_cmd_valid pulse):
--   obs_cmd(3 downto 0)   = select
--     0x0 magic            -> x"51F0B007"
--     0x1 status           -> pass & fail & running & '0' & version(4) &
--                             uart_byte_count(24)
--     0x2 debug_pc         -> current core PC
--     0x3 uartbuf word     -> uartbuf[obs_cmd(31 downto 16)] (4 transcript
--                             bytes, little-endian: byte0 = bits 7..0)
--     0x4 debug_ins   0x5 debug_sp   0x6 debug_ra   0x7 cycle counter (live)
--     0x8 debug_a0    0x9 mem_rvalid count (bus liveness)
--     0xF soft reset       -> when obs_cmd(31 downto 16) = x"5AFE": re-run the
--                             boot (core reset ~255 cycles, capture cleared)
--   obs_resp(31 downto 0) = data, (47 downto 32) = echo of obs_cmd(15 downto 0),
--   (63 downto 48) = x"A55A" (signature; lets the JTAG host find the bit
--   alignment of the response window empirically).
-- Response for command N is stable until command N+1 is issued; the JTAG host
-- reads it back during the NEXT DR scan (same lag-by-one the proven DMI tunnel
-- uses).

entity rv32_bram_soc is
  generic (
    CLK_FREQ        : natural := 25000000;
    BAUD_RATE       : natural := 115200;
    -- 65536 words = 256 KB main RAM (BRAM budget: ~64 of 144 BRAM36).
    RAM_WORDS       : natural := 65536;
    -- 81920 words = 320 KB ramdisk bank (FAT32 slice; smoke files live low).
    RDISK_WORDS     : natural := 81920;
    -- 2048 words = 8 KB UART capture (boot transcript is ~700 bytes).
    UARTBUF_WORDS   : natural := 2048;
    RAM_INIT_FILE   : string  := "rv32_flat.mem";
    RDISK_INIT_FILE : string  := "rv32_ramdisk.mem"
  );
  port (
    clk : in std_logic;
    rst : in std_logic;
    uart_tx : out std_logic;
    -- Observation port (clk domain).
    obs_cmd       : in  std_logic_vector(31 downto 0);
    obs_cmd_valid : in  std_logic;
    obs_resp      : out std_logic_vector(63 downto 0);
    -- Raw taps for testbenches / ILA.
    debug_uart_valid : out std_logic;
    debug_uart_byte  : out std_logic_vector(7 downto 0);
    debug_pc         : out std_logic_vector(31 downto 0)
  );
end entity rv32_bram_soc;

architecture rtl of rv32_bram_soc is
  constant RAM_BASE   : unsigned(31 downto 0) := x"80000000";
  constant RDISK_BASE : unsigned(31 downto 0) := x"88000000";

  -- --------------------------------------------------------------------------
  -- Power-of-2 bank split. Vivado pads a non-power-of-2 BRAM depth to the next
  -- power of 2 (a 77824-word array elaborated as 131072x32 = 512KB of BRAM),
  -- which blows the 144-tile xck26 budget. Splitting each memory into at most
  -- three power-of-2 banks makes the mapping exact:
  --   51200 words = 32768 + 16384 + 2048   (RAM,   50 BRAM36)
  --   77824 words = 65536 + 8192  + 4096   (rdisk, 76 BRAM36)
  -- A power-of-2 total (e.g. the GHDL default 131072/262144) degenerates to a
  -- single bank. Totals needing more than 3 banks are rejected by an assert.
  -- --------------------------------------------------------------------------
  function bank_words(total : natural; bank : natural) return natural is
    variable remw : natural := total;
    variable sz : natural;
  begin
    for i in 0 to 2 loop
      sz := 0;
      if remw > 0 then
        sz := 1;
        while sz * 2 <= remw loop sz := sz * 2; end loop;
      end if;
      if i = bank then return sz; end if;
      remw := remw - sz;
    end loop;
    return 0;
  end function;
  function at_least_1(n : natural) return natural is
  begin
    if n > 0 then return n; end if;
    return 1;
  end function;

  constant RAM_B0W : natural := bank_words(RAM_WORDS, 0);
  constant RAM_B1W : natural := bank_words(RAM_WORDS, 1);
  constant RAM_B2W : natural := bank_words(RAM_WORDS, 2);
  constant RD_B0W  : natural := bank_words(RDISK_WORDS, 0);
  constant RD_B1W  : natural := bank_words(RDISK_WORDS, 1);
  constant RD_B2W  : natural := bank_words(RDISK_WORDS, 2);

  type ram0_t is array (0 to at_least_1(RAM_B0W) - 1) of std_logic_vector(31 downto 0);
  type ram1_t is array (0 to at_least_1(RAM_B1W) - 1) of std_logic_vector(31 downto 0);
  type ram2_t is array (0 to at_least_1(RAM_B2W) - 1) of std_logic_vector(31 downto 0);
  type rd0_t  is array (0 to at_least_1(RD_B0W) - 1)  of std_logic_vector(31 downto 0);
  type rd1_t  is array (0 to at_least_1(RD_B1W) - 1)  of std_logic_vector(31 downto 0);
  type rd2_t  is array (0 to at_least_1(RD_B2W) - 1)  of std_logic_vector(31 downto 0);
  type uartbuf_t is array (0 to UARTBUF_WORDS - 1) of std_logic_vector(31 downto 0);

  -- NOTE: both init files must exist (the GHDL runner and the Vivado build
  -- script always generate them). The direct `open read_mode is` form is the
  -- UG901-blessed synthesizable BRAM-init pattern. Each bank reads the same
  -- file, skipping `skip` leading words and taking `depth` words.
  impure function init_ram0(fname : string; skip, depth : natural) return ram0_t is
    file f : text open read_mode is fname;
    variable line_v : line;
    variable word_v : std_logic_vector(31 downto 0);
    variable mem_v : ram0_t := (others => x"00000000");
    variable idx : natural := 0;
  begin
    while not endfile(f) loop
      readline(f, line_v);
      hread(line_v, word_v);
      if idx >= skip and idx < skip + depth then
        mem_v(idx - skip) := word_v;
      end if;
      idx := idx + 1;
    end loop;
    return mem_v;
  end function;
  impure function init_ram1(fname : string; skip, depth : natural) return ram1_t is
    file f : text open read_mode is fname;
    variable line_v : line;
    variable word_v : std_logic_vector(31 downto 0);
    variable mem_v : ram1_t := (others => x"00000000");
    variable idx : natural := 0;
  begin
    while not endfile(f) loop
      readline(f, line_v);
      hread(line_v, word_v);
      if idx >= skip and idx < skip + depth then
        mem_v(idx - skip) := word_v;
      end if;
      idx := idx + 1;
    end loop;
    return mem_v;
  end function;
  impure function init_ram2(fname : string; skip, depth : natural) return ram2_t is
    file f : text open read_mode is fname;
    variable line_v : line;
    variable word_v : std_logic_vector(31 downto 0);
    variable mem_v : ram2_t := (others => x"00000000");
    variable idx : natural := 0;
  begin
    while not endfile(f) loop
      readline(f, line_v);
      hread(line_v, word_v);
      if idx >= skip and idx < skip + depth then
        mem_v(idx - skip) := word_v;
      end if;
      idx := idx + 1;
    end loop;
    return mem_v;
  end function;
  impure function init_rd0(fname : string; skip, depth : natural) return rd0_t is
    file f : text open read_mode is fname;
    variable line_v : line;
    variable word_v : std_logic_vector(31 downto 0);
    variable mem_v : rd0_t := (others => x"00000000");
    variable idx : natural := 0;
  begin
    while not endfile(f) loop
      readline(f, line_v);
      hread(line_v, word_v);
      if idx >= skip and idx < skip + depth then
        mem_v(idx - skip) := word_v;
      end if;
      idx := idx + 1;
    end loop;
    return mem_v;
  end function;
  impure function init_rd1(fname : string; skip, depth : natural) return rd1_t is
    file f : text open read_mode is fname;
    variable line_v : line;
    variable word_v : std_logic_vector(31 downto 0);
    variable mem_v : rd1_t := (others => x"00000000");
    variable idx : natural := 0;
  begin
    while not endfile(f) loop
      readline(f, line_v);
      hread(line_v, word_v);
      if idx >= skip and idx < skip + depth then
        mem_v(idx - skip) := word_v;
      end if;
      idx := idx + 1;
    end loop;
    return mem_v;
  end function;
  impure function init_rd2(fname : string; skip, depth : natural) return rd2_t is
    file f : text open read_mode is fname;
    variable line_v : line;
    variable word_v : std_logic_vector(31 downto 0);
    variable mem_v : rd2_t := (others => x"00000000");
    variable idx : natural := 0;
  begin
    while not endfile(f) loop
      readline(f, line_v);
      hread(line_v, word_v);
      if idx >= skip and idx < skip + depth then
        mem_v(idx - skip) := word_v;
      end if;
      idx := idx + 1;
    end loop;
    return mem_v;
  end function;

  signal ram0 : ram0_t := init_ram0(RAM_INIT_FILE, 0, RAM_B0W);
  signal ram1 : ram1_t := init_ram1(RAM_INIT_FILE, RAM_B0W, RAM_B1W);
  signal ram2 : ram2_t := init_ram2(RAM_INIT_FILE, RAM_B0W + RAM_B1W, RAM_B2W);
  signal rdisk0 : rd0_t := init_rd0(RDISK_INIT_FILE, 0, RD_B0W);
  signal rdisk1 : rd1_t := init_rd1(RDISK_INIT_FILE, RD_B0W, RD_B1W);
  signal rdisk2 : rd2_t := init_rd2(RDISK_INIT_FILE, RD_B0W + RD_B1W, RD_B2W);
  signal uartbuf : uartbuf_t := (others => x"00000000");
  attribute ram_style : string;
  attribute ram_style of ram0   : signal is "block";
  attribute ram_style of ram1   : signal is "block";
  attribute ram_style of ram2   : signal is "block";
  attribute ram_style of rdisk0 : signal is "block";
  attribute ram_style of rdisk1 : signal is "block";
  attribute ram_style of rdisk2 : signal is "block";
  -- The capture buffer is tiny; keep it out of the contended BRAM budget.
  attribute ram_style of uartbuf : signal is "distributed";

  -- Core <-> memory slave.
  signal mem_req    : std_logic;
  signal mem_we     : std_logic;
  signal mem_addr   : std_logic_vector(31 downto 0);
  signal mem_wdata  : std_logic_vector(31 downto 0);
  signal mem_wstrb  : std_logic_vector(3 downto 0);
  signal mem_rdata  : std_logic_vector(31 downto 0) := (others => '0');
  signal mem_rvalid : std_logic := '0';

  type mstate_t is (M_IDLE, M_READ, M_RESP, M_WAIT);
  signal mstate_q : mstate_t := M_IDLE;
  type region_t is (R_RAM, R_RDISK, R_NONE);
  signal region_q : region_t := R_NONE;
  signal bank_q : natural range 0 to 2 := 0;
  signal ram0_idx_q : natural range 0 to at_least_1(RAM_B0W) - 1 := 0;
  signal ram1_idx_q : natural range 0 to at_least_1(RAM_B1W) - 1 := 0;
  signal ram2_idx_q : natural range 0 to at_least_1(RAM_B2W) - 1 := 0;
  signal rd0_idx_q  : natural range 0 to at_least_1(RD_B0W) - 1 := 0;
  signal rd1_idx_q  : natural range 0 to at_least_1(RD_B1W) - 1 := 0;
  signal rd2_idx_q  : natural range 0 to at_least_1(RD_B2W) - 1 := 0;
  -- Per-bank registered write enables (one clean UG901 byte-we template per
  -- bank process; a shared case-select write breaks Vivado RAM inference).
  signal ram0_we_q : std_logic := '0';
  signal ram1_we_q : std_logic := '0';
  signal ram2_we_q : std_logic := '0';
  signal wdata_q     : std_logic_vector(31 downto 0) := (others => '0');
  signal wstrb_q     : std_logic_vector(3 downto 0) := (others => '0');
  signal ram0_q, ram1_q, ram2_q : std_logic_vector(31 downto 0) := (others => '0');
  signal rd0_q, rd1_q, rd2_q    : std_logic_vector(31 downto 0) := (others => '0');
  signal rvalid_cnt_q : unsigned(31 downto 0) := (others => '0');

  -- UART capture.
  signal dbg_uart_valid : std_logic;
  signal dbg_uart_byte  : std_logic_vector(7 downto 0);
  signal uart_count_q : unsigned(31 downto 0) := (others => '0');
  signal ubuf_q : std_logic_vector(31 downto 0) := (others => '0');
  signal ubuf_raddr_q : natural range 0 to UARTBUF_WORDS - 1 := 0;

  -- Marker matchers.
  constant PASS_S : string := "ALL RV32 NVME FW CHECKS PASS";
  constant FAIL_S : string := "RV32 NVME FW FAIL";
  signal pass_idx_q : natural range 1 to PASS_S'length + 1 := 1;
  signal fail_idx_q : natural range 1 to FAIL_S'length + 1 := 1;
  signal pass_seen_q : std_logic := '0';
  signal fail_seen_q : std_logic := '0';

  -- Observation.
  signal obs_resp_q : std_logic_vector(63 downto 0) := (others => '0');
  -- 2-stage pend: stage1 = buffer raddr registered, stage2 = ubuf_q valid.
  signal obs_pend1_q : std_logic := '0';
  signal obs_pend2_q : std_logic := '0';
  signal obs_cmd_q  : std_logic_vector(31 downto 0) := (others => '0');
  signal cycle_cnt_q : unsigned(31 downto 0) := (others => '0');

  -- Soft reset (re-run boot from JTAG).
  signal soft_cnt_q : unsigned(7 downto 0) := (others => '0');
  signal core_rst : std_logic;

  signal dbg_pc, dbg_ins, dbg_a0, dbg_ra, dbg_sp : std_logic_vector(31 downto 0);

  function chr8(c : character) return std_logic_vector is
  begin
    return std_logic_vector(to_unsigned(character'pos(c), 8));
  end function;
begin
  assert RAM_B0W + RAM_B1W + RAM_B2W = RAM_WORDS
    report "RAM_WORDS needs more than 3 power-of-2 banks" severity failure;
  assert RD_B0W + RD_B1W + RD_B2W = RDISK_WORDS
    report "RDISK_WORDS needs more than 3 power-of-2 banks" severity failure;

  core_rst <= '1' when (rst = '1' or soft_cnt_q /= 0) else '0';
  debug_uart_valid <= dbg_uart_valid;
  debug_uart_byte  <= dbg_uart_byte;
  debug_pc <= dbg_pc;
  obs_resp <= obs_resp_q;

  u_core : entity work.rv32_exec_core_axi
    generic map (CLK_FREQ => CLK_FREQ, BAUD_RATE => BAUD_RATE)
    port map (
      clk => clk, rst => core_rst, uart_tx => uart_tx,
      mem_req => mem_req, mem_we => mem_we, mem_addr => mem_addr,
      mem_wdata => mem_wdata, mem_wstrb => mem_wstrb,
      mem_rdata => mem_rdata, mem_rvalid => mem_rvalid,
      debug_uart_valid => dbg_uart_valid, debug_uart_byte => dbg_uart_byte,
      debug_pc => dbg_pc, debug_ins => dbg_ins, debug_a0 => dbg_a0,
      debug_ra => dbg_ra, debug_sp => dbg_sp);

  -- --------------------------------------------------------------------------
  -- Memory banks: one process per bank, plain UG901 byte-write-enable /
  -- registered-read templates so Vivado infers BRAM exactly.
  -- --------------------------------------------------------------------------
  p_ram0 : process(clk)
  begin
    if rising_edge(clk) then
      if ram0_we_q = '1' then
        for i in 0 to 3 loop
          if wstrb_q(i) = '1' then
            ram0(ram0_idx_q)(i * 8 + 7 downto i * 8) <= wdata_q(i * 8 + 7 downto i * 8);
          end if;
        end loop;
      end if;
      ram0_q <= ram0(ram0_idx_q);
    end if;
  end process;

  p_ram1 : process(clk)
  begin
    if rising_edge(clk) then
      if ram1_we_q = '1' then
        for i in 0 to 3 loop
          if wstrb_q(i) = '1' then
            ram1(ram1_idx_q)(i * 8 + 7 downto i * 8) <= wdata_q(i * 8 + 7 downto i * 8);
          end if;
        end loop;
      end if;
      ram1_q <= ram1(ram1_idx_q);
    end if;
  end process;

  p_ram2 : process(clk)
  begin
    if rising_edge(clk) then
      if ram2_we_q = '1' then
        for i in 0 to 3 loop
          if wstrb_q(i) = '1' then
            ram2(ram2_idx_q)(i * 8 + 7 downto i * 8) <= wdata_q(i * 8 + 7 downto i * 8);
          end if;
        end loop;
      end if;
      ram2_q <= ram2(ram2_idx_q);
    end if;
  end process;

  p_rd0 : process(clk)
  begin
    if rising_edge(clk) then
      rd0_q <= rdisk0(rd0_idx_q);
    end if;
  end process;

  p_rd1 : process(clk)
  begin
    if rising_edge(clk) then
      rd1_q <= rdisk1(rd1_idx_q);
    end if;
  end process;

  p_rd2 : process(clk)
  begin
    if rising_edge(clk) then
      rd2_q <= rdisk2(rd2_idx_q);
    end if;
  end process;

  -- --------------------------------------------------------------------------
  -- Memory slave FSM: fixed pipeline, one transaction at a time.
  -- --------------------------------------------------------------------------
  process(clk)
    variable off : unsigned(31 downto 0);
    variable widx : natural;
  begin
    if rising_edge(clk) then
      mem_rvalid <= '0';
      if rst = '1' then
        mstate_q <= M_IDLE;
        ram0_we_q <= '0';
        ram1_we_q <= '0';
        ram2_we_q <= '0';
        rvalid_cnt_q <= (others => '0');
      else
        case mstate_q is
          when M_IDLE =>
            ram0_we_q <= '0';
            ram1_we_q <= '0';
            ram2_we_q <= '0';
            if mem_req = '1' then
              off := unsigned(mem_addr) - RAM_BASE;
              region_q <= R_NONE;
              if unsigned(mem_addr) >= RAM_BASE
                 and unsigned(mem_addr) < RAM_BASE + to_unsigned(RAM_WORDS, 32) * 4 then
                region_q <= R_RAM;
                widx := to_integer(off(22 downto 2));
                if widx < RAM_B0W then
                  bank_q <= 0;
                  ram0_idx_q <= widx;
                  ram0_we_q <= mem_we;
                elsif widx < RAM_B0W + RAM_B1W then
                  bank_q <= 1;
                  ram1_idx_q <= widx - RAM_B0W;
                  ram1_we_q <= mem_we;
                elsif widx < RAM_WORDS then
                  bank_q <= 2;
                  ram2_idx_q <= widx - RAM_B0W - RAM_B1W;
                  ram2_we_q <= mem_we;
                end if;
              elsif unsigned(mem_addr) >= RDISK_BASE
                 and unsigned(mem_addr) < RDISK_BASE + to_unsigned(RDISK_WORDS, 32) * 4 then
                off := unsigned(mem_addr) - RDISK_BASE;
                region_q <= R_RDISK;
                widx := to_integer(off(22 downto 2));
                if widx < RD_B0W then
                  bank_q <= 0;
                  rd0_idx_q <= widx;
                elsif widx < RD_B0W + RD_B1W then
                  bank_q <= 1;
                  rd1_idx_q <= widx - RD_B0W;
                elsif widx < RDISK_WORDS then
                  bank_q <= 2;
                  rd2_idx_q <= widx - RD_B0W - RD_B1W;
                end if;
              end if;
              if mem_we = '1' then
                wdata_q <= mem_wdata;
                wstrb_q <= mem_wstrb;
              end if;
              mstate_q <= M_READ;
            end if;
          when M_READ =>
            -- BRAM output registers load this cycle (write commits this cycle).
            ram0_we_q <= '0';
            ram1_we_q <= '0';
            ram2_we_q <= '0';
            mstate_q <= M_RESP;
          when M_RESP =>
            case region_q is
              when R_RAM =>
                case bank_q is
                  when 0 => mem_rdata <= ram0_q;
                  when 1 => mem_rdata <= ram1_q;
                  when 2 => mem_rdata <= ram2_q;
                end case;
              when R_RDISK =>
                case bank_q is
                  when 0 => mem_rdata <= rd0_q;
                  when 1 => mem_rdata <= rd1_q;
                  when 2 => mem_rdata <= rd2_q;
                end case;
              when R_NONE  => mem_rdata <= (others => '0');
            end case;
            mem_rvalid <= '1';
            rvalid_cnt_q <= rvalid_cnt_q + 1;
            mstate_q <= M_WAIT;
          when M_WAIT =>
            if mem_req = '0' then
              mstate_q <= M_IDLE;
            end if;
        end case;
      end if;
    end if;
  end process;

  -- --------------------------------------------------------------------------
  -- UART capture + marker matchers.
  -- --------------------------------------------------------------------------
  process(clk)
    variable lane : natural range 0 to 3;
    variable wi : natural;
  begin
    if rising_edge(clk) then
      -- Capture-buffer read port (observation).
      ubuf_q <= uartbuf(ubuf_raddr_q);

      if rst = '1' or (obs_pend2_q = '1' and obs_cmd_q(3 downto 0) = x"F"
                       and obs_cmd_q(31 downto 16) = x"5AFE") then
        uart_count_q <= (others => '0');
        pass_idx_q <= 1;
        fail_idx_q <= 1;
        pass_seen_q <= '0';
        fail_seen_q <= '0';
      elsif dbg_uart_valid = '1' then
        if uart_count_q < to_unsigned(UARTBUF_WORDS * 4, 32) then
          lane := to_integer(uart_count_q(1 downto 0));
          wi := to_integer(uart_count_q(31 downto 2));
          uartbuf(wi)(lane * 8 + 7 downto lane * 8) <= dbg_uart_byte;
        end if;
        uart_count_q <= uart_count_q + 1;
        -- Firmware final-pass matcher.
        if dbg_uart_byte = chr8(PASS_S(pass_idx_q)) then
          if pass_idx_q = PASS_S'length then
            pass_seen_q <= '1';
            pass_idx_q <= 1;
          else
            pass_idx_q <= pass_idx_q + 1;
          end if;
        elsif dbg_uart_byte = chr8(PASS_S(1)) then
          pass_idx_q <= 2;
        else
          pass_idx_q <= 1;
        end if;
        -- Firmware final-fail matcher.
        if dbg_uart_byte = chr8(FAIL_S(fail_idx_q)) then
          if fail_idx_q = FAIL_S'length then
            fail_seen_q <= '1';
            fail_idx_q <= 1;
          else
            fail_idx_q <= fail_idx_q + 1;
          end if;
        elsif dbg_uart_byte = chr8(FAIL_S(1)) then
          fail_idx_q <= 2;
        else
          fail_idx_q <= 1;
        end if;
      end if;
    end if;
  end process;

  -- --------------------------------------------------------------------------
  -- Observation command pipeline: cmd_valid -> (set buffer raddr) -> resp.
  -- --------------------------------------------------------------------------
  process(clk)
    variable bidx : natural;
  begin
    if rising_edge(clk) then
      cycle_cnt_q <= cycle_cnt_q + 1;
      if soft_cnt_q /= 0 then
        soft_cnt_q <= soft_cnt_q - 1;
      end if;
      obs_pend1_q <= '0';
      obs_pend2_q <= obs_pend1_q;
      if rst = '1' then
        obs_pend1_q <= '0';
        obs_pend2_q <= '0';
        soft_cnt_q <= (others => '0');
      elsif obs_cmd_valid = '1' then
        obs_cmd_q <= obs_cmd;
        obs_pend1_q <= '1';
        bidx := to_integer(unsigned(obs_cmd(31 downto 16)));
        if bidx < UARTBUF_WORDS then
          ubuf_raddr_q <= bidx;
        else
          ubuf_raddr_q <= 0;
        end if;
      elsif obs_pend2_q = '1' then
        -- ubuf_q now holds uartbuf[ubuf_raddr_q] (two clks after raddr set).
        obs_resp_q(63 downto 48) <= x"A55A";
        obs_resp_q(47 downto 32) <= obs_cmd_q(15 downto 0);
        case obs_cmd_q(3 downto 0) is
          when x"0" => obs_resp_q(31 downto 0) <= x"51F0B007";
          when x"1" => obs_resp_q(31 downto 0) <=
            pass_seen_q & fail_seen_q & (not core_rst) & '0' & x"1"
            & std_logic_vector(uart_count_q(23 downto 0));
          when x"2" => obs_resp_q(31 downto 0) <= dbg_pc;
          when x"3" => obs_resp_q(31 downto 0) <= ubuf_q;
          when x"4" => obs_resp_q(31 downto 0) <= dbg_ins;
          when x"5" => obs_resp_q(31 downto 0) <= dbg_sp;
          when x"6" => obs_resp_q(31 downto 0) <= dbg_ra;
          when x"7" => obs_resp_q(31 downto 0) <= std_logic_vector(cycle_cnt_q);
          when x"8" => obs_resp_q(31 downto 0) <= dbg_a0;
          when x"9" => obs_resp_q(31 downto 0) <= std_logic_vector(rvalid_cnt_q);
          when x"F" =>
            obs_resp_q(31 downto 0) <= x"0000F1F1";
            if obs_cmd_q(31 downto 16) = x"5AFE" then
              soft_cnt_q <= (others => '1');
            end if;
          when others => obs_resp_q(31 downto 0) <= (others => '0');
        end case;
      end if;
    end if;
  end process;
end architecture rtl;
