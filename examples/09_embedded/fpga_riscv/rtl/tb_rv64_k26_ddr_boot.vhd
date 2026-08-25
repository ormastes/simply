-- tb_rv64_k26_ddr_boot: pre-silicon rehearsal of the EXACT KV260 bring-up path
-- for the rv64 soft-core. Direct 64-bit mirror of tb_rv32_k26_ddr_boot.
--
-- Drives soc_top_rv64_k26_ddr -- the real PL top that gets synthesized -- so it
-- exercises the two pieces that only exist on silicon:
--
--   1. rv64_axi4_mem_adapter, turning the 64-bit mem_* port into full AXI4
--      (AW/W/B/AR/R) and REMAPPING core 0x80200000/0x88000000 into the DDR
--      aperture, because on ZynqMP 0x80000000+ is not memory. The AXI4 slave
--      model here backs DDR at G_DDR_BASE, and the boot only works if the
--      remap is right.
--   2. rv32_ctrl_obs_slave (reused unchanged), the AXI4-Lite control /
--      observation path. The transcript below is recovered the SAME way the
--      board flow recovers it: poll UART_COUNT, then read the capture buffer
--      over AXI-Lite. Nothing is tapped from inside the DUT.
--
-- The AXI slave injects varying wait-states on both channels so the adapter is
-- never tested against an unrealistically prompt memory.
--
-- .bss ZEROING: exactly like the board flow (bringup_kv260_rv64_ddr.shs step
-- 5b), init_ram zeroes the kernel's .bss span AFTER loading the image. Real
-- power-up DDR4 is garbage; the kernel assumes zero .bss (g_heap_off at
-- 0x80208008 -- garbage there makes every allocation fail: the rv32 lane's
-- canary-only park). Run with G_GARBAGE_FILL=true to prove the zeroed span is
-- COMPLETE for rv64: the boot must still pass when everything the board does
-- not load or zero is trash.
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;
use std.textio.all;
use ieee.std_logic_textio.all;
use std.env.all;

entity tb_rv64_k26_ddr_boot is
  generic (
    -- Real PS DDR4 is NOT zeroed at power-up; GHDL hands out pristine zero
    -- arrays, which masks any reliance on implicit zero-initialised memory
    -- beyond the .bss span the bring-up explicitly zeroes. Set true to fill
    -- all DDR words beyond the loaded kernel image with deterministic nonzero
    -- pseudo-random garbage, rehearsing what silicon actually provides.
    G_GARBAGE_FILL : boolean := false;
    -- Skip the tb's board-step-5b .bss zeroing. Combined with
    -- G_GARBAGE_FILL=true this hands the kernel garbage .bss — the run
    -- passing then proves the kernel's own crt0 .bss-zero loop works with
    -- ZERO loader cooperation (board-runnable rule). Default false keeps the
    -- historical board-flow rehearsal unchanged.
    G_SKIP_BSS_ZERO : boolean := false
  );
end entity tb_rv64_k26_ddr_boot;

