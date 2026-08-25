/* ---- RV64 filesystem child lifecycle -----------------------------------
 * Load the nonce-patched /FSEXEC.ELF from FAT32, place every admitted PT_LOAD
 * segment in private DRAM pages, enter genuine U-mode with sret, service its
 * byte-write and exit ecalls in S-mode, and return the exact exit status.
 * Sv39 exposes only U-marked ELF/stack pages to the child; kernel/MMIO leaves
 * remain supervisor-only even though OpenSBI's physical PMP region is broad. */
#define RV64_FS_ELF_MAX_FILE_BYTES (64U * 1024U * 1024U)
#define RV64_FS_ELF_MAX_LOAD_BYTES (32U * 1024U * 1024U)
#define RV64_FS_ELF_MAX_PHNUM 64U
#define RV64_FS_ELF_HEADER_BYTES 4096U

/* The filesystem-exec owner leases pages from this arena for exactly one
 * admission/run/reap transaction.  It is deliberately separate from the
 * language runtime heap: a failed ELF admission rolls the arena back without
 * retaining partially mapped pages or starving later kernel allocations. */
static unsigned char g_rv64_fs_exec_arena[RV64_FS_ELF_MAX_LOAD_BYTES]
    __attribute__((aligned(4096)));
static uint32_t g_rv64_fs_exec_arena_used;
static unsigned char g_rv64_fs_exec_header[RV64_FS_ELF_HEADER_BYTES]
    __attribute__((aligned(16)));
static unsigned char g_rv64_fs_exec_header_backup[RV64_FS_ELF_HEADER_BYTES]
    __attribute__((aligned(16)));
static unsigned char g_rv64_fs_exec_test_stack[4096] __attribute__((aligned(4096)));
#define g_rv64_fs_exec_elf g_rv64_fs_exec_header
#define g_rv64_fs_exec_elf_backup g_rv64_fs_exec_header_backup
#define g_rv64_fs_exec_stack g_rv64_fs_exec_test_stack
static Fat32Probe g_rv64_fs_exec_fat;
static uint32_t g_rv64_fs_exec_first_cluster;
static volatile int64_t g_rv64_fs_exec_status;
static volatile uint64_t g_rv64_fs_exec_trap_cause;
static volatile uint64_t g_rv64_fs_exec_trap_sepc, g_rv64_fs_exec_trap_stval;
static uint32_t g_rv64_fs_exec_file_size;
static uint64_t g_rv64_fs_task_generation;
static uint64_t g_rv64_fs_active_generation, g_rv64_fs_active_token;
static uint64_t g_rv64_fs_completed_generation, g_rv64_fs_completed_token;
static uint64_t g_rv64_fs_reaped_generation;
static uint32_t g_rv64_fs_task_state;
static uint32_t g_rv64_fs_reap_auth_ok;

static int rv64_u64_range(uint64_t start, uint64_t size, uint64_t limit);

typedef struct {
    const Fat32Probe *fat;
    uint32_t first_cluster;
    uint32_t file_size;
    const unsigned char *memory;
    uint32_t cached_cluster;
    uint32_t cached_cluster_index;
} Rv64FsElfSource;

extern void rv64_fs_exec_trap_vector(void);
extern void rv64_fs_exec_kernel_return(void);
extern void rv64_fs_exec_user_write_probe(void);
extern void rv64_fs_exec_user_write_fault(void);
extern int64_t rv64_fs_exec_enter(uint64_t entry, uint64_t user_sp, uint64_t satp);

