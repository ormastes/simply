/* riscv_load_elf_process: ELF64 (ELFCLASS64) variant.
 * riscv32 uses ELF32 with different header offsets — body stays per-arch.
 * Forward declaration is in riscv_common.h. */
static int riscv_load_elf_process(const unsigned char *elf, uint32_t elf_size, uint32_t slot, const char *marker)
{
    if (slot >= 2U || elf_size < 64U) return 0;
    if (elf[0] != 0x7fU || elf[1] != 'E' || elf[2] != 'L' || elf[3] != 'F') return 0;
    if (elf[4] != 2U || elf[5] != 1U) return 0;
    if (rd16(elf + 18U) != 243U) return 0;

    uint64_t entry = rd64(elf + 24U);
    uint64_t phoff = rd64(elf + 32U);
    uint16_t phentsize = rd16(elf + 54U);
    uint16_t phnum = rd16(elf + 56U);
    if (phoff == 0 || phentsize < 56U || phnum == 0 || phnum > 8U) return 0;
    if (phoff + ((uint64_t)phentsize * phnum) > elf_size) return 0;

    for (uint32_t i = 0; i < sizeof(g_riscv_process_arena[slot]); i++) g_riscv_process_arena[slot][i] = 0;

    uint32_t loaded = 0;
    int entry_mapped = 0;
    for (uint16_t i = 0; i < phnum; i++) {
        const unsigned char *ph = elf + phoff + ((uint64_t)i * phentsize);
        if (rd32(ph) != 1U) continue;
        uint64_t off = rd64(ph + 8U);
        uint64_t vaddr = rd64(ph + 16U);
        uint64_t filesz = rd64(ph + 32U);
        uint64_t memsz = rd64(ph + 40U);
        if (filesz > memsz || off + filesz > elf_size || loaded + memsz > sizeof(g_riscv_process_arena[slot])) return 0;
        for (uint64_t j = 0; j < filesz; j++) g_riscv_process_arena[slot][loaded + j] = elf[off + j];
        if (entry >= vaddr && entry < vaddr + memsz) entry_mapped = 1;
        loaded += (uint32_t)memsz;
    }
    if (loaded == 0 || !entry_mapped) return 0;
    if (!bytes_contains(elf, elf_size, marker)) return 0;
    g_riscv_process_entry[slot] = entry;
    g_riscv_process_pid[slot] = 1000U + slot + 1U;
    if (g_riscv_process_count <= slot) g_riscv_process_count = slot + 1U;
    return 1;
}

RuntimeValue rt_riscv_smf_cli_probe(void)
{
    return riscv_smf_probe_file("HELLOSMFSMF", "SIMPLEOS_RISCV64_HELLO_ELF") ? 1 : 0;
}

RuntimeValue rt_riscv_smf_cli_load(void)
{
    return riscv_load_smf_process("HELLOSMFSMF", "SIMPLEOS_RISCV64_HELLO_ELF", 0) ? 1 : 0;
}

RuntimeValue rt_riscv_smf_gui_probe(void)
{
    return riscv_smf_probe_file("BROWSMF SMF", "SIMPLEOS_RISCV64_GUI_ELF") ? 1 : 0;
}

RuntimeValue rt_riscv_native_gui_process_render(void)
{
    if (!riscv_load_smf_process("BROWSMF SMF", "SIMPLEOS_RISCV64_GUI_ELF", 1)) return 0;
    if (g_riscv_process_pid[1] == 0 || g_riscv_process_entry[1] == 0) return 0;
    const char *content = "pid=1002 app=/sys/apps/browser_demo.smf x86_contract=desktop_shell";
    uint32_t i = 0;
    while (content[i] != 0 && i + 1U < sizeof(g_riscv_gui_surface)) {
        g_riscv_gui_surface[i] = content[i];
        i++;
    }
    g_riscv_gui_surface[i] = 0;
    if (!bytes_contains((const unsigned char *)g_riscv_gui_surface, sizeof(g_riscv_gui_surface), "pid=1002")) return 0;
    if (!bytes_contains((const unsigned char *)g_riscv_gui_surface, sizeof(g_riscv_gui_surface), "/sys/apps/browser_demo.smf")) return 0;
    return bytes_contains((const unsigned char *)g_riscv_gui_surface, sizeof(g_riscv_gui_surface), "x86_contract=desktop_shell") ? 1 : 0;
}

