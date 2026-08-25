/*
 * SimpleOS x86_32 (i686) Baremetal Runtime Stubs
 *
 * Provides a complete freestanding runtime for the Simple language compiler
 * targeting x86_32 bare-metal (QEMU isa-debug-exit, COM1 serial).
 *
 * Differences from x86_64:
 *   - RuntimeValue is int32_t (32-bit pointers)
 *   - Heap is 4MB (not 64MB)
 *   - No 64-bit register instructions
 *
 * Sections:
 *   1. Includes and types
 *   2. Serial I/O (COM1 0x3F8)
 *   3. RuntimeValue tagging
 *   4. Heap allocator (bump, 4 MB)
 *   5. Memory functions
 *   6. String operations
 *   7. Print functions
 *   8. Framebuffer copy
 *   9. _start (serial init, call spl_start, isa-debug-exit)
 *  10. No-op stubs (~200 runtime functions)
 *  11. Real x86_32 port-I/O and MMIO overrides
 */

/* ===================================================================
 * 1. Includes and types
 * =================================================================== */

#include <stdint.h>
#include <stddef.h>

typedef int32_t RuntimeValue;

/* ===================================================================
 * 2. Serial I/O — COM1 at 0x3F8 via x86 outb / inb
 * =================================================================== */

static inline void outb(uint16_t port, uint8_t val)
{
    __asm__ volatile("outb %0, %1" : : "a"(val), "Nd"(port));
}

static inline uint8_t inb(uint16_t port)
{
    uint8_t r;
    __asm__ volatile("inb %1, %0" : "=a"(r) : "Nd"(port));
    return r;
}

static inline void outw(uint16_t port, uint16_t val)
{
    __asm__ volatile("outw %0, %1" : : "a"(val), "Nd"(port));
}

static inline uint16_t inw(uint16_t port)
{
    uint16_t r;
    __asm__ volatile("inw %1, %0" : "=a"(r) : "Nd"(port));
    return r;
}

static inline void outl(uint16_t port, uint32_t val)
{
    __asm__ volatile("outl %0, %1" : : "a"(val), "Nd"(port));
}

static inline uint32_t inl(uint16_t port)
{
    uint32_t r;
    __asm__ volatile("inl %1, %0" : "=a"(r) : "Nd"(port));
    return r;
}

static inline void io_wait(void)
{
    outb(0x80, 0);
}

static void serial_putchar(char c)
{
    /* Wait until transmit holding register is empty (bit 5 of LSR) */
    while (!(inb(0x3F8 + 5) & 0x20)) {}
    outb(0x3F8, (uint8_t)c);
}

static void serial_puts(const char *s)
{
    while (*s) {
        if (*s == '\n') serial_putchar('\r');
        serial_putchar(*s++);
    }
}

static void serial_put_hex(uint32_t v)
{
    static const char hex[] = "0123456789abcdef";
    serial_puts("0x");
    int started = 0;
    for (int i = 28; i >= 0; i -= 4) {
        int nibble = (v >> i) & 0xF;
        if (nibble || started || i == 0) {
            serial_putchar(hex[nibble]);
            started = 1;
        }
    }
}

static void serial_put_dec(int32_t v)
{
    if (v < 0) {
        serial_putchar('-');
        if (v == (-2147483647 - 1)) {
            serial_puts("2147483648");
            return;
        }
        v = -v;
    }
    char buf[11];
    int pos = 0;
    uint32_t uv = (uint32_t)v;
    do {
        buf[pos++] = '0' + (char)(uv % 10);
        uv /= 10;
    } while (uv > 0);
    while (pos > 0) {
        serial_putchar(buf[--pos]);
    }
}

static void serial_put_u32(uint32_t v)
{
    char buf[10];
    int pos = 0;
    do {
        buf[pos++] = '0' + (char)(v % 10U);
        v /= 10U;
    } while (v > 0U);
    while (pos > 0) {
        serial_putchar(buf[--pos]);
    }
}

static uint32_t x86_32_harden_mix32(uint32_t value)
{
    value ^= value >> 16;
    value *= 0x7feb352dU;
    value ^= value >> 15;
    value *= 0x846ca68bU;
    value ^= value >> 16;
    return value & 0x7fffffffU;
}

static uint32_t x86_32_harden_canary_value(void)
{
    uint32_t lo = 0;
    uint32_t hi = 0;
    __asm__ volatile("rdtsc" : "=a"(lo), "=d"(hi));
    uint32_t mixed = x86_32_harden_mix32(lo ^ (hi << 11) ^ (uint32_t)(uintptr_t)&x86_32_harden_canary_value);
    return mixed == 0U ? 1U : mixed;
}

static void x86_32_harden_print_canary(void)
{
    serial_puts("[harden] canary arch=x86_32 value=");
    serial_put_u32(x86_32_harden_canary_value());
    serial_puts("\r\n");
}

/* ===================================================================
 * 3. RuntimeValue tagging (32-bit)
 * =================================================================== */

#define TAG_MASK    0x7U
#define TAG_INT     0x0U
#define TAG_HEAP    0x1U
#define TAG_FLOAT   0x2U
#define TAG_SPECIAL 0x3U

#define ENCODE_INT(v)  ((RuntimeValue)(((uint32_t)(int32_t)(v) << 3) | TAG_INT))
#define DECODE_INT(v)  ((int32_t)(v) >> 3)

#define ENCODE_PTR(p)  ((RuntimeValue)((uint32_t)(uintptr_t)(p) | TAG_HEAP))
#define DECODE_PTR(v)  ((void*)((uint32_t)(v) & ~TAG_MASK))

#define IS_INT(v)      (((uint32_t)(v) & TAG_MASK) == TAG_INT)
#define IS_HEAP(v)     (((uint32_t)(v) & TAG_MASK) == TAG_HEAP)
#define IS_FLOAT(v)    (((uint32_t)(v) & TAG_MASK) == TAG_FLOAT)
#define IS_NIL(v)      ((v) == (RuntimeValue)TAG_SPECIAL)

#define NIL_VALUE      ((RuntimeValue)TAG_SPECIAL)
#define TRUE_VALUE     ENCODE_INT(1)
#define FALSE_VALUE    ENCODE_INT(0)

typedef struct {
    uint32_t type;
    uint32_t size;
} HeapHeader;

typedef struct {
    HeapHeader hdr;
    uint32_t   len;
    char       data[];
} RuntimeString;

typedef struct {
    HeapHeader   hdr;
    uint32_t     len;
    uint32_t     cap;
    RuntimeValue items[];
} RuntimeArray;

#define HEAP_STRING 1
#define HEAP_ARRAY  2
#define HEAP_MAP    3
#define HEAP_OBJECT 4
#define HEAP_ENUM   7

typedef struct {
    HeapHeader   hdr;
    uint32_t     enum_id;
    uint32_t     discriminant;
    RuntimeValue payload;
} RuntimeEnum;

/* ===================================================================
 * 4. Heap allocator — bump allocator, 4 MB
 * =================================================================== */

static char   _heap[4 * 1024 * 1024] __attribute__((aligned(16)));
static size_t _heap_off = 0;

void *malloc(size_t sz)
{
    if (sz > sizeof(_heap) - 15) {
        serial_puts("[PANIC] heap exhausted\r\n");
        for(;;) outb(0xF4, 0);
    }
    sz = (sz + 15) & ~(size_t)15;
    if (_heap_off > sizeof(_heap) - sz) {
        serial_puts("[PANIC] heap exhausted\r\n");
        for(;;) outb(0xF4, 0);
    }
    void *p = &_heap[_heap_off];
    _heap_off += sz;
    return p;
}

void free(void *p)
{
    (void)p; /* bump allocator: no-op */
}

void *realloc(void *p, size_t sz)
{
    void *n = malloc(sz);
    if (p && n) __builtin_memcpy(n, p, sz);
    return n;
}

void *calloc(size_t n, size_t sz)
{
    size_t total = n * sz;
    void *p = malloc(total);
    if (p) __builtin_memset(p, 0, total);
    return p;
}

RuntimeValue rt_alloc(RuntimeValue sz)
{
    /* sz is raw (untagged) per the Rust runtime ABI. */
    size_t bytes = (size_t)sz;
    if (bytes == 0 || bytes > 0x1000000) return NIL_VALUE;
    void *p = malloc(bytes);
    if (!p) return NIL_VALUE;
    return ENCODE_PTR(p);
}

RuntimeValue rt_alloc_zeroed(RuntimeValue sz)
{
    /* sz is raw (untagged) per the Rust runtime ABI. */
    size_t bytes = (size_t)sz;
    if (bytes == 0 || bytes > 0x1000000) return NIL_VALUE;
    void *p = malloc(bytes);
    if (!p) return NIL_VALUE;
    __builtin_memset(p, 0, bytes);
    return ENCODE_PTR(p);
}

RuntimeValue rt_dealloc(RuntimeValue ptr)
{
    (void)ptr;
    return NIL_VALUE;
}

/* ===================================================================
 * 5. Memory functions — freestanding replacements
 * =================================================================== */

void *memcpy(void *dst, const void *src, size_t n)
{
    uint8_t       *d = (uint8_t *)dst;
    const uint8_t *s = (const uint8_t *)src;
    for (size_t i = 0; i < n; i++) d[i] = s[i];
    return dst;
}

void *memset(void *dst, int c, size_t n)
{
    uint8_t *d = (uint8_t *)dst;
    for (size_t i = 0; i < n; i++) d[i] = (uint8_t)c;
    return dst;
}

void *memmove(void *dst, const void *src, size_t n)
{
    uint8_t       *d = (uint8_t *)dst;
    const uint8_t *s = (const uint8_t *)src;
    if (d < s) {
        for (size_t i = 0; i < n; i++) d[i] = s[i];
    } else if (d > s) {
        for (size_t i = n; i > 0; i--) d[i - 1] = s[i - 1];
    }
    return dst;
}

int memcmp(const void *a, const void *b, size_t n)
{
    const uint8_t *pa = (const uint8_t *)a;
    const uint8_t *pb = (const uint8_t *)b;
    for (size_t i = 0; i < n; i++) {
        if (pa[i] != pb[i]) return (int)pa[i] - (int)pb[i];
    }
    return 0;
}

size_t strlen(const char *s)
{
    size_t len = 0;
    while (s[len]) len++;
    return len;
}

char *strcpy(char *dst, const char *src)
{
    char *d = dst;
    while ((*d++ = *src++)) {}
    return dst;
}

char *strncpy(char *dst, const char *src, size_t n)
{
    size_t i;
    for (i = 0; i < n && src[i]; i++) dst[i] = src[i];
    for (; i < n; i++) dst[i] = '\0';
    return dst;
}

int strcmp(const char *a, const char *b)
{
    while (*a && *a == *b) { a++; b++; }
    return (int)(unsigned char)*a - (int)(unsigned char)*b;
}

int strncmp(const char *a, const char *b, size_t n)
{
    for (size_t i = 0; i < n; i++) {
        if (a[i] != b[i]) return (int)(unsigned char)a[i] - (int)(unsigned char)b[i];
        if (!a[i]) break;
    }
    return 0;
}

char *strcat(char *dst, const char *src)
{
    char *d = dst + strlen(dst);
    while ((*d++ = *src++)) {}
    return dst;
}

/* ===================================================================
 * 6. String operations
 * =================================================================== */

RuntimeValue rt_string_new(RuntimeValue data, RuntimeValue len_val)
{
    /* Parameters are raw (untagged) per the Rust runtime ABI.
       len_val is the raw byte count, data is a raw pointer. */
    int32_t len = len_val;
    if (len < 0 || len > 0x100000) return NIL_VALUE;
    RuntimeString *s = (RuntimeString *)malloc(sizeof(RuntimeString) + (size_t)len + 1);
    if (!s) return NIL_VALUE;
    s->hdr.type = HEAP_STRING;
    s->hdr.size = (uint32_t)(sizeof(RuntimeString) + (size_t)len + 1);
    s->len = (uint32_t)len;
    /* data is a raw pointer cast to i32 */
    const char *src = (const char *)(uintptr_t)data;
    if (src) __builtin_memcpy(s->data, src, (size_t)len);
    s->data[len] = '\0';
    return ENCODE_PTR(s);
}

RuntimeValue rt_string_from_cstr(const char *cstr)
{
    if (!cstr) return NIL_VALUE;
    size_t len = strlen(cstr);
    RuntimeString *s = (RuntimeString *)malloc(sizeof(RuntimeString) + len + 1);
    if (!s) return NIL_VALUE;
    s->hdr.type = HEAP_STRING;
    s->hdr.size = (uint32_t)(sizeof(RuntimeString) + len + 1);
    s->len = (uint32_t)len;
    __builtin_memcpy(s->data, cstr, len);
    s->data[len] = '\0';
    return ENCODE_PTR(s);
}

RuntimeValue rt_string_len(RuntimeValue str)
{
    if (!IS_HEAP(str)) return 0;
    RuntimeString *s = (RuntimeString *)DECODE_PTR(str);
    if (!s) return 0;
    return (RuntimeValue)s->len;
}

RuntimeValue rt_string_char_at(RuntimeValue str, RuntimeValue idx)
{
    if (!IS_HEAP(str)) return NIL_VALUE;
    RuntimeString *s = (RuntimeString *)DECODE_PTR(str);
    int32_t i = (int32_t)idx;
    if (!s || i < 0 || (uint32_t)i >= s->len) return NIL_VALUE;
    return rt_string_new((RuntimeValue)(uintptr_t)(s->data + i), 1);
}

RuntimeValue rt_string_concat(RuntimeValue a, RuntimeValue b)
{
    if (!IS_HEAP(a) && !IS_HEAP(b)) return NIL_VALUE;

    RuntimeString *sa = IS_HEAP(a) ? (RuntimeString *)DECODE_PTR(a) : (RuntimeString *)0;
    RuntimeString *sb = IS_HEAP(b) ? (RuntimeString *)DECODE_PTR(b) : (RuntimeString *)0;

    uint32_t la = sa ? sa->len : 0;
    uint32_t lb = sb ? sb->len : 0;
    uint32_t total = la + lb;

    RuntimeString *r = (RuntimeString *)malloc(sizeof(RuntimeString) + total + 1);
    if (!r) return NIL_VALUE;
    r->hdr.type = HEAP_STRING;
    r->hdr.size = (uint32_t)(sizeof(RuntimeString) + total + 1);
    r->len = total;
    if (sa) __builtin_memcpy(r->data, sa->data, la);
    if (sb) __builtin_memcpy(r->data + la, sb->data, lb);
    r->data[total] = '\0';
    return ENCODE_PTR(r);
}