__asm__(
".align 4\n"
".global rv64_fs_exec_enter\n"
"rv64_fs_exec_enter:\n"
"  addi sp, sp, -176\n"
"  sd ra, 0(sp)\n"
"  sd s0, 8(sp)\n"
"  sd s1, 16(sp)\n"
"  sd s2, 24(sp)\n"
"  sd s3, 32(sp)\n"
"  sd s4, 40(sp)\n"
"  sd s5, 48(sp)\n"
"  sd s6, 56(sp)\n"
"  sd s7, 64(sp)\n"
"  sd s8, 72(sp)\n"
"  sd s9, 80(sp)\n"
"  sd s10, 88(sp)\n"
"  sd s11, 96(sp)\n"
"  sd gp, 104(sp)\n"
"  sd tp, 112(sp)\n"
"  csrr t0, satp\n"
"  sd t0, 120(sp)\n"
"  csrr t0, stvec\n"
"  sd t0, 128(sp)\n"
"  csrr t0, sscratch\n"
"  sd t0, 136(sp)\n"
"  csrr t0, sstatus\n"
"  sd t0, 144(sp)\n"
"  csrr t0, sepc\n"
"  sd t0, 152(sp)\n"
"  csrw sscratch, sp\n"
"  la t0, rv64_fs_exec_trap_vector\n"
"  csrw stvec, t0\n"
"  csrw satp, a2\n"
"  sfence.vma zero, zero\n"
"  csrw sepc, a0\n"
"  csrr t0, sstatus\n"
"  li t1, 0x100\n"
"  not t1, t1\n"
"  and t0, t0, t1\n"
"  ori t0, t0, 0x20\n"
"  csrw sstatus, t0\n"
"  li ra, 0\n"
"  li gp, 0\n"
"  li tp, 0\n"
"  li t0, 0\n"
"  li t1, 0\n"
"  li t2, 0\n"
"  li s0, 0\n"
"  li s1, 0\n"
"  li s2, 0\n"
"  li s3, 0\n"
"  li s4, 0\n"
"  li s5, 0\n"
"  li s6, 0\n"
"  li s7, 0\n"
"  li s8, 0\n"
"  li s9, 0\n"
"  li s10, 0\n"
"  li s11, 0\n"
"  li t3, 0\n"
"  li t4, 0\n"
"  li t5, 0\n"
"  li t6, 0\n"
"  mv sp, a1\n"
"  li a0, 0\n"
"  li a1, 0\n"
"  li a2, 0\n"
"  li a3, 0\n"
"  li a4, 0\n"
"  li a5, 0\n"
"  li a6, 0\n"
"  li a7, 0\n"
"  sret\n"
".global rv64_fs_exec_kernel_return\n"
"rv64_fs_exec_kernel_return:\n"
"  ld t0, 120(sp)\n"
"  csrw satp, t0\n"
"  sfence.vma zero, zero\n"
"  ld t0, 128(sp)\n"
"  csrw stvec, t0\n"
"  ld t0, 136(sp)\n"
"  csrw sscratch, t0\n"
"  ld t0, 144(sp)\n"
"  csrw sstatus, t0\n"
"  ld t0, 152(sp)\n"
"  csrw sepc, t0\n"
"  ld ra, 0(sp)\n"
"  ld s0, 8(sp)\n"
"  ld s1, 16(sp)\n"
"  ld s2, 24(sp)\n"
"  ld s3, 32(sp)\n"
"  ld s4, 40(sp)\n"
"  ld s5, 48(sp)\n"
"  ld s6, 56(sp)\n"
"  ld s7, 64(sp)\n"
"  ld s8, 72(sp)\n"
"  ld s9, 80(sp)\n"
"  ld s10, 88(sp)\n"
"  ld s11, 96(sp)\n"
"  ld gp, 104(sp)\n"
"  ld tp, 112(sp)\n"
"  addi sp, sp, 176\n"
"  la t0, g_rv64_fs_exec_status\n"
"  ld a0, 0(t0)\n"
"  ret\n"
".align 4\n"
".global rv64_fs_exec_trap_vector\n"
"rv64_fs_exec_trap_vector:\n"
"  csrrw sp, sscratch, sp\n"
"  addi sp, sp, -24\n"
"  sd t0, 0(sp)\n"
"  sd t1, 8(sp)\n"
"  sd t2, 16(sp)\n"
"  csrr t0, scause\n"
"  la t1, g_rv64_fs_exec_trap_cause\n"
"  sd t0, 0(t1)\n"
"  csrr t0, sepc\n"
"  la t1, g_rv64_fs_exec_trap_sepc\n"
"  sd t0, 0(t1)\n"
"  csrr t0, stval\n"
"  la t1, g_rv64_fs_exec_trap_stval\n"
"  sd t0, 0(t1)\n"
"  csrr t0, scause\n"
"  li t1, 8\n"
"  bne t0, t1, 3f\n"
"  li t0, 60\n"
"  beq a7, t0, 1f\n"
"  beqz a7, 2f\n"
"  j 3f\n"
"1:\n"
"  li t0, 0x10000005\n"
"4: lbu t1, 0(t0)\n"
"  andi t1, t1, 0x20\n"
"  beqz t1, 4b\n"
"  li t0, 0x10000000\n"
"  sb a0, 0(t0)\n"
"  csrr t0, sepc\n"
"  addi t0, t0, 4\n"
"  csrw sepc, t0\n"
"  ld t0, 0(sp)\n"
"  ld t1, 8(sp)\n"
"  ld t2, 16(sp)\n"
"  addi sp, sp, 24\n"
"  csrrw sp, sscratch, sp\n"
"  sret\n"
"2:\n"
"  la t0, g_rv64_fs_exec_status\n"
"  sd a0, 0(t0)\n"
"6:\n"
"  la t0, g_rv64_fs_active_generation\n"
"  ld t1, 0(t0)\n"
"  la t0, g_rv64_fs_completed_generation\n"
"  sd t1, 0(t0)\n"
"  la t0, g_rv64_fs_active_token\n"
"  ld t1, 0(t0)\n"
"  la t0, g_rv64_fs_completed_token\n"
"  sd t1, 0(t0)\n"
"  la t0, g_rv64_fs_task_state\n"
"  li t1, 2\n"
"  sw t1, 0(t0)\n"
"  j 5f\n"
"3:\n"
"  la t0, g_rv64_fs_exec_status\n"
"  li t1, -1\n"
"  sd t1, 0(t0)\n"
"  j 6b\n"
"5:\n"
"  ld t0, 0(sp)\n"
"  ld t1, 8(sp)\n"
"  ld t2, 16(sp)\n"
"  addi sp, sp, 24\n"
"  la t0, rv64_fs_exec_kernel_return\n"
"  csrw sepc, t0\n"
"  csrr t0, sstatus\n"
"  ori t0, t0, 0x100\n"
"  csrw sstatus, t0\n"
"  sret\n"
".align 4\n"
".global rv64_fs_exec_user_write_probe\n"
"rv64_fs_exec_user_write_probe:\n"
"  li t0, 0x80200000\n"
".global rv64_fs_exec_user_write_fault\n"
"rv64_fs_exec_user_write_fault:\n"
"  sd zero, 0(t0)\n"
"  li a0, 99\n"
"  li a7, 0\n"
"  ecall\n"
);