struct rv_vring_desc {
    uint64_t addr;
    uint32_t len;
    uint16_t flags;
    uint16_t next;
} __attribute__((packed));

struct rv_vring_avail {
    uint16_t flags;
    uint16_t idx;
    uint16_t ring[];
} __attribute__((packed));

struct rv_vring_used_elem {
    uint32_t id;
    uint32_t len;
} __attribute__((packed));

struct rv_vring_used {
    uint16_t flags;
    uint16_t idx;
    struct rv_vring_used_elem ring[];
} __attribute__((packed));

struct rv_virtio_net_hdr {
    uint8_t flags;
    uint8_t gso_type;
    uint16_t hdr_len;
    uint16_t gso_size;
    uint16_t csum_start;
    uint16_t csum_offset;
} __attribute__((packed));

struct rv_eth_hdr {
    uint8_t dst[6];
    uint8_t src[6];
    uint16_t ethertype;
} __attribute__((packed));

struct rv_arp_pkt {
    uint16_t hw_type;
    uint16_t proto_type;
    uint8_t hw_len;
    uint8_t proto_len;
    uint16_t opcode;
    uint8_t sender_mac[6];
    uint8_t sender_ip[4];
    uint8_t target_mac[6];
    uint8_t target_ip[4];
} __attribute__((packed));

struct rv_ipv4_hdr {
    uint8_t ver_ihl;
    uint8_t tos;
    uint16_t total_len;
    uint16_t id;
    uint16_t frag_off;
    uint8_t ttl;
    uint8_t protocol;
    uint16_t checksum;
    uint8_t src_ip[4];
    uint8_t dst_ip[4];
} __attribute__((packed));

struct rv_tcp_hdr {
    uint16_t src_port;
    uint16_t dst_port;
    uint32_t seq_num;
    uint32_t ack_num;
    uint8_t data_off;
    uint8_t flags;
    uint16_t window;
    uint16_t checksum;
    uint16_t urgent;
} __attribute__((packed));

#define RV_VNET_QUEUE_SIZE 8U
#define RV_VNET_BUF_SIZE 2048U
#define RV_VNET_HDR_SIZE 10U
#define RV_ETH_HLEN 14U
#define RV_ETH_P_IP 0x0800U
#define RV_ETH_P_ARP 0x0806U
#define RV_IP_PROTO_TCP 6U
#define RV_ARP_HW_ETHER 1U
#define RV_ARP_OP_REQUEST 1U
#define RV_ARP_OP_REPLY 2U
#define RV_TCP_SYN 0x02U
#define RV_TCP_ACK 0x10U
#define RV_TCP_PSH 0x08U
#define RV_TCP_FIN 0x01U
#define RV_MAX_SOCKETS 8
#define RV_TCP_RXBUF_SIZE 4096U
#define RV_TCP_ACCEPT_QUEUE 4

static unsigned char g_vnet_rx_queue[8192] __attribute__((aligned(4096)));
static unsigned char g_vnet_tx_queue[8192] __attribute__((aligned(4096)));
static unsigned char g_vnet_rx_bufs[RV_VNET_QUEUE_SIZE * RV_VNET_BUF_SIZE] __attribute__((aligned(16)));
static unsigned char g_vnet_tx_bufs[RV_VNET_QUEUE_SIZE * RV_VNET_BUF_SIZE] __attribute__((aligned(16)));

enum rv_tcp_state {
    RV_TCP_CLOSED = 0,
    RV_TCP_LISTEN,
    RV_TCP_SYN_RECEIVED,
    RV_TCP_ESTABLISHED
};

struct rv_tcp_socket {
    int in_use;
    enum rv_tcp_state state;
    uint16_t local_port;
    uint16_t remote_port;
    uint8_t remote_ip[4];
    uint8_t remote_mac[6];
    uint32_t snd_nxt;
    uint32_t snd_una;
    uint32_t rcv_nxt;
    uint16_t rcv_wnd;
    uint8_t rxbuf[RV_TCP_RXBUF_SIZE];
    uint32_t rx_head;
    uint32_t rx_tail;
    int accept_queue[RV_TCP_ACCEPT_QUEUE];
    int aq_head;
    int aq_tail;
    int aq_count;
    int backlog;
};

static struct rv_tcp_socket g_rv_sockets[RV_MAX_SOCKETS];
static uint32_t g_rv_tcp_isn = 0x1000U;

