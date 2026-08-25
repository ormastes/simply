library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity tb_rv32_nvme_host_axi_mmio is
end entity tb_rv32_nvme_host_axi_mmio;

architecture sim of tb_rv32_nvme_host_axi_mmio is
  signal clk, resetn : std_logic := '0';
  signal awaddr, araddr : std_logic_vector(31 downto 0) := (others => '0');
  signal awprot, arprot : std_logic_vector(2 downto 0) := (others => '0');
  signal awvalid, awready, wvalid, wready, bvalid, bready : std_logic := '0';
  signal wdata, rdata : std_logic_vector(31 downto 0) := (others => '0');
  signal wstrb : std_logic_vector(3 downto 0) := (others => '0');
  signal bresp, rresp : std_logic_vector(1 downto 0);
  signal arvalid, arready, rvalid, rready : std_logic := '0';
  signal dma_awaddr, dma_araddr, dma_wdata, dma_rdata : std_logic_vector(31 downto 0);
  signal dma_awlen, dma_arlen : std_logic_vector(7 downto 0);
  signal dma_awsize, dma_arsize : std_logic_vector(2 downto 0);
  signal dma_awburst, dma_arburst : std_logic_vector(1 downto 0);
  signal dma_awcache, dma_arcache : std_logic_vector(3 downto 0);
  signal dma_awprot, dma_arprot : std_logic_vector(2 downto 0);
  signal dma_awvalid, dma_awready, dma_wvalid, dma_wready, dma_wlast : std_logic := '0';
  signal dma_wstrb : std_logic_vector(3 downto 0);
  signal dma_bresp : std_logic_vector(1 downto 0) := "00";
  signal dma_bvalid, dma_bready, dma_arvalid, dma_arready, dma_rlast, dma_rvalid, dma_rready : std_logic := '0';
  signal irq : std_logic;
  signal fw_valid, fw_write, fw_ready : std_logic := '0';
  signal fw_addr : std_logic_vector(7 downto 0) := (others => '0');
  signal fw_wdata, fw_rdata : std_logic_vector(31 downto 0) := (others => '0');
  signal fw_wstrb : std_logic_vector(3 downto 0) := (others => '0');

  type mem_t is array (0 to 16383) of std_logic_vector(31 downto 0);
  signal mem : mem_t := (1024 => x"12340006", 1040 => x"56780006", others => (others => '0'));
  signal rd_pending, wr_pending, bvalid_mem : std_logic := '0';
  signal rd_addr_q, wr_addr_q, wr_data_q : unsigned(31 downto 0) := (others => '0');
  signal dma_reads, dma_writes : natural := 0;

  procedure host_write(signal c : inout std_logic; signal wc : out std_logic; signal a : out std_logic_vector(31 downto 0);
                       signal d : out std_logic_vector(31 downto 0); signal s : out std_logic_vector(3 downto 0);
                       signal ready : in std_logic; signal bv : in std_logic; signal br : out std_logic;
                       constant addr_v, data_v : std_logic_vector(31 downto 0)) is
  begin
    a <= addr_v; d <= data_v; s <= "1111"; c <= '1';
    wc <= '1';
    wait until rising_edge(clk);
    while ready = '0' loop wait until rising_edge(clk); end loop;
    c <= '0'; wc <= '0';
    while bv = '0' loop wait until rising_edge(clk); end loop;
    br <= '1'; wait until rising_edge(clk); br <= '0';
  end procedure;

  procedure host_read(signal c : out std_logic; signal a : out std_logic_vector(31 downto 0);
                      signal ready : in std_logic; signal rv : in std_logic; signal rr : out std_logic;
                      signal d : in std_logic_vector(31 downto 0); constant addr_v : std_logic_vector(31 downto 0);
                      variable value : out std_logic_vector(31 downto 0)) is
  begin
    a <= addr_v; c <= '1'; wait until rising_edge(clk);
    while ready = '0' loop wait until rising_edge(clk); end loop;
    c <= '0';
    while rv = '0' loop wait until rising_edge(clk); end loop;
    value := d; rr <= '1'; wait until rising_edge(clk); rr <= '0';
  end procedure;

  procedure fw_write_tx(signal valid : out std_logic; signal wr : out std_logic; signal a : out std_logic_vector(7 downto 0);
                      signal d : out std_logic_vector(31 downto 0); signal s : out std_logic_vector(3 downto 0);
                      signal ready : in std_logic; constant addr_v : std_logic_vector(7 downto 0);
                      constant data_v : std_logic_vector(31 downto 0)) is
  begin
    wr <= '1'; a <= addr_v; d <= data_v; s <= "1111"; valid <= '1'; wait until rising_edge(clk);
    while ready = '0' loop wait until rising_edge(clk); end loop;
    valid <= '0'; wr <= '0';
  end procedure;

  procedure fw_read(signal valid : out std_logic; signal wr : out std_logic; signal a : out std_logic_vector(7 downto 0);
                     signal ready : in std_logic; signal d : in std_logic_vector(31 downto 0);
                     constant addr_v : std_logic_vector(7 downto 0); variable value : out std_logic_vector(31 downto 0)) is
  begin
    wr <= '0'; a <= addr_v; valid <= '1'; wait until rising_edge(clk);
    while ready = '0' loop wait until rising_edge(clk); end loop;
    value := d; valid <= '0';
  end procedure;
