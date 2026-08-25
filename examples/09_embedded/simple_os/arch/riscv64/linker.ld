/* RISC-V 64 SimpleOS Linker Script — S-mode with OpenSBI
 *
 * Kernel is loaded at 0x80200000 by OpenSBI as an S-mode payload.
 * OpenSBI occupies 0x80000000..0x801FFFFF (2MB).
 *
 * Memory layout (QEMU virt, 512MB RAM):
 *   0x80000000 - 0x801FFFFF : OpenSBI (2MB, reserved)
 *   0x80200000 - onwards    : Kernel image
 *
 * Stack: 8 MB (Simple code uses large stack frames)
 * Heap: 64 MB (bump allocator for runtime objects)
 *
 * Sections are 4KB-aligned for page table compatibility (Sv39).
 * Shared SECTIONS block: ../../common/linker_riscv_common.ld
 */
OUTPUT_ARCH(riscv)
OUTPUT_FORMAT("elf64-littleriscv")
ENTRY(_start)

MEMORY {
    RAM (rwx) : ORIGIN = 0x80200000, LENGTH = 510M
}

INCLUDE "examples/09_embedded/simple_os/arch/common/linker_riscv_common.ld"