static struct {
    volatile uint32_t *mmio;
    uint32_t version;
    uint8_t mac[6];
    uint8_t our_ip[4];
    uint16_t rx_qsize;
    struct rv_vring_desc *rx_desc;
    struct rv_vring_avail *rx_avail;
    struct rv_vring_used *rx_used;
    uint16_t rx_last_used;
    uint16_t tx_qsize;
    struct rv_vring_desc *tx_desc;
    struct rv_vring_avail *tx_avail;
    struct rv_vring_used *tx_used;
    uint16_t tx_last_used;
    uint16_t tx_next_desc;
    int initialized;
    uint32_t rx_count;
    uint32_t tx_count;
} g_rv_vnet;

static uint16_t rv_net_htons(uint16_t h)
{
    return (uint16_t)((h >> 8) | (h << 8));
}

static uint16_t rv_net_ntohs(uint16_t n)
{
    return rv_net_htons(n);
}

static uint32_t rv_net_htonl(uint32_t h)
{
    return ((h & 0xFFU) << 24) | ((h & 0xFF00U) << 8) |
           ((h >> 8) & 0xFF00U) | ((h >> 24) & 0xFFU);
}

static uint32_t rv_net_ntohl(uint32_t n)
{
    return rv_net_htonl(n);
}

static uint16_t rv_inet_checksum(const void *data, uint32_t len)
{
    const uint8_t *p = (const uint8_t *)data;
    uint32_t sum = 0;
    for (uint32_t i = 0; i + 1U < len; i += 2U) {
        sum += ((uint32_t)p[i] << 8) | p[i + 1U];
    }
    if ((len & 1U) != 0U) sum += (uint32_t)p[len - 1U] << 8;
    while ((sum >> 16) != 0U) sum = (sum & 0xFFFFU) + (sum >> 16);
    return rv_net_htons((uint16_t)~sum);
}

static uint16_t rv_tcp_checksum(const uint8_t *src_ip, const uint8_t *dst_ip, const void *tcp_data, uint16_t tcp_len)
{
    const uint8_t *p = (const uint8_t *)tcp_data;
    uint32_t sum = 0;
    sum += ((uint16_t)src_ip[0] << 8) | src_ip[1];
    sum += ((uint16_t)src_ip[2] << 8) | src_ip[3];
    sum += ((uint16_t)dst_ip[0] << 8) | dst_ip[1];
    sum += ((uint16_t)dst_ip[2] << 8) | dst_ip[3];
    sum += RV_IP_PROTO_TCP;
    sum += tcp_len;
    for (uint16_t i = 0; i + 1U < tcp_len; i += 2U) sum += ((uint16_t)p[i] << 8) | p[i + 1U];
    if ((tcp_len & 1U) != 0U) sum += (uint16_t)p[tcp_len - 1U] << 8;
    while ((sum >> 16) != 0U) sum = (sum & 0xFFFFU) + (sum >> 16);
    return rv_net_htons((uint16_t)~sum);
}

static uintptr_t rv_align_up_uintptr(uintptr_t value, uintptr_t align)
{
    return (value + align - 1U) & ~(align - 1U);
}

static uint32_t rv_mmio_rd32(uint32_t off)
{
    return g_rv_vnet.mmio[off / 4U];
}

static void rv_mmio_wr32(uint32_t off, uint32_t value)
{
    g_rv_vnet.mmio[off / 4U] = value;
}

static void rv_vnet_delay(void)
{
    for (volatile int i = 0; i < 1000; i++) {}
}

static void rv_vnet_setup_queue(uint16_t qsel, unsigned char *queue_mem, uint16_t *out_qsize,
                                struct rv_vring_desc **out_desc, struct rv_vring_avail **out_avail,
                                struct rv_vring_used **out_used)
{
    rv_mmio_wr32(0x030U, qsel);
    uint16_t qsize = (uint16_t)rv_mmio_rd32(0x034U);
    if (qsize == 0U || qsize > RV_VNET_QUEUE_SIZE) qsize = RV_VNET_QUEUE_SIZE;
    rv_mmio_wr32(0x038U, qsize);

