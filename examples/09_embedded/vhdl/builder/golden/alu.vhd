library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity alu is
    port (
        a : in signed(31 downto 0);
        b : in signed(31 downto 0);
        op : in unsigned(1 downto 0);
        result : out signed(31 downto 0);
        zero : out bit
    );
end entity alu;

architecture rtl of alu is
    signal alu_result : signed(31 downto 0);
begin
    alu_proc: process(a, b, op)
    begin
        if op = "00" then
            alu_result <= a + b;
        elsif op = "01" then
            alu_result <= a - b;
        elsif op = "10" then
            alu_result <= a and b;
        else
            alu_result <= a or b;
        end if;
    end process alu_proc;
    result <= alu_result;
    -- Zero flag: '1' when result is all zeros
    zero <= '1' when alu_result = 0 else '0';
end architecture rtl;