RuntimeValue rt_string_eq(RuntimeValue a, RuntimeValue b)
{
    if (!IS_HEAP(a) || !IS_HEAP(b)) return ENCODE_INT(a == b ? 1 : 0);
    RuntimeString *sa = (RuntimeString *)DECODE_PTR(a);
    RuntimeString *sb = (RuntimeString *)DECODE_PTR(b);
    if (!sa || !sb) return ENCODE_INT(0);
    if (sa->len != sb->len) return ENCODE_INT(0);
    for (uint32_t i = 0; i < sa->len; i++) {
        if (sa->data[i] != sb->data[i]) return ENCODE_INT(0);
    }
    return ENCODE_INT(1);
}

/* Bug (2026-08-11): freestanding `text == ""` / `!= ""` against a RAW literal.
 *
 * rt_native_eq below content-compares two texts only when BOTH operands are
 * IS_HEAP. On this lane a `.trim()` / `.lower()` result is ALWAYS a freshly
 * malloc'd HEAP string (rt_string_slice / rt_string_to_lower), while a bare
 * `""` literal is emitted as a RAW, untagged char* global
 * (emit_bootstrap_str_const). The mixed heap-vs-raw pair therefore fell
 * through to `return 0` -- NOT EQUAL -- unconditionally, so `x != ""` was
 * TRUE even for a genuinely empty x, while `{x}` interpolated as empty and
 * `.len() == 0` still worked. Observed live on an x86_64 OVMF SimpleOS boot as
 *   [backend-resolve] override  rejected: Unknown backend:
 * (note the double space). This is hosted bug #148 -- fixed there by
 * rt_text_eq_any's tagged-or-raw normalization in runtime_native.c -- never
 * having been ported to the freestanding lane, which has no rt_text_eq_any at
 * all. (It did get the ORDERING counterpart rt_text_cmp_any, which is what
 * made the gap easy to miss.)
 *
 * Deliberately conservative, because TAG_INT is 0x0 here and a raw pointer is
 * therefore indistinguishable from a tagged small integer by tag bits alone
 * (that ambiguity already caused an untagged-smallint dereference --
 * doc/08_tracking/bug/native_text_eq_any_untagged_smallint_deref_2026-07-23.md).
 * Two guards keep it safe: the raw path is entered ONLY when the OTHER operand
 * is a proven HEAP_STRING, so a word is reinterpreted as char* only in a
 * known-TEXT comparison; and a plausibility floor rejects small words. The
 * scan is bounded by the heap string's own length and demands a NUL exactly at
 * that offset, so it never reads past the literal.
 *
 * Selfcheck: src/runtime/test/rt_native_eq_heap_vs_raw_empty_literal_selfcheck.c
 */
static int rt_text_eq_heap_vs_raw(RuntimeString *s, RuntimeValue raw)
{
    const char *p;
    uint32_t i;
    if ((uint64_t)raw < 0x10000ULL) return 0;               /* nil / bool / small int */
    if (((uint64_t)raw & TAG_MASK) == TAG_HEAP) return 0;   /* not a raw pointer */
    p = (const char *)(uintptr_t)raw;
    for (i = 0; i < s->len; i++) {
        if (p[i] == '\0' || p[i] != s->data[i]) return 0;
    }
    return p[s->len] == '\0';
}

/* Mixed heap-string vs raw char* literal: compare by CONTENT. Returns -1 when
 * neither side is a heap string (caller keeps its existing answer). */
static int rt_native_eq_mixed_text(RuntimeValue a, RuntimeValue b)
{
    if (IS_HEAP(a)) {
        HeapHeader *ha = (HeapHeader *)DECODE_PTR(a);
        if (ha && ha->type == HEAP_STRING)
            return rt_text_eq_heap_vs_raw((RuntimeString *)ha, b) ? 1 : 0;
    }
    if (IS_HEAP(b)) {
        HeapHeader *hb = (HeapHeader *)DECODE_PTR(b);
        if (hb && hb->type == HEAP_STRING)
            return rt_text_eq_heap_vs_raw((RuntimeString *)hb, a) ? 1 : 0;
    }
    return -1;
}

RuntimeValue rt_native_eq(RuntimeValue a, RuntimeValue b)
{
    if (a == b) return 1;
    if (IS_HEAP(a) && IS_HEAP(b)) {
        HeapHeader *ha = (HeapHeader *)DECODE_PTR(a);
        HeapHeader *hb = (HeapHeader *)DECODE_PTR(b);
        if (ha && hb && ha->type == HEAP_STRING && hb->type == HEAP_STRING) {
            RuntimeString *sa = (RuntimeString *)ha;
            RuntimeString *sb = (RuntimeString *)hb;
            if (sa->len != sb->len) return 0;
            for (uint32_t i = 0; i < sa->len; i++) {
                if (sa->data[i] != sb->data[i]) return 0;
            }
            return 1;
        }
        return 0;
    }
    {
        int mixed = rt_native_eq_mixed_text(a, b);
        if (mixed >= 0) return (RuntimeValue)mixed;
    }
    return 0;
}

RuntimeValue rt_native_neq(RuntimeValue a, RuntimeValue b)
{
    return rt_native_eq(a, b) ? 0 : 1;
}

RuntimeValue rt_string_data(RuntimeValue str)
{
    if (!IS_HEAP(str)) return 0;
    RuntimeString *s = (RuntimeString *)DECODE_PTR(str);
    if (!s) return 0;
    return (RuntimeValue)(uintptr_t)s->data;
}

RuntimeValue rt_string_slice(RuntimeValue str, RuntimeValue start, RuntimeValue end)
{
    if (!IS_HEAP(str)) return NIL_VALUE;
    RuntimeString *s = (RuntimeString *)DECODE_PTR(str);
    if (!s) return NIL_VALUE;
    int32_t a = DECODE_INT(start);
    int32_t b = DECODE_INT(end);
    if (a < 0) a = 0;
    if (b > (int32_t)s->len) b = (int32_t)s->len;
    if (a >= b) {
        RuntimeString *r = (RuntimeString *)malloc(sizeof(RuntimeString) + 1);
        if (!r) return NIL_VALUE;
        r->hdr.type = HEAP_STRING;
        r->hdr.size = (uint32_t)(sizeof(RuntimeString) + 1);
        r->len = 0;
        r->data[0] = '\0';
        return ENCODE_PTR(r);
    }
    uint32_t len = (uint32_t)(b - a);
    RuntimeString *r = (RuntimeString *)malloc(sizeof(RuntimeString) + len + 1);
    if (!r) return NIL_VALUE;
    r->hdr.type = HEAP_STRING;
    r->hdr.size = (uint32_t)(sizeof(RuntimeString) + len + 1);
    r->len = len;
    __builtin_memcpy(r->data, s->data + a, len);
    r->data[len] = '\0';
    return ENCODE_PTR(r);
}

RuntimeValue rt_len(RuntimeValue v)
{
    if (IS_INT(v)) return ENCODE_INT(0);
    if (!IS_HEAP(v)) return ENCODE_INT(0);
    HeapHeader *h = (HeapHeader *)DECODE_PTR(v);
    if (!h) return ENCODE_INT(0);
    if (h->type == HEAP_STRING) {
        RuntimeString *s = (RuntimeString *)h;
        return ENCODE_INT(s->len);
    }
    if (h->type == HEAP_ARRAY) {
        RuntimeArray *a = (RuntimeArray *)h;
        return ENCODE_INT(a->len);
    }
    return ENCODE_INT(0);
}

RuntimeValue rt_index_get(RuntimeValue v, RuntimeValue idx)
{
    if (!IS_HEAP(v)) return NIL_VALUE;
    HeapHeader *h = (HeapHeader *)DECODE_PTR(v);
    if (!h) return NIL_VALUE;
    if (h->type == HEAP_STRING) {
        if (!IS_INT(idx)) return NIL_VALUE;
        return rt_string_char_at(v, (RuntimeValue)DECODE_INT(idx));
    }
    if (h->type == HEAP_ARRAY) {
        int32_t i = DECODE_INT(idx);
        RuntimeArray *a = (RuntimeArray *)h;
        if (i < 0 || (uint32_t)i >= a->len) return NIL_VALUE;
        return a->items[i];
    }
    return NIL_VALUE;
}

RuntimeValue rt_index_set(RuntimeValue v, RuntimeValue idx, RuntimeValue val)
{
    if (!IS_HEAP(v)) return NIL_VALUE;
    HeapHeader *h = (HeapHeader *)DECODE_PTR(v);
    if (!h) return NIL_VALUE;
    int32_t i = DECODE_INT(idx);
    if (h->type == HEAP_ARRAY) {
        RuntimeArray *a = (RuntimeArray *)h;
        if (i < 0 || (uint32_t)i >= a->len) return NIL_VALUE;
        a->items[i] = val;
        return val;
    }
    return NIL_VALUE;
}

/* ===================================================================
 * 7. Print functions
 * =================================================================== */

void rt_print_str(RuntimeValue str)
{
    if (IS_HEAP(str)) {
        RuntimeString *s = (RuntimeString *)DECODE_PTR(str);
        if (s && s->hdr.type == HEAP_STRING && s->len < 0x100000) {
            for (uint32_t i = 0; i < s->len; i++) serial_putchar(s->data[i]);
            return;
        }
    }
    /* Fallback: try as raw pointer */
    if (str != 0) {
        RuntimeString *s = (RuntimeString *)(uintptr_t)str;
        if (s->hdr.type == HEAP_STRING && s->len < 0x100000) {
            for (uint32_t i = 0; i < s->len; i++) serial_putchar(s->data[i]);
        }
    }
}

void rt_println_str(RuntimeValue str)
{
    rt_print_str(str);
    serial_putchar('\r');
    serial_putchar('\n');
}

void rt_print_value(RuntimeValue val)
{
    if (val == 0 || IS_NIL(val)) {
        serial_puts("nil");
    } else if (IS_INT(val)) {
        serial_put_dec(DECODE_INT(val));
    } else if (IS_HEAP(val)) {
        HeapHeader *h = (HeapHeader *)DECODE_PTR(val);
        if (h && h->type == HEAP_STRING) rt_print_str(val);
        else { serial_puts("<object>"); }
    } else {
        /* Try as raw pointer */
        RuntimeString *s = (RuntimeString *)(uintptr_t)val;
        if (s->hdr.type == HEAP_STRING && s->len < 0x100000) rt_print_str(val);
        else serial_put_dec(val);
    }
}

void rt_println_value(RuntimeValue val)
{
    rt_print_value(val);
    serial_putchar('\r');
    serial_putchar('\n');
}

void rt_print_int(RuntimeValue val)
{
    serial_put_dec(DECODE_INT(val));
}

void rt_println_int(RuntimeValue val)
{
    serial_put_dec(DECODE_INT(val));
    serial_putchar('\r');
    serial_putchar('\n');
}

void rt_print_char(RuntimeValue val)
{
    serial_putchar((char)DECODE_INT(val));
}

void rt_print_hex(RuntimeValue val)
{
    serial_put_hex((uint32_t)DECODE_INT(val));
}

void rt_print_bool(RuntimeValue val)
{
    if (DECODE_INT(val)) serial_puts("true");
    else serial_puts("false");
}

void rt_println_bool(RuntimeValue val)
{
    rt_print_bool(val);
    serial_putchar('\r');
    serial_putchar('\n');
}

/* ===================================================================
 * 8. Framebuffer copy
 * =================================================================== */

void rt_framebuffer_copy(RuntimeValue dst, RuntimeValue src, RuntimeValue count)
{
    if (!IS_HEAP(dst) || !IS_HEAP(src)) return;
    uint8_t *d = (uint8_t *)DECODE_PTR(dst);
    const uint8_t *s = (const uint8_t *)DECODE_PTR(src);
    int32_t n = DECODE_INT(count);
    if (n <= 0) return;
    for (int32_t i = 0; i < n; i++) d[i] = s[i];
}

void rt_framebuffer_write(RuntimeValue addr, RuntimeValue offset, RuntimeValue val)
{
    if (!IS_HEAP(addr)) return;
    uint8_t *base = (uint8_t *)DECODE_PTR(addr);
    int32_t off = DECODE_INT(offset);
    int32_t v = DECODE_INT(val);
    base[off] = (uint8_t)v;
}

/* ===================================================================
 * 9. _start — serial init, spl_start, isa-debug-exit
 * =================================================================== */

static void _serial_init(void)
{
    outb(0x3F8 + 1, 0x00);
    outb(0x3F8 + 3, 0x80);
    outb(0x3F8 + 0, 0x01);
    outb(0x3F8 + 1, 0x00);
    outb(0x3F8 + 3, 0x03);
    outb(0x3F8 + 2, 0xC7);
    outb(0x3F8 + 4, 0x0B);
}

extern void spl_start(void) __attribute__((weak));

static uint32_t x86_32_initrd_start = 0;
static uint32_t x86_32_initrd_end = 0;

static void x86_32_capture_multiboot_modules(uint32_t magic, uint32_t mbi_addr)
{
    if (magic != 0x2BADB002U || mbi_addr == 0U) return;
    uint32_t *mbi = (uint32_t *)(uintptr_t)mbi_addr;
    uint32_t flags = mbi[0];
    if ((flags & (1U << 3)) == 0U) return;
    uint32_t mods_count = mbi[5];
    uint32_t mods_addr = mbi[6];
    if (mods_count == 0U || mods_addr == 0U) return;
    uint32_t *mod = (uint32_t *)(uintptr_t)mods_addr;
    if (mod[1] > mod[0]) {
        x86_32_initrd_start = mod[0];
        x86_32_initrd_end = mod[1];
    }
}

static int x86_32_initrd_contains_ascii(const char *needle)
{
    if (x86_32_initrd_start == 0U || x86_32_initrd_end <= x86_32_initrd_start) return 0;
    const uint8_t *base = (const uint8_t *)(uintptr_t)x86_32_initrd_start;
    uint32_t len = x86_32_initrd_end - x86_32_initrd_start;
    uint32_t needle_len = 0;
    while (needle[needle_len] != '\0') needle_len++;
    if (needle_len == 0U || len < needle_len) return 0;
    for (uint32_t i = 0; i + needle_len <= len; i++) {
        uint32_t j = 0;
        while (j < needle_len && base[i + j] == (uint8_t)needle[j]) j++;
        if (j == needle_len) return 1;
    }
    return 0;
}

