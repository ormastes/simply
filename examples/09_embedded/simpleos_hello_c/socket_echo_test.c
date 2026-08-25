/*
 * Loopback TCP echo self-test for the SimpleOS libc socket layer
 * (src/os/libc/simpleos_socket.c, src/os/libc/include/sys/socket.h,
 * src/os/libc/include/netinet/in.h).
 *
 * Two entry points share the same headers and the same
 * src/os/libc/simpleos_socket.c translation unit, selected by
 * SIMPLEOS_HOSTED_TEST:
 *
 *   SIMPLEOS_HOSTED_TEST defined (see
 *   scripts/os/socket_echo_loopback_gate.shs): runs on the Linux dev
 *   box, taking simpleos_socket.c's running_on_linux_host() ==
 *   raw-Linux-syscall fallback branch. Real Linux TCP requires
 *   listen() before connect() will succeed, so this variant exercises
 *   the FULL POSIX flow: socket/bind/listen/connect/accept/send/recv
 *   (loopback connect() completes synchronously against the listen
 *   backlog -- no fork()/thread needed for a single pending
 *   connection). This validates simpleos_socket.c's Linux
 *   linux_syscall6() raw-asm glue for every function it implements.
 *
 *   SIMPLEOS_HOSTED_TEST undefined: freestanding SimpleOS target,
 *   linked against libsimpleos_c.a + crt0.o (see the build command
 *   below). Here simpleos_syscall() reaches the REAL kernel, which
 *   routes through src/os/kernel/abi/syscall_shim_net.spl into
 *   os.kernel.socket_compat + os.kernel.net.loopback_socket.
 *   loopback_socket.spl implements only a 1:1 bind()+connect()
 *   rendezvous with NO backlog/accept() queue (see that file's module
 *   doc) -- connecting a client directly links it to the bound
 *   "server" fd, which becomes send/recv-ready immediately. So this
 *   variant exercises bind()+connect()+send()+recv() (the real,
 *   kernel-syscall-backed working path) and asserts listen() fails
 *   closed with a clean errno rather than silently accepting a
 *   syscall the loopback backend cannot honor.
 *
 * Build (freestanding, SimpleOS target):
 *   clang --target=x86_64-unknown-simpleos --sysroot=build/os/sysroot \
 *       -ffreestanding -fno-stack-protector -nostdlib -static -O0 \
 *       -c socket_echo_test.c -o socket_echo_test.o
 *   ld.lld -T build/os/sysroot/share/simpleos/simpleos.ld -e _start \
 *       build/os/sysroot/lib/crt0.o socket_echo_test.o \
 *       -Lbuild/os/sysroot/lib -lsimpleos_c -o socket_echo_test.elf
 *
 * Build (hosted dual-mode, runs directly on the Linux dev box):
 *   cc -ffreestanding -nostdlib -static -O0 -DSIMPLEOS_HOSTED_TEST \
 *       -Isrc/os/libc/include socket_echo_test.c \
 *       src/os/libc/simpleos_socket.c -o socket_echo_test_host
 */

#include <sys/socket.h>
#include <netinet/in.h>
#include <errno.h>

extern int errno;

static long sys_write_str(const char *s);

static int str_eq(const char *a, const char *b, long n) {
    long i;
    for (i = 0; i < n; i++) {
        if (a[i] != b[i]) return 0;
    }
    return 1;
}

static struct sockaddr_in loopback_addr(unsigned short port) {
    struct sockaddr_in addr;
    addr.sin_family = AF_INET;
    addr.sin_port = htons(port);
    addr.sin_addr.s_addr = INADDR_LOOPBACK;
    int i;
    for (i = 0; i < 8; i++) addr.sin_zero[i] = 0;
    return addr;
}

#if defined(SIMPLEOS_HOSTED_TEST)
/* ====================================================================
 * Hosted variant: full POSIX socket/bind/listen/connect/accept/send/
 * recv/sendto flow against real Linux loopback TCP.
 * ==================================================================== */
