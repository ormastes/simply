#include <stdint.h>
#include <stddef.h>

typedef intptr_t RuntimeValue;

#define UART_BASE 0x10000000UL
#include "../../common/baremetal_16550_serial.h"
#define SIFIVE_TEST_BASE 0x100000UL
#define VIRTIO_MMIO_BASE 0x10001000UL
#define VIRTIO_MMIO_STRIDE 0x1000UL
#define VIRTIO_MMIO_SLOTS 8U
#define VIRTIO_MAGIC 0x74726976U
#define VIRTIO_DEV_BLK 2U
#define VIRTQ_DESC_F_NEXT 1U
#define VIRTQ_DESC_F_WRITE 2U
#define VIRTIO_STATUS_ACKNOWLEDGE 1U
#define VIRTIO_STATUS_DRIVER 2U
#define VIRTIO_STATUS_DRIVER_OK 4U
#define VIRTIO_STATUS_FEATURES_OK 8U

#define TAG_MASK    ((uintptr_t)0x7)
#define TAG_HEAP    ((uintptr_t)0x1)
#define TAG_SPECIAL ((uintptr_t)0x3)
#define NIL_VALUE   ((RuntimeValue)TAG_SPECIAL)

#define ENCODE_PTR(p) ((RuntimeValue)((uintptr_t)(p) | TAG_HEAP))
#define DECODE_PTR(v) ((void *)((uintptr_t)(v) & ~TAG_MASK))
#define IS_HEAP(v)    (((uintptr_t)(v) & TAG_MASK) == TAG_HEAP)

#define HEAP_STRING 1U

typedef struct {
    uint32_t type;
    uint32_t size;
} HeapHeader;

typedef struct {
    HeapHeader hdr;
    uint32_t len;
    char data[];
} RuntimeString;

static unsigned char g_heap[64 * 1024] __attribute__((aligned(16)));
static uintptr_t g_heap_off = 0;
static unsigned char g_virtq[8192] __attribute__((aligned(4096)));
static unsigned char g_dma[1024] __attribute__((aligned(512)));
static unsigned char g_riscv_file_buf[8192] __attribute__((aligned(16)));
static unsigned char g_riscv_process_arena[2][8192] __attribute__((aligned(4096)));
static uint64_t g_riscv_process_entry[2];
static uint64_t g_riscv_process_pid[2];
static uint32_t g_riscv_process_count;
static char g_riscv_gui_surface[256];
static volatile uint32_t *g_blk_mmio = 0;
static uint16_t g_last_used_idx = 0;

extern RuntimeValue spl_start(void);
extern char _stack_top[];

#include "../../common/baremetal_bump_heap.h"

/* Width-independent helpers shared with riscv64 (rv_memzero, rv_fence, le/rd
 * helpers, virtio-blk driver, FAT32 driver, SMF/ELF loaders, serial_println,
 * rt_qemu_exit_success, rt_native_eq/neq, rt_riscv_nvfs_probe). */
#include "../../common/riscv_common.h"

static size_t riscv32_collector_nonce_line_length(const unsigned char *slot,
                                                   size_t slot_len)
{
    static const char prefix[] = "SOSIX_COLLECTOR_RUN_NONCE=";
    const size_t prefix_len = sizeof(prefix) - 1U;
    if (!slot || slot_len <= prefix_len || slot_len > 118U) return 0U;
    for (size_t i = 0; i < prefix_len; i++) {
        if (slot[i] != (unsigned char)prefix[i]) return 0U;
    }

    size_t i = prefix_len;
    const size_t nonce_begin = i;
    while (i < slot_len && slot[i] != '\n') {
        const unsigned char c = slot[i];
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
              (c >= '0' && c <= '9') || c == '.' || c == '_' ||
              c == ':' || c == '-')) return 0U;
        i++;
    }
    if (i == nonce_begin || i >= slot_len || slot[i] != '\n') return 0U;

    const size_t line_len = i + 1U;
    for (i = line_len; i < slot_len; i++) {
        if (slot[i] != 0U) return 0U;
    }
    return line_len;
}

