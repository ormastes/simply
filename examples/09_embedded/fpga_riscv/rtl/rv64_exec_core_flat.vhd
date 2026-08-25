library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;
use std.textio.all;
use ieee.std_logic_textio.all;

-- rv64_exec_core_flat: full-RAM behavioral sibling of rv64_exec_core, and the
-- rv64 analogue of rv32_exec_core_flat.
--
-- The synthesizable rv64_exec_core confines code+data to a 64 KB window (multi-
-- cycle BRAM model, word_index = off(15 downto 3)) tuned for the Adler-32 soak
-- payload. The full rv64 SimpleOS smoke kernel
-- (build/os/simpleos_riscv64_smf_fs.elf) enters at 0x80200000, sp=0x80a1e010,
-- heap 0x80a1f000..0x84a1f000, so it needs a large contiguous RAM. This variant
-- keeps the SAME RV64IM + Zicsr datapath but:
--   * backs it with ONE flat behavioral RAM of 64-bit words covering
--     0x80000000..~0x85000000 (~80 MB), async single-cycle (behavioral, not a
--     BRAM model). On silicon this region is external PS DDR over AXI, NOT
--     fabric BRAM (board-runnable: 80 MB will not fit on-chip — a bring-up item).
--   * resets PC to 0x80200000 in M-mode-direct (no OpenSBI, no satp — the smoke
--     kernel executes zero privileged instructions; see
--     doc/09_report/rv64_simpleos_ghdl_soc_scope_2026-07-25.md).
--   * adds the RV64C (compressed) decoder ported from rv32_exec_core_flat and
--     adapted to the RV64 quadrant encodings (C.ADDIW in place of C.JAL, C.LD/
--     C.SD/C.LDSP/C.SDSP doublewords, C.ADDW/C.SUBW, 6-bit shift amounts).
--   * adds a read-only ramdisk bank at 0x88000000 preloaded from
--     "rv64_ramdisk.mem" (a truncated FAT image; virtio_blk_read_sector() in
--     arch/common/riscv_common.h memcpys 512-byte sectors out of it once the
--     kernel auto-detects the FAT signature there).
--
-- Memory format: rv64_flat.mem / rv64_ramdisk.mem carry one 64-bit little-endian
-- word per line (16 hex digits), matching rv64_payload.mem's hread format.

entity rv64_exec_core_flat is
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
    debug_pc         : out std_logic_vector(63 downto 0);
    debug_ins        : out std_logic_vector(31 downto 0);
    debug_a0         : out std_logic_vector(63 downto 0);
    debug_ra         : out std_logic_vector(63 downto 0);
    debug_sp         : out std_logic_vector(63 downto 0)
  );
end entity rv64_exec_core_flat;