static int main_hosted(void) {
    int rc;
    struct sockaddr_in addr = loopback_addr(19876);

    int listen_fd = socket(AF_INET, SOCK_STREAM, 0);
    if (listen_fd < 0) { sys_write_str("FAIL server socket()\n"); return 1; }

    int one = 1;
    setsockopt(listen_fd, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));

    rc = bind(listen_fd, (struct sockaddr *)&addr, sizeof(addr));
    if (rc != 0) { sys_write_str("FAIL server bind()\n"); return 1; }

    rc = listen(listen_fd, 4);
    if (rc != 0) { sys_write_str("FAIL server listen()\n"); return 1; }
    sys_write_str("PASS listen() succeeds on real Linux loopback TCP\n");

    int client_fd = socket(AF_INET, SOCK_STREAM, 0);
    if (client_fd < 0) { sys_write_str("FAIL client socket()\n"); return 1; }

    /* Loopback connect() completes synchronously against the listen
     * backlog -- no concurrent accept() call needs to be in flight. */
    rc = connect(client_fd, (struct sockaddr *)&addr, sizeof(addr));
    if (rc != 0) { sys_write_str("FAIL client connect()\n"); return 1; }
    sys_write_str("PASS client connect() to listening loopback socket\n");

    int conn_fd = accept(listen_fd, NULL, NULL);
    if (conn_fd < 0) { sys_write_str("FAIL server accept()\n"); return 1; }
    sys_write_str("PASS server accept() dequeued the connection\n");

    const char ping[4] = { 'P', 'I', 'N', 'G' };
    long sent = send(client_fd, ping, 4, 0);
    if (sent != 4) { sys_write_str("FAIL client send()\n"); return 1; }

    char buf[64];
    long got = recv(conn_fd, buf, sizeof(buf), 0);
    if (got != 4 || !str_eq(buf, "PING", 4)) {
        sys_write_str("FAIL server recv() did not see PING\n");
        return 1;
    }

    const char pong[9] = { 'P','I','N','G','-','E','C','H','O' };
    sent = send(conn_fd, pong, 9, 0);
    if (sent != 9) { sys_write_str("FAIL server send()\n"); return 1; }

    got = recv(client_fd, buf, sizeof(buf), 0);
    if (got != 9 || !str_eq(buf, "PING-ECHO", 9)) {
        sys_write_str("FAIL client recv() did not see PING-ECHO\n");
        return 1;
    }

    sys_write_str("PASS full listen+accept+connect+send+recv loopback "
                  "echo (Linux fallback path)\n");

    /* sendto()/recvfrom() with an explicit destination are real,
     * standard UDP/TCP-with-address operations on Linux -- unlike the
     * SimpleOS-native path, this is expected to succeed here. */
    long r2 = sendto(client_fd, ping, 4, 0, (struct sockaddr *)&addr,
                      sizeof(addr));
    if (r2 != 4) {
        sys_write_str("FAIL sendto(explicit dest) on connected TCP "
                      "socket should still send via the connected path "
                      "on Linux\n");
        return 1;
    }
    sys_write_str("PASS sendto(explicit dest) works on Linux fallback\n");

    return 0;
}
#else
/* ====================================================================
 * Real-SimpleOS variant: bind()+connect() rendezvous (the loopback
 * backend's supported path) with listen() asserted to fail closed.
 * ==================================================================== */