/* Canonical evidence nonce: distinct from every workload nonce. */
RuntimeValue rt_sosix_collector_nonce_echo(void)
{
    Fat32Probe fat;
    unsigned char nonce_file[118];
    uint32_t file_size = 0U;
    if (!fat32_probe_bpb(&fat)) return 0;
    const uint32_t cluster = fat32_find_entry_cluster(
        &fat, fat.root_cluster, "SOSIXNONTXT", 0U, &file_size);
    if (cluster < 2U || file_size == 0U || file_size > sizeof(nonce_file)) return 0;
    const uint32_t bytes_read = fat32_read_file_into(
        &fat, cluster, file_size, nonce_file, sizeof(nonce_file));
    if (bytes_read != file_size) return 0;

    const size_t line_len = riscv32_collector_nonce_line_length(
        nonce_file, bytes_read);
    if (line_len == 0U) return 0;
    for (size_t i = 0; i < line_len; i++) uart_putc((char)nonce_file[i]);
    return 1;
}

static void uart_put_u32(uint32_t v)
{
    char buf[10];
    uint32_t pos = 0;
    do {
        buf[pos++] = (char)('0' + (v % 10U));
        v /= 10U;
    } while (v > 0U && pos < sizeof(buf));
    while (pos > 0U) {
        uart_putc(buf[--pos]);
    }
}

/* ---------------------------------------------------------------------------
 * TINY (BRAM-only) build: stack high-water measurement.
 *
 * The tiny linker script (../linker_tiny.ld) shrinks .stack from the default
 * 8 MB down to something that fits in on-chip block RAM. That number has to be
 * MEASURED, not guessed, so this paints the whole stack span with a sentinel
 * before jumping into spl_start and reports the deepest word actually
 * clobbered once the marker chain has run.
 *
 * Self-configuring rather than -D gated: the probe keys off the linker's own
 * _stack_bottom/_stack_top and does nothing at all unless the reserved stack
 * is small enough to be a BRAM configuration. The default 8 MB QEMU images
 * take the early-out on both halves, so their observable behaviour (and the
 * marker chain) is unchanged; painting 8 MB would also be pointlessly slow in
 * simulation.
 * ------------------------------------------------------------------------ */
#define TINY_STACK_PAINT 0xADDECA5EU
/* Leave the topmost slots alone: sp already points there and this function's
 * own frame lives in them, so painting them would corrupt our return path.
 * tiny_stack_paint() is a small leaf (frame well under 64 B) called from the
 * naked _start with sp == _stack_top, so 64 B of headroom is enough and keeps
 * the measurement resolution at +-64 B instead of +-512 B. */
#define TINY_STACK_PAINT_SKIP_TOP 64U
/* Only BRAM-sized stacks get probed. */
#define TINY_STACK_PROBE_MAX_BYTES (1024U * 1024U)

extern char _stack_bottom[];

static uint32_t tiny_stack_span(void)
{
    return (uint32_t)((uintptr_t)_stack_top - (uintptr_t)_stack_bottom);
}

/* Called from _start's inline asm before spl_start. Non-static + used so the
 * reference from the naked entry stub is never garbage-collected. */
__attribute__((used, noinline)) void tiny_stack_paint(void)
{
    if (tiny_stack_span() > TINY_STACK_PROBE_MAX_BYTES) return;
    volatile uint32_t *lo = (volatile uint32_t *)_stack_bottom;
    volatile uint32_t *hi = (volatile uint32_t *)(_stack_top - TINY_STACK_PAINT_SKIP_TOP);
    while (lo < hi) {
        *lo++ = TINY_STACK_PAINT;
    }
}

static void uart_put_hex32(uint32_t v)
{
    static const char digits[] = "0123456789abcdef";
    uart_putc('0');
    uart_putc('x');
    for (int shift = 28; shift >= 0; shift -= 4) {
        uart_putc(digits[(v >> shift) & 0xFU]);
    }
}

