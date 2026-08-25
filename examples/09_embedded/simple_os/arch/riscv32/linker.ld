/* RISC-V 32 Linker Script — QEMU virt machine (M-mode, no OpenSBI)
 *
 * Kernel loaded at 0x80000000 — direct M-mode boot with -bios none.
 * RAM: 0x80000000 .. 0x8FFFFFFF (256MB total with -m 256M).
 * No OpenSBI firmware; kernel starts at RAM base.
 *
 * Stack: 8 MB (Simple code uses large stack frames)
 * Heap: 64 MB (bump allocator for runtime objects)
 *
 * Output format: ELF32 little-endian RISC-V.
 * Shared SECTIONS block: ../../common/linker_riscv_common.ld
 */

OUTPUT_ARCH(riscv)
OUTPUT_FORMAT("elf32-littleriscv")
ENTRY(_start)

MEMORY {
    RAM (rwx) : ORIGIN = 0x80000000, LENGTH = 256M
}

INCLUDE "examples/09_embedded/simple_os/arch/common/linker_riscv_common.ld"
