static uint64_t rv64_elf_u64(const unsigned char *p)
{
    return (uint64_t)rd32(p) | ((uint64_t)rd32(p + 4U) << 32);
}

static void rv64_elf_put_u32(unsigned char *p, uint32_t value)
{
    p[0] = value; p[1] = value >> 8; p[2] = value >> 16; p[3] = value >> 24;
}

static void rv64_elf_put_u64(unsigned char *p, uint64_t value)
{
    rv64_elf_put_u32(p, (uint32_t)value);
    rv64_elf_put_u32(p + 4U, (uint32_t)(value >> 32));
}

static int rv64_u64_range(uint64_t start, uint64_t size, uint64_t limit)
{
    return start <= limit && size <= limit - start;
}

static void *rv64_fs_arena_alloc(uint32_t bytes, uint32_t alignment)
{
    if (alignment == 0U || (alignment & (alignment - 1U)) != 0U) return 0;
    uint64_t begin = ((uint64_t)g_rv64_fs_exec_arena_used + alignment - 1U) &
        ~((uint64_t)alignment - 1U);
    if (begin > sizeof(g_rv64_fs_exec_arena) ||
        bytes > sizeof(g_rv64_fs_exec_arena) - begin) return 0;
    unsigned char *result = g_rv64_fs_exec_arena + begin;
    g_rv64_fs_exec_arena_used = (uint32_t)(begin + bytes);
    rv_memzero(result, bytes);
    return result;
}

static uint64_t *rv64_pt_alloc(void)
{
    return (uint64_t *)rv64_fs_arena_alloc(4096U, 4096U);
}

static uint64_t rv64_pt_pte(uint64_t pa, uint64_t flags)
{
    return ((pa >> 12) << 10) | flags;
}

static int rv64_pt_map_4k(uint64_t *root, uint64_t va, uint64_t pa, uint64_t flags)
{
    uint64_t *table = root;
    for (int level = 2; level > 0; level--) {
        uint64_t index = (va >> (12 + level * 9)) & 511U;
        if ((table[index] & 1U) != 0 && (table[index] & (2U | 4U | 8U)) != 0) return 0;
        if ((table[index] & 1U) == 0) {
            uint64_t *next = rv64_pt_alloc();
            if (!next) return 0;
            table[index] = rv64_pt_pte((uint64_t)(uintptr_t)next, 1U);
        }
        table = (uint64_t *)(uintptr_t)(((table[index] >> 10) << 12));
    }
    uint64_t index = (va >> 12) & 511U;
    if (table[index] & 1U) return 0;
    table[index] = rv64_pt_pte(pa, flags | 1U | 64U | 128U);
    return 1;
}

static uint64_t *rv64_fs_address_space(void)
{
    uint64_t *root = rv64_pt_alloc();
    if (!root) return 0;
    /* One supervisor-only 1 GiB leaf covers the kernel, its stack and trap. */
    root[2] = rv64_pt_pte(0x80000000ULL, 1U | 2U | 4U | 8U | 64U | 128U);
    if (!rv64_pt_map_4k(root, UART_BASE, UART_BASE, 2U | 4U)) return 0;
    if (!rv64_pt_map_4k(root, SIFIVE_TEST_BASE, SIFIVE_TEST_BASE, 2U | 4U)) return 0;
    return root;
}

static int rv64_fs_elf_read(Rv64FsElfSource *source, uint64_t offset,
                            unsigned char *out, uint32_t length)
{
    if (!source || !rv64_u64_range(offset, length, source->file_size)) return 0;
    if (source->memory) {
        memcpy(out, source->memory + offset, length);
        return 1;
    }
    return rv64_fat_read_range(source->fat, source->first_cluster,
                               source->file_size, offset, out, length,
                               &source->cached_cluster,
                               &source->cached_cluster_index);
}

