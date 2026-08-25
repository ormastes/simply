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
#define VIRTIO_DEV_NET 1U
#define VIRTIO_DEV_BLK 2U
#define VIRTQ_DESC_F_NEXT 1U
#define VIRTQ_DESC_F_WRITE 2U
#define VIRTIO_STATUS_ACKNOWLEDGE 1U
#define VIRTIO_STATUS_DRIVER 2U
#define VIRTIO_STATUS_DRIVER_OK 4U
#define VIRTIO_STATUS_FEATURES_OK 8U

#define TAG_MASK    ((uintptr_t)0x7)
#define TAG_INT     ((uintptr_t)0x0)
#define TAG_HEAP    ((uintptr_t)0x1)
#define TAG_FLOAT   ((uintptr_t)0x2)
#define TAG_SPECIAL ((uintptr_t)0x3)
#define NIL_VALUE   ((RuntimeValue)TAG_SPECIAL)
#define TRUE_VALUE  ENCODE_INT(1)
#define FALSE_VALUE ENCODE_INT(0)

#define ENCODE_INT(v) ((RuntimeValue)(((uint64_t)(int64_t)(v) << 3) | TAG_INT))
#define DECODE_INT(v) ((int64_t)(v) >> 3)
#define ENCODE_PTR(p) ((RuntimeValue)((uintptr_t)(p) | TAG_HEAP))
#define DECODE_PTR(v) ((void *)((uintptr_t)(v) & ~TAG_MASK))
#define IS_INT(v)     (((uintptr_t)(v) & TAG_MASK) == TAG_INT)
#define IS_HEAP(v)    (((uintptr_t)(v) & TAG_MASK) == TAG_HEAP)

#define HEAP_STRING 1U
#define HEAP_ARRAY  2U
#define HEAP_ENUM   7U

typedef struct {
    uint32_t type;
    uint32_t size;
} HeapHeader;

typedef struct {
    HeapHeader hdr;
    uint32_t len;
    char data[];
} RuntimeString;

typedef struct {
    HeapHeader hdr;
    uint64_t len;
    uint64_t cap;
    RuntimeValue *items;
} RuntimeArray;

typedef struct {
    HeapHeader hdr;
    uint32_t enum_id;
    uint32_t discriminant;
    RuntimeValue payload;
} RuntimeEnum;

/* Pure-Simple driver/service receipts and PCM staging outgrow the historical
 * 64 KiB bootstrap heap. Keep a fixed, linker-accounted 1 MiB arena. */
static unsigned char g_heap[1024 * 1024] __attribute__((aligned(16)));
static uintptr_t g_heap_off = 0;
static unsigned char g_virtq[8192] __attribute__((aligned(4096)));
static unsigned char g_dma[1024] __attribute__((aligned(512)));
static unsigned char g_riscv_file_buf[8192] __attribute__((aligned(16)));
static unsigned char g_riscv_process_arena[2][8192] __attribute__((aligned(4096)));
static uint64_t g_riscv_process_entry[2];
static uint64_t g_riscv_process_pid[2];
static uint32_t g_riscv_process_count;
uint64_t g_fb_addr = 0;
uint64_t g_fb_w = 0;
static char g_riscv_gui_surface[256];
static volatile uint32_t *g_blk_mmio = 0;
static uint16_t g_last_used_idx = 0;

extern RuntimeValue spl_start(void);
extern char _stack_top[];

#define BAREMETAL_ENABLE_ALIGNED_ALLOC 1
#include "../../common/baremetal_bump_heap.h"

/* Width-independent helpers shared with riscv32 (rv_memzero, rv_fence, le/rd
 * helpers, virtio-blk driver, FAT32 driver, SMF/ELF loaders, serial_println,
 * rt_qemu_exit_success, rt_native_eq/neq, rt_riscv_nvfs_probe). */
#include "../../common/riscv_common.h"

RuntimeValue rt_qemu_exit_failure(void)
{
    *(volatile uint32_t *)SIFIVE_TEST_BASE = 0x3333U;
    return NIL_VALUE;
}

static RuntimeValue *runtime_array_inline_items(RuntimeArray *a)
{
    return (RuntimeValue *)((unsigned char *)a + sizeof(RuntimeArray));
}

static RuntimeValue *runtime_array_items(RuntimeArray *a)
{
    if (!a) return 0;
    return a->items ? a->items : runtime_array_inline_items(a);
}

