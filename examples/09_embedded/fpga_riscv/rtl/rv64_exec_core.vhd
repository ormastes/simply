library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;
use std.textio.all;
use ieee.std_logic_textio.all;

-- rv64_exec_core — hand-written synthesizable RV64IM + minimal Zicsr core.
--
-- Route decision (doc/03_plan/hardware/riscv/fpga_board_bringup_jtag_10min_plan_2026-07-24.md,
-- Lane C): this is the widened, structurally diff-able sibling of the proven
-- rv32_exec_core.vhd (multi-cycle, GHDL-clean, K26 board-proven). There is NO
-- .spl -> VHDL backend (generate_rv64_vhdl.shs is BLOCKED on a phantom
-- compile_to_vhdl_module); the .spl model (src/lib/hardware/rv64gc_rtl/) is the
-- differential oracle only. This file is the real synthesizable artifact.
--
-- Scope: RV64IM (base + M multiply/divide) + the RV64 W-suffix word ops
-- (ADDIW/SLLIW/SRLIW/SRAIW, ADDW/SUBW/SLLW/SRLW/SRAW, MULW/DIVW/DIVUW/REMW/REMUW)
-- + a minimal machine-mode Zicsr read set. Machine mode only, no MMU, no FPU,
-- no compressed. Exactly enough to run the Adler-32 soak payload class
-- (MUL/DIV/REMU + loads/stores + a 16550-style UART TX at 0x1000_0000).
--
-- Memory model mirrors rv32's replicated-BRAM discipline but at 64-bit width:
-- two identical physical copies mem_a (instruction fetch) / mem_b (data) each
-- with exactly one synchronous read port + a shared funneled write port, so it
-- infers simple-dual-port BRAM (no async multiport LUTRAM). Loads and sub-word
-- stores are deferred one cycle through S_LOAD / S_STORE using the registered
-- reads mem_a_q / mem_b_q.
entity rv64_exec_core is
  generic (
    CLK_FREQ  : natural := 100000000;
    BAUD_RATE : natural := 115200
  );
  port (
    clk              : in  std_logic;
    rst              : in  std_logic;
    uart_tx          : out std_logic;
    debug_uart_valid : out std_logic;
    debug_uart_byte  : out std_logic_vector(7 downto 0);
    -- Additive read-only debug taps for the JTAG Debug Module (Lane B). Safe
    -- default on the input so instantiations that ignore it stay identical;
    -- the outputs are pure combinational taps of regs_q / pc_q.
    dbg_reg_addr     : in  std_logic_vector(4 downto 0) := (others => '0');
    dbg_reg_data     : out std_logic_vector(63 downto 0);
    dbg_pc           : out std_logic_vector(63 downto 0)
  );
end entity rv64_exec_core;