RuntimeValue rt_x86_32_initrd_present(void)
{
    return (x86_32_initrd_end > x86_32_initrd_start) ? 1 : 0;
}

RuntimeValue rt_x86_32_initrd_contains_hello_smf(void)
{
    return x86_32_initrd_contains_ascii("HELLOSMF") ? 1 : 0;
}

RuntimeValue rt_x86_32_initrd_contains_browser_smf(void)
{
    return x86_32_initrd_contains_ascii("BROWSMF") ? 1 : 0;
}

RuntimeValue rt_x86_32_initrd_contains_x86_32_marker(void)
{
    if (x86_32_initrd_contains_ascii("SIMPLEOS_X86_32_HELLO_ELF")) return 1;
    return x86_32_initrd_contains_ascii("elf-machine=x86_32") ? 1 : 0;
}

/* Bounded FAT32 root-file reader for the Multiboot initrd.  Unlike the legacy
 * ASCII scan, this follows the BPB/FAT chain and accepts only the root dirent
 * named FSEXEC.ELF. */
typedef struct {
    const uint8_t *base;
    uint32_t bytes;
    uint32_t sector_bytes;
    uint32_t cluster_bytes;
    uint32_t fat_off;
    uint32_t fat_bytes;
    uint32_t data_off;
    uint32_t cluster_limit;
    uint32_t max_chain_hops;
    uint32_t root_cluster;
} X86_32Fat;

static uint16_t x86_32_le16(const uint8_t *p)
{ return (uint16_t)p[0] | ((uint16_t)p[1] << 8); }
static uint32_t x86_32_le32(const uint8_t *p)
{ return (uint32_t)p[0] | ((uint32_t)p[1] << 8) |
         ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24); }

static int x86_32_fat_mount_image(X86_32Fat *fs, const uint8_t *image,
                                  uint32_t bytes)
{
    uint32_t part_lba = 0, bpb_off = 0;
    if (!image || bytes < 512U) return 0;
    if (image[510] == 0x55 && image[511] == 0xAA && image[0] != 0xEB && image[0] != 0xE9)
        part_lba = x86_32_le32(image + 446 + 8);
    if (part_lba > bytes / 512U) return 0;
    bpb_off = part_lba * 512U;
    if (bpb_off > bytes || 512U > bytes - bpb_off) return 0;
    const uint8_t *bpb = image + bpb_off;
    uint32_t bps = x86_32_le16(bpb + 11);
    uint32_t spc = bpb[13], reserved = x86_32_le16(bpb + 14), fats = bpb[16];
    uint32_t fat_sectors = x86_32_le32(bpb + 36);
    uint32_t root = x86_32_le32(bpb + 44);
    if (bps != 512U || !spc || !reserved || !fats || !fat_sectors || root < 2U) return 0;
    uint32_t total_sectors = x86_32_le16(bpb + 19);
    if (!total_sectors) total_sectors = x86_32_le32(bpb + 32);
    if (!total_sectors || spc > 128U || reserved > 0xFFFFFFFFU / bps ||
        fat_sectors > 0xFFFFFFFFU / bps) return 0;
    uint32_t reserved_bytes = reserved * bps;
    uint32_t fat_bytes = fat_sectors * bps;
    if (fats > 0xFFFFFFFFU / fat_bytes) return 0;
    uint32_t all_fat_bytes = fats * fat_bytes;
    if (bpb_off > bytes || reserved_bytes > bytes - bpb_off) return 0;
    uint32_t fat_off = bpb_off + reserved_bytes;
    if (all_fat_bytes > bytes - fat_off) return 0;
    uint32_t data_off = fat_off + all_fat_bytes;
    if (total_sectors > (bytes - bpb_off) / bps) return 0;
    uint32_t volume_bytes = total_sectors * bps;
    if (reserved_bytes > volume_bytes || all_fat_bytes > volume_bytes - reserved_bytes) return 0;
    uint32_t data_bytes = volume_bytes - reserved_bytes - all_fat_bytes;
    uint32_t cluster_bytes = spc * bps;
    uint32_t data_clusters = data_bytes / cluster_bytes;
    uint32_t fat_entries = fat_bytes / 4U;
    uint32_t cluster_limit = data_clusters > 0xFFFFFFFDU ? 0xFFFFFFFFU : data_clusters + 2U;
    if (cluster_limit > fat_entries) cluster_limit = fat_entries;
    if (cluster_limit <= 2U || root >= cluster_limit || data_off >= bytes) return 0;
    fs->base = image; fs->bytes = bytes; fs->sector_bytes = bps;
    fs->cluster_bytes = cluster_bytes; fs->fat_off = fat_off;
    fs->fat_bytes = fat_bytes; fs->data_off = data_off;
    fs->cluster_limit = cluster_limit; fs->max_chain_hops = cluster_limit - 2U;
    fs->root_cluster = root;
    return 1;
}

static int x86_32_fat_mount(X86_32Fat *fs)
{
    if (x86_32_initrd_end <= x86_32_initrd_start) return 0;
    const uint8_t *image = (const uint8_t *)(uintptr_t)x86_32_initrd_start;
    uint32_t bytes = x86_32_initrd_end - x86_32_initrd_start;
    return x86_32_fat_mount_image(fs, image, bytes);
}

static uint32_t x86_32_fat_next(const X86_32Fat *fs, uint32_t cluster)
{
    if (cluster < 2U || cluster >= fs->cluster_limit || cluster > 0xFFFFFFFFU / 4U)
        return 0x0FFFFFFFU;
    uint32_t entry_off = cluster * 4U;
    if (entry_off > fs->fat_bytes || 4U > fs->fat_bytes - entry_off)
        return 0x0FFFFFFFU;
    uint32_t next = x86_32_le32(fs->base + fs->fat_off + entry_off) & 0x0FFFFFFFU;
    if (next >= 0x0FFFFFF8U) return next;
    if (next < 2U || next >= fs->cluster_limit || (next >= 0x0FFFFFF0U && next <= 0x0FFFFFF7U))
        return 0x0FFFFFFFU;
    return next;
}

static const uint8_t *x86_32_fat_cluster(const X86_32Fat *fs, uint32_t cluster)
{
    if (cluster < 2U || cluster >= fs->cluster_limit) return 0;
    uint32_t index = cluster - 2U;
    if (index > 0xFFFFFFFFU / fs->cluster_bytes) return 0;
    uint32_t delta = index * fs->cluster_bytes;
    if (delta > fs->bytes - fs->data_off) return 0;
    uint32_t off = fs->data_off + delta;
    if (off > fs->bytes || fs->cluster_bytes > fs->bytes - off) return 0;
    return fs->base + off;
}

static int x86_32_fat_find_root(const X86_32Fat *fs, const char name[11],
                                uint32_t *first, uint32_t *size)
{
    uint32_t cluster = fs->root_cluster;
    for (uint32_t hop = 0; hop < fs->max_chain_hops && cluster < 0x0FFFFFF8U; ++hop) {
        const uint8_t *dir = x86_32_fat_cluster(fs, cluster);
        if (!dir) return 0;
        for (uint32_t off = 0; off + 32U <= fs->cluster_bytes; off += 32U) {
            const uint8_t *e = dir + off;
            if (e[0] == 0) return 0;
            if (e[0] == 0xE5 || e[11] == 0x0F || (e[11] & 0x18U)) continue;
            uint32_t i = 0; while (i < 11U && e[i] == (uint8_t)name[i]) ++i;
            if (i == 11U) {
                *first = ((uint32_t)x86_32_le16(e + 20) << 16) | x86_32_le16(e + 26);
                *size = x86_32_le32(e + 28);
                return *first >= 2U && *first < fs->cluster_limit && *size > 0U;
            }
        }
        cluster = x86_32_fat_next(fs, cluster);
    }
    return 0;
}

static int x86_32_fat_read(const X86_32Fat *fs, uint32_t first, uint32_t file_size,
                           uint32_t offset, void *dst_value, uint32_t count)
{
    uint8_t *dst = (uint8_t *)dst_value;
    if (!fs->cluster_bytes || offset > file_size || count > file_size - offset) return 0;
    uint32_t cluster = first, skip = offset;
    uint32_t hops = 0;
    while (skip >= fs->cluster_bytes) {
        if (hops++ >= fs->max_chain_hops) return 0;
        cluster = x86_32_fat_next(fs, cluster); skip -= fs->cluster_bytes;
        if (cluster >= 0x0FFFFFF8U) return 0;
    }
    if (skip >= fs->cluster_bytes) return 0;
    while (count) {
        if (hops++ >= fs->max_chain_hops) return 0;
        const uint8_t *src = x86_32_fat_cluster(fs, cluster);
        if (!src) return 0;
        uint32_t n = fs->cluster_bytes - skip; if (n > count) n = count;
        for (uint32_t i = 0; i < n; ++i) dst[i] = src[skip + i];
        dst += n; count -= n; skip = 0;
        if (count) { cluster = x86_32_fat_next(fs, cluster); if (cluster >= 0x0FFFFFF8U) return 0; }
    }
    return 1;
}

/* Canonical evidence nonce: distinct from the workload nonce in QEMUNONC. */
RuntimeValue rt_sosix_collector_nonce_echo(void)
{
    static const char prefix[] = "SOSIX_COLLECTOR_RUN_NONCE=";
    uint8_t record[118];
    X86_32Fat fs;
    uint32_t first = 0;
    uint32_t file_size = 0;
    if (!x86_32_fat_mount(&fs) ||
        !x86_32_fat_find_root(&fs, "SOSIXNONTXT", &first, &file_size) ||
        file_size <= sizeof(prefix) - 1U || file_size > sizeof(record) ||
        !x86_32_fat_read(&fs, first, file_size, 0U, record, file_size))
        return 0;

    uint32_t prefix_len = (uint32_t)(sizeof(prefix) - 1U);
    for (uint32_t i = 0; i < prefix_len; ++i)
        if (record[i] != (uint8_t)prefix[i]) return 0;
    uint32_t end = prefix_len;
    while (end < file_size && record[end] != '\n') {
        uint8_t c = record[end];
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
              (c >= '0' && c <= '9') || c == '.' || c == '_' ||
              c == ':' || c == '-')) return 0;
        ++end;
    }
    if (end == prefix_len || end >= file_size || record[end] != '\n') return 0;
    uint32_t line_len = end + 1U;
    for (uint32_t i = line_len; i < file_size; ++i)
        if (record[i] != 0U) return 0;
    for (uint32_t i = 0; i < line_len; ++i) serial_putchar((char)record[i]);
    return 1;
}

RuntimeValue rt_x86_32_fat_hostile_self_test(void)
{
    uint8_t image[4096];
    for (uint32_t i = 0; i < sizeof(image); ++i) image[i] = 0;
    image[11] = 0; image[12] = 2; image[13] = 1; image[14] = 1;
    image[16] = 1; image[32] = 8; image[36] = 1; image[44] = 2;
    X86_32Fat fs;
    if (!x86_32_fat_mount_image(&fs, image, sizeof(image))) return 0;
    /* A cyclic chain plus an offset beyond every data cluster used to exhaust
     * the fixed skip loop and index beyond the selected cluster. */
    image[512 + 8] = 2;
    uint8_t canary[3] = {0xA5U, 0x5AU, 0xC3U};
    if (x86_32_fat_read(&fs, 2U, 0xFFFFFFFFU, 0x40000001U, canary + 1, 1U)) return 0;
    image[512 + 8] = 0xF7U; image[512 + 9] = 0xFFU;
    image[512 + 10] = 0xFFU; image[512 + 11] = 0x0FU;
    if (x86_32_fat_read(&fs, 2U, 1024U, 512U, canary + 1, 1U)) return 0;
    image[512 + 8] = 0xF8U;
    if (x86_32_fat_read(&fs, 2U, 1024U, 512U, canary + 1, 1U)) return 0;
    if (x86_32_fat_read(&fs, fs.cluster_limit, 1U, 0U, canary + 1, 1U)) return 0;
    if (canary[0] != 0xA5U || canary[1] != 0x5AU || canary[2] != 0xC3U) return 0;
    /* A BPB whose FAT product exceeds the image must be rejected before any
     * wrapped offset can become a trusted extent. */
    image[16] = 255U; image[36] = 0xFFU; image[37] = 0xFFU;
    image[38] = 0xFFU; image[39] = 0x7FU;
    if (x86_32_fat_mount_image(&fs, image, sizeof(image))) return 0;
    return 1;
}

/* The i386 QEMU lane owns a compact PAE address-space implementation.  It is
 * architecture-equivalent to the common VMM owner: physical backing is
 * allocated separately, mutable kernel heap aliases never cross into CPL3,
 * and every user PTE is installed with an explicit W^X policy. */
#define X86_32_PAGE_SIZE 4096U
#define X86_32_USER_BASE 0x40000000U
#define X86_32_USER_LIMIT 0x50000000U
#define X86_32_USER_STACK_BASE 0x4FFF0000U
#define X86_32_PAE_P 0x001ULL
#define X86_32_PAE_W 0x002ULL
#define X86_32_PAE_U 0x004ULL
#define X86_32_PAE_PS 0x080ULL
#define X86_32_PAE_NX (1ULL << 63)
#define X86_32_USER_PAGE_COUNT 96U
#define X86_32_PT_COUNT 8U

static uint64_t x86_32_pdpt[4] __attribute__((aligned(32)));
static uint64_t x86_32_pd[4][512] __attribute__((aligned(4096)));
static uint64_t x86_32_pt[X86_32_PT_COUNT][512] __attribute__((aligned(4096)));
static uint8_t x86_32_user_pages[X86_32_USER_PAGE_COUNT][X86_32_PAGE_SIZE]
    __attribute__((aligned(4096)));
static uint32_t x86_32_user_page_used;
static uint32_t x86_32_pt_used;
static uint32_t x86_32_user_cr3;
static uint32_t x86_32_loaded_entry;
static uint32_t x86_32_expected_fault_vector;
static uint32_t x86_32_expected_fault_eip;

static void x86_32_zero(void *ptr, uint32_t bytes)
{
    uint8_t *p = (uint8_t *)ptr;
    for (uint32_t i = 0; i < bytes; ++i) p[i] = 0;
}