static int rv64_fs_map_user_elf_source(uint64_t *root, Rv64FsElfSource *source,
                                       uint64_t *entry_out)
{
    uint32_t checkpoint = g_rv64_fs_exec_arena_used;
    unsigned char elf_header[64];
    unsigned char ph_table[RV64_FS_ELF_MAX_PHNUM * 56U];
    if (!rv64_fs_elf_read(source, 0U, elf_header, sizeof(elf_header)) ||
        !rv64_fs_elf_header_valid(elf_header)) goto fail;
    uint64_t entry = rv64_elf_u64(elf_header + 24U);
    uint64_t phoff = rv64_elf_u64(elf_header + 32U);
    uint16_t phentsize = rd16(elf_header + 54U);
    uint16_t phnum = rd16(elf_header + 56U);
    if (phentsize != 56U || phnum == 0U || phnum > RV64_FS_ELF_MAX_PHNUM ||
        !rv64_u64_range(phoff, (uint64_t)phentsize * phnum, source->file_size) ||
        !rv64_fs_elf_read(source, phoff, ph_table, (uint32_t)phentsize * phnum)) goto fail;
    uint64_t ranges_start[RV64_FS_ELF_MAX_PHNUM], ranges_end[RV64_FS_ELF_MAX_PHNUM];
    uint32_t range_count = 0, entry_exec = 0;
    uint64_t admitted_load_bytes = 0;
    for (uint16_t i = 0; i < phnum; i++) {
        const unsigned char *ph = ph_table + (uint32_t)i * phentsize;
        if (rd32(ph) != 1U) continue;
        uint32_t flags = rd32(ph + 4U);
        uint64_t offset = rv64_elf_u64(ph + 8U), vaddr = rv64_elf_u64(ph + 16U);
        uint64_t filesz = rv64_elf_u64(ph + 32U), memsz = rv64_elf_u64(ph + 40U);
        uint64_t align = rv64_elf_u64(ph + 48U);
        if (memsz == 0 || memsz < filesz || !rv64_u64_range(offset, filesz, source->file_size) ||
            !rv64_u64_range(vaddr, memsz, (1ULL << 38)) ||
            vaddr >= 0x80000000ULL ||
            (vaddr < UART_BASE + 4096U && UART_BASE < vaddr + memsz) ||
            (vaddr < SIFIVE_TEST_BASE + 4096U && SIFIVE_TEST_BASE < vaddr + memsz) ||
            (align && ((align & (align - 1U)) || ((vaddr - offset) & (align - 1U)))) ||
            ((flags & 2U) && (flags & 1U))) goto fail;
        uint64_t end = vaddr + memsz;
        for (uint32_t r = 0; r < range_count; r++)
            if (vaddr < ranges_end[r] && ranges_start[r] < end) goto fail;
        ranges_start[range_count] = vaddr; ranges_end[range_count++] = end;
        if ((flags & 1U) && entry >= vaddr && entry < end) entry_exec = 1;
        uint64_t first = vaddr & ~0xfffULL, last = (end + 0xfffU) & ~0xfffULL;
        uint64_t segment_pages = (last - first) / 4096U;
        if (segment_pages > RV64_FS_ELF_MAX_LOAD_BYTES / 4096U ||
            admitted_load_bytes > RV64_FS_ELF_MAX_LOAD_BYTES - segment_pages * 4096U) goto fail;
        admitted_load_bytes += segment_pages * 4096U;
        for (uint64_t page = first; page < last; page += 4096U) {
            unsigned char *dst = (unsigned char *)rv64_fs_arena_alloc(4096U, 4096U);
            if (!dst) goto fail;
            uint64_t copy_start = page > vaddr ? page : vaddr;
            uint64_t file_end = vaddr + filesz;
            uint64_t copy_end = page + 4096U < file_end ? page + 4096U : file_end;
            if (copy_end > copy_start &&
                !rv64_fs_elf_read(source, offset + (copy_start - vaddr),
                                  dst + (copy_start - page),
                                  (uint32_t)(copy_end - copy_start))) goto fail;
            uint64_t pte = 16U | 2U;
            if (flags & 2U) pte |= 4U;
            if (flags & 1U) pte |= 8U;
            if (!rv64_pt_map_4k(root, page, (uint64_t)(uintptr_t)dst, pte)) goto fail;
        }
    }
    if (!entry_exec) goto fail;
    unsigned char *stack = (unsigned char *)rv64_fs_arena_alloc(4096U, 4096U);
    if (!stack) goto fail;
    if (!rv64_pt_map_4k(root, 0x40000000ULL,
                        (uint64_t)(uintptr_t)stack, 16U | 2U | 4U)) goto fail;
    *entry_out = entry;
    return 1;
fail:
    g_rv64_fs_exec_arena_used = checkpoint;
    return 0;
}

