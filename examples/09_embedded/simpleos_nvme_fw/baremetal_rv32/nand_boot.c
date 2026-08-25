/*
 * nand_boot.c — Bare-metal RV32 NAND/FTL demo
 *
 * Self-contained: UART driver + _start + NAND/FTL emulation.
 * Targets: riscv32-unknown-none-elf (QEMU virt, -bios none).
 * Entry: _start (via naked asm) → spl_start() → NAND tests → halt.
 *
 * NAND geometry: 4 blocks × 4 pages/block = 16 physical pages, 256 B/page
 * OOB: 8 bytes/page: lba(u32) + seq(u32)
 * FTL: flat L2P table; crash recovery rebuilds from OOB.
 *
 * Expected UART output includes "ALL RV32 NAND CHECKS PASS".
 */

#include <stdint.h>
#include <stddef.h>

/* ====================================================================
 * UART 16550 at 0x10000000 (QEMU virt riscv32)
 * ==================================================================== */
#define UART_BASE   0x10000000UL
#define UART_THR    0x00UL   /* transmit holding register */
#define UART_LSR    0x05UL   /* line status register */
#define UART_THRE   0x20u    /* transmit holding register empty */

static void uart_putc(char c) {
    volatile uint8_t *uart = (volatile uint8_t *)UART_BASE;
    /* spin-wait for THRE */
    for (uint32_t i = 0; i < 200000u; i++) {
        if (uart[UART_LSR] & UART_THRE) break;
    }
    uart[UART_THR] = (uint8_t)c;
}

static void uart_puts(const char *s) {
    while (*s) uart_putc(*s++);
}

static void uart_println(const char *s) {
    uart_puts(s);
    uart_putc('\r');
    uart_putc('\n');
}

static void uart_put_u32(uint32_t v) {
    char buf[12];
    int i = 11;
    buf[i] = '\0';
    if (v == 0) { uart_putc('0'); return; }
    while (v > 0 && i > 0) {
        buf[--i] = (char)('0' + (v % 10u));
        v /= 10u;
    }
    uart_puts(buf + i);
}

/* ====================================================================
 * _start: set stack, zero BSS inline, call spl_start
 * Placed in .text.entry so the linker script keeps it first.
 * BSS zero is inlined in asm to avoid the static-symbol visibility
 * issue (assembler can't call a C `static` function by name).
 * ==================================================================== */
__attribute__((naked, section(".text.entry"))) void _start(void) {
    __asm__ volatile(
        "la   sp, _stack_top      \n"
        /* Zero BSS */
        "la   t0, _sbss           \n"
        "la   t1, _ebss           \n"
        ".Lbss_loop:              \n"
        "bgeu  t0, t1, .Lbss_done \n"
        "sw   zero, 0(t0)         \n"
        "addi t0, t0, 4           \n"
        "j    .Lbss_loop          \n"
        ".Lbss_done:              \n"
        "call spl_start           \n"
        "1:   wfi                 \n"
        "j    1b                  \n"
    );
}

/* ====================================================================
 * Emulated NAND Flash — no heap, all static arrays
 *
 * Layout: 4 blocks × 4 pages/block = 16 pages
 * Page:   256 data bytes + OOB (lba u32 + seq u32)
 * Erased: data = 0xFF, oob_lba = 0xFFFFFFFF
 * ==================================================================== */
#define NAND_BLOCKS          4u
#define NAND_PAGES_PER_BLOCK 4u
#define NAND_PAGES           (NAND_BLOCKS * NAND_PAGES_PER_BLOCK)  /* 16 */
#define PAGE_SIZE            256u
#define NAND_INVALID         0xFFFFFFFFu

static uint8_t  nand_data [NAND_PAGES][PAGE_SIZE];
static uint32_t nand_lba  [NAND_PAGES];
static uint32_t nand_seq  [NAND_PAGES];
static uint8_t  nand_blank[NAND_PAGES]; /* 1 = erased/writable */

/* --- NAND primitives --- */

static void nand_init(void) {
    for (uint32_t p = 0; p < NAND_PAGES; p++) {
        for (uint32_t b = 0; b < PAGE_SIZE; b++) nand_data[p][b] = 0xFF;
        nand_lba[p]   = NAND_INVALID;
        nand_seq[p]   = NAND_INVALID;
        nand_blank[p] = 1;
    }
}

static void nand_erase_block(uint32_t block) {
    uint32_t base = block * NAND_PAGES_PER_BLOCK;
    for (uint32_t r = 0; r < NAND_PAGES_PER_BLOCK; r++) {
        uint32_t p = base + r;
        for (uint32_t b = 0; b < PAGE_SIZE; b++) nand_data[p][b] = 0xFF;
        nand_lba[p]   = NAND_INVALID;
        nand_seq[p]   = NAND_INVALID;
        nand_blank[p] = 1;
    }
}