begin
  clk <= not clk after 5 ns;
  dma_awready <= '1'; dma_wready <= '1'; dma_arready <= '1';

  dut : entity work.rv32_nvme_axi
    port map (
      clk => clk, resetn => resetn,
      s_axi_awaddr => awaddr, s_axi_awprot => awprot, s_axi_awvalid => awvalid, s_axi_awready => awready,
      s_axi_wdata => wdata, s_axi_wstrb => wstrb, s_axi_wvalid => wvalid, s_axi_wready => wready,
      s_axi_bresp => bresp, s_axi_bvalid => bvalid, s_axi_bready => bready,
      s_axi_araddr => araddr, s_axi_arprot => arprot, s_axi_arvalid => arvalid, s_axi_arready => arready,
      s_axi_rdata => rdata, s_axi_rresp => rresp, s_axi_rvalid => rvalid, s_axi_rready => rready,
      m_axi_awaddr => dma_awaddr, m_axi_awlen => dma_awlen, m_axi_awsize => dma_awsize, m_axi_awburst => dma_awburst,
      m_axi_awcache => dma_awcache, m_axi_awprot => dma_awprot, m_axi_awvalid => dma_awvalid, m_axi_awready => dma_awready,
      m_axi_wdata => dma_wdata, m_axi_wstrb => dma_wstrb, m_axi_wlast => dma_wlast, m_axi_wvalid => dma_wvalid, m_axi_wready => dma_wready,
      m_axi_bresp => dma_bresp, m_axi_bvalid => dma_bvalid, m_axi_bready => dma_bready,
      m_axi_araddr => dma_araddr, m_axi_arlen => dma_arlen, m_axi_arsize => dma_arsize, m_axi_arburst => dma_arburst,
      m_axi_arcache => dma_arcache, m_axi_arprot => dma_arprot, m_axi_arvalid => dma_arvalid, m_axi_arready => dma_arready,
      m_axi_rdata => dma_rdata, m_axi_rresp => "00", m_axi_rlast => dma_rlast, m_axi_rvalid => dma_rvalid, m_axi_rready => dma_rready,
      irq_o => irq,
      fw_valid_i => fw_valid, fw_write_i => fw_write, fw_addr_i => fw_addr, fw_wdata_i => fw_wdata,
      fw_wstrb_i => fw_wstrb, fw_ready_o => fw_ready, fw_rdata_o => fw_rdata);

  -- Host memory model.  It is intentionally AXI-facing: the test only passes
  -- when the endpoint emits real read addresses and write transactions.
  memory_model : process(clk)
    variable index : integer;
  begin
    if rising_edge(clk) then
      dma_rvalid <= '0';
      if dma_arvalid = '1' and dma_arready = '1' then
        rd_addr_q <= unsigned(dma_araddr); rd_pending <= '1'; dma_reads <= dma_reads + 1;
      elsif rd_pending = '1' then
        index := to_integer(rd_addr_q(15 downto 2)); dma_rdata <= mem(index); dma_rvalid <= '1'; dma_rlast <= '1'; rd_pending <= '0';
      end if;
      if dma_awvalid = '1' and dma_wvalid = '1' and dma_awready = '1' and dma_wready = '1' then
        wr_addr_q <= unsigned(dma_awaddr); wr_data_q <= unsigned(dma_wdata); wr_pending <= '1'; dma_writes <= dma_writes + 1;
      end if;
      dma_bvalid <= bvalid_mem;
      if wr_pending = '1' then
        index := to_integer(wr_addr_q(15 downto 2)); mem(index) <= std_logic_vector(wr_data_q); wr_pending <= '0'; bvalid_mem <= '1';
      elsif bvalid_mem = '1' and dma_bready = '1' then bvalid_mem <= '0'; end if;
    end if;
  end process;

  test : process
    variable value : std_logic_vector(31 downto 0);
  begin
    wait for 40 ns; resetn <= '1'; wait until rising_edge(clk);
    host_read(arvalid, araddr, arready, rvalid, rready, rdata, x"00000000", value);
    assert value = x"0001000F" report "CAP mismatch" severity failure;
    host_read(arvalid, araddr, arready, rvalid, rready, rdata, x"00000008", value);
    assert value = x"00010300" report "VS mismatch" severity failure;
    host_write(awvalid, wvalid, awaddr, wdata, wstrb, awready, bvalid, bready, x"00000024", x"00030003");
    host_write(awvalid, wvalid, awaddr, wdata, wstrb, awready, bvalid, bready, x"00000028", x"00001000");
    host_write(awvalid, wvalid, awaddr, wdata, wstrb, awready, bvalid, bready, x"00000030", x"00002000");
    host_write(awvalid, wvalid, awaddr, wdata, wstrb, awready, bvalid, bready, x"00000014", x"00460001");
    host_read(arvalid, araddr, arready, rvalid, rready, rdata, x"0000001C", value);
    assert value(0) = '1' and value(1) = '0' report "valid CC did not become ready" severity failure;

    host_write(awvalid, wvalid, awaddr, wdata, wstrb, awready, bvalid, bready, x"00001000", x"00000002");
    for i in 0 to 200 loop
      fw_read(fw_valid, fw_write, fw_addr, fw_ready, fw_rdata, x"00", value);
      exit when value(0) = '1';
    end loop;
    assert value(0) = '1' report "firmware mailbox did not receive SQE" severity failure;
    fw_read(fw_valid, fw_write, fw_addr, fw_ready, fw_rdata, x"08", value);
    assert value = x"12340006" report "SQE DMA fetch mismatch" severity failure;
    fw_write_tx(fw_valid, fw_write, fw_addr, fw_wdata, fw_wstrb, fw_ready, x"48", x"AABBCCDD");
    fw_write_tx(fw_valid, fw_write, fw_addr, fw_wdata, fw_wstrb, fw_ready, x"4C", x"00000000");
    fw_write_tx(fw_valid, fw_write, fw_addr, fw_wdata, fw_wstrb, fw_ready, x"50", x"00000001");
    for i in 0 to 200 loop wait until rising_edge(clk); exit when irq = '1'; end loop;
    assert irq = '1' report "completion IRQ not raised" severity failure;
    assert mem(2048) = x"AABBCCDD" report "CQE result DMA mismatch" severity failure;
    assert mem(2050) = x"00000001" report "CQE SQHD/SQID mismatch" severity failure;
    assert mem(2051) = x"00011234" report "CQE CID/phase mismatch" severity failure;
    for i in 0 to 200 loop
      fw_read(fw_valid, fw_write, fw_addr, fw_ready, fw_rdata, x"00", value);
      exit when value(0) = '1';
    end loop;
    assert value(0) = '1' report "second posted SQE was stranded" severity failure;
    fw_read(fw_valid, fw_write, fw_addr, fw_ready, fw_rdata, x"08", value);
    assert value = x"56780006" report "second SQE DMA fetch mismatch" severity failure;
    fw_write_tx(fw_valid, fw_write, fw_addr, fw_wdata, fw_wstrb, fw_ready, x"48", x"11223344");
    fw_write_tx(fw_valid, fw_write, fw_addr, fw_wdata, fw_wstrb, fw_ready, x"4C", x"00000000");
    fw_write_tx(fw_valid, fw_write, fw_addr, fw_wdata, fw_wstrb, fw_ready, x"50", x"00000001");
    for i in 0 to 200 loop wait until rising_edge(clk); exit when dma_writes >= 8; end loop;
    for i in 0 to 3 loop wait until rising_edge(clk); end loop;
    assert mem(2052) = x"11223344" report "second CQE result mismatch" severity failure;
    assert mem(2054) = x"00000002" report "second CQE SQHD/SQID mismatch" severity failure;
    assert mem(2055) = x"00015678" report "second CQE CID/phase mismatch" severity failure;
    assert dma_reads >= 32 and dma_writes >= 8 report "multi-command AXI DMA activity was not observed" severity failure;
    host_write(awvalid, wvalid, awaddr, wdata, wstrb, awready, bvalid, bready, x"00001004", x"00000002");
    assert irq = '0' report "CQ head did not clear IRQ" severity failure;

    resetn <= '0'; wait for 30 ns; resetn <= '1'; wait until rising_edge(clk);
    host_write(awvalid, wvalid, awaddr, wdata, wstrb, awready, bvalid, bready, x"00000024", x"00010001");
    host_write(awvalid, wvalid, awaddr, wdata, wstrb, awready, bvalid, bready, x"00000028", x"00001000");
    host_write(awvalid, wvalid, awaddr, wdata, wstrb, awready, bvalid, bready, x"00000030", x"00002000");
    host_write(awvalid, wvalid, awaddr, wdata, wstrb, awready, bvalid, bready, x"00000014", x"00450001");
    host_read(arvalid, araddr, arready, rvalid, rready, rdata, x"0000001C", value);
    assert value(1) = '1' and value(0) = '0' report "invalid CC was not failed closed" severity failure;
    report "RV32_NVME_HOST_AXI_PASS" severity note;
    wait;
  end process;
end architecture sim;
