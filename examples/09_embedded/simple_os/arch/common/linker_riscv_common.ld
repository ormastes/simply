/* RISC-V common SECTIONS block — shared by riscv32 and riscv64.
 *
 * INCLUDE'd from each per-arch linker.ld after the MEMORY block.
 * Per-arch files supply the width-specific preamble:
 *   OUTPUT_ARCH(riscv)
 *   OUTPUT_FORMAT("elf32-littleriscv" | "elf64-littleriscv")
 *   ENTRY(_start)
 *   MEMORY { RAM (rwx) : ORIGIN = <arch-origin>, LENGTH = <arch-len> }
 *   __stack_size = <n>; __heap_size = <n>;      (optional — see below)
 *   INCLUDE "../../common/linker_riscv_common.ld"
 *
 * What stays per-arch:
 *   - OUTPUT_FORMAT (elf32 vs elf64)
 *   - MEMORY ORIGIN (0x80000000 rv32 M-mode vs 0x80200000 rv64 S-mode/OpenSBI)
 *   - MEMORY LENGTH (256M vs 510M)
 *   - __stack_size / __heap_size (the two NOLOAD reservations that dominate the
 *     image's RAM footprint; see the SIZING NOTE below)
 *
 * What lives here (identical for both widths):
 *   - Full SECTIONS block: .text, .rodata, .data, .bss, .stack, .heap
 *   - _kernel_end symbol
 *   - /DISCARD/ rule
 *
 * SIZING NOTE (why __stack_size/__heap_size are knobs, not literals):
 *   `llvm-size` reports every NOBITS section in its "bss" column, so the rv32
 *   SMF/FS image appears to have a 72 MB .bss. It does not — real .bss is
 *   ~104 KB. The other ~72 MB is entirely THIS file's two NOLOAD reservations:
 *       .bss    0x0001a004 =    106,500 B   <- real static data
 *       .stack  0x00800000 =  8,388,608 B   <- reservation below
 *       .heap   0x04000000 = 67,108,864 B   <- reservation below
 *                             ----------
 *                             75,603,972 B  == the reported "bss", exactly.
 *   Making them per-arch knobs lets a BRAM-only FPGA target (riscv32/
 *   linker_tiny.ld) reserve a realistic amount without forking this SECTIONS
 *   block or perturbing the default QEMU images.
 */

/* Defaults preserve historical behaviour byte-for-byte when a per-arch script
 * does not override them (8 MB stack — Simple frames are large; 64 MB heap). */
__stack_size = DEFINED(__stack_size) ? __stack_size : 8M;
__heap_size  = DEFINED(__heap_size)  ? __heap_size  : 64M;

SECTIONS {
    /* Executable code — entry point first */
    .text : ALIGN(4K) {
        KEEP(*(.text.entry))        /* _start entry point */
        *(.text.trap)               /* Trap vector (must be 4-byte aligned) */
        *(.text*)
    } > RAM

    /* Read-only data */
    .rodata : ALIGN(4K) {
        *(.rodata*)
        *(.srodata*)
    } > RAM

    /* Initialized read-write data */
    .data : ALIGN(4K) {
        *(.data*)
        *(.sdata*)
        PROVIDE(__global_pointer$ = . + 0x800);
    } > RAM

    /* Uninitialized data — zeroed by the kernel itself in _start (crt0).
     * _sbss is 4K-aligned via the section ALIGN; _ebss is padded to 8 bytes
     * so both the rv32 word loop and the rv64 doubleword loop terminate
     * exactly (loop condition: bgeu t0, t1). */
    .bss (NOLOAD) : ALIGN(4K) {
        _sbss = .;
        *(.bss*)
        *(.sbss*)
        *(COMMON)
        . = ALIGN(8);
        _ebss = .;
    } > RAM

    /* Kernel stack (default 8MB — Simple code uses large stack frames) */
    .stack (NOLOAD) : ALIGN(16) {
        _stack_bottom = .;
        . += __stack_size;
        _stack_top = .;
    } > RAM

    /* Kernel heap (default 64MB for bump allocator) */
    .heap (NOLOAD) : ALIGN(4K) {
        __heap_start = .;
        . += __heap_size;
        __heap_end = .;
    } > RAM

    _kernel_end = .;

    /DISCARD/ : {
        *(.note*)
        *(.eh_frame*)
        *(.comment)
    }
}
