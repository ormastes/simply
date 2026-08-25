#include <stdint.h>
#include <stddef.h>
#include <unistd.h>

extern int64_t simpleos_syscall(int64_t id, int64_t a0, int64_t a1,
                                int64_t a2, int64_t a3, int64_t a4);

#ifndef APP_TITLE
#define APP_TITLE "SimpleOS App"
#endif

#ifndef APP_ID
#define APP_ID "/sys/apps/app"
#endif

#ifndef APP_CONTENT
#define APP_CONTENT "Filesystem-backed user process"
#endif

#ifndef APP_WIDTH
#define APP_WIDTH 420
#endif

#ifndef APP_HEIGHT
#define APP_HEIGHT 240
#endif

#ifndef APP_POS_X
#define APP_POS_X 96
#endif

#ifndef APP_POS_Y
#define APP_POS_Y 96
#endif

#ifndef APP_MARKER
#define APP_MARKER ""
#endif

#ifndef APP_PRE_WINDOW_HOOK
#define APP_PRE_WINDOW_HOOK() 0
#endif

#ifndef APP_RUNTIME_CONTENT
#define APP_RUNTIME_CONTENT(argc, argv) APP_CONTENT
#endif

/* Input-reaction contract. An app that does not opt in keeps APP_CONTENT and
 * emits no marker, so its behaviour is unchanged by the event loop below. */
#ifndef APP_EVENT_CONTENT
#define APP_EVENT_CONTENT ""
#endif

#ifndef APP_EVENT_MARKER
#define APP_EVENT_MARKER ""
#endif

#ifndef APP_EVENT_MARKER_SUFFIX
#define APP_EVENT_MARKER_SUFFIX ""
#endif

#define SYS_DEBUG_WRITE 60
#define SYS_IPC_SEND 20
#define SYS_IPC_RECV 21
#define SYS_IPC_CREATE_PORT 22
#define SYS_IPC_CONNECT 23

#define COMP_CREATE_WINDOW 1
#define COMP_DESTROY_WINDOW 2
#define COMP_UPDATE_TREE 3
#define COMP_INPUT_EVENT 11
#define COMP_CLOSE_REQUEST 12

/* Versioned WM IPC wire (src/os/services/wm/wm_service.spl parse_message):
 *
 *   +0  src_port     u64
 *   +8  dst_port     u64
 *   +16 method       u32   <- header method (0 when the sender only stamps
 *                             the method into the payload, which the
 *                             compositor and this client both still do)
 *   +20 flags        u32
 *   +24 payload_len  u32
 *   +28 cap_count    u32
 *   +32 payload[payload_len]
 *
 * IPC_WIRE_CAPACITY is one 4 KiB payload page plus that 32-byte header, which
 * is the largest envelope the kernel buffer pool can hand back
 * (src/os/kernel/ipc/message_buffer.spl: BUFFER_PAGE_SIZE 4096, MSG_HDR_SIZE 32).
 */
#define IPC_WIRE_HEADER 32u
#define IPC_WIRE_CAPACITY 4128
#define IPC_WIRE_V1_FLAG 1u

/* WmEventType wire codes. The compositor puts `event.event_type.to_u32()` on
 * the wire (src/os/services/wm/wm_service.spl send_input_to_port), and
 * WmEventType is a bare enum in src/lib/common/window_protocol/geometry.spl,
 * so the code is the 0-based declaration index:
 *   KeyDown 0 | KeyUp 1 | MouseDown 2 | MouseUp 3 | MouseMove 4 | Scroll 5 ...
 *
 * CONTRACT CONFLICT, recorded here on purpose: the staging contract spec
 * test/03_system/check/simpleos_browser_demo_guest_elf_staging_contract_spec.spl
 * asserts the literal `WM_EVENT_MOUSE_DOWN 4`. Under the enum above 4 is
 * MouseMove, not MouseDown -- a client keyed on 4 would react to every pointer
 * move and never to a click, which is precisely the correlation the gate
 * checks. The wire is authoritative, so this stays 2; the spec literal (or an
 * explicit discriminant on WmEventType) needs a decision from its owner.
 */
#define WM_EVENT_MOUSE_DOWN 2

static size_t _strlen_local(const char *s) {
    size_t n = 0;
    while (s[n] != '\0') n++;
    return n;
}

