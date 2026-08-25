library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

-- Minimal synthesizable NVMe host endpoint for the RV32 target.
--
-- This block deliberately owns only the host protocol boundary.  It does not
-- implement NAND, FTL, or media policy.  One command is fetched at a time;
-- firmware consumes the 64-byte SQE through the fw_* mailbox and returns a
-- result/status, after which this block writes the 16-byte CQE to host memory.
-- qid0 is the admin queue and qid1 is the first I/O queue.

entity rv32_nvme_axi is
  port (
    clk   : in std_logic;
    resetn : in std_logic;

    -- Host AXI4-Lite register aperture.
    s_axi_awaddr  : in  std_logic_vector(31 downto 0);
    s_axi_awprot  : in  std_logic_vector(2 downto 0);
    s_axi_awvalid : in  std_logic;
    s_axi_awready : out std_logic;
    s_axi_wdata   : in  std_logic_vector(31 downto 0);
    s_axi_wstrb   : in  std_logic_vector(3 downto 0);
    s_axi_wvalid  : in  std_logic;
    s_axi_wready  : out std_logic;
    s_axi_bresp   : out std_logic_vector(1 downto 0);
    s_axi_bvalid  : out std_logic;
    s_axi_bready  : in  std_logic;
    s_axi_araddr  : in  std_logic_vector(31 downto 0);
    s_axi_arprot  : in  std_logic_vector(2 downto 0);
    s_axi_arvalid : in  std_logic;
    s_axi_arready : out std_logic;
    s_axi_rdata   : out std_logic_vector(31 downto 0);
    s_axi_rresp   : out std_logic_vector(1 downto 0);
    s_axi_rvalid  : out std_logic;
    s_axi_rready  : in  std_logic;

    -- One-outstanding full AXI4, 32-bit, single-beat DMA master.
    m_axi_awaddr  : out std_logic_vector(31 downto 0);
    m_axi_awlen   : out std_logic_vector(7 downto 0);
    m_axi_awsize  : out std_logic_vector(2 downto 0);
    m_axi_awburst : out std_logic_vector(1 downto 0);
    m_axi_awcache : out std_logic_vector(3 downto 0);
    m_axi_awprot  : out std_logic_vector(2 downto 0);
    m_axi_awvalid : out std_logic;
    m_axi_awready : in  std_logic;
    m_axi_wdata   : out std_logic_vector(31 downto 0);
    m_axi_wstrb   : out std_logic_vector(3 downto 0);
    m_axi_wlast   : out std_logic;
    m_axi_wvalid  : out std_logic;
    m_axi_wready  : in  std_logic;
    m_axi_bresp   : in  std_logic_vector(1 downto 0);
    m_axi_bvalid  : in  std_logic;
    m_axi_bready  : out std_logic;
    m_axi_araddr  : out std_logic_vector(31 downto 0);
    m_axi_arlen   : out std_logic_vector(7 downto 0);
    m_axi_arsize  : out std_logic_vector(2 downto 0);
    m_axi_arburst : out std_logic_vector(1 downto 0);
    m_axi_arcache : out std_logic_vector(3 downto 0);
    m_axi_arprot  : out std_logic_vector(2 downto 0);
    m_axi_arvalid : out std_logic;
    m_axi_arready : in  std_logic;
    m_axi_rdata   : in  std_logic_vector(31 downto 0);
    m_axi_rresp   : in  std_logic_vector(1 downto 0);
    m_axi_rlast   : in  std_logic;
    m_axi_rvalid  : in  std_logic;
    m_axi_rready  : out std_logic;

    irq_o : out std_logic;

    -- CPU/firmware mailbox.  fw_ready_o qualifies a transfer accepted on the
    -- current cycle; reads return fw_rdata_o in that same cycle.
    fw_valid_i : in  std_logic;
    fw_write_i : in  std_logic;
    fw_addr_i  : in  std_logic_vector(7 downto 0);
    fw_wdata_i : in  std_logic_vector(31 downto 0);
    fw_wstrb_i : in  std_logic_vector(3 downto 0);
    fw_ready_o : out std_logic;
    fw_rdata_o : out std_logic_vector(31 downto 0)
  );
end entity rv32_nvme_axi;