static uint64_t *x86_32_user_pte(uint32_t va, int create)
{
    uint32_t pdpti = va >> 30;
    uint32_t pdi = (va >> 21) & 0x1FFU;
    uint32_t pti = (va >> 12) & 0x1FFU;
    uint64_t pde = x86_32_pd[pdpti][pdi];
    uint64_t *pt;
    if (!(pde & X86_32_PAE_P)) {
        if (!create || x86_32_pt_used >= X86_32_PT_COUNT) return 0;
        pt = x86_32_pt[x86_32_pt_used++];
        x86_32_zero(pt, X86_32_PAGE_SIZE);
        x86_32_pd[pdpti][pdi] = ((uint32_t)(uintptr_t)pt & ~0xFFFU) |
                                X86_32_PAE_P | X86_32_PAE_W | X86_32_PAE_U;
    } else {
        if (pde & X86_32_PAE_PS) return 0;
        pt = (uint64_t *)(uintptr_t)((uint32_t)pde & ~0xFFFU);
    }
    return &pt[pti];
}

static int x86_32_map_user_page(uint32_t va, int writable, int executable,
                                uint8_t **kernel_alias)
{
    if ((va & 0xFFFU) || va < X86_32_USER_BASE || va >= X86_32_USER_LIMIT ||
        (writable && executable) || x86_32_user_page_used >= X86_32_USER_PAGE_COUNT)
        return 0;
    uint64_t *pte = x86_32_user_pte(va, 1);
    if (!pte || (*pte & X86_32_PAE_P)) return 0;
    uint8_t *page = x86_32_user_pages[x86_32_user_page_used++];
    x86_32_zero(page, X86_32_PAGE_SIZE);
    uint64_t flags = X86_32_PAE_P | X86_32_PAE_U;
    if (writable) flags |= X86_32_PAE_W;
    if (!executable) flags |= X86_32_PAE_NX;
    *pte = ((uint32_t)(uintptr_t)page & ~0xFFFU) | flags;
    *kernel_alias = page;
    return 1;
}

static int x86_32_prepare_user_address_space(void)
{
    x86_32_zero(x86_32_pdpt, sizeof(x86_32_pdpt));
    x86_32_zero(x86_32_pd, sizeof(x86_32_pd));
    x86_32_zero(x86_32_pt, sizeof(x86_32_pt));
    x86_32_user_page_used = 0;
    x86_32_pt_used = 0;
    for (uint32_t i = 0; i < 4U; ++i)
        x86_32_pdpt[i] = ((uint32_t)(uintptr_t)x86_32_pd[i] & ~0xFFFU) | X86_32_PAE_P;
    /* Map the complete kernel/static owner aperture supervisor-only.  Large
     * pages are used only for the kernel identity map; no user bit appears. */
    extern uint8_t _kernel_end;
    uint32_t kernel_end = ((uint32_t)(uintptr_t)&_kernel_end + 0x1FFFFFU) & ~0x1FFFFFU;
    for (uint32_t pa = 0; pa < kernel_end; pa += 0x200000U)
        x86_32_pd[pa >> 30][(pa >> 21) & 0x1FFU] =
            (uint64_t)pa | X86_32_PAE_P | X86_32_PAE_W | X86_32_PAE_PS;
    x86_32_user_cr3 = (uint32_t)(uintptr_t)x86_32_pdpt;
    return (x86_32_user_cr3 & 31U) == 0U;
}

static int x86_32_enable_pae_nx(void)
{
    uint32_t eax, edx;
    __asm__ volatile("mov $0x80000001,%%eax; cpuid" : "=d"(edx) : : "eax", "ebx", "ecx");
    if (!(edx & (1U << 20))) return 0;
    __asm__ volatile("mov $0xC0000080,%%ecx; rdmsr; or $0x800,%%eax; wrmsr"
                     : "=a"(eax), "=d"(edx) : : "ecx", "memory");
    /* PAE supplies the 64-bit entries/NX bit; PSE is also required because
     * the supervisor identity aperture deliberately uses 2 MiB PDEs. */
    __asm__ volatile("mov %%cr4,%%eax; or $0x30,%%eax; mov %%eax,%%cr4"
                     : : : "eax", "memory");
    __asm__ volatile("mov %0,%%cr3; mov %%cr0,%%eax; or $0x80000000,%%eax; mov %%eax,%%cr0"
                     : : "r"(x86_32_user_cr3) : "eax", "memory");
    return 1;
}

static int x86_32_fat_find_child(const X86_32Fat *fs, uint32_t dir_cluster,
                                 const char name[11], uint8_t required_attr,
                                 uint32_t *first, uint32_t *size)
{
    uint32_t cluster = dir_cluster;
    for (uint32_t hop = 0; hop < fs->max_chain_hops && cluster < 0x0FFFFFF8U; ++hop) {
        const uint8_t *dir = x86_32_fat_cluster(fs, cluster);
        if (!dir) return 0;
        for (uint32_t off = 0; off + 32U <= fs->cluster_bytes; off += 32U) {
            const uint8_t *e = dir + off;
            if (e[0] == 0) return 0;
            if (e[0] == 0xE5 || e[11] == 0x0F || (e[11] & 0x08U)) continue;
            uint32_t i = 0; while (i < 11U && e[i] == (uint8_t)name[i]) ++i;
            if (i == 11U && (!required_attr || (e[11] & required_attr))) {
                *first = ((uint32_t)x86_32_le16(e + 20) << 16) | x86_32_le16(e + 26);
                *size = x86_32_le32(e + 28);
                return *first >= 2U && *first < fs->cluster_limit;
            }
        }
        cluster = x86_32_fat_next(fs, cluster);
    }
    return 0;
}

RuntimeValue rt_x86_32_fs_list_apps(void)
{
    X86_32Fat fs; uint32_t sys, apps, ignored;
    static const char sys_name[11] = {'S','Y','S',' ',' ',' ',' ',' ',' ',' ',' '};
    static const char apps_name[11] = {'A','P','P','S',' ',' ',' ',' ',' ',' ',' '};
    if (!x86_32_fat_mount(&fs) ||
        !x86_32_fat_find_child(&fs, fs.root_cluster, sys_name, 0x10U, &sys, &ignored) ||
        !x86_32_fat_find_child(&fs, sys, apps_name, 0x10U, &apps, &ignored)) return 0;
    serial_puts("FS_LS_BEGIN path=/SYS/APPS\r\n");
    uint32_t count = 0, cluster = apps;
    for (uint32_t hop = 0; hop < fs.max_chain_hops && cluster < 0x0FFFFFF8U; ++hop) {
        const uint8_t *dir = x86_32_fat_cluster(&fs, cluster);
        if (!dir) return 0;
        for (uint32_t off = 0; off + 32U <= fs.cluster_bytes; off += 32U) {
            const uint8_t *e = dir + off;
            if (e[0] == 0) { cluster = 0x0FFFFFFFU; break; }
            if (e[0] == 0xE5 || e[11] == 0x0F || (e[11] & 0x18U)) continue;
            serial_puts("FS_LS_ENTRY name=");
            for (uint32_t i = 0; i < 8U && e[i] != ' '; ++i) serial_putchar((char)e[i]);
            if (e[8] != ' ') { serial_putchar('.'); for (uint32_t i = 8; i < 11U && e[i] != ' '; ++i) serial_putchar((char)e[i]); }
            serial_puts("\r\n"); count++;
        }
        if (cluster < 0x0FFFFFF8U) cluster = x86_32_fat_next(&fs, cluster);
    }
    serial_puts("FS_LS_END status=pass\r\n");
    return count ? 1 : 0;
}

static uint32_t x86_32_fs_exec_status;
RuntimeValue rt_x86_32_fs_exec_status(void) { return x86_32_fs_exec_status; }

static int x86_32_elf_header_valid(const uint8_t eh[52])
{
    return eh[0] == 0x7F && eh[1] == 'E' && eh[2] == 'L' && eh[3] == 'F' &&
           eh[4] == 1 && eh[5] == 1 && eh[6] == 1 && x86_32_le16(eh + 16) == 2 &&
           x86_32_le16(eh + 18) == 3 && x86_32_le32(eh + 20) == 1U &&
           x86_32_le16(eh + 40) == 52U;
}

static int x86_32_load_shape_valid(uint32_t off, uint32_t va, uint32_t filesz,
                                   uint32_t memsz, uint32_t flags, uint32_t align,
                                   uint32_t file_size)
{
    if ((flags & 2U) && (flags & 1U)) return 0;
    if (align > X86_32_PAGE_SIZE || (align > 1U && (align & (align - 1U))) ||
        (align > 1U && (va & (align - 1U)) != (off & (align - 1U)))) return 0;
    return va >= X86_32_USER_BASE && va < X86_32_USER_STACK_BASE && memsz &&
           memsz >= filesz && memsz <= 0x200000U &&
           va <= X86_32_USER_STACK_BASE - memsz && off <= file_size &&
           filesz <= file_size - off;
}

RuntimeValue rt_x86_32_elf_policy_self_test(void)
{
    uint8_t eh[52]; x86_32_zero(eh, sizeof(eh));
    eh[0] = 0x7F; eh[1] = 'E'; eh[2] = 'L'; eh[3] = 'F'; eh[4] = 1; eh[5] = 1; eh[6] = 1;
    eh[16] = 2; eh[18] = 3; eh[20] = 1; eh[40] = 52;
    if (!x86_32_elf_header_valid(eh)) return 0;
    eh[16] = 3; if (x86_32_elf_header_valid(eh)) return 0; eh[16] = 2;
    eh[6] = 0; if (x86_32_elf_header_valid(eh)) return 0; eh[6] = 1;
    eh[20] = 0; if (x86_32_elf_header_valid(eh)) return 0; eh[20] = 1;
    eh[40] = 51; if (x86_32_elf_header_valid(eh)) return 0;
    if (!x86_32_load_shape_valid(0x1000U, X86_32_USER_BASE, 16U, 32U, 5U,
                                 0x1000U, 0x4000U)) return 0;
    if (x86_32_load_shape_valid(0x1000U, X86_32_USER_BASE, 16U, 32U, 7U,
                                0x1000U, 0x4000U)) return 0;
    if (x86_32_load_shape_valid(0x1001U, X86_32_USER_BASE, 16U, 32U, 5U,
                                0x1000U, 0x4000U)) return 0;
    if (x86_32_load_shape_valid(0x3FF8U, X86_32_USER_BASE, 16U, 32U, 5U,
                                1U, 0x4000U)) return 0;
    return 1;
}
RuntimeValue rt_x86_32_fs_exec_status_report(void)
{
    serial_puts("FS_PROGRAM_LOAD_FAIL status=");
    serial_put_dec((int32_t)x86_32_fs_exec_status);
    serial_puts("\r\n");
    return NIL_VALUE;
}

RuntimeValue rt_x86_32_fs_exec_load(void)
{
    X86_32Fat fs; uint32_t first, size; uint8_t eh[52];
    static const char name[11] = {'F','S','E','X','E','C',' ',' ','E','L','F'};
    x86_32_fs_exec_status = 1;
    if (!x86_32_fat_mount(&fs)) return 0;
    x86_32_fs_exec_status = 2;
    if (!x86_32_fat_find_root(&fs, name, &first, &size)) return 0;
    x86_32_fs_exec_status = 3;
    if (!x86_32_fat_read(&fs, first, size, 0, eh, sizeof(eh))) return 0;
    x86_32_fs_exec_status = 4;
    if (!x86_32_elf_header_valid(eh)) return 0;
    uint32_t phoff = x86_32_le32(eh + 28); uint16_t phentsz = x86_32_le16(eh + 42);
    uint16_t phnum = x86_32_le16(eh + 44); uint32_t entry = x86_32_le32(eh + 24);
    x86_32_fs_exec_status = 5;
    if (phentsz != 32U) { x86_32_fs_exec_status = 51; return 0; }
    if (!phnum || phnum > 16U) { x86_32_fs_exec_status = 52; return 0; }
    if (phoff > size || (uint32_t)phnum > (size - phoff) / 32U) {
        x86_32_fs_exec_status = 53; return 0;
    }
    if (entry < X86_32_USER_BASE || entry >= X86_32_USER_LIMIT) {
        x86_32_fs_exec_status = 54; return 0;
    }
    uint32_t load_first[16], load_last[16];
    uint32_t load_count = 0;
    /* Validate the complete load plan before allocating a single page. */
    for (uint16_t i = 0; i < phnum; ++i) {
        uint8_t ph[32];
        if (!x86_32_fat_read(&fs, first, size, phoff + (uint32_t)i * 32U, ph, 32U)) {
            x86_32_fs_exec_status = 57; return 0;
        }
        if (x86_32_le32(ph) != 1U) continue;
        if (load_count >= 16U) { x86_32_fs_exec_status = 58; return 0; }
        uint32_t off = x86_32_le32(ph + 4), va = x86_32_le32(ph + 8);
        uint32_t filesz = x86_32_le32(ph + 16), memsz = x86_32_le32(ph + 20);
        uint32_t flags = x86_32_le32(ph + 24), align = x86_32_le32(ph + 28);
        if (!x86_32_load_shape_valid(off, va, filesz, memsz, flags, align, size)) {
            x86_32_fs_exec_status = 61; return 0;
        }
        uint32_t page_first = va & ~0xFFFU;
        uint32_t page_last = (va + memsz + 0xFFFU) & ~0xFFFU;
        if (page_last <= page_first) { x86_32_fs_exec_status = 62; return 0; }
        for (uint32_t j = 0; j < load_count; ++j) {
            if (page_first < load_last[j] && load_first[j] < page_last) {
                x86_32_fs_exec_status = 63; return 0;
            }
        }
        load_first[load_count] = page_first;
        load_last[load_count] = page_last;
        load_count++;
    }
    if (!load_count) { x86_32_fs_exec_status = 64; return 0; }
    if (!x86_32_prepare_user_address_space()) { x86_32_fs_exec_status = 55; return 0; }
    int entry_executable = 0;
    for (uint16_t i = 0; i < phnum; ++i) {
        uint8_t ph[32];
        x86_32_fs_exec_status = 6;
        if (!x86_32_fat_read(&fs, first, size, phoff + (uint32_t)i * 32U, ph, 32U)) return 0;
        if (x86_32_le32(ph) != 1U) continue;
        uint32_t off = x86_32_le32(ph + 4), va = x86_32_le32(ph + 8);
        uint32_t filesz = x86_32_le32(ph + 16), memsz = x86_32_le32(ph + 20);
        uint32_t flags = x86_32_le32(ph + 24);
        int writable = (flags & 2U) != 0, executable = (flags & 1U) != 0;
        if (writable && executable) { x86_32_fs_exec_status = 8; return 0; }
        if (va < X86_32_USER_BASE || va >= X86_32_USER_STACK_BASE || memsz < filesz ||
            memsz == 0 || memsz > 0x200000U || va + memsz < va ||
            va + memsz > X86_32_USER_STACK_BASE || off > size || filesz > size - off)
            return 0;
        uint32_t first_page = va & ~0xFFFU;
        uint32_t last_page = (va + memsz + 0xFFFU) & ~0xFFFU;
        for (uint32_t page_va = first_page; page_va < last_page; page_va += X86_32_PAGE_SIZE) {
            uint8_t *alias;
            if (!x86_32_map_user_page(page_va, writable, executable, &alias)) return 0;
            uint32_t copy_begin = page_va > va ? page_va : va;
            uint32_t copy_end = page_va + X86_32_PAGE_SIZE;
            if (copy_end > va + filesz) copy_end = va + filesz;
            if (copy_end > copy_begin &&
                !x86_32_fat_read(&fs, first, size, off + copy_begin - va,
                                  alias + copy_begin - page_va, copy_end - copy_begin)) return 0;
        }
        if (executable && entry >= va && entry < va + memsz) entry_executable = 1;
    }
    if (!entry_executable) { x86_32_fs_exec_status = 9; return 0; }
    for (uint32_t va = X86_32_USER_STACK_BASE; va < X86_32_USER_STACK_BASE + 0x4000U; va += 0x1000U) {
        uint8_t *alias;
        if (!x86_32_map_user_page(va, 1, 0, &alias)) return 0;
    }
    /* The Multiboot module is bootloader-owned physical memory outside the
     * kernel aperture. Finish every FAT read before enabling the restricted
     * address space; afterward only dedicated user frames remain reachable. */
    if (!x86_32_enable_pae_nx()) { x86_32_fs_exec_status = 56; return 0; }
    x86_32_loaded_entry = entry;
    x86_32_fs_exec_status = 100;
    return (RuntimeValue)entry;
}