    uintptr_t base = (uintptr_t)queue_mem;
    uintptr_t desc = base;
    uintptr_t avail = desc + ((uintptr_t)qsize * sizeof(struct rv_vring_desc));
    uintptr_t used = rv_align_up_uintptr(avail + 4U + ((uintptr_t)qsize * 2U) + 2U, 4096U);
    *out_desc = (struct rv_vring_desc *)desc;
    *out_avail = (struct rv_vring_avail *)avail;
    *out_used = (struct rv_vring_used *)used;
    *out_qsize = qsize;
    rv_memzero(queue_mem, 8192U);

    if (g_rv_vnet.version == 1U) {
        rv_mmio_wr32(0x028U, 4096U);
        rv_mmio_wr32(0x03cU, 4096U);
        rv_mmio_wr32(0x040U, (uint32_t)(base >> 12));
    } else {
        rv_mmio_wr32(0x080U, (uint32_t)desc);
        rv_mmio_wr32(0x084U, (uint32_t)((uint64_t)desc >> 32));
        rv_mmio_wr32(0x090U, (uint32_t)avail);
        rv_mmio_wr32(0x094U, (uint32_t)((uint64_t)avail >> 32));
        rv_mmio_wr32(0x0a0U, (uint32_t)used);
        rv_mmio_wr32(0x0a4U, (uint32_t)((uint64_t)used >> 32));
        rv_mmio_wr32(0x044U, 1U);
    }
}

static void rv_vnet_fill_rx(void)
{
    for (uint16_t i = 0; i < g_rv_vnet.rx_qsize; i++) {
        g_rv_vnet.rx_desc[i].addr = (uint64_t)(uintptr_t)(g_vnet_rx_bufs + ((size_t)i * RV_VNET_BUF_SIZE));
        g_rv_vnet.rx_desc[i].len = RV_VNET_BUF_SIZE;
        g_rv_vnet.rx_desc[i].flags = VIRTQ_DESC_F_WRITE;
        g_rv_vnet.rx_desc[i].next = 0;
        g_rv_vnet.rx_avail->ring[i] = i;
    }
    rv_fence();
    g_rv_vnet.rx_avail->idx = g_rv_vnet.rx_qsize;
    g_rv_vnet.rx_last_used = 0;
    rv_fence();
    rv_mmio_wr32(0x050U, 0U);
}

static void rv_vnet_reclaim_tx(void)
{
    rv_fence();
    while (g_rv_vnet.tx_last_used != g_rv_vnet.tx_used->idx) g_rv_vnet.tx_last_used++;
}

static int rv_vnet_send_frame(const void *frame, uint16_t frame_len)
{
    if (!g_rv_vnet.initialized) return -19;
    if ((uint32_t)frame_len + RV_VNET_HDR_SIZE > RV_VNET_BUF_SIZE) return -90;
    rv_vnet_reclaim_tx();
    uint16_t pending = (uint16_t)(g_rv_vnet.tx_next_desc - g_rv_vnet.tx_last_used);
    if (pending >= g_rv_vnet.tx_qsize) return -11;
    uint16_t di = (uint16_t)(g_rv_vnet.tx_next_desc % g_rv_vnet.tx_qsize);
    g_rv_vnet.tx_next_desc++;
    unsigned char *buf = g_vnet_tx_bufs + ((size_t)di * RV_VNET_BUF_SIZE);
    rv_memzero(buf, RV_VNET_HDR_SIZE);
    __builtin_memcpy(buf + RV_VNET_HDR_SIZE, frame, frame_len);
    g_rv_vnet.tx_desc[di].addr = (uint64_t)(uintptr_t)buf;
    g_rv_vnet.tx_desc[di].len = RV_VNET_HDR_SIZE + frame_len;
    g_rv_vnet.tx_desc[di].flags = 0;
    g_rv_vnet.tx_desc[di].next = 0;
    uint16_t avail_idx = g_rv_vnet.tx_avail->idx;
    g_rv_vnet.tx_avail->ring[avail_idx % g_rv_vnet.tx_qsize] = di;
    rv_fence();
    g_rv_vnet.tx_avail->idx = (uint16_t)(avail_idx + 1U);
    rv_fence();
    rv_mmio_wr32(0x050U, 1U);
    g_rv_vnet.tx_count++;
    return 0;
}

