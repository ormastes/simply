library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;
use std.textio.all;
use ieee.std_logic_textio.all;

entity rv32_exec_core is
  generic (
    CLK_FREQ : natural := 100000000;
    BAUD_RATE : natural := 115200
  );
  port (
    clk : in std_logic;
    rst : in std_logic;
    uart_tx : out std_logic;
    debug_uart_valid : out std_logic;
    debug_uart_byte : out std_logic_vector(7 downto 0);
    debug_pc : out std_logic_vector(15 downto 0);
    debug_ins : out std_logic_vector(31 downto 0);
    debug_a0 : out std_logic_vector(7 downto 0);
    debug_ra : out std_logic_vector(15 downto 0);
    debug_sp : out std_logic_vector(15 downto 0);
    debug_phase : out std_logic_vector(3 downto 0);
    -- Lane KK: ADDITIVE external debug read ports for the JTAG Debug Module.
    -- dbg_reg_addr selects x0..x31; dbg_reg_data returns the full 32-bit
    -- committed register value; dbg_pc exposes the full-width program counter.
    -- The input has a safe default so existing instantiations that do not
    -- connect it stay byte-identical; the outputs are pure read-only taps of
    -- regs_q / pc_q and cannot perturb execution.
    dbg_reg_addr : in std_logic_vector(4 downto 0) := (others => '0');
    dbg_reg_data : out std_logic_vector(31 downto 0);
    dbg_pc : out std_logic_vector(31 downto 0)
  );
end entity rv32_exec_core;