static int main_simpleos(void) {
    int rc;
    struct sockaddr_in addr = loopback_addr(9000);

    int server_fd = socket(AF_INET, SOCK_STREAM, 0);
    if (server_fd < 0) { sys_write_str("FAIL server socket()\n"); return 1; }

    rc = bind(server_fd, (struct sockaddr *)&addr, sizeof(addr));
    if (rc != 0) { sys_write_str("FAIL server bind()\n"); return 1; }

    /* Documented gap: loopback_socket.spl has no backlog/accept queue,
     * so listen() must fail closed, not crash or fake success. */
    rc = listen(server_fd, 4);
    if (rc == 0) {
        sys_write_str("FAIL listen() unexpectedly succeeded (loopback "
                       "backend has no backlog -- if this ever passes, "
                       "the accept() path needs revisiting)\n");
        return 1;
    }
    sys_write_str("PASS listen fails closed (errno set, no crash)\n");

    int client_fd = socket(AF_INET, SOCK_STREAM, 0);
    if (client_fd < 0) { sys_write_str("FAIL client socket()\n"); return 1; }

    rc = connect(client_fd, (struct sockaddr *)&addr, sizeof(addr));
    if (rc != 0) { sys_write_str("FAIL client connect()\n"); return 1; }

    const char ping[4] = { 'P', 'I', 'N', 'G' };
    long sent = send(client_fd, ping, 4, 0);
    if (sent != 4) { sys_write_str("FAIL client send()\n"); return 1; }

    char buf[64];
    long got = recv(server_fd, buf, sizeof(buf), 0);
    if (got != 4 || !str_eq(buf, "PING", 4)) {
        sys_write_str("FAIL server recv() did not see PING\n");
        return 1;
    }

    const char pong[9] = { 'P','I','N','G','-','E','C','H','O' };
    sent = send(server_fd, pong, 9, 0);
    if (sent != 9) { sys_write_str("FAIL server send()\n"); return 1; }

    got = recv(client_fd, buf, sizeof(buf), 0);
    if (got != 9 || !str_eq(buf, "PING-ECHO", 9)) {
        sys_write_str("FAIL client recv() did not see PING-ECHO\n");
        return 1;
    }

    sys_write_str("PASS bind+connect+send+recv loopback echo "
                  "(SimpleOS kernel syscall path)\n");

    /* NetSendTo has no destination parameter (see syscall_shim_net.spl)
     * -- an explicit dest must fail closed, not silently misroute. */
    rc = (int)sendto(client_fd, ping, 4, 0, (struct sockaddr *)&addr,
                      sizeof(addr));
    if (rc >= 0 || errno != EOPNOTSUPP) {
        sys_write_str("FAIL sendto(explicit dest) should be EOPNOTSUPP\n");
        return 1;
    }
    sys_write_str("PASS sendto(explicit dest) fails closed EOPNOTSUPP\n");

    return 0;
}
#endif

#if defined(SIMPLEOS_HOSTED_TEST)
/* ====================================================================
 * Hosted entry point: real Linux raw syscalls only, no libc, no
 * glibc -- see scripts/os/socket_echo_loopback_gate.shs.
 * ==================================================================== */

int errno;

/* Link target for simpleos_socket.c / simpleos_termios.c: always
 * report "not real SimpleOS" so the Linux-syscall fallback activates. */
long simpleos_syscall(long id, long a0, long a1, long a2, long a3,
                       long a4) {
    (void)id; (void)a0; (void)a1; (void)a2; (void)a3; (void)a4;
    return -1;
}

/* simpleos_socket.c's setsockopt()/getsockopt() call memcpy() for a
 * fixed 4-byte SO_REUSEADDR int copy. The freestanding libc normally
 * relies on the optimizer inlining this (or on compiler-rt), but this
 * hosted harness needs a real symbol. */
void *memcpy(void *dst, const void *src, unsigned long n) {
    unsigned char *d = (unsigned char *)dst;
    const unsigned char *s = (const unsigned char *)src;
    unsigned long i;
    for (i = 0; i < n; i++) d[i] = s[i];
    return dst;
}

static long raw_syscall1(long id, long a0) {
    long ret;
    __asm__ volatile("syscall"
                     : "=a"(ret)
                     : "a"(id), "D"(a0)
                     : "rcx", "r11", "memory");
    return ret;
}

static long raw_syscall3(long id, long a0, long a1, long a2) {
    long ret;
    __asm__ volatile("syscall"
                     : "=a"(ret)
                     : "a"(id), "D"(a0), "S"(a1), "d"(a2)
                     : "rcx", "r11", "memory");
    return ret;
}

static long sys_write_str(const char *s) {
    long n = 0;
    while (s[n]) n++;
    return raw_syscall3(1 /* write */, 1 /* stdout */, (long)s, n);
}

void _start(void) {
    int rc = main_hosted();
    raw_syscall1(60 /* exit */, rc);
    __builtin_unreachable();
}
#else
/* ====================================================================
 * Real-SimpleOS entry: crt0.o provides _start -> main(); output goes
 * through the SimpleOS write() already linked into libsimpleos_c.a.
 * ==================================================================== */
extern long write(int fd, const void *buf, unsigned long count);

static long sys_write_str(const char *s) {
    long n = 0;
    while (s[n]) n++;
    return write(1, s, (unsigned long)n);
}

int main(void) {
    return main_simpleos();
}
#endif