static void _push_u32(uint8_t *buf, size_t *offset, uint32_t value) {
    buf[(*offset)++] = (uint8_t)(value & 0xFFu);
    buf[(*offset)++] = (uint8_t)((value >> 8) & 0xFFu);
    buf[(*offset)++] = (uint8_t)((value >> 16) & 0xFFu);
    buf[(*offset)++] = (uint8_t)((value >> 24) & 0xFFu);
}

static void _push_i32(uint8_t *buf, size_t *offset, int32_t value) {
    _push_u32(buf, offset, (uint32_t)value);
}

static void _push_u64(uint8_t *buf, size_t *offset, uint64_t value) {
    buf[(*offset)++] = (uint8_t)(value & 0xFFu);
    buf[(*offset)++] = (uint8_t)((value >> 8) & 0xFFu);
    buf[(*offset)++] = (uint8_t)((value >> 16) & 0xFFu);
    buf[(*offset)++] = (uint8_t)((value >> 24) & 0xFFu);
    buf[(*offset)++] = (uint8_t)((value >> 32) & 0xFFu);
    buf[(*offset)++] = (uint8_t)((value >> 40) & 0xFFu);
    buf[(*offset)++] = (uint8_t)((value >> 48) & 0xFFu);
    buf[(*offset)++] = (uint8_t)((value >> 56) & 0xFFu);
}

static uint32_t _read_u32(const uint8_t *ptr) {
    return ((uint32_t)ptr[0]) |
           ((uint32_t)ptr[1] << 8) |
           ((uint32_t)ptr[2] << 16) |
           ((uint32_t)ptr[3] << 24);
}

static uint64_t _read_u64(const uint8_t *ptr) {
    return ((uint64_t)ptr[0]) |
           ((uint64_t)ptr[1] << 8) |
           ((uint64_t)ptr[2] << 16) |
           ((uint64_t)ptr[3] << 24) |
           ((uint64_t)ptr[4] << 32) |
           ((uint64_t)ptr[5] << 40) |
           ((uint64_t)ptr[6] << 48) |
           ((uint64_t)ptr[7] << 56);
}

static int _ipc_send(uint64_t dst_port, uint64_t src_port, const uint8_t *data, uint64_t len) {
    return (int)simpleos_syscall(SYS_IPC_SEND, (int64_t)dst_port, (int64_t)src_port,
                                 (int64_t)(uintptr_t)data, (int64_t)len, 0);
}

static void _debug_write(const char *s) {
    for (size_t i = 0; s[i] != '\0'; i++) {
        simpleos_syscall(SYS_DEBUG_WRITE, (int64_t)(uint8_t)s[i], 0, 0, 0, 0);
    }
}

static void _debug_write_u64(uint64_t value) {
    char digits[24];
    size_t n = 0;
    if (value == 0) {
        simpleos_syscall(SYS_DEBUG_WRITE, (int64_t)'0', 0, 0, 0, 0);
        return;
    }
    while (value > 0 && n < sizeof(digits)) {
        digits[n++] = (char)('0' + (int)(value % 10u));
        value /= 10u;
    }
    while (n > 0) {
        n--;
        simpleos_syscall(SYS_DEBUG_WRITE, (int64_t)(uint8_t)digits[n], 0, 0, 0, 0);
    }
}

/* Receive one IPC envelope into a client-owned wire buffer and hand back only
 * its payload.
 *
 * a0/a1/a2 keep the argument meaning the in-tree callers already use
 * (port, timeout_ms, poll flag -- see wm_service.spl poll_once and
 * src/os/kernel/ipc/syscall_ipc.spl _handle_ipc_recv_state). a3/a4 additionally
 * offer the destination buffer and its capacity, which is the documented ring-3
 * ABI in examples/09_embedded/simple_os/arch/x86_64/boot/baremetal_stubs.c
 * (syscall 21: a0=port, a1=reply_buf, a2=max_len) so a kernel that copies
 * straight into user memory needs no second call.
 *
 * A kernel that delivers by copy returns the byte count (<= IPC_WIRE_CAPACITY);
 * a kernel that delivers by reference returns the envelope address, which on
 * this target is always far above IPC_WIRE_CAPACITY. Both are accepted. */
