int64_t rt_net_init(void)
{
    if (g_rv_vnet.initialized) return 0;
    rv_memzero(&g_rv_vnet, sizeof(g_rv_vnet));
    for (uint32_t slot = 0; slot < VIRTIO_MMIO_SLOTS; slot++) {
        volatile uint32_t *mmio = (volatile uint32_t *)(VIRTIO_MMIO_BASE + ((uintptr_t)slot * VIRTIO_MMIO_STRIDE));
        if (mmio[0x000U / 4U] == VIRTIO_MAGIC && mmio[0x008U / 4U] == VIRTIO_DEV_NET) {
            g_rv_vnet.mmio = mmio;
            break;
        }
    }
    if (!g_rv_vnet.mmio) return -19;
    g_rv_vnet.version = rv_mmio_rd32(0x004U);
    rv_mmio_wr32(0x070U, 0U);
    rv_mmio_wr32(0x070U, VIRTIO_STATUS_ACKNOWLEDGE);
    rv_mmio_wr32(0x070U, VIRTIO_STATUS_ACKNOWLEDGE | VIRTIO_STATUS_DRIVER);
    rv_mmio_wr32(0x014U, 0U);
    (void)rv_mmio_rd32(0x010U);
    rv_mmio_wr32(0x024U, 0U);
    rv_mmio_wr32(0x020U, 0U);
    rv_mmio_wr32(0x070U, VIRTIO_STATUS_ACKNOWLEDGE | VIRTIO_STATUS_DRIVER | VIRTIO_STATUS_FEATURES_OK);
    if ((rv_mmio_rd32(0x070U) & VIRTIO_STATUS_FEATURES_OK) == 0U) return -19;
    for (int i = 0; i < 6; i++) {
        volatile uint8_t *cfg = (volatile uint8_t *)((uintptr_t)g_rv_vnet.mmio + 0x100U);
        g_rv_vnet.mac[i] = cfg[i];
    }
    g_rv_vnet.our_ip[0] = 10U;
    g_rv_vnet.our_ip[1] = 0U;
    g_rv_vnet.our_ip[2] = 2U;
    g_rv_vnet.our_ip[3] = 15U;
    rv_vnet_setup_queue(0U, g_vnet_rx_queue, &g_rv_vnet.rx_qsize, &g_rv_vnet.rx_desc, &g_rv_vnet.rx_avail, &g_rv_vnet.rx_used);
    rv_vnet_setup_queue(1U, g_vnet_tx_queue, &g_rv_vnet.tx_qsize, &g_rv_vnet.tx_desc, &g_rv_vnet.tx_avail, &g_rv_vnet.tx_used);
    rv_mmio_wr32(0x070U, VIRTIO_STATUS_ACKNOWLEDGE | VIRTIO_STATUS_DRIVER | VIRTIO_STATUS_FEATURES_OK | VIRTIO_STATUS_DRIVER_OK);
    g_rv_vnet.tx_next_desc = 0U;
    g_rv_vnet.tx_last_used = 0U;
    rv_vnet_fill_rx();
    g_rv_vnet.initialized = 1;
    return 0;
}

int64_t rt_net_tx_test(void)
{
    return g_rv_vnet.initialized ? 0 : -19;
}

int64_t rt_net_stats(void)
{
    return g_rv_vnet.initialized ? (int64_t)g_rv_vnet.tx_count : -19;
}

int64_t rt_net_socket(int64_t proto)
{
    (void)proto;
    for (int i = 0; i < RV_MAX_SOCKETS; i++) {
        if (!g_rv_sockets[i].in_use) {
            rv_memzero(&g_rv_sockets[i], sizeof(g_rv_sockets[i]));
            g_rv_sockets[i].in_use = 1;
            g_rv_sockets[i].state = RV_TCP_CLOSED;
            g_rv_sockets[i].rcv_wnd = RV_TCP_RXBUF_SIZE;
            return ENCODE_INT(i);
        }
    }
    return ENCODE_INT(-24);
}

int64_t rt_net_bind(int64_t sock_fd, int64_t port_num)
{
    int fd = (int)sock_fd;
    if (fd < 0 || fd >= RV_MAX_SOCKETS || !g_rv_sockets[fd].in_use) return ENCODE_INT(-9);
    g_rv_sockets[fd].local_port = (uint16_t)port_num;
    return ENCODE_INT(0);
}

