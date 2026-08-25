library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;
use std.textio.all;
use ieee.std_logic_textio.all;

-- rv32_exec_core_flat: full-RAM behavioral sibling of rv32_exec_core.
--
-- The synthesizable rv32_exec_core confines code+data to a 64 KB window
-- (word_index = off(15 downto 2)) and therefore runs only payloads linked
-- wholly inside that window, such as the 64 KB NVMe self-test firmware.
-- The full rv32 SimpleOS kernel needs ~8.5 MB of contiguous RAM
-- (sp=_stack_top=0x8081d010, heap=0x8081e000), so this variant keeps the SAME
-- decode / ALU / CSR / M-extension / RVC logic but backs it with ONE flat
-- 16 MB behavioral RAM (word_index = off(23 downto 2), covering
-- 0x80000000..0x80FFFFFF). Memory access here is asynchronous single-cycle
-- (behavioral, NOT a BRAM model) so all the windowing/deferral/replication
-- machinery is gone; on silicon this 16 MB is PS DDR, not fabric BRAM.
--
-- Additions over the synthesizable core's memory front-end: lh/lhu/sh are
-- decoded (the NVMe-fw core only needed lb/lbu/lw/sb/sw). Byte/half stores are
-- read-modify-write within the single async cycle.

entity rv32_exec_core_flat is
  generic (
    CLK_FREQ : natural := 100000000;
    BAUD_RATE : natural := 115200;
    -- Main RAM depth in 32-bit words. Default 4,194,304 = 16 MB, the historical
    -- hardcoded size (DDR stand-in). A BRAM-only build overrides this with a
    -- much smaller depth; see tb_rv32_simpleos_boot_tiny.vhd. Addresses at or
    -- above BASE_ADDR + RAM_WORDS*4 simply fall outside is_ram(), so an image
    -- that overflows the configured budget faults visibly instead of aliasing.
    RAM_WORDS : natural := 4194304;
    -- Ramdisk bank depth in 32-bit words. Default 262,144 = 1 MiB.
    RDISK_WORDS : natural := 262144
  );
  port (
    clk : in std_logic;
    rst : in std_logic;
    uart_tx : out std_logic;
    debug_uart_valid : out std_logic;
    debug_uart_byte : out std_logic_vector(7 downto 0);
    debug_pc : out std_logic_vector(31 downto 0);
    debug_ins : out std_logic_vector(31 downto 0);
    debug_a0 : out std_logic_vector(31 downto 0);
    debug_ra : out std_logic_vector(31 downto 0);
    debug_sp : out std_logic_vector(31 downto 0)
  );
end entity rv32_exec_core_flat;

