-- Bounded loop example emitted by the planned VHDL backend.
-- Demonstrates:
--  * Compile-time-constant loop bound (generic N)
--  * Elaboration-time assertions enforcing limits (N <= MAX_N)
--  * Width-safe accumulation using numeric_std
--  * No unsynthesizable constructs (no wait, no textio, no unbounded loops)

library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity bounded_sum is
  generic (
    N      : positive := 8;          -- compile-time loop trip count
    MAX_N  : positive := 1024;       -- build-time cap enforced by backend
    DATA_W : positive := 16
  );
  port (
    clk     : in  std_logic;
    rst     : in  std_logic;
    in_vec  : in  std_logic_vector(N*DATA_W-1 downto 0);
    sum_out : out std_logic_vector(DATA_W + integer(ceil(log2(real(N))))-1 downto 0)
  );
end entity bounded_sum;

architecture rtl of bounded_sum is
  -- Calculate required accumulator width: DATA_W + ceil(log2(N))
  constant SUM_W : natural := DATA_W + integer(ceil(log2(real(N))));
  signal acc_q   : unsigned(SUM_W-1 downto 0) := (others => '0');
begin

  -- Elaboration-time checks (backend will translate invariants to asserts)
  assert N <= MAX_N
    report "N exceeds MAX_N cap; adjust generics or backend limits"
    severity failure;
  assert N > 0
    report "N must be positive"
    severity failure;

  process(clk)
    variable acc_d : unsigned(SUM_W-1 downto 0);
  begin
    if rising_edge(clk) then
      if rst = '1' then
        acc_q <= (others => '0');
      else
        acc_d := (others => '0');
        -- Static for-loop: bound known at elaboration (N generic)
        for i in 0 to N-1 loop
          -- Slice each element; backend enforces width on resize
          acc_d := acc_d + resize(
            unsigned(in_vec((i+1)*DATA_W-1 downto i*DATA_W)),
            SUM_W
          );
        end loop;
        acc_q <= acc_d;
      end if;
    end if;
  end process;

  sum_out <= std_logic_vector(acc_q);

end architecture rtl;