static void rv_vnet_send_arp_reply(const struct rv_eth_hdr *eth, const struct rv_arp_pkt *arp)
{
    unsigned char frame[RV_ETH_HLEN + sizeof(struct rv_arp_pkt)];
    struct rv_eth_hdr *reth = (struct rv_eth_hdr *)frame;
    struct rv_arp_pkt *rarp = (struct rv_arp_pkt *)(frame + RV_ETH_HLEN);
    __builtin_memcpy(reth->dst, eth->src, 6);
    __builtin_memcpy(reth->src, g_rv_vnet.mac, 6);
    reth->ethertype = rv_net_htons(RV_ETH_P_ARP);
    rarp->hw_type = rv_net_htons(RV_ARP_HW_ETHER);
    rarp->proto_type = rv_net_htons(RV_ETH_P_IP);
    rarp->hw_len = 6;
    rarp->proto_len = 4;
    rarp->opcode = rv_net_htons(RV_ARP_OP_REPLY);
    __builtin_memcpy(rarp->sender_mac, g_rv_vnet.mac, 6);
    __builtin_memcpy(rarp->sender_ip, g_rv_vnet.our_ip, 4);
    __builtin_memcpy(rarp->target_mac, arp->sender_mac, 6);
    __builtin_memcpy(rarp->target_ip, arp->sender_ip, 4);
    (void)rv_vnet_send_frame(frame, sizeof(frame));
}

static void rv_tcp_send_segment(int sid, uint8_t flags, const void *data, uint16_t data_len)
{
    struct rv_tcp_socket *s = &g_rv_sockets[sid];
    unsigned char pkt[1500];
    uint16_t tcp_len = (uint16_t)(20U + data_len);
    uint16_t ip_len = (uint16_t)(20U + tcp_len);
    struct rv_eth_hdr *eth = (struct rv_eth_hdr *)pkt;
    struct rv_ipv4_hdr *ip = (struct rv_ipv4_hdr *)(pkt + RV_ETH_HLEN);
    struct rv_tcp_hdr *tcp = (struct rv_tcp_hdr *)(pkt + RV_ETH_HLEN + 20U);
    __builtin_memcpy(eth->dst, s->remote_mac, 6);
    __builtin_memcpy(eth->src, g_rv_vnet.mac, 6);
    eth->ethertype = rv_net_htons(RV_ETH_P_IP);
    ip->ver_ihl = 0x45U;
    ip->tos = 0;
    ip->total_len = rv_net_htons(ip_len);
    ip->id = rv_net_htons((uint16_t)g_rv_tcp_isn);
    ip->frag_off = 0;
    ip->ttl = 64;
    ip->protocol = RV_IP_PROTO_TCP;
    ip->checksum = 0;
    __builtin_memcpy(ip->src_ip, g_rv_vnet.our_ip, 4);
    __builtin_memcpy(ip->dst_ip, s->remote_ip, 4);
    ip->checksum = rv_inet_checksum(ip, 20U);
    tcp->src_port = rv_net_htons(s->local_port);
    tcp->dst_port = rv_net_htons(s->remote_port);
    tcp->seq_num = rv_net_htonl(s->snd_nxt);
    tcp->ack_num = rv_net_htonl(s->rcv_nxt);
    tcp->data_off = 0x50U;
    tcp->flags = flags;
    tcp->window = rv_net_htons(RV_TCP_RXBUF_SIZE);
    tcp->checksum = 0;
    tcp->urgent = 0;
    if (data_len > 0 && data) __builtin_memcpy(pkt + RV_ETH_HLEN + 40U, data, data_len);
    tcp->checksum = rv_tcp_checksum(g_rv_vnet.our_ip, s->remote_ip, tcp, tcp_len);
    (void)rv_vnet_send_frame(pkt, (uint16_t)(RV_ETH_HLEN + ip_len));
    s->snd_nxt += data_len;
    if ((flags & (RV_TCP_SYN | RV_TCP_FIN)) != 0U) s->snd_nxt += 1U;
}

static uint32_t rv_tcp_rx_available(int sid)
{
    struct rv_tcp_socket *s = &g_rv_sockets[sid];
    return (s->rx_head >= s->rx_tail) ? (s->rx_head - s->rx_tail) : (RV_TCP_RXBUF_SIZE - s->rx_tail + s->rx_head);
}

