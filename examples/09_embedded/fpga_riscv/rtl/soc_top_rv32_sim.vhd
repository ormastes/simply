library ieee;
use ieee.std_logic_1164.all;

entity soc_top_rv32_sim is
  port (
    clk : in std_logic;
    rst : in std_logic;
    uart_tx : out std_logic;
    uart_rx : in std_logic
  );
end entity soc_top_rv32_sim;

architecture rtl of soc_top_rv32_sim is
  signal debug_uart_valid : std_logic;
  signal debug_uart_byte : std_logic_vector(7 downto 0);
  signal debug_pc : std_logic_vector(15 downto 0);
  signal debug_ins : std_logic_vector(31 downto 0);
  signal debug_a0 : std_logic_vector(7 downto 0);
  signal debug_ra : std_logic_vector(15 downto 0);
  signal debug_sp : std_logic_vector(15 downto 0);
  signal debug_phase : std_logic_vector(3 downto 0);
begin
  u_core : entity work.rv32_exec_core
    port map (
      clk => clk,
      rst => rst,
      uart_tx => uart_tx,
      debug_uart_valid => debug_uart_valid,
      debug_uart_byte => debug_uart_byte,
      debug_pc => debug_pc,
      debug_ins => debug_ins,
      debug_a0 => debug_a0,
      debug_ra => debug_ra,
      debug_sp => debug_sp,
      debug_phase => debug_phase
    );
end architecture rtl;