static int _ipc_recv_payload(uint64_t app_port, int blocking, uint8_t *out, size_t out_cap) {
    /* .bss, not stack: the guest entry stack is kernel-provided and this
     * client already spends ~3 KiB of it on the create/update message
     * buffers. The client is single-threaded, so a static envelope is safe. */
    static uint8_t wire[IPC_WIRE_CAPACITY];
    int64_t msg_raw = simpleos_syscall(
        SYS_IPC_RECV,
        (int64_t)app_port,
        blocking ? (int64_t)0xFFFFFFFFu : 0,
        blocking ? 0 : 1,
        (int64_t)(uintptr_t)wire,
        (int64_t)IPC_WIRE_CAPACITY
    );
    if (msg_raw <= 0) {
        return -1;
    }

    if (msg_raw > (int64_t)IPC_WIRE_CAPACITY) {
        const uint8_t *envelope = (const uint8_t *)(uintptr_t)msg_raw;
        for (size_t i = 0; i < (size_t)IPC_WIRE_CAPACITY; i++) {
            wire[i] = envelope[i];
        }
    } else if (msg_raw < (int64_t)IPC_WIRE_HEADER) {
        return -1;
    }

    /* Flags word: reject an envelope that carries only flag bits this client
     * does not understand (e.g. a capability transfer). 0 is the legacy
     * unversioned sender and stays accepted. */
    const uint32_t wire_flags = _read_u32(wire + 20);
    if (wire_flags != 0 && (wire_flags & IPC_WIRE_V1_FLAG) == 0) {
        return -1;
    }
    /* wire + 16 is the header method; senders that only stamp the method into
     * the payload leave it zero, so the payload copy below stays authoritative. */
    (void)_read_u32(wire + 16);

    uint32_t payload_len = _read_u32(wire + 24);
    if (payload_len > (uint32_t)(IPC_WIRE_CAPACITY - (int)IPC_WIRE_HEADER)) {
        payload_len = (uint32_t)(IPC_WIRE_CAPACITY - (int)IPC_WIRE_HEADER);
    }
    if ((size_t)payload_len > out_cap) {
        payload_len = (uint32_t)out_cap;
    }
    for (uint32_t i = 0; i < payload_len; i++) {
        out[i] = wire[32u + i];
    }
    return (int)payload_len;
}

static uint64_t _connect_compositor(uint64_t *app_port_out) {
    static const char kPortName[] = "compositor";
    /* Name the client port after the app id so the compositor can attribute an
     * envelope to this process (syscall 22: a0=name_ptr, a1=name_len). */
    int64_t app_port = simpleos_syscall(SYS_IPC_CREATE_PORT,
                                        (int64_t)(uintptr_t)APP_ID,
                                        (int64_t)(_strlen_local(APP_ID)),
                                        0, 0, 0);
    if (app_port <= 0) {
        return 0;
    }
    int64_t compositor_port = simpleos_syscall(
        SYS_IPC_CONNECT,
        (int64_t)(uintptr_t)kPortName,
        (int64_t)(_strlen_local(kPortName)),
        0, 0, 0
    );
    if (compositor_port <= 0) {
        return 0;
    }
    *app_port_out = (uint64_t)app_port;
    return (uint64_t)compositor_port;
}

static uint64_t _create_window(uint64_t compositor_port, uint64_t app_port) {
    uint8_t msg[1024];
    size_t off = 0;
    const size_t title_len = _strlen_local(APP_TITLE);
    const size_t app_id_len = _strlen_local(APP_ID);

    _push_u32(msg, &off, COMP_CREATE_WINDOW);
    _push_u32(msg, &off, (uint32_t)title_len);
    for (size_t i = 0; i < title_len; i++) {
        msg[off++] = (uint8_t)APP_TITLE[i];
    }
    _push_i32(msg, &off, APP_POS_X);
    _push_i32(msg, &off, APP_POS_Y);
    _push_i32(msg, &off, APP_WIDTH);
    _push_i32(msg, &off, APP_HEIGHT);
    _push_u64(msg, &off, (uint64_t)getpid());
    _push_u32(msg, &off, (uint32_t)app_id_len);
    for (size_t i = 0; i < app_id_len; i++) {
        msg[off++] = (uint8_t)APP_ID[i];
    }

    if (_ipc_send(compositor_port, app_port, msg, (uint64_t)off) < 0) {
        return 0;
    }

    uint8_t reply[64];
    int reply_len = _ipc_recv_payload(app_port, 1, reply, sizeof(reply));
    if (reply_len < 12) {
        return 0;
    }
    if ((int32_t)_read_u32(reply) != 0) {
        return 0;
    }
    return _read_u64(reply + 4);
}