RuntimeValue rt_x86_32_user_stack_top(void)
{
    return (RuntimeValue)(X86_32_USER_STACK_BASE + 0x4000U - 16U);
}

RuntimeValue rt_x86_32_security_contract(void)
{
    uint64_t kernel_pde = x86_32_pd[0][0];
    uint64_t *entry_pte = x86_32_user_pte(x86_32_loaded_entry & ~0xFFFU, 0);
    uint64_t *stack_pte = x86_32_user_pte(X86_32_USER_STACK_BASE, 0);
    if (!entry_pte || !stack_pte || (kernel_pde & X86_32_PAE_U) ||
        !(*entry_pte & X86_32_PAE_U) || (*entry_pte & X86_32_PAE_W) ||
        (*entry_pte & X86_32_PAE_NX) || !(*stack_pte & X86_32_PAE_U) ||
        !(*stack_pte & X86_32_PAE_W) || !(*stack_pte & X86_32_PAE_NX)) return 0;
    return 1;
}

RuntimeValue rt_x86_32_fault_probe_entry(RuntimeValue kind)
{
    if ((uint32_t)kind == 13U) {
        const uint32_t va = 0x4FFE0000U;
        uint8_t *alias;
        uint64_t *pte = x86_32_user_pte(va, 0);
        if (!pte || !(*pte & X86_32_PAE_P)) {
            if (!x86_32_map_user_page(va, 0, 1, &alias)) return 0;
        } else {
            alias = (uint8_t *)(uintptr_t)((uint32_t)*pte & ~0xFFFU);
        }
        alias[0] = 0xFA; /* cli: privileged at CPL3, deterministically #GP(0). */
        alias[1] = 0xF4;
        __asm__ volatile("invlpg (%0)" : : "r"(va) : "memory");
        x86_32_expected_fault_vector = 13U;
        x86_32_expected_fault_eip = va;
        return va;
    }
    if ((uint32_t)kind == 14U) {
        /* Executing the already-present RW+NX stack page must raise #PF with
         * the instruction-fetch bit, proving hardware—not metadata—W^X. */
        uint64_t *pte = x86_32_user_pte(X86_32_USER_STACK_BASE, 0);
        if (!pte || !(*pte & X86_32_PAE_P)) return 0;
        uint8_t *alias = (uint8_t *)(uintptr_t)((uint32_t)*pte & ~0xFFFU);
        alias[0] = 0xF4;
        x86_32_expected_fault_vector = 14U;
        x86_32_expected_fault_eip = X86_32_USER_STACK_BASE;
        return X86_32_USER_STACK_BASE;
    }
    return 0;
}

void _start(uint32_t multiboot_magic, uint32_t multiboot_info)
{
    x86_32_capture_multiboot_modules(multiboot_magic, multiboot_info);
    _serial_init();

    serial_puts("SimpleOS x86_32 boot\r\n");
    serial_puts("[BOOT] COM1 serial initialized at 115200 baud\r\n");
    serial_puts("[BOOT] Heap: 4 MB bump allocator\r\n");
    serial_puts("[BOOT] RuntimeValue: tagged 32-bit (int/heap/float/special)\r\n");
    x86_32_harden_print_canary();

    if (spl_start) {
        serial_puts("[BOOT] Calling spl_start()...\r\n");
        spl_start();
        serial_puts("[BOOT] spl_start() returned\r\n");
    } else {
        serial_puts("[BOOT] No spl_start() found (weak symbol)\r\n");
    }

    serial_puts("[BOOT] x86_32 boot complete\r\n");

    /* isa-debug-exit: writing to port 0xF4 causes QEMU to exit */
    outb(0xF4, 0x00);

    /* If that didn't work, halt forever */
    for (;;) {
        __asm__ volatile("hlt");
    }
}

/* ===================================================================
 * 9b. Enum / Optional / Result operations
 * =================================================================== */

RuntimeValue rt_enum_new(RuntimeValue enum_id_rv, RuntimeValue disc_rv, RuntimeValue payload)
{
    RuntimeEnum *e = (RuntimeEnum *)malloc(sizeof(RuntimeEnum));
    if (!e) return NIL_VALUE;
    e->hdr.type = HEAP_ENUM;
    e->hdr.size = (uint32_t)sizeof(RuntimeEnum);
    e->enum_id = (uint32_t)(int32_t)enum_id_rv;
    e->discriminant = (uint32_t)(int32_t)disc_rv;
    e->payload = payload;
    return ENCODE_PTR(e);
}

RuntimeValue rt_enum_discriminant(RuntimeValue value)
{
    if (!IS_HEAP(value)) return -1;
    RuntimeEnum *e = (RuntimeEnum *)DECODE_PTR(value);
    if (!e || e->hdr.type != HEAP_ENUM) return -1;
    return (RuntimeValue)(int32_t)e->discriminant;
}

RuntimeValue rt_enum_payload(RuntimeValue value)
{
    if (!IS_HEAP(value)) return value;
    RuntimeEnum *e = (RuntimeEnum *)DECODE_PTR(value);
    if (!e || e->hdr.type != HEAP_ENUM) return value;
    return e->payload;
}

RuntimeValue rt_enum_check_discriminant(RuntimeValue value, RuntimeValue expected)
{
    if (!IS_HEAP(value)) return 0;
    RuntimeEnum *e = (RuntimeEnum *)DECODE_PTR(value);
    if (!e || e->hdr.type != HEAP_ENUM) return 0;
    return (e->discriminant == (uint32_t)(int32_t)expected) ? 1 : 0;
}

RuntimeValue rt_is_none(RuntimeValue value)
{
    if (IS_NIL(value)) return 1;
    if (!IS_HEAP(value)) return 0;
    RuntimeEnum *e = (RuntimeEnum *)DECODE_PTR(value);
    if (!e || e->hdr.type != HEAP_ENUM) return 0;
    return IS_NIL(e->payload) ? 1 : 0;
}

RuntimeValue rt_is_some(RuntimeValue value)
{
    return rt_is_none(value) ? 0 : 1;
}

RuntimeValue rt_array_new(RuntimeValue cap_val)
{
    int32_t cap = (int32_t)cap_val;
    if (cap <= 0) cap = 64;
    if (cap < 64) cap = 64;
    if (cap > 0x100000) cap = 0x100000;
    size_t alloc_size = sizeof(RuntimeArray) + (size_t)cap * sizeof(RuntimeValue);
    RuntimeArray *a = (RuntimeArray *)malloc(alloc_size);
    if (!a) return NIL_VALUE;
    a->hdr.type = HEAP_ARRAY;
    a->hdr.size = (uint32_t)alloc_size;
    a->len = 0;
    a->cap = (uint32_t)cap;
    for (int32_t i = 0; i < cap; i++) a->items[i] = NIL_VALUE;
    return ENCODE_PTR(a);
}

static RuntimeValue rt_array_push_handle(RuntimeValue arr, RuntimeValue val)
{
    if (!IS_HEAP(arr)) return NIL_VALUE;
    RuntimeArray *a = (RuntimeArray *)DECODE_PTR(arr);
    if (!a || a->hdr.type != HEAP_ARRAY) return NIL_VALUE;
    if (a->len >= a->cap) {
        uint32_t old_cap = a->cap;
        uint32_t new_cap = old_cap ? old_cap * 2 : 64;
        size_t new_size = sizeof(RuntimeArray) + (size_t)new_cap * sizeof(RuntimeValue);
        RuntimeArray *grown = (RuntimeArray *)realloc(a, new_size);
        if (!grown) return ENCODE_PTR(a);
        grown->hdr.size = (uint32_t)new_size;
        grown->cap = new_cap;
        for (uint32_t i = old_cap; i < new_cap; i++) grown->items[i] = NIL_VALUE;
        a = grown;
    }
    a->items[a->len++] = val;
    return ENCODE_PTR(a);
}

int8_t rt_array_push(RuntimeValue arr, RuntimeValue val)
{
    return rt_array_push_handle(arr, val) != NIL_VALUE;
}

RuntimeValue rt_array_get(RuntimeValue arr, RuntimeValue idx)
{
    if (!IS_HEAP(arr)) return NIL_VALUE;
    RuntimeArray *a = (RuntimeArray *)DECODE_PTR(arr);
    int32_t i = (int32_t)idx;
    if (!a || a->hdr.type != HEAP_ARRAY || i < 0 || (uint32_t)i >= a->len) return NIL_VALUE;
    return a->items[i];
}

RuntimeValue rt_array_len(RuntimeValue arr)
{
    if (!IS_HEAP(arr)) return 0;
    RuntimeArray *a = (RuntimeArray *)DECODE_PTR(arr);
    return (!a || a->hdr.type != HEAP_ARRAY) ? 0 : (RuntimeValue)a->len;
}

RuntimeValue rt_string_chars(RuntimeValue str)
{
    RuntimeString *s = IS_HEAP(str) ? (RuntimeString *)DECODE_PTR(str) : (RuntimeString *)0;
    RuntimeValue arr = rt_array_new((RuntimeValue)(s && s->hdr.type == HEAP_STRING ? s->len : 0));
    if (!s || s->hdr.type != HEAP_STRING) return arr;
    for (uint32_t i = 0; i < s->len;) {
        uint8_t lead = (uint8_t)s->data[i];
        uint32_t width = 1;
        if (lead >= 0xC2 && lead <= 0xDF && i + 2 <= s->len) width = 2;
        else if (lead >= 0xE0 && lead <= 0xEF && i + 3 <= s->len) width = 3;
        else if (lead >= 0xF0 && lead <= 0xF4 && i + 4 <= s->len) width = 4;
        arr = rt_array_push_handle(arr, rt_string_new((RuntimeValue)(uintptr_t)&s->data[i], (RuntimeValue)width));
        i += width;
    }
    return arr;
}

/* ===================================================================
 * 10. No-op stubs — macro-generated runtime function stubs
 * =================================================================== */

#define S0(n) RuntimeValue n(void) { return 0; }
#define S1(n) RuntimeValue n(RuntimeValue a) { (void)a; return 0; }
#define S2(n) RuntimeValue n(RuntimeValue a, RuntimeValue b) { (void)a; (void)b; return 0; }
#define S3(n) RuntimeValue n(RuntimeValue a, RuntimeValue b, RuntimeValue c) { (void)a; (void)b; (void)c; return 0; }
#define S4(n) RuntimeValue n(RuntimeValue a, RuntimeValue b, RuntimeValue c, RuntimeValue d) { (void)a; (void)b; (void)c; (void)d; return 0; }
#define S5(n) RuntimeValue n(RuntimeValue a, RuntimeValue b, RuntimeValue c, RuntimeValue d, RuntimeValue e) { (void)a; (void)b; (void)c; (void)d; (void)e; return 0; }

#define V0(n) void n(void) {}
#define V1(n) void n(RuntimeValue a) { (void)a; }
#define V2(n) void n(RuntimeValue a, RuntimeValue b) { (void)a; (void)b; }

/* --- Arithmetic / comparison --- */
S2(rt_add) S2(rt_sub) S2(rt_mul) S2(rt_div) S2(rt_mod) S2(rt_pow)
S2(rt_eq) S2(rt_ne) S2(rt_lt) S2(rt_gt) S2(rt_le) S2(rt_ge)
S2(rt_and) S2(rt_or) S1(rt_not)
S2(rt_shl) S2(rt_shr) S2(rt_bitand) S2(rt_bitor) S2(rt_bitxor)
S1(rt_bitnot) S1(rt_neg)

/* --- Type introspection / conversion --- */
S1(rt_type_of) S1(rt_is_nil) S1(rt_is_int) S1(rt_is_float)
S1(rt_is_string) S1(rt_is_bool) S1(rt_is_array) S1(rt_is_map)
S1(rt_is_object) S1(rt_to_int) S1(rt_to_float) S1(rt_to_string)
S1(rt_to_bool) S1(rt_clone) S1(rt_freeze) S1(rt_is_frozen)

/* --- String extras --- */
S2(rt_string_contains) S2(rt_string_starts_with) S2(rt_string_ends_with)
S2(rt_string_index_of) S2(rt_string_last_index_of)
S2(rt_string_substr) S2(rt_string_split)
S1(rt_string_trim) S1(rt_string_trim_start) S1(rt_string_trim_end)
S1(rt_string_to_upper) S1(rt_string_to_lower)
S2(rt_string_repeat)
S2(rt_string_pad_start) S2(rt_string_pad_end)
S1(rt_string_reverse) S1(rt_string_bytes)
S1(rt_string_is_empty) S2(rt_string_compare) S2(rt_string_format)