architecture sim of tb_rv64_k26_ddr_boot is
  constant DDR_BASE   : unsigned(31 downto 0) := x"10000000";
  constant RDISK_OFF  : unsigned(31 downto 0) := x"08000000";
  -- 80 MiB of 64-bit words: covers the kernel span core 0x80200000..0x84A20000
  -- (.text .. .heap end, ~74 MB behind the 2 MB front pad).
  constant RAM_WORDS  : natural := 10485760;
  constant RDISK_WORDS: natural := 131072;    -- 1 MiB
  -- .bss span from llvm-readelf on simpleos_riscv64_smf_fs.elf:
  -- core 0x80205000 size 0x1A004 -> DDR offset 0x205000, zeroed in 27 pages
  -- (0x1B000 bytes) exactly like the board's bss_zeros.bin dow. The 0xFFC
  -- spill past .bss lands in .stack, which needs no preserved content.
  constant BSS_W0     : natural := 16#205000# / 8;
  constant BSS_WORDS  : natural := 16#01B000# / 8;

  signal clk   : std_logic := '0';
  signal rst_n : std_logic := '0';
  signal uart_tx : std_logic;
  signal done : boolean := false;

  -- AXI4 (core master -> DDR model), 64-bit data
  signal awaddr  : std_logic_vector(31 downto 0);
  signal awlen   : std_logic_vector(7 downto 0);
  signal awsize  : std_logic_vector(2 downto 0);
  signal awburst : std_logic_vector(1 downto 0);
  signal awcache : std_logic_vector(3 downto 0);
  signal awprot  : std_logic_vector(2 downto 0);
  signal awvalid : std_logic;
  signal awready : std_logic := '0';
  signal wdata   : std_logic_vector(63 downto 0);
  signal wstrb   : std_logic_vector(7 downto 0);
  signal wlast   : std_logic;
  signal wvalid  : std_logic;
  signal wready  : std_logic := '0';
  signal bresp   : std_logic_vector(1 downto 0) := "00";
  signal bvalid  : std_logic := '0';
  signal bready  : std_logic;
  signal araddr  : std_logic_vector(31 downto 0);
  signal arlen   : std_logic_vector(7 downto 0);
  signal arsize  : std_logic_vector(2 downto 0);
  signal arburst : std_logic_vector(1 downto 0);
  signal arcache : std_logic_vector(3 downto 0);
  signal arprot  : std_logic_vector(2 downto 0);
  signal arvalid : std_logic;
  signal arready : std_logic := '0';
  signal rdata   : std_logic_vector(63 downto 0) := (others => '0');
  signal rresp   : std_logic_vector(1 downto 0) := "00";
  signal rlast   : std_logic := '0';
  signal rvalid  : std_logic := '0';
  signal rready  : std_logic;

  -- AXI4-Lite (testbench master -> control/observation slave)
  signal l_awaddr  : std_logic_vector(15 downto 0) := (others => '0');
  signal l_awvalid : std_logic := '0';
  signal l_awready : std_logic;
  signal l_wdata   : std_logic_vector(31 downto 0) := (others => '0');
  signal l_wvalid  : std_logic := '0';
  signal l_wready  : std_logic;
  signal l_bvalid  : std_logic;
  signal l_bready  : std_logic := '0';
  signal l_araddr  : std_logic_vector(15 downto 0) := (others => '0');
  signal l_arvalid : std_logic := '0';
  signal l_arready : std_logic;
  signal l_rdata   : std_logic_vector(31 downto 0);
  signal l_rvalid  : std_logic;
  signal l_rready  : std_logic := '0';
  signal l_bresp, l_rresp : std_logic_vector(1 downto 0);

  type ram_t is array(0 to RAM_WORDS - 1) of std_logic_vector(63 downto 0);
  type rdisk_t is array(0 to RDISK_WORDS - 1) of std_logic_vector(63 downto 0);

  impure function init_ram return ram_t is
    file f : text open read_mode is "rv64_flat.mem";
    variable line_v : line;
    variable word_v : std_logic_vector(63 downto 0);
    variable mem_v : ram_t := (others => (others => '0'));
    variable idx : natural := 0;
    variable lfsr : unsigned(63 downto 0) := x"DEADBEEFCAFEF00D";
  begin
    if G_GARBAGE_FILL then
      -- xorshift64: deterministic nonzero garbage in every word, standing in
      -- for un-zeroed power-up DDR4 content. The kernel image is loaded OVER
      -- this below and .bss is then zeroed exactly as the board flow does, so
      -- stack/heap/unused DDR stay garbage -- the silicon situation.
      for i in 0 to RAM_WORDS - 1 loop
        lfsr := lfsr xor shift_left(lfsr, 13);
        lfsr := lfsr xor shift_right(lfsr, 7);
        lfsr := lfsr xor shift_left(lfsr, 17);
        mem_v(i) := std_logic_vector(lfsr);
      end loop;
    end if;
    while not endfile(f) loop
      readline(f, line_v);
      hread(line_v, word_v);
      if idx < RAM_WORDS then mem_v(idx) := word_v; end if;
      idx := idx + 1;
    end loop;
    -- Board step 5b: zero .bss (belt-and-suspenders; the kernel now also
    -- self-zeroes .bss in _start). G_SKIP_BSS_ZERO=true disables this to
    -- prove the kernel's crt0 loop alone suffices under garbage DDR.
    if not G_SKIP_BSS_ZERO then
      for i in BSS_W0 to BSS_W0 + BSS_WORDS - 1 loop
        mem_v(i) := (others => '0');
      end loop;
    end if;
    return mem_v;
  end function;

  impure function init_rdisk return rdisk_t is
    file f : text;
    variable fstatus : file_open_status;
    variable line_v : line;
    variable word_v : std_logic_vector(63 downto 0);
    variable mem_v : rdisk_t := (others => (others => '0'));
    variable idx : natural := 0;
  begin
    file_open(fstatus, f, "rv64_ramdisk.mem", read_mode);
    if fstatus /= open_ok then return mem_v; end if;
    while not endfile(f) loop
      readline(f, line_v);
      hread(line_v, word_v);
      if idx < RDISK_WORDS then mem_v(idx) := word_v; end if;
      idx := idx + 1;
    end loop;
    file_close(f);
    return mem_v;
  end function;

  -- ram/rdisk are PROCESS VARIABLES, not signals: a 10 Mi-word GHDL signal
  -- array carries per-element driver/event machinery (tens of GB of host RSS);
  -- as variables the same backing store is well under 1 GB.