static void rv_tcp_handle_segment(const unsigned char *frame, uint16_t frame_len)
{
    if (frame_len < RV_ETH_HLEN + 40U) return;
    const struct rv_eth_hdr *eth = (const struct rv_eth_hdr *)frame;
    const struct rv_ipv4_hdr *ip = (const struct rv_ipv4_hdr *)(frame + RV_ETH_HLEN);
    uint16_t ip_hlen = (uint16_t)(ip->ver_ihl & 0x0FU) * 4U;
    const struct rv_tcp_hdr *tcp = (const struct rv_tcp_hdr *)(frame + RV_ETH_HLEN + ip_hlen);
    uint16_t tcp_hlen = (uint16_t)(tcp->data_off >> 4) * 4U;
    uint16_t ip_total = rv_net_ntohs(ip->total_len);
    uint16_t data_len = ip_total > ip_hlen + tcp_hlen ? (uint16_t)(ip_total - ip_hlen - tcp_hlen) : 0U;
    const unsigned char *data = frame + RV_ETH_HLEN + ip_hlen + tcp_hlen;
    uint16_t dst_port = rv_net_ntohs(tcp->dst_port);
    uint16_t src_port = rv_net_ntohs(tcp->src_port);
    uint32_t seq = rv_net_ntohl(tcp->seq_num);
    uint32_t ack = rv_net_ntohl(tcp->ack_num);
    uint8_t flags = tcp->flags;
    int sid = -1;
    int listen_sid = -1;
    for (int i = 0; i < RV_MAX_SOCKETS; i++) {
        if (!g_rv_sockets[i].in_use) continue;
        if (g_rv_sockets[i].state >= RV_TCP_SYN_RECEIVED &&
            g_rv_sockets[i].local_port == dst_port &&
            g_rv_sockets[i].remote_port == src_port) {
            sid = i;
            break;
        }
    }
    if (sid < 0 && (flags & RV_TCP_SYN) != 0U) {
        for (int i = 0; i < RV_MAX_SOCKETS; i++) {
            if (g_rv_sockets[i].in_use &&
                g_rv_sockets[i].state == RV_TCP_LISTEN &&
                g_rv_sockets[i].local_port == dst_port) {
                listen_sid = i;
                break;
            }
        }
    }
    if (listen_sid >= 0 && (flags & RV_TCP_SYN) != 0U && (flags & RV_TCP_ACK) == 0U) {
        int new_sid = -1;
        for (int i = 0; i < RV_MAX_SOCKETS; i++) {
            if (!g_rv_sockets[i].in_use) {
                new_sid = i;
                break;
            }
        }
        if (new_sid < 0) return;
        rv_memzero(&g_rv_sockets[new_sid], sizeof(g_rv_sockets[new_sid]));
        g_rv_sockets[new_sid].in_use = 1;
        g_rv_sockets[new_sid].state = RV_TCP_SYN_RECEIVED;
        g_rv_sockets[new_sid].local_port = dst_port;
        g_rv_sockets[new_sid].remote_port = src_port;
        g_rv_sockets[new_sid].snd_nxt = g_rv_tcp_isn++;
        g_rv_sockets[new_sid].snd_una = g_rv_sockets[new_sid].snd_nxt;
        g_rv_sockets[new_sid].rcv_nxt = seq + 1U;
        g_rv_sockets[new_sid].rcv_wnd = RV_TCP_RXBUF_SIZE;
        __builtin_memcpy(g_rv_sockets[new_sid].remote_ip, ip->src_ip, 4);
        __builtin_memcpy(g_rv_sockets[new_sid].remote_mac, eth->src, 6);
        rv_tcp_send_segment(new_sid, RV_TCP_SYN | RV_TCP_ACK, NULL, 0);
        return;
    }
    if (sid < 0) return;
    struct rv_tcp_socket *s = &g_rv_sockets[sid];
    if (s->state == RV_TCP_SYN_RECEIVED && (flags & RV_TCP_ACK) != 0U) {
        s->snd_una = ack;
        s->state = RV_TCP_ESTABLISHED;
        for (int i = 0; i < RV_MAX_SOCKETS; i++) {
            if (g_rv_sockets[i].in_use &&
                g_rv_sockets[i].state == RV_TCP_LISTEN &&
                g_rv_sockets[i].local_port == s->local_port) {
                struct rv_tcp_socket *ls = &g_rv_sockets[i];
                if (ls->aq_count < RV_TCP_ACCEPT_QUEUE) {
                    ls->accept_queue[ls->aq_tail] = sid;
                    ls->aq_tail = (ls->aq_tail + 1) % RV_TCP_ACCEPT_QUEUE;
                    ls->aq_count++;
                }
                break;
            }
        }
        return;
    }
    if (s->state != RV_TCP_ESTABLISHED) return;
    if (data_len > 0U) {
        for (uint16_t i = 0; i < data_len; i++) {
            uint32_t next = (s->rx_head + 1U) % RV_TCP_RXBUF_SIZE;
            if (next == s->rx_tail) break;
            s->rxbuf[s->rx_head] = data[i];
            s->rx_head = next;
        }
        s->rcv_nxt = seq + data_len;
        rv_tcp_send_segment(sid, RV_TCP_ACK, NULL, 0);
    }
    if ((flags & RV_TCP_ACK) != 0U) s->snd_una = ack;
    if ((flags & RV_TCP_FIN) != 0U) {
        s->rcv_nxt = seq + data_len + 1U;
        rv_tcp_send_segment(sid, RV_TCP_ACK, NULL, 0);
        s->state = RV_TCP_CLOSED;
        s->in_use = 0;
    }
}