static int rv64_fs_elf_header_valid(const unsigned char *elf)
{
    return mem_eq(elf, "\177ELF", 4U) && elf[4] == 2U && elf[5] == 1U &&
        elf[6] == 1U && rd16(elf + 16U) == 2U && rd16(elf + 18U) == 243U &&
        rd32(elf + 20U) == 1U && rd16(elf + 52U) == 64U;
}

/* Canonical collector evidence nonce.  This is deliberately independent of
 * any workload nonce: /SOSIXNON.TXT is the "SOSIXNONTXT" FAT 8.3 root entry,
 * and it is emitted only after the complete bounded slot validates. */
RuntimeValue rt_sosix_collector_nonce_echo(void)
{
    static const char prefix[] = "SOSIX_COLLECTOR_RUN_NONCE=";
    unsigned char nonce_file[118];
    Fat32Probe fat;
    if (!fat32_probe_bpb(&fat)) return 0;

    uint32_t file_size = 0;
    uint32_t cluster = fat32_find_entry_cluster(
        &fat, fat.root_cluster, "SOSIXNONTXT", 0, &file_size);
    if (cluster < 2U || file_size <= sizeof(prefix) - 1U ||
        file_size > sizeof(nonce_file)) return 0;
    if (fat32_read_file_into(&fat, cluster, file_size, nonce_file,
                             sizeof(nonce_file)) != file_size) return 0;

    for (uint32_t i = 0; i < sizeof(prefix) - 1U; i++) {
        if (nonce_file[i] != (unsigned char)prefix[i]) return 0;
    }
    uint32_t i = sizeof(prefix) - 1U;
    uint32_t nonce_begin = i;
    while (i < file_size && nonce_file[i] != '\n') {
        unsigned char c = nonce_file[i];
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
              (c >= '0' && c <= '9') || c == '.' || c == '_' ||
              c == ':' || c == '-')) return 0;
        i++;
    }
    if (i == nonce_begin || i >= file_size || nonce_file[i] != '\n') return 0;
    uint32_t line_len = i + 1U;
    for (i = line_len; i < file_size; i++) {
        if (nonce_file[i] != 0U) return 0;
    }
    for (i = 0; i < line_len; i++) serial_putchar((char)nonce_file[i]);
    return 1;
}