int64_t rt_net_listen(int64_t sock_fd, int64_t backlog)
{
    int fd = (int)sock_fd;
    if (fd < 0 || fd >= RV_MAX_SOCKETS || !g_rv_sockets[fd].in_use) return ENCODE_INT(-9);
    g_rv_sockets[fd].state = RV_TCP_LISTEN;
    g_rv_sockets[fd].backlog = (int)backlog;
    g_rv_sockets[fd].aq_head = 0;
    g_rv_sockets[fd].aq_tail = 0;
    g_rv_sockets[fd].aq_count = 0;
    return ENCODE_INT(0);
}

int64_t rt_net_accept(int64_t sock_fd)
{
    int fd = (int)sock_fd;
    if (fd < 0 || fd >= RV_MAX_SOCKETS || !g_rv_sockets[fd].in_use || g_rv_sockets[fd].state != RV_TCP_LISTEN) {
        return ENCODE_INT(-9);
    }
    struct rv_tcp_socket *ls = &g_rv_sockets[fd];
    int timeout = 0;
    while (ls->aq_count == 0 && timeout < 50000) {
        rv_vnet_poll();
        timeout++;
        rv_vnet_delay();
    }
    if (ls->aq_count == 0) return ENCODE_INT(-11);
    int accepted_sid = ls->accept_queue[ls->aq_head];
    ls->aq_head = (ls->aq_head + 1) % RV_TCP_ACCEPT_QUEUE;
    ls->aq_count--;
    return ENCODE_INT(accepted_sid);
}

int64_t rt_net_close(int64_t sock_fd)
{
    int fd = (int)sock_fd;
    if (fd < 0 || fd >= RV_MAX_SOCKETS || !g_rv_sockets[fd].in_use) return ENCODE_INT(-9);
    if (g_rv_sockets[fd].state == RV_TCP_ESTABLISHED) {
        rv_tcp_send_segment(fd, RV_TCP_FIN | RV_TCP_ACK, NULL, 0);
    }
    rv_memzero(&g_rv_sockets[fd], sizeof(g_rv_sockets[fd]));
    return ENCODE_INT(0);
}

int64_t rt_net_send_bytes(int64_t sock_fd, RuntimeValue data_rv)
{
    int fd = (int)sock_fd;
    if (fd < 0 || fd >= RV_MAX_SOCKETS || !g_rv_sockets[fd].in_use || g_rv_sockets[fd].state != RV_TCP_ESTABLISHED) {
        return ENCODE_INT(-9);
    }
    if (!IS_HEAP(data_rv)) return ENCODE_INT(-22);
    RuntimeArray *arr = (RuntimeArray *)DECODE_PTR(data_rv);
    if (!arr || arr->hdr.type != HEAP_ARRAY) return ENCODE_INT(-22);
    uint32_t len = (uint32_t)arr->len;
    if (len == 0U) return ENCODE_INT(0);
    unsigned char *buf = (unsigned char *)rv_alloc(len);
    if (!buf) return ENCODE_INT(-12);
    RuntimeValue *items = runtime_array_items(arr);
    for (uint32_t i = 0; i < len; i++) buf[i] = (uint8_t)DECODE_INT(items[i]);
    uint32_t sent = 0;
    while (sent < len) {
        uint16_t chunk = (uint16_t)((len - sent) > 1200U ? 1200U : (len - sent));
        rv_tcp_send_segment(fd, RV_TCP_ACK | RV_TCP_PSH, buf + sent, chunk);
        sent += chunk;
    }
    return ENCODE_INT((int64_t)sent);
}

RuntimeValue rt_net_recv_version_text(int64_t sock_fd)
{
    int fd = (int)sock_fd;
    if (fd < 0 || fd >= RV_MAX_SOCKETS || !g_rv_sockets[fd].in_use) return rt_string_from_cstr("");
    struct rv_tcp_socket *s = &g_rv_sockets[fd];
    int timeout = 0;
    while (rv_tcp_rx_available(fd) == 0U && s->state == RV_TCP_ESTABLISHED && timeout < 50000) {
        rv_vnet_poll();
        timeout++;
        rv_vnet_delay();
    }
    uint32_t avail = rv_tcp_rx_available(fd);
    if (avail == 0U) return rt_string_from_cstr("");
    char line[256];
    uint32_t copied = 0;
    while (copied + 1U < sizeof(line) && s->rx_tail != s->rx_head) {
        uint8_t byte = s->rxbuf[s->rx_tail];
        s->rx_tail = (s->rx_tail + 1U) % RV_TCP_RXBUF_SIZE;
        if (byte == '\n') break;
        if (byte == '\r') continue;
        line[copied++] = (char)byte;
    }
    line[copied] = 0;
    return rt_string_from_cstr(line);
}