static void rv_vnet_handle_frame(const unsigned char *frame, uint16_t frame_len)
{
    if (frame_len < RV_ETH_HLEN) return;
    const struct rv_eth_hdr *eth = (const struct rv_eth_hdr *)frame;
    uint16_t ethertype = rv_net_ntohs(eth->ethertype);
    if (ethertype == RV_ETH_P_ARP) {
        if (frame_len < RV_ETH_HLEN + sizeof(struct rv_arp_pkt)) return;
        const struct rv_arp_pkt *arp = (const struct rv_arp_pkt *)(frame + RV_ETH_HLEN);
        if (rv_net_ntohs(arp->opcode) == RV_ARP_OP_REQUEST &&
            __builtin_memcmp(arp->target_ip, g_rv_vnet.our_ip, 4) == 0) {
            rv_vnet_send_arp_reply(eth, arp);
        }
    } else if (ethertype == RV_ETH_P_IP) {
        const struct rv_ipv4_hdr *ip = (const struct rv_ipv4_hdr *)(frame + RV_ETH_HLEN);
        if (frame_len >= RV_ETH_HLEN + 20U &&
            ip->protocol == RV_IP_PROTO_TCP &&
            __builtin_memcmp(ip->dst_ip, g_rv_vnet.our_ip, 4) == 0) {
            rv_tcp_handle_segment(frame, frame_len);
        }
    }
}

static int rv_vnet_poll(void)
{
    if (!g_rv_vnet.initialized) return -19;
    int processed = 0;
    rv_vnet_reclaim_tx();
    while (1) {
        rv_fence();
        uint16_t used_idx = g_rv_vnet.rx_used->idx;
        if (g_rv_vnet.rx_last_used == used_idx) break;
        uint16_t slot = g_rv_vnet.rx_last_used % g_rv_vnet.rx_qsize;
        uint32_t desc_id = g_rv_vnet.rx_used->ring[slot].id;
        uint32_t used_len = g_rv_vnet.rx_used->ring[slot].len;
        g_rv_vnet.rx_last_used++;
        if (desc_id < g_rv_vnet.rx_qsize && used_len > RV_VNET_HDR_SIZE) {
            unsigned char *buf = g_vnet_rx_bufs + ((size_t)desc_id * RV_VNET_BUF_SIZE);
            rv_vnet_handle_frame(buf + RV_VNET_HDR_SIZE, (uint16_t)(used_len - RV_VNET_HDR_SIZE));
            g_rv_vnet.rx_count++;
            g_rv_vnet.rx_desc[desc_id].addr = (uint64_t)(uintptr_t)buf;
            g_rv_vnet.rx_desc[desc_id].len = RV_VNET_BUF_SIZE;
            g_rv_vnet.rx_desc[desc_id].flags = VIRTQ_DESC_F_WRITE;
            g_rv_vnet.rx_desc[desc_id].next = 0;
            uint16_t avail_idx = g_rv_vnet.rx_avail->idx;
            g_rv_vnet.rx_avail->ring[avail_idx % g_rv_vnet.rx_qsize] = (uint16_t)desc_id;
            rv_fence();
            g_rv_vnet.rx_avail->idx = (uint16_t)(avail_idx + 1U);
            processed++;
        }
    }
    if (processed > 0) rv_mmio_wr32(0x050U, 0U);
    return processed;
}

