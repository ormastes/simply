-- tb_rv32_nvme_bram_soc: GHDL rehearsal of the EXACT synthesizable BRAM SoC
-- (rv32_bram_soc: rv32_exec_core_axi + BRAM slave + UART capture + obs port)
-- running the Simple-generated NVMe self-test firmware, before burning a
-- Vivado run for KV260 silicon. Only the Vivado top's device primitives
-- (STARTUPE3 clocking, BSCANE2 USER4 shift logic) are outside this rehearsal;
-- the whole memory/init/capture/observation datapath is the real synth RTL.
--
-- The firmware is self-contained (no external NVMe device model): it runs the
-- NVMe hook-logic selftests and prints "ALL RV32 NVME FW CHECKS PASS" to the
-- 16550 THR at 0x10000000, which rv32_exec_core_axi decodes internally.
--
-- Pass criteria (all reported as timestamped notes):
--   RV32_NVMEBRAM_BOOT_DONE reached=NVME_FW_PASS -- live UART tap marker line
--   RV32_NVMEBRAM_OBS_MAGIC_OK                   -- obs port sane
--   RV32_NVMEBRAM_OBS_UART_MATCH bytes=<n>       -- capture buffer readback is
--                                                   byte-identical to the live
--                                                   UART transcript
-- NOTE: rv32_bram_soc's hardwired pass_seen matcher looks for "TEST PASSED",
-- which this firmware does not print; on silicon the verdict comes from the
-- transcript text read back over JTAG (read_rv32_tiny_bram_obs.shs transcript),
-- exactly as this tb greps the line from the UART tap. The status byte COUNT
-- is still meaningful and is reported.
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;
use std.env.all;

entity tb_rv32_nvme_bram_soc is
  generic (
    TINY_RAM_WORDS     : natural := 16384;
    TINY_RDISK_WORDS   : natural := 1024;
    TINY_UARTBUF_WORDS : natural := 2048
  );
end entity tb_rv32_nvme_bram_soc;

architecture sim of tb_rv32_nvme_bram_soc is
  signal clk : std_logic := '0';
  signal rst : std_logic := '1';
  signal uart_tx : std_logic;
  signal debug_uart_valid : std_logic;
  signal debug_uart_byte  : std_logic_vector(7 downto 0);
  signal debug_pc : std_logic_vector(31 downto 0);
  signal obs_cmd : std_logic_vector(31 downto 0) := (others => '0');
  signal obs_cmd_valid : std_logic := '0';
  signal obs_resp : std_logic_vector(63 downto 0);
  signal done : boolean := false;

  constant MARKER : string := "ALL RV32 NVME FW CHECKS PASS";

  -- Live transcript mirror (for byte-exact compare with the capture buffer).
  constant MIRROR_MAX : natural := 8192;
  type byte_arr_t is array (0 to MIRROR_MAX - 1) of std_logic_vector(7 downto 0);
  signal mirror : byte_arr_t := (others => (others => '0'));
  signal mirror_len : natural := 0;
