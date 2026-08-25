/*
 * enter_user_first.s — SimpleOS x86_64 first-dispatch ring-3 entry helper.
 *
 * FR-SOS-024 Phase 3. Called by the kernel after `create_user_task` builds a
 * user-mode TCB and its address space. Swaps to the per-task PML4 and iretq's
 * into the user's entry point at CPL 3.
 *
 * C-ABI signature (extern fn from Simple), 6 arguments in Sys V AMD64 order:
 *
 *   void rt_x86_enter_user_first(
 *       uint64_t rip,       // rdi
 *       uint64_t rsp,       // rsi
 *       uint64_t cs,        // rdx  (must have RPL=3 for ring-3 target)
 *       uint64_t ss,        // rcx  (must have RPL=3)
 *       uint64_t rflags,    // r8
 *       uint64_t cr3_phys)  // r9
 *
 * All user GPRs are zeroed before the iretq — the user task's entry
 * convention (SysV AMD64 for _start) reads argc/argv/envp from the stack
 * top (`rsp` points at argc).
 *
 * Caveats (MVP):
 *   - Does NOT touch TSS.RSP0. Syscalls from CPL 3 go through the LSTAR
 *     trampoline which swaps to `_kernel_syscall_stack_top` directly.
 *     TSS.RSP0 is only needed for hardware interrupts / page faults from
 *     CPL 3, which this MVP does not exercise.
 *   - Does NOT return. If the user calls exit (syscall 0) the baremetal
 *     dispatcher exits QEMU via isa-debug-exit.
 *   - Assumes cr3_phys maps the kernel image at its HHDM/identity range,
 *     which `create_user_address_space()` already arranges.
 */

    .section .text
    .globl rt_x86_enter_user_first
    .type rt_x86_enter_user_first, @function
    .align 16
rt_x86_enter_user_first:
    /* --- ring-3 resume savepoint (setjmp) ---------------------------------
     * Capture the kernel context of THIS caller (the sshd accept-loop frame,
     * via x86_64_fs_exec_enter_image_ring3 -> arch_x86_64_enter_user_task) so
     * that when the ring-3 program calls exit(2), rt_syscall_dispatch case 0
     * can longjmp back here (rt_x86_ring3_resume) instead of taking QEMU down
     * via isa-debug-exit. This makes the spawn call chain RETURNING, so the
     * accept loop survives and can service a second command in one boot.
     *
     * Safety of the saved rsp: the ring-3 program runs with IF=0 (ctx.rflags
     * 0x3002, bit 9 clear) and TSS.RSP0 is not used for the syscall path, so
     * nothing preempts onto — and corrupts — this saved kernel stack while the
     * user program runs. The exit syscall runs on the separate global
     * _kernel_syscall_stack, leaving [saved_rsp] (the return address) intact.
     *
     * cr3 is captured HERE, before the `movq %rax,%cr3` swap below, so it is
     * the KERNEL cr3 — restoring it on resume is required (the user AS clones
     * only the low half; the high-half NVMe BAR / kernel-only mappings live in
     * the kernel PML4). Must run before `movq %r9,%rax` reloads rax. */
    movq    %rbx, _ring3_resume_buf+0(%rip)
    movq    %rbp, _ring3_resume_buf+8(%rip)
    movq    %r12, _ring3_resume_buf+16(%rip)
    movq    %r13, _ring3_resume_buf+24(%rip)
    movq    %r14, _ring3_resume_buf+32(%rip)
    movq    %r15, _ring3_resume_buf+40(%rip)
    movq    %rsp, _ring3_resume_buf+48(%rip)   /* rsp -> return address */
    movq    %cr3, %rax
    movq    %rax, _ring3_resume_buf+56(%rip)   /* kernel cr3 (pre-swap) */
    movq    $1, _ring3_resume_valid(%rip)

    /* Stash CR3 into a callee-saved register before any stack push so the
     * stack writes happen before we swap address spaces. The pushes below
     * write to the kernel stack, which must still be mapped after cr3 load
     * (and it is — create_user_address_space copies the kernel mappings). */
    movq    %r9, %rax               /* cr3 */

    /* Fault-only IRET receipt.  Capture the unmodified ABI arguments before
     * the diagnostic UART writes and before the frame is built, so an IRET
     * #GP can distinguish an invalid supplied frame from descriptor state.
     * These are kernel-private BSS words in the cloned PML4[0] mapping. */
    movq    %rdi, _ring3_iret_rip(%rip)
    movq    %rsi, _ring3_iret_rsp(%rip)
    movq    %rdx, _ring3_iret_cs(%rip)
    movq    %rcx, _ring3_iret_ss(%rip)
    movq    %r8,  _ring3_iret_rflags(%rip)

    /* Diagnostic-only boundary receipts. Preserve the cached CR3 and user
     * CS around the first UART write: this code runs before the iret frame is
     * built and must not mutate either value consumed below. */
    pushq   %rax
    pushq   %rdx
    movw    $0x3f8, %dx
    movb    $'A', %al
    outb    %al, %dx
    popq    %rdx
    popq    %rax

    /* Build the iret frame on the current (kernel) stack.
     * Hardware pops in order RIP, CS, RFLAGS, RSP, SS — so we push SS first. */
    pushq   %rcx                    /* SS   (arg4) */
    pushq   %rsi                    /* RSP  (arg2) */
    pushq   %r8                     /* RFLAGS (arg5) */
    pushq   %rdx                    /* CS   (arg3) */
    pushq   %rdi                    /* RIP  (arg1) */

    /* Swap to the user address space. Kernel is mapped in the user PML4
     * (clone of kernel range), so execution continues past this. */
    movq    %rax, %cr3

    /* B proves the new CR3 accepted and still maps kernel serial code. */
    movw    $0x3f8, %dx
    movb    $'B', %al
    outb    %al, %dx

    /* Zero GPRs so the user starts with a clean register file. */
    xorl    %eax, %eax
    xorl    %ebx, %ebx
    xorl    %ecx, %ecx
    xorl    %edx, %edx
    xorl    %esi, %esi
    xorl    %edi, %edi
    xorl    %ebp, %ebp
    xorl    %r8d,  %r8d
    xorl    %r9d,  %r9d
    xorl    %r10d, %r10d
    xorl    %r11d, %r11d
    xorl    %r12d, %r12d
    xorl    %r13d, %r13d
    xorl    %r14d, %r14d
    xorl    %r15d, %r15d

    /* C is immediately before the hardware CPL transition.  eax/edx have
     * already been zeroed for the child, so the receipt preserves its ABI. */
    movw    $0x3f8, %dx
    movb    $'C', %al
    outb    %al, %dx
    iretq
    .size rt_x86_enter_user_first, . - rt_x86_enter_user_first

