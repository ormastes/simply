-- GHDL SoC-sim testbench: boot the FULL rv64 SimpleOS kernel on the
-- SYNTHESIZABLE rv64 soft-core (rv64_exec_core_axi) driven through an EXTERNAL
-- synchronous memory slave that INJECTS WAIT-STATES on every access.
--
-- The whole point of this lane: rv64_exec_core_flat proves the ISA behaviorally
-- with single-cycle combinational RAM; rv64_exec_core_axi must still boot when
-- memory is NOT single-cycle (as PS-DDR4 over an AXI master never is). The slave
-- here backs the same ~80 MB main RAM (rv64_flat.mem @ 0x80000000) and 1 MB
-- ramdisk bank (rv64_ramdisk.mem @ 0x88000000) as the flat core's internal
-- arrays, but answers each request only after N wait-states, with N VARYING per
-- access (1..4). If the core ever used a load result before rvalid, double-
-- advanced pc across a stall, or dropped a second beat of a straddling LD/SD,
-- the boot would diverge/hang.
--
-- The 80 MB backing store is a process VARIABLE (not a signal): a 10M x 64-bit
-- signal would create ~640M scalar nets and overflow GHDL mcode's net indexing.
-- The bus is 64-bit wide (the native rv64 word), 8-byte-aligned, with an 8-bit
-- write-strobe applied read-modify-write inside the slave.
--
-- The core's parallel debug UART tap (debug_uart_valid/debug_uart_byte) is used
-- to reconstruct the boot transcript, one byte per store to the UART THR.
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;
use std.textio.all;
use ieee.std_logic_textio.all;
use std.env.all;

entity tb_rv64_simpleos_boot_axi is
end entity tb_rv64_simpleos_boot_axi;

architecture sim of tb_rv64_simpleos_boot_axi is
  signal clk : std_logic := '0';
  signal rst : std_logic := '1';
  signal uart_tx : std_logic;
  signal debug_uart_valid : std_logic;
  signal debug_uart_byte  : std_logic_vector(7 downto 0);
  signal debug_pc    : std_logic_vector(63 downto 0);
  signal debug_ins   : std_logic_vector(31 downto 0);
  signal debug_a0    : std_logic_vector(63 downto 0);
  signal debug_ra    : std_logic_vector(63 downto 0);
  signal debug_sp    : std_logic_vector(63 downto 0);
  signal done : boolean := false;

  -- External synchronous memory interface (core master <-> tb slave), 64-bit.
  signal mem_req    : std_logic;
  signal mem_we     : std_logic;
  signal mem_addr   : std_logic_vector(63 downto 0);
  signal mem_wdata  : std_logic_vector(63 downto 0);
  signal mem_wstrb  : std_logic_vector(7 downto 0);
  signal mem_rdata  : std_logic_vector(63 downto 0) := (others => '0');
  signal mem_rvalid : std_logic := '0';

  -- Behavioral memory slave backing store (the GHDL stand-in for PS DDR).
  constant BASE_ADDR  : unsigned(63 downto 0) := x"0000000080000000";
  constant RAM_WORDS  : natural := 10000000;   -- 80 MiB, covers _kernel_end
  constant RDISK_BASE : unsigned(63 downto 0) := x"0000000088000000";
  constant RDISK_WORDS: natural := 131072;     -- 1 MiB
  type ram_t is array(0 to RAM_WORDS - 1) of std_logic_vector(63 downto 0);
  type rdisk_t is array(0 to RDISK_WORDS - 1) of std_logic_vector(63 downto 0);

  impure function init_ram return ram_t is
    file f : text open read_mode is "rv64_flat.mem";
    variable line_v : line;
    variable word_v : std_logic_vector(63 downto 0);
    variable mem_v : ram_t := (others => x"0000000000000000");
    variable idx : natural := 0;
  begin
    while not endfile(f) loop
      readline(f, line_v);
      hread(line_v, word_v);
      if idx < RAM_WORDS then
        mem_v(idx) := word_v;
      end if;
      idx := idx + 1;
    end loop;
    return mem_v;
  end function;

  impure function init_rdisk return rdisk_t is
    file f : text;
    variable fstatus : file_open_status;
    variable line_v : line;
    variable word_v : std_logic_vector(63 downto 0);
    variable mem_v : rdisk_t := (others => x"0000000000000000");
    variable idx : natural := 0;
  begin
    file_open(fstatus, f, "rv64_ramdisk.mem", read_mode);
    if fstatus /= open_ok then
      return mem_v;
    end if;
    while not endfile(f) loop
      readline(f, line_v);
      hread(line_v, word_v);
      if idx < RDISK_WORDS then
        mem_v(idx) := word_v;
      end if;
      idx := idx + 1;
    end loop;
    file_close(f);
    return mem_v;
  end function;