begin
  clk <= not clk after 10 ns when not done else '0';  -- 50 MHz, matching G_CLK_FREQ

  dut : entity work.soc_top_rv64_k26_ddr
    generic map (G_CLK_FREQ => 50000000, G_BAUD_RATE => 115200,
                 G_CORE_BASE => x"80000000", G_DDR_BASE => DDR_BASE)
    port map (
      clk => clk, rst_n => rst_n, uart_tx => uart_tx,
      m_axi_hp_awaddr => awaddr, m_axi_hp_awlen => awlen,
      m_axi_hp_awsize => awsize, m_axi_hp_awburst => awburst,
      m_axi_hp_awcache => awcache, m_axi_hp_awprot => awprot,
      m_axi_hp_awvalid => awvalid, m_axi_hp_awready => awready,
      m_axi_hp_wdata => wdata, m_axi_hp_wstrb => wstrb,
      m_axi_hp_wlast => wlast, m_axi_hp_wvalid => wvalid,
      m_axi_hp_wready => wready,
      m_axi_hp_bresp => bresp, m_axi_hp_bvalid => bvalid,
      m_axi_hp_bready => bready,
      m_axi_hp_araddr => araddr, m_axi_hp_arlen => arlen,
      m_axi_hp_arsize => arsize, m_axi_hp_arburst => arburst,
      m_axi_hp_arcache => arcache, m_axi_hp_arprot => arprot,
      m_axi_hp_arvalid => arvalid, m_axi_hp_arready => arready,
      m_axi_hp_rdata => rdata, m_axi_hp_rresp => rresp,
      m_axi_hp_rlast => rlast, m_axi_hp_rvalid => rvalid,
      m_axi_hp_rready => rready,
      s_axi_ctrl_awaddr => l_awaddr, s_axi_ctrl_awprot => "000",
      s_axi_ctrl_awvalid => l_awvalid, s_axi_ctrl_awready => l_awready,
      s_axi_ctrl_wdata => l_wdata, s_axi_ctrl_wstrb => "1111",
      s_axi_ctrl_wvalid => l_wvalid, s_axi_ctrl_wready => l_wready,
      s_axi_ctrl_bresp => l_bresp, s_axi_ctrl_bvalid => l_bvalid,
      s_axi_ctrl_bready => l_bready,
      s_axi_ctrl_araddr => l_araddr, s_axi_ctrl_arprot => "000",
      s_axi_ctrl_arvalid => l_arvalid, s_axi_ctrl_arready => l_arready,
      s_axi_ctrl_rdata => l_rdata, s_axi_ctrl_rresp => l_rresp,
      s_axi_ctrl_rvalid => l_rvalid, s_axi_ctrl_rready => l_rready);

  -- ---------------------------------------------------------------------
  -- AXI4 DDR slave model (64-bit) with varying wait-states.
  -- ---------------------------------------------------------------------
  ddr_slave : process(clk)
    variable wait_n   : natural := 0;
    variable phase    : natural := 0;   -- 0 idle, 1 read wait, 2 write wait
    variable addr_v   : unsigned(31 downto 0);
    variable widx     : natural;
    variable is_rdisk : boolean;
    variable jitter   : natural := 1;
    variable old_w    : std_logic_vector(63 downto 0);
    variable saved_addr : unsigned(31 downto 0);
    variable ram   : ram_t := init_ram;
    variable rdisk : rdisk_t := init_rdisk;
  begin
    if rising_edge(clk) then
      if rst_n = '0' then
        arready <= '0'; rvalid <= '0'; rlast <= '0';
        awready <= '0'; wready <= '0'; bvalid <= '0';
        phase := 0; jitter := 1;
      else
        -- default deasserts for one-shot handshakes
        if rvalid = '1' and rready = '1' then rvalid <= '0'; rlast <= '0'; end if;
        if bvalid = '1' and bready = '1' then bvalid <= '0'; end if;
        arready <= '0';
        awready <= '0';
        wready  <= '0';

        case phase is
          when 0 =>
            if arvalid = '1' then
              arready <= '1';
              saved_addr := unsigned(araddr);
              jitter := (jitter mod 4) + 1;
              wait_n := jitter;
              phase := 1;
            elsif awvalid = '1' and wvalid = '1' then
              awready <= '1';
              wready  <= '1';
              saved_addr := unsigned(awaddr);
              -- capture write immediately
              addr_v := saved_addr;
              is_rdisk := addr_v >= (DDR_BASE + RDISK_OFF);
              if is_rdisk then
                widx := to_integer((addr_v - (DDR_BASE + RDISK_OFF)) / 8);
                if widx < RDISK_WORDS then
                  old_w := rdisk(widx);
                  for b in 0 to 7 loop
                    if wstrb(b) = '1' then
                      old_w(8*b+7 downto 8*b) := wdata(8*b+7 downto 8*b);
                    end if;
                  end loop;
                  rdisk(widx) := old_w;
                end if;
              else
                widx := to_integer((addr_v - DDR_BASE) / 8);
                if widx < RAM_WORDS then
                  old_w := ram(widx);
                  for b in 0 to 7 loop
                    if wstrb(b) = '1' then
                      old_w(8*b+7 downto 8*b) := wdata(8*b+7 downto 8*b);
                    end if;
                  end loop;
                  ram(widx) := old_w;
                end if;
              end if;
              jitter := (jitter mod 4) + 1;
              wait_n := jitter;
              phase := 2;
            end if;

          when 1 =>
            if wait_n > 0 then
              wait_n := wait_n - 1;
            elsif rvalid = '0' then
              addr_v := saved_addr;
              is_rdisk := addr_v >= (DDR_BASE + RDISK_OFF);
              if is_rdisk then
                widx := to_integer((addr_v - (DDR_BASE + RDISK_OFF)) / 8);
                if widx < RDISK_WORDS then rdata <= rdisk(widx);
                else rdata <= (others => '0'); end if;
              else
                widx := to_integer((addr_v - DDR_BASE) / 8);
                if widx < RAM_WORDS then rdata <= ram(widx);
                else rdata <= (others => '0'); end if;
              end if;
              rvalid <= '1';
              rlast  <= '1';
              phase  := 0;
            end if;

          when others =>
            if wait_n > 0 then
              wait_n := wait_n - 1;
            elsif bvalid = '0' then
              bvalid <= '1';
              phase  := 0;
            end if;
        end case;
      end if;
    end if;
  end process;

  -- ---------------------------------------------------------------------
  -- Control sequence: exactly what xsdb does on the board.
  -- ---------------------------------------------------------------------
  ctrl : process
    variable txt : line;
    variable rd  : std_logic_vector(31 downto 0);
    variable count, shown : natural := 0;
    variable w : std_logic_vector(31 downto 0);
    variable ch : character;
    variable byte_v : natural;
    variable stall_iters : natural := 0;
    variable last_count : natural := 0;
    -- Rolling match on the terminal marker so the run ends on SUCCESS rather
    -- than on a guessed timeout.
    constant MARKER : string := "TEST PASSED";
    variable mi : natural := 0;
    variable matched : boolean := false;

    procedure lite_read(addr : in std_logic_vector(15 downto 0);
                        res : out std_logic_vector(31 downto 0)) is
    begin
      wait until rising_edge(clk);
      l_araddr  <= addr;
      l_arvalid <= '1';
      l_rready  <= '1';
      loop
        wait until rising_edge(clk);
        exit when l_arready = '1';
      end loop;
      l_arvalid <= '0';
      loop
        wait until rising_edge(clk);
        exit when l_rvalid = '1';
      end loop;
      res := l_rdata;
      l_rready <= '0';
    end procedure;

    procedure lite_write(addr : in std_logic_vector(15 downto 0);
                         dat : in std_logic_vector(31 downto 0)) is
    begin
      wait until rising_edge(clk);
      l_awaddr  <= addr;
      l_awvalid <= '1';
      loop
        wait until rising_edge(clk);
        exit when l_awready = '1';
      end loop;
      l_awvalid <= '0';
      l_wdata   <= dat;
      l_wvalid  <= '1';
      loop
        wait until rising_edge(clk);
        exit when l_wready = '1';
      end loop;
      l_wvalid <= '0';
      -- BVALID is asserted at WREADY time and held only until BREADY: with
      -- BREADY pre-asserted it is a single-cycle pulse landing on the exact
      -- edge the WREADY loop exits on, so waiting one more edge missed it
      -- forever (the original rv32 tb hang). Assert BREADY only now, after the
      -- W handshake -- the slave holds BVALID until it sees BREADY, so the
      -- handshake below cannot be missed.
      l_bready <= '1';
      loop
        wait until rising_edge(clk);
        exit when l_bvalid = '1';
      end loop;
      l_bready <= '0';
    end procedure;
  begin
    rst_n <= '0';
    wait for 200 ns;
    wait until rising_edge(clk);
    rst_n <= '1';
    wait for 100 ns;

    -- 1. MAGIC check -- proves the PL is configured and the slave is mapped.
    --    (Reused rv32_ctrl_obs_slave: MAGIC deliberately still reads "RV32".)
    lite_read(x"0024", rd);
    write(txt, string'("K26_MAGIC=0x"));
    hwrite(txt, rd);
    writeline(output, txt);
    assert rd = x"52563332"
      report "K26_MAGIC_MISMATCH: control slave not reachable" severity failure;

    -- 2. Core must still be held in reset before we release it.
    lite_read(x"001C", rd);
    write(txt, string'("K26_PRERUN_READS=0x"));
    hwrite(txt, rd);
    writeline(output, txt);
    assert rd = x"00000000"
      report "K26_CORE_RAN_BEFORE_RELEASE: reset gate is broken" severity failure;

    -- 3. DDR is loaded (by init_ram/init_rdisk here, by xsdb on the board);
    --    release the core.
    lite_write(x"0000", x"00000001");
    write(txt, string'("K26_CORE_RELEASED"));
    writeline(output, txt);

    -- 4. Poll the transcript over AXI-Lite exactly as the board flow does.
    loop
      lite_read(x"0004", rd);
      count := to_integer(unsigned(rd));
      while shown < count loop
        lite_read(std_logic_vector(to_unsigned(16#8000# + (shown / 4) * 4, 16)), w);
        byte_v := to_integer(unsigned(w(8 * (shown mod 4) + 7 downto 8 * (shown mod 4))));
        ch := character'val(byte_v);
        if byte_v = 10 then
          writeline(output, txt);
        elsif byte_v >= 32 and byte_v < 127 then
          write(txt, ch);
        end if;
        if ch = MARKER(MARKER'low + mi) then
          mi := mi + 1;
          if mi = MARKER'length then matched := true; end if;
        elsif ch = MARKER(MARKER'low) then
          mi := 1;
        else
          mi := 0;
        end if;
        shown := shown + 1;
      end loop;

      exit when matched;

      if count = last_count then
        stall_iters := stall_iters + 1;
      else
        stall_iters := 0;
        last_count := count;
      end if;
      exit when stall_iters > 2000000;
      exit when count >= 16384;
    end loop;

    if txt /= null and txt'length > 0 then writeline(output, txt); end if;
    if matched then
      write(txt, string'("K26_MARKER_TEST_PASSED_SEEN"));
    else
      write(txt, string'("K26_MARKER_NOT_SEEN"));
    end if;
    writeline(output, txt);

    if txt /= null and txt'length > 0 then writeline(output, txt); end if;

    lite_read(x"0008", rd);
    write(txt, string'("K26_FINAL_PC=0x")); hwrite(txt, rd); writeline(output, txt);
    lite_read(x"001C", rd);
    write(txt, string'("K26_AXI_READS=0x")); hwrite(txt, rd); writeline(output, txt);
    lite_read(x"0020", rd);
    write(txt, string'("K26_AXI_WRITES=0x")); hwrite(txt, rd); writeline(output, txt);
    write(txt, string'("K26_UART_BYTES=")); write(txt, count); writeline(output, txt);
    write(txt, string'("K26_DDR_TB_DONE"));
    writeline(output, txt);
    done <= true;
    wait for 100 ns;
    stop(0);
  end process;
end architecture sim;