architecture rtl of rv32_exec_core_flat is
  constant BASE_ADDR : unsigned(31 downto 0) := x"80000000";
  constant UART_ADDR : unsigned(31 downto 0) := x"10000000";
  constant BAUD_DIV : natural := CLK_FREQ / BAUD_RATE;
  -- Flat RAM depth comes from the RAM_WORDS generic (default 16 MB =
  -- 4,194,304 words). The word index is still off(23 downto 2); a smaller
  -- RAM_WORDS narrows the decoded region rather than the index width.
  type regs_t is array(0 to 31) of unsigned(31 downto 0);
  type ram_t is array(0 to RAM_WORDS - 1) of std_logic_vector(31 downto 0);
  type state_t is (S_EXEC, S_DIVIDE, S_UART);

  impure function init_ram return ram_t is
    file f : text open read_mode is "rv32_flat.mem";
    variable line_v : line;
    variable word_v : std_logic_vector(31 downto 0);
    variable mem_v : ram_t := (others => x"00000000");
    variable idx : natural := 0;
  begin
    while not endfile(f) loop
      readline(f, line_v);
      hread(line_v, word_v);
      if idx < RAM_WORDS then
        mem_v(idx) := word_v;
      end if;
      idx := idx + 1;
    end loop;
    return mem_v;
  end function;

  signal ram : ram_t := init_ram;

  -- ------------------------------------------------------------------------
  -- Ramdisk bank (memory-backed FS for the GHDL soft-core FS/ls/launch lane).
  -- On silicon this window is a region of PS DDR at 0x88000000; here it is a
  -- small behavioral array preloaded from "rv32_ramdisk.mem" (a truncated
  -- FAT32 image, same 32-bit-LE-word-per-line hex format as rv32_flat.mem).
  -- The rv32 kernel's virtio_blk_read_sector() memcpy's 512-byte sectors out
  -- of this window when the kernel is built with -DRISCV_RAMDISK_BASE=
  -- 0x88000000 (arch/common/riscv_common.h). Read-only: the FS smoke never
  -- writes the disk, so no store path is provided. If rv32_ramdisk.mem is
  -- absent (non-FS boot lanes) the bank stays zero and the core still
  -- elaborates.
  -- ------------------------------------------------------------------------
  constant RDISK_BASE  : unsigned(31 downto 0) := x"88000000";
  -- Depth comes from the RDISK_WORDS generic (default 262,144 = 1 MiB window,
  -- off(19 downto 2)).
  type rdisk_t is array(0 to RDISK_WORDS - 1) of std_logic_vector(31 downto 0);

  impure function init_rdisk return rdisk_t is
    file f : text;
    variable fstatus : file_open_status;
    variable line_v : line;
    variable word_v : std_logic_vector(31 downto 0);
    variable mem_v : rdisk_t := (others => x"00000000");
    variable idx : natural := 0;
  begin
    file_open(fstatus, f, "rv32_ramdisk.mem", read_mode);
    if fstatus /= open_ok then
      return mem_v;
    end if;
    while not endfile(f) loop
      readline(f, line_v);
      hread(line_v, word_v);
      if idx < RDISK_WORDS then
        mem_v(idx) := word_v;
      end if;
      idx := idx + 1;
    end loop;
    file_close(f);
    return mem_v;
  end function;

  signal rdisk : rdisk_t := init_rdisk;
  -- CSR file (minimal zicsr; RO-ish, matches the synthesizable core)
  signal csr_mhartid : unsigned(31 downto 0) := x"00000000";
  signal csr_mstatus : unsigned(31 downto 0) := x"00000000";
  signal csr_mtvec : unsigned(31 downto 0) := x"00000000";
  signal csr_mie : unsigned(31 downto 0) := x"00000000";
  signal csr_mip : unsigned(31 downto 0) := x"00000000";
  -- Divider FSM state (multi-cycle for div/divu/rem/remu)
  signal div_running_q : std_logic := '0';
  signal div_rem_q : std_logic := '0';
  signal div_neg_result_q : std_logic := '0';
  signal div_dividend_q : signed(63 downto 0) := (others => '0');
  signal div_divisor_q : signed(63 downto 0) := (others => '0');
  signal div_quotient_q : signed(31 downto 0) := (others => '0');
  signal div_count_q : unsigned(5 downto 0) := (others => '0');
  signal div_rd_q : natural range 0 to 31 := 0;

  signal regs_q : regs_t := (others => (others => '0'));
  signal pc_q : unsigned(31 downto 0) := BASE_ADDR;
  signal state_q : state_t := S_EXEC;
  signal next_pc_q : unsigned(31 downto 0) := BASE_ADDR;
  signal uart_tx_q : std_logic := '1';
  signal uart_busy_q : std_logic := '0';
  signal uart_baud_q : natural range 0 to CLK_FREQ := 0;
  signal uart_bits_q : natural range 0 to 10 := 0;
  signal uart_shift_q : std_logic_vector(9 downto 0) := (others => '1');
  signal debug_uart_valid_q : std_logic := '0';
  signal debug_uart_byte_q : std_logic_vector(7 downto 0) := (others => '0');
  signal debug_pc_q : std_logic_vector(31 downto 0) := (others => '0');
  signal debug_ins_q : std_logic_vector(31 downto 0) := (others => '0');
  signal debug_a0_q : std_logic_vector(31 downto 0) := (others => '0');
  signal debug_ra_q : std_logic_vector(31 downto 0) := (others => '0');
  signal debug_sp_q : std_logic_vector(31 downto 0) := (others => '0');

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
    return to_integer(off(23 downto 2));
  end function;

  -- True when addr lands in the 0x80000000..0x80FFFFFF flat RAM window.
  function in_ram(addr : unsigned(31 downto 0)) return boolean is
  begin
    return addr >= BASE_ADDR and addr < BASE_ADDR + to_unsigned(RAM_WORDS * 4 - 1, 32);
  end function;

  -- True when addr lands in the ramdisk bank (0x88000000 .. +4 MiB).
  function in_rdisk(addr : unsigned(31 downto 0)) return boolean is
  begin
    return addr >= RDISK_BASE and addr < RDISK_BASE + to_unsigned(RDISK_WORDS * 4 - 1, 32);
  end function;

  function rdisk_index(addr : unsigned(31 downto 0)) return natural is
    variable off : unsigned(31 downto 0);
  begin
    off := addr - RDISK_BASE;
    return to_integer(off(19 downto 2));
  end function;