architecture rtl of rv64_exec_core is
  constant BASE_ADDR : unsigned(63 downto 0) := x"0000000080000000";
  constant UART_ADDR : unsigned(63 downto 0) := x"0000000010000000";
  constant BAUD_DIV  : natural := CLK_FREQ / BAUD_RATE;
  -- 64 KB unified memory: 8192 words * 8 bytes. Addresses 0x8000_0000 ..
  -- 0x8000_FFFF. Instructions are 32-bit, 4-byte aligned; each 64-bit word
  -- holds two of them (low half at .._0, high half at .._4).
  constant MEM_WORDS : natural := 8192;
  type regs_t is array(0 to 31) of unsigned(63 downto 0);
  type mem_t  is array(0 to MEM_WORDS - 1) of std_logic_vector(63 downto 0);
  type state_t is (S_FETCH, S_EXEC, S_UART, S_DIVIDE, S_LOAD, S_STORE);
  type ld_kind_t is (LD_D, LD_W, LD_WU, LD_H, LD_HU, LD_B, LD_BU);

  impure function init_mem return mem_t is
    file f        : text open read_mode is "rv64_payload.mem";
    variable ln   : line;
    variable word : std_logic_vector(63 downto 0);
    variable m    : mem_t := (others => x"0000000000000013");  -- nop (addi x0,x0,0)
    variable idx  : natural := 0;
  begin
    while not endfile(f) loop
      readline(f, ln);
      hread(ln, word);
      if idx < MEM_WORDS then
        m(idx) := word;
      end if;
      idx := idx + 1;
    end loop;
    return m;
  end function;

  signal mem_a : mem_t := init_mem;
  signal mem_b : mem_t := init_mem;
  attribute ram_style : string;
  attribute ram_style of mem_a : signal is "block";
  attribute ram_style of mem_b : signal is "block";
  signal mem_a_q : std_logic_vector(63 downto 0) := (others => '0');
  signal mem_b_q : std_logic_vector(63 downto 0) := (others => '0');

  -- Minimal machine-mode CSRs (read-as-value; writes accepted but discarded
  -- for the subset the soak / OpenSBI banner touch).
  signal csr_mhartid : unsigned(63 downto 0) := (others => '0');
  signal csr_mstatus : unsigned(63 downto 0) := (others => '0');
  signal csr_mtvec   : unsigned(63 downto 0) := (others => '0');
  signal csr_mie     : unsigned(63 downto 0) := (others => '0');
  signal csr_mip     : unsigned(63 downto 0) := (others => '0');
  signal csr_mcycle  : unsigned(63 downto 0) := (others => '0');

  -- Multi-cycle restoring divider. All div/rem forms (full + W) are normalised
  -- to a 64-bit unsigned magnitude division (64 iterations) with sign / word
  -- fix-up applied at completion. dividend is 128-bit (magnitude in the low 64,
  -- partial remainder accumulates in the high 64).
  signal div_dividend_q : unsigned(127 downto 0) := (others => '0');
  signal div_divisor_q  : unsigned(63 downto 0)  := (others => '0');
  signal div_quotient_q : unsigned(63 downto 0)  := (others => '0');
  signal div_count_q    : unsigned(6 downto 0)   := (others => '0');
  signal div_is_rem_q   : std_logic := '0';
  signal div_is_w_q     : std_logic := '0';
  signal div_neg_q      : std_logic := '0';
  signal div_rd_q       : natural range 0 to 31 := 0;

  -- Deferred load / sub-word store bookkeeping.
  signal ld_rd_q   : natural range 0 to 31 := 0;
  signal ld_kind_q : ld_kind_t := LD_D;
  signal ld_off_q  : natural range 0 to 7 := 0;
  signal st_idx_q  : natural range 0 to MEM_WORDS - 1 := 0;
  signal st_len_q  : natural range 1 to 8 := 1;
  signal st_off_q  : natural range 0 to 7 := 0;
  signal st_data_q : std_logic_vector(63 downto 0) := (others => '0');

  signal regs_q    : regs_t := (others => (others => '0'));
  signal pc_q      : unsigned(63 downto 0) := BASE_ADDR;
  signal next_pc_q : unsigned(63 downto 0) := BASE_ADDR;
  signal state_q   : state_t := S_FETCH;

  signal uart_tx_q    : std_logic := '1';
  signal uart_busy_q  : std_logic := '0';
  signal uart_baud_q  : natural range 0 to CLK_FREQ := 0;
  signal uart_bits_q  : natural range 0 to 10 := 0;
  signal uart_shift_q : std_logic_vector(9 downto 0) := (others => '1');
  signal debug_uart_valid_q      : std_logic := '0';
  signal debug_uart_valid_next_q : std_logic := '0';
  signal debug_uart_byte_q       : std_logic_vector(7 downto 0) := (others => '0');

  function sext(v : std_logic_vector) return unsigned is
  begin
    return unsigned(resize(signed(v), 64));
  end function;

  -- Sign-extend a 32-bit word result to 64 bits (RV64 W-op semantics).
  function sext32(v : std_logic_vector(31 downto 0)) return unsigned is
  begin
    return unsigned(resize(signed(v), 64));
  end function;

  -- 64-bit two's-complement magnitude. abs(INT64_MIN) wraps to 0x8000..0 which
  -- as an *unsigned* value is exactly 2^63 — the correct magnitude, so only the
  -- INT_MIN / -1 quotient overflow needs the explicit guard below.
  function mag(v : unsigned(63 downto 0)) return unsigned is
  begin
    if v(63) = '1' then
      return unsigned(-signed(v));
    else
      return v;
    end if;
  end function;

  function mem_index(addr : unsigned(63 downto 0)) return natural is
    variable off : unsigned(63 downto 0);
  begin
    off := addr - BASE_ADDR;
    return to_integer(off(15 downto 3));
  end function;