RuntimeValue rt_string_replace_all(RuntimeValue str, RuntimeValue old_val, RuntimeValue new_val)
{
    if (!IS_HEAP(str) || !IS_HEAP(old_val) || !IS_HEAP(new_val)) return NIL_VALUE;
    RuntimeString *s = IS_HEAP(str) ? (RuntimeString *)DECODE_PTR(str) : (RuntimeString *)0;
    RuntimeString *o = IS_HEAP(old_val) ? (RuntimeString *)DECODE_PTR(old_val) : (RuntimeString *)0;
    RuntimeString *n = IS_HEAP(new_val) ? (RuntimeString *)DECODE_PTR(new_val) : (RuntimeString *)0;
    if (!s || !o || !n || s->hdr.type != HEAP_STRING || o->hdr.type != HEAP_STRING || n->hdr.type != HEAP_STRING) return NIL_VALUE;
    if (o->len == 0 || o->len > s->len) return str;
    uint32_t nlen = n->len;
    uint32_t count = 0;
    for (uint32_t i = 0; o->len <= s->len - i;) {
        uint32_t j;
        for (j = 0; j < o->len; j++) if (s->data[i + j] != o->data[j]) break;
        if (j == o->len) { count++; i += o->len; } else i++;
    }
    if (count == 0) return str;
    uint64_t result_len_wide = (uint64_t)s->len - (uint64_t)count * o->len + (uint64_t)count * nlen;
    if (result_len_wide > 0x100000U) return str;
    uint32_t result_len = (uint32_t)result_len_wide;
    RuntimeString *r = (RuntimeString *)malloc(sizeof(RuntimeString) + result_len + 1);
    if (!r) return str;
    r->hdr.type = HEAP_STRING;
    r->hdr.size = (uint32_t)(sizeof(RuntimeString) + result_len + 1);
    r->len = result_len;
    uint32_t out = 0;
    for (uint32_t i = 0; i < s->len;) {
        if (o->len <= s->len - i) {
            uint32_t j;
            for (j = 0; j < o->len; j++) if (s->data[i + j] != o->data[j]) break;
            if (j == o->len) {
                if (nlen > 0) { __builtin_memcpy(r->data + out, n->data, nlen); out += nlen; }
                i += o->len;
                continue;
            }
        }
        r->data[out++] = s->data[i++];
    }
    r->data[result_len] = '\0';
    return ENCODE_PTR(r);
}

RuntimeValue rt_string_replace(RuntimeValue str, RuntimeValue old_val, RuntimeValue new_val)
{
    return rt_string_replace_all(str, old_val, new_val);
}

/* --- Array --- */
S1(rt_array_pop) S3(rt_array_set)
S3(rt_array_slice) S2(rt_array_contains) S2(rt_array_index_of)
S2(rt_array_last_index_of) S2(rt_array_remove) S3(rt_array_insert)
S1(rt_array_reverse) S1(rt_array_sort) S2(rt_array_sort_by)
S2(rt_array_map) S2(rt_array_filter) S3(rt_array_reduce)
S2(rt_array_for_each) S2(rt_array_find) S2(rt_array_find_index)
S2(rt_array_every) S2(rt_array_some) S2(rt_array_join)
S2(rt_array_concat) S1(rt_array_clear) S1(rt_array_flatten)
S2(rt_array_fill) S1(rt_array_clone) S2(rt_array_zip)
S1(rt_array_uniq) S1(rt_array_compact)

/* --- Map / Dictionary --- */
S0(rt_map_new) S3(rt_map_set) S2(rt_map_get) S2(rt_map_has)
S2(rt_map_remove) S1(rt_map_keys) S1(rt_map_values)
S1(rt_map_entries) S1(rt_map_len) S1(rt_map_clear)
S1(rt_map_clone) S2(rt_map_merge) S2(rt_map_for_each)

/* --- File I/O --- */
S1(rt_file_read) S2(rt_file_write) S1(rt_file_exists) S1(rt_file_delete)
S2(rt_file_append) S1(rt_file_size) S2(rt_file_copy) S2(rt_file_move)
S2(rt_file_rename) S1(rt_file_is_dir) S1(rt_file_is_file)
S1(rt_file_read_bytes) S2(rt_file_write_bytes) S1(rt_file_stat) S1(rt_file_realpath)

/* --- Directory I/O --- */
S1(rt_dir_list) S1(rt_dir_create) S1(rt_dir_create_all)
S1(rt_dir_exists) S1(rt_dir_remove) S1(rt_dir_remove_all)
S0(rt_dir_cwd) S1(rt_dir_chdir) S0(rt_dir_home) S0(rt_dir_temp)

/* --- Process --- */
S2(rt_process_run) S3(rt_process_run_timeout) S1(rt_process_spawn)
S1(rt_process_kill) S1(rt_process_wait) S0(rt_process_pid)
S1(rt_cli_get_args) S0(rt_cli_args) S0(rt_exit_code)
S1(rt_exit) S1(rt_env_get) S2(rt_env_set) S0(rt_env_all)

/* --- Math --- */
S1(rt_math_sqrt) S1(rt_math_sin) S1(rt_math_cos) S1(rt_math_tan)
S1(rt_math_asin) S1(rt_math_acos) S1(rt_math_atan) S2(rt_math_atan2)
S1(rt_math_abs) S1(rt_math_floor) S1(rt_math_ceil) S1(rt_math_round)
S1(rt_math_log) S1(rt_math_log2) S1(rt_math_log10) S1(rt_math_exp)
S2(rt_math_min) S2(rt_math_max) S2(rt_math_pow) S0(rt_math_random)
S0(rt_math_pi) S0(rt_math_e) S0(rt_math_inf) S0(rt_math_nan)
S1(rt_math_is_nan) S1(rt_math_is_inf)

/* --- Interrupts --- */
S2(rt_register_isr) S1(rt_send_eoi) S0(rt_get_interrupt_flag)

/* --- Timer / Clock --- */
S1(rt_time_now_ms) S0(rt_time_now_nanos) S0(rt_time_monotonic)
S1(rt_sleep_ms) S1(rt_timer_create) S1(rt_timer_cancel)

/* --- Network --- */
S2(rt_net_connect) S1(rt_net_listen) S2(rt_net_send) S1(rt_net_recv)
S1(rt_net_close) S2(rt_net_bind) S1(rt_net_accept)
S2(rt_net_set_timeout) S1(rt_net_get_addr)

/* --- HTTP --- */
S2(rt_http_get) S3(rt_http_post) S3(rt_http_put) S3(rt_http_patch)
S2(rt_http_delete) S2(rt_http_request) S3(rt_http_request_full)
S2(rt_http_set_header)

/* --- JSON --- */
S1(rt_json_parse) S1(rt_json_stringify) S2(rt_json_get) S3(rt_json_set)
S1(rt_json_keys) S1(rt_json_values) S1(rt_json_is_object) S1(rt_json_is_array)

/* --- Regex --- */
S2(ffi_regex_is_match) S2(ffi_regex_find) S2(ffi_regex_find_all)
S2(ffi_regex_replace) S3(ffi_regex_replace_all) S1(ffi_regex_compile)

/* --- Test / BDD --- */
S1(rt_bdd_describe_start) S1(rt_bdd_describe_end)
S2(rt_bdd_it_start) S1(rt_bdd_it_end)
S1(rt_expect) S2(rt_expect_eq) S2(rt_expect_ne)
S2(rt_expect_gt) S2(rt_expect_lt)
S1(rt_expect_nil) S1(rt_expect_not_nil)
S1(rt_expect_true) S1(rt_expect_false)
S2(rt_expect_contains) S2(rt_expect_throws)
S0(rt_bdd_suite_start) S0(rt_bdd_suite_end) S0(rt_bdd_report)

/* --- Misc / Debug --- */
S1(rt_hash) S2(rt_hash_combine) S1(rt_debug_print) S1(rt_debug_dump)
S0(rt_debug_break) S1(rt_panic) S1(rt_assert) S2(rt_assert_eq)
S2(rt_assert_ne) S1(rt_abort)
S0(rt_gc_collect) S0(rt_gc_disable) S0(rt_gc_enable) S0(rt_gc_stats)
S1(rt_typeof)

/* --- Threading --- */
S1(rt_thread_create) S1(rt_thread_join) S0(rt_thread_yield)
S0(rt_thread_current) S1(rt_thread_sleep)
S0(rt_mutex_new) S1(rt_mutex_lock) S1(rt_mutex_unlock) S1(rt_mutex_try_lock)
S0(rt_condvar_new) S1(rt_condvar_wait) S1(rt_condvar_notify) S1(rt_condvar_notify_all)

/* --- Channels --- */
S0(rt_channel_new) S2(rt_channel_send) S1(rt_channel_recv)
S1(rt_channel_try_recv) S1(rt_channel_close)

/* --- Async --- */
S1(rt_async_spawn) S1(rt_async_await) S0(rt_async_yield) S2(rt_async_select)

/* --- Encoding --- */
S1(rt_base64_encode) S1(rt_base64_decode) S1(rt_hex_encode) S1(rt_hex_decode)
S1(rt_utf8_encode) S1(rt_utf8_decode) S1(rt_url_encode) S1(rt_url_decode)

/* --- Crypto --- */
S1(rt_sha256) S1(rt_sha512) S1(rt_md5) S2(rt_hmac_sha256) S1(rt_random_bytes)

/* --- Object / Struct --- */
S1(rt_object_new) S2(rt_object_get) S3(rt_object_set) S2(rt_object_has)
S2(rt_object_delete) S1(rt_object_keys) S1(rt_object_values)
S1(rt_object_freeze) S1(rt_object_clone)

/* --- Error handling --- */
S1(rt_error_new) S1(rt_error_message) S1(rt_error_code) S1(rt_error_stack)
S2(rt_result_ok) S2(rt_result_err) S1(rt_result_is_ok) S1(rt_result_is_err)
S1(rt_result_unwrap) S2(rt_result_unwrap_or)

/* --- Weak references & closures --- */
S1(rt_weak_ref) S1(rt_weak_deref)
S1(rt_closure_new) S2(rt_closure_call) S1(rt_closure_bind)

/* ===================================================================
 * 11. Real x86_32 port-I/O, MMIO, and CPU overrides
 * =================================================================== */

/* --- Port I/O: real x86 implementations --- */

RuntimeValue rt_port_outb_real(RuntimeValue port, RuntimeValue val)
{
    outb((uint16_t)port, (uint8_t)val);
    return NIL_VALUE;
}

RuntimeValue rt_port_outw_real(RuntimeValue port, RuntimeValue val)
{
    outw((uint16_t)port, (uint16_t)val);
    return NIL_VALUE;
}

RuntimeValue rt_port_outl_real(RuntimeValue port, RuntimeValue val)
{
    outl((uint16_t)port, (uint32_t)val);
    return NIL_VALUE;
}

RuntimeValue rt_port_inb_real(RuntimeValue port)
{
    return (RuntimeValue)inb((uint16_t)port);
}

RuntimeValue rt_port_inw_real(RuntimeValue port)
{
    return (RuntimeValue)inw((uint16_t)port);
}

RuntimeValue rt_port_inl_real(RuntimeValue port)
{
    return (RuntimeValue)inl((uint16_t)port);
}

RuntimeValue rt_port_io_wait_real(void)
{
    io_wait();
    return NIL_VALUE;
}

/* --- int 0x80 live trap proof support --- */

typedef struct __attribute__((packed)) {
    uint16_t offset_low;
    uint16_t selector;
    uint8_t zero;
    uint8_t type_attr;
    uint16_t offset_high;
} X86_32IdtEntry;

typedef struct __attribute__((packed)) {
    uint16_t limit;
    uint32_t base;
} X86_32IdtPointer;

extern int32_t x86_32_dispatch_installed_syscall_abi(
    uint32_t id,
    uint32_t arg0,
    uint32_t arg1,
    uint32_t arg2,
    uint32_t arg3,
    uint32_t arg4,
    uint32_t arg5
) __attribute__((weak));
extern int32_t arch__x86_32__int80_probe_entry__x86_32_dispatch_installed_syscall_abi(
    uint32_t id,
    uint32_t arg0,
    uint32_t arg1,
    uint32_t arg2,
    uint32_t arg3,
    uint32_t arg4,
    uint32_t arg5
) __attribute__((weak));
extern int32_t arch__x86_32__initrd_fs_exec_probe_entry__x86_32_dispatch_installed_syscall_abi(
    uint32_t id,
    uint32_t arg0,
    uint32_t arg1,
    uint32_t arg2,
    uint32_t arg3,
    uint32_t arg4,
    uint32_t arg5
) __attribute__((weak));
extern int32_t os__kernel__arch__x86_32__early_syscall__x86_32_dispatch_installed_syscall_abi(
    uint32_t id,
    uint32_t arg0,
    uint32_t arg1,
    uint32_t arg2,
    uint32_t arg3,
    uint32_t arg4,
    uint32_t arg5
) __attribute__((weak));

static X86_32IdtEntry x86_32_probe_idt[256] __attribute__((aligned(8)));
static X86_32IdtPointer x86_32_probe_idtr;

/* Authenticated, single-consumer scheduler handoff.  The identity tuple is
 * scalar-only so the trap path never retains a mutable Task/Context alias. */
static uint32_t x86_32_exec_task;
static uint32_t x86_32_exec_generation;
static uint32_t x86_32_exec_cr3;
static uint32_t x86_32_result_task;
static uint32_t x86_32_result_generation;
static uint32_t x86_32_result_cr3;
static int32_t x86_32_result_rc;
static uint8_t x86_32_exec_active;
static uint8_t x86_32_result_valid;

extern void rt_x86_32_ring3_resume(int32_t rc) __attribute__((noreturn));
extern int32_t rt_x86_32_ring3_resume_valid(void);

static uint32_t x86_32_current_cr3(void)
{
    uint32_t cr3;
    __asm__ volatile("mov %%cr3,%0" : "=r"(cr3));
    /* Legacy PAE uses a 32-byte-aligned PDPT. Bits 11:5 are address bits,
     * unlike non-PAE CR3; clearing a full page silently retargets the PDPT. */
    return cr3 & ~0x1FU;
}

uint32_t rt_x86_32_current_cr3(void)
{
    uint32_t active = x86_32_current_cr3();
    return active ? active : x86_32_user_cr3;
}

int32_t rt_x86_32_exec_token_install(uint32_t task, uint32_t generation,
                                     uint32_t expected_cr3)
{
    expected_cr3 &= ~0x1FU;
    if (x86_32_exec_active || x86_32_result_valid || !task || !generation ||
        !expected_cr3 || expected_cr3 != x86_32_user_cr3 ||
        x86_32_current_cr3() != expected_cr3) return 0;
    x86_32_exec_task = task;
    x86_32_exec_generation = generation;
    x86_32_exec_cr3 = expected_cr3;
    x86_32_exec_active = 1;
    return 1;
}

