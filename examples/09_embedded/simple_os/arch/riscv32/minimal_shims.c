/* Minimal rv32 FPGA PL payload extern shims — NO full runtime, NO libgcc.
 *
 * Provides ONLY the 6 externs required by serial_shell_entry.spl:
 *   - serial_println: UART TX store loop (handles both RtString and C-string)
 *   - putc: emit one char to UART
 *   - putint: emit signed decimal integer to UART
 *   - rt_baked_fs_byte: data-ROM load
 *   - rt_baked_fs_sector_count: compiled-in constant
 *   - rt_qemu_exit_success: infinite loop halt
 *
 * Build: riscv64-unknown-elf-gcc -c -march=rv32imac_zicsr -mabi=ilp32 -O2 ...
 * Link with entry.S _start at 0x80000000 + this object + the .spl object.
 */

#include <stdint.h>

/* MMIO base addresses (from RV32_FPGA_CORE_PAYLOAD_CONTRACT.md) */
#define UART_TX_BASE 0x10000000UL
#define DATA_ROM_BASE 0x40000000UL

/* rt_baked_fs_sector_count: compiled-in constant = minimal image sectors */
#define MIN_FAT32_SECTORS 71  /* 36352 bytes / 512 */

/* RtString layout (Simple compiler runtime string representation)
 * A Simple text value arrives as a handle: pointer to struct with len + data.
 * LLVM string literals arrive as raw C-string pointers.
 * We distinguish: if len pointer looks like a small length, treat as RtString;
 * otherwise treat the original pointer as C-string.
 */
typedef struct {
    uint32_t len;
    const char data[];
} RtString;

/* putc: emit one char to UART TX MMIO (core stalls until shifted out) */
void putc(int64_t c) {
    *((volatile uint8_t *)UART_TX_BASE) = (uint8_t)c;
}

/* putint: emit a signed decimal integer to UART — BUFFERLESS.
 * The prior itoa-into-buf form wrote the stack buffer via byte stores (sb),
 * which corrupted putint's saved ra on the PL core and made ret loop.
 * This form emits digits MSB-first via div/mod + putc directly: no stack
 * buffer, no sb-to-stack.
 *
 * NOTE: int64 arg arrives in a0=low, a1=high (RV32 ABI). We truncate to
 * 32-bit immediately to avoid the high-word check mis-branching. */
void putint(int64_t n) {
    /* operate in 32-bit: values fit (sector_count/lba/count are small), and
     * rv32imac has HW div/rem (no __divdi3/libgcc needed). */
    int v, p;
    /* Truncate to 32-bit FIRST — avoids a1 sign-bit confusion */
    v = (int)n;
    if (v < 0) { putc('-'); v = -v; }
    if (v == 0) { putc('0'); return; }
    p = 1;
    while (p <= v / 10) p *= 10;
    while (p > 0) { putc('0' + v / p); v = v % p; p /= 10; }
}

/* serial_println: handle both RtString and raw C-string.
 * LLVM string literals arrive as raw pointers (length not at the start).
 * RtString has len in first word, data immediately following.
 *
 * CRITICAL: ALL emit loops are BOUNDED to prevent infinite loop on
 * malformed/missing null terminators.
 */
void serial_println(const char *msg) {
    if (!msg) return;

    /* Check if this looks like a valid RtString by testing for a reasonable
     * length AND ensuring there's actual string data at the expected offset.
     * This avoids false positives on C-strings that happen to start with
     * small byte values on little-endian. */
    uint32_t possible_len = *(const uint32_t *)msg;
    const char *str_start;

    /* RtString must have: 0 < len < 256, AND byte at offset 4 looks like
     * printable ASCII or null (not garbage). C-strings start immediately
     * at msg, so msg[4] is part of the content. */
    if (possible_len > 0 && possible_len < 256) {
        char first_char = msg[4];
        /* Accept RtString only if the first data byte is null or printable ASCII.
         * This rejects most C-string false positives (their msg[4] is just the
         * 5th character of the actual string). */
        if (first_char == 0 || (first_char >= 32 && first_char < 127)) {
            /* Likely RtString: emit 'len' chars, bounded */
            str_start = msg + 4;
            uint32_t max_emit = possible_len;
            if (max_emit > 128) max_emit = 128;
            for (uint32_t i = 0; i < max_emit && str_start[i]; i++) {
                *((volatile uint8_t *)UART_TX_BASE) = str_start[i];
            }
            goto newline;
        }
    }

    /* Raw C-string: emit until null OR max chars — BOUNDED */
    str_start = msg;
    for (uint32_t i = 0; i < 128 && str_start[i]; i++) {
        *((volatile uint8_t *)UART_TX_BASE) = (uint8_t)str_start[i];
    }

newline:
    /* Emit newline */
    *((volatile uint8_t *)UART_TX_BASE) = '\r';
    *((volatile uint8_t *)UART_TX_BASE) = '\n';
}

/* rt_baked_fs_byte: lb byte, off(x) where x = 0x40000000 + lba*512 + off.
 * Core load path dispatches: eff in 0x40000000.. -> DATA ROM. */
int64_t rt_baked_fs_byte(int64_t lba, int64_t off) {
    uintptr_t addr = DATA_ROM_BASE + ((uintptr_t)lba * 512) + (uintptr_t)off;
    return (int64_t)(*((const volatile uint8_t *)addr));
}

/* rt_baked_fs_sector_count: compiled-in constant */
int64_t rt_baked_fs_sector_count(void) {
    return (int64_t)MIN_FAT32_SECTORS;
}

/* rt_qemu_exit_success: infinite loop halt on PL (WFI doesn't halt simulators)
 * FIX: do a proper infinite loop instead of just WFI. */
void rt_qemu_exit_success(void) {
    /* Infinite loop: branch to self forever. Never returns. */
    __asm__ volatile("1: wfi; j 1b");
}