/* Mutation tests intentionally use the bounded header snapshot. */
static int rv64_fs_map_user_elf(uint64_t *root, uint64_t file_size,
                                uint64_t *entry_out)
{
    if (file_size > sizeof(g_rv64_fs_exec_header)) return 0;
    Rv64FsElfSource source = {
        .fat = 0, .first_cluster = 0, .file_size = (uint32_t)file_size,
        .memory = g_rv64_fs_exec_header, .cached_cluster = 0,
        .cached_cluster_index = 0
    };
    return rv64_fs_map_user_elf_source(root, &source, entry_out);
}

RuntimeValue rt_riscv_fs_exec_malformed_selftest(void)
{
    g_rv64_fs_exec_arena_used = 0U;
    if (!rt_riscv_fs_exec_probe()) return 0;
    if (g_rv64_fs_exec_file_size > sizeof(g_rv64_fs_exec_header)) return 1;
    uint64_t ignored = 0;
    uint64_t *clean_root = rv64_fs_address_space();
    if (!clean_root || !rv64_fs_map_user_elf(clean_root, g_rv64_fs_exec_file_size, &ignored)) return 0;
    for (uint32_t i = 0; i < sizeof(g_rv64_fs_exec_elf); i++)
        g_rv64_fs_exec_elf_backup[i] = g_rv64_fs_exec_elf[i];
    const uint32_t identity_offsets[] = {4U, 5U, 6U, 16U, 18U, 20U, 52U};
    for (uint32_t i = 0; i < sizeof(identity_offsets) / sizeof(identity_offsets[0]); i++) {
        uint32_t at = identity_offsets[i];
        g_rv64_fs_exec_elf[at] ^= 0x7fU;
        if (rv64_fs_elf_header_valid(g_rv64_fs_exec_elf)) return 0;
        memcpy(g_rv64_fs_exec_elf, g_rv64_fs_exec_elf_backup, sizeof(g_rv64_fs_exec_elf));
    }
    uint64_t original_phoff = rv64_elf_u64(g_rv64_fs_exec_elf + 32U);
    uint16_t phentsize = rd16(g_rv64_fs_exec_elf + 54U), phnum = rd16(g_rv64_fs_exec_elf + 56U);
    unsigned char *first = 0, *second = 0;
    for (uint16_t i = 0; i < phnum; i++) {
        unsigned char *ph = g_rv64_fs_exec_elf + original_phoff + (uint64_t)i * phentsize;
        if (rd32(ph) == 1U) { if (!first) first = ph; else if (!second) second = ph; }
    }
    if (!first || !second) return 0;
    rv64_elf_put_u64(g_rv64_fs_exec_elf + 32U, ~(uint64_t)0);
    if (rv64_fs_map_user_elf(rv64_fs_address_space(), g_rv64_fs_exec_file_size, &ignored)) return 0;
    memcpy(g_rv64_fs_exec_elf, g_rv64_fs_exec_elf_backup, sizeof(g_rv64_fs_exec_elf));
    /* Locate afresh after restore; pointers above referred to the same base. */
    first = second = 0;
    for (uint16_t i = 0; i < phnum; i++) {
        unsigned char *ph = g_rv64_fs_exec_elf + original_phoff + (uint64_t)i * phentsize;
        if (rd32(ph) == 1U) { if (!first) first = ph; else if (!second) second = ph; }
    }
    rv64_elf_put_u64(first + 40U, 0U);
    if (rv64_fs_map_user_elf(rv64_fs_address_space(), g_rv64_fs_exec_file_size, &ignored)) return 0;
    memcpy(g_rv64_fs_exec_elf, g_rv64_fs_exec_elf_backup, sizeof(g_rv64_fs_exec_elf));
    /* Reject W+X independently of the segment's original permissions. */
    for (uint16_t i = 0; i < phnum; i++) {
        unsigned char *ph = g_rv64_fs_exec_elf + original_phoff + (uint64_t)i * phentsize;
        if (rd32(ph) == 1U) { first = ph; break; }
    }
    rv64_elf_put_u32(first + 4U, rd32(first + 4U) | 3U);
    if (rv64_fs_map_user_elf(rv64_fs_address_space(), g_rv64_fs_exec_file_size, &ignored)) return 0;
    memcpy(g_rv64_fs_exec_elf, g_rv64_fs_exec_elf_backup, sizeof(g_rv64_fs_exec_elf));
    rv64_elf_put_u64(g_rv64_fs_exec_elf + 24U, 0U);
    if (rv64_fs_map_user_elf(rv64_fs_address_space(), g_rv64_fs_exec_file_size, &ignored)) return 0;
    memcpy(g_rv64_fs_exec_elf, g_rv64_fs_exec_elf_backup, sizeof(g_rv64_fs_exec_elf));
    for (uint16_t i = 0; i < phnum; i++) {
        unsigned char *ph = g_rv64_fs_exec_elf + original_phoff + (uint64_t)i * phentsize;
        if (rd32(ph) == 1U) { rv64_elf_put_u64(ph + 48U, 3U); break; }
    }
    if (rv64_fs_map_user_elf(rv64_fs_address_space(), g_rv64_fs_exec_file_size, &ignored)) return 0;
    memcpy(g_rv64_fs_exec_elf, g_rv64_fs_exec_elf_backup, sizeof(g_rv64_fs_exec_elf));
    first = second = 0;
    for (uint16_t i = 0; i < phnum; i++) {
        unsigned char *ph = g_rv64_fs_exec_elf + original_phoff + (uint64_t)i * phentsize;
        if (rd32(ph) == 1U) { if (!first) first = ph; else if (!second) second = ph; }
    }
    rv64_elf_put_u64(second + 16U, rv64_elf_u64(first + 16U));
    rv64_elf_put_u64(second + 48U, 1U);
    if (rv64_fs_map_user_elf(rv64_fs_address_space(), g_rv64_fs_exec_file_size, &ignored)) return 0;
    memcpy(g_rv64_fs_exec_elf, g_rv64_fs_exec_elf_backup, sizeof(g_rv64_fs_exec_elf));
    for (uint16_t i = 0; i < phnum; i++) {
        unsigned char *ph = g_rv64_fs_exec_elf + original_phoff + (uint64_t)i * phentsize;
        if (rd32(ph) == 1U) { rv64_elf_put_u64(ph + 16U, 0x80000000ULL); break; }
    }
    rv64_elf_put_u64(g_rv64_fs_exec_elf + 24U, 0x80000000ULL);
    if (rv64_fs_map_user_elf(rv64_fs_address_space(), g_rv64_fs_exec_file_size, &ignored)) return 0;
    memcpy(g_rv64_fs_exec_elf, g_rv64_fs_exec_elf_backup, sizeof(g_rv64_fs_exec_elf));
    for (uint16_t i = 0; i < phnum; i++) {
        unsigned char *ph = g_rv64_fs_exec_elf + original_phoff + (uint64_t)i * phentsize;
        if (rd32(ph) == 1U) { rv64_elf_put_u64(ph + 16U, UART_BASE); break; }
    }
    rv64_elf_put_u64(g_rv64_fs_exec_elf + 24U, UART_BASE);
    if (rv64_fs_map_user_elf(rv64_fs_address_space(), g_rv64_fs_exec_file_size, &ignored)) return 0;
    memcpy(g_rv64_fs_exec_elf, g_rv64_fs_exec_elf_backup, sizeof(g_rv64_fs_exec_elf));
    uint64_t *leaf_root = rv64_fs_address_space();
    if (!leaf_root) return 0;
    leaf_root[0] = rv64_pt_pte(0, 1U | 2U | 8U);
    if (rv64_pt_map_4k(leaf_root, 0x1000U,
                       (uint64_t)(uintptr_t)g_rv64_fs_exec_stack, 16U | 2U)) return 0;
    return 1;
}

