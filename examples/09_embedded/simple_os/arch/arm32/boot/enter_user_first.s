/* ARMv7 first-user entry and blocking kernel continuation.
 *
 * r0 = user entry, r1 = user stack.  The caller has already installed the
 * one-shot execution token and page tables.  SVC mode owns the saved kernel
 * frame; USR mode receives a distinct banked stack.  An authenticated exit
 * SVC resumes at .Larm32_kernel_resume and returns the raw exit status.
 */
    .section .text, "ax", %progbits
    .arm
    .align 2
    .globl rt_arm32_enter_user_first
    .type rt_arm32_enter_user_first, %function
rt_arm32_enter_user_first:
    push {r4-r11, lr}
    ldr r2, =rt_arm32_user_entry_pc
    str r0, [r2]
    ldr r2, =rt_arm32_saved_kernel_sp
    str sp, [r2]

    /* Install the banked USR/SYS stack without surrendering SVC ownership of
     * the blocking kernel frame. */
    mrs r2, cpsr
    bic r3, r2, #0x1f
    orr r3, r3, #0x1f              /* System mode, user register bank */
    msr cpsr_c, r3
    mov sp, r1
    mov lr, #0                     /* scrub banked lr_usr */
    msr cpsr_c, r2                 /* back to SVC */

    /* Return-from-exception semantics establish unprivileged ARM state.
     * IRQ/FIQ remain masked for this bounded one-shot lifecycle. */
    bic r3, r2, #0x1f
    orr r3, r3, #0x10              /* USR mode */
    orr r3, r3, #0xc0              /* mask IRQ/FIQ */
    bic r3, r3, #0x20              /* ARM, not Thumb */
    msr spsr_cxsf, r3
    /* First entry has no argument ABI. Do not leak privileged temporaries or
     * caller registers into EL0; only the separately installed user SP and
     * the validated entry PC cross the boundary. */
    mov r0, #0
    mov r1, #0
    mov r2, #0
    mov r3, #0
    mov r4, #0
    mov r5, #0
    mov r6, #0
    mov r7, #0
    mov r8, #0
    mov r9, #0
    mov r10, #0
    mov r11, #0
    mov r12, #0
    ldr lr, =rt_arm32_user_entry_pc
    ldr lr, [lr]
    movs pc, lr

    .globl rt_arm32_svc_resume_kernel
    .type rt_arm32_svc_resume_kernel, %function
rt_arm32_svc_resume_kernel:
    ldr r1, =rt_arm32_saved_kernel_sp
    ldr sp, [r1]
    ldr r1, =rt_arm32_completed_exit_status
    ldr r0, [r1]
    pop {r4-r11, pc}

    /* Restore a complete ARM32 user context. The C owner validates USR mode,
     * alignment, and nonzero PC/SP before reaching this noreturn capsule. */
    .globl rt_arm32_context_restore_asm
    .type rt_arm32_context_restore_asm, %function
rt_arm32_context_restore_asm:
    ldr r1, =rt_arm32_restore_context_ptr
    str r0, [r1]
    ldr r1, [r0, #60]              /* PC */
    ldr r2, [r0, #64]              /* CPSR */
    push {r1, r2}                  /* RFE frame: PC then CPSR */
    ldr r1, =rt_arm32_restore_frame_sp
    str sp, [r1]
    mov r3, r0
    mrs r2, cpsr
    bic r1, r2, #0x1f
    orr r1, r1, #0x1f             /* SYS: access user SP/LR bank */
    msr cpsr_c, r1
    ldr sp, [r3, #52]
    ldr lr, [r3, #56]
    msr cpsr_c, r2
    ldmia r3, {r0-r11}
    ldr r12, =rt_arm32_restore_context_ptr
    ldr r12, [r12]
    ldr r12, [r12, #48]
    ldr sp, =rt_arm32_restore_frame_sp
    ldr sp, [sp]
    rfeia sp!
    .size rt_arm32_context_restore_asm, . - rt_arm32_context_restore_asm

    /* Behavioral round-trip entry: retain the same blocking kernel frame as
     * first-user entry, then restore the supplied full context. The restored
     * EL0 probe exits through the ordinary authenticated SVC path. */
    .globl rt_arm32_context_roundtrip_enter
    .type rt_arm32_context_roundtrip_enter, %function
rt_arm32_context_roundtrip_enter:
    push {r4-r11, lr}
    ldr r1, =rt_arm32_saved_kernel_sp
    str sp, [r1]
    b rt_arm32_context_restore_asm
    .size rt_arm32_context_roundtrip_enter, . - rt_arm32_context_roundtrip_enter

    .size rt_arm32_enter_user_first, . - rt_arm32_enter_user_first
