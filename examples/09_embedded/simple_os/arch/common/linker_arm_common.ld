/* ARM common SECTIONS tail — shared by arm32 and arm64 fs_exec_linker.ld.
 *
 * INCLUDE'd once inside each per-arch SECTIONS { } block, after the per-arch
 * .heap section.  Provides _kernel_end and the /DISCARD/ rule.
 *
 * Sections that stay per-arch (differ between arm32 and arm64):
 *   - OUTPUT_ARCH / OUTPUT_FORMAT / ENTRY / MEMORY  (preamble)
 *   - .text   (arm64 adds ALIGN(2K) + *(.text.vectors))
 *   - .rodata / .simple_sandbox / .data  (kept per-arch for future arch flags)
 *   - .bss    (arm32: __bss_start/__bss_end; arm64: _sbss/_ebss)
 *   - .stack  (arm32: ALIGN(8) 64K;  arm64: ALIGN(16) 8M)
 *   - .heap   (arm32: 4M;  arm64: 64M)
 */

    _kernel_end = .;

    /DISCARD/ : {
        *(.note*)
        *(.eh_frame*)
        *(.comment)
        *(.ARM.attributes)
        *(.ARM.exidx*)
    }