begin
  uart_tx <= uart_tx_q;
  debug_uart_valid <= debug_uart_valid_q;
  debug_uart_byte <= debug_uart_byte_q;
  debug_pc <= debug_pc_q;
  debug_ins <= debug_ins_q;
  debug_a0 <= debug_a0_q;
  debug_ra <= debug_ra_q;
  debug_sp <= debug_sp_q;

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
    variable lane : natural range 0 to 3;
    variable hlane : natural range 0 to 1;
    variable mem_idx : natural;
    variable load_addr : unsigned(31 downto 0);
    variable lw_val : std_logic_vector(31 downto 0);
    variable mul_result_full : signed(63 downto 0);
    variable rs1_signed : signed(31 downto 0);
    variable rs2_signed : signed(31 downto 0);
    variable dvd : signed(63 downto 0);
    variable res32 : unsigned(31 downto 0);
  begin
    if rising_edge(clk) then
      debug_uart_valid_q <= '0';
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
        state_q <= S_EXEC;
        uart_tx_q <= '1';
        uart_busy_q <= '0';
        uart_baud_q <= 0;
        uart_bits_q <= 0;
        uart_shift_q <= (others => '1');
        debug_uart_valid_q <= '0';
        debug_uart_byte_q <= (others => '0');
        debug_pc_q <= (others => '0');
        debug_ins_q <= (others => '0');
        debug_a0_q <= (others => '0');
        debug_ra_q <= (others => '0');
        debug_sp_q <= (others => '0');
        csr_mhartid <= (others => '0');
        csr_mstatus <= (others => '0');
        csr_mtvec <= (others => '0');
        csr_mie <= (others => '0');
        csr_mip <= (others => '0');
        div_running_q <= '0';
        div_rem_q <= '0';
        div_neg_result_q <= '0';
        div_dividend_q <= (others => '0');
        div_divisor_q <= (others => '0');
        div_quotient_q <= (others => '0');
        div_count_q <= (others => '0');
        div_rd_q <= 0;
      elsif state_q = S_UART then
        if uart_busy_q = '0' then
          pc_q <= next_pc_q;
          state_q <= S_EXEC;
        end if;
      elsif state_q = S_DIVIDE then
        if div_count_q /= 0 then
          div_count_q <= div_count_q - 1;
          dvd := shift_left(div_dividend_q, 1);
          if unsigned(dvd(63 downto 32)) >= unsigned(div_divisor_q(31 downto 0)) then
            dvd(63 downto 32) := dvd(63 downto 32) - div_divisor_q(31 downto 0);
            div_quotient_q <= shift_left(div_quotient_q, 1) + 1;
          else
            div_quotient_q <= shift_left(div_quotient_q, 1);
          end if;
          div_dividend_q <= dvd;
        else
          div_running_q <= '0';
          state_q <= S_EXEC;
          if div_rem_q = '1' then
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
          if div_rd_q /= 0 then
            regs_q(div_rd_q) <= res32;
          end if;
          div_rd_q <= 0;
        end if;
      else
        -- S_EXEC: fetch (async), decode, execute in one cycle.
        r := regs_q;
        state_q <= S_EXEC;
        pc_next := pc_q + 4;
        pc_idx := word_index(pc_q);
        if pc_idx < RAM_WORDS then
          w := ram(pc_idx);
        else
          w := x"00000013";
        end if;
        if pc_q(1) = '0' then
          h := w(15 downto 0);
          ins := w;
        else
          h := w(31 downto 16);
          if pc_idx + 1 < RAM_WORDS then
            w2 := ram(pc_idx + 1);
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
                rd := 8 + to_integer(unsigned(h(9 downto 7)));
                case h(11 downto 10) is
                  when "00" =>
                    r(rd) := shift_right(r(rd), to_integer(unsigned(h(6 downto 2))));
                  when "01" =>
                    r(rd) := unsigned(shift_right(signed(r(rd)), to_integer(unsigned(h(6 downto 2)))));
                  when "10" =>
                    r(rd) := r(rd) and c_addi_imm(h);
                  when others =>
                    rs2 := 8 + to_integer(unsigned(h(4 downto 2)));
                    case h(6 downto 5) is
                      when "00" => r(rd) := r(rd) - r(rs2);
                      when "01" => r(rd) := r(rd) xor r(rs2);
                      when "10" => r(rd) := r(rd) or r(rs2);
                      when others => r(rd) := r(rd) and r(rs2);
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
              if in_ram(load_addr) then
                r(rd) := unsigned(ram(word_index(load_addr)));
              elsif in_rdisk(load_addr) then
                r(rd) := unsigned(rdisk(rdisk_index(load_addr)));
              else
                r(rd) := (others => '0');
              end if;
            elsif h(15 downto 13) = "110" then
              rs1 := 8 + to_integer(unsigned(h(9 downto 7)));
              rs2 := 8 + to_integer(unsigned(h(4 downto 2)));
              eff := r(rs1) + c_lw_imm(h);
              if in_ram(eff) then
                ram(word_index(eff)) <= std_logic_vector(r(rs2));
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
                if in_ram(load_addr) then
                  r(rd) := unsigned(ram(word_index(load_addr)));
                elsif in_rdisk(load_addr) then
                  r(rd) := unsigned(rdisk(rdisk_index(load_addr)));
                else
                  r(rd) := (others => '0');
                end if;
              end if;
            elsif h(15 downto 13) = "100" then
              rd := to_integer(unsigned(h(11 downto 7)));
              rs2 := to_integer(unsigned(h(6 downto 2)));
              if h(12) = '0' then
                if rs2 = 0 then
                  if rd /= 0 then
                    pc_next := r(rd);
                  end if;
                elsif rd /= 0 then
                  r(rd) := r(rs2);
                end if;
              else
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
              if in_ram(eff) then
                ram(word_index(eff)) <= std_logic_vector(r(rs2));
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
                  case ins(14 downto 12) is
                    when "000" =>
                      mul_result_full := signed(unsigned(r(rs1))) * signed(unsigned(r(rs2)));
                      r(rd) := unsigned(mul_result_full(31 downto 0));
                    when "001" =>
                      mul_result_full := signed(r(rs1)) * signed(r(rs2));
                      r(rd) := unsigned(mul_result_full(63 downto 32));
                    when "010" =>
                      mul_result_full := signed(unsigned(r(rs1)) * unsigned(r(rs2)));
                      if signed(r(rs1)) < 0 then
                        mul_result_full := mul_result_full - shift_left(resize(signed(unsigned(r(rs2))), 64), 32);
                      end if;
                      r(rd) := unsigned(mul_result_full(63 downto 32));
                    when "011" =>
                      mul_result_full := signed(unsigned(r(rs1)) * unsigned(r(rs2)));
                      r(rd) := unsigned(mul_result_full(63 downto 32));
                    when "100" => -- div
                      if r(rs2) = 0 then
                        r(rd) := x"FFFFFFFF";
                      elsif signed(r(rs1)) = -16#80000000# and r(rs2) = x"FFFFFFFF" then
                        r(rd) := x"80000000";
                      else
                        div_running_q <= '1';
                        div_rem_q <= '0';
                        div_rd_q <= rd;
                        rs1_signed := signed(r(rs1));
                        rs2_signed := signed(r(rs2));
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
                    when "101" => -- divu
                      if r(rs2) = 0 then
                        r(rd) := x"FFFFFFFF";
                      else
                        div_running_q <= '1';
                        div_rem_q <= '0';
                        div_neg_result_q <= '0';
                        div_rd_q <= rd;
                        div_dividend_q <= to_signed(0, 32) & signed(r(rs1));
                        div_divisor_q <= to_signed(0, 32) & signed(r(rs2));
                        div_count_q <= to_unsigned(32, 6);
                        div_quotient_q <= (others => '0');
                        state_q <= S_DIVIDE;
                      end if;
                    when "110" => -- rem
                      if r(rs2) = 0 then
                        r(rd) := r(rs1);
                      elsif signed(r(rs1)) = -16#80000000# and r(rs2) = x"FFFFFFFF" then
                        r(rd) := x"00000000";
                      else
                        div_running_q <= '1';
                        div_rem_q <= '1';
                        div_rd_q <= rd;
                        rs1_signed := signed(r(rs1));
                        rs2_signed := signed(r(rs2));
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
                    when "111" => -- remu
                      if r(rs2) = 0 then
                        r(rd) := r(rs1);
                      else
                        div_running_q <= '1';
                        div_rem_q <= '1';
                        div_neg_result_q <= '0';
                        div_rd_q <= rd;
                        div_dividend_q <= to_signed(0, 32) & signed(r(rs1));
                        div_divisor_q <= to_signed(0, 32) & signed(r(rs2));
                        div_count_q <= to_unsigned(32, 6);
                        div_quotient_q <= (others => '0');
                        state_q <= S_DIVIDE;
                      end if;
                    when others => null;
                  end case;
                else
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
            when "0010111" => -- auipc
              if rd /= 0 then r(rd) := pc_q + shift_left(resize(unsigned(ins(31 downto 12)), 32), 12); end if;
            when "0110111" => -- lui
              if rd /= 0 then r(rd) := shift_left(resize(unsigned(ins(31 downto 12)), 32), 12); end if;
            when "1101111" => -- jal
              if rd /= 0 then r(rd) := pc_q + 4; end if;
              pc_next := pc_q + sext(ins(31) & ins(19 downto 12) & ins(20) & ins(30 downto 21) & '0');
            when "1100111" => -- jalr
              pc_next := (r(rs1) + sext(ins(31 downto 20))) and x"fffffffe";
              if rd /= 0 then r(rd) := pc_q + 4; end if;
            when "1100011" => -- branch
              eff := pc_q + sext(ins(31) & ins(7) & ins(30 downto 25) & ins(11 downto 8) & '0');
              case ins(14 downto 12) is
                when "000" => if r(rs1) = r(rs2) then pc_next := eff; end if;
                when "001" => if r(rs1) /= r(rs2) then pc_next := eff; end if;
                when "100" => if signed(r(rs1)) < signed(r(rs2)) then pc_next := eff; end if;
                when "101" => if signed(r(rs1)) >= signed(r(rs2)) then pc_next := eff; end if;
                when "110" => if r(rs1) < r(rs2) then pc_next := eff; end if;
                when others => if r(rs1) >= r(rs2) then pc_next := eff; end if;
              end case;
            when "0000011" => -- loads
              eff := r(rs1) + sext(ins(31 downto 20));
              if eff = UART_ADDR + x"00000005" then
                -- 16550 LSR read: report THRE|TEMT so TX-empty polls progress.
                if rd /= 0 then r(rd) := x"00000060"; end if;
              elsif rd /= 0 then
                if in_ram(eff) then
                  lw_val := ram(word_index(eff));
                elsif in_rdisk(eff) then
                  lw_val := rdisk(rdisk_index(eff));
                else
                  lw_val := (others => '0');
                end if;
                case ins(14 downto 12) is
                  when "000" => -- lb
                    lane := to_integer(eff(1 downto 0));
                    r(rd) := sext(lw_val(lane * 8 + 7 downto lane * 8));
                  when "100" => -- lbu
                    lane := to_integer(eff(1 downto 0));
                    r(rd) := resize(unsigned(lw_val(lane * 8 + 7 downto lane * 8)), 32);
                  when "001" => -- lh
                    hlane := to_integer(eff(1 downto 1));
                    r(rd) := sext(lw_val(hlane * 16 + 15 downto hlane * 16));
                  when "101" => -- lhu
                    hlane := to_integer(eff(1 downto 1));
                    r(rd) := resize(unsigned(lw_val(hlane * 16 + 15 downto hlane * 16)), 32);
                  when others => -- lw
                    r(rd) := unsigned(lw_val);
                end case;
              end if;
            when "0100011" => -- stores
              eff := r(rs1) + sext(ins(31 downto 25) & ins(11 downto 7));
              if eff = UART_ADDR and ins(14 downto 12) = "000" then
                uart_shift_q <= '1' & std_logic_vector(r(rs2)(7 downto 0)) & '0';
                uart_tx_q <= '0';
                uart_busy_q <= '1';
                uart_baud_q <= 0;
                uart_bits_q <= 10;
                debug_uart_valid_q <= '1';
                debug_uart_byte_q <= std_logic_vector(r(rs2)(7 downto 0));
                next_pc_q <= pc_next;
                state_q <= S_UART;
              elsif in_ram(eff) then
                mem_idx := word_index(eff);
                lw_val := ram(mem_idx);
                case ins(14 downto 12) is
                  when "000" => -- sb (read-modify-write)
                    lane := to_integer(eff(1 downto 0));
                    data_w := lw_val;
                    data_w(lane * 8 + 7 downto lane * 8) := std_logic_vector(r(rs2)(7 downto 0));
                    ram(mem_idx) <= data_w;
                  when "001" => -- sh (read-modify-write)
                    hlane := to_integer(eff(1 downto 1));
                    data_w := lw_val;
                    data_w(hlane * 16 + 15 downto hlane * 16) := std_logic_vector(r(rs2)(15 downto 0));
                    ram(mem_idx) <= data_w;
                  when others => -- sw
                    ram(mem_idx) <= std_logic_vector(r(rs2));
                end case;
              end if;
            when "1110011" => -- system / csr
              case ins(14 downto 12) is
                when "000" =>
                  -- ecall / ebreak: halt cleanly (hold pc)
                  if ins(31 downto 20) = "000000000000" or ins(31 downto 20) = "000000000001" then
                    pc_next := pc_q;
                  end if;
                when "001" | "010" | "011" | "101" | "110" | "111" =>
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
                when others => null;
              end case;
            when others => null;
          end case;
        end if;

        debug_pc_q <= std_logic_vector(pc_q);
        debug_ins_q <= ins;
        debug_a0_q <= std_logic_vector(r(10));
        debug_ra_q <= std_logic_vector(r(1));
        debug_sp_q <= std_logic_vector(r(2));
        r(0) := (others => '0');
        regs_q <= r;
        if state_q = S_EXEC then
          pc_q <= pc_next;
        end if;
      end if;
    end if;
  end process;
end architecture rtl;