begin
  uart_tx          <= uart_tx_q;
  debug_uart_valid <= debug_uart_valid_q;
  debug_uart_byte  <= debug_uart_byte_q;
  dbg_reg_data     <= std_logic_vector(regs_q(to_integer(unsigned(dbg_reg_addr))));
  dbg_pc           <= std_logic_vector(pc_q);

  process(clk)
    variable r        : regs_t;
    variable pc_next  : unsigned(63 downto 0);
    variable pc_idx   : natural;
    variable word64   : std_logic_vector(63 downto 0);
    variable ins      : std_logic_vector(31 downto 0);
    variable op       : std_logic_vector(6 downto 0);
    variable f3       : std_logic_vector(2 downto 0);
    variable rd       : natural range 0 to 31;
    variable rs1      : natural range 0 to 31;
    variable rs2      : natural range 0 to 31;
    variable sh6      : natural range 0 to 63;
    variable sh5      : natural range 0 to 31;
    variable eff      : unsigned(63 downto 0);
    variable idx      : natural;
    variable boff     : natural range 0 to 7;
    variable res32    : std_logic_vector(31 downto 0);
    variable prod128  : signed(127 downto 0);
    variable uprod    : unsigned(127 downto 0);
    variable a_s      : signed(63 downto 0);
    variable b_s      : signed(63 downto 0);
    variable a_mag    : unsigned(63 downto 0);
    variable b_mag    : unsigned(63 downto 0);
    variable dvd      : unsigned(127 downto 0);
    variable magres   : unsigned(63 downto 0);
    variable finalv   : unsigned(63 downto 0);
    variable ldw     : std_logic_vector(63 downto 0);
    variable data_w   : std_logic_vector(63 downto 0);
    -- Single muxed read address per physical memory + one funneled write port.
    variable mem_ra_a : natural range 0 to MEM_WORDS - 1;
    variable mem_ra_b : natural range 0 to MEM_WORDS - 1;
    variable mem_we   : boolean;
    variable mem_wa   : natural range 0 to MEM_WORDS - 1;
    variable mem_wd   : std_logic_vector(63 downto 0);
    variable start_div : boolean;
  begin
    if rising_edge(clk) then
      -- Per-cycle memory port defaults: prefetch the current pc word on mem_a;
      -- data-side reads override mem_ra_b below.
      mem_we   := false;
      mem_wa   := 0;
      mem_wd   := (others => '0');
      pc_idx   := mem_index(pc_q);
      if pc_idx > MEM_WORDS - 1 then
        pc_idx := MEM_WORDS - 1;
      end if;
      mem_ra_a := pc_idx;
      mem_ra_b := 0;

      debug_uart_valid_q      <= debug_uart_valid_next_q;
      debug_uart_valid_next_q <= '0';
      csr_mcycle              <= csr_mcycle + 1;

      -- UART shift engine (runs every edge regardless of FSM state).
      if uart_busy_q = '1' then
        if uart_baud_q >= BAUD_DIV - 1 then
          uart_baud_q <= 0;
          if uart_bits_q > 1 then
            uart_tx_q    <= uart_shift_q(1);
            uart_shift_q <= '1' & uart_shift_q(9 downto 1);
            uart_bits_q  <= uart_bits_q - 1;
          else
            uart_tx_q   <= '1';
            uart_busy_q <= '0';
            uart_bits_q <= 0;
          end if;
        else
          uart_baud_q <= uart_baud_q + 1;
        end if;
      end if;

      if rst = '1' then
        regs_q    <= (others => (others => '0'));
        pc_q      <= BASE_ADDR;
        next_pc_q <= BASE_ADDR;
        state_q   <= S_FETCH;
        ld_rd_q   <= 0;
        ld_kind_q <= LD_D;
        ld_off_q  <= 0;
        st_idx_q  <= 0;
        st_len_q  <= 1;
        st_off_q  <= 0;
        st_data_q <= (others => '0');
        uart_tx_q    <= '1';
        uart_busy_q  <= '0';
        uart_baud_q  <= 0;
        uart_bits_q  <= 0;
        uart_shift_q <= (others => '1');
        debug_uart_valid_q      <= '0';
        debug_uart_valid_next_q <= '0';
        debug_uart_byte_q       <= (others => '0');
        csr_mhartid <= (others => '0');
        csr_mstatus <= (others => '0');
        csr_mtvec   <= (others => '0');
        csr_mie     <= (others => '0');
        csr_mip     <= (others => '0');
        csr_mcycle  <= (others => '0');
        div_dividend_q <= (others => '0');
        div_divisor_q  <= (others => '0');
        div_quotient_q <= (others => '0');
        div_count_q    <= (others => '0');
        div_is_rem_q   <= '0';
        div_is_w_q     <= '0';
        div_neg_q      <= '0';
        div_rd_q       <= 0;

      elsif state_q = S_UART then
        if uart_busy_q = '0' then
          pc_q    <= next_pc_q;
          state_q <= S_FETCH;
        end if;

      elsif state_q = S_DIVIDE then
        if div_count_q /= 0 then
          dvd := shift_left(div_dividend_q, 1);
          if dvd(127 downto 64) >= div_divisor_q then
            dvd(127 downto 64) := dvd(127 downto 64) - div_divisor_q;
            div_quotient_q <= shift_left(div_quotient_q, 1) + 1;
          else
            div_quotient_q <= shift_left(div_quotient_q, 1);
          end if;
          div_dividend_q <= dvd;
          div_count_q    <= div_count_q - 1;
        else
          if div_is_rem_q = '1' then
            magres := div_dividend_q(127 downto 64);
          else
            magres := div_quotient_q;
          end if;
          if div_neg_q = '1' then
            finalv := unsigned(-signed(magres));
          else
            finalv := magres;
          end if;
          if div_is_w_q = '1' then
            finalv := sext32(std_logic_vector(finalv(31 downto 0)));
          end if;
          if div_rd_q /= 0 then
            regs_q(div_rd_q) <= finalv;
          end if;
          div_rd_q <= 0;
          state_q  <= S_FETCH;
        end if;

      elsif state_q = S_FETCH then
        -- mem_a_q was latched with the pc word on the previous edge (default
        -- addressing); decode + execute happens next cycle in S_EXEC.
        state_q <= S_EXEC;

      elsif state_q = S_LOAD then
        ldw := mem_b_q;
        boff := ld_off_q;
        if ld_rd_q /= 0 then
          case ld_kind_q is
            when LD_D  => regs_q(ld_rd_q) <= unsigned(ldw);
            when LD_W  => regs_q(ld_rd_q) <= sext32(ldw(boff * 8 + 31 downto boff * 8));
            when LD_WU => regs_q(ld_rd_q) <= resize(unsigned(ldw(boff * 8 + 31 downto boff * 8)), 64);
            when LD_H  => regs_q(ld_rd_q) <= sext(ldw(boff * 8 + 15 downto boff * 8));
            when LD_HU => regs_q(ld_rd_q) <= resize(unsigned(ldw(boff * 8 + 15 downto boff * 8)), 64);
            when LD_B  => regs_q(ld_rd_q) <= sext(ldw(boff * 8 + 7 downto boff * 8));
            when LD_BU => regs_q(ld_rd_q) <= resize(unsigned(ldw(boff * 8 + 7 downto boff * 8)), 64);
          end case;
        end if;
        state_q <= S_FETCH;

      elsif state_q = S_STORE then
        -- Sub-word store read-modify-write: mem_b_q holds the current word.
        data_w := mem_b_q;
        boff   := st_off_q;
        for i in 0 to 7 loop
          if i >= st_off_q and i < st_off_q + st_len_q then
            data_w(i * 8 + 7 downto i * 8) := st_data_q((i - st_off_q) * 8 + 7 downto (i - st_off_q) * 8);
          end if;
        end loop;
        mem_we  := true;
        mem_wa  := st_idx_q;
        mem_wd  := data_w;
        state_q <= S_FETCH;

      else  -- S_EXEC
        r         := regs_q;
        state_q   <= S_FETCH;
        pc_next   := pc_q + 4;
        start_div := false;
        word64    := mem_a_q;
        if pc_q(2) = '0' then
          ins := word64(31 downto 0);
        else
          ins := word64(63 downto 32);
        end if;

        op  := ins(6 downto 0);
        f3  := ins(14 downto 12);
        rd  := to_integer(unsigned(ins(11 downto 7)));
        rs1 := to_integer(unsigned(ins(19 downto 15)));
        rs2 := to_integer(unsigned(ins(24 downto 20)));
        sh6 := to_integer(unsigned(ins(25 downto 20)));
        sh5 := to_integer(unsigned(ins(24 downto 20)));

        case op is
          -- OP-IMM (I-type ALU)
          when "0010011" =>
            if rd /= 0 then
              case f3 is
                when "000" => r(rd) := r(rs1) + sext(ins(31 downto 20));
                when "111" => r(rd) := r(rs1) and sext(ins(31 downto 20));
                when "110" => r(rd) := r(rs1) or sext(ins(31 downto 20));
                when "100" => r(rd) := r(rs1) xor sext(ins(31 downto 20));
                when "010" =>
                  if signed(r(rs1)) < signed(sext(ins(31 downto 20))) then r(rd) := to_unsigned(1, 64); else r(rd) := (others => '0'); end if;
                when "011" =>
                  if r(rs1) < sext(ins(31 downto 20)) then r(rd) := to_unsigned(1, 64); else r(rd) := (others => '0'); end if;
                when "001" => r(rd) := shift_left(r(rs1), sh6);
                when others =>  -- "101" SRLI / SRAI (6-bit shamt)
                  if ins(30) = '1' then r(rd) := unsigned(shift_right(signed(r(rs1)), sh6));
                  else r(rd) := shift_right(r(rs1), sh6); end if;
              end case;
            end if;

          -- OP-IMM-32 (W immediate ALU)
          when "0011011" =>
            if rd /= 0 then
              case f3 is
                when "000" =>  -- ADDIW
                  res32 := std_logic_vector(unsigned(r(rs1)(31 downto 0)) + unsigned(sext(ins(31 downto 20))(31 downto 0)));
                  r(rd) := sext32(res32);
                when "001" =>  -- SLLIW (5-bit shamt)
                  res32 := std_logic_vector(shift_left(unsigned(r(rs1)(31 downto 0)), sh5));
                  r(rd) := sext32(res32);
                when others =>  -- "101" SRLIW / SRAIW
                  if ins(30) = '1' then res32 := std_logic_vector(shift_right(signed(r(rs1)(31 downto 0)), sh5));
                  else res32 := std_logic_vector(shift_right(unsigned(r(rs1)(31 downto 0)), sh5)); end if;
                  r(rd) := sext32(res32);
              end case;
            end if;

          -- OP (R-type ALU + M-extension)
          when "0110011" =>
            if rd /= 0 then
              if ins(31 downto 25) = "0000001" then
                case f3 is
                  when "000" =>  -- MUL (low 64)
                    uprod := unsigned(r(rs1)) * unsigned(r(rs2));
                    r(rd) := uprod(63 downto 0);
                  when "001" =>  -- MULH (signed*signed high)
                    prod128 := signed(r(rs1)) * signed(r(rs2));
                    r(rd) := unsigned(prod128(127 downto 64));
                  when "010" =>  -- MULHSU (signed*unsigned high)
                    prod128 := signed(unsigned(r(rs1)) * unsigned(r(rs2)));
                    if signed(r(rs1)) < 0 then
                      prod128 := prod128 - shift_left(resize(signed(unsigned(r(rs2))), 128), 64);
                    end if;
                    r(rd) := unsigned(prod128(127 downto 64));
                  when "011" =>  -- MULHU (unsigned*unsigned high)
                    uprod := unsigned(r(rs1)) * unsigned(r(rs2));
                    r(rd) := uprod(127 downto 64);
                  when "100" =>  -- DIV
                    if r(rs2) = 0 then
                      r(rd) := (others => '1');
                    elsif r(rs1) = x"8000000000000000" and r(rs2) = x"FFFFFFFFFFFFFFFF" then
                      r(rd) := x"8000000000000000";
                    else
                      a_s := signed(r(rs1)); b_s := signed(r(rs2));
                      a_mag := mag(r(rs1)); b_mag := mag(r(rs2));
                      div_neg_q <= (a_s(63) xor b_s(63));
                      div_is_rem_q <= '0'; div_is_w_q <= '0';
                      start_div := true;
                    end if;
                  when "101" =>  -- DIVU
                    if r(rs2) = 0 then
                      r(rd) := (others => '1');
                    else
                      a_mag := r(rs1); b_mag := r(rs2);
                      div_neg_q <= '0'; div_is_rem_q <= '0'; div_is_w_q <= '0';
                      start_div := true;
                    end if;
                  when "110" =>  -- REM
                    if r(rs2) = 0 then
                      r(rd) := r(rs1);
                    elsif r(rs1) = x"8000000000000000" and r(rs2) = x"FFFFFFFFFFFFFFFF" then
                      r(rd) := (others => '0');
                    else
                      a_s := signed(r(rs1));
                      a_mag := mag(r(rs1)); b_mag := mag(r(rs2));
                      div_neg_q <= a_s(63);
                      div_is_rem_q <= '1'; div_is_w_q <= '0';
                      start_div := true;
                    end if;
                  when others =>  -- "111" REMU
                    if r(rs2) = 0 then
                      r(rd) := r(rs1);
                    else
                      a_mag := r(rs1); b_mag := r(rs2);
                      div_neg_q <= '0'; div_is_rem_q <= '1'; div_is_w_q <= '0';
                      start_div := true;
                    end if;
                end case;
              else
                case f3 is
                  when "000" => if ins(30) = '1' then r(rd) := r(rs1) - r(rs2); else r(rd) := r(rs1) + r(rs2); end if;
                  when "001" => r(rd) := shift_left(r(rs1), to_integer(r(rs2)(5 downto 0)));
                  when "010" => if signed(r(rs1)) < signed(r(rs2)) then r(rd) := to_unsigned(1, 64); else r(rd) := (others => '0'); end if;
                  when "011" => if r(rs1) < r(rs2) then r(rd) := to_unsigned(1, 64); else r(rd) := (others => '0'); end if;
                  when "100" => r(rd) := r(rs1) xor r(rs2);
                  when "101" => if ins(30) = '1' then r(rd) := unsigned(shift_right(signed(r(rs1)), to_integer(r(rs2)(5 downto 0)))); else r(rd) := shift_right(r(rs1), to_integer(r(rs2)(5 downto 0))); end if;
                  when "110" => r(rd) := r(rs1) or r(rs2);
                  when others => r(rd) := r(rs1) and r(rs2);
                end case;
              end if;
            end if;

          -- OP-32 (R-type W ALU + W M-extension)
          when "0111011" =>
            if rd /= 0 then
              if ins(31 downto 25) = "0000001" then
                case f3 is
                  when "000" =>  -- MULW
                    res32 := std_logic_vector(resize(signed(r(rs1)(31 downto 0)) * signed(r(rs2)(31 downto 0)), 32));
                    r(rd) := sext32(res32);
                  when "100" =>  -- DIVW
                    if r(rs2)(31 downto 0) = x"00000000" then
                      r(rd) := (others => '1');
                    elsif r(rs1)(31 downto 0) = x"80000000" and r(rs2)(31 downto 0) = x"FFFFFFFF" then
                      r(rd) := x"FFFFFFFF80000000";
                    else
                      a_s := resize(signed(r(rs1)(31 downto 0)), 64);
                      b_s := resize(signed(r(rs2)(31 downto 0)), 64);
                      a_mag := mag(unsigned(a_s)); b_mag := mag(unsigned(b_s));
                      div_neg_q <= (a_s(63) xor b_s(63));
                      div_is_rem_q <= '0'; div_is_w_q <= '1';
                      start_div := true;
                    end if;
                  when "101" =>  -- DIVUW
                    if r(rs2)(31 downto 0) = x"00000000" then
                      r(rd) := (others => '1');
                    else
                      a_mag := resize(unsigned(r(rs1)(31 downto 0)), 64);
                      b_mag := resize(unsigned(r(rs2)(31 downto 0)), 64);
                      div_neg_q <= '0'; div_is_rem_q <= '0'; div_is_w_q <= '1';
                      start_div := true;
                    end if;
                  when "110" =>  -- REMW
                    if r(rs2)(31 downto 0) = x"00000000" then
                      r(rd) := sext32(std_logic_vector(r(rs1)(31 downto 0)));
                    elsif r(rs1)(31 downto 0) = x"80000000" and r(rs2)(31 downto 0) = x"FFFFFFFF" then
                      r(rd) := (others => '0');
                    else
                      a_s := resize(signed(r(rs1)(31 downto 0)), 64);
                      b_s := resize(signed(r(rs2)(31 downto 0)), 64);
                      a_mag := mag(unsigned(a_s)); b_mag := mag(unsigned(b_s));
                      div_neg_q <= a_s(63);
                      div_is_rem_q <= '1'; div_is_w_q <= '1';
                      start_div := true;
                    end if;
                  when others =>  -- "111" REMUW
                    if r(rs2)(31 downto 0) = x"00000000" then
                      r(rd) := sext32(std_logic_vector(r(rs1)(31 downto 0)));
                    else
                      a_mag := resize(unsigned(r(rs1)(31 downto 0)), 64);
                      b_mag := resize(unsigned(r(rs2)(31 downto 0)), 64);
                      div_neg_q <= '0'; div_is_rem_q <= '1'; div_is_w_q <= '1';
                      start_div := true;
                    end if;
                end case;
              else
                case f3 is
                  when "000" =>  -- ADDW / SUBW
                    if ins(30) = '1' then res32 := std_logic_vector(unsigned(r(rs1)(31 downto 0)) - unsigned(r(rs2)(31 downto 0)));
                    else res32 := std_logic_vector(unsigned(r(rs1)(31 downto 0)) + unsigned(r(rs2)(31 downto 0))); end if;
                    r(rd) := sext32(res32);
                  when "001" =>  -- SLLW (5-bit)
                    res32 := std_logic_vector(shift_left(unsigned(r(rs1)(31 downto 0)), to_integer(r(rs2)(4 downto 0))));
                    r(rd) := sext32(res32);
                  when others =>  -- "101" SRLW / SRAW
                    if ins(30) = '1' then res32 := std_logic_vector(shift_right(signed(r(rs1)(31 downto 0)), to_integer(r(rs2)(4 downto 0))));
                    else res32 := std_logic_vector(shift_right(unsigned(r(rs1)(31 downto 0)), to_integer(r(rs2)(4 downto 0)))); end if;
                    r(rd) := sext32(res32);
                end case;
              end if;
            end if;

          -- AUIPC
          when "0010111" =>
            if rd /= 0 then r(rd) := pc_q + sext32(ins(31 downto 12) & x"000"); end if;

          -- LUI
          when "0110111" =>
            if rd /= 0 then r(rd) := sext32(ins(31 downto 12) & x"000"); end if;

          -- JAL
          when "1101111" =>
            if rd /= 0 then r(rd) := pc_q + 4; end if;
            pc_next := pc_q + sext(ins(31) & ins(19 downto 12) & ins(20) & ins(30 downto 21) & '0');

          -- JALR
          when "1100111" =>
            pc_next := (r(rs1) + sext(ins(31 downto 20))) and x"FFFFFFFFFFFFFFFE";
            if rd /= 0 then r(rd) := pc_q + 4; end if;

          -- BRANCH
          when "1100011" =>
            eff := pc_q + sext(ins(31) & ins(7) & ins(30 downto 25) & ins(11 downto 8) & '0');
            case f3 is
              when "000" => if r(rs1) = r(rs2) then pc_next := eff; end if;
              when "001" => if r(rs1) /= r(rs2) then pc_next := eff; end if;
              when "100" => if signed(r(rs1)) < signed(r(rs2)) then pc_next := eff; end if;
              when "101" => if signed(r(rs1)) >= signed(r(rs2)) then pc_next := eff; end if;
              when "110" => if r(rs1) < r(rs2) then pc_next := eff; end if;
              when others => if r(rs1) >= r(rs2) then pc_next := eff; end if;
            end case;

          -- LOAD (deferred one cycle via mem_b / S_LOAD)
          when "0000011" =>
            eff := r(rs1) + sext(ins(31 downto 20));
            if rd /= 0 and eff(31 downto 28) = x"8" then
              mem_ra_b := mem_index(eff);
              ld_rd_q  <= rd;
              ld_off_q <= to_integer(eff(2 downto 0));
              case f3 is
                when "011" => ld_kind_q <= LD_D;
                when "010" => ld_kind_q <= LD_W;
                when "110" => ld_kind_q <= LD_WU;
                when "001" => ld_kind_q <= LD_H;
                when "101" => ld_kind_q <= LD_HU;
                when "000" => ld_kind_q <= LD_B;
                when others => ld_kind_q <= LD_BU;  -- "100"
              end case;
              state_q <= S_LOAD;
            elsif rd /= 0 then
              r(rd) := (others => '0');
            end if;

          -- STORE
          when "0100011" =>
            eff := r(rs1) + sext(ins(31 downto 25) & ins(11 downto 7));
            if eff = UART_ADDR and f3 = "000" then
              uart_shift_q <= '1' & std_logic_vector(r(rs2)(7 downto 0)) & '0';
              uart_tx_q    <= '0';
              uart_busy_q  <= '1';
              uart_baud_q  <= 0;
              uart_bits_q  <= 10;
              debug_uart_valid_next_q <= '1';
              debug_uart_byte_q       <= std_logic_vector(r(rs2)(7 downto 0));
              next_pc_q <= pc_next;
              state_q   <= S_UART;
            elsif eff(31 downto 28) = x"8" then
              idx  := mem_index(eff);
              boff := to_integer(eff(2 downto 0));
              if f3 = "011" then
                -- SD (aligned 8-byte): direct write, no read needed.
                mem_we := true;
                mem_wa := idx;
                mem_wd := std_logic_vector(r(rs2));
              else
                -- SB/SH/SW: read-modify-write via S_STORE.
                mem_ra_b  := mem_index(eff);
                st_idx_q  <= idx;
                st_off_q  <= boff;
                st_data_q <= std_logic_vector(r(rs2));
                case f3 is
                  when "000" => st_len_q <= 1;
                  when "001" => st_len_q <= 2;
                  when others => st_len_q <= 4;  -- "010" SW
                end case;
                state_q <= S_STORE;
              end if;
            end if;

          -- SYSTEM (ecall / ebreak / Zicsr reads)
          when "1110011" =>
            case f3 is
              when "000" =>
                -- ecall / ebreak: halt cleanly (hold pc).
                pc_next := pc_q;
              when "001" | "010" | "011" | "101" | "110" | "111" =>
                if rd /= 0 then
                  case unsigned(ins(31 downto 20)) is
                    when x"f11" => r(rd) := csr_mhartid;
                    when x"300" => r(rd) := csr_mstatus;
                    when x"305" => r(rd) := csr_mtvec;
                    when x"304" => r(rd) := csr_mie;
                    when x"344" => r(rd) := csr_mip;
                    when x"b00" | x"c00" => r(rd) := csr_mcycle;  -- mcycle / cycle
                    when others => r(rd) := (others => '0');
                  end case;
                end if;
              when others => null;
            end case;

          when others => null;
        end case;

        if start_div then
          div_dividend_q <= x"0000000000000000" & a_mag;
          div_divisor_q  <= b_mag;
          div_quotient_q <= (others => '0');
          div_count_q    <= to_unsigned(64, 7);
          div_rd_q       <= rd;
          state_q        <= S_DIVIDE;
        end if;

        r(0) := (others => '0');
        regs_q <= r;
        if state_q = S_EXEC then
          pc_q <= pc_next;
        end if;
      end if;

      -- === Physical memory ports (single read + single write per array) ===
      if mem_we then
        mem_a(mem_wa) <= mem_wd;
        mem_b(mem_wa) <= mem_wd;
      end if;
      mem_a_q <= mem_a(mem_ra_a);
      mem_b_q <= mem_b(mem_ra_b);
    end if;
  end process;
end architecture rtl;