architecture rtl of rv32_nvme_axi is
  constant CAP_LO : std_logic_vector(31 downto 0) := x"0001000F";
  constant CAP_HI : std_logic_vector(31 downto 0) := x"00000020"; -- CSS.NVM=1, DSTRD=0
  constant VS_REG : std_logic_vector(31 downto 0) := x"00010300";

  type state_t is (S_IDLE, S_FETCH_AR, S_FETCH_R, S_MAILBOX,
                   S_CQE_AW_W, S_CQE_B, S_FW_DMA_AR, S_FW_DMA_R,
                   S_FW_DMA_AW_W, S_FW_DMA_B);
  type dma_kind_t is (D_FETCH, D_CQE, D_FW);
  type sqe_t is array (0 to 15) of std_logic_vector(31 downto 0);

  signal state_q : state_t := S_IDLE;
  signal dma_kind_q : dma_kind_t := D_FETCH;
  signal sqe_q : sqe_t := (others => (others => '0'));

  signal cc_q, aqa_q : std_logic_vector(31 downto 0) := (others => '0');
  signal asq_lo_q, asq_hi_q, acq_lo_q, acq_hi_q : std_logic_vector(31 downto 0) := (others => '0');
  signal csts_rdy_q, csts_cfs_q : std_logic := '0';
  signal intms_q, irq_pending_q : std_logic := '0';

  signal io_sq_base_q, io_cq_base_q : std_logic_vector(63 downto 0) := (others => '0');
  signal io_sq_valid_q, io_cq_valid_q : std_logic := '0';
  signal admin_sq_depth_q, admin_cq_depth_q : unsigned(4 downto 0) := to_unsigned(2, 5);
  signal io_sq_depth_q, io_cq_depth_q : unsigned(4 downto 0) := to_unsigned(2, 5);
  signal admin_sq_head_q, admin_sq_tail_q : unsigned(4 downto 0) := (others => '0');
  signal io_sq_head_q, io_sq_tail_q : unsigned(4 downto 0) := (others => '0');
  signal admin_cq_head_q, admin_cq_tail_q : unsigned(4 downto 0) := (others => '0');
  signal io_cq_head_q, io_cq_tail_q : unsigned(4 downto 0) := (others => '0');
  signal qid_q : std_logic := '0';
  signal fetch_index_q : unsigned(4 downto 0) := (others => '0');
  signal cqe_index_q : unsigned(2 downto 0) := (others => '0');
  signal cqe_sq_head_q : unsigned(4 downto 0) := (others => '0');
  signal cqe_phase_snapshot_q : std_logic := '1';
  signal dma_addr_q, dma_wdata_q : std_logic_vector(31 downto 0) := (others => '0');
  signal dma_rdata_q : std_logic_vector(31 downto 0) := (others => '0');
  signal dma_awvalid_q, dma_wvalid_q, dma_arvalid_q : std_logic := '0';
  signal dma_bready_q, dma_rready_q : std_logic := '0';
  signal fw_result_q, fw_status_q : std_logic_vector(31 downto 0) := (others => '0');
  signal fw_dma_addr_q : std_logic_vector(63 downto 0) := (others => '0');
  signal fw_dma_wdata_q : std_logic_vector(31 downto 0) := (others => '0');
  signal fw_dma_error_q : std_logic := '0';
  signal admin_cq_phase_q, io_cq_phase_q : std_logic := '1';

  signal aw_hold_q, w_hold_q, bvalid_q : std_logic := '0';
  signal awaddr_q, wdata_q : std_logic_vector(31 downto 0) := (others => '0');
  signal wstrb_q : std_logic_vector(3 downto 0) := (others => '0');
  signal write_commit_q : std_logic := '0';
  signal write_addr_q, write_data_q : std_logic_vector(31 downto 0) := (others => '0');
  signal write_strb_q : std_logic_vector(3 downto 0) := (others => '0');
  signal rvalid_q : std_logic := '0';
  signal rdata_q : std_logic_vector(31 downto 0) := (others => '0');

  function merge_word(oldv, newv : std_logic_vector(31 downto 0);
                      strb : std_logic_vector(3 downto 0)) return std_logic_vector is
    variable v : std_logic_vector(31 downto 0) := oldv;
  begin
    for i in 0 to 3 loop
      if strb(i) = '1' then
        v(i * 8 + 7 downto i * 8) := newv(i * 8 + 7 downto i * 8);
      end if;
    end loop;
    return v;
  end function;

  function config_valid(cc, aqa, asql, asqh, acql, acqh : std_logic_vector(31 downto 0)) return boolean is
    variable asq_n, acq_n : integer;
  begin
    asq_n := to_integer(unsigned(aqa(11 downto 0))) + 1;
    acq_n := to_integer(unsigned(aqa(27 downto 16))) + 1;
    return cc(0) = '1' and cc(3 downto 1) = "000" and
           cc(6 downto 4) = "000" and cc(10 downto 7) = "0000" and
           cc(13 downto 11) = "000" and cc(19 downto 16) = "0110" and
           cc(23 downto 20) = "0100" and asq_n >= 2 and asq_n <= 16 and
           acq_n >= 2 and acq_n <= 16 and asql /= x"00000000" and
           acql /= x"00000000" and asql(11 downto 0) = x"000" and
           acql(11 downto 0) = x"000" and asqh = x"00000000" and
           acqh = x"00000000";
  end function;

  function next_index(value, depth : unsigned(4 downto 0)) return unsigned is
  begin
    if value = depth - 1 then
      return to_unsigned(0, 5);
    end if;
    return value + 1;
  end function;

  function cqe_word(index : unsigned(2 downto 0); result, status, dw0 : std_logic_vector(31 downto 0);
                    sq_head : unsigned(4 downto 0); sqid : std_logic; phase : std_logic) return std_logic_vector is
    variable v : std_logic_vector(31 downto 0) := (others => '0');
  begin
    case to_integer(index) is
      when 0 => v := result;
      when 2 =>
        v(15 downto 0) := std_logic_vector(resize(sq_head, 16));
        v(31 downto 16) := (others => '0');
        v(16) := sqid;
      when 3 =>
        v(15 downto 0) := dw0(31 downto 16);
        v(31 downto 17) := status(14 downto 0);
        v(16) := phase;
      when others => null;
    end case;
    return v;
  end function;

  function q_base(qid : std_logic; asql, asqh, io_base : std_logic_vector(63 downto 0)) return std_logic_vector is
  begin
    if qid = '0' then
      return asqh & asql;
    end if;
    return io_base;
  end function;