RuntimeValue rt_riscv_fs_exec_probe(void)
{
    Fat32Probe fat;
    if (!fat32_probe_bpb(&fat)) return 0;
    uint32_t file_size = 0;
    uint32_t cluster = fat32_find_entry_cluster(&fat, fat.root_cluster, "FSEXEC  ELF", 0, &file_size);
    if (cluster < 2U || file_size < 64U || file_size > RV64_FS_ELF_MAX_FILE_BYTES) return 0;
    uint32_t header_bytes = file_size < sizeof(g_rv64_fs_exec_header) ?
        file_size : sizeof(g_rv64_fs_exec_header);
    if (fat32_read_file_into(&fat, cluster, header_bytes, g_rv64_fs_exec_header,
                             sizeof(g_rv64_fs_exec_header)) != header_bytes) return 0;
    if (!rv64_fs_elf_header_valid(g_rv64_fs_exec_header)) return 0;
    g_rv64_fs_exec_fat = fat;
    g_rv64_fs_exec_first_cluster = cluster;
    g_rv64_fs_exec_file_size = file_size;
    return 1;
}

static void rv64_fs_puts(const char *s)
{
    while (*s) uart_putc(*s++);
}

static int rv64_fat_next_checked(const Fat32Probe *fat, uint32_t cluster,
                                 uint32_t *next_out)
{
    uint64_t fat_offset = (uint64_t)cluster * 4U;
    uint64_t fat_bytes = (uint64_t)fat->fat_size * 512U;
    if (fat_offset + 4U > fat_bytes) return 0;
    uint32_t sector = fat->reserved + (uint32_t)(fat_offset / 512U);
    uint32_t offset = (uint32_t)(fat_offset % 512U);
    if (!virtio_blk_read_sector(sector)) return 0;
    *next_out = rd32(sector_data() + offset) & 0x0fffffffU;
    return 1;
}

/* Read an exact byte range without materializing the full executable.  Every
 * FAT transition is bounded by the volume's data-cluster count, so a cyclic or
 * malformed chain cannot turn admission into an unbounded traversal. */
static int rv64_fat_read_range(const Fat32Probe *fat, uint32_t first_cluster,
                               uint32_t file_size, uint64_t offset,
                               unsigned char *out, uint32_t length,
                               uint32_t *cached_cluster,
                               uint32_t *cached_cluster_index)
{
    if (!fat || !out || first_cluster < 2U ||
        !rv64_u64_range(offset, length, file_size)) return 0;
    if (length == 0U) return 1;
    uint64_t cluster_bytes = (uint64_t)fat->spc * 512U;
    if (cluster_bytes == 0U) return 0;
    uint64_t target_cluster_index = offset / cluster_bytes;
    uint64_t skip_clusters = target_cluster_index;
    uint32_t cluster = first_cluster;
    if (cached_cluster && cached_cluster_index && *cached_cluster >= 2U &&
        *cached_cluster_index <= target_cluster_index) {
        cluster = *cached_cluster;
        skip_clusters = target_cluster_index - *cached_cluster_index;
    }
    uint32_t transitions = 0;
    while (skip_clusters-- > 0U) {
        uint32_t next = 0;
        if (++transitions > fat->data_clusters ||
            !rv64_fat_next_checked(fat, cluster, &next) ||
            next < 2U || next >= 0x0ffffff0U ||
            next - 2U >= fat->data_clusters) return 0;
        cluster = next;
    }
    if (cached_cluster && cached_cluster_index) {
        *cached_cluster = cluster;
        *cached_cluster_index = (uint32_t)target_cluster_index;
    }
    uint32_t inside_cluster = (uint32_t)(offset % cluster_bytes);
    uint32_t copied = 0;
    while (copied < length) {
        if (cluster < 2U || cluster >= 0x0ffffff0U ||
            cluster - 2U >= fat->data_clusters) return 0;
        uint32_t first_sector = fat_cluster_sector(fat, cluster);
        for (uint32_t sec = inside_cluster / 512U;
             sec < fat->spc && copied < length; sec++) {
            if (!virtio_blk_read_sector(first_sector + sec)) return 0;
            uint32_t begin = sec == inside_cluster / 512U ? inside_cluster % 512U : 0U;
            uint32_t take = 512U - begin;
            if (take > length - copied) take = length - copied;
            memcpy(out + copied, sector_data() + begin, take);
            copied += take;
        }
        inside_cluster = 0U;
        if (copied == length) break;
        uint32_t next = 0;
        if (++transitions > fat->data_clusters ||
            !rv64_fat_next_checked(fat, cluster, &next) ||
            next < 2U || next >= 0x0ffffff0U ||
            next - 2U >= fat->data_clusters) return 0;
        cluster = next;
    }
    return 1;
}