RuntimeValue rt_riscv_fs_exec_privilege_selftest(void)
{
    g_rv64_fs_exec_arena_used = 0U;
    uint64_t *root = rv64_fs_address_space();
    if (!root || !rv64_pt_map_4k(root, 0x40000000ULL,
            (uint64_t)(uintptr_t)g_rv64_fs_exec_stack, 16U | 2U | 4U)) return 0;
    uint64_t probe_pa = (uint64_t)(uintptr_t)rv64_fs_exec_user_write_probe;
    uint64_t probe_va = 0x50000000ULL + (probe_pa & 0xfffU);
    if (!rv64_pt_map_4k(root, 0x50000000ULL, probe_pa & ~0xfffULL,
                        16U | 2U | 8U)) return 0;
    uint64_t satp = (8ULL << 60) | ((uint64_t)(uintptr_t)root >> 12);
    g_rv64_fs_exec_status = -1;
    g_rv64_fs_exec_trap_cause = 0;
    g_rv64_fs_exec_trap_sepc = 0;
    g_rv64_fs_exec_trap_stval = 0;
    g_rv64_fs_active_generation = 0;
    g_rv64_fs_active_token = 0x5256363450524f42ULL;
    g_rv64_fs_task_state = 1;
    uint64_t satp_before, stvec_before, sscratch_before, sstatus_before, sepc_before;
    uint64_t saved_gp, saved_tp;
    __asm__ volatile("mv %0, gp" : "=r"(saved_gp));
    __asm__ volatile("mv %0, tp" : "=r"(saved_tp));
    __asm__ volatile("csrr %0, satp" : "=r"(satp_before));
    __asm__ volatile("csrr %0, stvec" : "=r"(stvec_before));
    __asm__ volatile("csrr %0, sscratch" : "=r"(sscratch_before));
    __asm__ volatile("csrr %0, sstatus" : "=r"(sstatus_before));
    __asm__ volatile("csrr %0, sepc" : "=r"(sepc_before));
    __asm__ volatile("fence.i" ::: "memory");
    rv64_fs_exec_enter(probe_va, 0x40001000ULL, satp);
    uint64_t satp_after, stvec_after, sscratch_after, sstatus_after, sepc_after;
    uint64_t gp_after, tp_after;
    __asm__ volatile("mv %0, gp" : "=r"(gp_after));
    __asm__ volatile("mv %0, tp" : "=r"(tp_after));
    __asm__ volatile("csrr %0, satp" : "=r"(satp_after));
    __asm__ volatile("csrr %0, stvec" : "=r"(stvec_after));
    __asm__ volatile("csrr %0, sscratch" : "=r"(sscratch_after));
    __asm__ volatile("csrr %0, sstatus" : "=r"(sstatus_after));
    __asm__ volatile("csrr %0, sepc" : "=r"(sepc_after));
    uint64_t fault_va = 0x50000000ULL +
        ((uint64_t)(uintptr_t)rv64_fs_exec_user_write_fault & 0xfffU);
    int valid = g_rv64_fs_exec_trap_cause == 15U && g_rv64_fs_exec_trap_sepc == fault_va &&
        g_rv64_fs_exec_trap_stval == 0x80200000ULL && satp_after == satp_before &&
        stvec_after == stvec_before && sscratch_after == sscratch_before &&
        sstatus_after == sstatus_before && sepc_after == sepc_before &&
        gp_after == saved_gp && tp_after == saved_tp && g_rv64_fs_task_state == 2U &&
        g_rv64_fs_completed_generation == 0 &&
        g_rv64_fs_completed_token == 0x5256363450524f42ULL;
    g_rv64_fs_task_state = 0;
    g_rv64_fs_completed_generation = 0;
    g_rv64_fs_completed_token = 0;
    return valid;
}