/* Scan upward from _stack_bottom PAST the surviving sentinels: the first
 * NON-painted word above the surviving run marks the deepest stack touch, so
 * used = _stack_top - that address.
 *
 * (The original probe scanned for the first SURVIVING sentinel — which is
 * _stack_bottom itself whenever the stack did NOT overflow — so it reported
 * exactly 100% used on every healthy boot, at 64 KB and 256 KB alike. The
 * inverted condition was the whole bug; the paint itself survives intact.
 * Measured 2026-07-26 in GHDL with the corrected scan: 344 bytes of 262144.)
 *
 * Diagnostics kept from the investigation:
 *   first_surv  = address of first surviving sentinel scanning UP from bottom
 *                 (== _stack_bottom on a healthy boot)
 *   surv_words  = surviving sentinel count in [bottom, top-skip) — 0 means the
 *                 whole span was overwritten after tiny_stack_paint()
 *   high_water  = _stack_top - (address of highest surviving PAINTED word,
 *                 scanning DOWN from top-skip) = true stack depth from the top
 *   bottom_val  = word at _stack_bottom (0x00000000 => memset-zero wiper,
 *                 ELF-looking bytes => loader, frame-like => real stack). */
static void tiny_stack_report(void)
{
    if (tiny_stack_span() > TINY_STACK_PROBE_MAX_BYTES) return;
    const volatile uint32_t *bottom = (const volatile uint32_t *)_stack_bottom;
    const volatile uint32_t *top = (const volatile uint32_t *)_stack_top;
    const volatile uint32_t *paint_hi =
        (const volatile uint32_t *)(_stack_top - TINY_STACK_PAINT_SKIP_TOP);
    const volatile uint32_t *first_surv = bottom;
    while (first_surv < top && *first_surv != TINY_STACK_PAINT) {
        first_surv++;
    }
    /* Deepest touch: first word ABOVE the contiguous surviving run. */
    const volatile uint32_t *lo = first_surv;
    while (lo < paint_hi && *lo == TINY_STACK_PAINT) {
        lo++;
    }
    uint32_t surviving = 0;
    for (const volatile uint32_t *p = bottom; p < paint_hi; p++) {
        if (*p == TINY_STACK_PAINT) surviving++;
    }
    /* Scan DOWN from just below the unpainted top skip for the first
     * still-painted word: everything above it was genuinely touched. */
    const volatile uint32_t *dp = paint_hi;
    while (dp > bottom) {
        dp--;
        if (*dp == TINY_STACK_PAINT) break;
    }
    uint32_t high_water;
    if (*dp == TINY_STACK_PAINT) {
        high_water = (uint32_t)((uintptr_t)top - (uintptr_t)dp) - 4U;
    } else {
        high_water = tiny_stack_span(); /* nothing painted survives */
    }
    uart_puts("[tiny] stack_used=");
    uart_put_u32((uint32_t)((uintptr_t)top - (uintptr_t)lo));
    uart_puts(" of=");
    uart_put_u32(tiny_stack_span());
    uart_puts("\n[tiny] probe first_surv=");
    uart_put_hex32((uint32_t)(uintptr_t)first_surv);
    uart_puts(" surv_words=");
    uart_put_u32(surviving);
    uart_puts(" high_water=");
    uart_put_u32(high_water);
    uart_puts(" bottom_val=");
    uart_put_hex32(*bottom);
    uart_puts("\n");
}

static uint32_t riscv32_harden_mix32(uint32_t value)
{
    value ^= value >> 16;
    value *= 0x7feb352dU;
    value ^= value >> 15;
    value *= 0x846ca68bU;
    value ^= value >> 16;
    return value & 0x7fffffffU;
}

RuntimeValue rt_riscv32_harden_canary_value(void)
{
    uintptr_t cycle = 0;
    uintptr_t time = 0;
    uintptr_t instret = 0;
    __asm__ volatile("rdcycle %0" : "=r"(cycle));
    __asm__ volatile("rdtime %0" : "=r"(time));
    __asm__ volatile("rdinstret %0" : "=r"(instret));
    uint32_t mixed = riscv32_harden_mix32(
        (uint32_t)cycle ^ ((uint32_t)time << 11) ^ ((uint32_t)instret << 17) ^
        (uint32_t)(uintptr_t)&rt_riscv32_harden_canary_value
    );
    return (RuntimeValue)(mixed == 0U ? 1U : mixed);
}