architecture rtl of rv32_exec_core is
  constant BASE_ADDR : unsigned(31 downto 0) := x"80000000";
  constant UART_ADDR : unsigned(31 downto 0) := x"10000000";
  constant BAUD_DIV : natural := CLK_FREQ / BAUD_RATE;
  -- 64KB code ROM (14 bits = 16384 words), increased for full payload
  constant ROM_WORDS : natural := 16384;
  constant DATA_ROM_WORDS : natural := 16384;
  type regs_t is array(0 to 31) of unsigned(31 downto 0);
  type rom_t is array(0 to ROM_WORDS - 1) of std_logic_vector(31 downto 0);
  type data_rom_t is array(0 to DATA_ROM_WORDS - 1) of std_logic_vector(31 downto 0);
  type state_t is (S_FETCH, S_EXEC, S_UART, S_DIVIDE, S_LOAD, S_STORE);
  -- Deferred (synchronous-BRAM) load bookkeeping
  type ld_kind_t is (LD_WORD, LD_LB, LD_LBU);

  impure function init_rom return rom_t is
    file f : text open read_mode is "rv32_payload.mem";
    variable line_v : line;
    variable word_v : std_logic_vector(31 downto 0);
    variable mem_v : rom_t := (others => x"00000013");
    variable idx : natural := 0;
  begin
    while not endfile(f) loop
      readline(f, line_v);
      hread(line_v, word_v);
      if idx < ROM_WORDS then
        mem_v(idx) := word_v;
      end if;
      idx := idx + 1;
    end loop;
    return mem_v;
  end function;

  impure function init_data_rom return data_rom_t is
    file f : text open read_mode is "rv32_fat32.mem";
    variable line_v : line;
    variable word_v : std_logic_vector(31 downto 0);
    variable mem_v : data_rom_t := (others => x"00000000");
    variable idx : natural := 0;
  begin
    while not endfile(f) loop
      readline(f, line_v);
      hread(line_v, word_v);
      if idx < DATA_ROM_WORDS then
        mem_v(idx) := word_v;
      end if;
      idx := idx + 1;
    end loop;
    return mem_v;
  end function;

  -- Replicated code RAM: two identical physical copies, written identically.
  -- Each copy has exactly ONE synchronous read port (address muxed by FSM
  -- state) plus the shared write port -> simple-dual-port BRAM inferable.
  -- rom_a serves fetch word 0 and all data-side reads (loads / sb RMW, which
  -- happen in states where fetch is idle); rom_b serves fetch word 1
  -- (pc_idx + 1, needed for misaligned 32-bit instructions).
  signal rom_a : rom_t := init_rom;
  signal rom_b : rom_t := init_rom;
  signal data_rom : data_rom_t := init_data_rom;
  -- CSR file: minimal set for zicsr (mhartid=0, mstatus, mtvec, mie, mip)
  signal csr_mhartid : unsigned(31 downto 0) := x"00000000";
  signal csr_mstatus : unsigned(31 downto 0) := x"00000000";
  signal csr_mtvec : unsigned(31 downto 0) := x"00000000";
  signal csr_mie : unsigned(31 downto 0) := x"00000000";
  signal csr_mip : unsigned(31 downto 0) := x"00000000";
  -- Divider FSM state (multi-cycle for div/divu/rem/remu)
  signal div_op_q : std_logic_vector(2 downto 0) := (others => '0');
  signal div_running_q : std_logic := '0';
  signal div_sign_q : std_logic := '0';
  signal div_rem_q : std_logic := '0';
  signal div_neg_result_q : std_logic := '0';
  signal div_dividend_q : signed(63 downto 0) := (others => '0');
  signal div_divisor_q : signed(63 downto 0) := (others => '0');
  signal div_quotient_q : signed(31 downto 0) := (others => '0');
  signal div_count_q : unsigned(5 downto 0) := (others => '0');
  signal div_rd_q : natural range 0 to 31 := 0;
  signal div_result_q : unsigned(31 downto 0) := (others => '0');
  attribute rom_style : string;
  attribute ram_style : string;
  attribute ram_style of rom_a : signal is "block";
  attribute ram_style of rom_b : signal is "block";
  attribute rom_style of data_rom : signal is "block";
  -- Registered BRAM read data (one read port per physical array)
  signal rom_a_q : std_logic_vector(31 downto 0) := (others => '0');
  signal rom_b_q : std_logic_vector(31 downto 0) := (others => '0');
  signal data_rom_q : std_logic_vector(31 downto 0) := (others => '0');
  -- Deferred load / byte-store state
  signal ld_rd_q : natural range 0 to 31 := 0;
  signal ld_kind_q : ld_kind_t := LD_WORD;
  signal ld_lane_q : natural range 0 to 3 := 0;
  signal ld_src_data_q : std_logic := '0';
  signal st_idx_q : natural range 0 to ROM_WORDS - 1 := 0;
  signal st_lane_q : natural range 0 to 3 := 0;
  signal st_byte_q : std_logic_vector(7 downto 0) := (others => '0');
  signal regs_q : regs_t := (others => (others => '0'));
  signal pc_q : unsigned(31 downto 0) := BASE_ADDR;
  signal state_q : state_t := S_FETCH;
  signal next_pc_q : unsigned(31 downto 0) := BASE_ADDR;
  signal uart_tx_q : std_logic := '1';
  signal uart_busy_q : std_logic := '0';
  signal uart_baud_q : natural range 0 to CLK_FREQ := 0;
  signal uart_bits_q : natural range 0 to 10 := 0;
  signal uart_shift_q : std_logic_vector(9 downto 0) := (others => '1');
  signal debug_uart_valid_q : std_logic := '0';
  signal debug_uart_valid_next_q : std_logic := '0';
  signal debug_uart_byte_q : std_logic_vector(7 downto 0) := (others => '0');
  signal debug_pc_q : std_logic_vector(15 downto 0) := (others => '0');
  signal debug_ins_q : std_logic_vector(31 downto 0) := (others => '0');
  signal debug_a0_q : std_logic_vector(7 downto 0) := (others => '0');
  signal debug_ra_q : std_logic_vector(15 downto 0) := (others => '0');
  signal debug_sp_q : std_logic_vector(15 downto 0) := (others => '0');
  signal debug_phase_q : std_logic_vector(3 downto 0) := (others => '0');

  function sext(v : std_logic_vector) return unsigned is
  begin
    return unsigned(resize(signed(v), 32));
  end function;

  function c_addi4spn_imm(h : std_logic_vector(15 downto 0)) return unsigned is
    variable imm : unsigned(9 downto 0) := (others => '0');
  begin
    imm(5 downto 4) := unsigned(h(12 downto 11));
    imm(9 downto 6) := unsigned(h(10 downto 7));
    imm(2) := h(6);
    imm(3) := h(5);
    return resize(imm, 32);
  end function;

  function c_addi_imm(h : std_logic_vector(15 downto 0)) return unsigned is
  begin
    return sext(h(12) & h(6 downto 2));
  end function;

  function c_lw_imm(h : std_logic_vector(15 downto 0)) return unsigned is
    variable imm : unsigned(6 downto 0) := (others => '0');
  begin
    -- RVC CL/CS-format word offset (C.LW / C.SW):
    --   imm[5:3] = inst[12:10], imm[2] = inst[6], imm[6] = inst[5].
    -- The earlier mapping mis-placed the fields (imm[5]:=inst[5],
    -- imm[4:2]:=inst[12:10], imm[6]:=inst[6]), decoding C.LW s0,4(s1) as
    -- offset 0x40 instead of 0x4 -> loads/stores hit the wrong word
    -- (GHDL vs QEMU divergence at pc 0x80002580 reading 0x80008E04).
    imm(5 downto 3) := unsigned(h(12 downto 10));
    imm(2) := h(6);
    imm(6) := h(5);
    return resize(imm, 32);
  end function;

  function c_lwsp_imm(h : std_logic_vector(15 downto 0)) return unsigned is
    variable imm : unsigned(7 downto 0) := (others => '0');
  begin
    imm(5) := h(12);
    imm(4 downto 2) := unsigned(h(6 downto 4));
    imm(7 downto 6) := unsigned(h(3 downto 2));
    return resize(imm, 32);
  end function;

  function c_swsp_imm(h : std_logic_vector(15 downto 0)) return unsigned is
    variable imm : unsigned(7 downto 0) := (others => '0');
  begin
    imm(5 downto 2) := unsigned(h(12 downto 9));
    imm(7 downto 6) := unsigned(h(8 downto 7));
    return resize(imm, 32);
  end function;

  function c_lui_imm(h : std_logic_vector(15 downto 0)) return unsigned is
  begin
    return sext(h(12) & h(6 downto 2) & "000000000000");
  end function;

  function c_addi16sp_imm(h : std_logic_vector(15 downto 0)) return unsigned is
    variable imm : std_logic_vector(9 downto 0) := (others => '0');
  begin
    imm(9) := h(12);
    imm(4) := h(6);
    imm(6) := h(5);
    imm(8 downto 7) := h(4 downto 3);
    imm(5) := h(2);
    return sext(imm);
  end function;

  function c_j_imm(h : std_logic_vector(15 downto 0)) return unsigned is
    variable imm : std_logic_vector(11 downto 0) := (others => '0');
  begin
    imm(11) := h(12);
    imm(4) := h(11);
    imm(9 downto 8) := h(10 downto 9);
    imm(10) := h(8);
    imm(6) := h(7);
    imm(7) := h(6);
    imm(3 downto 1) := h(5 downto 3);
    imm(5) := h(2);
    return sext(imm);
  end function;

  function c_b_imm(h : std_logic_vector(15 downto 0)) return unsigned is
    variable imm : std_logic_vector(8 downto 0) := (others => '0');
  begin
    imm(8) := h(12);
    imm(4 downto 3) := h(11 downto 10);
    imm(7 downto 6) := h(6 downto 5);
    imm(2 downto 1) := h(4 downto 3);
    imm(5) := h(2);
    return sext(imm);
  end function;

  function word_index(addr : unsigned(31 downto 0)) return natural is
    variable off : unsigned(31 downto 0);
  begin
    off := addr - BASE_ADDR;
    return to_integer(off(15 downto 2));
  end function;

  function data_rom_index(addr : unsigned(31 downto 0)) return natural is
    variable off : unsigned(31 downto 0);
  begin
    off := addr - x"40000000";
    return to_integer(off(15 downto 2));
  end function;

  -- NOTE: the former impure load_word/load_byte helpers performed
  -- asynchronous multi-port reads of rom/data_rom, which forced 16k-deep
  -- LUTRAM and killed K26 placement. Loads from rom/data_rom are now
  -- deferred one cycle through the S_LOAD state using the registered
  -- single-port BRAM reads (rom_a_q / data_rom_q). Word index ranges:
  -- word_index/data_rom_index return off(15 downto 2), i.e. 0..16383, so
  -- in-region indexes are always < ROM_WORDS / DATA_ROM_WORDS and loads
  -- from nibble-4/nibble-8 regions always hit data_rom/rom respectively
  -- (identical to the old guard outcomes).
