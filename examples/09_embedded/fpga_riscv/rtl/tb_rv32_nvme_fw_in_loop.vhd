library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;
use ieee.std_logic_textio.all;
use std.textio.all;
use std.env.all;

-- Host-issued NVMe commands serviced by the resident RV32 firmware. Firmware,
-- .nandram, queues, completions, and PRP data all share this AXI RAM model.
entity tb_rv32_nvme_fw_in_loop is
  generic (
    G_NANDRAM_WORD : natural := 0;
    G_TIMEOUT_US   : positive := 50000
  );
end entity tb_rv32_nvme_fw_in_loop;

architecture sim of tb_rv32_nvme_fw_in_loop is
  constant DDR_BASE  : unsigned(31 downto 0) := x"10000000";
  constant RAM_WORDS : natural := 131072; -- 512 KiB
  constant ASQ_ADDR  : std_logic_vector(31 downto 0) := x"10010000";
  constant ACQ_ADDR  : std_logic_vector(31 downto 0) := x"10014000";
  constant ICQ_ADDR  : std_logic_vector(31 downto 0) := x"10018000";
  constant ISQ_ADDR  : std_logic_vector(31 downto 0) := x"1001C000";
  constant DATA_ADDR : std_logic_vector(31 downto 0) := x"10020000";
  constant ID_ADDR   : std_logic_vector(31 downto 0) := x"10024000";
  constant DATA_WORD : std_logic_vector(31 downto 0) := x"A5C35A7E";
  constant ASQ_WORD  : natural := 16#10000# / 4;
  constant ACQ_WORD  : natural := 16#14000# / 4;
  constant ICQ_WORD  : natural := 16#18000# / 4;
  constant ISQ_WORD  : natural := 16#1C000# / 4;
  constant DATA_BASE_WORD : natural := 16#20000# / 4;
  constant ID_WORD   : natural := 16#24000# / 4;

  signal clk, resetn, done : std_logic := '0';
  signal core_rst, uart_tx : std_logic;
  signal debug_uart_valid : std_logic;
  signal debug_uart_byte : std_logic_vector(7 downto 0);
  signal debug_pc, debug_ins, debug_a0, debug_ra, debug_sp : std_logic_vector(31 downto 0);

  signal mem_req, mem_we, mem_rvalid : std_logic;
  signal mem_addr, mem_wdata, mem_rdata : std_logic_vector(31 downto 0);
  signal mem_wstrb : std_logic_vector(3 downto 0);
  signal ddr_req, ddr_rvalid : std_logic;
  signal ddr_rdata : std_logic_vector(31 downto 0);
  signal fw_sel, fw_valid, fw_ready, fw_active_q, fw_rvalid_q : std_logic := '0';
  signal fw_rdata, fw_rdata_q : std_logic_vector(31 downto 0) := (others => '0');

  -- Core AXI master.
  signal c_awaddr, c_wdata, c_araddr, c_rdata : std_logic_vector(31 downto 0);
  signal c_awlen, c_arlen : std_logic_vector(7 downto 0);
  signal c_awsize, c_arsize : std_logic_vector(2 downto 0);
  signal c_awburst, c_arburst, c_bresp, c_rresp : std_logic_vector(1 downto 0);
  signal c_awcache, c_arcache, c_wstrb : std_logic_vector(3 downto 0);
  signal c_awprot, c_arprot : std_logic_vector(2 downto 0);
  signal c_awvalid, c_awready, c_wlast, c_wvalid, c_wready : std_logic := '0';
  signal c_bvalid, c_bready, c_arvalid, c_arready, c_rlast, c_rvalid, c_rready : std_logic := '0';

  -- Endpoint DMA AXI master.
  signal d_awaddr, d_wdata, d_araddr, d_rdata : std_logic_vector(31 downto 0);
  signal d_awlen, d_arlen : std_logic_vector(7 downto 0);
  signal d_awsize, d_arsize : std_logic_vector(2 downto 0);
  signal d_awburst, d_arburst, d_bresp, d_rresp : std_logic_vector(1 downto 0);
  signal d_awcache, d_arcache, d_wstrb : std_logic_vector(3 downto 0);
  signal d_awprot, d_arprot : std_logic_vector(2 downto 0);
  signal d_awvalid, d_awready, d_wlast, d_wvalid, d_wready : std_logic := '0';
  signal d_bvalid, d_bready, d_arvalid, d_arready, d_rlast, d_rvalid, d_rready : std_logic := '0';

  -- Host AXI-Lite register aperture.
  signal h_awaddr, h_araddr : std_logic_vector(15 downto 0) := (others => '0');
  signal h_awvalid, h_awready, h_wvalid, h_wready, h_bvalid, h_bready : std_logic := '0';
  signal h_wdata, h_rdata : std_logic_vector(31 downto 0) := (others => '0');
  signal h_wstrb : std_logic_vector(3 downto 0) := (others => '0');
  signal h_bresp, h_rresp : std_logic_vector(1 downto 0);
  signal h_arvalid, h_arready, h_rvalid, h_rready, irq : std_logic := '0';

  signal inject_retention, inject_done : std_logic := '0';
  signal admin_cq0_qid, admin_cq1_qid, admin_cq2_qid : std_logic_vector(31 downto 0) := (others => '0');
  signal admin_cq0, admin_cq1, admin_cq2 : std_logic_vector(31 downto 0) := (others => '0');
  signal io_cq0_qid, io_cq1_qid, io_cq2_qid, io_cq3_qid : std_logic_vector(31 downto 0) := (others => '0');
  signal io_cq4_qid, io_cq5_qid, io_cq6_qid : std_logic_vector(31 downto 0) := (others => '0');
  signal io_cq0, io_cq1, io_cq2, io_cq3 : std_logic_vector(31 downto 0) := (others => '0');
  signal io_cq4, io_cq5, io_cq6 : std_logic_vector(31 downto 0) := (others => '0');
  signal read_data0, read_data1, read_data2, read_data3, read_data4 : std_logic_vector(31 downto 0) := (others => '0');
  signal identify0, identify19 : std_logic_vector(31 downto 0) := (others => '0');
  signal nand_level, nand_refreshes, nand_recoveries, nand_reads : std_logic_vector(31 downto 0) := (others => '0');
  signal nand_remaps, nand_alternate : std_logic_vector(31 downto 0) := (others => '0');

  type ram_t is array (0 to RAM_WORDS - 1) of std_logic_vector(31 downto 0);

  impure function init_ram return ram_t is
    file f : text open read_mode is "rv32_flat.mem";
    variable line_v : line;
    variable word_v : std_logic_vector(31 downto 0);
    variable ram : ram_t := (others => (others => '0'));
    variable i : natural := 0;
  begin
    while not endfile(f) loop
      readline(f, line_v); hread(line_v, word_v);
      if i < RAM_WORDS then ram(i) := word_v; end if;
      i := i + 1;
    end loop;

    -- Admin Create I/O CQ, then Create I/O SQ (depth 16, qid/cqid 1).
    ram(ASQ_WORD + 0) := x"00010005";
    ram(ASQ_WORD + 6) := ICQ_ADDR;
    ram(ASQ_WORD + 10) := x"000F0001";
    ram(ASQ_WORD + 16) := x"00020001";
    ram(ASQ_WORD + 22) := ISQ_ADDR;
    ram(ASQ_WORD + 26) := x"000F0001";
    ram(ASQ_WORD + 27) := x"00010000";
    ram(ASQ_WORD + 32) := x"00030006";
    ram(ASQ_WORD + 38) := ID_ADDR;
    ram(ASQ_WORD + 42) := x"00000001";

    -- Write invokes firmware erase+program. Flush proves ordering, followed by
    -- one recovery Read and four Reads that cross the prevention threshold.
    ram(ISQ_WORD + 0) := x"00100001";
    ram(ISQ_WORD + 1) := x"00000001";
    ram(ISQ_WORD + 6) := DATA_ADDR;
    ram(DATA_BASE_WORD) := DATA_WORD;
    ram(ISQ_WORD + 16) := x"00110000";
    ram(ISQ_WORD + 17) := x"00000001";
    for q in 2 to 6 loop
      ram(ISQ_WORD + q * 16) := std_logic_vector(to_unsigned(16#10# + q, 16)) & x"0002";
      ram(ISQ_WORD + q * 16 + 1) := x"00000001";
      ram(ISQ_WORD + q * 16 + 6) := std_logic_vector(unsigned(DATA_ADDR) + to_unsigned((q - 1) * 4, 32));
    end loop;
    return ram;
  end function;

  procedure host_write(
    signal av : out std_logic; signal wv : out std_logic;
    signal a : out std_logic_vector(15 downto 0);
    signal data : out std_logic_vector(31 downto 0);
    signal strb : out std_logic_vector(3 downto 0);
    signal ardy, wrdy, bv : in std_logic; signal br : out std_logic;
    constant addr_v : std_logic_vector(15 downto 0);
    constant data_v : std_logic_vector(31 downto 0)) is
  begin
    a <= addr_v; data <= data_v; strb <= "1111"; av <= '1'; wv <= '1';
    loop wait until rising_edge(clk); exit when ardy = '1' and wrdy = '1'; end loop;
    av <= '0'; wv <= '0'; br <= '1';
    loop wait until rising_edge(clk); exit when bv = '1'; end loop;
    br <= '0';
  end procedure;

  procedure host_read(
    signal av : out std_logic; signal a : out std_logic_vector(15 downto 0);
    signal ardy, rv : in std_logic; signal rr : out std_logic;
    signal data : in std_logic_vector(31 downto 0);
    constant addr_v : std_logic_vector(15 downto 0);
    variable value : out std_logic_vector(31 downto 0)) is
  begin
    a <= addr_v; av <= '1';
    loop wait until rising_edge(clk); exit when ardy = '1'; end loop;
    av <= '0'; rr <= '1';
    loop wait until rising_edge(clk); exit when rv = '1'; end loop;
    value := data; rr <= '0';
  end procedure;
begin
  clk <= not clk after 5 ns when done = '0' else '0';
  core_rst <= not resetn;
  fw_sel <= '1' when mem_addr(31 downto 8) = x"200000" else '0';
  fw_valid <= mem_req and fw_sel and not fw_active_q;
  ddr_req <= mem_req and not fw_sel;
  mem_rdata <= fw_rdata_q when fw_sel = '1' else ddr_rdata;
  mem_rvalid <= fw_rvalid_q when fw_sel = '1' else ddr_rvalid;

  mailbox_bridge : process(clk)
  begin
    if rising_edge(clk) then
      if resetn = '0' then
        fw_active_q <= '0'; fw_rvalid_q <= '0'; fw_rdata_q <= (others => '0');
      else
        fw_rvalid_q <= '0';
        if fw_active_q = '1' then
          if mem_req = '0' then fw_active_q <= '0'; end if;
        elsif fw_valid = '1' and fw_ready = '1' then
          fw_active_q <= '1'; fw_rvalid_q <= '1'; fw_rdata_q <= fw_rdata;
        end if;
      end if;
    end if;
  end process;

  u_core : entity work.rv32_exec_core_axi
    generic map (CLK_FREQ => 100000000, BAUD_RATE => 115200)
    port map (
      clk => clk, rst => core_rst, uart_tx => uart_tx,
      mem_req => mem_req, mem_we => mem_we, mem_addr => mem_addr,
      mem_wdata => mem_wdata, mem_wstrb => mem_wstrb,
      mem_rdata => mem_rdata, mem_rvalid => mem_rvalid,
      debug_uart_valid => debug_uart_valid, debug_uart_byte => debug_uart_byte,
      debug_pc => debug_pc, debug_ins => debug_ins, debug_a0 => debug_a0,
      debug_ra => debug_ra, debug_sp => debug_sp);

  u_adapter : entity work.rv32_axi4_mem_adapter
    generic map (G_CORE_BASE => x"80000000", G_DDR_BASE => DDR_BASE)
    port map (
      clk => clk, resetn => resetn,
      mem_req => ddr_req, mem_we => mem_we, mem_addr => mem_addr,
      mem_wdata => mem_wdata, mem_wstrb => mem_wstrb,
      mem_rdata => ddr_rdata, mem_rvalid => ddr_rvalid,
      stat_reads => open, stat_writes => open,
      m_axi_awaddr => c_awaddr, m_axi_awlen => c_awlen, m_axi_awsize => c_awsize,
      m_axi_awburst => c_awburst, m_axi_awcache => c_awcache, m_axi_awprot => c_awprot,
      m_axi_awvalid => c_awvalid, m_axi_awready => c_awready,
      m_axi_wdata => c_wdata, m_axi_wstrb => c_wstrb, m_axi_wlast => c_wlast,
      m_axi_wvalid => c_wvalid, m_axi_wready => c_wready,
      m_axi_bresp => c_bresp, m_axi_bvalid => c_bvalid, m_axi_bready => c_bready,
      m_axi_araddr => c_araddr, m_axi_arlen => c_arlen, m_axi_arsize => c_arsize,
      m_axi_arburst => c_arburst, m_axi_arcache => c_arcache, m_axi_arprot => c_arprot,
      m_axi_arvalid => c_arvalid, m_axi_arready => c_arready,
      m_axi_rdata => c_rdata, m_axi_rresp => c_rresp, m_axi_rlast => c_rlast,
      m_axi_rvalid => c_rvalid, m_axi_rready => c_rready);

  u_nvme : entity work.rv32_nvme_axi
    port map (
      clk => clk, resetn => resetn,
      s_axi_awaddr => x"0000" & h_awaddr, s_axi_awprot => "000",
      s_axi_awvalid => h_awvalid, s_axi_awready => h_awready,
      s_axi_wdata => h_wdata, s_axi_wstrb => h_wstrb,
      s_axi_wvalid => h_wvalid, s_axi_wready => h_wready,
      s_axi_bresp => h_bresp, s_axi_bvalid => h_bvalid, s_axi_bready => h_bready,
      s_axi_araddr => x"0000" & h_araddr, s_axi_arprot => "000",
      s_axi_arvalid => h_arvalid, s_axi_arready => h_arready,
      s_axi_rdata => h_rdata, s_axi_rresp => h_rresp,
      s_axi_rvalid => h_rvalid, s_axi_rready => h_rready,
      m_axi_awaddr => d_awaddr, m_axi_awlen => d_awlen, m_axi_awsize => d_awsize,
      m_axi_awburst => d_awburst, m_axi_awcache => d_awcache, m_axi_awprot => d_awprot,
      m_axi_awvalid => d_awvalid, m_axi_awready => d_awready,
      m_axi_wdata => d_wdata, m_axi_wstrb => d_wstrb, m_axi_wlast => d_wlast,
      m_axi_wvalid => d_wvalid, m_axi_wready => d_wready,
      m_axi_bresp => d_bresp, m_axi_bvalid => d_bvalid, m_axi_bready => d_bready,
      m_axi_araddr => d_araddr, m_axi_arlen => d_arlen, m_axi_arsize => d_arsize,
      m_axi_arburst => d_arburst, m_axi_arcache => d_arcache, m_axi_arprot => d_arprot,
      m_axi_arvalid => d_arvalid, m_axi_arready => d_arready,
      m_axi_rdata => d_rdata, m_axi_rresp => d_rresp, m_axi_rlast => d_rlast,
      m_axi_rvalid => d_rvalid, m_axi_rready => d_rready, irq_o => irq,
      fw_valid_i => fw_valid, fw_write_i => mem_we, fw_addr_i => mem_addr(7 downto 0),
      fw_wdata_i => mem_wdata, fw_wstrb_i => mem_wstrb,
      fw_ready_o => fw_ready, fw_rdata_o => fw_rdata);

  c_awready <= '1'; c_wready <= '1'; c_arready <= '1';
  d_awready <= '1'; d_wready <= '1'; d_arready <= '1';
  c_bresp <= "00"; c_rresp <= "00"; d_bresp <= "00"; d_rresp <= "00";

  shared_axi_ram : process(clk)
    variable ram : ram_t := init_ram;
    variable c_read_pending, d_read_pending : boolean := false;
    variable c_read_addr, d_read_addr : unsigned(31 downto 0) := (others => '0');
    variable idx : natural;
  begin
    if rising_edge(clk) then
      if resetn = '0' then
        c_bvalid <= '0'; c_rvalid <= '0'; c_rlast <= '0';
        d_bvalid <= '0'; d_rvalid <= '0'; d_rlast <= '0';
        c_read_pending := false; d_read_pending := false; inject_done <= '0';
      else
        if c_bvalid = '1' and c_bready = '1' then c_bvalid <= '0'; end if;
        if d_bvalid = '1' and d_bready = '1' then d_bvalid <= '0'; end if;
        if c_rvalid = '1' and c_rready = '1' then c_rvalid <= '0'; c_rlast <= '0'; end if;
        if d_rvalid = '1' and d_rready = '1' then d_rvalid <= '0'; d_rlast <= '0'; end if;

        if c_awvalid = '1' and c_wvalid = '1' then
          idx := to_integer((unsigned(c_awaddr) - DDR_BASE) / 4);
          if idx < RAM_WORDS then
            for b in 0 to 3 loop
              if c_wstrb(b) = '1' then ram(idx)(b * 8 + 7 downto b * 8) := c_wdata(b * 8 + 7 downto b * 8); end if;
            end loop;
          end if;
          c_bvalid <= '1';
        end if;
        if d_awvalid = '1' and d_wvalid = '1' then
          idx := to_integer((unsigned(d_awaddr) - DDR_BASE) / 4);
          if idx < RAM_WORDS then
            for b in 0 to 3 loop
              if d_wstrb(b) = '1' then ram(idx)(b * 8 + 7 downto b * 8) := d_wdata(b * 8 + 7 downto b * 8); end if;
            end loop;
          end if;
          d_bvalid <= '1';
        end if;

        if c_arvalid = '1' then c_read_addr := unsigned(c_araddr); c_read_pending := true; end if;
        if d_arvalid = '1' then d_read_addr := unsigned(d_araddr); d_read_pending := true; end if;
        if c_read_pending and c_rvalid = '0' then
          idx := to_integer((c_read_addr - DDR_BASE) / 4);
          if idx < RAM_WORDS then c_rdata <= ram(idx); else c_rdata <= (others => '0'); end if;
          c_rvalid <= '1'; c_rlast <= '1'; c_read_pending := false;
        end if;
        if d_read_pending and d_rvalid = '0' then
          idx := to_integer((d_read_addr - DDR_BASE) / 4);
          if idx < RAM_WORDS then d_rdata <= ram(idx); else d_rdata <= (others => '0'); end if;
          d_rvalid <= '1'; d_rlast <= '1'; d_read_pending := false;
        end if;

        inject_done <= '0';
        if inject_retention = '1' then
          ram(G_NANDRAM_WORD + 4) := x"00000074"; -- level 116: nominal fails, retry[1] recovers
          ram(G_NANDRAM_WORD + 25) := x"00000001"; -- force primary verify failure and remap
          inject_done <= '1';
        end if;
      end if;

      admin_cq0_qid <= ram(ACQ_WORD + 2); admin_cq1_qid <= ram(ACQ_WORD + 6); admin_cq2_qid <= ram(ACQ_WORD + 10);
      admin_cq0 <= ram(ACQ_WORD + 3); admin_cq1 <= ram(ACQ_WORD + 7); admin_cq2 <= ram(ACQ_WORD + 11);
      io_cq0_qid <= ram(ICQ_WORD + 2); io_cq1_qid <= ram(ICQ_WORD + 6);
      io_cq2_qid <= ram(ICQ_WORD + 10); io_cq3_qid <= ram(ICQ_WORD + 14);
      io_cq4_qid <= ram(ICQ_WORD + 18); io_cq5_qid <= ram(ICQ_WORD + 22); io_cq6_qid <= ram(ICQ_WORD + 26);
      io_cq0 <= ram(ICQ_WORD + 3); io_cq1 <= ram(ICQ_WORD + 7);
      io_cq2 <= ram(ICQ_WORD + 11); io_cq3 <= ram(ICQ_WORD + 15);
      io_cq4 <= ram(ICQ_WORD + 19); io_cq5 <= ram(ICQ_WORD + 23); io_cq6 <= ram(ICQ_WORD + 27);
      read_data0 <= ram(DATA_BASE_WORD + 1); read_data1 <= ram(DATA_BASE_WORD + 2);
      read_data2 <= ram(DATA_BASE_WORD + 3); read_data3 <= ram(DATA_BASE_WORD + 4);
      read_data4 <= ram(DATA_BASE_WORD + 5);
      identify0 <= ram(ID_WORD); identify19 <= ram(ID_WORD + 19);
      if G_NANDRAM_WORD + 47 < RAM_WORDS then
        nand_level <= ram(G_NANDRAM_WORD + 4);
        nand_refreshes <= ram(G_NANDRAM_WORD + 7);
        nand_recoveries <= ram(G_NANDRAM_WORD + 8);
        nand_reads <= ram(G_NANDRAM_WORD + 21);
        nand_remaps <= ram(G_NANDRAM_WORD + 24);
        nand_alternate <= ram(G_NANDRAM_WORD + 44);
      end if;
    end if;
  end process;

  test : process
    variable value : std_logic_vector(31 downto 0);
    procedure wait_equal(signal observed : in std_logic_vector(31 downto 0);
                         constant expected : std_logic_vector(31 downto 0);
                         constant message_v : string) is
    begin
      for i in 0 to 2000000 loop
        wait until rising_edge(clk);
        exit when observed = expected;
      end loop;
      assert observed = expected report message_v & ": got 0x" & to_hstring(observed) severity failure;
    end procedure;
  begin
    assert G_NANDRAM_WORD + 47 < RAM_WORDS report "invalid .nandram ELF offset" severity failure;
    wait for 200 ns; resetn <= '1'; wait until rising_edge(clk);

    host_read(h_arvalid, h_araddr, h_arready, h_rvalid, h_rready, h_rdata, x"0000", value);
    assert value = x"0001000F" report "CAP mismatch" severity failure;
    host_write(h_awvalid, h_wvalid, h_awaddr, h_wdata, h_wstrb, h_awready, h_wready,
               h_bvalid, h_bready, x"0024", x"000F000F");
    host_write(h_awvalid, h_wvalid, h_awaddr, h_wdata, h_wstrb, h_awready, h_wready,
               h_bvalid, h_bready, x"0028", ASQ_ADDR);
    host_write(h_awvalid, h_wvalid, h_awaddr, h_wdata, h_wstrb, h_awready, h_wready,
               h_bvalid, h_bready, x"0030", ACQ_ADDR);
    host_write(h_awvalid, h_wvalid, h_awaddr, h_wdata, h_wstrb, h_awready, h_wready,
               h_bvalid, h_bready, x"0014", x"00460001");
    host_read(h_arvalid, h_araddr, h_arready, h_rvalid, h_rready, h_rdata, x"001C", value);
    assert value(0) = '1' and value(1) = '0' report "controller did not become ready" severity failure;

    host_write(h_awvalid, h_wvalid, h_awaddr, h_wdata, h_wstrb, h_awready, h_wready,
               h_bvalid, h_bready, x"1000", x"00000003");
    wait_equal(admin_cq0, x"00010001", "Create I/O CQ failed");
    wait_equal(admin_cq1, x"00010002", "Create I/O SQ failed");
    wait_equal(admin_cq2, x"00010003", "Identify failed");
    wait_equal(identify0, x"00010001", "Identify controller data mismatch");
    wait_equal(identify19, x"00000400", "Identify namespace capacity mismatch");
    assert admin_cq0_qid = x"00000001" and admin_cq1_qid = x"00000002" and admin_cq2_qid = x"00000003"
      report "admin CQE SQHD/SQID mismatch" severity failure;
    host_write(h_awvalid, h_wvalid, h_awaddr, h_wdata, h_wstrb, h_awready, h_wready,
               h_bvalid, h_bready, x"1004", x"00000003");

    host_write(h_awvalid, h_wvalid, h_awaddr, h_wdata, h_wstrb, h_awready, h_wready,
               h_bvalid, h_bready, x"1008", x"00000001");
    wait_equal(io_cq0, x"00010010", "program completion failed");
    assert io_cq0_qid = x"00010001" report "program CQE SQHD/SQID mismatch" severity failure;
    host_write(h_awvalid, h_wvalid, h_awaddr, h_wdata, h_wstrb, h_awready, h_wready,
               h_bvalid, h_bready, x"100C", x"00000001");

    host_write(h_awvalid, h_wvalid, h_awaddr, h_wdata, h_wstrb, h_awready, h_wready,
               h_bvalid, h_bready, x"1008", x"00000002");
    wait_equal(io_cq1, x"00010011", "flush completion failed");
    assert io_cq1_qid = x"00010002" report "flush CQE SQHD/SQID mismatch" severity failure;
    host_write(h_awvalid, h_wvalid, h_awaddr, h_wdata, h_wstrb, h_awready, h_wready,
               h_bvalid, h_bready, x"100C", x"00000002");

    inject_retention <= '1'; wait until rising_edge(clk); wait until inject_done = '1';
    inject_retention <= '0'; wait until rising_edge(clk);
    assert nand_level = x"00000074" report "retention fault did not reach AXI RAM" severity failure;

    host_write(h_awvalid, h_wvalid, h_awaddr, h_wdata, h_wstrb, h_awready, h_wready,
               h_bvalid, h_bready, x"1008", x"00000003");
    wait_equal(io_cq2, x"00010012", "recovery read completion failed");
    assert io_cq2_qid = x"00010003" report "recovery CQE SQHD/SQID mismatch" severity failure;
    wait_equal(read_data0, DATA_WORD, "recovery returned corrupt data");
    assert nand_recoveries = x"00000001" report "read-retry recovery count mismatch" severity failure;
    assert nand_remaps = x"00000001" and nand_alternate = x"00000001"
      report "failed primary verify did not activate alternate mapping" severity failure;
    assert nand_level = x"000000A0" report "FCR did not restore nominal programmed level" severity failure;
    host_write(h_awvalid, h_wvalid, h_awaddr, h_wdata, h_wstrb, h_awready, h_wready,
               h_bvalid, h_bready, x"100C", x"00000003");

    host_write(h_awvalid, h_wvalid, h_awaddr, h_wdata, h_wstrb, h_awready, h_wready,
               h_bvalid, h_bready, x"1008", x"00000007");
    wait_equal(io_cq6, x"00010016", "prevention read sequence failed");
    assert io_cq3 = x"00010013" and io_cq4 = x"00010014" and io_cq5 = x"00010015"
      report "intermediate prevention CQE status/CID mismatch" severity failure;
    assert io_cq3_qid = x"00010004" and io_cq4_qid = x"00010005" and
           io_cq5_qid = x"00010006" and io_cq6_qid = x"00010007"
      report "prevention CQE SQHD/SQID mismatch" severity failure;
    assert read_data1 = DATA_WORD and read_data2 = DATA_WORD and read_data3 = DATA_WORD
      report "intermediate prevention read returned corrupt data" severity failure;
    wait_equal(read_data4, DATA_WORD, "prevention read returned corrupt data");
    assert nand_reads = x"00000004" report "prevention read count mismatch" severity failure;
    assert nand_refreshes = x"00000002" report "recovery/prevention refresh count mismatch" severity failure;
    assert irq = '1' report "completion IRQ not asserted" severity failure;
    host_write(h_awvalid, h_wvalid, h_awaddr, h_wdata, h_wstrb, h_awready, h_wready,
               h_bvalid, h_bready, x"100C", x"00000007");
    wait until rising_edge(clk);
    assert irq = '0' report "completion IRQ did not clear" severity failure;

    report "RV32_NVME_FW_IN_LOOP_PASS recovery=" & integer'image(to_integer(unsigned(nand_recoveries))) &
           " refresh=" & integer'image(to_integer(unsigned(nand_refreshes))) &
           " remap=" & integer'image(to_integer(unsigned(nand_remaps))) &
           " reads=" & integer'image(to_integer(unsigned(nand_reads))) severity note;
    done <= '1'; wait for 20 ns; stop(0); wait;
  end process;

  timeout_guard : process
  begin
    wait for G_TIMEOUT_US * 1 us;
    if done = '0' then
      report "RV32_NVME_FW_IN_LOOP_TIMEOUT pc=0x" & to_hstring(debug_pc) &
             " ins=0x" & to_hstring(debug_ins) severity failure;
    end if;
    wait;
  end process;
end architecture sim;
