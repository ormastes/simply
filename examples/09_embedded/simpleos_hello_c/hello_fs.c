/*
 * Freestanding clang "hello world" for the SimpleOS x86_64 ring-3 FS-exec loader.
 *
 * This is a REAL clang-compiled C program (no libc, no crt0) that the general
 * filesystem-exec loader runs from a FAT32 disk in ring-3:
 *   clang builds it -> placed on the filesystem as /FSEXEC.ELF -> the loader maps
 *   its PT_LOADs at the native link address (0x10000000, PML4[0]), builds a SysV
 *   stack frame, and iretq's to CPL3. The program prints via syscall 60 (putchar)
 *   and exits via syscall 0 (exit) -> "[user] exit rc=42" on the serial console.
 *
 * SimpleOS custom syscall ABI (NOT Linux): rax = number, rdi = arg0.
 *   60 = putchar(byte)   0 = exit(status)
 *
 * Build + run: scripts/os/build_clang_hello_ring3.shs
 */

static void sys_putc(char c) {
    long r;
    __asm__ volatile("syscall"
                     : "=a"(r)
                     : "a"(60L), "D"((long)(unsigned char)c)
                     : "rcx", "r11", "memory");
}

__attribute__((noreturn)) static void sys_exit(long code) {
    __asm__ volatile("syscall" : : "a"(0L), "D"(code) : "rcx", "r11", "memory");
    __builtin_unreachable();
}

int main(void) {
    const char *m = "hello-from-simpleos-clang\n";
    for (const char *p = m; *p; ++p) sys_putc(*p);
    return 42;
}

void _start(void) {
    sys_exit(main());
}
