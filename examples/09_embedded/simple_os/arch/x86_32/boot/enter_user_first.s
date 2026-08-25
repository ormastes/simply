/* i386 CPL3 handoff and returning exit continuation.  cdecl arguments:
 * eip, esp, cs, ss, eflags, cr3.  The kernel savepoint is consumed exactly
 * once by rt_x86_32_ring3_resume after the authenticated exit syscall. */
.section .text
.code32
.globl rt_x86_32_enter_user_first
.type rt_x86_32_enter_user_first, @function
rt_x86_32_enter_user_first:
    movl %ebx, x86_32_resume_buf+0
    movl %esi, x86_32_resume_buf+4
    movl %edi, x86_32_resume_buf+8
    movl %ebp, x86_32_resume_buf+12
    movl %esp, x86_32_resume_buf+16
    movl %cr3, %eax
    movl %eax, x86_32_resume_buf+20
    movl $1, x86_32_resume_valid

    movl 4(%esp), %eax
    movl %eax, x86_32_iret_eip
    movl 8(%esp), %eax
    movl %eax, x86_32_iret_esp
    movl 12(%esp), %eax
    movl %eax, x86_32_iret_cs
    movl 16(%esp), %eax
    movl %eax, x86_32_iret_ss
    movl 20(%esp), %eax
    movl %eax, x86_32_iret_eflags

    movl 24(%esp), %eax              /* requested CR3; zero keeps current AS */
    testl %eax, %eax
    jz 1f
    movl %eax, %cr3
1:
    pushl x86_32_iret_ss
    pushl x86_32_iret_esp
    pushl x86_32_iret_eflags
    pushl x86_32_iret_cs
    pushl x86_32_iret_eip

    /* IRET changes CS/SS but deliberately leaves DS/ES/FS/GS untouched.
     * Keeping the ring-0 data selector (0x10) makes the child's first prefix
     * load fault at CPL3; with no #GP owner installed that escalates to a
     * triple fault and QEMU resets. Install the DPL3 data selector while CPL0
     * still has authority, after all kernel-memory frame reads are complete. */
    movw $0x23, %ax
    movw %ax, %ds
    movw %ax, %es
    movw %ax, %fs
    movw %ax, %gs
    xorl %eax, %eax
    xorl %ebx, %ebx
    xorl %ecx, %ecx
    xorl %edx, %edx
    xorl %esi, %esi
    xorl %edi, %edi
    xorl %ebp, %ebp
    iret
.size rt_x86_32_enter_user_first, .-rt_x86_32_enter_user_first

.globl rt_x86_32_ring3_resume
.type rt_x86_32_ring3_resume, @function
rt_x86_32_ring3_resume:
    movl 4(%esp), %eax
    movl %eax, x86_32_exit_rc
    movl $0, x86_32_resume_valid
    movl x86_32_resume_buf+20, %eax
    movl %eax, %cr3
    movl x86_32_resume_buf+0, %ebx
    movl x86_32_resume_buf+4, %esi
    movl x86_32_resume_buf+8, %edi
    movl x86_32_resume_buf+12, %ebp
    movl x86_32_resume_buf+16, %esp
    xorl %eax, %eax
    ret
.size rt_x86_32_ring3_resume, .-rt_x86_32_ring3_resume

.globl rt_x86_32_ring3_resume_valid
.type rt_x86_32_ring3_resume_valid, @function
rt_x86_32_ring3_resume_valid:
    movl x86_32_resume_valid, %eax
    ret
.size rt_x86_32_ring3_resume_valid, .-rt_x86_32_ring3_resume_valid

.globl rt_x86_32_ring3_exit_rc
.type rt_x86_32_ring3_exit_rc, @function
rt_x86_32_ring3_exit_rc:
    movl x86_32_exit_rc, %eax
    ret
.size rt_x86_32_ring3_exit_rc, .-rt_x86_32_ring3_exit_rc

.section .bss
.align 16
x86_32_resume_buf: .skip 24
x86_32_resume_valid: .skip 4
x86_32_exit_rc: .skip 4
x86_32_iret_eip: .skip 4
x86_32_iret_esp: .skip 4
x86_32_iret_cs: .skip 4
x86_32_iret_ss: .skip 4
x86_32_iret_eflags: .skip 4

.section .note.GNU-stack,"",@progbits
