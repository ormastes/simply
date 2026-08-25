-- tb_rv32_payload.vhd  (Lane OO — NEW harness, does not modify any existing RTL)
--
-- Generic UART-capture testbench for the PROVEN rv32 exec core
-- (examples/09_embedded/fpga_riscv/rtl/rv32_exec_core.vhd). It instantiates the
-- read-only core UNMODIFIED and captures every byte the core emits on its
-- store-time debug UART strobe (debug_uart_valid / debug_uart_byte) rather than
-- serial-decoding uart_tx, so capture is baud-timing independent and exact.
--
-- The core's init_rom / init_data_rom functions open "rv32_payload.mem" and
-- "rv32_fat32.mem" by bare relative name, so both `ghdl -e` and `ghdl -r` MUST
-- be launched from a directory that holds those two files. This TB writes one
-- captured character per line to "uart_capture.txt" (fresh each run). Payloads
-- emit only printable ASCII plus the sentinel, and never a raw newline (0x0A),
-- so the driving shell reconstructs the exact string by deleting line breaks.
-- The sentinel byte 0x7E ('~') marks end-of-output: on receipt the TB reports
-- the elapsed core cycle count and stops. If the payload livelocks, GHDL's
-- --stop-time bound ends the run with no sentinel and the shell gate fails.
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;
use std.textio.all;
use std.env.all;

entity tb_rv32_payload is
end entity tb_rv32_payload;

architecture sim of tb_rv32_payload is
  signal clk : std_logic := '0';
  signal rst : std_logic := '1';
  signal uart_tx : std_logic;
  signal duv : std_logic;
  signal dub : std_logic_vector(7 downto 0);
  signal dpc : std_logic_vector(15 downto 0);
  signal dins : std_logic_vector(31 downto 0);
  signal da0 : std_logic_vector(7 downto 0);
  signal dra : std_logic_vector(15 downto 0);
  signal dsp : std_logic_vector(15 downto 0);
  signal dph : std_logic_vector(3 downto 0);
  signal cyc : natural := 0;
begin
  clk <= not clk after 5 ns;  -- 100 MHz simulated core clock

  dut : entity work.rv32_exec_core
    generic map (
      CLK_FREQ  => 100000000,
      BAUD_RATE => 115200
    )
    port map (
      clk => clk, rst => rst, uart_tx => uart_tx,
      debug_uart_valid => duv, debug_uart_byte => dub,
      debug_pc => dpc, debug_ins => dins, debug_a0 => da0,
      debug_ra => dra, debug_sp => dsp, debug_phase => dph
    );

  -- Reset release
  process
  begin
    wait for 200 ns;
    rst <= '0';
    wait;
  end process;

  -- Core cycle counter (post-reset)
  process(clk)
  begin
    if rising_edge(clk) then
      if rst = '0' then
        cyc <= cyc + 1;
      end if;
    end if;
  end process;

  -- UART byte capture on the store-time strobe
  process(clk)
    variable l : line;
    variable b : integer;
    file fout : text;
    variable fstat : file_open_status;
    variable first : boolean := true;
  begin
    if rising_edge(clk) then
      if rst = '0' and duv = '1' then
        b := to_integer(unsigned(dub));
        if first then
          file_open(fstat, fout, "uart_capture.txt", write_mode);
          first := false;
        else
          file_open(fstat, fout, "uart_capture.txt", append_mode);
        end if;
        write(l, character'val(b));
        writeline(fout, l);
        file_close(fout);
        if b = 126 then  -- '~' end-of-output sentinel
          report "PAYLOAD_CYCLES=" & integer'image(cyc) severity note;
          report "PAYLOAD_SENTINEL_SEEN" severity note;
          stop;
        end if;
      end if;
    end if;
  end process;
end architecture sim;