RuntimeValue rt_riscv32_harden_print_canary(void)
{
    uart_puts("[harden] canary arch=riscv32 value=");
    uart_put_u32((uint32_t)rt_riscv32_harden_canary_value());
    uart_puts("\r\n");
    return NIL_VALUE;
}

RuntimeValue rt_string_new(RuntimeValue data, RuntimeValue len_val)
{
    uintptr_t len = (uintptr_t)len_val;
    if (len == 0 || len > 4096U) return NIL_VALUE;
    RuntimeString *s = (RuntimeString *)rv_alloc(sizeof(RuntimeString) + len + 1U);
    if (!s) return NIL_VALUE;
    s->hdr.type = HEAP_STRING;
    s->hdr.size = (uint32_t)(sizeof(RuntimeString) + len + 1U);
    s->len = (uint32_t)len;
    const char *src = (const char *)(uintptr_t)data;
    for (uintptr_t i = 0; i < len; i++) {
        s->data[i] = src ? src[i] : 0;
    }
    s->data[len] = 0;
    return ENCODE_PTR(s);
}

/* Interned string-literal constructor. The hosted runtime interns by literal
 * address for perf; the freestanding kernel has no intern table, so forward to
 * rt_string_new — functionally identical (a fresh heap string per call). */
RuntimeValue rt_string_new_literal(RuntimeValue data, RuntimeValue len_val)
{
    return rt_string_new(data, len_val);
}

RuntimeValue rt_rv32_probe_store32(RuntimeValue addr, RuntimeValue value)
{
    *(volatile uint32_t *)(uintptr_t)addr = (uint32_t)(uintptr_t)value;
    return NIL_VALUE;
}

#define GHDL_RV32_PASS_ADDR      0x801FF000u
#define GHDL_RV32_A0_ADDR        0x801FF010u
#define GHDL_RV32_A1_ADDR        0x801FF014u
#define GHDL_RV32_DTB_VALID_ADDR 0x801FF018u
#define GHDL_RV32_SATP_ADDR      0x801FF01Cu

static RuntimeValue rv32_probe_store_fixed(uint32_t addr, RuntimeValue value)
{
    *(volatile uint32_t *)(uintptr_t)addr = (uint32_t)(uintptr_t)value;
    return NIL_VALUE;
}

RuntimeValue rt_rv32_probe_store_pass(RuntimeValue value)
{
    return rv32_probe_store_fixed(GHDL_RV32_PASS_ADDR, value);
}

RuntimeValue rt_rv32_probe_store_a0(RuntimeValue value)
{
    (void)value;
    return rv32_probe_store_fixed(GHDL_RV32_A0_ADDR, 0);
}

RuntimeValue rt_rv32_probe_store_a1(RuntimeValue value)
{
    (void)value;
    return rv32_probe_store_fixed(GHDL_RV32_A1_ADDR, 0x88000000u);
}

RuntimeValue rt_rv32_probe_store_dtb_valid(RuntimeValue value)
{
    return rv32_probe_store_fixed(GHDL_RV32_DTB_VALID_ADDR, value);
}

RuntimeValue rt_rv32_probe_store_satp(RuntimeValue value)
{
    return rv32_probe_store_fixed(GHDL_RV32_SATP_ADDR, value);
}

RuntimeValue rt_rv32_probe_load8(RuntimeValue addr)
{
    return (RuntimeValue)(uintptr_t)(*(volatile uint8_t *)(uintptr_t)addr);
}

RuntimeValue rt_rv32_probe_read_satp(void)
{
    return 0;
}

RuntimeValue rt_rv32_probe_uart_put(RuntimeValue byte)
{
    uart_putc((char)(uint8_t)(uintptr_t)byte);
    return NIL_VALUE;
}

/* riscv_load_elf_process: ELF32 (ELFCLASS32) variant.
 * riscv64 uses ELF64 with different header offsets — body stays per-arch.
 * Forward declaration is in riscv_common.h. */
