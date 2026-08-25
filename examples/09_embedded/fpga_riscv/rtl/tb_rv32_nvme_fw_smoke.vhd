-- GHDL SoC-sim testbench: run the minimal NVMe self-test firmware on the real
-- rv32 soft-core (rv32_exec_core) and check for the same determinate result the
-- QEMU gate checks (the UART marker "ALL RV32 NVME FW CHECKS PASS").
--
-- Firmware is loaded through the core's init_rom path: the core opens
-- "rv32_payload.mem" (relative to the ghdl -r working directory). The driver
-- script scripts/fpga/ghdl_rv32_nvme_fw.shs relinks the gate's firmware object
-- with examples/09_embedded/fpga_riscv/rtl/nvme_fw_rv32_bram.ld (single 64 KB
-- BRAM window, no aliasing) and drops the flat image in as rv32_payload.mem.
--
-- The core's parallel debug UART tap (debug_uart_valid/debug_uart_byte) is used
-- instead of serial baud-decoding: one byte per store to the UART THR.
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;
use std.env.all;

entity tb_rv32_nvme_fw_smoke is
  generic (TIMEOUT_US : positive := 15000);
end entity tb_rv32_nvme_fw_smoke;

architecture sim of tb_rv32_nvme_fw_smoke is
  signal clk : std_logic := '0';
  signal rst : std_logic := '1';
  signal uart_tx : std_logic;
  signal debug_uart_valid : std_logic;
  signal debug_uart_byte  : std_logic_vector(7 downto 0);
  signal debug_pc    : std_logic_vector(15 downto 0);
  signal debug_ins   : std_logic_vector(31 downto 0);
  signal debug_a0    : std_logic_vector(7 downto 0);
  signal debug_ra    : std_logic_vector(15 downto 0);
  signal debug_sp    : std_logic_vector(15 downto 0);
  signal debug_phase : std_logic_vector(3 downto 0);

  constant MARKER : string := "ALL RV32 NVME FW CHECKS PASS";
  signal done : boolean := false;
begin
  clk <= not clk after 5 ns;

  -- Small CLK_FREQ shrinks the internal UART baud divisor (BAUD_DIV = CLK/BAUD)
  -- so the serial shift between bytes is fast in sim. The debug tap is unaffected.
  u_core : entity work.rv32_exec_core
    generic map (CLK_FREQ => 1_000_000, BAUD_RATE => 115_200)
    port map (
      clk => clk, rst => rst, uart_tx => uart_tx,
      debug_uart_valid => debug_uart_valid, debug_uart_byte => debug_uart_byte,
      debug_pc => debug_pc, debug_ins => debug_ins, debug_a0 => debug_a0,
      debug_ra => debug_ra, debug_sp => debug_sp, debug_phase => debug_phase);

  -- Release reset.
  process
  begin
    wait for 200 ns;
    rst <= '0';
    wait;
  end process;

  -- Accumulate UART bytes; match the PASS marker and the FAIL sentinel.
  process(clk)
    variable win  : string(1 to MARKER'length) := (others => ' ');
    variable fwin : string(1 to 4) := (others => ' ');
    variable ch   : character;
    variable ncols : natural := 0;
  begin
    if rising_edge(clk) then
      if rst = '0' and debug_uart_valid = '1' then
        ch := character'val(to_integer(unsigned(debug_uart_byte)));
        report "RV32_NVME_FW_BYTE=" & integer'image(to_integer(unsigned(debug_uart_byte)))
          & " '" & ch & "'" severity note;
        -- shift-in for the PASS window
        win := win(2 to MARKER'length) & ch;
        fwin := fwin(2 to 4) & ch;
        ncols := ncols + 1;
        if win = MARKER then
          report "RV32_NVME_FW_MARKER_SEEN: " & MARKER severity note;
          report "RV32_NVME_FW_PASS" severity note;
          done <= true;
          stop;
        elsif fwin = "FAIL" then
          report "RV32_NVME_FW_FAIL_MARKER" severity note;
        end if;
      end if;
    end if;
  end process;

  -- Timeout guard: firmware must reach the marker well within this window.
  -- Full-word SECDED, retry/remap, and queue-boundary checks complete at
  -- 10.897245 ms on this core. Keep a finite 15 ms bound with measured margin.
  process
  begin
    wait for TIMEOUT_US * 1 us;
    if not done then
      report "RV32_NVME_FW_STUCK pc=0x" & to_hstring(debug_pc)
        & " ins=0x" & to_hstring(debug_ins)
        & " a0=0x" & to_hstring(debug_a0)
        & " ra=0x" & to_hstring(debug_ra)
        & " sp=0x" & to_hstring(debug_sp)
        & " phase=0x" & to_hstring(debug_phase) severity note;
      report "RV32_NVME_FW_TIMEOUT: marker not seen (fw hung or UART stalled)"
        severity failure;
    end if;
    wait;
  end process;
end architecture sim;