__attribute__((naked, section(".text.entry"))) void _start(void)
{
    __asm__ volatile(
        "la sp, _stack_top\n"
        /* Zero .bss BEFORE any C code runs. Real DDR powers up as garbage;
         * un-zeroed .bss => g_heap_off trash => every alloc fails (proven on
         * KV260 silicon for rv32, 2026-07-26). Kernel self-zeroes so it never
         * depends on loader cooperation (board-runnable rule). _sbss/_ebss
         * come from linker_riscv_common.ld; _ebss is ALIGN(8) so the
         * doubleword loop terminates exactly. Handles empty .bss. */
        "la t0, _sbss\n"
        "la t1, _ebss\n"
        "1: bgeu t0, t1, 2f\n"
        "sd zero, 0(t0)\n"
        "addi t0, t0, 8\n"
        "j 1b\n"
        "2:\n"
        "call spl_start\n"
        "3: wfi\n"
        "j 3b\n"
    );
}

#include "rv64_fs_exec_media.inc.c"
#include "rv64_fs_exec_loader.inc.c"
/* ---- Lane BR64: in-guest Simple toolchain staging gate --------------------
 * Probes the REAL riscv64-unknown-simpleos `simple` interpreter ELF staged by
 * scripts/os/fsexec_mkimg_simple.spl at the FAT32 root (/FSEXEC.ELF, aliased
 * /usr/bin/simple) plus its /hello.spl source. Validates ELF magic,
 * ELFCLASS64, EM_RISCV (243) and reports e_entry, proving the on-board
 * OpenSBI -> kernel -> virtio-blk -> FAT32 path can locate and read the
 * cross-built toolchain binary. */
static uint32_t g_simple_tool_size;
static uint32_t g_simple_tool_entry_lo;
static uint32_t g_simple_tool_entry_hi;

static int riscv_probe_root_elf(const char *name11)
{
    Fat32Probe fat;
    if (!fat32_probe_bpb(&fat)) return 0;
    uint32_t file_size = 0;
    uint32_t cluster = fat32_find_entry_cluster(&fat, fat.root_cluster, name11, 0, &file_size);
    if (cluster < 2U || file_size == 0) return 0;
    if (!fat32_read_first_sector(&fat, cluster)) return 0;
    const unsigned char *e = sector_data();
    if (e[0] != 0x7f || e[1] != 'E' || e[2] != 'L' || e[3] != 'F') return 0;
    if (e[4] != 2) return 0;                    /* ELFCLASS64 */
    if (e[18] != 243 || e[19] != 0) return 0;   /* e_machine == EM_RISCV */
    g_simple_tool_size = file_size;
    g_simple_tool_entry_lo = rd32(e + 24);
    g_simple_tool_entry_hi = rd32(e + 28);
    return 1;
}

RuntimeValue rt_riscv_simple_tool_probe(void)
{
    return riscv_probe_root_elf("FSEXEC  ELF") ? 1 : 0;
}

RuntimeValue rt_riscv_simple_tool_size(void)
{
    return (RuntimeValue)g_simple_tool_size;
}

RuntimeValue rt_riscv_simple_tool_entry_hi20(void)
{
    /* entry >> 12 keeps the value in comfortable i64 print range */
    uint64_t entry = ((uint64_t)g_simple_tool_entry_hi << 32) | g_simple_tool_entry_lo;
    return (RuntimeValue)(entry >> 12);
}

