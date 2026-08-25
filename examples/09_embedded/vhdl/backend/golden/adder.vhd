library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity adder is
    port (
        a : in signed(31 downto 0);
        b : in signed(31 downto 0);
        result_out : out signed(31 downto 0)
    );
end entity adder;

architecture rtl of adder is
    signal sum_sig : signed(31 downto 0);
begin
    -- Block BB0
    sum_sig <= a + b;
    result_out <= sum_sig;
end architecture rtl;