architecture rtl of rv64_exec_core_flat is
  constant BASE_ADDR : unsigned(63 downto 0) := x"0000000080000000";
  constant RESET_PC  : unsigned(63 downto 0) := x"0000000080200000";
  constant UART_ADDR : unsigned(63 downto 0) := x"0000000010000000";
  constant BAUD_DIV  : natural := CLK_FREQ / BAUD_RATE;
  -- Flat RAM: 10,000,000 * 8 bytes = 80 MB, covering 0x80000000..0x84C4B400
  -- (past _kernel_end 0x84A1F000). word_index = off / 8.
  constant RAM_WORDS  : natural := 10000000;
  constant NOP2       : std_logic_vector(63 downto 0) := x"0000001300000013";
  type regs_t is array(0 to 31) of unsigned(63 downto 0);
  type ram_t  is array(0 to RAM_WORDS - 1) of std_logic_vector(63 downto 0);
  type state_t is (S_EXEC, S_DIVIDE, S_UART);

  impure function init_ram return ram_t is
    file f        : text open read_mode is "rv64_flat.mem";
    variable ln   : line;
    variable word : std_logic_vector(63 downto 0);
    variable m    : ram_t := (others => x"0000000000000000");
    variable idx  : natural := 0;
  begin
    while not endfile(f) loop
      readline(f, ln);
      hread(ln, word);
      if idx < RAM_WORDS then
        m(idx) := word;
      end if;
      idx := idx + 1;
    end loop;
    return m;
  end function;

  -- Ramdisk bank at 0x88000000: 64-bit words, 1 MiB window. Read-only (the FS
  -- smoke never writes the disk). Preloaded from rv64_ramdisk.mem; absent-file
  -- leaves it zero so non-FS lanes still elaborate.
  constant RDISK_BASE  : unsigned(63 downto 0) := x"0000000088000000";
  constant RDISK_WORDS : natural := 131072;  -- 1 MiB (off(19 downto 3))
  type rdisk_t is array(0 to RDISK_WORDS - 1) of std_logic_vector(63 downto 0);

  impure function init_rdisk return rdisk_t is
    file f          : text;
    variable fstat  : file_open_status;
    variable ln     : line;
    variable word   : std_logic_vector(63 downto 0);
    variable m      : rdisk_t := (others => x"0000000000000000");
    variable idx    : natural := 0;
  begin
    file_open(fstat, f, "rv64_ramdisk.mem", read_mode);
    if fstat /= open_ok then
      return m;
    end if;
    while not endfile(f) loop
      readline(f, ln);
      hread(ln, word);
      if idx < RDISK_WORDS then
        m(idx) := word;
      end if;
      idx := idx + 1;
    end loop;
    file_close(f);
    return m;
  end function;

  -- Minimal machine-mode CSRs (read-as-value; writes discarded).
  signal csr_mhartid : unsigned(63 downto 0) := (others => '0');
  signal csr_mstatus : unsigned(63 downto 0) := (others => '0');
  signal csr_mtvec   : unsigned(63 downto 0) := (others => '0');
  signal csr_mie     : unsigned(63 downto 0) := (others => '0');
  signal csr_mip     : unsigned(63 downto 0) := (others => '0');
  signal csr_mcycle  : unsigned(63 downto 0) := (others => '0');

  -- 64-bit multi-cycle restoring divider (64 iterations).
  signal div_dividend_q : unsigned(127 downto 0) := (others => '0');
  signal div_divisor_q  : unsigned(63 downto 0)  := (others => '0');
  signal div_quotient_q : unsigned(63 downto 0)  := (others => '0');
  signal div_count_q    : unsigned(6 downto 0)   := (others => '0');
  signal div_is_rem_q   : std_logic := '0';
  signal div_is_w_q     : std_logic := '0';
  signal div_neg_q      : std_logic := '0';
  signal div_rd_q       : natural range 0 to 31 := 0;

  signal regs_q    : regs_t := (others => (others => '0'));
  signal pc_q      : unsigned(63 downto 0) := RESET_PC;
  signal next_pc_q : unsigned(63 downto 0) := RESET_PC;
  signal state_q   : state_t := S_EXEC;

  signal uart_tx_q    : std_logic := '1';
  signal uart_busy_q  : std_logic := '0';
  signal uart_baud_q  : natural range 0 to CLK_FREQ := 0;
  signal uart_bits_q  : natural range 0 to 10 := 0;
  signal uart_shift_q : std_logic_vector(9 downto 0) := (others => '1');
  signal debug_uart_valid_q : std_logic := '0';
  signal debug_uart_byte_q  : std_logic_vector(7 downto 0) := (others => '0');
  signal debug_pc_q  : std_logic_vector(63 downto 0) := (others => '0');
  signal debug_ins_q : std_logic_vector(31 downto 0) := (others => '0');
  signal debug_a0_q  : std_logic_vector(63 downto 0) := (others => '0');
  signal debug_ra_q  : std_logic_vector(63 downto 0) := (others => '0');
  signal debug_sp_q  : std_logic_vector(63 downto 0) := (others => '0');

  function sext(v : std_logic_vector) return unsigned is
  begin
    return unsigned(resize(signed(v), 64));
  end function;

  function sext32(v : std_logic_vector(31 downto 0)) return unsigned is
  begin
    return unsigned(resize(signed(v), 64));
  end function;

  function mag(v : unsigned(63 downto 0)) return unsigned is
  begin
    if v(63) = '1' then return unsigned(-signed(v)); else return v; end if;
  end function;

  -- ---- RV64C immediate decoders (return 64-bit values) ----
  function c_addi4spn_imm(h : std_logic_vector(15 downto 0)) return unsigned is
    variable imm : unsigned(9 downto 0) := (others => '0');
  begin
    imm(5 downto 4) := unsigned(h(12 downto 11));
    imm(9 downto 6) := unsigned(h(10 downto 7));
    imm(2) := h(6);
    imm(3) := h(5);
    return resize(imm, 64);
  end function;

  function c_addi_imm(h : std_logic_vector(15 downto 0)) return unsigned is
  begin
    return sext(h(12) & h(6 downto 2));
  end function;

  function c_lw_imm(h : std_logic_vector(15 downto 0)) return unsigned is
    variable imm : unsigned(6 downto 0) := (others => '0');
  begin
    imm(5 downto 3) := unsigned(h(12 downto 10));
    imm(2) := h(6);
    imm(6) := h(5);
    return resize(imm, 64);
  end function;

  function c_ld_imm(h : std_logic_vector(15 downto 0)) return unsigned is
    variable imm : unsigned(7 downto 0) := (others => '0');
  begin
    imm(5 downto 3) := unsigned(h(12 downto 10));
    imm(7 downto 6) := unsigned(h(6 downto 5));
    return resize(imm, 64);
  end function;

  function c_lwsp_imm(h : std_logic_vector(15 downto 0)) return unsigned is
    variable imm : unsigned(7 downto 0) := (others => '0');
  begin
    imm(5) := h(12);
    imm(4 downto 2) := unsigned(h(6 downto 4));
    imm(7 downto 6) := unsigned(h(3 downto 2));
    return resize(imm, 64);
  end function;

  function c_ldsp_imm(h : std_logic_vector(15 downto 0)) return unsigned is
    variable imm : unsigned(8 downto 0) := (others => '0');
  begin
    imm(5) := h(12);
    imm(4 downto 3) := unsigned(h(6 downto 5));
    imm(8 downto 6) := unsigned(h(4 downto 2));
    return resize(imm, 64);
  end function;

  function c_swsp_imm(h : std_logic_vector(15 downto 0)) return unsigned is
    variable imm : unsigned(7 downto 0) := (others => '0');
  begin
    imm(5 downto 2) := unsigned(h(12 downto 9));
    imm(7 downto 6) := unsigned(h(8 downto 7));
    return resize(imm, 64);
  end function;

  function c_sdsp_imm(h : std_logic_vector(15 downto 0)) return unsigned is
    variable imm : unsigned(8 downto 0) := (others => '0');
  begin
    imm(5 downto 3) := unsigned(h(12 downto 10));
    imm(8 downto 6) := unsigned(h(9 downto 7));
    return resize(imm, 64);
  end function;

  function c_lui_imm(h : std_logic_vector(15 downto 0)) return unsigned is
    variable v : std_logic_vector(17 downto 0);
  begin
    v := h(12) & h(6 downto 2) & "000000000000";
    return unsigned(resize(signed(v), 64));
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

  function word_index(addr : unsigned(63 downto 0)) return natural is
    variable off : unsigned(63 downto 0);
  begin
    off := addr - BASE_ADDR;
    return to_integer(off(31 downto 3));
  end function;

  function in_ram(addr : unsigned(63 downto 0)) return boolean is
  begin
    return addr >= BASE_ADDR and addr < BASE_ADDR + to_unsigned(RAM_WORDS * 8, 64);
  end function;

  function in_rdisk(addr : unsigned(63 downto 0)) return boolean is
  begin
    return addr >= RDISK_BASE and addr < RDISK_BASE + to_unsigned(RDISK_WORDS * 8, 64);
  end function;

  function rdisk_index(addr : unsigned(63 downto 0)) return natural is
    variable off : unsigned(63 downto 0);
  begin
    off := addr - RDISK_BASE;
    return to_integer(off(19 downto 3));
  end function;