/* Returns 0 on success, -1 on bad page, -2 if not blank */
static int nand_program(uint32_t page, const uint8_t *data,
                        uint32_t lba, uint32_t seq) {
    if (page >= NAND_PAGES)   return -1;
    if (!nand_blank[page])    return -2;
    for (uint32_t b = 0; b < PAGE_SIZE; b++) nand_data[page][b] = data[b];
    nand_lba[page]   = lba;
    nand_seq[page]   = seq;
    nand_blank[page] = 0;
    return 0;
}

/* Returns 0 on success */
static int nand_read(uint32_t page, uint8_t *buf) {
    if (page >= NAND_PAGES) return -1;
    for (uint32_t b = 0; b < PAGE_SIZE; b++) buf[b] = nand_data[page][b];
    return 0;
}

/* ====================================================================
 * FTL — Flash Translation Layer
 * L2P: logical block address → physical NAND page
 * Supports crash recovery by scanning OOB for highest seq per LBA.
 * ==================================================================== */
#define FTL_MAX_LBA 8u

static uint32_t ftl_l2p[FTL_MAX_LBA];  /* maps lba → physical page */
static uint32_t ftl_seq;               /* monotone write counter */

static void ftl_init(void) {
    for (uint32_t i = 0; i < FTL_MAX_LBA; i++) ftl_l2p[i] = NAND_INVALID;
    ftl_seq = 1;
}

/* Find a blank page for writing */
static int ftl_alloc_page(void) {
    for (uint32_t p = 0; p < NAND_PAGES; p++) {
        if (nand_blank[p]) return (int)p;
    }
    return -1;  /* out of space */
}

/* Write logical block */
static int ftl_write(uint32_t lba, const uint8_t *data) {
    if (lba >= FTL_MAX_LBA) return -1;
    int pg = ftl_alloc_page();
    if (pg < 0) return -2;
    int rc = nand_program((uint32_t)pg, data, lba, ftl_seq++);
    if (rc != 0) return -3;
    ftl_l2p[lba] = (uint32_t)pg;
    return 0;
}

/* Read logical block */
static int ftl_read(uint32_t lba, uint8_t *buf) {
    if (lba >= FTL_MAX_LBA)            return -1;
    if (ftl_l2p[lba] == NAND_INVALID)  return -2;
    return nand_read(ftl_l2p[lba], buf);
}

/* Crash recovery: scan OOB and rebuild L2P using highest seq per LBA */
static void ftl_recover(void) {
    for (uint32_t i = 0; i < FTL_MAX_LBA; i++) ftl_l2p[i] = NAND_INVALID;
    ftl_seq = 1;
    for (uint32_t p = 0; p < NAND_PAGES; p++) {
        if (nand_lba[p] == NAND_INVALID) continue;   /* blank/erased */
        uint32_t lba = nand_lba[p];
        uint32_t seq = nand_seq[p];
        if (lba >= FTL_MAX_LBA) continue;
        /* pick highest seq for this lba */
        if (ftl_l2p[lba] == NAND_INVALID ||
            seq > nand_seq[ftl_l2p[lba]]) {
            ftl_l2p[lba] = p;
        }
        if (seq >= ftl_seq) ftl_seq = seq + 1;
    }
}

/* ====================================================================
 * Test helpers
 * ==================================================================== */
static void fill_page(uint8_t *buf, const char *msg) {
    uint32_t i = 0;
    while (msg[i] && i < PAGE_SIZE) { buf[i] = (uint8_t)msg[i]; i++; }
    while (i < PAGE_SIZE) buf[i++] = 0;
}

static int page_prefix_ok(const uint8_t *buf, const char *expected) {
    for (uint32_t i = 0; expected[i]; i++) {
        if (buf[i] != (uint8_t)expected[i]) return 0;
    }
    return 1;
}

static int page_all_erased(const uint8_t *buf) {
    for (uint32_t i = 0; i < PAGE_SIZE; i++) {
        if (buf[i] != 0xFF) return 0;
    }
    return 1;
}

/* Pass/fail reporter */
static int g_tests_run    = 0;
static int g_tests_passed = 0;

static void test_ok(const char *name) {
    uart_puts("[PASS] "); uart_println(name);
    g_tests_run++;
    g_tests_passed++;
}

static void test_fail(const char *name, const char *reason) {
    uart_puts("[FAIL] "); uart_puts(name);
    uart_puts(" — "); uart_println(reason);
    g_tests_run++;
}

