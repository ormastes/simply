library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

package traffic_light_pkg is
    type state_t is (S_RED, S_GREEN, S_YELLOW);
    type light_t is record
    red : bit;
    yellow : bit;
    green : bit;
end record;
    constant MAX_COUNT : integer := 50000000;
end package traffic_light_pkg;

use work.traffic_light_pkg.all;
entity traffic_light is
    port (
        clk : in bit;
        rst : in bit;
        red : out bit;
        yellow : out bit;
        green : out bit
    );
end entity traffic_light;

use work.traffic_light_pkg.all;
architecture rtl of traffic_light is
    signal current_state : state_t := S_RED;
    signal next_state : state_t;
    signal timer : integer range 0 to MAX_COUNT := 0;
    signal timer_done : bit := '0';
begin
    state_reg: process(clk, rst)
    begin
        if rst = '1' then
            current_state <= S_RED;
            timer <= 0;
        elsif rising_edge(clk) then
            current_state <= next_state;
            if timer_done = '1' then
                timer <= 0;
            else
                timer <= timer + 1;
            end if;
        end if;
    end process state_reg;
    next_state_logic: process(current_state, timer_done)
    begin
        -- Default: stay in current state
        next_state <= current_state;
        if timer_done = '1' then
            -- State transitions
            if current_state = S_RED then
                next_state <= S_GREEN;
            elsif current_state = S_GREEN then
                next_state <= S_YELLOW;
            elsif current_state = S_YELLOW then
                next_state <= S_RED;
            end if;
        end if;
    end process next_state_logic;
    output_logic: process(current_state)
    begin
        -- Default outputs off
        red <= '0';
        yellow <= '0';
        green <= '0';
        if current_state = S_RED then
            red <= '1';
        elsif current_state = S_GREEN then
            green <= '1';
        elsif current_state = S_YELLOW then
            yellow <= '1';
        end if;
    end process output_logic;
end architecture rtl;