RuntimeValue rt_riscv_fs_list_apps(void)
{
    Fat32Probe fat;
    if (!fat32_probe_bpb(&fat)) return 0;
    if (!virtio_blk_read_sector(0)) return 0;
    const unsigned char *bpb = sector_data();
    uint64_t total_sectors = rd16(bpb + 19U);
    if (total_sectors == 0) total_sectors = rd32(bpb + 32U);
    uint64_t metadata_sectors = (uint64_t)fat.reserved + (uint64_t)fat.fats * fat.fat_size;
    if (fat.spc == 0 || total_sectors <= metadata_sectors) return 0;
    uint64_t data_clusters = (total_sectors - metadata_sectors) / fat.spc;
    if (data_clusters == 0 || data_clusters > 0xffffffffU - 2U) return 0;
    uint32_t sys = fat32_find_entry_cluster(&fat, fat.root_cluster, "SYS        ", 1, 0);
    uint32_t apps = sys >= 2U ? fat32_find_entry_cluster(&fat, sys, "APPS       ", 1, 0) : 0;
    if (apps < 2U) return 0;
    uint32_t count = 0, cluster = apps, chain_steps = 0;
    uint32_t cluster_limit = (uint32_t)data_clusters + 2U;
    uint32_t entries_done = 0, valid_eoc = 0;
    rv64_fs_puts("FS_LS_BEGIN path=/SYS/APPS\r\n");
    while (cluster >= 2U && cluster < 0x0ffffff0U) {
        if (++chain_steps > cluster_limit) return 0;
        if (!entries_done) {
            uint32_t first = fat_cluster_sector(&fat, cluster);
            for (uint32_t sec = 0; sec < fat.spc && !entries_done; sec++) {
                if (!virtio_blk_read_sector(first + sec)) return 0;
                const unsigned char *data = sector_data();
                for (uint32_t off = 0; off < 512U; off += 32U) {
                    const unsigned char *e = data + off;
                    if (e[0] == 0x00U) { entries_done = 1; break; }
                    if (e[0] == 0xe5U || e[11] == 0x0fU) continue;
                    rv64_fs_puts("FS_LS_ENTRY name=");
                    for (uint32_t i = 0; i < 8U && e[i] != ' '; i++) uart_putc((char)e[i]);
                    if (e[8] != ' ') {
                        uart_putc('.');
                        for (uint32_t i = 8U; i < 11U && e[i] != ' '; i++) uart_putc((char)e[i]);
                    }
                    rv64_fs_puts("\r\n");
                    count++;
                }
            }
        }
        uint32_t next = 0;
        if (!rv64_fat_next_checked(&fat, cluster, &next)) return 0;
        if (next >= 0x0ffffff8U) { valid_eoc = 1; break; }
        if (next < 2U || next >= 0x0ffffff0U) return 0;
        cluster = next;
    }
    if (!valid_eoc) return 0;
    rv64_fs_puts("FS_LS_END status=pass\r\n");
    return (RuntimeValue)count;
}