/* ====================================================================
 * spl_start — main test entry (called by _start after BSS zero)
 * ==================================================================== */
void spl_start(void) {
    uart_println("");
    uart_println("=== RV32 NAND/FTL Bare-Metal Demo ===");
    uart_println("");

    uint8_t wbuf[PAGE_SIZE];
    uint8_t rbuf[PAGE_SIZE];

    /* ---- Phase 1: NAND program / read ---- */
    uart_println("--- Phase 1: NAND program/read ---");
    nand_init();
    ftl_init();

    fill_page(wbuf, "Hello NAND RV32");
    if (ftl_write(0, wbuf) == 0)
        test_ok("FTL write LBA=0");
    else
        test_fail("FTL write LBA=0", "write error");

    if (ftl_read(0, rbuf) == 0 && page_prefix_ok(rbuf, "Hello NAND RV32"))
        test_ok("FTL read LBA=0 data match");
    else
        test_fail("FTL read LBA=0 data match", "mismatch");

    fill_page(wbuf, "World FTL RV32");
    if (ftl_write(1, wbuf) == 0)
        test_ok("FTL write LBA=1");
    else
        test_fail("FTL write LBA=1", "write error");

    if (ftl_read(1, rbuf) == 0 && page_prefix_ok(rbuf, "World FTL RV32"))
        test_ok("FTL read LBA=1 data match");
    else
        test_fail("FTL read LBA=1 data match", "mismatch");

    uart_println("");
    uart_println("NAND program/read OK");
    uart_println("");

    /* ---- Phase 2: Erase ---- */
    uart_println("--- Phase 2: NAND erase ---");
    /* Block 0 holds pages 0..3 which we just wrote */
    nand_erase_block(0);

    /* Verify erased */
    int erase_ok = 1;
    for (uint32_t p = 0; p < NAND_PAGES_PER_BLOCK; p++) {
        nand_read(p, rbuf);
        if (!page_all_erased(rbuf)) { erase_ok = 0; break; }
    }
    if (erase_ok && nand_lba[0] == NAND_INVALID)
        test_ok("Block 0 erased and OOB cleared");
    else
        test_fail("Block 0 erased and OOB cleared", "erase verify failed");

    uart_println("");
    uart_println("NAND erase OK");
    uart_println("");

    /* ---- Phase 3: FTL write → crash → OOB rebuild → verify ---- */
    uart_println("--- Phase 3: FTL write/crash/recover ---");
    nand_init();
    ftl_init();

    /* Write two blocks */
    fill_page(wbuf, "FTL Recover Test A");
    if (ftl_write(0, wbuf) == 0)
        test_ok("Pre-crash FTL write LBA=0");
    else
        test_fail("Pre-crash FTL write LBA=0", "write error");

    fill_page(wbuf, "FTL Recover Test B");
    if (ftl_write(1, wbuf) == 0)
        test_ok("Pre-crash FTL write LBA=1");
    else
        test_fail("Pre-crash FTL write LBA=1", "write error");

    /* Simulate crash: wipe in-RAM L2P (NAND data/OOB survives) */
    uart_println("[sim] Crash: L2P wiped (NAND OOB intact)");
    ftl_init();   /* zeroes l2p; seq restarts */

    /* Rebuild from OOB scan */
    ftl_recover();
    test_ok("OOB scan / L2P rebuild");

    /* Read-back after recovery */
    if (ftl_read(0, rbuf) == 0 && page_prefix_ok(rbuf, "FTL Recover Test A"))
        test_ok("Post-recover read LBA=0 data match");
    else
        test_fail("Post-recover read LBA=0 data match", "mismatch");

    if (ftl_read(1, rbuf) == 0 && page_prefix_ok(rbuf, "FTL Recover Test B"))
        test_ok("Post-recover read LBA=1 data match");
    else
        test_fail("Post-recover read LBA=1 data match", "mismatch");

    uart_println("");
    uart_println("FTL write/recover OK");
    uart_println("");

    /* ---- Summary ---- */
    uart_puts("Tests: ");
    uart_put_u32((uint32_t)g_tests_passed);
    uart_puts("/");
    uart_put_u32((uint32_t)g_tests_run);
    uart_println(" passed");
    uart_println("");

    if (g_tests_passed == g_tests_run) {
        uart_println("ALL RV32 NAND CHECKS PASS");
    } else {
        uart_puts("FAILED: ");
        uart_put_u32((uint32_t)(g_tests_run - g_tests_passed));
        uart_println(" check(s) failed");
    }

    /* Halt */
    for (;;) __asm__ volatile("wfi");
}
