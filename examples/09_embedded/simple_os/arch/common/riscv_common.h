/* riscv_common.h — Width-independent helpers shared by riscv32 and riscv64
 * baremetal_stubs.c.
 *
 * Prerequisites (must be defined/declared by the including file before this
 * header is included):
 *   - RuntimeValue, HeapHeader, RuntimeString typedefs
 *   - ENCODE_PTR, DECODE_PTR, IS_HEAP, NIL_VALUE macros
 *   - HEAP_STRING, SIFIVE_TEST_BASE macros
 *   - VIRTIO_MMIO_BASE, VIRTIO_MMIO_STRIDE, VIRTIO_MMIO_SLOTS, VIRTIO_MAGIC,
 *     VIRTIO_DEV_BLK, VIRTQ_DESC_F_NEXT, VIRTQ_DESC_F_WRITE,
 *     VIRTIO_STATUS_* macros
 *   - rv_alloc() from baremetal_bump_heap.h (included before this header)
 *   - uart_putc() / uart_puts() from baremetal_16550_serial.h
 *   - Globals: g_heap[], g_heap_off, g_virtq[], g_dma[], g_riscv_file_buf[],
 *     g_riscv_process_arena[][], g_riscv_process_entry[], g_riscv_process_pid[],
 *     g_riscv_process_count, g_blk_mmio, g_last_used_idx
 *
 * Width-dependent functions kept per-arch (NOT here):
 *   - riscv_load_elf_process()  — ELF32 vs ELF64 header offsets differ
 *   - rt_string_new()           — zero-length guard differs between rv32/rv64
 *   - rt_riscv_smf_cli_probe/load, rt_riscv_smf_gui_probe — marker strings differ
 *   - rt_riscv_native_gui_process_render — content string differs
 *   - Any harden/canary, probe-store, _start functions
 */

#ifndef RISCV_COMMON_H
#define RISCV_COMMON_H

/* Forward declaration: arch-specific ELF loader (body in each per-arch file) */
static int riscv_load_elf_process(const unsigned char *elf, uint32_t elf_size,
                                   uint32_t slot, const char *marker);

/* --------------------------------------------------------------------------
 * Low-level memory / fence helpers
 * -------------------------------------------------------------------------- */

static void rv_memzero(void *ptr, uintptr_t len)
{
    unsigned char *p = (unsigned char *)ptr;
    for (uintptr_t i = 0; i < len; i++) p[i] = 0;
}

static void rv_fence(void)
{
    __asm__ volatile("fence rw, rw" ::: "memory");
}

/* --------------------------------------------------------------------------
 * Little-endian I/O helpers
 * -------------------------------------------------------------------------- */

static void le16(volatile unsigned char *p, uint16_t v)
{
    p[0] = (unsigned char)(v & 0xffU);
    p[1] = (unsigned char)((v >> 8) & 0xffU);
}

static void le32(volatile unsigned char *p, uint32_t v)
{
    p[0] = (unsigned char)(v & 0xffU);
    p[1] = (unsigned char)((v >> 8) & 0xffU);
    p[2] = (unsigned char)((v >> 16) & 0xffU);
    p[3] = (unsigned char)((v >> 24) & 0xffU);
}

static uint16_t rd16(const unsigned char *p)
{
    return (uint16_t)p[0] | ((uint16_t)p[1] << 8);
}