begin
  -- AXI qualifiers: all DMA transfers are aligned, single-beat INCR accesses.
  m_axi_awaddr  <= dma_addr_q;
  m_axi_awlen   <= (others => '0');
  m_axi_awsize  <= "010";
  m_axi_awburst <= "01";
  m_axi_awcache <= "0011";
  m_axi_awprot  <= "000";
  m_axi_awvalid <= dma_awvalid_q;
  m_axi_wdata   <= dma_wdata_q;
  m_axi_wstrb   <= "1111";
  m_axi_wlast   <= '1';
  m_axi_wvalid  <= dma_wvalid_q;
  m_axi_bready  <= dma_bready_q;
  m_axi_araddr  <= dma_addr_q;
  m_axi_arlen   <= (others => '0');
  m_axi_arsize  <= "010";
  m_axi_arburst <= "01";
  m_axi_arcache <= "0011";
  m_axi_arprot  <= "000";
  m_axi_arvalid <= dma_arvalid_q;
  m_axi_rready  <= dma_rready_q;

  s_axi_awready <= not aw_hold_q and not bvalid_q;
  s_axi_wready  <= not w_hold_q and not bvalid_q;
  s_axi_bvalid  <= bvalid_q;
  s_axi_bresp   <= "00";
  s_axi_arready <= not rvalid_q;
  s_axi_rvalid  <= rvalid_q;
  s_axi_rresp   <= "00";
  s_axi_rdata   <= rdata_q;
  irq_o         <= irq_pending_q and not intms_q;

  -- The mailbox is a simple level handshake.  COMPLETE and DMA_CMD are
  -- back-pressured while the one outstanding operation is in flight.
  fw_ready_o <= '0' when resetn = '0' else
                '0' when fw_valid_i = '1' and fw_write_i = '1' and
                           fw_addr_i = x"50" and state_q /= S_MAILBOX else
                '0' when fw_valid_i = '1' and fw_write_i = '1' and fw_addr_i = x"50" and
                           ((qid_q = '0' and next_index(admin_cq_tail_q, admin_cq_depth_q) = admin_cq_head_q) or
                            (qid_q = '1' and next_index(io_cq_tail_q, io_cq_depth_q) = io_cq_head_q)) else
                '0' when fw_valid_i = '1' and fw_write_i = '1' and
                           fw_addr_i = x"64" and state_q /= S_MAILBOX else '1';

  process(all)
    variable v : std_logic_vector(31 downto 0) := (others => '0');
    variable si : integer;
  begin
    if fw_addr_i >= x"08" and fw_addr_i <= x"44" and fw_addr_i(1 downto 0) = "00" then
      si := (to_integer(unsigned(fw_addr_i)) - 8) / 4;
      v := sqe_q(si);
    else
      case fw_addr_i is
        when x"00" =>
          v := (others => '0');
          if state_q = S_MAILBOX then v(0) := '1'; end if;
          if state_q = S_FW_DMA_AR or state_q = S_FW_DMA_R or
             state_q = S_FW_DMA_AW_W or state_q = S_FW_DMA_B then v(1) := '1'; end if;
        when x"04" => v(0) := qid_q;
        when x"48" => v := fw_result_q;
        when x"4C" => v := fw_status_q;
        when x"54" => v := fw_dma_addr_q(31 downto 0);
        when x"58" => v := fw_dma_addr_q(63 downto 32);
        when x"5C" => v := fw_dma_wdata_q;
        when x"60" => v := dma_rdata_q;
        when x"64" =>
          v := (others => '0');
          if state_q = S_FW_DMA_AR or state_q = S_FW_DMA_R or
             state_q = S_FW_DMA_AW_W or state_q = S_FW_DMA_B then v(31) := '1'; end if;
          v(30) := fw_dma_error_q;
        when others => null;
      end case;
    end if;
    fw_rdata_o <= v;
  end process;

  -- AXI-Lite write capture.  AW and W may arrive in either order; the
  -- decoded write is presented to the controller process for one cycle.
  process(clk)
    variable aw_accept, w_accept : boolean;
    variable have_aw, have_w : boolean;
    variable addr_v, data_v, strb_v : std_logic_vector(31 downto 0);
  begin
    if rising_edge(clk) then
      if resetn = '0' then
        aw_hold_q <= '0'; w_hold_q <= '0'; bvalid_q <= '0';
        awaddr_q <= (others => '0'); wdata_q <= (others => '0'); wstrb_q <= (others => '0');
        write_commit_q <= '0'; write_addr_q <= (others => '0'); write_data_q <= (others => '0');
        write_strb_q <= (others => '0');
      else
        write_commit_q <= '0';
        aw_accept := s_axi_awvalid = '1' and s_axi_awready = '1';
        w_accept := s_axi_wvalid = '1' and s_axi_wready = '1';
        have_aw := aw_hold_q = '1' or aw_accept;
        have_w := w_hold_q = '1' or w_accept;
        addr_v := awaddr_q;
        data_v := wdata_q;
        strb_v := x"00000000";
        if aw_accept then addr_v := s_axi_awaddr; end if;
        if w_accept then data_v := s_axi_wdata; strb_v(3 downto 0) := s_axi_wstrb; end if;
        if not w_accept then strb_v(3 downto 0) := wstrb_q; end if;
        if aw_accept then awaddr_q <= s_axi_awaddr; aw_hold_q <= '1'; end if;
        if w_accept then wdata_q <= s_axi_wdata; wstrb_q <= s_axi_wstrb; w_hold_q <= '1'; end if;
        if have_aw and have_w and bvalid_q = '0' then
          write_addr_q <= addr_v;
          write_data_q <= data_v;
          write_strb_q <= strb_v(3 downto 0);
          write_commit_q <= '1';
          aw_hold_q <= '0';
          w_hold_q <= '0';
          bvalid_q <= '1';
        elsif bvalid_q = '1' and s_axi_bready = '1' then
          bvalid_q <= '0';
        end if;
      end if;
    end if;
  end process;

  -- AXI-Lite registered reads.
  process(clk)
    variable off : std_logic_vector(11 downto 0);
    variable dbn : integer;
  begin
    if rising_edge(clk) then
      if resetn = '0' then
        rvalid_q <= '0'; rdata_q <= (others => '0');
      else
        if rvalid_q = '1' and s_axi_rready = '1' then rvalid_q <= '0'; end if;
        if s_axi_arvalid = '1' and s_axi_arready = '1' then
          off := s_axi_araddr(11 downto 0);
          rdata_q <= (others => '0');
          if unsigned(s_axi_araddr) >= to_unsigned(4096, 32) then
            dbn := to_integer(unsigned(s_axi_araddr(13 downto 2))) - 1024;
            if dbn = 0 then rdata_q <= std_logic_vector(resize(admin_sq_tail_q, 32));
            elsif dbn = 1 then rdata_q <= std_logic_vector(resize(admin_cq_head_q, 32));
            elsif dbn = 2 then rdata_q <= std_logic_vector(resize(io_sq_tail_q, 32));
            elsif dbn = 3 then rdata_q <= std_logic_vector(resize(io_cq_head_q, 32));
            end if;
          else
            case off is
              when x"000" => rdata_q <= CAP_LO;
              when x"004" => rdata_q <= CAP_HI;
              when x"008" => rdata_q <= VS_REG;
              when x"00C" => rdata_q(0) <= intms_q;
              when x"014" => rdata_q <= cc_q;
              when x"01C" => rdata_q(0) <= csts_rdy_q; rdata_q(1) <= csts_cfs_q;
              when x"024" => rdata_q <= aqa_q;
              when x"028" => rdata_q <= asq_lo_q;
              when x"02C" => rdata_q <= asq_hi_q;
              when x"030" => rdata_q <= acq_lo_q;
              when x"034" => rdata_q <= acq_hi_q;
              when others => null;
            end case;
          end if;
          rvalid_q <= '1';
        end if;
      end if;
    end if;
  end process;

  -- Register, queue, mailbox, and DMA controller.
  process(clk)
    variable v : std_logic_vector(31 downto 0);
    variable depth_v : integer;
    variable dbn, dbqid : integer;
    variable new_tail : unsigned(4 downto 0);
    variable base_v : std_logic_vector(63 downto 0);
    variable status_ok : boolean;
    variable controller_reset : boolean;
  begin
    if rising_edge(clk) then
      if resetn = '0' then
        state_q <= S_IDLE; dma_kind_q <= D_FETCH;
        cc_q <= (others => '0'); aqa_q <= (others => '0');
        asq_lo_q <= (others => '0'); asq_hi_q <= (others => '0');
        acq_lo_q <= (others => '0'); acq_hi_q <= (others => '0');
        csts_rdy_q <= '0'; csts_cfs_q <= '0'; intms_q <= '0'; irq_pending_q <= '0';
        io_sq_base_q <= (others => '0'); io_cq_base_q <= (others => '0');
        io_sq_valid_q <= '0'; io_cq_valid_q <= '0';
        admin_sq_depth_q <= to_unsigned(2, 5); admin_cq_depth_q <= to_unsigned(2, 5);
        io_sq_depth_q <= to_unsigned(2, 5); io_cq_depth_q <= to_unsigned(2, 5);
        admin_sq_head_q <= (others => '0'); admin_sq_tail_q <= (others => '0');
        io_sq_head_q <= (others => '0'); io_sq_tail_q <= (others => '0');
        admin_cq_head_q <= (others => '0'); admin_cq_tail_q <= (others => '0');
        io_cq_head_q <= (others => '0'); io_cq_tail_q <= (others => '0');
        qid_q <= '0'; fetch_index_q <= (others => '0'); cqe_index_q <= (others => '0');
        cqe_sq_head_q <= (others => '0'); cqe_phase_snapshot_q <= '1';
        dma_addr_q <= (others => '0'); dma_wdata_q <= (others => '0'); dma_rdata_q <= (others => '0');
        dma_awvalid_q <= '0'; dma_wvalid_q <= '0'; dma_arvalid_q <= '0';
        dma_bready_q <= '0'; dma_rready_q <= '0';
        fw_result_q <= (others => '0'); fw_status_q <= (others => '0');
        fw_dma_addr_q <= (others => '0'); fw_dma_wdata_q <= (others => '0'); fw_dma_error_q <= '0';
        admin_cq_phase_q <= '1'; io_cq_phase_q <= '1';
      else
        controller_reset := false;
        -- Mailbox scalar registers.
        if fw_valid_i = '1' and fw_ready_o = '1' and fw_write_i = '1' then
          case fw_addr_i is
            when x"48" => fw_result_q <= merge_word(fw_result_q, fw_wdata_i, fw_wstrb_i);
            when x"4C" => fw_status_q <= merge_word(fw_status_q, fw_wdata_i, fw_wstrb_i);
            when x"54" => fw_dma_addr_q(31 downto 0) <= merge_word(fw_dma_addr_q(31 downto 0), fw_wdata_i, fw_wstrb_i);
            when x"58" => fw_dma_addr_q(63 downto 32) <= merge_word(fw_dma_addr_q(63 downto 32), fw_wdata_i, fw_wstrb_i);
            when x"5C" => fw_dma_wdata_q <= merge_word(fw_dma_wdata_q, fw_wdata_i, fw_wstrb_i);
            when others => null;
          end case;
        end if;

        -- Host register writes are accepted only through the AXI-Lite commit.
        if write_commit_q = '1' then
          v := write_data_q;
          case write_addr_q(15 downto 0) is
            when x"0014" =>
              cc_q <= merge_word(cc_q, v, write_strb_q);
              if merge_word(cc_q, v, write_strb_q)(0) = '0' then
                controller_reset := true;
                csts_rdy_q <= '0'; csts_cfs_q <= '0'; irq_pending_q <= '0';
                state_q <= S_IDLE; io_sq_valid_q <= '0'; io_cq_valid_q <= '0';
                admin_sq_head_q <= (others => '0'); admin_sq_tail_q <= (others => '0');
                admin_cq_head_q <= (others => '0'); admin_cq_tail_q <= (others => '0');
                io_sq_head_q <= (others => '0'); io_sq_tail_q <= (others => '0');
                io_cq_head_q <= (others => '0'); io_cq_tail_q <= (others => '0');
                admin_cq_phase_q <= '1'; io_cq_phase_q <= '1';
                dma_awvalid_q <= '0'; dma_wvalid_q <= '0'; dma_arvalid_q <= '0';
                dma_bready_q <= '0'; dma_rready_q <= '0'; fw_dma_error_q <= '0';
              elsif config_valid(merge_word(cc_q, v, write_strb_q), aqa_q, asq_lo_q, asq_hi_q, acq_lo_q, acq_hi_q) then
                csts_rdy_q <= '1';
                csts_cfs_q <= '0';
                admin_sq_depth_q <= to_unsigned(to_integer(unsigned(aqa_q(11 downto 0))) + 1, 5);
                admin_cq_depth_q <= to_unsigned(to_integer(unsigned(aqa_q(27 downto 16))) + 1, 5);
              else
                csts_rdy_q <= '0'; csts_cfs_q <= '1';
              end if;
            when x"0024" => aqa_q <= merge_word(aqa_q, v, write_strb_q);
            when x"0028" => asq_lo_q <= merge_word(asq_lo_q, v, write_strb_q);
            when x"002C" => asq_hi_q <= merge_word(asq_hi_q, v, write_strb_q);
            when x"0030" => acq_lo_q <= merge_word(acq_lo_q, v, write_strb_q);
            when x"0034" => acq_hi_q <= merge_word(acq_hi_q, v, write_strb_q);
            when x"000C" => intms_q <= intms_q or merge_word((others => '0'), v, write_strb_q)(0);
            when x"0010" => intms_q <= intms_q and not merge_word((others => '0'), v, write_strb_q)(0);
            when others =>
              if unsigned(write_addr_q) >= to_unsigned(4096, 32) then
                dbn := to_integer(unsigned(write_addr_q(13 downto 2))) - 1024;
                dbqid := dbn / 2;
                if dbqid <= 1 and dbn >= 0 and dbn <= 3 then
                  if (dbn mod 2) = 0 then
                    new_tail := unsigned(v(4 downto 0));
                    if dbqid = 0 then
                      if csts_rdy_q = '1' and new_tail < admin_sq_depth_q then
                        admin_sq_tail_q <= new_tail;
                        if state_q = S_IDLE and new_tail /= admin_sq_head_q then
                          qid_q <= '0'; fetch_index_q <= (others => '0');
                          base_v := asq_hi_q & asq_lo_q;
                          dma_addr_q <= std_logic_vector(unsigned(base_v(31 downto 0)) + shift_left(resize(admin_sq_head_q, 32), 6));
                          dma_arvalid_q <= '1'; dma_kind_q <= D_FETCH; state_q <= S_FETCH_AR;
                        end if;
                      else csts_cfs_q <= '1'; end if;
                    elsif csts_rdy_q = '1' and io_sq_valid_q = '1' and io_cq_valid_q = '1' and new_tail < io_sq_depth_q then
                      io_sq_tail_q <= new_tail;
                      if state_q = S_IDLE and new_tail /= io_sq_head_q then
                        qid_q <= '1'; fetch_index_q <= (others => '0');
                        dma_addr_q <= std_logic_vector(unsigned(io_sq_base_q(31 downto 0)) + shift_left(resize(io_sq_head_q, 32), 6));
                        dma_arvalid_q <= '1'; dma_kind_q <= D_FETCH; state_q <= S_FETCH_AR;
                      end if;
                    else csts_cfs_q <= '1'; end if;
                  else
                    if dbqid = 0 and unsigned(v(4 downto 0)) < admin_cq_depth_q then
                      admin_cq_head_q <= unsigned(v(4 downto 0));
                      if unsigned(v(4 downto 0)) = admin_cq_tail_q then irq_pending_q <= '0'; end if;
                    elsif dbqid = 1 and io_cq_valid_q = '1' and unsigned(v(4 downto 0)) < io_cq_depth_q then
                      io_cq_head_q <= unsigned(v(4 downto 0));
                      if unsigned(v(4 downto 0)) = io_cq_tail_q then irq_pending_q <= '0'; end if;
                    else csts_cfs_q <= '1'; end if;
                  end if;
                else csts_cfs_q <= '1'; end if;
              end if;
          end case;
        end if;

        -- Firmware DMA command: the endpoint remains the AXI master so the
        -- CPU can move PRP data without needing a second memory port.
        if controller_reset then
          null;
        elsif fw_valid_i = '1' and fw_ready_o = '1' and fw_write_i = '1' and fw_addr_i = x"64" then
          fw_dma_error_q <= '0';
          if fw_dma_addr_q(63 downto 32) /= x"00000000" then
            fw_dma_error_q <= '1';
          elsif fw_wdata_i = x"00000001" then
            dma_addr_q <= fw_dma_addr_q(31 downto 0); dma_arvalid_q <= '1'; dma_kind_q <= D_FW; state_q <= S_FW_DMA_AR;
          elsif fw_wdata_i = x"00000002" then
            dma_addr_q <= fw_dma_addr_q(31 downto 0); dma_wdata_q <= fw_dma_wdata_q;
            dma_awvalid_q <= '1'; dma_wvalid_q <= '1'; dma_kind_q <= D_FW; state_q <= S_FW_DMA_AW_W;
          else
            fw_dma_error_q <= '1';
          end if;
        elsif fw_valid_i = '1' and fw_ready_o = '1' and fw_write_i = '1' and fw_addr_i = x"50" and state_q = S_MAILBOX then
          cqe_index_q <= (others => '0');
          cqe_sq_head_q <= next_index(admin_sq_head_q, admin_sq_depth_q);
          cqe_phase_snapshot_q <= admin_cq_phase_q;
          if qid_q = '1' then
            cqe_sq_head_q <= next_index(io_sq_head_q, io_sq_depth_q);
            cqe_phase_snapshot_q <= io_cq_phase_q;
          end if;
          if qid_q = '0' then
            dma_addr_q <= std_logic_vector(unsigned(acq_lo_q) + shift_left(resize(admin_cq_tail_q, 32), 4));
          else
            dma_addr_q <= std_logic_vector(unsigned(io_cq_base_q(31 downto 0)) + shift_left(resize(io_cq_tail_q, 32), 4));
          end if;
          dma_wdata_q <= fw_result_q;
          dma_awvalid_q <= '1'; dma_wvalid_q <= '1'; dma_kind_q <= D_CQE; state_q <= S_CQE_AW_W;
        else
          case state_q is
            when S_FETCH_AR =>
              if dma_arvalid_q = '1' and m_axi_arready = '1' then
                dma_arvalid_q <= '0'; dma_rready_q <= '1'; state_q <= S_FETCH_R;
              end if;
            when S_FETCH_R =>
              if dma_rready_q = '1' and m_axi_rvalid = '1' then
                dma_rready_q <= '0';
                if m_axi_rresp /= "00" or m_axi_rlast /= '1' then
                  csts_cfs_q <= '1'; state_q <= S_IDLE;
                else
                  sqe_q(to_integer(fetch_index_q)) <= m_axi_rdata;
                  if fetch_index_q = 15 then state_q <= S_MAILBOX;
                  else fetch_index_q <= fetch_index_q + 1; dma_addr_q <= std_logic_vector(unsigned(dma_addr_q) + 4); dma_arvalid_q <= '1'; state_q <= S_FETCH_AR; end if;
                end if;
              end if;
            when S_CQE_AW_W =>
              if dma_awvalid_q = '1' and m_axi_awready = '1' then dma_awvalid_q <= '0'; end if;
              if dma_wvalid_q = '1' and m_axi_wready = '1' then dma_wvalid_q <= '0'; end if;
              if (dma_awvalid_q = '0' or m_axi_awready = '1') and (dma_wvalid_q = '0' or m_axi_wready = '1') then
                dma_bready_q <= '1'; state_q <= S_CQE_B;
              end if;
            when S_CQE_B =>
              if dma_bready_q = '1' and m_axi_bvalid = '1' then
                dma_bready_q <= '0';
                if m_axi_bresp /= "00" then
                  csts_cfs_q <= '1'; state_q <= S_IDLE;
                elsif cqe_index_q = 3 then
                  status_ok := fw_status_q(15 downto 0) = x"0000";
                  if status_ok and qid_q = '0' and sqe_q(0)(7 downto 0) = x"05" and sqe_q(10)(15 downto 0) = x"0001" then
                    depth_v := to_integer(unsigned(sqe_q(10)(31 downto 16))) + 1;
                    if depth_v >= 2 and depth_v <= 16 and sqe_q(6)(11 downto 0) = x"000" and sqe_q(7)(11 downto 0) = x"000" then
                      io_cq_base_q <= sqe_q(7) & sqe_q(6); io_cq_depth_q <= to_unsigned(depth_v, 5); io_cq_valid_q <= '1';
                    end if;
                  elsif status_ok and qid_q = '0' and io_cq_valid_q = '1' and
                        sqe_q(0)(7 downto 0) = x"01" and sqe_q(10)(15 downto 0) = x"0001" then
                    depth_v := to_integer(unsigned(sqe_q(10)(31 downto 16))) + 1;
                    if depth_v >= 2 and depth_v <= 16 and sqe_q(6)(11 downto 0) = x"000" and sqe_q(7)(11 downto 0) = x"000" then
                      io_sq_base_q <= sqe_q(7) & sqe_q(6); io_sq_depth_q <= to_unsigned(depth_v, 5); io_sq_valid_q <= '1';
                    end if;
                  end if;
                  if qid_q = '0' then
                    admin_sq_head_q <= next_index(admin_sq_head_q, admin_sq_depth_q);
                    admin_cq_tail_q <= next_index(admin_cq_tail_q, admin_cq_depth_q);
                    if admin_cq_tail_q = admin_cq_depth_q - 1 then admin_cq_phase_q <= not admin_cq_phase_q; end if;
                  else
                    io_sq_head_q <= next_index(io_sq_head_q, io_sq_depth_q);
                    io_cq_tail_q <= next_index(io_cq_tail_q, io_cq_depth_q);
                    if io_cq_tail_q = io_cq_depth_q - 1 then io_cq_phase_q <= not io_cq_phase_q; end if;
                  end if;
                  irq_pending_q <= '1'; state_q <= S_IDLE;
                  if qid_q = '0' and cqe_sq_head_q /= admin_sq_tail_q then
                    fetch_index_q <= (others => '0');
                    dma_addr_q <= std_logic_vector(unsigned(asq_lo_q) + shift_left(resize(cqe_sq_head_q, 32), 6));
                    dma_arvalid_q <= '1'; state_q <= S_FETCH_AR;
                  elsif qid_q = '1' and cqe_sq_head_q /= io_sq_tail_q then
                    fetch_index_q <= (others => '0');
                    dma_addr_q <= std_logic_vector(unsigned(io_sq_base_q(31 downto 0)) + shift_left(resize(cqe_sq_head_q, 32), 6));
                    dma_arvalid_q <= '1'; state_q <= S_FETCH_AR;
                  end if;
                else
                  cqe_index_q <= cqe_index_q + 1; dma_addr_q <= std_logic_vector(unsigned(dma_addr_q) + 4);
                  if cqe_index_q = 0 then dma_wdata_q <= (others => '0');
                  elsif cqe_index_q = 1 then dma_wdata_q <= cqe_word(to_unsigned(2, 3), fw_result_q, fw_status_q, sqe_q(0), cqe_sq_head_q, qid_q, cqe_phase_snapshot_q);
                  elsif cqe_index_q = 2 then dma_wdata_q <= cqe_word(to_unsigned(3, 3), fw_result_q, fw_status_q, sqe_q(0), cqe_sq_head_q, qid_q, cqe_phase_snapshot_q); end if;
                  dma_awvalid_q <= '1'; dma_wvalid_q <= '1'; state_q <= S_CQE_AW_W;
                end if;
              end if;
            when S_FW_DMA_AR =>
              if dma_arvalid_q = '1' and m_axi_arready = '1' then dma_arvalid_q <= '0'; dma_rready_q <= '1'; state_q <= S_FW_DMA_R; end if;
            when S_FW_DMA_R =>
              if dma_rready_q = '1' and m_axi_rvalid = '1' then
                dma_rready_q <= '0';
                if m_axi_rresp /= "00" or m_axi_rlast /= '1' then fw_dma_error_q <= '1';
                else dma_rdata_q <= m_axi_rdata; end if;
                state_q <= S_MAILBOX;
              end if;
            when S_FW_DMA_AW_W =>
              if dma_awvalid_q = '1' and m_axi_awready = '1' then dma_awvalid_q <= '0'; end if;
              if dma_wvalid_q = '1' and m_axi_wready = '1' then dma_wvalid_q <= '0'; end if;
              if (dma_awvalid_q = '0' or m_axi_awready = '1') and (dma_wvalid_q = '0' or m_axi_wready = '1') then dma_bready_q <= '1'; state_q <= S_FW_DMA_B; end if;
            when S_FW_DMA_B =>
              if dma_bready_q = '1' and m_axi_bvalid = '1' then
                dma_bready_q <= '0';
                if m_axi_bresp /= "00" then fw_dma_error_q <= '1'; end if;
                state_q <= S_MAILBOX;
              end if;
            when S_MAILBOX => null;
            when S_IDLE => null;
          end case;
        end if;
      end if;
    end if;
  end process;
end architecture rtl;