int32_t rt_x86_32_exec_token_cancel(uint32_t task, uint32_t generation,
                                    uint32_t expected_cr3)
{
    if (!x86_32_exec_active || task != x86_32_exec_task ||
        generation != x86_32_exec_generation ||
        (expected_cr3 & ~0x1FU) != x86_32_exec_cr3) return 0;
    x86_32_exec_active = 0;
    return 1;
}

int32_t rt_x86_32_exec_token_take_result(uint32_t task, uint32_t generation,
                                         uint32_t expected_cr3)
{
    if (!x86_32_result_valid || task != x86_32_result_task ||
        generation != x86_32_result_generation ||
        (expected_cr3 & ~0x1FU) != x86_32_result_cr3) return -4096;
    x86_32_result_valid = 0;
    return x86_32_result_rc;
}

static int x86_32_complete_authenticated_exit(int32_t rc)
{
    if (!x86_32_exec_active || x86_32_current_cr3() != x86_32_exec_cr3 ||
        !rt_x86_32_ring3_resume_valid()) return 0;
    x86_32_result_task = x86_32_exec_task;
    x86_32_result_generation = x86_32_exec_generation;
    x86_32_result_cr3 = x86_32_exec_cr3;
    x86_32_result_rc = rc;
    x86_32_result_valid = 1;
    x86_32_exec_active = 0;
    rt_x86_32_ring3_resume(rc);
}

int32_t simpleos_x86_32_dispatch_int80_probe(
    uint32_t id,
    uint32_t arg0,
    uint32_t arg1,
    uint32_t arg2,
    uint32_t arg3,
    uint32_t arg4,
    uint32_t arg5
)
{
    if (id == 0U && x86_32_complete_authenticated_exit((int32_t)arg0)) {
        __builtin_unreachable();
    }
    if (id == 60U && x86_32_exec_active && x86_32_current_cr3() == x86_32_exec_cr3) {
        serial_putchar((char)(arg0 & 0xFFU));
        return 0;
    }
    if (os__kernel__arch__x86_32__early_syscall__x86_32_dispatch_installed_syscall_abi) {
        return os__kernel__arch__x86_32__early_syscall__x86_32_dispatch_installed_syscall_abi(
            id, arg0, arg1, arg2, arg3, arg4, arg5
        );
    }
    if (x86_32_dispatch_installed_syscall_abi) {
        return x86_32_dispatch_installed_syscall_abi(id, arg0, arg1, arg2, arg3, arg4, arg5);
    }
    if (arch__x86_32__int80_probe_entry__x86_32_dispatch_installed_syscall_abi) {
        return arch__x86_32__int80_probe_entry__x86_32_dispatch_installed_syscall_abi(
            id, arg0, arg1, arg2, arg3, arg4, arg5
        );
    }
    if (arch__x86_32__initrd_fs_exec_probe_entry__x86_32_dispatch_installed_syscall_abi) {
        return arch__x86_32__initrd_fs_exec_probe_entry__x86_32_dispatch_installed_syscall_abi(
            id, arg0, arg1, arg2, arg3, arg4, arg5
        );
    }
    return -38;
}

__attribute__((naked)) void x86_32_int80_probe_handler(void)
{
    __asm__ volatile(
        "pusha\n\t"
        "pushl $0\n\t"
        "pushl 4(%esp)\n\t"
        "pushl 12(%esp)\n\t"
        "pushl 32(%esp)\n\t"
        "pushl 40(%esp)\n\t"
        "pushl 36(%esp)\n\t"
        "pushl 52(%esp)\n\t"
        "call simpleos_x86_32_dispatch_int80_probe\n\t"
        "addl $28, %esp\n\t"
        "movl %eax, 28(%esp)\n\t"
        "popa\n\t"
        "iret\n\t"
    );
}

__attribute__((used, noinline)) void x86_32_privilege_fault(
    uint32_t vector, uint32_t error, uint32_t eip, uint32_t cs, uint32_t cr2)
{
    int exact_gp = vector == 13U && error == 0U &&
                   x86_32_expected_fault_vector == 13U && eip == x86_32_expected_fault_eip;
    int exact_pf = vector == 14U && error == 0x15U &&
                   x86_32_expected_fault_vector == 14U && eip == x86_32_expected_fault_eip &&
                   cr2 == X86_32_USER_STACK_BASE;
    if ((exact_gp || exact_pf) && (cs & 3U) == 3U && x86_32_exec_active &&
        x86_32_current_cr3() == x86_32_exec_cr3 && rt_x86_32_ring3_resume_valid()) {
        serial_puts(vector == 13U ? "X86_32_PRIVILEGE_FAULT vector=GP eip=" :
                                   "X86_32_PRIVILEGE_FAULT vector=PF eip=");
        serial_put_hex(eip);
        if (vector == 14U) { serial_puts(" cr2="); serial_put_hex(cr2); }
        serial_puts(" error="); serial_put_hex(error); serial_puts("\r\n");
        x86_32_expected_fault_vector = 0;
        x86_32_expected_fault_eip = 0;
        x86_32_complete_authenticated_exit(-(int32_t)vector);
        __builtin_unreachable();
    }
    serial_puts("X86_32_KERNEL_FAULT_FATAL\r\n");
    for (;;) __asm__ volatile("cli; hlt");
}

__attribute__((naked)) void x86_32_gp_handler(void)
{
    __asm__ volatile(
        "pusha\n\t"
        "movl 32(%esp), %ebx\n\t"
        "movl 36(%esp), %ecx\n\t"
        "movl 40(%esp), %edx\n\t"
        "pushl $0\n\tpushl %edx\n\tpushl %ecx\n\tpushl %ebx\n\tpushl $13\n\t"
        "call x86_32_privilege_fault\n\t"
        "ud2\n\t"
    );
}

__attribute__((naked)) void x86_32_pf_handler(void)
{
    __asm__ volatile(
        "pusha\n\t"
        "movl %cr2, %eax\n\t"
        "movl 32(%esp), %ebx\n\t"
        "movl 36(%esp), %ecx\n\t"
        "movl 40(%esp), %edx\n\t"
        "pushl %eax\n\tpushl %edx\n\tpushl %ecx\n\tpushl %ebx\n\tpushl $14\n\t"
        "call x86_32_privilege_fault\n\t"
        "ud2\n\t"
    );
}

static void x86_32_idt_set(uint32_t vector, void (*handler)(void), uint8_t attr)
{
    uint32_t address = (uint32_t)(uintptr_t)handler;
    x86_32_probe_idt[vector].offset_low = (uint16_t)address;
    x86_32_probe_idt[vector].selector = 0x08U;
    x86_32_probe_idt[vector].zero = 0;
    x86_32_probe_idt[vector].type_attr = attr;
    x86_32_probe_idt[vector].offset_high = (uint16_t)(address >> 16);
}

RuntimeValue rt_x86_32_install_int80_probe(void)
{
    x86_32_zero(x86_32_probe_idt, sizeof(x86_32_probe_idt));
    x86_32_idt_set(13U, x86_32_gp_handler, 0x8EU);
    x86_32_idt_set(14U, x86_32_pf_handler, 0x8EU);
    x86_32_idt_set(0x80U, x86_32_int80_probe_handler, 0xEEU);
    x86_32_probe_idtr.limit = (uint16_t)(sizeof(x86_32_probe_idt) - 1U);
    x86_32_probe_idtr.base = (uint32_t)(uintptr_t)x86_32_probe_idt;
    __asm__ volatile("lidt (%0)" : : "r"(&x86_32_probe_idtr) : "memory");
    return (RuntimeValue)1;
}

/* 32-bit protected-mode GDT and TSS.  esp0 is refreshed at every scheduler
 * handoff; the CPU uses it for CPL3 -> CPL0 int 0x80 and fault transitions. */
typedef struct __attribute__((packed)) {
    uint16_t prev, _pad0;
    uint32_t esp0;
    uint16_t ss0, _pad1;
    uint32_t esp1;
    uint16_t ss1, _pad2;
    uint32_t esp2;
    uint16_t ss2, _pad3;
    uint32_t cr3, eip, eflags, eax, ecx, edx, ebx, esp, ebp, esi, edi;
    uint16_t es, _p4, cs, _p5, ss, _p6, ds, _p7, fs, _p8, gs, _p9;
    uint16_t ldt, _p10, trap, iomap;
} X86_32Tss;

static uint64_t x86_32_gdt[6] __attribute__((aligned(8)));
static X86_32Tss x86_32_tss __attribute__((aligned(16)));
#define X86_32_RING0_STACK_SLOTS 4U
#define X86_32_RING0_STACK_BYTES 8192U

static uint8_t x86_32_ring0_stacks[X86_32_RING0_STACK_SLOTS]
                                  [X86_32_RING0_STACK_BYTES]
    __attribute__((aligned(16)));
static uint32_t x86_32_ring0_stack_task[X86_32_RING0_STACK_SLOTS];
static uint32_t x86_32_ring0_stack_generation[X86_32_RING0_STACK_SLOTS];

static uint64_t x86_32_segment(uint32_t base, uint32_t limit,
                               uint8_t access, uint8_t flags)
{
    return (uint64_t)(limit & 0xFFFFU) |
           ((uint64_t)(base & 0xFFFFFFU) << 16) |
           ((uint64_t)access << 40) |
           ((uint64_t)((limit >> 16) & 0xFU) << 48) |
           ((uint64_t)(flags & 0xFU) << 52) |
           ((uint64_t)(base >> 24) << 56);
}

__attribute__((used, noinline))
int32_t rt_x86_32_tss_set_esp0(uint32_t esp0)
{
    if (!esp0) return 0;
    x86_32_tss.esp0 = esp0;
    return 1;
}

/* Bind the privilege-transition stack to the same authenticated task and
 * generation that owns the run-to-completion execution token.  The bounded
 * probe rejects slot collisions instead of silently sharing an esp0 stack
 * between distinct tasks. */
int32_t rt_x86_32_tss_bind_task(uint32_t task_id, uint32_t generation)
{
    uint32_t slot;
    uint32_t stack_top;
    if (!task_id || !generation || !x86_32_exec_active ||
        task_id != x86_32_exec_task ||
        generation != x86_32_exec_generation)
        return 0;
    slot = (task_id - 1U) % X86_32_RING0_STACK_SLOTS;
    if (x86_32_ring0_stack_task[slot] != 0U &&
        x86_32_ring0_stack_task[slot] != task_id)
        return 0;
    x86_32_ring0_stack_task[slot] = task_id;
    x86_32_ring0_stack_generation[slot] = generation;
    stack_top = (uint32_t)(uintptr_t)(
        x86_32_ring0_stacks[slot] + X86_32_RING0_STACK_BYTES);
    return rt_x86_32_tss_set_esp0(stack_top);
}

int32_t rt_x86_32_tss_init(void)
{
    struct __attribute__((packed)) { uint16_t limit; uint32_t base; } gdtr;
    uint32_t tss_base = (uint32_t)(uintptr_t)&x86_32_tss;
    uint32_t tss_limit = sizeof(x86_32_tss) - 1U;
    for (uint32_t i = 0; i < sizeof(x86_32_tss); ++i)
        ((volatile uint8_t *)&x86_32_tss)[i] = 0;
    for (uint32_t i = 0; i < X86_32_RING0_STACK_SLOTS; ++i) {
        x86_32_ring0_stack_task[i] = 0U;
        x86_32_ring0_stack_generation[i] = 0U;
    }
    x86_32_tss.ss0 = 0x10U;
    x86_32_tss.esp0 = (uint32_t)(uintptr_t)(
        x86_32_ring0_stacks[0] + X86_32_RING0_STACK_BYTES);
    x86_32_tss.iomap = sizeof(x86_32_tss);
    x86_32_gdt[0] = 0;
    x86_32_gdt[1] = x86_32_segment(0, 0xFFFFFU, 0x9AU, 0xCU);
    x86_32_gdt[2] = x86_32_segment(0, 0xFFFFFU, 0x92U, 0xCU);
    x86_32_gdt[3] = x86_32_segment(0, 0xFFFFFU, 0xFAU, 0xCU);
    x86_32_gdt[4] = x86_32_segment(0, 0xFFFFFU, 0xF2U, 0xCU);
    x86_32_gdt[5] = x86_32_segment(tss_base, tss_limit, 0x89U, 0);
    gdtr.limit = sizeof(x86_32_gdt) - 1U;
    gdtr.base = (uint32_t)(uintptr_t)x86_32_gdt;
    __asm__ volatile("lgdt %0\n\t"
                     "movw $0x10, %%ax\n\t"
                     "movw %%ax, %%ds\n\t"
                     "movw %%ax, %%es\n\t"
                     "movw %%ax, %%ss\n\t"
                     "ljmp $0x08, $1f\n\t1:\n\t"
                     "movw $0x28, %%ax\n\t"
                     "ltr %%ax"
                     : : "m"(gdtr) : "eax", "memory");
    return 1;
}

RuntimeValue rt_x86_32_trigger_int80(
    RuntimeValue id,
    RuntimeValue arg0,
    RuntimeValue arg1,
    RuntimeValue arg2,
    RuntimeValue arg3,
    RuntimeValue arg4,
    RuntimeValue arg5
)
{
    uint32_t eax = (uint32_t)id;
    uint32_t ebx = (uint32_t)arg0;
    uint32_t ecx = (uint32_t)arg1;
    uint32_t edx = (uint32_t)arg2;
    uint32_t esi = (uint32_t)arg3;
    uint32_t edi = (uint32_t)arg4;
    __asm__ volatile(
        "int $0x80\n\t"
        : "+a"(eax), "+b"(ebx), "+c"(ecx), "+d"(edx), "+S"(esi), "+D"(edi)
        :
        : "memory", "cc"
    );
    (void)arg5;
    return (RuntimeValue)eax;
}

RuntimeValue rt_port_outb(RuntimeValue port, RuntimeValue val)
    __attribute__((alias("rt_port_outb_real")));
RuntimeValue rt_port_outw(RuntimeValue port, RuntimeValue val)
    __attribute__((alias("rt_port_outw_real")));
RuntimeValue rt_port_outl(RuntimeValue port, RuntimeValue val)
    __attribute__((alias("rt_port_outl_real")));
RuntimeValue rt_port_inb(RuntimeValue port)
    __attribute__((alias("rt_port_inb_real")));