static uint64_t simpleos_raw_or_encoded_int(RuntimeValue v)
{
    return IS_INT(v) ? (uint64_t)DECODE_INT(v) : (uint64_t)v;
}

void *malloc(size_t size)
{
    return rv_alloc(size);
}

void free(void *ptr)
{
    (void)ptr;
}

void *calloc(size_t n, size_t size)
{
    size_t total = n * size;
    void *ptr = rv_alloc(total);
    if (ptr) {
        unsigned char *bytes = (unsigned char *)ptr;
        for (size_t i = 0; i < total; i++) bytes[i] = 0;
    }
    return ptr;
}

void *realloc(void *ptr, size_t size)
{
    void *next = rv_alloc(size);
    if (!next || !ptr) return next;
    unsigned char *dst = (unsigned char *)next;
    const unsigned char *src = (const unsigned char *)ptr;
    for (size_t i = 0; i < size; i++) dst[i] = src[i];
    return next;
}

void *memcpy(void *dst, const void *src, size_t n)
{
    unsigned char *d = (unsigned char *)dst;
    const unsigned char *s = (const unsigned char *)src;
    for (size_t i = 0; i < n; i++) d[i] = s[i];
    return dst;
}

int memcmp(const void *a, const void *b, size_t n)
{
    const unsigned char *pa = (const unsigned char *)a;
    const unsigned char *pb = (const unsigned char *)b;
    for (size_t i = 0; i < n; i++) {
        if (pa[i] != pb[i]) return (int)pa[i] - (int)pb[i];
    }
    return 0;
}

RuntimeValue rt_alloc(RuntimeValue sz)
{
    size_t bytes = (size_t)sz;
    void *ptr = calloc(1, bytes);
    return ptr ? (RuntimeValue)(uintptr_t)ptr : 0;
}

RuntimeValue f64_to_bits(RuntimeValue val)
{
    uint64_t fbits = (uint64_t)val >> 3;
    return ENCODE_INT((int64_t)fbits);
}

RuntimeValue spl_f64_to_bits(RuntimeValue val)
{
    return f64_to_bits(val);
}

__attribute__((weak)) RuntimeValue rt_dma_alloc(RuntimeValue size, RuntimeValue align)
{
    size_t bytes = (size_t)simpleos_raw_or_encoded_int(size);
    size_t alignment = (size_t)simpleos_raw_or_encoded_int(align);
    void *ptr = rv_alloc_aligned(bytes, alignment);
    return ptr ? (RuntimeValue)(uintptr_t)ptr : 0;
}

static void serial_puts(const char *s)
{
    uart_puts(s);
}

static void serial_putchar(char c)
{
    uart_putc(c);
}

void log_raw_println(RuntimeValue msg)
{
    if (IS_HEAP(msg)) {
        RuntimeString *s = (RuntimeString *)DECODE_PTR(msg);
        if (s && s->hdr.type == HEAP_STRING && s->len < 4096U) {
            for (uint32_t i = 0; i < s->len; i++) uart_putc(s->data[i]);
        }
    }
    uart_putc('\r');
    uart_putc('\n');
}

static void serial_put_dec(int64_t value)
{
    char buf[32];
    uint32_t pos = 0;
    uint64_t raw = (uint64_t)(value < 0 ? -value : value);
    if (value == 0) {
        uart_putc('0');
        return;
    }
    while (raw > 0 && pos < sizeof(buf)) {
        buf[pos++] = (char)('0' + (raw % 10U));
        raw /= 10U;
    }
    if (value < 0 && pos < sizeof(buf)) buf[pos++] = '-';
    while (pos > 0) uart_putc(buf[--pos]);
}

static void serial_put_hex(uint32_t value)
{
    static const char hex[] = "0123456789abcdef";
    for (int shift = 28; shift >= 0; shift -= 4) {
        uart_putc(hex[(value >> shift) & 0xFU]);
    }
}

