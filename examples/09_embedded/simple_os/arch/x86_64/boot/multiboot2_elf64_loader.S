/* ELF32 Multiboot2 shim for an ELF64 SimpleOS module.
 * GRUB enters this file in 32-bit protected mode. The C validator loads the
 * bounded ELF64 PT_LOAD segments, then we jump to the kernel's 32-bit entry;
 * the existing kernel crt0 owns the reviewed 32->64 transition. */

.section .multiboot2, "a"
.align 8
.set MB2_MAGIC, 0xE85250D6
.set MB2_ARCH, 0
.global _multiboot2_loader_header
_multiboot2_loader_header:
    .long MB2_MAGIC
    .long MB2_ARCH
    .long _multiboot2_loader_header_end - _multiboot2_loader_header
    .long -(MB2_MAGIC + MB2_ARCH + (_multiboot2_loader_header_end - _multiboot2_loader_header))
    .short 0
    .short 0
    .long 8
_multiboot2_loader_header_end:

.section .text.entry, "ax"
.code32
.global _start
.type _start, @function
.extern up2_elf64_module_load
_start:
    cli
    movl %ebx, %esi
    movl $loader_stack_top, %esp
    andl $-16, %esp
    pushl %ebx
    call up2_elf64_module_load
    addl $4, %esp
    testl %eax, %eax
    jz loader_halt
    movl %eax, %edx
    movl %esi, %ebx
    movl $0x36D76289, %eax
    jmp *%edx

loader_halt:
    cli
1:
    hlt
    jmp 1b
.size _start, . - _start

.section .bss, "aw", @nobits
.align 16
loader_stack_bottom:
    .skip 16384
loader_stack_top:
