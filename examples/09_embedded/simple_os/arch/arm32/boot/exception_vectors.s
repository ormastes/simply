/* ARMv7 high-integrity SVC vector capsule.
 * Only the synchronous SVC lane is admitted. Other exceptions fail closed in
 * a local wait loop rather than falling through an unowned vector.
 */
    .section .vectors, "ax", %progbits
    .arm
    .balign 32
    .globl rt_arm32_exception_vectors
rt_arm32_exception_vectors:
    b .Larm32_unowned_vector       /* reset */
    b rt_arm32_undefined_vector    /* undefined */
    b rt_arm32_svc_vector          /* SVC */
    b rt_arm32_prefetch_abort_vector
    b rt_arm32_data_abort_vector
    b .Larm32_unowned_vector       /* reserved */
    b .Larm32_unowned_vector       /* IRQ */
    b .Larm32_unowned_vector       /* FIQ */

.Larm32_unowned_vector:
    cpsid if
1:  wfe
    b 1b

    .text
    .align 2
    .globl rt_arm32_svc_vector
    .type rt_arm32_svc_vector, %function
rt_arm32_svc_vector:
    /* Preserve the complete volatile user register set and exception LR.
     * r7 carries the syscall id; r0 carries its first argument. */
    push {r0-r12, lr}
    mov r2, lr
    mov r1, r0
    mov r0, r7
    mrs r3, spsr
    bl rt_arm32_svc_dispatch
    cmp r0, #1
    beq .Larm32_svc_exit
    cmp r0, #0
    beq .Larm32_svc_resume_user
    add sp, sp, #(14 * 4)
    b .Larm32_unowned_vector
.Larm32_svc_resume_user:
    pop {r0-r12, lr}
    movs pc, lr

.Larm32_svc_exit:
    add sp, sp, #(14 * 4)
    b rt_arm32_svc_resume_kernel
    .size rt_arm32_svc_vector, . - rt_arm32_svc_vector

/* Abort/undefined modes do not inherit the SVC stack. Capture their banked
 * exception state first, then switch to the architecture-owned SVC stack.
 * Only an active, TTBR-bound user generation may resume the blocked caller. */
rt_arm32_undefined_vector:
    sub r1, lr, #4
    mrs r2, spsr
    mov r0, #1
    b .Larm32_fault_common
rt_arm32_prefetch_abort_vector:
    sub r1, lr, #4
    mrs r2, spsr
    mov r0, #2
    b .Larm32_fault_common
rt_arm32_data_abort_vector:
    sub r1, lr, #8
    mrs r2, spsr
    mov r0, #3
.Larm32_fault_common:
    cps #0x13
    bl rt_arm32_user_fault_dispatch
    cmp r0, #1
    beq rt_arm32_svc_resume_kernel
    b .Larm32_unowned_vector

    .globl rt_arm32_svc_vector_install
    .type rt_arm32_svc_vector_install, %function
rt_arm32_svc_vector_install:
    ldr r0, =rt_arm32_exception_vectors
    mcr p15, 0, r0, c12, c0, 0     /* VBAR */
    dsb
    isb
    bx lr
    .size rt_arm32_svc_vector_install, . - rt_arm32_svc_vector_install