begin
  -- 10 ns period like the sibling tbs; CLK_FREQ=1MHz below only shrinks the
  -- UART baud divisor so byte stalls are 8 cycles instead of 217.
  clk <= not clk after 5 ns;

  u_soc : entity work.rv32_bram_soc
    generic map (
      CLK_FREQ => 1_000_000, BAUD_RATE => 115_200,
      RAM_WORDS => TINY_RAM_WORDS, RDISK_WORDS => TINY_RDISK_WORDS,
      UARTBUF_WORDS => TINY_UARTBUF_WORDS,
      RAM_INIT_FILE => "rv32_flat.mem", RDISK_INIT_FILE => "rv32_ramdisk.mem")
    port map (
      clk => clk, rst => rst, uart_tx => uart_tx,
      obs_cmd => obs_cmd, obs_cmd_valid => obs_cmd_valid, obs_resp => obs_resp,
      debug_uart_valid => debug_uart_valid, debug_uart_byte => debug_uart_byte,
      debug_pc => debug_pc);

  process
  begin
    report "RV32_NVMEBRAM_BUDGET ram_bytes=" & integer'image(TINY_RAM_WORDS * 4)
      & " rdisk_bytes=" & integer'image(TINY_RDISK_WORDS * 4)
      & " uartbuf_bytes=" & integer'image(TINY_UARTBUF_WORDS * 4) severity note;
    wait for 2 us;
    rst <= '0';
    wait;
  end process;

  -- Accumulate UART bytes into lines; report each line; mark done on marker.
  process(clk)
    variable lbuf : string(1 to 256) := (others => ' ');
    variable llen : natural := 0;
    variable ch   : character;
  begin
    if rising_edge(clk) then
      if rst = '0' and debug_uart_valid = '1' then
        if mirror_len < MIRROR_MAX then
          mirror(mirror_len) <= debug_uart_byte;
          mirror_len <= mirror_len + 1;
        end if;
        ch := character'val(to_integer(unsigned(debug_uart_byte)));
        if ch = LF then
          report "RV32_NVMEBRAM_UART_LINE: " & lbuf(1 to llen) severity note;
          if llen = MARKER'length and lbuf(1 to MARKER'length) = MARKER then
            report "RV32_NVMEBRAM_BOOT_DONE reached=NVME_FW_PASS" severity note;
            done <= true;
          elsif llen = 4 and lbuf(1 to 4) = "FAIL" then
            report "RV32_NVMEBRAM_BOOT_DONE reached=NVME_FW_FAIL" severity note;
            done <= true;
          end if;
          llen := 0;
        elsif ch /= CR then
          if llen < 256 then
            llen := llen + 1;
            lbuf(llen) := ch;
          end if;
        end if;
      end if;
    end if;
  end process;

  -- Observation-port exercise once the firmware finished (or timeout).
  process
    procedure obs_do(cmd : in std_logic_vector(31 downto 0);
                     data : out std_logic_vector(31 downto 0)) is
    begin
      wait until rising_edge(clk);
      obs_cmd <= cmd;
      obs_cmd_valid <= '1';
      wait until rising_edge(clk);
      obs_cmd_valid <= '0';
      -- resp is registered 2 cycles after the valid pulse; wait 4 to be safe.
      for i in 1 to 4 loop wait until rising_edge(clk); end loop;
      assert obs_resp(63 downto 48) = x"A55A"
        report "RV32_NVMEBRAM_OBS_BAD_SIG resp=" & to_hstring(obs_resp) severity note;
      assert obs_resp(47 downto 32) = cmd(15 downto 0)
        report "RV32_NVMEBRAM_OBS_BAD_ECHO resp=" & to_hstring(obs_resp) severity note;
      data := obs_resp(31 downto 0);
    end procedure;
    variable d : std_logic_vector(31 downto 0);
    variable nbytes : natural;
    variable widx : natural;
    variable mism : natural;
    variable cmdv : std_logic_vector(31 downto 0);
  begin
    wait until done for 400 ms;
    if not done then
      report "RV32_NVMEBRAM_BOOT_STUCK pc=0x" & to_hstring(debug_pc) severity note;
    end if;
    -- settle: let the final UART bytes drain into the capture buffer
    for i in 1 to 200 loop wait until rising_edge(clk); end loop;

    obs_do(x"00000000", d);
    if d = x"51F0B007" then
      report "RV32_NVMEBRAM_OBS_MAGIC_OK" severity note;
    else
      report "RV32_NVMEBRAM_OBS_MAGIC_BAD data=" & to_hstring(d) severity note;
    end if;

    obs_do(x"00000001", d);
    report "RV32_NVMEBRAM_OBS_STATUS pass=" & std_logic'image(d(31))
      & " fail=" & std_logic'image(d(30))
      & " count=" & integer'image(to_integer(unsigned(d(23 downto 0)))) severity note;
    nbytes := to_integer(unsigned(d(23 downto 0)));
    if nbytes > TINY_UARTBUF_WORDS * 4 then
      nbytes := TINY_UARTBUF_WORDS * 4;
    end if;

    -- Read the whole capture buffer back through the obs port and compare with
    -- the live-tap mirror byte for byte.
    mism := 0;
    widx := 0;
    while widx * 4 < nbytes loop
      cmdv := std_logic_vector(to_unsigned(widx, 16)) & x"0003";
      obs_do(cmdv, d);
      for lane in 0 to 3 loop
        if widx * 4 + lane < nbytes and widx * 4 + lane < mirror_len then
          if d(lane * 8 + 7 downto lane * 8) /= mirror(widx * 4 + lane) then
            mism := mism + 1;
          end if;
        end if;
      end loop;
      widx := widx + 1;
    end loop;
    if mism = 0 and nbytes > 0 then
      report "RV32_NVMEBRAM_OBS_UART_MATCH bytes=" & integer'image(nbytes) severity note;
    else
      report "RV32_NVMEBRAM_OBS_UART_MISMATCH bytes=" & integer'image(nbytes)
        & " mismatches=" & integer'image(mism) severity note;
    end if;
    stop;
  end process;
end architecture sim;