RuntimeValue rt_riscv_simple_hello_probe(void)
{
    Fat32Probe fat;
    if (!fat32_probe_bpb(&fat)) return 0;
    uint32_t file_size = 0;
    uint32_t cluster = fat32_find_entry_cluster(&fat, fat.root_cluster, "HELLO   SPL", 0, &file_size);
    if (cluster < 2U || file_size == 0) return 0;
    if (!fat32_read_first_sector(&fat, cluster)) return 0;
    const unsigned char *b = sector_data();
    const char *want = "hello from simple on simpleos";
    uint32_t wl = 0;
    while (want[wl]) wl++;
    for (uint32_t i = 0; i + wl < 512U; i++) {
        uint32_t ok = 1;
        for (uint32_t j = 0; j < wl; j++) {
            if (b[i + j] != (unsigned char)want[j]) { ok = 0; break; }
        }
        if (ok) return 1;
    }
    return 0;
}

/* Interned string-literal ctor: codegen emits rt_string_new_literal for every
 * multi-byte literal (hosted interns by data ptr for perf). The freestanding
 * kernel has no intern table, so forward to rt_string_new — functionally
 * identical (a fresh heap string per call). Matches the riscv32 stub. */
RuntimeValue rt_string_new(RuntimeValue data, RuntimeValue len_val);
RuntimeValue rt_string_new_literal(RuntimeValue data, RuntimeValue len_val)
{
    return rt_string_new(data, len_val);
}

/* Pure-Simple driver ABI adapters. Hardware ownership remains in the shared
 * driver modules; this capsule only exposes freestanding runtime primitives. */
RuntimeValue rt_volatile_read_u16(RuntimeValue addr)
{
    return (RuntimeValue)(uint64_t)*(volatile uint16_t *)(uintptr_t)(uint64_t)addr;
}

RuntimeValue rt_volatile_read_u32(RuntimeValue addr)
{
    return (RuntimeValue)(uint64_t)*(volatile uint32_t *)(uintptr_t)(uint64_t)addr;
}

RuntimeValue rt_volatile_write_u8(RuntimeValue addr, RuntimeValue value)
{
    *(volatile uint8_t *)(uintptr_t)(uint64_t)addr = (uint8_t)(uint64_t)value;
    return NIL_VALUE;
}

RuntimeValue rt_volatile_write_u16(RuntimeValue addr, RuntimeValue value)
{
    *(volatile uint16_t *)(uintptr_t)(uint64_t)addr = (uint16_t)(uint64_t)value;
    return NIL_VALUE;
}

RuntimeValue rt_volatile_write_u32(RuntimeValue addr, RuntimeValue value)
{
    *(volatile uint32_t *)(uintptr_t)(uint64_t)addr = (uint32_t)(uint64_t)value;
    return NIL_VALUE;
}

RuntimeValue rt_memory_barrier(void)
{
    __asm__ volatile("fence iorw, iorw" ::: "memory");
    return NIL_VALUE;
}

void rt_eprintln_str(const uint8_t *ptr, uint64_t len)
{
    for (uint64_t i = 0; i < len; i++) serial_putchar((char)ptr[i]);
    serial_puts("\r\n");
}

RuntimeValue rt_byte_array_new(RuntimeValue capacity)
{
    return rt_array_new(capacity);
}

RuntimeValue rt_typed_bytes_u8_push(RuntimeValue array, RuntimeValue value)
{
    return rt_array_push(array, ENCODE_INT(((uint64_t)value) & 0xFFU)) ? TRUE_VALUE : FALSE_VALUE;
}

RuntimeValue rt_typed_words_u32_push(RuntimeValue array, RuntimeValue value)
{
    return rt_array_push(array, ENCODE_INT(DECODE_INT(value) & 0xFFFFFFFFULL)) ? TRUE_VALUE : FALSE_VALUE;
}

int8_t rt_typed_words_u64_push(RuntimeValue array, int64_t value)
{
    return rt_array_push(array, ENCODE_INT(value)) ? 1 : 0;
}

RuntimeValue rt_raw_u64_to_string(RuntimeValue raw)
{
    uint64_t value = (uint64_t)raw;
    char reversed[21];
    uint32_t count = 0;
    if (value == 0) return rt_string_new((RuntimeValue)(uintptr_t)"0", 1);
    while (value > 0) {
        reversed[count++] = (char)('0' + (value % 10U));
        value /= 10U;
    }
    char text[21];
    for (uint32_t i = 0; i < count; i++) text[i] = reversed[count - i - 1U];
    return rt_string_new((RuntimeValue)(uintptr_t)text, (RuntimeValue)count);
}

int64_t rt_pool_safepoint(void)
{
    return 0;
}
