/* One-shot ARM64 mounted-ELF acceptance payload.
 *
 * SimpleOS AArch64 syscall ABI:
 *   x8 = syscall number, x0..x4 = arguments
 * DebugWrite (60) writes the low byte of x0; Exit (0) takes status in x0.
 */

.section .text
.global _start
.type _start, %function

_start:
    adrp    x19, mounted_elf_nonce
    add     x19, x19, :lo12:mounted_elf_nonce
    mov     x20, #mounted_elf_nonce_len

1:
    ldrb    w0, [x19], #1
    mov     x8, #60
    svc     #0
    subs    x20, x20, #1
    b.ne    1b

    mov     x0, #0
    mov     x8, #0
    svc     #0

2:
    wfe
    b       2b

.size _start, . - _start

.section .rodata
mounted_elf_nonce:
    .ascii  "[arm64-fs-user] mounted-elf-ok\n"
.set mounted_elf_nonce_len, . - mounted_elf_nonce