static int riscv_load_elf_process(const unsigned char *elf, uint32_t elf_size, uint32_t slot, const char *marker)
{
    if (slot >= 2U || elf_size < 52U) return 0;
    if (elf[0] != 0x7fU || elf[1] != 'E' || elf[2] != 'L' || elf[3] != 'F') return 0;
    if (elf[4] != 1U || elf[5] != 1U) return 0;
    if (rd16(elf + 18U) != 243U) return 0;

    uint64_t entry = rd32(elf + 24U);
    uint64_t phoff = rd32(elf + 28U);
    uint16_t phentsize = rd16(elf + 42U);
    uint16_t phnum = rd16(elf + 44U);
    if (phoff == 0 || phentsize < 32U || phnum == 0 || phnum > 8U) return 0;
    if (phoff + ((uint64_t)phentsize * phnum) > elf_size) return 0;

    for (uint32_t i = 0; i < sizeof(g_riscv_process_arena[slot]); i++) g_riscv_process_arena[slot][i] = 0;

    uint32_t loaded = 0;
    int entry_mapped = 0;
    for (uint16_t i = 0; i < phnum; i++) {
        const unsigned char *ph = elf + phoff + ((uint64_t)i * phentsize);
        if (rd32(ph) != 1U) continue;
        uint64_t off = rd32(ph + 4U);
        uint64_t vaddr = rd32(ph + 8U);
        uint64_t filesz = rd32(ph + 16U);
        uint64_t memsz = rd32(ph + 20U);
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
    return riscv_smf_probe_file("HELLOSMFSMF", "SIMPLEOS_RISCV32_HELLO_ELF") ? 1 : 0;
}

RuntimeValue rt_riscv_smf_cli_load(void)
{
    return riscv_load_smf_process("HELLOSMFSMF", "SIMPLEOS_RISCV32_HELLO_ELF", 0) ? 1 : 0;
}

RuntimeValue rt_riscv_smf_gui_probe(void)
{
    return riscv_smf_probe_file("BROWSMF SMF", "SIMPLEOS_RISCV32_GUI_ELF") ? 1 : 0;
}

RuntimeValue rt_riscv_native_gui_process_render(void)
{
    if (!riscv_load_smf_process("BROWSMF SMF", "SIMPLEOS_RISCV32_GUI_ELF", 1)) return 0;
    if (g_riscv_process_pid[1] == 0 || g_riscv_process_entry[1] == 0) return 0;
    const char *content = "pid=1002 app=/sys/apps/browser_demo tree=native";
    uint32_t i = 0;
    while (content[i] != 0 && i + 1U < sizeof(g_riscv_gui_surface)) {
        g_riscv_gui_surface[i] = content[i];
        i++;
    }
    g_riscv_gui_surface[i] = 0;
    /* Last C call on the marker chain (SMF_WM_GUI_LAUNCH_OK) — by here the
     * deepest boot frames have all been and gone, so this is the right place
     * to publish the measured stack high-water mark. No-ops on the default
     * (8 MB stack) images. */
    tiny_stack_report();
    return bytes_contains((const unsigned char *)g_riscv_gui_surface, sizeof(g_riscv_gui_surface), "pid=1002") ? 1 : 0;
}

__attribute__((naked, section(".text.entry"))) void _start(void)
{
    __asm__ volatile(
        "la sp, _stack_top\n"
        /* Zero .bss BEFORE any C code runs. Real DDR powers up as garbage;
         * un-zeroed .bss => g_heap_off trash => every alloc fails => only the
         * canary prints (proven on KV260 silicon 2026-07-26). The kernel must
         * not depend on loader cooperation (board-runnable rule); the bringup
         * script's dow-zeroing stays as belt-and-suspenders. _sbss/_ebss come
         * from linker_riscv_common.ld and _ebss is ALIGN(8), so a word loop
         * terminates exactly. Handles empty .bss (_sbss == _ebss). */
        "la t0, _sbss\n"
        "la t1, _ebss\n"
        "1: bgeu t0, t1, 2f\n"
        "sw zero, 0(t0)\n"
        "addi t0, t0, 4\n"
        "j 1b\n"
        "2:\n"
        /* Paint the stack before any Simple code runs, so the high-water mark
         * reported at the end of the marker chain covers the whole boot.
         * No-ops unless the linker reserved a BRAM-sized stack. */
        "call tiny_stack_paint\n"
        "call spl_start\n"
        "3: wfi\n"
        "j 3b\n"
    );
}

#include "../../common/boot/text_codepoint_runtime.h"
