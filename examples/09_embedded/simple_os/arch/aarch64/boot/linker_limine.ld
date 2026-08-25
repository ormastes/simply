/* Limine-protocol linker script for SimpleOS aarch64.
 *
 * Distinct from arch/arm64/*.ld (the EL1-direct bare-metal `-kernel` lane
 * owned by a separate concurrent lane): this script targets the real-firmware
 * lane where Limine's BOOTAA64.EFI loads a plain ELF per the Limine boot
 * protocol and jumps straight to its ELF entry (kernel_main, see
 * src/os/kernel/boot/limine_boot_aarch64.spl).
 *
 * Two hard requirements confirmed empirically against Limine v10.8.5
 * (limine-bootloader/limine, v10.x-binary branch) — neither is documented
 * in PROTOCOL.md in an obvious place, both produce a hard PANIC otherwise:
 *   1. The kernel must link higher-half (>= 0xffff800000000000-style
 *      canonical higher half). A lower-half link address is REJECTED
 *      ("Lower half PHDRs are not allowed").
 *   2. Every PT_LOAD segment must be page-aligned and non-overlapping in
 *      its own page (mixed R/W permissions may not share a physical page:
 *      "Attempted to load ELF file with PHDRs with different permissions
 *      sharing the same memory page").
 *
 * Physical load address 0x40100000 matches QEMU `virt` machine's default
 * RAM base (0x40000000) plus a 1 MiB offset, mirroring the physical-address
 * convention already used by arch/arm64 (entry 0x40200000) and leaving room
 * below for any future decompressor/relocator stage.
 */
ENTRY(_start)

PHDRS {
    text PT_LOAD FLAGS(5); /* R+X */
    data PT_LOAD FLAGS(6); /* R+W */
}

SECTIONS {
    . = 0xffffffff80100000;
    _kernel_start = .;

    .text : AT(0x40100000) {
        *(.text*)
    } :text

    . = ALIGN(0x1000);
    .limine_reqs : AT(0x40100000 + (. - 0xffffffff80100000)) {
        *(.limine_reqs)
    } :data

    .rodata : AT(0x40100000 + (. - 0xffffffff80100000)) {
        *(.rodata*)
    } :data

    .data : AT(0x40100000 + (. - 0xffffffff80100000)) {
        *(.data*)
    } :data

    . = ALIGN(0x1000);
    .bss : AT(0x40100000 + (. - 0xffffffff80100000)) {
        _bss_start = .;
        *(.bss*)
        *(COMMON)
        _bss_end = .;
    } :data

    . = ALIGN(0x1000);
    _kernel_end = .;

    /DISCARD/ : { *(.comment) *(.note*) *(.eh_frame*) }
}

/* Linker-provided symbols consumed by limine_boot_aarch64.spl's
 * _get_kernel_end()/_get_bss_start() externs (kernel-size estimation). */
