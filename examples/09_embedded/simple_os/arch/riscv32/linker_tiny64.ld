/* RISC-V 32 TINY-64K Linker Script — linker_tiny.ld with a 64 KB stack.
 *
 * Same BRAM-only layout as linker_tiny.ld (see that file for the full
 * rationale), but with the stack reservation right-sized from 256 KB down to
 * 64 KB. The 256 KB figure came from a broken high-water probe that scanned
 * for the first SURVIVING sentinel (== _stack_bottom on any healthy boot) and
 * therefore reported exactly 100% used at every size. The corrected probe
 * (baremetal_stubs.c tiny_stack_report, 2026-07-26) measures the true boot
 * high-water at 344 bytes of 262144 in GHDL, so 64 KB is ~190x headroom.
 *
 * RESULTING LAYOUT (ORIGIN 0x80000000):
 *     .text .rodata .data .bss   -> ends 0x8001f004  (~124 KB)
 *     .stack   64 KB
 *     .heap     4 KB
 *     total   ~196 KB — fits a 256 KB (65536-word) BRAM main RAM.
 *
 * Proven by scripts/fpga/ghdl_rv32_simpleos_boot_tiny.shs with
 * KERNEL_ELF=build/os/simpleos_riscv32_smf_fs_tiny64.elf RAM_WORDS=65536.
 *
 * Output format: ELF32 little-endian RISC-V.
 * Shared SECTIONS block: ../../common/linker_riscv_common.ld
 */

OUTPUT_ARCH(riscv)
OUTPUT_FORMAT("elf32-littleriscv")
ENTRY(_start)

MEMORY {
    RAM (rwx) : ORIGIN = 0x80000000, LENGTH = 2M
}

/* Overrides for the shared SECTIONS block (defaults there: 8M / 64M). */
__stack_size = 64K;
__heap_size  = 4K;

INCLUDE "examples/09_embedded/simple_os/arch/common/linker_riscv_common.ld"