RuntimeValue rt_string_new(RuntimeValue data, RuntimeValue len_val)
{
    uintptr_t len = (uintptr_t)len_val;
    if (len > 4096U) return NIL_VALUE;
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

static RuntimeValue rt_string_from_cstr(const char *cstr)
{
    uintptr_t len = 0;
    while (cstr && cstr[len] != 0) len++;
    return rt_string_new((RuntimeValue)(uintptr_t)cstr, (RuntimeValue)len);
}

RuntimeValue rt_string_concat(RuntimeValue a, RuntimeValue b)
{
    RuntimeString *sa = IS_HEAP(a) ? (RuntimeString *)DECODE_PTR(a) : 0;
    RuntimeString *sb = IS_HEAP(b) ? (RuntimeString *)DECODE_PTR(b) : 0;
    uintptr_t la = sa ? sa->len : 0;
    uintptr_t lb = sb ? sb->len : 0;
    RuntimeString *out = (RuntimeString *)rv_alloc(sizeof(RuntimeString) + la + lb + 1U);
    if (!out) return NIL_VALUE;
    out->hdr.type = HEAP_STRING;
    out->hdr.size = (uint32_t)(sizeof(RuntimeString) + la + lb + 1U);
    out->len = (uint32_t)(la + lb);
    for (uintptr_t i = 0; i < la; i++) out->data[i] = sa->data[i];
    for (uintptr_t i = 0; i < lb; i++) out->data[la + i] = sb->data[i];
    out->data[la + lb] = 0;
    return ENCODE_PTR(out);
}

RuntimeValue rt_value_to_string(RuntimeValue value)
{
    if (IS_HEAP(value)) {
        HeapHeader *hdr = (HeapHeader *)DECODE_PTR(value);
        if (hdr && hdr->type == HEAP_STRING) return value;
        if (hdr && hdr->type == HEAP_ARRAY) return rt_string_from_cstr("<array>");
        return rt_string_from_cstr("<object>");
    }
    if (value == NIL_VALUE) return rt_string_from_cstr("nil");

    int64_t n = IS_INT(value) ? DECODE_INT(value) : (int64_t)value;
    char buf[32];
    uintptr_t pos = 0;
    uint64_t raw = (uint64_t)(n < 0 ? -n : n);
    if (n == 0) buf[pos++] = '0';
    while (raw > 0 && pos < sizeof(buf)) {
        buf[pos++] = (char)('0' + (raw % 10U));
        raw /= 10U;
    }
    if (n < 0) buf[pos++] = '-';
    RuntimeString *out = (RuntimeString *)rv_alloc(sizeof(RuntimeString) + pos + 1U);
    if (!out) return NIL_VALUE;
    out->hdr.type = HEAP_STRING;
    out->hdr.size = (uint32_t)(sizeof(RuntimeString) + pos + 1U);
    out->len = (uint32_t)pos;
    for (uintptr_t i = 0; i < pos; i++) out->data[i] = buf[pos - 1U - i];
    out->data[pos] = 0;
    return ENCODE_PTR(out);
}

RuntimeValue rt_to_string(RuntimeValue value)
{
    return rt_value_to_string(value);
}

static RuntimeValue rt_array_push_handle(RuntimeValue arr, RuntimeValue value)
{
    if (!IS_HEAP(arr)) return NIL_VALUE;
    RuntimeArray *a = (RuntimeArray *)DECODE_PTR(arr);
    if (!a || a->hdr.type != HEAP_ARRAY) return NIL_VALUE;
    if (a->len >= a->cap) {
        uint64_t new_cap = a->cap ? a->cap * 2U : 16U;
        /* Keep growth bounded by the 64 KiB freestanding bump heap. The
         * array header remains stable while its item storage moves. */
        if (new_cap > 4096U) return NIL_VALUE;
        RuntimeValue *grown = (RuntimeValue *)rv_alloc((size_t)new_cap * sizeof(RuntimeValue));
        if (!grown) return NIL_VALUE;
        RuntimeValue *old_items = runtime_array_items(a);
        for (uint64_t i = 0; i < a->len; i++) grown[i] = old_items[i];
        for (uint64_t i = a->len; i < new_cap; i++) grown[i] = NIL_VALUE;
        a->items = grown;
        a->cap = new_cap;
    }
    runtime_array_items(a)[a->len++] = value;
    return arr;
}

RuntimeValue rt_array_new(RuntimeValue cap_val)
{
    uint64_t cap = simpleos_raw_or_encoded_int(cap_val);
    if (cap == 0) cap = 16;
    if (cap < 16) cap = 16;
    RuntimeArray *a = (RuntimeArray *)rv_alloc(sizeof(RuntimeArray) + cap * sizeof(RuntimeValue));
    if (!a) return NIL_VALUE;
    a->hdr.type = HEAP_ARRAY;
    a->hdr.size = (uint32_t)(sizeof(RuntimeArray) + cap * sizeof(RuntimeValue));
    a->len = 0;
    a->cap = cap;
    a->items = runtime_array_inline_items(a);
    for (uint64_t i = 0; i < cap; i++) a->items[i] = NIL_VALUE;
    return ENCODE_PTR(a);
}

RuntimeValue rt_array_new_with_cap(int64_t cap)
{
    return rt_array_new((RuntimeValue)cap);
}

int8_t rt_array_push(RuntimeValue arr, RuntimeValue value)
{
    return rt_array_push_handle(arr, value) != NIL_VALUE;
}

RuntimeValue rt_array_pop(RuntimeValue arr)
{
    if (!IS_HEAP(arr)) return NIL_VALUE;
    RuntimeArray *a = (RuntimeArray *)DECODE_PTR(arr);
    if (!a || a->hdr.type != HEAP_ARRAY || a->len == 0) return NIL_VALUE;
    RuntimeValue *items = runtime_array_items(a);
    a->len--;
    RuntimeValue value = items[a->len];
    items[a->len] = NIL_VALUE;
    return value;
}

RuntimeValue rt_array_get(RuntimeValue arr, RuntimeValue idx)
{
    if (!IS_HEAP(arr)) return NIL_VALUE;
    RuntimeArray *a = (RuntimeArray *)DECODE_PTR(arr);
    int64_t i = (int64_t)idx;
    if (!a || a->hdr.type != HEAP_ARRAY || i < 0 || (uint64_t)i >= a->len) return NIL_VALUE;
    return runtime_array_items(a)[i];
}

int8_t rt_array_set(RuntimeValue arr, RuntimeValue idx, RuntimeValue value)
{
    if (!IS_HEAP(arr)) return 0;
    RuntimeArray *a = (RuntimeArray *)DECODE_PTR(arr);
    int64_t i = (int64_t)idx;
    if (!a || a->hdr.type != HEAP_ARRAY || i < 0 || (uint64_t)i >= a->len) return 0;
    runtime_array_items(a)[i] = value;
    return 1;
}

RuntimeValue rt_array_len(RuntimeValue arr)
{
    if (!IS_HEAP(arr)) return 0;
    RuntimeArray *a = (RuntimeArray *)DECODE_PTR(arr);
    return (!a || a->hdr.type != HEAP_ARRAY) ? 0 : (RuntimeValue)a->len;
}

RuntimeValue rt_arm_array_len_u32(RuntimeValue arr)
{
    RuntimeArray *tagged = IS_HEAP(arr) ? (RuntimeArray *)DECODE_PTR(arr) : (RuntimeArray *)0;
    if (tagged && tagged->hdr.type == HEAP_ARRAY && tagged->len <= tagged->cap)
        return (RuntimeValue)tagged->len;
    RuntimeArray *raw = (RuntimeArray *)(uintptr_t)(uint64_t)arr;
    if (raw && raw->hdr.type == HEAP_ARRAY && raw->len <= raw->cap)
        return (RuntimeValue)raw->len;
    return 0;
}

RuntimeValue rt_tuple_new(RuntimeValue len_rv)
{
    uint64_t len = simpleos_raw_or_encoded_int(len_rv);
    RuntimeArray *a = (RuntimeArray *)rv_alloc(sizeof(RuntimeArray) + len * sizeof(RuntimeValue));
    if (!a) return NIL_VALUE;
    a->hdr.type = HEAP_ARRAY;
    a->hdr.size = (uint32_t)(sizeof(RuntimeArray) + len * sizeof(RuntimeValue));
    a->len = len;
    a->cap = len;
    a->items = runtime_array_inline_items(a);
    for (uint64_t i = 0; i < len; i++) a->items[i] = NIL_VALUE;
    return ENCODE_PTR(a);
}

RuntimeValue rt_tuple_get(RuntimeValue tuple, RuntimeValue index)
{
    return rt_array_get(tuple, index);
}

RuntimeValue rt_tuple_set(RuntimeValue tuple, RuntimeValue index, RuntimeValue value)
{
    return rt_array_set(tuple, index, value);
}

uint8_t rt_mmio_read_u8(uint64_t addr)
{
    return *(volatile uint8_t *)(uintptr_t)addr;
}

RuntimeValue rt_volatile_read_u8(RuntimeValue addr)
{
    return (RuntimeValue)(uint64_t)*(volatile uint8_t *)(uintptr_t)(uint64_t)addr;
}

uint16_t rt_mmio_read_u16(uint64_t addr)
{
    return *(volatile uint16_t *)(uintptr_t)addr;
}

uint64_t rt_mmio_read_u32(uint64_t addr)
{
    return (uint64_t)*(volatile uint32_t *)(uintptr_t)addr;
}

uint64_t rt_mmio_read_u64(uint64_t addr)
{
    return *(volatile uint64_t *)(uintptr_t)addr;
}

void rt_mmio_write_u8(uint64_t addr, uint8_t value)
{
    *(volatile uint8_t *)(uintptr_t)addr = value;
}

void rt_mmio_write_u16(uint64_t addr, uint16_t value)
{
    *(volatile uint16_t *)(uintptr_t)addr = value;
}

void rt_mmio_write_u32(uint64_t addr, uint32_t value)
{
    *(volatile uint32_t *)(uintptr_t)addr = value;
}

void rt_mmio_write_u64(uint64_t addr, uint64_t value)
{
    *(volatile uint64_t *)(uintptr_t)addr = value;
}

RuntimeValue rt_len(RuntimeValue value)
{
    if (!IS_HEAP(value)) return 0;
    HeapHeader *hdr = (HeapHeader *)DECODE_PTR(value);
    if (!hdr) return 0;
    if (hdr->type == HEAP_STRING) return (RuntimeValue)((RuntimeString *)hdr)->len;
    if (hdr->type == HEAP_ARRAY) return (RuntimeValue)((RuntimeArray *)hdr)->len;
    return 0;
}

RuntimeValue rt_index_get(RuntimeValue value, RuntimeValue index)
{
    if (!IS_INT(index)) return NIL_VALUE;
    if (!IS_HEAP(value)) return NIL_VALUE;
    HeapHeader *hdr = (HeapHeader *)DECODE_PTR(value);
    if (!hdr) return NIL_VALUE;
    if (hdr->type == HEAP_ARRAY) return rt_array_get(value, (RuntimeValue)DECODE_INT(index));
    return NIL_VALUE;
}

RuntimeValue rt_index_set(RuntimeValue value, RuntimeValue index, RuntimeValue item)
{
    if (!IS_INT(index)) return 0;
    return rt_array_set(value, (RuntimeValue)DECODE_INT(index), item);
}

RuntimeValue rt_enum_new(RuntimeValue enum_id_rv, RuntimeValue disc_rv, RuntimeValue payload)
{
    RuntimeEnum *e = (RuntimeEnum *)rv_alloc(sizeof(RuntimeEnum));
    if (!e) return NIL_VALUE;
    e->hdr.type = HEAP_ENUM;
    e->hdr.size = (uint32_t)sizeof(RuntimeEnum);
    e->enum_id = (uint32_t)(int32_t)enum_id_rv;
    e->discriminant = (uint32_t)(int32_t)disc_rv;
    e->payload = payload;
    return ENCODE_PTR(e);
}

RuntimeValue rt_enum_payload(RuntimeValue value)
{
    if (!IS_HEAP(value)) return value;
    RuntimeEnum *e = (RuntimeEnum *)DECODE_PTR(value);
    return (!e || e->hdr.type != HEAP_ENUM) ? value : e->payload;
}

RuntimeValue rt_enum_check_discriminant(RuntimeValue value, RuntimeValue expected)
{
    if (!IS_HEAP(value)) return 0;
    RuntimeEnum *e = (RuntimeEnum *)DECODE_PTR(value);
    if (!e || e->hdr.type != HEAP_ENUM) return 0;
    return e->discriminant == (uint32_t)(int32_t)expected ? 1 : 0;
}

RuntimeValue rt_string_char_at(RuntimeValue str, RuntimeValue idx)
{
    if (!IS_HEAP(str)) return NIL_VALUE;
    RuntimeString *s = (RuntimeString *)DECODE_PTR(str);
    int64_t i = (int64_t)idx;
    if (!s || s->hdr.type != HEAP_STRING || i < 0 || (uint32_t)i >= s->len) return NIL_VALUE;
    return rt_string_new((RuntimeValue)(uintptr_t)(s->data + i), 1);
}

RuntimeValue rt_string_chars(RuntimeValue str)
{
    RuntimeString *s = IS_HEAP(str) ? (RuntimeString *)DECODE_PTR(str) : (RuntimeString *)0;
    RuntimeValue arr = rt_array_new(ENCODE_INT(s && s->hdr.type == HEAP_STRING ? s->len : 0));
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

RuntimeValue rt_string_eq(RuntimeValue a, RuntimeValue b)
{
    if (!IS_HEAP(a) || !IS_HEAP(b)) return 0;
    RuntimeString *sa = (RuntimeString *)DECODE_PTR(a);
    RuntimeString *sb = (RuntimeString *)DECODE_PTR(b);
    if (!sa || !sb || sa->hdr.type != HEAP_STRING || sb->hdr.type != HEAP_STRING) return 0;
    if (sa->len != sb->len) return 0;
    for (uint32_t i = 0; i < sa->len; i++) {
        if (sa->data[i] != sb->data[i]) return 0;
    }
    return 1;
}

RuntimeValue rt_string_starts_with(RuntimeValue str, RuntimeValue prefix)
{
    if (!IS_HEAP(str) || !IS_HEAP(prefix)) return 0;
    RuntimeString *s = (RuntimeString *)DECODE_PTR(str);
    RuntimeString *p = (RuntimeString *)DECODE_PTR(prefix);
    if (!s || !p || s->hdr.type != HEAP_STRING || p->hdr.type != HEAP_STRING) return 0;
    if (p->len > s->len) return 0;
    for (uint32_t i = 0; i < p->len; i++) {
        if (s->data[i] != p->data[i]) return 0;
    }
    return 1;
}

RuntimeValue rt_string_replace_all(RuntimeValue str, RuntimeValue old_val, RuntimeValue new_val)
{
    if (!IS_HEAP(str) || !IS_HEAP(old_val) || !IS_HEAP(new_val)) return NIL_VALUE;
    RuntimeString *s = (RuntimeString *)DECODE_PTR(str);
    RuntimeString *o = (RuntimeString *)DECODE_PTR(old_val);
    RuntimeString *n = (RuntimeString *)DECODE_PTR(new_val);
    if (!s || !o || !n || s->hdr.type != HEAP_STRING || o->hdr.type != HEAP_STRING || n->hdr.type != HEAP_STRING) {
        return NIL_VALUE;
    }
    if (o->len == 0 || o->len > s->len) return str;

    uint32_t count = 0;
    for (uint32_t i = 0; o->len <= s->len - i;) {
        uint32_t j = 0;
        while (j < o->len && s->data[i + j] == o->data[j]) j++;
        if (j == o->len) {
            count++;
            i += o->len;
        } else {
            i++;
        }
    }
    if (count == 0) return str;

    uint64_t out_len_wide =
        (uint64_t)s->len - (uint64_t)count * o->len + (uint64_t)count * n->len;
    if (out_len_wide > (uint64_t)UINT32_MAX - sizeof(RuntimeString) - 1U) return str;
    uint32_t out_len = (uint32_t)out_len_wide;
    RuntimeString *out = (RuntimeString *)rv_alloc(sizeof(RuntimeString) + out_len + 1U);
    if (!out) return str;
    out->hdr.type = HEAP_STRING;
    out->hdr.size = (uint32_t)(sizeof(RuntimeString) + out_len + 1U);
    out->len = out_len;

    uint32_t in = 0;
    uint32_t out_i = 0;
    while (in < s->len) {
        uint32_t j = 0;
        while (j < o->len && j < s->len - in && s->data[in + j] == o->data[j]) j++;
        if (j == o->len) {
            for (uint32_t k = 0; k < n->len; k++) out->data[out_i++] = n->data[k];
            in += o->len;
        } else {
            out->data[out_i++] = s->data[in++];
        }
    }
    out->data[out_len] = 0;
    return ENCODE_PTR(out);
}

RuntimeValue rt_string_replace(RuntimeValue str, RuntimeValue old_val, RuntimeValue new_val)
{
    return rt_string_replace_all(str, old_val, new_val);
}

RuntimeValue rt_string_to_upper(RuntimeValue str)
{
    if (!IS_HEAP(str)) return str;
    RuntimeString *s = (RuntimeString *)DECODE_PTR(str);
    if (!s || s->hdr.type != HEAP_STRING) return str;
    RuntimeString *out = (RuntimeString *)rv_alloc(sizeof(RuntimeString) + s->len + 1U);
    if (!out) return str;
    out->hdr.type = HEAP_STRING;
    out->hdr.size = (uint32_t)(sizeof(RuntimeString) + s->len + 1U);
    out->len = s->len;
    for (uint32_t i = 0; i < s->len; i++) {
        char c = s->data[i];
        out->data[i] = (c >= 'a' && c <= 'z') ? (char)(c - ('a' - 'A')) : c;
    }
    out->data[s->len] = 0;
    return ENCODE_PTR(out);
}

RuntimeValue rt_string_to_lower(RuntimeValue str)
{
    if (!IS_HEAP(str)) return str;
    RuntimeString *s = (RuntimeString *)DECODE_PTR(str);
    if (!s || s->hdr.type != HEAP_STRING) return str;
    RuntimeString *out = (RuntimeString *)rv_alloc(sizeof(RuntimeString) + s->len + 1U);
    if (!out) return str;
    out->hdr.type = HEAP_STRING;
    out->hdr.size = (uint32_t)(sizeof(RuntimeString) + s->len + 1U);
    out->len = s->len;
    for (uint32_t i = 0; i < s->len; i++) {
        char c = s->data[i];
        out->data[i] = (c >= 'A' && c <= 'Z') ? (char)(c + ('a' - 'A')) : c;
    }
    out->data[s->len] = 0;
    return ENCODE_PTR(out);
}

static int rt_is_ascii_whitespace(char c)
{
    return c == ' ' || c == '\t' || c == '\n' || c == '\r';
}

RuntimeValue rt_string_trim(RuntimeValue str)
{
    if (!IS_HEAP(str)) return str;
    RuntimeString *s = (RuntimeString *)DECODE_PTR(str);
    if (!s || s->hdr.type != HEAP_STRING || s->len == 0) return str;

    uint32_t start = 0;
    while (start < s->len && rt_is_ascii_whitespace(s->data[start])) start++;

    uint32_t end = s->len;
    while (end > start && rt_is_ascii_whitespace(s->data[end - 1])) end--;

    uint32_t out_len = end - start;
    RuntimeString *out = (RuntimeString *)rv_alloc(sizeof(RuntimeString) + out_len + 1U);
    if (!out) return str;
    out->hdr.type = HEAP_STRING;
    out->hdr.size = (uint32_t)(sizeof(RuntimeString) + out_len + 1U);
    out->len = out_len;
    for (uint32_t i = 0; i < out_len; i++) out->data[i] = s->data[start + i];
    out->data[out_len] = 0;
    return ENCODE_PTR(out);
}

RuntimeValue str_byte_at_impl(RuntimeValue str, RuntimeValue idx) __asm__("str.byte_at");
RuntimeValue str_byte_at_impl(RuntimeValue str, RuntimeValue idx)
{
    if (!IS_HEAP(str)) return 0;
    RuntimeString *s = (RuntimeString *)DECODE_PTR(str);
    int64_t i = (int64_t)idx;
    if (!s || s->hdr.type != HEAP_STRING || i < 0 || (uint32_t)i >= s->len) return 0;
    return (RuntimeValue)(uint8_t)s->data[i];
}

static uint64_t harden_mix64(uint64_t value)
{
    value ^= value >> 30;
    value *= 0xbf58476d1ce4e5b9ULL;
    value ^= value >> 27;
    value *= 0x94d049bb133111ebULL;
    value ^= value >> 31;
    return value;
}

RuntimeValue rt_riscv_harden_canary_value(void)
{
    uint64_t cycle = 0;
    uint64_t time = 0;
    uint64_t instret = 0;
    __asm__ volatile("rdcycle %0" : "=r"(cycle));
    __asm__ volatile("rdtime %0" : "=r"(time));
    __asm__ volatile("rdinstret %0" : "=r"(instret));
    uint64_t mixed = harden_mix64(
        cycle ^ (time << 17) ^ (instret << 33) ^ (uintptr_t)&rt_riscv_harden_canary_value
    );
    mixed &= 0x7fffffffffffffffULL;
    return (RuntimeValue)(mixed == 0 ? 1 : mixed);
}