begin
  clk <= not clk after 5 ns;

  u_core : entity work.rv64_exec_core_axi
    generic map (CLK_FREQ => 1_000_000, BAUD_RATE => 115_200)
    port map (
      clk => clk, rst => rst, uart_tx => uart_tx,
      mem_req => mem_req, mem_we => mem_we, mem_addr => mem_addr,
      mem_wdata => mem_wdata, mem_wstrb => mem_wstrb,
      mem_rdata => mem_rdata, mem_rvalid => mem_rvalid,
      debug_uart_valid => debug_uart_valid, debug_uart_byte => debug_uart_byte,
      debug_pc => debug_pc, debug_ins => debug_ins, debug_a0 => debug_a0,
      debug_ra => debug_ra, debug_sp => debug_sp);

  process
  begin
    wait for 200 ns;
    rst <= '0';
    wait;
  end process;

  -- Latency-injecting synchronous memory slave. One transaction at a time:
  -- accept a request, wait N (1..4, varying) cycles, then pulse mem_rvalid for
  -- one cycle with registered read data (or apply a wstrb write). Requires the
  -- master to drop mem_req between transactions (the core does, >=1-cycle gap).
  -- The 80 MB / 1 MB arrays are process VARIABLES (see header).
  process(clk)
    variable ram   : ram_t := init_ram;
    variable rdisk : rdisk_t := init_rdisk;
    type slv_state_t is (SLV_IDLE, SLV_WAIT, SLV_RESP);
    variable slv_state  : slv_state_t := SLV_IDLE;
    variable wait_cnt   : natural := 0;
    variable lat_target : natural := 1;
    variable acc_idx    : natural := 0;
    variable a       : unsigned(63 downto 0);
    variable idx     : natural;
    variable rd_word : std_logic_vector(63 downto 0);
    variable wr_word : std_logic_vector(63 downto 0);
    variable in_ram_r  : boolean;
    variable in_rdsk_r : boolean;
  begin
    if rising_edge(clk) then
      mem_rvalid <= '0';
      if rst = '1' then
        slv_state := SLV_IDLE;
        wait_cnt := 0;
        acc_idx := 0;
        mem_rvalid <= '0';
      else
        case slv_state is
          when SLV_IDLE =>
            if mem_req = '1' then
              lat_target := 1 + (acc_idx mod 4);  -- vary wait-states 1..4
              acc_idx := acc_idx + 1;
              wait_cnt := 0;
              slv_state := SLV_WAIT;
            end if;
          when SLV_WAIT =>
            if wait_cnt >= lat_target - 1 then
              a := unsigned(mem_addr);
              in_ram_r := (a >= BASE_ADDR) and (a < BASE_ADDR + to_unsigned(RAM_WORDS * 8, 64));
              in_rdsk_r := (a >= RDISK_BASE) and (a < RDISK_BASE + to_unsigned(RDISK_WORDS * 8, 64));
              if in_ram_r then
                idx := to_integer((a - BASE_ADDR)) / 8;
                rd_word := ram(idx);
              elsif in_rdsk_r then
                idx := to_integer((a - RDISK_BASE)) / 8;
                rd_word := rdisk(idx);
              else
                idx := 0;
                rd_word := (others => '0');
              end if;
              if mem_we = '1' then
                -- Apply byte-enables (read-modify-write in the slave).
                wr_word := rd_word;
                for i in 0 to 7 loop
                  if mem_wstrb(i) = '1' then
                    wr_word(i * 8 + 7 downto i * 8) := mem_wdata(i * 8 + 7 downto i * 8);
                  end if;
                end loop;
                if in_ram_r then
                  ram(idx) := wr_word;
                elsif in_rdsk_r then
                  rdisk(idx) := wr_word;
                end if;
                mem_rdata <= (others => '0');
              else
                mem_rdata <= rd_word;
              end if;
              mem_rvalid <= '1';
              slv_state := SLV_RESP;
            else
              wait_cnt := wait_cnt + 1;
            end if;
          when SLV_RESP =>
            -- rvalid pulsed for one cycle above; wait for req to drop (>=1
            -- cycle idle gap) before accepting the next transaction.
            if mem_req = '0' then
              slv_state := SLV_IDLE;
            end if;
        end case;
      end if;
    end if;
  end process;

  -- Accumulate UART bytes into lines; report each completed line and stop on a
  -- terminal marker.
  process(clk)
    variable lbuf : string(1 to 256) := (others => ' ');
    variable llen : natural := 0;
    variable ch   : character;
  begin
    if rising_edge(clk) then
      if rst = '0' and debug_uart_valid = '1' then
        ch := character'val(to_integer(unsigned(debug_uart_byte)));
        if ch = LF then
          report "RV64_UART_LINE: " & lbuf(1 to llen) severity note;
          if llen >= 11 and lbuf(1 to 11) = "TEST FAILED" then
            report "RV64_BOOT_DONE reached=TEST_FAILED (honest FS-probe wall)" severity note;
            done <= true; stop;
          elsif llen >= 11 and lbuf(1 to 11) = "TEST PASSED" then
            report "RV64_BOOT_DONE reached=TEST_PASSED" severity note;
            done <= true; stop;
          end if;
          llen := 0;
        elsif ch /= CR then
          if llen < 256 then
            llen := llen + 1;
            lbuf(llen) := ch;
          end if;
        end if;
      end if;
    end if;
  end process;

  process
  begin
    -- Safety timeout only; a terminal marker (TEST PASSED/FAILED) stops earlier.
    -- Larger than the flat core's window: the stalled FSM plus injected
    -- wait-states run several times more cycles per instruction.
    wait for 3000 ms;
    if not done then
      report "RV64_BOOT_STUCK pc=0x" & to_hstring(debug_pc)
        & " ins=0x" & to_hstring(debug_ins)
        & " a0=0x" & to_hstring(debug_a0)
        & " ra=0x" & to_hstring(debug_ra)
        & " sp=0x" & to_hstring(debug_sp) severity note;
      report "RV64_BOOT_STUCK: no terminal marker within window" severity note;
      stop;
    end if;
    wait;
  end process;
end architecture sim;