begin
  uart_tx          <= uart_tx_q;
  debug_uart_valid <= debug_uart_valid_q;
  debug_uart_byte  <= debug_uart_byte_q;
  debug_pc         <= debug_pc_q;
  debug_ins        <= debug_ins_q;
  debug_a0         <= debug_a0_q;
  debug_ra         <= debug_ra_q;
  debug_sp         <= debug_sp_q;

  process(clk)
    -- Large memories are process VARIABLES (flat memory blocks), NOT signals:
    -- a 10M x 64-bit signal would create ~640M scalar nets and overflow GHDL
    -- mcode's internal net indexing. As variables they are stored as contiguous
    -- memory and behave as real RAM (immediate read/write within a cycle).
    variable ram      : ram_t := init_ram;
    variable rdisk    : rdisk_t := init_rdisk;
    variable r        : regs_t;
    variable pc_next  : unsigned(63 downto 0);
    variable pc_idx   : natural;
    variable w0       : std_logic_vector(63 downto 0);
    variable w1       : std_logic_vector(63 downto 0);
    variable comb     : std_logic_vector(127 downto 0);
    variable bo       : natural range 0 to 7;
    variable h        : std_logic_vector(15 downto 0);
    variable ins      : std_logic_vector(31 downto 0);
    variable op       : std_logic_vector(6 downto 0);
    variable f3       : std_logic_vector(2 downto 0);
    variable rd       : natural range 0 to 31;
    variable rs1      : natural range 0 to 31;
    variable rs2      : natural range 0 to 31;
    variable sh6      : natural range 0 to 63;
    variable sh5      : natural range 0 to 31;
    variable eff      : unsigned(63 downto 0);
    variable res32    : std_logic_vector(31 downto 0);
    variable prod128  : signed(127 downto 0);
    variable uprod    : unsigned(127 downto 0);
    variable a_s, b_s : signed(63 downto 0);
    variable a_mag, b_mag : unsigned(63 downto 0);
    variable start_div : boolean;
    -- Unified memory-access request (set by decode, serviced after the case).
    variable do_load  : boolean;
    variable do_store : boolean;
    variable mem_eff  : unsigned(63 downto 0);
    variable mem_sz   : natural range 1 to 8;
    variable ld_rd    : natural range 0 to 31;
    variable ld_signed: boolean;
    variable st_src   : unsigned(63 downto 0);
    -- Memory assembly temporaries.
    variable widx     : natural;
    variable boff     : natural range 0 to 7;
    variable bp       : natural range 0 to 15;
    variable tmp0     : std_logic_vector(63 downto 0);
    variable tmp1     : std_logic_vector(63 downto 0);
    variable val64    : std_logic_vector(63 downto 0);
    variable spill    : boolean;
    -- Divider working temporaries.
    variable dvd      : unsigned(127 downto 0);
    variable magres   : unsigned(63 downto 0);
    variable finalv   : unsigned(63 downto 0);
  begin
    if rising_edge(clk) then
      debug_uart_valid_q <= '0';
      csr_mcycle <= csr_mcycle + 1;

      -- UART shift engine (runs every edge).
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
        pc_q      <= RESET_PC;
        next_pc_q <= RESET_PC;
        state_q   <= S_EXEC;
        uart_tx_q    <= '1';
        uart_busy_q  <= '0';
        uart_baud_q  <= 0;
        uart_bits_q  <= 0;
        uart_shift_q <= (others => '1');
        debug_uart_valid_q <= '0';
        debug_uart_byte_q  <= (others => '0');
        debug_pc_q  <= (others => '0');
        debug_ins_q <= (others => '0');
        debug_a0_q  <= (others => '0');
        debug_ra_q  <= (others => '0');
        debug_sp_q  <= (others => '0');
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
          state_q <= S_EXEC;
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
          state_q  <= S_EXEC;
        end if;

      else  -- S_EXEC: async fetch, decode, execute in one cycle.
        r         := regs_q;
        state_q   <= S_EXEC;
        start_div := false;
        do_load   := false;
        do_store  := false;
        mem_eff   := (others => '0');
        mem_sz    := 1;
        ld_rd     := 0;
        ld_signed := false;
        st_src    := (others => '0');

        -- Fetch a 128-bit window {ram[idx+1], ram[idx]} so a 32-bit instruction
        -- straddling the 64-bit word boundary (pc offset 6) is available.
        pc_idx := word_index(pc_q);
        if pc_idx < RAM_WORDS then w0 := ram(pc_idx); else w0 := NOP2; end if;
        if pc_idx + 1 < RAM_WORDS then w1 := ram(pc_idx + 1); else w1 := NOP2; end if;
        comb := w1 & w0;
        bo   := to_integer(pc_q(2 downto 0));
        h    := comb(bo * 8 + 15 downto bo * 8);
        ins  := comb(bo * 8 + 31 downto bo * 8);

        if h(1 downto 0) /= "11" then
          ------------------------------------------------------------------
          -- RV64C (compressed) — 2-byte instruction.
          ------------------------------------------------------------------
          pc_next := pc_q + 2;
          case h(1 downto 0) is
            when "00" =>  -- Quadrant 0
              case h(15 downto 13) is
                when "000" =>  -- C.ADDI4SPN
                  rd := 8 + to_integer(unsigned(h(4 downto 2)));
                  r(rd) := r(2) + c_addi4spn_imm(h);
                when "010" =>  -- C.LW  (sext32)
                  rd  := 8 + to_integer(unsigned(h(4 downto 2)));
                  rs1 := 8 + to_integer(unsigned(h(9 downto 7)));
                  do_load := true; ld_rd := rd; mem_sz := 4; ld_signed := true;
                  mem_eff := r(rs1) + c_lw_imm(h);
                when "011" =>  -- C.LD
                  rd  := 8 + to_integer(unsigned(h(4 downto 2)));
                  rs1 := 8 + to_integer(unsigned(h(9 downto 7)));
                  do_load := true; ld_rd := rd; mem_sz := 8;
                  mem_eff := r(rs1) + c_ld_imm(h);
                when "110" =>  -- C.SW
                  rs1 := 8 + to_integer(unsigned(h(9 downto 7)));
                  rs2 := 8 + to_integer(unsigned(h(4 downto 2)));
                  do_store := true; mem_sz := 4;
                  mem_eff := r(rs1) + c_lw_imm(h); st_src := r(rs2);
                when "111" =>  -- C.SD
                  rs1 := 8 + to_integer(unsigned(h(9 downto 7)));
                  rs2 := 8 + to_integer(unsigned(h(4 downto 2)));
                  do_store := true; mem_sz := 8;
                  mem_eff := r(rs1) + c_ld_imm(h); st_src := r(rs2);
                when others => null;  -- 001 C.FLD / 101 C.FSD unused
              end case;

            when "01" =>  -- Quadrant 1
              case h(15 downto 13) is
                when "000" =>  -- C.ADDI
                  rd := to_integer(unsigned(h(11 downto 7)));
                  if rd /= 0 then r(rd) := r(rd) + c_addi_imm(h); end if;
                when "001" =>  -- C.ADDIW (RV64 — replaces RV32 C.JAL)
                  rd := to_integer(unsigned(h(11 downto 7)));
                  if rd /= 0 then
                    res32 := std_logic_vector(r(rd)(31 downto 0) + c_addi_imm(h)(31 downto 0));
                    r(rd) := sext32(res32);
                  end if;
                when "010" =>  -- C.LI
                  rd := to_integer(unsigned(h(11 downto 7)));
                  if rd /= 0 then r(rd) := c_addi_imm(h); end if;
                when "011" =>  -- C.LUI / C.ADDI16SP
                  rd := to_integer(unsigned(h(11 downto 7)));
                  if rd = 2 then
                    r(2) := r(2) + c_addi16sp_imm(h);
                  elsif rd /= 0 then
                    r(rd) := c_lui_imm(h);
                  end if;
                when "100" =>  -- MISC-ALU
                  rd := 8 + to_integer(unsigned(h(9 downto 7)));
                  case h(11 downto 10) is
                    when "00" =>  -- C.SRLI (6-bit shamt)
                      sh6 := to_integer(unsigned(h(12) & h(6 downto 2)));
                      r(rd) := shift_right(r(rd), sh6);
                    when "01" =>  -- C.SRAI
                      sh6 := to_integer(unsigned(h(12) & h(6 downto 2)));
                      r(rd) := unsigned(shift_right(signed(r(rd)), sh6));
                    when "10" =>  -- C.ANDI
                      r(rd) := r(rd) and c_addi_imm(h);
                    when others =>  -- C.SUB/XOR/OR/AND + C.SUBW/C.ADDW
                      rs2 := 8 + to_integer(unsigned(h(4 downto 2)));
                      if h(12) = '0' then
                        case h(6 downto 5) is
                          when "00" => r(rd) := r(rd) - r(rs2);
                          when "01" => r(rd) := r(rd) xor r(rs2);
                          when "10" => r(rd) := r(rd) or r(rs2);
                          when others => r(rd) := r(rd) and r(rs2);
                        end case;
                      else
                        case h(6 downto 5) is
                          when "00" =>  -- C.SUBW
                            res32 := std_logic_vector(r(rd)(31 downto 0) - r(rs2)(31 downto 0));
                            r(rd) := sext32(res32);
                          when others =>  -- "01" C.ADDW
                            res32 := std_logic_vector(r(rd)(31 downto 0) + r(rs2)(31 downto 0));
                            r(rd) := sext32(res32);
                        end case;
                      end if;
                  end case;
                when "101" =>  -- C.J
                  pc_next := pc_q + c_j_imm(h);
                when "110" =>  -- C.BEQZ
                  rs1 := 8 + to_integer(unsigned(h(9 downto 7)));
                  if r(rs1) = 0 then pc_next := pc_q + c_b_imm(h); end if;
                when others =>  -- "111" C.BNEZ
                  rs1 := 8 + to_integer(unsigned(h(9 downto 7)));
                  if r(rs1) /= 0 then pc_next := pc_q + c_b_imm(h); end if;
              end case;

            when others =>  -- "10" Quadrant 2
              case h(15 downto 13) is
                when "000" =>  -- C.SLLI (6-bit shamt)
                  rd := to_integer(unsigned(h(11 downto 7)));
                  if rd /= 0 then
                    sh6 := to_integer(unsigned(h(12) & h(6 downto 2)));
                    r(rd) := shift_left(r(rd), sh6);
                  end if;
                when "010" =>  -- C.LWSP (sext32)
                  rd := to_integer(unsigned(h(11 downto 7)));
                  if rd /= 0 then
                    do_load := true; ld_rd := rd; mem_sz := 4; ld_signed := true;
                    mem_eff := r(2) + c_lwsp_imm(h);
                  end if;
                when "011" =>  -- C.LDSP
                  rd := to_integer(unsigned(h(11 downto 7)));
                  if rd /= 0 then
                    do_load := true; ld_rd := rd; mem_sz := 8;
                    mem_eff := r(2) + c_ldsp_imm(h);
                  end if;
                when "100" =>  -- C.JR / C.MV / C.EBREAK / C.JALR / C.ADD
                  rd  := to_integer(unsigned(h(11 downto 7)));
                  rs2 := to_integer(unsigned(h(6 downto 2)));
                  if h(12) = '0' then
                    if rs2 = 0 then
                      if rd /= 0 then pc_next := r(rd); end if;  -- C.JR
                    elsif rd /= 0 then
                      r(rd) := r(rs2);                            -- C.MV
                    end if;
                  else
                    if rs2 = 0 then
                      if rd /= 0 then
                        pc_next := r(rd); r(1) := pc_q + 2;       -- C.JALR
                      end if;
                    elsif rd /= 0 then
                      r(rd) := r(rd) + r(rs2);                    -- C.ADD
                    end if;
                  end if;
                when "110" =>  -- C.SWSP
                  rs2 := to_integer(unsigned(h(6 downto 2)));
                  do_store := true; mem_sz := 4;
                  mem_eff := r(2) + c_swsp_imm(h); st_src := r(rs2);
                when "111" =>  -- C.SDSP
                  rs2 := to_integer(unsigned(h(6 downto 2)));
                  do_store := true; mem_sz := 8;
                  mem_eff := r(2) + c_sdsp_imm(h); st_src := r(rs2);
                when others => null;
              end case;
          end case;

        else
          ------------------------------------------------------------------
          -- 32-bit instruction (RV64IM + Zicsr) — ported from rv64_exec_core.
          ------------------------------------------------------------------
          pc_next := pc_q + 4;
          op  := ins(6 downto 0);
          f3  := ins(14 downto 12);
          rd  := to_integer(unsigned(ins(11 downto 7)));
          rs1 := to_integer(unsigned(ins(19 downto 15)));
          rs2 := to_integer(unsigned(ins(24 downto 20)));
          sh6 := to_integer(unsigned(ins(25 downto 20)));
          sh5 := to_integer(unsigned(ins(24 downto 20)));

          case op is
            when "0010011" =>  -- OP-IMM
              if rd /= 0 then
                case f3 is
                  when "000" => r(rd) := r(rs1) + sext(ins(31 downto 20));
                  when "111" => r(rd) := r(rs1) and sext(ins(31 downto 20));
                  when "110" => r(rd) := r(rs1) or sext(ins(31 downto 20));
                  when "100" => r(rd) := r(rs1) xor sext(ins(31 downto 20));
                  when "010" => if signed(r(rs1)) < signed(sext(ins(31 downto 20))) then r(rd) := to_unsigned(1, 64); else r(rd) := (others => '0'); end if;
                  when "011" => if r(rs1) < sext(ins(31 downto 20)) then r(rd) := to_unsigned(1, 64); else r(rd) := (others => '0'); end if;
                  when "001" => r(rd) := shift_left(r(rs1), sh6);
                  when others =>  -- "101" SRLI/SRAI (6-bit)
                    if ins(30) = '1' then r(rd) := unsigned(shift_right(signed(r(rs1)), sh6));
                    else r(rd) := shift_right(r(rs1), sh6); end if;
                end case;
              end if;

            when "0011011" =>  -- OP-IMM-32
              if rd /= 0 then
                case f3 is
                  when "000" =>  -- ADDIW
                    res32 := std_logic_vector(unsigned(r(rs1)(31 downto 0)) + unsigned(sext(ins(31 downto 20))(31 downto 0)));
                    r(rd) := sext32(res32);
                  when "001" =>  -- SLLIW
                    res32 := std_logic_vector(shift_left(unsigned(r(rs1)(31 downto 0)), sh5));
                    r(rd) := sext32(res32);
                  when others =>  -- "101" SRLIW/SRAIW
                    if ins(30) = '1' then res32 := std_logic_vector(shift_right(signed(r(rs1)(31 downto 0)), sh5));
                    else res32 := std_logic_vector(shift_right(unsigned(r(rs1)(31 downto 0)), sh5)); end if;
                    r(rd) := sext32(res32);
                end case;
              end if;

            when "0110011" =>  -- OP (R-type + M)
              if rd /= 0 then
                if ins(31 downto 25) = "0000001" then
                  case f3 is
                    when "000" =>
                      uprod := unsigned(r(rs1)) * unsigned(r(rs2));
                      r(rd) := uprod(63 downto 0);
                    when "001" =>
                      prod128 := signed(r(rs1)) * signed(r(rs2));
                      r(rd) := unsigned(prod128(127 downto 64));
                    when "010" =>
                      prod128 := signed(unsigned(r(rs1)) * unsigned(r(rs2)));
                      if signed(r(rs1)) < 0 then
                        prod128 := prod128 - shift_left(resize(signed(unsigned(r(rs2))), 128), 64);
                      end if;
                      r(rd) := unsigned(prod128(127 downto 64));
                    when "011" =>
                      uprod := unsigned(r(rs1)) * unsigned(r(rs2));
                      r(rd) := uprod(127 downto 64);
                    when "100" =>  -- DIV
                      if r(rs2) = 0 then r(rd) := (others => '1');
                      elsif r(rs1) = x"8000000000000000" and r(rs2) = x"FFFFFFFFFFFFFFFF" then r(rd) := x"8000000000000000";
                      else
                        a_s := signed(r(rs1)); b_s := signed(r(rs2));
                        a_mag := mag(r(rs1)); b_mag := mag(r(rs2));
                        div_neg_q <= (a_s(63) xor b_s(63)); div_is_rem_q <= '0'; div_is_w_q <= '0';
                        start_div := true;
                      end if;
                    when "101" =>  -- DIVU
                      if r(rs2) = 0 then r(rd) := (others => '1');
                      else a_mag := r(rs1); b_mag := r(rs2); div_neg_q <= '0'; div_is_rem_q <= '0'; div_is_w_q <= '0'; start_div := true; end if;
                    when "110" =>  -- REM
                      if r(rs2) = 0 then r(rd) := r(rs1);
                      elsif r(rs1) = x"8000000000000000" and r(rs2) = x"FFFFFFFFFFFFFFFF" then r(rd) := (others => '0');
                      else
                        a_s := signed(r(rs1)); a_mag := mag(r(rs1)); b_mag := mag(r(rs2));
                        div_neg_q <= a_s(63); div_is_rem_q <= '1'; div_is_w_q <= '0'; start_div := true;
                      end if;
                    when others =>  -- REMU
                      if r(rs2) = 0 then r(rd) := r(rs1);
                      else a_mag := r(rs1); b_mag := r(rs2); div_neg_q <= '0'; div_is_rem_q <= '1'; div_is_w_q <= '0'; start_div := true; end if;
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

            when "0111011" =>  -- OP-32 (W + W-M)
              if rd /= 0 then
                if ins(31 downto 25) = "0000001" then
                  case f3 is
                    when "000" =>  -- MULW
                      res32 := std_logic_vector(resize(signed(r(rs1)(31 downto 0)) * signed(r(rs2)(31 downto 0)), 32));
                      r(rd) := sext32(res32);
                    when "100" =>  -- DIVW
                      if r(rs2)(31 downto 0) = x"00000000" then r(rd) := (others => '1');
                      elsif r(rs1)(31 downto 0) = x"80000000" and r(rs2)(31 downto 0) = x"FFFFFFFF" then r(rd) := x"FFFFFFFF80000000";
                      else
                        a_s := resize(signed(r(rs1)(31 downto 0)), 64); b_s := resize(signed(r(rs2)(31 downto 0)), 64);
                        a_mag := mag(unsigned(a_s)); b_mag := mag(unsigned(b_s));
                        div_neg_q <= (a_s(63) xor b_s(63)); div_is_rem_q <= '0'; div_is_w_q <= '1'; start_div := true;
                      end if;
                    when "101" =>  -- DIVUW
                      if r(rs2)(31 downto 0) = x"00000000" then r(rd) := (others => '1');
                      else
                        a_mag := resize(unsigned(r(rs1)(31 downto 0)), 64); b_mag := resize(unsigned(r(rs2)(31 downto 0)), 64);
                        div_neg_q <= '0'; div_is_rem_q <= '0'; div_is_w_q <= '1'; start_div := true;
                      end if;
                    when "110" =>  -- REMW
                      if r(rs2)(31 downto 0) = x"00000000" then r(rd) := sext32(std_logic_vector(r(rs1)(31 downto 0)));
                      elsif r(rs1)(31 downto 0) = x"80000000" and r(rs2)(31 downto 0) = x"FFFFFFFF" then r(rd) := (others => '0');
                      else
                        a_s := resize(signed(r(rs1)(31 downto 0)), 64); b_s := resize(signed(r(rs2)(31 downto 0)), 64);
                        a_mag := mag(unsigned(a_s)); b_mag := mag(unsigned(b_s));
                        div_neg_q <= a_s(63); div_is_rem_q <= '1'; div_is_w_q <= '1'; start_div := true;
                      end if;
                    when others =>  -- REMUW
                      if r(rs2)(31 downto 0) = x"00000000" then r(rd) := sext32(std_logic_vector(r(rs1)(31 downto 0)));
                      else
                        a_mag := resize(unsigned(r(rs1)(31 downto 0)), 64); b_mag := resize(unsigned(r(rs2)(31 downto 0)), 64);
                        div_neg_q <= '0'; div_is_rem_q <= '1'; div_is_w_q <= '1'; start_div := true;
                      end if;
                  end case;
                else
                  case f3 is
                    when "000" =>
                      if ins(30) = '1' then res32 := std_logic_vector(unsigned(r(rs1)(31 downto 0)) - unsigned(r(rs2)(31 downto 0)));
                      else res32 := std_logic_vector(unsigned(r(rs1)(31 downto 0)) + unsigned(r(rs2)(31 downto 0))); end if;
                      r(rd) := sext32(res32);
                    when "001" =>
                      res32 := std_logic_vector(shift_left(unsigned(r(rs1)(31 downto 0)), to_integer(r(rs2)(4 downto 0))));
                      r(rd) := sext32(res32);
                    when others =>
                      if ins(30) = '1' then res32 := std_logic_vector(shift_right(signed(r(rs1)(31 downto 0)), to_integer(r(rs2)(4 downto 0))));
                      else res32 := std_logic_vector(shift_right(unsigned(r(rs1)(31 downto 0)), to_integer(r(rs2)(4 downto 0)))); end if;
                      r(rd) := sext32(res32);
                  end case;
                end if;
              end if;

            when "0010111" =>  -- AUIPC
              if rd /= 0 then r(rd) := pc_q + sext32(ins(31 downto 12) & x"000"); end if;

            when "0110111" =>  -- LUI
              if rd /= 0 then r(rd) := sext32(ins(31 downto 12) & x"000"); end if;

            when "1101111" =>  -- JAL
              if rd /= 0 then r(rd) := pc_q + 4; end if;
              pc_next := pc_q + sext(ins(31) & ins(19 downto 12) & ins(20) & ins(30 downto 21) & '0');

            when "1100111" =>  -- JALR
              eff := (r(rs1) + sext(ins(31 downto 20))) and x"FFFFFFFFFFFFFFFE";
              if rd /= 0 then r(rd) := pc_q + 4; end if;
              pc_next := eff;

            when "1100011" =>  -- BRANCH
              eff := pc_q + sext(ins(31) & ins(7) & ins(30 downto 25) & ins(11 downto 8) & '0');
              case f3 is
                when "000" => if r(rs1) = r(rs2) then pc_next := eff; end if;
                when "001" => if r(rs1) /= r(rs2) then pc_next := eff; end if;
                when "100" => if signed(r(rs1)) < signed(r(rs2)) then pc_next := eff; end if;
                when "101" => if signed(r(rs1)) >= signed(r(rs2)) then pc_next := eff; end if;
                when "110" => if r(rs1) < r(rs2) then pc_next := eff; end if;
                when others => if r(rs1) >= r(rs2) then pc_next := eff; end if;
              end case;

            when "0000011" =>  -- LOAD
              do_load := true; ld_rd := rd; mem_eff := r(rs1) + sext(ins(31 downto 20));
              case f3 is
                when "011" => mem_sz := 8; ld_signed := false;              -- LD
                when "010" => mem_sz := 4; ld_signed := true;               -- LW
                when "110" => mem_sz := 4; ld_signed := false;              -- LWU
                when "001" => mem_sz := 2; ld_signed := true;               -- LH
                when "101" => mem_sz := 2; ld_signed := false;              -- LHU
                when "000" => mem_sz := 1; ld_signed := true;               -- LB
                when others => mem_sz := 1; ld_signed := false;             -- LBU
              end case;

            when "0100011" =>  -- STORE
              do_store := true; mem_eff := r(rs1) + sext(ins(31 downto 25) & ins(11 downto 7)); st_src := r(rs2);
              case f3 is
                when "011" => mem_sz := 8;   -- SD
                when "010" => mem_sz := 4;   -- SW
                when "001" => mem_sz := 2;   -- SH
                when others => mem_sz := 1;  -- SB
              end case;

            when "1110011" =>  -- SYSTEM / Zicsr
              case f3 is
                when "000" => pc_next := pc_q;  -- ecall/ebreak: halt (hold pc)
                when "001" | "010" | "011" | "101" | "110" | "111" =>
                  if rd /= 0 then
                    case unsigned(ins(31 downto 20)) is
                      when x"f11" => r(rd) := csr_mhartid;
                      when x"300" => r(rd) := csr_mstatus;
                      when x"305" => r(rd) := csr_mtvec;
                      when x"304" => r(rd) := csr_mie;
                      when x"344" => r(rd) := csr_mip;
                      when x"b00" | x"c00" => r(rd) := csr_mcycle;
                      when others => r(rd) := (others => '0');
                    end case;
                  end if;
                when others => null;
              end case;

            when others => null;
          end case;
        end if;

        ------------------------------------------------------------------
        -- Unified memory service (RAM + ramdisk + UART MMIO).
        ------------------------------------------------------------------
        if do_load then
          if mem_eff = UART_ADDR + x"5" then
            -- 16550 LSR: THRE|TEMT so TX-empty polling progresses.
            if ld_rd /= 0 then r(ld_rd) := x"0000000000000060"; end if;
          else
            widx := 0; boff := to_integer(mem_eff(2 downto 0)); spill := (boff + mem_sz) > 8;
            tmp0 := (others => '0'); tmp1 := (others => '0');
            if in_ram(mem_eff) then
              widx := word_index(mem_eff);
              if widx < RAM_WORDS then tmp0 := ram(widx); end if;
              if spill and widx + 1 < RAM_WORDS then tmp1 := ram(widx + 1); end if;
            elsif in_rdisk(mem_eff) then
              widx := rdisk_index(mem_eff);
              if widx < RDISK_WORDS then tmp0 := rdisk(widx); end if;
              if spill and widx + 1 < RDISK_WORDS then tmp1 := rdisk(widx + 1); end if;
            end if;
            val64 := (others => '0');
            for i in 0 to 7 loop
              if i < mem_sz then
                bp := boff + i;
                if bp < 8 then val64(i * 8 + 7 downto i * 8) := tmp0(bp * 8 + 7 downto bp * 8);
                else val64(i * 8 + 7 downto i * 8) := tmp1((bp - 8) * 8 + 7 downto (bp - 8) * 8); end if;
              end if;
            end loop;
            if ld_rd /= 0 then
              case mem_sz is
                when 8 => r(ld_rd) := unsigned(val64);
                when 4 => if ld_signed then r(ld_rd) := sext32(val64(31 downto 0)); else r(ld_rd) := resize(unsigned(val64(31 downto 0)), 64); end if;
                when 2 => if ld_signed then r(ld_rd) := unsigned(resize(signed(val64(15 downto 0)), 64)); else r(ld_rd) := resize(unsigned(val64(15 downto 0)), 64); end if;
                when others => if ld_signed then r(ld_rd) := unsigned(resize(signed(val64(7 downto 0)), 64)); else r(ld_rd) := resize(unsigned(val64(7 downto 0)), 64); end if;
              end case;
            end if;
          end if;
        end if;

        if do_store then
          if mem_eff = UART_ADDR then
            uart_shift_q <= '1' & std_logic_vector(st_src(7 downto 0)) & '0';
            uart_tx_q    <= '0';
            uart_busy_q  <= '1';
            uart_baud_q  <= 0;
            uart_bits_q  <= 10;
            debug_uart_valid_q <= '1';
            debug_uart_byte_q  <= std_logic_vector(st_src(7 downto 0));
            next_pc_q <= pc_next;
            state_q   <= S_UART;
          elsif in_ram(mem_eff) then
            widx := word_index(mem_eff); boff := to_integer(mem_eff(2 downto 0));
            spill := (boff + mem_sz) > 8;
            if widx < RAM_WORDS then
              tmp0 := ram(widx);
              if spill and widx + 1 < RAM_WORDS then tmp1 := ram(widx + 1); else tmp1 := (others => '0'); end if;
              for i in 0 to 7 loop
                if i < mem_sz then
                  bp := boff + i;
                  if bp < 8 then tmp0(bp * 8 + 7 downto bp * 8) := std_logic_vector(st_src(i * 8 + 7 downto i * 8));
                  else tmp1((bp - 8) * 8 + 7 downto (bp - 8) * 8) := std_logic_vector(st_src(i * 8 + 7 downto i * 8)); end if;
                end if;
              end loop;
              ram(widx) := tmp0;
              if spill and widx + 1 < RAM_WORDS then ram(widx + 1) := tmp1; end if;
            end if;
          end if;
        end if;

        if start_div then
          div_dividend_q <= x"0000000000000000" & a_mag;
          div_divisor_q  <= b_mag;
          div_quotient_q <= (others => '0');
          div_count_q    <= to_unsigned(64, 7);
          div_rd_q       <= rd;
          state_q        <= S_DIVIDE;
        end if;

        debug_pc_q  <= std_logic_vector(pc_q);
        debug_ins_q <= ins;
        debug_a0_q  <= std_logic_vector(r(10));
        debug_ra_q  <= std_logic_vector(r(1));
        debug_sp_q  <= std_logic_vector(r(2));
        r(0) := (others => '0');
        regs_q <= r;
        if state_q = S_EXEC then
          pc_q <= pc_next;
        end if;
      end if;
    end if;
  end process;
end architecture rtl;
