library ieee;
use ieee.std_logic_1164.all;

-- soc_top_rv64_sim — GHDL/simulation wrapper for rv64_exec_core.
--
-- Mirrors soc_top_rv32_sim: exposes clk/rst directly (no Xilinx PS BD or
-- STARTUPE3 primitives, which raw GHDL cannot elaborate). The board variant is
-- soc_top_rv64.vhd (Zynq pl_clk0-clocked). The testbenches instantiate THIS
-- entity.
entity soc_top_rv64_sim is
  port (
    clk     : in  std_logic;
    rst     : in  std_logic;
    uart_tx : out std_logic;
    uart_rx : in  std_logic
  );
end entity soc_top_rv64_sim;

architecture rtl of soc_top_rv64_sim is
  signal debug_uart_valid : std_logic;
  signal debug_uart_byte  : std_logic_vector(7 downto 0);
begin
  u_core : entity work.rv64_exec_core
    port map (
      clk              => clk,
      rst              => rst,
      uart_tx          => uart_tx,
      debug_uart_valid => debug_uart_valid,
      debug_uart_byte  => debug_uart_byte
    );
end architecture rtl;