static void _update_content(uint64_t compositor_port, uint64_t app_port, uint64_t window_id,
                            const char *content) {
    uint8_t msg[2048];
    size_t off = 0;
    size_t content_len = _strlen_local(content);
    const size_t content_cap = sizeof(msg) - 16;
    if (content_len > content_cap) {
        content_len = content_cap;
    }

    _push_u32(msg, &off, COMP_UPDATE_TREE);
    _push_u64(msg, &off, window_id);
    _push_u32(msg, &off, (uint32_t)content_len);
    for (size_t i = 0; i < content_len; i++) {
        msg[off++] = (uint8_t)content[i];
    }

    if (_ipc_send(compositor_port, app_port, msg, (uint64_t)off) >= 0) {
        uint8_t reply[32];
        (void)_ipc_recv_payload(app_port, 1, reply, sizeof(reply));
    }
}

static void _destroy_window(uint64_t compositor_port, uint64_t app_port, uint64_t window_id) {
    uint8_t msg[16];
    size_t off = 0;
    _push_u32(msg, &off, COMP_DESTROY_WINDOW);
    _push_u64(msg, &off, window_id);
    if (_ipc_send(compositor_port, app_port, msg, (uint64_t)off) >= 0) {
        uint8_t reply[32];
        (void)_ipc_recv_payload(app_port, 1, reply, sizeof(reply));
    }
}

/* Serial receipt the fullscreen evidence gate correlates against
 * (scripts/check/check-simpleos-wm-fullscreen-evidence.shs
 * wait_browser_content_presented). Emitted only by apps that opted into the
 * input contract; APP_EVENT_MARKER is empty for every other client. */
static void _write_event_marker(uint64_t window_id) {
    if (APP_EVENT_MARKER[0] == '\0') {
        return;
    }
    _debug_write(APP_EVENT_MARKER);
    _debug_write_u64(window_id);
    _debug_write(APP_EVENT_MARKER_SUFFIX);
}

/* Event loop: serve compositor events until the window is closed.
 *
 * COMP_INPUT_EVENT payload (wm_service.spl send_input_to_port):
 *   method(u32) | window_id(u64) | event_type(u32) | key_code(u32) |
 *   mouse_x(i32) | mouse_y(i32) | modifiers(u32) | text_len(u32) | text
 * `msg` below points past the leading method word, so the record it sees is
 *   window_id(u64) @0 | event_type(u32) @8 | key_code @12 | x @16 | y @20 ...
 * COMP_CLOSE_REQUEST payload: method(u32) | window_id(u64).
 */
static int _serve_events(uint64_t compositor_port, uint64_t app_port, uint64_t window_id) {
    uint8_t payload[64];
    for (;;) {
        int len = _ipc_recv_payload(app_port, 1, payload, sizeof(payload));
        if (len < 12) {
            continue;
        }
        uint32_t method = _read_u32(payload);
        const uint8_t *msg = payload + 4;

        if (method == COMP_INPUT_EVENT && len >= 28) {
            if (_read_u64(msg) == window_id &&
                _read_u32(msg + 8) == WM_EVENT_MOUSE_DOWN) {
                /* Marker first, then the mutation: the gate requires the
                 * content-presented receipt to appear AFTER the event marker. */
                _write_event_marker(window_id);
                if (APP_EVENT_CONTENT[0] != '\0') {
                    _update_content(compositor_port, app_port, window_id, APP_EVENT_CONTENT);
                }
            }
            continue;
        }

        if (method == COMP_CLOSE_REQUEST && _read_u64(msg) == window_id) {
            return 0;
        }
    }
}

int main(int argc, char **argv) {
    (void)argc;
    (void)argv;

    static volatile const char *marker = APP_MARKER;
    if (marker[0] == '\xff') {
        return 99;
    }
    {
        int pre_status = APP_PRE_WINDOW_HOOK();
        if (pre_status != 0) {
            return pre_status;
        }
    }

    const char *content = APP_RUNTIME_CONTENT(argc, argv);
    if (content == (const char *)0) {
        content = APP_CONTENT;
    }

    uint64_t app_port = 0;
    uint64_t compositor_port = _connect_compositor(&app_port);
    if (compositor_port == 0 || app_port == 0) {
        return 2;
    }

    uint64_t window_id = _create_window(compositor_port, app_port);
    if (window_id == 0) {
        return 3;
    }

    _update_content(compositor_port, app_port, window_id, content);
    _serve_events(compositor_port, app_port, window_id);
    _destroy_window(compositor_port, app_port, window_id);
    return 0;
}
