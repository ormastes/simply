library ieee;
use ieee.std_logic_1164.all;
use std.env.all;

entity tb_rv64_wb_soc_smoke is
end entity tb_rv64_wb_soc_smoke;

architecture sim of tb_rv64_wb_soc_smoke is
  signal clk : std_logic := '0';
  signal rst : std_logic := '1';
  signal uart_tx : std_logic;
  signal tx_seen : std_logic := '0';
  signal byte_seen : std_logic := '0';
  signal marker_seen : std_logic := '0';
  constant MARKER : string := "SimpleOS RV64 FPGA";
  signal marker_idx : natural range 1 to MARKER'length + 1 := 1;
  signal last_tx : std_logic := '1';
  constant BIT_TIME : time := 8680 ns;
begin
  clk <= not clk after 5 ns;

  -- soc_top_rv64_sim is the GHDL-elaboratable wrapper (clk/rst exposed); the
  -- board top soc_top_rv64.vhd is Zynq-PS-clocked and cannot elaborate under
  -- raw GHDL. Same board/sim split as tb_rv32_wb_soc_smoke -> soc_top_rv32_sim.
  dut : entity work.soc_top_rv64_sim
    port map (
      clk => clk,
      rst => rst,
      uart_tx => uart_tx,
      uart_rx => '1'
    );

  process
  begin
    wait for 200 ns;
    rst <= '0';
    wait for 5 ms;
    assert tx_seen = '1' report "RV64_UART_TX_ACTIVITY_MISSING" severity failure;
    assert byte_seen = '1' report "RV64_UART_BYTE_MISSING" severity failure;
    assert marker_seen = '1' report "RV64_UART_MARKER_MISSING" severity failure;
    report "RV64_UART_TX_ACTIVITY_SEEN" severity note;
    report "RV64_UART_BYTE_SEEN" severity note;
    report "RV64_UART_MARKER_SEEN" severity note;
    wait;
  end process;

  process(clk)
  begin
    if rising_edge(clk) then
      if last_tx = '1' and uart_tx = '0' then
        tx_seen <= '1';
      end if;
      last_tx <= uart_tx;
    end if;
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
      byte_seen <= '1';
      report "RV64_UART_BYTE_VALUE=" & integer'image(byte_value) severity note;
      if marker_idx <= MARKER'length and byte_value = character'pos(MARKER(marker_idx)) then
        if marker_idx = MARKER'length then
          marker_seen <= '1';
          report "RV64_UART_TX_ACTIVITY_SEEN" severity note;
          report "RV64_UART_BYTE_SEEN" severity note;
          report "RV64_UART_MARKER_SEEN" severity note;
          stop;
        else
          marker_idx <= marker_idx + 1;
        end if;
      elsif byte_value = character'pos(MARKER(1)) then
        marker_idx <= 2;
      else
        marker_idx <= 1;
      end if;
      report "RV64_UART_BYTE_SEEN" severity note;

      if uart_tx = '0' then
        wait until uart_tx = '1';
      end if;
    end loop;
  end process;
end architecture sim;