RuntimeValue rt_riscv_fs_reaped_generation(void)
{
    return (RuntimeValue)g_rv64_fs_reaped_generation;
}

RuntimeValue rt_riscv_fs_reap_auth_ok(void)
{
    return (RuntimeValue)g_rv64_fs_reap_auth_ok;
}

RuntimeValue rt_riscv_fs_last_trap_cause(void)
{
    return (RuntimeValue)g_rv64_fs_exec_trap_cause;
}
RuntimeValue rt_riscv_fs_last_trap_sepc(void) { return (RuntimeValue)g_rv64_fs_exec_trap_sepc; }
RuntimeValue rt_riscv_fs_last_trap_stval(void) { return (RuntimeValue)g_rv64_fs_exec_trap_stval; }

/* Exact-once completion ownership remains here even while the public legacy
 * execution entry fails closed below.  The authenticated scheduler path and
 * its negative probes share this generation/token transition contract. */
static int rv64_fs_reap(uint64_t generation, uint64_t token, int64_t *status)
{
    if (g_rv64_fs_task_state != 2U || g_rv64_fs_completed_generation != generation ||
        g_rv64_fs_completed_token != token || g_rv64_fs_reaped_generation == generation) return 0;
    *status = g_rv64_fs_exec_status;
    g_rv64_fs_task_state = 0;
    g_rv64_fs_completed_generation = 0;
    g_rv64_fs_completed_token = 0;
    g_rv64_fs_reaped_generation = generation;
    return 1;
}

RuntimeValue rt_riscv_fs_exec_run(void)
{
    /* Production must not execute writable legacy media.  This parser remains
     * available for bounded structural testing only until the canonical loader
     * hands this owner an authority token bound to digest, mount/file identity,
     * and content generation. */
    return (RuntimeValue)-13;
}

RuntimeValue rt_riscv_fs_legacy_exec_disabled(void)
{
    return 1;
}
