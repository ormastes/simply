# ring3_smoke.S — Minimal x86_64 freestanding user-mode ELF
#
# FR-SOS-024 Phase 3: ring-3 smoke test binary.
#
# Emits three bytes ('R', '3', '\n') to the kernel serial port via
# syscall 60 (DebugWrite), then calls syscall 0 (Exit) with code 0.
#
# SimpleOS syscall ABI (System V AMD64):
#   rax = syscall number
#   rdi = arg0 (a0)
#   rsi = arg1, rdx = arg2, r10 = arg3, r8 = arg4, r9 = arg5
#
# Syscall 60 = DebugWrite: a0 = byte to write to COM1 serial
# Syscall  0 = Exit:       a0 = exit code

.section .text
.globl _start
_start:
    # DebugWrite 'R' (0x52)
    mov     $60, %rax
    mov     $0x52, %rdi
    syscall

    # DebugWrite '3' (0x33)
    mov     $60, %rax
    mov     $0x33, %rdi
    syscall

    # DebugWrite '\n' (0x0A)
    mov     $60, %rax
    mov     $0x0A, %rdi
    syscall

    # Exit with code 0
    xor     %rdi, %rdi
    mov     $0, %rax
    syscall

    # Safety: infinite loop if Exit syscall somehow returns
1:
    jmp     1b