static uint32_t rd32(const unsigned char *p)
{
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

static uint64_t rd64(const unsigned char *p)
{
    return (uint64_t)rd32(p) | ((uint64_t)rd32(p + 4) << 32);
}

static int mem_eq(const unsigned char *p, const char *s, uint32_t len)
{
    for (uint32_t i = 0; i < len; i++) {
        if (p[i] != (unsigned char)s[i]) return 0;
    }
    return 1;
}

/* --------------------------------------------------------------------------
 * VirtIO block device
 * -------------------------------------------------------------------------- */

static int virtio_blk_init(void)
{
    for (uint32_t slot = 0; slot < VIRTIO_MMIO_SLOTS; slot++) {
        volatile uint32_t *mmio = (volatile uint32_t *)(VIRTIO_MMIO_BASE + ((uintptr_t)slot * VIRTIO_MMIO_STRIDE));
        if (mmio[0x000 / 4] == VIRTIO_MAGIC && mmio[0x008 / 4] == VIRTIO_DEV_BLK) {
            g_blk_mmio = mmio;
            break;
        }
    }
    if (!g_blk_mmio) return 0;

    volatile uint32_t *mmio = g_blk_mmio;
    uint32_t version = mmio[0x004 / 4];
    rv_memzero(g_virtq, sizeof(g_virtq));
    mmio[0x070 / 4] = 0;
    mmio[0x070 / 4] = VIRTIO_STATUS_ACKNOWLEDGE;
    mmio[0x070 / 4] = VIRTIO_STATUS_ACKNOWLEDGE | VIRTIO_STATUS_DRIVER;
    mmio[0x024 / 4] = 0;
    mmio[0x020 / 4] = 0;
    mmio[0x070 / 4] = VIRTIO_STATUS_ACKNOWLEDGE | VIRTIO_STATUS_DRIVER | VIRTIO_STATUS_FEATURES_OK;
    if ((mmio[0x070 / 4] & VIRTIO_STATUS_FEATURES_OK) == 0) return 0;
    mmio[0x030 / 4] = 0;
    mmio[0x038 / 4] = 8;
    uintptr_t q = (uintptr_t)g_virtq;
    if (version == 1) {
        mmio[0x028 / 4] = 4096;
        mmio[0x03c / 4] = 4096;
        mmio[0x040 / 4] = (uint32_t)(q >> 12);
    } else {
        mmio[0x080 / 4] = (uint32_t)q;
        mmio[0x084 / 4] = (uint32_t)((uint64_t)q >> 32);
        mmio[0x090 / 4] = (uint32_t)(q + 2048U);
        mmio[0x094 / 4] = (uint32_t)((uint64_t)(q + 2048U) >> 32);
        mmio[0x0a0 / 4] = (uint32_t)(q + 4096U);
        mmio[0x0a4 / 4] = (uint32_t)((uint64_t)(q + 4096U) >> 32);
        mmio[0x044 / 4] = 1;
    }
    g_last_used_idx = 0;
    mmio[0x070 / 4] = VIRTIO_STATUS_ACKNOWLEDGE | VIRTIO_STATUS_DRIVER | VIRTIO_STATUS_FEATURES_OK | VIRTIO_STATUS_DRIVER_OK;
    rv_fence();
    return 1;
}

/* Base of the optional memory-backed ramdisk. On the FPGA/GHDL rv32 soft-core
 * the FAT32 filesystem image is preloaded into a RAM bank here (see
 * rv32_exec_core_flat.vhd); on silicon this is a region of PS DDR. Overridable
 * at build time, but detection is at RUNTIME so ONE kernel binary serves both
 * the QEMU virtio-blk lane and the ramdisk lane. */
#ifndef RISCV_RAMDISK_BASE
#define RISCV_RAMDISK_BASE 0x88000000u
#endif

/* Auto-detect a memory-backed ramdisk: true only when a valid FAT boot sector
 * (0xEB/0xE9 jump + 0x55AA signature) is present at RISCV_RAMDISK_BASE. In QEMU
 * that window is plain zeroed RAM (256 MiB guest), so the probe fails and the
 * driver uses virtio-blk; in the GHDL soft-core the bank holds the image, so the
 * probe succeeds and sector reads become a plain RAM memcpy. Result is cached. */
static int ramdisk_fs_present(void)
{
    static int cached = -1;
    if (cached < 0) {
        const volatile unsigned char *r =
            (const volatile unsigned char *)(uintptr_t)(RISCV_RAMDISK_BASE);
        if ((r[0] == 0xEBU || r[0] == 0xE9U) && r[510] == 0x55U && r[511] == 0xAAU) {
            cached = 1;
        } else {
            cached = 0;
        }
    }
    return cached;
}

static int virtio_blk_read_sector(uint32_t lba)
{
    if (ramdisk_fs_present()) {
        /* Memory-backed ramdisk path: the FAT32 image lives at
         * RISCV_RAMDISK_BASE, so a sector read is a 512-byte memcpy into the
         * sector buffer (g_dma + 16 == sector_data()). No virtio doorbell/DMA.
         * All fat32/nvfs/smf callers stay device-agnostic via sector_data(). */
        const unsigned char *src =
            (const unsigned char *)(uintptr_t)(RISCV_RAMDISK_BASE) +
            ((uintptr_t)lba * 512U);
        unsigned char *dst = g_dma + 16U;
        for (uint32_t i = 0; i < 512U; i++) dst[i] = src[i];
        return 1;
    }
    if (!g_blk_mmio && !virtio_blk_init()) return 0;
    rv_memzero(g_dma, sizeof(g_dma));
    uintptr_t dma = (uintptr_t)g_dma;
    le32(g_dma + 0, 0);
    le32(g_dma + 4, 0);
    le32(g_dma + 8, lba);
    le32(g_dma + 12, 0);
    g_dma[528] = 0xffU;

    volatile unsigned char *desc = (volatile unsigned char *)g_virtq;
    le32(desc + 0, (uint32_t)dma);
    le32(desc + 4, (uint32_t)((uint64_t)dma >> 32));
    le32(desc + 8, 16);
    le16(desc + 12, VIRTQ_DESC_F_NEXT);
    le16(desc + 14, 1);

    le32(desc + 16, (uint32_t)(dma + 16U));
    le32(desc + 20, (uint32_t)((uint64_t)(dma + 16U) >> 32));
    le32(desc + 24, 512);
    le16(desc + 28, VIRTQ_DESC_F_NEXT | VIRTQ_DESC_F_WRITE);
    le16(desc + 30, 2);

    le32(desc + 32, (uint32_t)(dma + 528U));
    le32(desc + 36, (uint32_t)((uint64_t)(dma + 528U) >> 32));
    le32(desc + 40, 1);
    le16(desc + 44, VIRTQ_DESC_F_WRITE);
    le16(desc + 46, 0);

    volatile uint16_t *avail = (volatile uint16_t *)(g_virtq + 2048U);
    volatile uint16_t *used = (volatile uint16_t *)(g_virtq + 4096U);
    uint16_t idx = avail[1];
    avail[2 + (idx % 8U)] = 0;
    rv_fence();
    avail[1] = (uint16_t)(idx + 1U);
    rv_fence();
    g_blk_mmio[0x050 / 4] = 0;
    rv_fence();
    for (uint32_t spin = 0; spin < 50000000U; spin++) {
        rv_fence();
        if (used[1] != g_last_used_idx) {
            g_last_used_idx = used[1];
            return g_dma[528] == 0;
        }
    }
    return 0;
}

/* --------------------------------------------------------------------------
 * FAT32 driver
 * -------------------------------------------------------------------------- */

typedef struct {
    uint32_t spc;
    uint32_t reserved;
    uint32_t fats;
    uint32_t fat_size;
    uint32_t root_cluster;
    uint32_t data_start;
    uint32_t data_clusters;
} Fat32Probe;

static unsigned char *sector_data(void)
{
    return g_dma + 16U;
}

static uint32_t fat_cluster_sector(const Fat32Probe *fat, uint32_t cluster)
{
    return fat->data_start + ((cluster - 2U) * fat->spc);
}

static int fat32_probe_bpb(Fat32Probe *fat)
{
    if (!virtio_blk_read_sector(0)) return 0;
    const unsigned char *b = sector_data();
    if (rd16(b + 11U) != 512U) return 0;
    fat->spc = b[13U];
    fat->reserved = rd16(b + 14U);
    fat->fats = b[16U];
    fat->fat_size = rd32(b + 36U);
    fat->root_cluster = rd32(b + 44U);
    if (fat->spc == 0 || fat->reserved == 0 || fat->fats == 0 || fat->fat_size == 0 || fat->root_cluster < 2U) return 0;
    fat->data_start = fat->reserved + (fat->fats * fat->fat_size);
    uint32_t total_sectors = rd16(b + 19U);
    if (total_sectors == 0U) total_sectors = rd32(b + 32U);
    if (total_sectors <= fat->data_start) return 0;
    fat->data_clusters = (total_sectors - fat->data_start) / fat->spc;
    if (fat->data_clusters == 0U) return 0;
    return 1;
}

static uint32_t fat32_next_cluster(const Fat32Probe *fat, uint32_t cluster)
{
    uint32_t fat_offset = cluster * 4U;
    uint32_t sector = fat->reserved + (fat_offset / 512U);
    uint32_t offset = fat_offset % 512U;
    if (!virtio_blk_read_sector(sector)) return 0x0fffffffu;
    return rd32(sector_data() + offset) & 0x0fffffffu;
}

static uint32_t fat32_find_entry_cluster(const Fat32Probe *fat, uint32_t dir_cluster, const char *name11, uint32_t want_dir, uint32_t *size_out)
{
    uint32_t cluster = dir_cluster;
    uint32_t hops = 0;
    while (cluster >= 2U && cluster < 0x0ffffff8U &&
           cluster - 2U < fat->data_clusters && hops++ < fat->data_clusters) {
        uint32_t first_sector = fat_cluster_sector(fat, cluster);
        for (uint32_t sec = 0; sec < fat->spc; sec++) {
            if (!virtio_blk_read_sector(first_sector + sec)) return 0;
            const unsigned char *data = sector_data();
            for (uint32_t off = 0; off < 512U; off += 32U) {
                const unsigned char *e = data + off;
                if (e[0] == 0x00U) return 0;
                if (e[0] == 0xe5U || e[11] == 0x0fU) continue;
                if (!mem_eq(e, name11, 11U)) continue;
                uint32_t is_dir = (e[11] & 0x10U) != 0;
                if (is_dir != want_dir) continue;
                if (size_out) *size_out = rd32(e + 28U);
                return ((uint32_t)rd16(e + 20U) << 16) | rd16(e + 26U);
            }
        }
        uint32_t next = fat32_next_cluster(fat, cluster);
        if (next >= 0x0ffffff8U) return 0;
        if (next < 2U || next >= 0x0ffffff0U || next - 2U >= fat->data_clusters) return 0;
        cluster = next;
    }
    return 0;
}

static int fat32_read_first_sector(const Fat32Probe *fat, uint32_t cluster)
{
    if (cluster < 2U || cluster >= 0x0ffffff8U) return 0;
    return virtio_blk_read_sector(fat_cluster_sector(fat, cluster));
}

static int sector_contains(const char *needle)
{
    uint32_t len = 0;
    while (needle[len]) len++;
    if (len == 0 || len >= 512U) return 0;
    for (uint32_t i = 16; i + len < 528U; i++) {
        uint32_t ok = 1;
        for (uint32_t j = 0; j < len; j++) {
            if (g_dma[i + j] != (unsigned char)needle[j]) {
                ok = 0;
                break;
            }
        }
        if (ok) return 1;
    }
    return 0;
}

static uint32_t fat32_find_sys_apps_file(const Fat32Probe *fat, const char *name11, uint32_t *size_out)
{
    uint32_t sys_cluster = fat32_find_entry_cluster(fat, fat->root_cluster, "SYS        ", 1, 0);
    if (sys_cluster < 2U) return 0;
    uint32_t apps_cluster = fat32_find_entry_cluster(fat, sys_cluster, "APPS       ", 1, 0);
    if (apps_cluster < 2U) return 0;
    return fat32_find_entry_cluster(fat, apps_cluster, name11, 0, size_out);
}

static uint32_t fat32_read_file_into(const Fat32Probe *fat, uint32_t cluster, uint32_t file_size, unsigned char *out, uint32_t cap)
{
    if (cluster < 2U || file_size == 0 || file_size > cap) return 0;
    uint32_t copied = 0;
    uint32_t cur = cluster;
    while (cur >= 2U && cur < 0x0ffffff8U && copied < file_size) {
        uint32_t first_sector = fat_cluster_sector(fat, cur);
        for (uint32_t sec = 0; sec < fat->spc && copied < file_size; sec++) {
            if (!virtio_blk_read_sector(first_sector + sec)) return 0;
            const unsigned char *src = sector_data();
            for (uint32_t i = 0; i < 512U && copied < file_size; i++) {
                out[copied++] = src[i];
            }
        }
        if (copied >= file_size) break;
        cur = fat32_next_cluster(fat, cur);
    }
    return copied;
}

/* --------------------------------------------------------------------------
 * SMF / ELF process helpers
 * -------------------------------------------------------------------------- */

static int bytes_contains(const unsigned char *data, uint32_t len, const char *needle)
{
    uint32_t n = 0;
    while (needle[n]) n++;
    if (n == 0 || n > len) return 0;
    for (uint32_t i = 0; i + n <= len; i++) {
        uint32_t ok = 1;
        for (uint32_t j = 0; j < n; j++) {
            if (data[i + j] != (unsigned char)needle[j]) {
                ok = 0;
                break;
            }
        }
        if (ok) return 1;
    }
    return 0;
}

static uint32_t riscv_unwrap_smf(const unsigned char *file, uint32_t file_size, const unsigned char **elf_out)
{
    if (file_size < 132U) return 0;
    const unsigned char *footer = file + file_size - 128U;
    if (!mem_eq(footer, "SMF", 3U) || footer[3] != 0) return 0;
    uint32_t payload_len = rd32(footer + 52U);
    if (payload_len == 0 || payload_len > file_size - 128U) return 0;
    *elf_out = file;
    return payload_len;
}

static int riscv_smf_probe_file(const char *name11, const char *marker)
{
    Fat32Probe fat;
    if (!fat32_probe_bpb(&fat)) return 0;
    uint32_t file_size = 0;
    uint32_t cluster = fat32_find_sys_apps_file(&fat, name11, &file_size);
    if (cluster < 2U || file_size == 0) return 0;
    if (!fat32_read_first_sector(&fat, cluster)) return 0;
    return sector_contains("SMF") && sector_contains(marker);
}

static int riscv_load_smf_process(const char *name11, const char *marker, uint32_t slot)
{
    Fat32Probe fat;
    if (!fat32_probe_bpb(&fat)) return 0;
    uint32_t file_size = 0;
    uint32_t cluster = fat32_find_sys_apps_file(&fat, name11, &file_size);
    if (cluster < 2U || file_size == 0 || file_size > sizeof(g_riscv_file_buf)) return 0;
    uint32_t read = fat32_read_file_into(&fat, cluster, file_size, g_riscv_file_buf, sizeof(g_riscv_file_buf));
    if (read != file_size) return 0;
    const unsigned char *elf = 0;
    uint32_t elf_size = riscv_unwrap_smf(g_riscv_file_buf, file_size, &elf);
    if (elf_size == 0) return 0;
    return riscv_load_elf_process(elf, elf_size, slot, marker);
}

/* --------------------------------------------------------------------------
 * Runtime API helpers
 * -------------------------------------------------------------------------- */

RuntimeValue serial_println(RuntimeValue value)
{
    if (IS_HEAP(value)) {
        RuntimeString *s = (RuntimeString *)DECODE_PTR(value);
        if (s && s->hdr.type == HEAP_STRING && s->len < 4096U) {
            for (uint32_t i = 0; i < s->len; i++) uart_putc(s->data[i]);
        }
    }
    uart_putc('\r');
    uart_putc('\n');
    return NIL_VALUE;
}

RuntimeValue rt_qemu_exit_success(void)
{
    *(volatile uint32_t *)SIFIVE_TEST_BASE = 0x5555U;
    return NIL_VALUE;
}

RuntimeValue rt_native_eq(RuntimeValue a, RuntimeValue b)
{
    return a == b ? 1 : 0;
}

RuntimeValue rt_native_neq(RuntimeValue a, RuntimeValue b)
{
    return a == b ? 0 : 1;
}

/* --------------------------------------------------------------------------
 * NVFS probe (identical between rv32 and rv64)
 * -------------------------------------------------------------------------- */

RuntimeValue rt_riscv_nvfs_probe(void)
{
    Fat32Probe fat;
    if (!fat32_probe_bpb(&fat)) return 0;
    uint32_t sys_cluster = fat32_find_entry_cluster(&fat, fat.root_cluster, "SYS        ", 1, 0);
    if (sys_cluster < 2U) return 0;
    uint32_t file_size = 0;
    uint32_t nvfs_cluster = fat32_find_entry_cluster(&fat, sys_cluster, "NVFSVER TXT", 0, &file_size);
    if (nvfs_cluster < 2U || file_size == 0) return 0;
    if (!fat32_read_first_sector(&fat, nvfs_cluster)) return 0;
    const char needle[] = "nvfs-image-version=";
    for (uint32_t i = 16; i + sizeof(needle) - 1U < 528U; i++) {
        uint32_t ok = 1;
        for (uint32_t j = 0; j < sizeof(needle) - 1U; j++) {
            if (g_dma[i + j] != (unsigned char)needle[j]) {
                ok = 0;
                break;
            }
        }
        if (ok) return 1;
    }
    return 0;
}

#endif /* RISCV_COMMON_H */
