/* ARM64 SimpleOS Linker Script
 *
 * Target: QEMU virt machine (aarch64)
 * RAM starts at 0x40000000, kernel loaded by QEMU -kernel flag.
 *
 * Memory layout:
 *   .text     — code (entry point first, then exception vectors)
 *   .rodata   — read-only data
 *   .data     — initialized read-write data
 *   .bss      — zero-initialized data
 *   .stack    — kernel stack (8 MB — Simple code uses large stack frames)
 *   .heap     — kernel heap (64 MB)
 *
 * The canonical QEMU runners provide at least 384 MiB. Keep 16 MiB outside
 * the linker-owned region for machine/transport headroom; the macOS host-GPU
 * lane reserves a separate final 8 MiB tail in its 512 MiB RAM backing file.
 *
 * Entry point: _start (in .text.entry section)
 * Exception vectors: .text.vectors (must be 2KB aligned for VBAR_EL1)
 */

OUTPUT_ARCH(aarch64)
OUTPUT_FORMAT("elf64-littleaarch64")
ENTRY(_start)

MEMORY {
    RAM (rwx) : ORIGIN = 0x40000000, LENGTH = 368M
}

SECTIONS {
    /* Code section — entry point must be first */
    .text : ALIGN(4K) {
        KEEP(*(.text.entry))        /* Boot entry point (_start) */
        . = ALIGN(2K);              /* VBAR_EL1 requires 2KB alignment */
        *(.text.vectors)            /* Exception vector table */
        *(.text*)                   /* All other code */
    } > RAM

    /* Read-only data */
    .rodata : ALIGN(4K) {
        *(.rodata*)
    } > RAM

    .simple_sandbox : ALIGN(4K) {
        __simple_sandbox_start = .;
        KEEP(*(.simple.sandbox*))
        KEEP(*(.simple.mpu*))
        __simple_sandbox_end = .;
    } > RAM

    /* Initialized read-write data */
    .data : ALIGN(4K) {
        *(.data*)
    } > RAM

    /* End of the LOADED image (everything past this point is NOLOAD).
     * crt0.S's self-relocation stub moves exactly [_start, _kernel_load_end)
     * when a real bootloader placed the image away from its link address. */
    _kernel_load_end = .;

    /* Zero-initialized data */
    .bss (NOLOAD) : ALIGN(4K) {
        _sbss = .;
        *(.bss*)
        *(COMMON)
        _ebss = .;
    } > RAM

    /* Kernel stack (grows downward, _stack_top is initial SP) */
    .stack (NOLOAD) : ALIGN(16) {
        _stack_bottom = .;
        . += 8M;
        _stack_top = .;
    } > RAM

    /* Kernel heap */
    .heap (NOLOAD) : ALIGN(4K) {
        __heap_start = .;
        . += 64M;
        __heap_end = .;
    } > RAM

    /* End of kernel image */
    _kernel_end = .;

    /* Total in-memory footprint, declared in the arm64 Linux `Image` header in
     * crt0.S so a real bootloader reserves the full span (text..heap), not just
     * the bytes present in the file. */
    _image_size = _kernel_end - _start;

    /* Discard unnecessary sections */
    /DISCARD/ : {
        *(.note*)
        *(.eh_frame*)
        *(.comment)
        *(.ARM.attributes)
        *(.ARM.exidx*)
    }
}
