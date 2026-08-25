/*
 * hello.c — SimpleOS x86_64 Phase-1 user-exec acceptance payload.
 *
 * Minimal, freestanding, and DECOUPLED from the C++/libc/compiler toolchain
 * (Blocker 2): it makes two raw syscalls and nothing else, so it proves ONLY
 * the Phase-1 kernel exec keystone (live ring-3 handoff into a prepared user
 * task), not any compiler payload.
 *
 * Behavior at ring 3:
 *   write(1, "USEROK\n", 7);   // syscall 32, args in rdi/rsi/rdx
 *   exit(0);                   // syscall 0  -> baremetal dispatcher exits QEMU
 *
 * SYSCALL ABI (see arch/x86_64/boot/syscall_entry.s):
 *   rax = syscall number; rdi,rsi,rdx,r10,r8,r9 = args 0..5.
 * Syscall numbers (see src/os/kernel/ipc/syscall.spl dispatch): 32=Write, 0=Exit.
 *
 * Build (HOST clang-20, the cross clang-20 has broken codegen):
 *   scripts/os/build_user_hello_elf.shs
 * which runs:
 *   clang-20 --target=x86_64-unknown-simpleos --sysroot=build/os/sysroot \
 *     -ffreestanding -nostdlib -static -fno-stack-protector -no-pie \
 *     -Wl,-e,_start -o build/os/user_hello/hello.elf hello.c
 *
 * The emitted USEROK\n reaches serial once Phase 1 wires fd 1 -> serial for the
 * first user task (enter_user_first.s + syscall dispatch already route it).
 */

static long sys_write(long fd, const char *buf, long len) {
    long ret;
    __asm__ volatile("syscall"
                     : "=a"(ret)
                     : "a"(32L), "D"(fd), "S"(buf), "d"(len)
                     : "rcx", "r11", "memory");
    return ret;
}

static __attribute__((noreturn)) void sys_exit(long code) {
    __asm__ volatile("syscall" : : "a"(0L), "D"(code) : "rcx", "r11", "memory");
    __builtin_unreachable();
}

void _start(void) {
    static const char msg[] = "USEROK\n";
    sys_write(1, msg, 7);
    sys_exit(0);
}