RuntimeValue rt_port_inw(RuntimeValue port)
    __attribute__((alias("rt_port_inw_real")));
RuntimeValue rt_port_inl(RuntimeValue port)
    __attribute__((alias("rt_port_inl_real")));
RuntimeValue rt_port_io_wait(void)
    __attribute__((alias("rt_port_io_wait_real")));

/* --- MMIO: real x86_32 implementations --- */

RuntimeValue rt_mmio_read_u8_real(RuntimeValue addr)
{
    return ENCODE_INT(*(volatile uint8_t *)(uintptr_t)DECODE_INT(addr));
}

RuntimeValue rt_mmio_read_u16_real(RuntimeValue addr)
{
    return ENCODE_INT(*(volatile uint16_t *)(uintptr_t)DECODE_INT(addr));
}

RuntimeValue rt_mmio_read_u32_real(RuntimeValue addr)
{
    return ENCODE_INT(*(volatile uint32_t *)(uintptr_t)DECODE_INT(addr));
}

RuntimeValue rt_mmio_write_u8_real(RuntimeValue addr, RuntimeValue val)
{
    *(volatile uint8_t *)(uintptr_t)DECODE_INT(addr) = (uint8_t)DECODE_INT(val);
    return NIL_VALUE;
}

RuntimeValue rt_mmio_write_u16_real(RuntimeValue addr, RuntimeValue val)
{
    *(volatile uint16_t *)(uintptr_t)DECODE_INT(addr) = (uint16_t)DECODE_INT(val);
    return NIL_VALUE;
}

RuntimeValue rt_mmio_write_u32_real(RuntimeValue addr, RuntimeValue val)
{
    *(volatile uint32_t *)(uintptr_t)DECODE_INT(addr) = (uint32_t)DECODE_INT(val);
    return NIL_VALUE;
}

RuntimeValue rt_mmio_read_u8(RuntimeValue)
    __attribute__((alias("rt_mmio_read_u8_real")));
RuntimeValue rt_mmio_read_u16(RuntimeValue)
    __attribute__((alias("rt_mmio_read_u16_real")));
RuntimeValue rt_mmio_read_u32(RuntimeValue)
    __attribute__((alias("rt_mmio_read_u32_real")));
RuntimeValue rt_mmio_write_u8(RuntimeValue, RuntimeValue)
    __attribute__((alias("rt_mmio_write_u8_real")));
RuntimeValue rt_mmio_write_u16(RuntimeValue, RuntimeValue)
    __attribute__((alias("rt_mmio_write_u16_real")));
RuntimeValue rt_mmio_write_u32(RuntimeValue, RuntimeValue)
    __attribute__((alias("rt_mmio_write_u32_real")));

/* --- CPU: real x86_32 implementations --- */

RuntimeValue rt_hlt_real(void)
{
    __asm__ volatile("hlt");
    return NIL_VALUE;
}

RuntimeValue rt_sti_real(void)
{
    __asm__ volatile("sti");
    return NIL_VALUE;
}

RuntimeValue rt_cli_real(void)
{
    __asm__ volatile("cli");
    return NIL_VALUE;
}

RuntimeValue rt_enable_interrupts_real(void)
{
    __asm__ volatile("sti");
    return NIL_VALUE;
}

RuntimeValue rt_disable_interrupts_real(void)
{
    __asm__ volatile("cli");
    return NIL_VALUE;
}

RuntimeValue rt_invlpg_real(RuntimeValue addr)
{
    __asm__ volatile("invlpg (%0)" : : "r"((uintptr_t)DECODE_INT(addr)) : "memory");
    return NIL_VALUE;
}

RuntimeValue rt_rdtsc_real(void)
{
    uint32_t lo, hi;
    __asm__ volatile("rdtsc" : "=a"(lo), "=d"(hi));
    /* In 32-bit mode we can only return the low 32 bits */
    return ENCODE_INT((int32_t)lo);
}

RuntimeValue rt_lgdt_real(RuntimeValue desc)
{
    __asm__ volatile("lgdt (%0)" : : "r"((uintptr_t)desc) : "memory");
    return NIL_VALUE;
}

RuntimeValue rt_lidt_real(RuntimeValue desc)
{
    __asm__ volatile("lidt (%0)" : : "r"((uintptr_t)desc) : "memory");
    return NIL_VALUE;
}

RuntimeValue rt_ltr_real(RuntimeValue sel)
{
    uint16_t selector = (uint16_t)sel;
    __asm__ volatile("ltr %0" : : "r"(selector));
    return NIL_VALUE;
}

RuntimeValue rt_read_cr3_real(RuntimeValue dummy)
{
    (void)dummy;
    uint32_t cr3;
    __asm__ volatile("mov %%cr3, %0" : "=r"(cr3));
    return ENCODE_INT((int32_t)cr3);
}

RuntimeValue rt_write_cr3_real(RuntimeValue val)
{
    __asm__ volatile("mov %0, %%cr3" : : "r"((uint32_t)DECODE_INT(val)) : "memory");
    return NIL_VALUE;
}

RuntimeValue rt_read_cr2_real(RuntimeValue dummy)
{
    (void)dummy;
    uint32_t cr2;
    __asm__ volatile("mov %%cr2, %0" : "=r"(cr2));
    return ENCODE_INT((int32_t)cr2);
}

RuntimeValue rt_hlt(void)     __attribute__((alias("rt_hlt_real")));
RuntimeValue rt_sti(void)     __attribute__((alias("rt_sti_real")));
RuntimeValue rt_cli(void)     __attribute__((alias("rt_cli_real")));
RuntimeValue rt_enable_interrupts(void)
    __attribute__((alias("rt_enable_interrupts_real")));
RuntimeValue rt_disable_interrupts(void)
    __attribute__((alias("rt_disable_interrupts_real")));
RuntimeValue rt_invlpg(RuntimeValue)
    __attribute__((alias("rt_invlpg_real")));
RuntimeValue rt_rdtsc(void)
    __attribute__((alias("rt_rdtsc_real")));
RuntimeValue rt_lgdt(RuntimeValue)
    __attribute__((alias("rt_lgdt_real")));
RuntimeValue rt_lidt(RuntimeValue)
    __attribute__((alias("rt_lidt_real")));
RuntimeValue rt_ltr(RuntimeValue)
    __attribute__((alias("rt_ltr_real")));
RuntimeValue rt_read_cr3(RuntimeValue)
    __attribute__((alias("rt_read_cr3_real")));
RuntimeValue rt_write_cr3(RuntimeValue)
    __attribute__((alias("rt_write_cr3_real")));
RuntimeValue rt_read_cr2(RuntimeValue)
    __attribute__((alias("rt_read_cr2_real")));

typedef struct {
    uint32_t eax;
    uint32_t ebx;
    uint32_t ecx;
    uint32_t edx;
    uint32_t esi;
    uint32_t edi;
    uint32_t ebp;
    uint32_t esp;
    uint32_t eip;
    uint32_t eflags;
    uint32_t cs;
    uint32_t ss;
    uint32_t ds;
    uint32_t es;
    uint32_t fpu_state;
} X86_32SavedContext;

__attribute__((naked)) RuntimeValue
rt_x86_32_context_switch(RuntimeValue from_ptr_val, RuntimeValue to_ptr_val)
{
    __asm__ volatile(
        /* Snapshot before using any GPR as a pointer.  After pushfl/pusha:
         * edi..eax are at 0..28, eflags at 32, return/from/to at 36/40/44. */
        "pushfl\n\t"
        "pusha\n\t"
        "movl 40(%esp), %eax\n\t"
        "testl %eax, %eax\n\t"
        "jz 1f\n\t"
        "movl 28(%esp), %edx\n\tmovl %edx, 0(%eax)\n\t"
        "movl 16(%esp), %edx\n\tmovl %edx, 4(%eax)\n\t"
        "movl 24(%esp), %edx\n\tmovl %edx, 8(%eax)\n\t"
        "movl 20(%esp), %edx\n\tmovl %edx, 12(%eax)\n\t"
        "movl 4(%esp), %edx\n\tmovl %edx, 16(%eax)\n\t"
        "movl 0(%esp), %edx\n\tmovl %edx, 20(%eax)\n\t"
        "movl 8(%esp), %edx\n\tmovl %edx, 24(%eax)\n\t"
        "movl 12(%esp), %edx\n\taddl $8, %edx\n\tmovl %edx, 28(%eax)\n\t"
        "movl 36(%esp), %edx\n\tmovl %edx, 32(%eax)\n\t"
        "movl 32(%esp), %edx\n\tmovl %edx, 36(%eax)\n\t"
        "movw %cs, %dx\n\tmovzwl %dx, %edx\n\tmovl %edx, 40(%eax)\n\t"
        "movw %ss, %dx\n\tmovzwl %dx, %edx\n\tmovl %edx, 44(%eax)\n\t"
        "movw %ds, %dx\n\tmovzwl %dx, %edx\n\tmovl %edx, 48(%eax)\n\t"
        "movw %es, %dx\n\tmovzwl %dx, %edx\n\tmovl %edx, 52(%eax)\n\t"
        "1:\n\t"
        "movl 44(%esp), %ebp\n\t"
        "testl %ebp, %ebp\n\t"
        "jz 4f\n\t"
        /* A privilege-changing iret consumes SS:ESP as well as EFLAGS:CS:EIP. */
        "testb $3, 40(%ebp)\n\t"
        "jz 2f\n\t"
        "pushl 44(%ebp)\n\tpushl 28(%ebp)\n\t"
        "jmp 3f\n\t"
        "2:\n\t"
        "movl 28(%ebp), %esp\n\t"
        "3:\n\t"
        "pushl 36(%ebp)\n\tpushl 40(%ebp)\n\tpushl 32(%ebp)\n\t"
        "movw 48(%ebp), %ax\n\tmovw %ax, %ds\n\t"
        "movw 52(%ebp), %ax\n\tmovw %ax, %es\n\t"
        "movl 4(%ebp), %ebx\n\tmovl 16(%ebp), %esi\n\tmovl 20(%ebp), %edi\n\t"
        "movl 0(%ebp), %eax\n\tmovl 12(%ebp), %edx\n\tmovl 8(%ebp), %ecx\n\t"
        "movl 24(%ebp), %ebp\n\t"
        "iret\n\t"
        "4:\n\t"
        "popa\n\tpopfl\n\txorl %eax, %eax\n\tret\n\t"
    );
}

static X86_32SavedContext x86_32_context_probe_from;
static X86_32SavedContext x86_32_context_probe_to;
static uint8_t x86_32_context_probe_stack[4096] __attribute__((aligned(16)));
static volatile uint32_t x86_32_context_probe_ecx;
static volatile uint32_t x86_32_context_probe_edx;

__attribute__((naked, used)) static void x86_32_context_probe_target(void)
{
    __asm__ volatile(
        "movl %ecx, x86_32_context_probe_ecx\n\t"
        "movl %edx, x86_32_context_probe_edx\n\t"
        "pushl $x86_32_context_probe_from\n\t"
        "pushl $x86_32_context_probe_to\n\t"
        "call rt_x86_32_context_switch\n\t"
        "ud2\n\t"
    );
}

RuntimeValue rt_x86_32_context_roundtrip_probe(void)
{
    x86_32_zero(&x86_32_context_probe_from, sizeof(x86_32_context_probe_from));
    x86_32_zero(&x86_32_context_probe_to, sizeof(x86_32_context_probe_to));
    x86_32_context_probe_ecx = 0;
    x86_32_context_probe_edx = 0;
    x86_32_context_probe_to.ecx = 0x13579BDFU;
    x86_32_context_probe_to.edx = 0x2468ACE0U;
    x86_32_context_probe_to.esp =
        (uint32_t)(uintptr_t)(x86_32_context_probe_stack + sizeof(x86_32_context_probe_stack));
    x86_32_context_probe_to.eip = (uint32_t)(uintptr_t)x86_32_context_probe_target;
    x86_32_context_probe_to.eflags = 2U;
    x86_32_context_probe_to.cs = 0x08U;
    x86_32_context_probe_to.ss = 0x10U;
    x86_32_context_probe_to.ds = 0x10U;
    x86_32_context_probe_to.es = 0x10U;
    rt_x86_32_context_switch((RuntimeValue)(uintptr_t)&x86_32_context_probe_from,
                             (RuntimeValue)(uintptr_t)&x86_32_context_probe_to);
    if (x86_32_context_probe_ecx != 0x13579BDFU ||
        x86_32_context_probe_edx != 0x2468ACE0U ||
        !x86_32_context_probe_from.eip || !x86_32_context_probe_from.esp ||
        x86_32_context_probe_from.cs != 0x08U || x86_32_context_probe_from.ss != 0x10U)
        return 0;
    return 1;
}

RuntimeValue rt_x86_32_fpu_save(RuntimeValue ctx_ptr_val)
{
    X86_32SavedContext *ctx = (X86_32SavedContext *)(uintptr_t)(uint32_t)ctx_ptr_val;
    if (!ctx || !ctx->fpu_state) return NIL_VALUE;
    __asm__ volatile("fnsave (%0)" : : "r"((uintptr_t)ctx->fpu_state) : "memory");
    return NIL_VALUE;
}

RuntimeValue rt_x86_32_fpu_restore(RuntimeValue ctx_ptr_val)
{
    X86_32SavedContext *ctx = (X86_32SavedContext *)(uintptr_t)(uint32_t)ctx_ptr_val;
    if (!ctx || !ctx->fpu_state) return NIL_VALUE;
    __asm__ volatile("frstor (%0)" : : "r"((uintptr_t)ctx->fpu_state) : "memory");
    return NIL_VALUE;
}

/* ===================================================================
 * Crypto — shared portable implementation
 * =================================================================== */
#define RV_INT int32_t
#define CRYPTO_ARRAY_HDR_TYPE(arr) ((arr)->type)
#include "../../shared/crypto_common.h"
#include "../../common/boot/text_codepoint_runtime.h"

/* End of x86_32 baremetal_stubs.c */

/* Interned string-literal ctor: codegen emits rt_string_new_literal for every
 * multi-byte literal (hosted interns by data ptr for perf). The freestanding
 * kernel has no intern table, so forward to rt_string_new — functionally
 * identical (a fresh heap string per call). Matches the riscv32 stub. */
RuntimeValue rt_string_new(RuntimeValue data, RuntimeValue len_val);
RuntimeValue rt_string_new_literal(RuntimeValue data, RuntimeValue len_val)
{
    return rt_string_new(data, len_val);
}
