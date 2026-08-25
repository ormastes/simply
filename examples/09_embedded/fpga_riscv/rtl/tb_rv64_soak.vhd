library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;
use std.env.all;

-- tb_rv64_soak — drives the Adler-32 hard-job soak payload (soak_rv64.s, built
-- by scripts/fpga/soak_rv64_hard_job.shs) on rv64_exec_core under GHDL and
-- decodes the UART TX line. It reports every emitted byte as
--   SOAK_BYTE=<decimal>
-- so the harness can reconstruct the 'P' progress markers and the final
--   DONE=XXXXXXXX~
-- Adler-32 golden, then compare against the host reference. Stops on the 0x7E
-- ('~') sentinel.
entity tb_rv64_soak is
end entity tb_rv64_soak;

architecture sim of tb_rv64_soak is
  signal clk : std_logic := '0';
  signal rst : std_logic := '1';
  signal uart_tx : std_logic;
  constant BIT_TIME : time := 8680 ns;
begin
  clk <= not clk after 5 ns;

  dut : entity work.soc_top_rv64_sim
    port map (clk => clk, rst => rst, uart_tx => uart_tx, uart_rx => '1');

  process
  begin
    wait for 200 ns;
    rst <= '0';
    wait;
  end process;

  process
    variable byte_value : integer := 0;
  begin
    wait until rst = '0';
    loop
      wait until uart_tx = '0';
      wait for BIT_TIME + BIT_TIME / 2;
      byte_value := 0;
      for bit_idx in 0 to 7 loop
        if uart_tx = '1' then
          byte_value := byte_value + (2 ** bit_idx);
        end if;
        wait for BIT_TIME;
      end loop;
      report "SOAK_BYTE=" & integer'image(byte_value) severity note;
      if byte_value = 126 then  -- '~' sentinel
        report "SOAK_SENTINEL_SEEN" severity note;
        stop;
      end if;
      if uart_tx = '0' then
        wait until uart_tx = '1';
      end if;
    end loop;
  end process;
end architecture sim;