/* --------------------------------------------------------------------------
 * rt_x86_ring3_resume(int64_t rc)  [rdi = rc]  — longjmp counterpart.
 *
 * Called from rt_syscall_dispatch case 0 when a standalone ring-3 program
 * exits. Restores the kernel context captured at the top of
 * rt_x86_enter_user_first and `ret`s — so rt_x86_enter_user_first appears to
 * return to arch_x86_64_enter_user_task, which returns to
 * x86_64_fs_exec_enter_image_ring3, which returns up to the sshd accept loop.
 * The exit code is stashed in _ring3_exit_rc for the Simple loader to read
 * (rax cannot be trusted through the intervening serial_println calls).
 * Does NOT return to its own caller. -------------------------------------- */
    .globl rt_x86_ring3_resume
    .type rt_x86_ring3_resume, @function
    .align 16
rt_x86_ring3_resume:
    movq    %rdi, _ring3_exit_rc(%rip)          /* stash rc */
    movq    $0, _ring3_resume_valid(%rip)       /* consume the savepoint */
    movq    _ring3_resume_buf+56(%rip), %rax
    movq    %rax, %cr3                           /* restore kernel cr3 FIRST */
    movq    _ring3_resume_buf+0(%rip), %rbx
    movq    _ring3_resume_buf+8(%rip), %rbp
    movq    _ring3_resume_buf+16(%rip), %r12
    movq    _ring3_resume_buf+24(%rip), %r13
    movq    _ring3_resume_buf+32(%rip), %r14
    movq    _ring3_resume_buf+40(%rip), %r15
    movq    _ring3_resume_buf+48(%rip), %rsp    /* back on the accept-loop stack */
    xorl    %eax, %eax
    ret
    .size rt_x86_ring3_resume, . - rt_x86_ring3_resume

/* int64_t rt_x86_ring3_resume_valid(void) — 1 while a savepoint is live. */
    .globl rt_x86_ring3_resume_valid
    .type rt_x86_ring3_resume_valid, @function
    .align 16
rt_x86_ring3_resume_valid:
    movq    _ring3_resume_valid(%rip), %rax
    ret
    .size rt_x86_ring3_resume_valid, . - rt_x86_ring3_resume_valid

/* int64_t rt_x86_ring3_exit_rc(void) — last ring-3 program's exit status. */
    .globl rt_x86_ring3_exit_rc
    .type rt_x86_ring3_exit_rc, @function
    .align 16
rt_x86_ring3_exit_rc:
    movq    _ring3_exit_rc(%rip), %rax
    ret
    .size rt_x86_ring3_exit_rc, . - rt_x86_ring3_exit_rc

    .section .bss
    .align 16
    .globl _ring3_resume_buf
_ring3_resume_buf:
    .skip 64            /* rbx,rbp,r12,r13,r14,r15,rsp,cr3 */
    .globl _ring3_resume_valid
_ring3_resume_valid:
    .skip 8
    .globl _ring3_exit_rc
_ring3_exit_rc:
    .skip 8
    .globl _ring3_iret_rip
_ring3_iret_rip:
    .skip 8
    .globl _ring3_iret_rsp
_ring3_iret_rsp:
    .skip 8
    .globl _ring3_iret_cs
_ring3_iret_cs:
    .skip 8
    .globl _ring3_iret_ss
_ring3_iret_ss:
    .skip 8
    .globl _ring3_iret_rflags
_ring3_iret_rflags:
    .skip 8

    .section .note.GNU-stack,"",@progbits
