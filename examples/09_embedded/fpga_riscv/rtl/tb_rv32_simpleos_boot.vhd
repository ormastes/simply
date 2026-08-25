-- GHDL SoC-sim testbench: boot the FULL rv32 SimpleOS kernel on the flat 16 MB
-- rv32 soft-core (rv32_exec_core_flat). The kernel image is loaded through the
-- core's init_ram path ("rv32_flat.mem", relative to the ghdl -r working dir);
-- scripts/fpga/ghdl_rv32_simpleos_boot.shs flattens the prebuilt kernel ELF.
--
-- The core's parallel debug UART tap (debug_uart_valid/debug_uart_byte) is used
-- instead of serial baud-decoding: one byte per store to the UART THR. Bytes
-- are accumulated into lines and reported so the boot transcript is visible.
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;
use std.env.all;

entity tb_rv32_simpleos_boot is
end entity tb_rv32_simpleos_boot;

architecture sim of tb_rv32_simpleos_boot is
  signal clk : std_logic := '0';
  signal rst : std_logic := '1';
  signal uart_tx : std_logic;
  signal debug_uart_valid : std_logic;
  signal debug_uart_byte  : std_logic_vector(7 downto 0);
  signal debug_pc    : std_logic_vector(31 downto 0);
  signal debug_ins   : std_logic_vector(31 downto 0);
  signal debug_a0    : std_logic_vector(31 downto 0);
  signal debug_ra    : std_logic_vector(31 downto 0);
  signal debug_sp    : std_logic_vector(31 downto 0);
  signal done : boolean := false;
begin
  clk <= not clk after 5 ns;

  u_core : entity work.rv32_exec_core_flat
    generic map (CLK_FREQ => 1_000_000, BAUD_RATE => 115_200)
    port map (
      clk => clk, rst => rst, uart_tx => uart_tx,
      debug_uart_valid => debug_uart_valid, debug_uart_byte => debug_uart_byte,
      debug_pc => debug_pc, debug_ins => debug_ins, debug_a0 => debug_a0,
      debug_ra => debug_ra, debug_sp => debug_sp);

  process
  begin
    wait for 200 ns;
    rst <= '0';
    wait;
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
          report "RV32_UART_LINE: " & lbuf(1 to llen) severity note;
          if llen >= 11 and lbuf(1 to 11) = "TEST FAILED" then
            report "RV32_BOOT_DONE reached=TEST_FAILED (honest FS-probe wall)" severity note;
            done <= true; stop;
          elsif llen >= 11 and lbuf(1 to 11) = "TEST PASSED" then
            report "RV32_BOOT_DONE reached=TEST_PASSED" severity note;
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
    -- Sized to give the ramdisk FS/ls/launch path headroom past the boot markers.
    wait for 200 ms;
    if not done then
      report "RV32_BOOT_STUCK pc=0x" & to_hstring(debug_pc)
        & " ins=0x" & to_hstring(debug_ins)
        & " a0=0x" & to_hstring(debug_a0)
        & " ra=0x" & to_hstring(debug_ra)
        & " sp=0x" & to_hstring(debug_sp) severity note;
      report "RV32_BOOT_STUCK: no terminal marker within window" severity note;
      stop;
    end if;
    wait;
  end process;
end architecture sim;
