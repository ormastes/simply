/* RISC-V 32 Linker Script — rv32 soft-core BRAM SoC (GHDL sim + KV260 FPGA)
 *
 * The board rv32_exec_core (examples/09_embedded/fpga_riscv/rtl/rv32_exec_core.vhd)
 * addresses code/stack through a single 64 KB BRAM window:
 *   word_index(addr) = (addr - 0x80000000)(15 downto 2)  -> words 0 .. 16383.
 * Any address whose bit-16+ is set ALIASES back into that 64 KB window. The
 * default kernel linker.ld (src/os/kernel/arch/riscv32/linker.ld) puts
 * _stack_top at 0x80010010 and an 8 MB heap at 0x80011000 — both alias onto
 * .text and corrupt it on the soft-core. This script confines .text + .rodata
 * + stack to ONE non-aliasing 64 KB window and drops the (unused) heap, so the
 * minimal NVMe self-test firmware runs on the real BRAM SoC.
 *
 * Output format: ELF32 little-endian RISC-V.
 */

OUTPUT_ARCH(riscv)
OUTPUT_FORMAT("elf32-littleriscv")
ENTRY(_start)

MEMORY {
    /* Single 64 KB code+data+stack BRAM window (matches ROM_WORDS*4 in the core). */
    BRAM (rwx) : ORIGIN = 0x80000000, LENGTH = 64K
}

SECTIONS {
    .text : ALIGN(4) {
        KEEP(*(.text.entry))
        *(.text.trap)
        *(.text*)
    } > BRAM

    .rodata : ALIGN(4) {
        *(.rodata*)
    } > BRAM

    .data : ALIGN(4) {
        *(.data*)
        *(.sdata*)
        PROVIDE(__global_pointer$ = . + 0x800);
    } > BRAM

    .bss (NOLOAD) : ALIGN(4) {
        _sbss = .;
        *(.bss*)
        *(.sbss*)
        *(COMMON)
        _ebss = .;
    } > BRAM

    .smp (NOLOAD) : ALIGN(4) {
        _smp_online_count = .;
        . += 4;
    } > BRAM

    .nandram (NOLOAD) : ALIGN(16) {
        _nandram_start = .;
        . += 256;
        _nandram_end = .;
    } > BRAM

    /* Stack grows DOWN from _stack_top. Kept small (8 KB) and placed so both
     * _stack_top and the deepest push stay inside the 64 KB window (word < 16384)
     * and ABOVE .text/.rodata — no aliasing, no code corruption. The firmware's
     * deepest observed frame chain is < 1 KB, so 8 KB is generous headroom. */
    .stack (NOLOAD) : ALIGN(16) {
        _stack_bottom = .;
        . += 8K;
        _stack_top = .;
    } > BRAM

    _kernel_end = .;

    /* Overflow past the 64 KB BRAM window is caught by ld's region-size check
     * ("section will not fit in region BRAM"). */

    /DISCARD/ : {
        *(.note*)
        *(.eh_frame*)
        *(.comment)
    }
}