begin
  uart_tx <= uart_tx_q;
  debug_uart_valid <= debug_uart_valid_q;
  debug_uart_byte <= debug_uart_byte_q;
  debug_pc <= debug_pc_q;
  debug_ins <= debug_ins_q;
  debug_a0 <= debug_a0_q;
  debug_ra <= debug_ra_q;
  debug_sp <= debug_sp_q;
  debug_phase <= debug_phase_q;
  -- Lane KK: additive read-only debug taps (combinational, no state added).
  dbg_reg_data <= std_logic_vector(regs_q(to_integer(unsigned(dbg_reg_addr))));
  dbg_pc <= std_logic_vector(pc_q);

  process(clk)
    variable r : regs_t;
    variable pc_next : unsigned(31 downto 0);
    variable pc_idx : natural;
    variable w : std_logic_vector(31 downto 0);
    variable w2 : std_logic_vector(31 downto 0);
    variable h : std_logic_vector(15 downto 0);
    variable ins : std_logic_vector(31 downto 0);
    variable op : std_logic_vector(6 downto 0);
    variable rd : natural range 0 to 31;
    variable rs1 : natural range 0 to 31;
    variable rs2 : natural range 0 to 31;
    variable eff : unsigned(31 downto 0);
    variable data_w : std_logic_vector(31 downto 0);
    variable crs1 : natural range 0 to 31;
    variable crs2 : natural range 0 to 31;
    variable mem_idx : natural;
    variable load_addr : unsigned(31 downto 0);
    variable mul_result : signed(31 downto 0);
    variable mul_result_full : signed(63 downto 0);
    variable rs1_signed : signed(31 downto 0);
    variable rs2_signed : signed(31 downto 0);
    variable dvd : signed(63 downto 0);
    variable res32 : unsigned(31 downto 0);
    -- Single muxed read address per physical memory + funneled write port
    variable rom_ra_a : natural range 0 to ROM_WORDS - 1;
    variable rom_ra_b : natural range 0 to ROM_WORDS - 1;
    variable dr_ra : natural range 0 to DATA_ROM_WORDS - 1;
    variable rom_we : boolean;
    variable rom_wa : natural range 0 to ROM_WORDS - 1;
    variable rom_wd : std_logic_vector(31 downto 0);
    variable idxp1 : natural;
    variable ld_w : std_logic_vector(31 downto 0);
  begin
    if rising_edge(clk) then
      -- Default memory port addressing: prefetch current pc words. States
      -- that need a data-side read (S_EXEC issuing a load or sb RMW)
      -- override rom_ra_a / dr_ra below before the registered reads at the
      -- bottom of this process.
      rom_we := false;
      rom_wa := 0;
      rom_wd := (others => '0');
      pc_idx := word_index(pc_q);
      rom_ra_a := pc_idx;
      idxp1 := pc_idx + 1;
      if idxp1 < ROM_WORDS then
        rom_ra_b := idxp1;
      else
        rom_ra_b := ROM_WORDS - 1;
      end if;
      dr_ra := 0;
      debug_uart_valid_q <= debug_uart_valid_next_q;
      debug_uart_valid_next_q <= '0';
      if uart_busy_q = '1' then
        if uart_baud_q >= BAUD_DIV - 1 then
          uart_baud_q <= 0;
          if uart_bits_q > 1 then
            uart_tx_q <= uart_shift_q(1);
            uart_shift_q <= '1' & uart_shift_q(9 downto 1);
            uart_bits_q <= uart_bits_q - 1;
          else
            uart_tx_q <= '1';
            uart_busy_q <= '0';
            uart_bits_q <= 0;
          end if;
        else
          uart_baud_q <= uart_baud_q + 1;
        end if;
      end if;

      if rst = '1' then
        regs_q <= (others => (others => '0'));
        pc_q <= BASE_ADDR;
        next_pc_q <= BASE_ADDR;
        state_q <= S_FETCH;
        ld_rd_q <= 0;
        ld_kind_q <= LD_WORD;
        ld_lane_q <= 0;
        ld_src_data_q <= '0';
        st_idx_q <= 0;
        st_lane_q <= 0;
        st_byte_q <= (others => '0');
        uart_tx_q <= '1';
        uart_busy_q <= '0';
        uart_baud_q <= 0;
        uart_bits_q <= 0;
        uart_shift_q <= (others => '1');
        debug_uart_valid_q <= '0';
        debug_uart_valid_next_q <= '0';
        debug_uart_byte_q <= (others => '0');
        debug_pc_q <= (others => '0');
        debug_ins_q <= (others => '0');
        debug_a0_q <= (others => '0');
        debug_ra_q <= (others => '0');
        debug_sp_q <= (others => '0');
        debug_phase_q <= (others => '0');
        csr_mhartid <= (others => '0');
        csr_mstatus <= (others => '0');
        csr_mtvec <= (others => '0');
        csr_mie <= (others => '0');
        csr_mip <= (others => '0');
        div_running_q <= '0';
        div_op_q <= (others => '0');
        div_sign_q <= '0';
        div_rem_q <= '0';
        div_neg_result_q <= '0';
        div_dividend_q <= (others => '0');
        div_divisor_q <= (others => '0');
        div_quotient_q <= (others => '0');
        div_count_q <= (others => '0');
        div_rd_q <= 0;
        div_result_q <= (others => '0');
      elsif state_q = S_UART then
        if uart_busy_q = '0' then
          pc_q <= next_pc_q;
          state_q <= S_FETCH;
        end if;
      elsif state_q = S_DIVIDE then
        -- Multi-cycle divider FSM
        if div_count_q /= 0 then
          div_count_q <= div_count_q - 1;
          -- Shift first, then compare/subtract the SHIFTED remainder (restoring division)
          dvd := shift_left(div_dividend_q, 1);
          -- restoring division: UNSIGNED compare of the 32-bit partial remainder
          -- (high half, after shift) vs the 32-bit divisor magnitude.
          if unsigned(dvd(63 downto 32)) >= unsigned(div_divisor_q(31 downto 0)) then
            dvd(63 downto 32) := dvd(63 downto 32) - div_divisor_q(31 downto 0);
            div_quotient_q <= shift_left(div_quotient_q, 1) + 1;
          else
            div_quotient_q <= shift_left(div_quotient_q, 1);
          end if;
          div_dividend_q <= dvd;
        else
          div_running_q <= '0';
          state_q <= S_FETCH;
          -- Compute the final result into res32, then write it DIRECTLY to the
          -- register file here (signal assignment, effective the cycle S_EXEC
          -- resumes). This makes the result visible to the next instruction via
          -- r:=regs_q, avoiding the load-use hazard where the post-div/rem
          -- instruction would otherwise read the stale register.
          if div_rem_q = '1' then
            -- After 32 left-shifts, remainder is in bits 63:32
            if div_neg_result_q = '1' then
              res32 := unsigned(-signed(div_dividend_q(63 downto 32)));
            else
              res32 := unsigned(div_dividend_q(63 downto 32));
            end if;
          else
            if div_neg_result_q = '1' then
              res32 := unsigned(-div_quotient_q);
            else
              res32 := unsigned(div_quotient_q);
            end if;
          end if;
          div_result_q <= res32;
          if div_rd_q /= 0 then
            regs_q(div_rd_q) <= res32;
          end if;
          div_rd_q <= 0;
        end if;
      elsif state_q = S_FETCH then
        -- Fetch cycle: registered BRAM reads at the bottom of this process
        -- latch rom_a(pc_idx) / rom_b(pc_idx + 1) this edge (default
        -- addressing above); decode + execute happens next cycle in S_EXEC.
        state_q <= S_EXEC;
      elsif state_q = S_LOAD then
        -- Complete a deferred rom/data_rom load using the data registered on
        -- the previous edge.
        if ld_src_data_q = '1' then
          ld_w := data_rom_q;
        else
          ld_w := rom_a_q;
        end if;
        if ld_rd_q /= 0 then
          case ld_kind_q is
            when LD_WORD =>
              regs_q(ld_rd_q) <= unsigned(ld_w);
            when LD_LB =>
              regs_q(ld_rd_q) <= sext(ld_w(ld_lane_q * 8 + 7 downto ld_lane_q * 8));
            when LD_LBU =>
              regs_q(ld_rd_q) <= resize(unsigned(ld_w(ld_lane_q * 8 + 7 downto ld_lane_q * 8)), 32);
          end case;
        end if;
        state_q <= S_FETCH;
      elsif state_q = S_STORE then
        -- Complete an sb read-modify-write to the code RAM: rom_a_q holds
        -- the word registered last edge; merge the byte lane and write both
        -- physical copies via the funneled write port.
        data_w := rom_a_q;
        data_w(st_lane_q * 8 + 7 downto st_lane_q * 8) := st_byte_q;
        rom_we := true;
        rom_wa := st_idx_q;
        rom_wd := data_w;
        state_q <= S_FETCH;
      else
        r := regs_q;
        -- Default next state: back to fetch (overridden below by UART /
        -- DIVIDE / deferred LOAD / deferred STORE transitions).
        state_q <= S_FETCH;
        pc_next := pc_q + 4;
        -- pc_idx was set in the per-cycle defaults; instruction words were
        -- registered from the replicated BRAMs during S_FETCH.
        if pc_idx < ROM_WORDS then
          w := rom_a_q;
        else
          w := x"00000013";
        end if;
        if pc_q(1) = '0' then
          h := w(15 downto 0);
          ins := w;
        else
          h := w(31 downto 16);
          if pc_idx + 1 < ROM_WORDS then
            w2 := rom_b_q;
          else
            w2 := x"00000013";
          end if;
          ins := w2(15 downto 0) & w(31 downto 16);
        end if;

        if h(1 downto 0) /= "11" then
          pc_next := pc_q + 2;
          if h(1 downto 0) = "01" then
            case h(15 downto 13) is
              when "000" =>
                rd := to_integer(unsigned(h(11 downto 7)));
                if rd /= 0 then
                  r(rd) := r(rd) + c_addi_imm(h);
                end if;
              when "001" =>
                r(1) := pc_q + 2;
                pc_next := pc_q + c_j_imm(h);
              when "010" =>
                rd := to_integer(unsigned(h(11 downto 7)));
                if rd /= 0 then
                  r(rd) := c_addi_imm(h);
                end if;
              when "011" =>
                rd := to_integer(unsigned(h(11 downto 7)));
                if rd = 2 then
                  r(2) := r(2) + c_addi16sp_imm(h);
                elsif rd /= 0 then
                  r(rd) := c_lui_imm(h);
                end if;
              when "100" =>
                -- C1 MISC-ALU group. h(11 downto 10) selects the sub-op; the
                -- earlier decode looked only at h(12) and so mis-ran C.SRAI,
                -- C.SUB/C.XOR/C.OR/C.AND (and small-immediate C.ANDI) all as
                -- C.SRLI. Decode the full field.
                rd := 8 + to_integer(unsigned(h(9 downto 7)));  -- rd'/rs1'
                case h(11 downto 10) is
                  when "00" => -- C.SRLI (rv32: shamt = h(6 downto 2), h(12)=0)
                    r(rd) := shift_right(r(rd), to_integer(unsigned(h(6 downto 2))));
                  when "01" => -- C.SRAI (arithmetic)
                    r(rd) := unsigned(shift_right(signed(r(rd)), to_integer(unsigned(h(6 downto 2)))));
                  when "10" => -- C.ANDI (sign-extended CI immediate)
                    r(rd) := r(rd) and c_addi_imm(h);
                  when others => -- "11": CA-format register-register ops
                    rs2 := 8 + to_integer(unsigned(h(4 downto 2)));  -- rs2'
                    case h(6 downto 5) is
                      when "00" => r(rd) := r(rd) - r(rs2);    -- C.SUB
                      when "01" => r(rd) := r(rd) xor r(rs2);  -- C.XOR
                      when "10" => r(rd) := r(rd) or r(rs2);   -- C.OR
                      when others => r(rd) := r(rd) and r(rs2);-- C.AND
                    end case;
                end case;
              when "101" =>
                pc_next := pc_q + c_j_imm(h);
              when "110" =>
                rs1 := 8 + to_integer(unsigned(h(9 downto 7)));
                if r(rs1) = 0 then
                  pc_next := pc_q + c_b_imm(h);
                end if;
              when others =>
                rs1 := 8 + to_integer(unsigned(h(9 downto 7)));
                if r(rs1) /= 0 then
                  pc_next := pc_q + c_b_imm(h);
                end if;
            end case;
          end if;

          if h(1 downto 0) = "00" then
            if h(15 downto 13) = "000" then
              rd := 8 + to_integer(unsigned(h(4 downto 2)));
              r(rd) := r(2) + c_addi4spn_imm(h);
            elsif h(15 downto 13) = "010" then
              rd := 8 + to_integer(unsigned(h(4 downto 2)));
              rs1 := 8 + to_integer(unsigned(h(9 downto 7)));
              load_addr := r(rs1) + c_lw_imm(h);
              mem_idx := word_index(load_addr);
                -- Deferred sync-BRAM load (was: r(rd) := load_word(load_addr))
                if load_addr(31 downto 28) = x"4" then
                  dr_ra := data_rom_index(load_addr);
                  ld_src_data_q <= '1';
                  ld_rd_q <= rd;
                  ld_kind_q <= LD_WORD;
                  state_q <= S_LOAD;
                elsif load_addr(31 downto 28) = x"8" then
                  rom_ra_a := word_index(load_addr);
                  ld_src_data_q <= '0';
                  ld_rd_q <= rd;
                  ld_kind_q <= LD_WORD;
                  state_q <= S_LOAD;
                else
                  r(rd) := (others => '0');
                end if;
            elsif h(15 downto 13) = "110" then
              rs1 := 8 + to_integer(unsigned(h(9 downto 7)));
              rs2 := 8 + to_integer(unsigned(h(4 downto 2)));
              eff := r(rs1) + c_lw_imm(h);
              mem_idx := word_index(eff);
              if mem_idx < ROM_WORDS then
                rom_we := true;
                rom_wa := mem_idx;
                rom_wd := std_logic_vector(r(rs2));
              end if;
            end if;
          elsif h(1 downto 0) = "10" then
            if h(15 downto 13) = "000" then
              rd := to_integer(unsigned(h(11 downto 7)));
              if rd /= 0 then
                r(rd) := shift_left(r(rd), to_integer(unsigned(h(6 downto 2))));
              end if;
            elsif h(15 downto 13) = "010" then
              rd := to_integer(unsigned(h(11 downto 7)));
              if rd /= 0 then
                load_addr := r(2) + c_lwsp_imm(h);
                mem_idx := word_index(load_addr);
                  -- Deferred sync-BRAM load (was: r(rd) := load_word(load_addr))
                  if load_addr(31 downto 28) = x"4" then
                    dr_ra := data_rom_index(load_addr);
                    ld_src_data_q <= '1';
                    ld_rd_q <= rd;
                    ld_kind_q <= LD_WORD;
                    state_q <= S_LOAD;
                  elsif load_addr(31 downto 28) = x"8" then
                    rom_ra_a := word_index(load_addr);
                    ld_src_data_q <= '0';
                    ld_rd_q <= rd;
                    ld_kind_q <= LD_WORD;
                    state_q <= S_LOAD;
                  else
                    r(rd) := (others => '0');
                  end if;
              end if;
            elsif h(15 downto 13) = "100" then
              rd := to_integer(unsigned(h(11 downto 7)));
              rs2 := to_integer(unsigned(h(6 downto 2)));
              if h(12) = '0' then
                -- c.jr rs1 (rs2=0) / c.mv rd,rs2 (rs2/=0)
                if rs2 = 0 then
                  if rd /= 0 then
                    pc_next := r(rd);
                  end if;
                elsif rd /= 0 then
                  r(rd) := r(rs2);
                end if;
              else
                -- c.jalr rs1 (rs2=0): ra=pc+2, pc=rs1  /  c.add rd,rs2 (rs2/=0): rd+=rs2
                if rs2 = 0 then
                  if rd /= 0 then
                    pc_next := r(rd);
                    r(1) := pc_q + 2;
                  end if;
                elsif rd /= 0 then
                  r(rd) := r(rd) + r(rs2);
                end if;
              end if;
            elsif h(15 downto 13) = "110" then
              rs2 := to_integer(unsigned(h(6 downto 2)));
              eff := r(2) + c_swsp_imm(h);
              mem_idx := word_index(eff);
              if mem_idx < ROM_WORDS then
                rom_we := true;
                rom_wa := mem_idx;
                rom_wd := std_logic_vector(r(rs2));
              end if;
            end if;
          end if;
        else
          op := ins(6 downto 0);
          rd := to_integer(unsigned(ins(11 downto 7)));
          rs1 := to_integer(unsigned(ins(19 downto 15)));
          rs2 := to_integer(unsigned(ins(24 downto 20)));
          case op is
            when "0010011" =>
              if rd /= 0 then
                case ins(14 downto 12) is
                  when "000" => r(rd) := r(rs1) + sext(ins(31 downto 20));
                  when "111" => r(rd) := r(rs1) and sext(ins(31 downto 20));
                  when "100" => r(rd) := r(rs1) xor sext(ins(31 downto 20));
                  when "110" => r(rd) := r(rs1) or sext(ins(31 downto 20));
                  when "010" =>
                    if signed(r(rs1)) < signed(sext(ins(31 downto 20))) then r(rd) := to_unsigned(1, 32); else r(rd) := (others => '0'); end if;
                  when "011" =>
                    if r(rs1) < sext(ins(31 downto 20)) then r(rd) := to_unsigned(1, 32); else r(rd) := (others => '0'); end if;
                  when "001" => r(rd) := shift_left(r(rs1), to_integer(unsigned(ins(24 downto 20))));
                  when "101" =>
                    if ins(30) = '1' then r(rd) := unsigned(shift_right(signed(r(rs1)), to_integer(unsigned(ins(24 downto 20)))));
                    else r(rd) := shift_right(r(rs1), to_integer(unsigned(ins(24 downto 20)))); end if;
                  when others => null;
                end case;
              end if;
            when "0110011" =>
              if rd /= 0 then
                if ins(31 downto 25) = "0000001" then
                  -- M-extension (funct7=0000001)
                  case ins(14 downto 12) is
                    when "000" => -- mul (full 32-bit multiply, take low 32 bits)
                      mul_result_full := signed(unsigned(r(rs1))) * signed(unsigned(r(rs2)));
                      r(rd) := unsigned(mul_result_full(31 downto 0));
                    when "001" => -- mulh (signed * signed, high 32 bits)
                      mul_result_full := signed(r(rs1)) * signed(r(rs2));
                      r(rd) := unsigned(mul_result_full(63 downto 32));
                    when "010" => -- mulhsu (signed * unsigned, high 32 bits)
                      -- correction form (all 64-bit, synth-safe): for a<0,
                      -- signed(a)*unsigned(b) = a_unsigned*b - 2^32*b
                      mul_result_full := signed(unsigned(r(rs1)) * unsigned(r(rs2)));
                      if signed(r(rs1)) < 0 then
                        mul_result_full := mul_result_full - shift_left(resize(signed(unsigned(r(rs2))), 64), 32);
                      end if;
                      r(rd) := unsigned(mul_result_full(63 downto 32));
                    when "011" => -- mulhu (unsigned * unsigned, high 32 bits)
                      mul_result_full := signed(unsigned(r(rs1)) * unsigned(r(rs2)));
                      r(rd) := unsigned(mul_result_full(63 downto 32));
                    when "100" => -- div (signed, truncate toward zero)
                      if r(rs2) = 0 then
                        r(rd) := x"FFFFFFFF";
                      elsif signed(r(rs1)) = -16#80000000# and r(rs2) = x"FFFFFFFF" then
                        r(rd) := x"80000000";
                      else
                        -- Start multi-cycle division
                        div_running_q <= '1';
                        div_op_q <= "100";
                        div_sign_q <= '1';
                        div_rem_q <= '0';
                        div_rd_q <= rd;
                        rs1_signed := signed(r(rs1));
                        rs2_signed := signed(r(rs2));
                        -- Quotient needs negation if signs differ
                        if (rs1_signed < 0) /= (rs2_signed < 0) then
                          div_neg_result_q <= '1';
                        else
                          div_neg_result_q <= '0';
                        end if;
                        if rs1_signed < 0 then
                          div_dividend_q <= to_signed(0, 32) & resize(-rs1_signed, 32);
                        else
                          div_dividend_q <= to_signed(0, 32) & rs1_signed;
                        end if;
                        if rs2_signed < 0 then
                          div_divisor_q <= to_signed(0, 32) & resize(-rs2_signed, 32);
                        else
                          div_divisor_q <= to_signed(0, 32) & rs2_signed;
                        end if;
                        div_divisor_q(63 downto 32) <= (others => '0');
                        div_count_q <= to_unsigned(32, 6);
                        div_quotient_q <= (others => '0');
                        state_q <= S_DIVIDE;
                      end if;
                    when "101" => -- divu (unsigned)
                      if r(rs2) = 0 then
                        r(rd) := x"FFFFFFFF";
                      else
                        -- Start multi-cycle unsigned division
                        div_running_q <= '1';
                        div_op_q <= "101";
                        div_sign_q <= '0';
                        div_rem_q <= '0';
                        div_neg_result_q <= '0';
                        div_rd_q <= rd;
                        rs1_signed := signed(r(rs1));
                        rs2_signed := signed(r(rs2));
                        div_dividend_q <= to_signed(0, 32) & rs1_signed;
                        div_divisor_q <= to_signed(0, 32) & rs2_signed;
                        div_count_q <= to_unsigned(32, 6);
                        div_quotient_q <= (others => '0');
                        state_q <= S_DIVIDE;
                      end if;
                    when "110" => -- rem (signed remainder)
                      if r(rs2) = 0 then
                        r(rd) := r(rs1);
                      elsif signed(r(rs1)) = -16#80000000# and r(rs2) = x"FFFFFFFF" then
                        r(rd) := x"00000000";
                      else
                        -- Start multi-cycle signed remainder
                        div_running_q <= '1';
                        div_op_q <= "110";
                        div_sign_q <= '1';
                        div_rem_q <= '1';
                        div_rd_q <= rd;
                        rs1_signed := signed(r(rs1));
                        rs2_signed := signed(r(rs2));
                        -- Remainder inherits dividend's sign
                        if rs1_signed < 0 then
                          div_neg_result_q <= '1';
                        else
                          div_neg_result_q <= '0';
                        end if;
                        if rs1_signed < 0 then
                          div_dividend_q <= to_signed(0, 32) & resize(-rs1_signed, 32);
                        else
                          div_dividend_q <= to_signed(0, 32) & rs1_signed;
                        end if;
                        if rs2_signed < 0 then
                          div_divisor_q <= to_signed(0, 32) & resize(-rs2_signed, 32);
                        else
                          div_divisor_q <= to_signed(0, 32) & rs2_signed;
                        end if;
                        div_divisor_q(63 downto 32) <= (others => '0');
                        div_count_q <= to_unsigned(32, 6);
                        div_quotient_q <= (others => '0');
                        state_q <= S_DIVIDE;
                      end if;
                    when "111" => -- remu (unsigned remainder)
                      if r(rs2) = 0 then
                        r(rd) := r(rs1);
                      else
                        -- Start multi-cycle unsigned remainder
                        div_running_q <= '1';
                        div_op_q <= "111";
                        div_sign_q <= '0';
                        div_rem_q <= '1';
                        div_neg_result_q <= '0';
                        div_rd_q <= rd;
                        rs1_signed := signed(r(rs1));
                        rs2_signed := signed(r(rs2));
                        div_dividend_q <= to_signed(0, 32) & rs1_signed;
                        div_divisor_q <= to_signed(0, 32) & rs2_signed;
                        div_count_q <= to_unsigned(32, 6);
                        div_quotient_q <= (others => '0');
                        state_q <= S_DIVIDE;
                      end if;
                    when others => null;
                  end case;
                else
                  -- Standard R-type ALU
                  case ins(14 downto 12) is
                    when "000" => if ins(30) = '1' then r(rd) := r(rs1) - r(rs2); else r(rd) := r(rs1) + r(rs2); end if;
                    when "001" => r(rd) := shift_left(r(rs1), to_integer(r(rs2)(4 downto 0)));
                    when "010" => if signed(r(rs1)) < signed(r(rs2)) then r(rd) := to_unsigned(1, 32); else r(rd) := (others => '0'); end if;
                    when "011" => if r(rs1) < r(rs2) then r(rd) := to_unsigned(1, 32); else r(rd) := (others => '0'); end if;
                    when "100" => r(rd) := r(rs1) xor r(rs2);
                    when "101" => if ins(30) = '1' then r(rd) := unsigned(shift_right(signed(r(rs1)), to_integer(r(rs2)(4 downto 0)))); else r(rd) := shift_right(r(rs1), to_integer(r(rs2)(4 downto 0))); end if;
                    when "110" => r(rd) := r(rs1) or r(rs2);
                    when others => r(rd) := r(rs1) and r(rs2);
                  end case;
                end if;
              end if;
            when "0010111" =>
              if rd /= 0 then r(rd) := pc_q + shift_left(resize(unsigned(ins(31 downto 12)), 32), 12); end if;
            when "0110111" =>
              if rd /= 0 then r(rd) := shift_left(resize(unsigned(ins(31 downto 12)), 32), 12); end if;
            when "1101111" =>
              if rd /= 0 then r(rd) := pc_q + 4; end if;
              pc_next := pc_q + sext(ins(31) & ins(19 downto 12) & ins(20) & ins(30 downto 21) & '0');
            when "1100111" =>
              pc_next := (r(rs1) + sext(ins(31 downto 20))) and x"fffffffe";
              if rd /= 0 then r(rd) := pc_q + 4; end if;
            when "1100011" =>
              eff := pc_q + sext(ins(31) & ins(7) & ins(30 downto 25) & ins(11 downto 8) & '0');
              case ins(14 downto 12) is
                when "000" => if r(rs1) = r(rs2) then pc_next := eff; end if;
                when "001" => if r(rs1) /= r(rs2) then pc_next := eff; end if;
                when "100" => if signed(r(rs1)) < signed(r(rs2)) then pc_next := eff; end if;
                when "101" => if signed(r(rs1)) >= signed(r(rs2)) then pc_next := eff; end if;
                when "110" => if r(rs1) < r(rs2) then pc_next := eff; end if;
                when others => if r(rs1) >= r(rs2) then pc_next := eff; end if;
              end case;
            when "0000011" =>
              eff := r(rs1) + sext(ins(31 downto 20));
              if eff = UART_ADDR + x"00000005" then
                -- 16550 UART Line Status Register read. Report THRE|TEMT (0x60)
                -- so the firmware's "wait until TX holding register empty" poll
                -- (lbu 5(uart_base); andi 0x20; beqz loop) makes forward progress.
                -- Without modelling the LSR the soft-core returned 0 here and any
                -- LSR-polling firmware (the minimal NVMe self-test) spun forever
                -- before emitting its first UART byte. QEMU's 16550 models this;
                -- the core must too to run the same firmware. Board-faithful: a
                -- real idle 16550 reads 0x60 in the LSR.
                if rd /= 0 then r(rd) := x"00000060"; end if;
              elsif rd /= 0 then
                case ins(14 downto 12) is
                  when "000" =>
                    mem_idx := word_index(eff);
                      -- Deferred sync-BRAM byte load, sign-extended (was lb via load_byte)
                      if eff(31 downto 28) = x"4" then
                        dr_ra := data_rom_index(eff);
                        ld_src_data_q <= '1';
                        ld_rd_q <= rd;
                        ld_kind_q <= LD_LB;
                        ld_lane_q <= to_integer(eff(1 downto 0));
                        state_q <= S_LOAD;
                      elsif eff(31 downto 28) = x"8" then
                        rom_ra_a := word_index(eff);
                        ld_src_data_q <= '0';
                        ld_rd_q <= rd;
                        ld_kind_q <= LD_LB;
                        ld_lane_q <= to_integer(eff(1 downto 0));
                        state_q <= S_LOAD;
                      else
                        r(rd) := (others => '0');
                      end if;
                  when "100" =>
                    mem_idx := word_index(eff);
                      -- Deferred sync-BRAM byte load, zero-extended (was lbu via load_byte)
                      if eff(31 downto 28) = x"4" then
                        dr_ra := data_rom_index(eff);
                        ld_src_data_q <= '1';
                        ld_rd_q <= rd;
                        ld_kind_q <= LD_LBU;
                        ld_lane_q <= to_integer(eff(1 downto 0));
                        state_q <= S_LOAD;
                      elsif eff(31 downto 28) = x"8" then
                        rom_ra_a := word_index(eff);
                        ld_src_data_q <= '0';
                        ld_rd_q <= rd;
                        ld_kind_q <= LD_LBU;
                        ld_lane_q <= to_integer(eff(1 downto 0));
                        state_q <= S_LOAD;
                      else
                        r(rd) := (others => '0');
                      end if;
                  when others =>
                    mem_idx := word_index(eff);
                      -- Deferred sync-BRAM word load (was: r(rd) := load_word(eff))
                      if eff(31 downto 28) = x"4" then
                        dr_ra := data_rom_index(eff);
                        ld_src_data_q <= '1';
                        ld_rd_q <= rd;
                        ld_kind_q <= LD_WORD;
                        state_q <= S_LOAD;
                      elsif eff(31 downto 28) = x"8" then
                        rom_ra_a := word_index(eff);
                        ld_src_data_q <= '0';
                        ld_rd_q <= rd;
                        ld_kind_q <= LD_WORD;
                        state_q <= S_LOAD;
                      else
                        r(rd) := (others => '0');
                      end if;
                end case;
              end if;
            when "0100011" =>
              eff := r(rs1) + sext(ins(31 downto 25) & ins(11 downto 7));
              if eff = UART_ADDR and ins(14 downto 12) = "000" then
                uart_shift_q <= '1' & std_logic_vector(r(rs2)(7 downto 0)) & '0';
                uart_tx_q <= '0';
                uart_busy_q <= '1';
                uart_baud_q <= 0;
                uart_bits_q <= 10;
                debug_uart_valid_next_q <= '1';
                debug_uart_byte_q <= std_logic_vector(r(rs2)(7 downto 0));
                next_pc_q <= pc_next;
                state_q <= S_UART;
              elsif eff(31 downto 28) = x"8" then
                mem_idx := word_index(eff);
                if mem_idx < ROM_WORDS then
                  -- Store to code ROM (now writable for stack spills)
                  if ins(14 downto 12) = "000" then
                    -- sb (byte store) to ROM: deferred read-modify-write.
                    -- Register the word read this edge; merge + write in S_STORE.
                    rom_ra_a := mem_idx;
                    st_idx_q <= mem_idx;
                    st_lane_q <= to_integer(eff(1 downto 0));
                    st_byte_q <= std_logic_vector(r(rs2)(7 downto 0));
                    state_q <= S_STORE;
                  else
                    -- sw (word store) to ROM
                    rom_we := true;
                    rom_wa := mem_idx;
                    rom_wd := std_logic_vector(r(rs2));
                  end if;
                end if;
              end if;
            when "1110011" =>
              case ins(14 downto 12) is
                when "000" =>
                  -- ecall (funct7=0000000) / ebreak (funct7=0000001)
                  if ins(31 downto 20) = "000000000000" then
                    -- ecall: halt cleanly
                    state_q <= S_FETCH;
                    pc_q <= pc_q;
                    null;
                  elsif ins(31 downto 20) = "000000000001" then
                    -- ebreak: halt cleanly
                    state_q <= S_FETCH;
                    pc_q <= pc_q;
                    null;
                  end if;
                when "001" =>
                  -- csrrw
                  crs1 := to_integer(unsigned(ins(19 downto 15)));
                  if rd /= 0 then
                    case unsigned(ins(31 downto 20)) is
                      when x"f11" => r(rd) := csr_mhartid;
                      when x"300" => r(rd) := csr_mstatus;
                      when x"305" => r(rd) := csr_mtvec;
                      when x"304" => r(rd) := csr_mie;
                      when x"344" => r(rd) := csr_mip;
                      when others => r(rd) := (others => '0');
                    end case;
                  end if;
                  -- Write CSR (ignored for minimal implementation)
                when "010" =>
                  -- csrrs (read-write with set bits)
                  crs1 := to_integer(unsigned(ins(19 downto 15)));
                  if rd /= 0 then
                    case unsigned(ins(31 downto 20)) is
                      when x"f11" => r(rd) := csr_mhartid;
                      when x"300" => r(rd) := csr_mstatus;
                      when x"305" => r(rd) := csr_mtvec;
                      when x"304" => r(rd) := csr_mie;
                      when x"344" => r(rd) := csr_mip;
                      when others => r(rd) := (others => '0');
                    end case;
                  end if;
                  -- Set bits (ignored for minimal implementation)
                when "011" =>
                  -- csrrc (read-write with clear bits)
                  crs1 := to_integer(unsigned(ins(19 downto 15)));
                  if rd /= 0 then
                    case unsigned(ins(31 downto 20)) is
                      when x"f11" => r(rd) := csr_mhartid;
                      when x"300" => r(rd) := csr_mstatus;
                      when x"305" => r(rd) := csr_mtvec;
                      when x"304" => r(rd) := csr_mie;
                      when x"344" => r(rd) := csr_mip;
                      when others => r(rd) := (others => '0');
                    end case;
                  end if;
                  -- Clear bits (ignored for minimal implementation)
                when "101" =>
                  -- csrrwi (immediate version)
                  if rd /= 0 then
                    case unsigned(ins(31 downto 20)) is
                      when x"f11" => r(rd) := csr_mhartid;
                      when x"300" => r(rd) := csr_mstatus;
                      when x"305" => r(rd) := csr_mtvec;
                      when x"304" => r(rd) := csr_mie;
                      when x"344" => r(rd) := csr_mip;
                      when others => r(rd) := (others => '0');
                    end case;
                  end if;
                  -- Write CSR (ignored for minimal implementation)
                when "110" =>
                  -- csrrsi (immediate set bits)
                  if rd /= 0 then
                    case unsigned(ins(31 downto 20)) is
                      when x"f11" => r(rd) := csr_mhartid;
                      when x"300" => r(rd) := csr_mstatus;
                      when x"305" => r(rd) := csr_mtvec;
                      when x"304" => r(rd) := csr_mie;
                      when x"344" => r(rd) := csr_mip;
                      when others => r(rd) := (others => '0');
                    end case;
                  end if;
                  -- Set bits (ignored for minimal implementation)
                when "111" =>
                  -- csrrci (immediate clear bits)
                  if rd /= 0 then
                    case unsigned(ins(31 downto 20)) is
                      when x"f11" => r(rd) := csr_mhartid;
                      when x"300" => r(rd) := csr_mstatus;
                      when x"305" => r(rd) := csr_mtvec;
                      when x"304" => r(rd) := csr_mie;
                      when x"344" => r(rd) := csr_mip;
                      when others => r(rd) := (others => '0');
                    end case;
                  end if;
                  -- Clear bits (ignored for minimal implementation)
                when others => null;
              end case;
            when "0101111" =>
              null;
            when others =>
              null;
          end case;
        end if;

        debug_pc_q <= std_logic_vector(pc_q(15 downto 0));
        debug_ins_q <= ins;
        debug_a0_q <= std_logic_vector(r(10)(7 downto 0));
        debug_ra_q <= std_logic_vector(r(1)(15 downto 0));
        debug_sp_q <= std_logic_vector(r(2)(15 downto 0));
        if pc_q = x"8000CD62" then
          debug_phase_q <= x"1";
        elsif pc_q = x"8000CF50" then
          debug_phase_q <= x"2";
        elsif pc_q = x"80003B8C" then
          debug_phase_q <= x"3";
        elsif pc_q = x"80003BAA" then
          debug_phase_q <= x"4";
        elsif pc_q = x"80003BBE" then
          debug_phase_q <= x"5";
        elsif pc_q = x"8000CF6E" then
          debug_phase_q <= x"6";
        end if;
        r(0) := (others => '0');
        -- Write divider result when complete
        if div_running_q = '0' and div_rd_q /= 0 and state_q = S_EXEC then
          r(div_rd_q) := div_result_q;
          div_rd_q <= 0;
        end if;
        regs_q <= r;
        if state_q = S_EXEC then
          pc_q <= pc_next;
        end if;
      end if;

      -- === Physical memory ports (single read + single write per array) ===
      -- Funneled write port: both code-RAM copies written identically.
      if rom_we then
        rom_a(rom_wa) <= rom_wd;
        rom_b(rom_wa) <= rom_wd;
      end if;
      -- Registered (synchronous) reads: exactly one read port per physical
      -- array, address muxed by FSM state. Read-first semantics (VHDL signal
      -- arrays always read pre-edge contents), matching BRAM read-first.
      rom_a_q <= rom_a(rom_ra_a);
      rom_b_q <= rom_b(rom_ra_b);
      data_rom_q <= data_rom(dr_ra);
    end if;
  end process;
end architecture rtl;
