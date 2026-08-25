/* Exit an x86_64 UEFI boot-service context and enter the admitted SimpleOS
 * ELF at its Multiboot2 32-bit entry contract. The C caller has already
 * loaded all PT_LOAD segments, built the Multiboot2 information structure,
 * disabled interrupts through this routine, and exited boot services. */

.section .text
.code64
.global up2_dci_enter32
.type up2_dci_enter32, @function
up2_dci_enter32:
    cli
    /* SysV AMD64 internal ABI: EDI=entry, ESI=Multiboot2 info pointer. */
    subq $16, %rsp
    movw $(up2_dci_gdt_end - up2_dci_gdt - 1), (%rsp)
    leaq up2_dci_gdt(%rip), %rax
    movq %rax, 2(%rsp)
    lgdt (%rsp)
    addq $16, %rsp
    pushq $0x18
    leaq up2_dci_compat32(%rip), %rax
    pushq %rax
    lretq

.code32
up2_dci_compat32:
    /* Long mode cannot be disabled while paging remains enabled. */
    movl %cr0, %eax
    andl $0x7fffffff, %eax
    movl %eax, %cr0

    movl $0xc0000080, %ecx
    rdmsr
    andl $0xfffffeff, %eax
    wrmsr

    movl %cr4, %eax
    andl $0xffffffdf, %eax
    movl %eax, %cr4

    movw $0x10, %ax
    movw %ax, %ds
    movw %ax, %es
    movw %ax, %fs
    movw %ax, %gs
    movw %ax, %ss

    movl %esi, %ebx
    movl $0x36d76289, %eax
    jmp *%edi
.size up2_dci_enter32, . - up2_dci_enter32

.align 8
up2_dci_gdt:
    .quad 0x0000000000000000
    .quad 0x00af9a000000ffff
    .quad 0x00cf92000000ffff
    .quad 0x00cf9a000000ffff
up2_dci_gdt_end:

.section .note.GNU-stack,"",@progbits
