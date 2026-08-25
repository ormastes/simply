#include <stdint.h>
#include <stddef.h>
#include "virtio_input_mmio_contract.h"

typedef int64_t RuntimeValue;

int64_t rt_arm64_syscall(uint64_t id, uint64_t arg0, uint64_t arg1,
                         uint64_t arg2, uint64_t arg3, uint64_t arg4)
{
    register uint64_t x0 __asm__("x0") = arg0;
    register uint64_t x1 __asm__("x1") = arg1;
    register uint64_t x2 __asm__("x2") = arg2;
    register uint64_t x3 __asm__("x3") = arg3;
    register uint64_t x4 __asm__("x4") = arg4;
    register uint64_t x8 __asm__("x8") = id;
    __asm__ volatile("svc #0"
                     : "+r"(x0)
                     : "r"(x1), "r"(x2), "r"(x3), "r"(x4), "r"(x8)
                     : "memory", "cc");
    return (int64_t)x0;
}

#define PL011_BASE   0x09000000ULL
#define BAREMETAL_PL011_ENABLE_DIRECT_PUTS 1
#include "../../common/baremetal_pl011_serial.h"

static void serial_put_hex(uint64_t v)
{
    static const char hex[] = "0123456789abcdef";
    serial_puts("0x");
    int started = 0;
    for (int i = 60; i >= 0; i -= 4) {
        int nibble = (v >> i) & 0xF;
        if (nibble || started || i == 0) {
            serial_putchar(hex[nibble]);
            started = 1;
        }
    }
}

static void serial_put_dec(int64_t v)
{
    if (v < 0) {
        serial_putchar('-');
        if (v == (-9223372036854775807LL - 1)) {
            serial_puts("9223372036854775808");
            return;
        }
        v = -v;
    }
    char buf[21];
    int pos = 0;
    uint64_t uv = (uint64_t)v;
    do {
        buf[pos++] = '0' + (char)(uv % 10);
        uv /= 10;
    } while (uv > 0);
    while (pos > 0) {
        serial_putchar(buf[--pos]);
    }
}

static void serial_puthex(uint32_t v) {
    static const char hex[] = "0123456789abcdef";
    if (v > 0xFFFF) { serial_putchar(hex[(v>>28)&0xF]); serial_putchar(hex[(v>>24)&0xF]); serial_putchar(hex[(v>>20)&0xF]); serial_putchar(hex[(v>>16)&0xF]); }
    if (v > 0xFF) { serial_putchar(hex[(v>>12)&0xF]); serial_putchar(hex[(v>>8)&0xF]); }
    serial_putchar(hex[(v>>4)&0xF]); serial_putchar(hex[v&0xF]);
}

#define TAG_MASK    0x7ULL
#define TAG_INT     0x0ULL
#define TAG_HEAP    0x1ULL
#define TAG_FLOAT   0x2ULL
#define TAG_SPECIAL 0x3ULL

#define ENCODE_INT(v)  ((RuntimeValue)(((uint64_t)(int64_t)(v) << 3) | TAG_INT))
#define DECODE_INT(v)  ((int64_t)(v) >> 3)

#define ENCODE_PTR(p)  ((RuntimeValue)((uint64_t)(uintptr_t)(p) | TAG_HEAP))
#define DECODE_PTR(v)  ((void*)((uint64_t)(v) & ~TAG_MASK))

#define IS_INT(v)      (((uint64_t)(v) & TAG_MASK) == TAG_INT)
#define IS_HEAP(v)     (((uint64_t)(v) & TAG_MASK) == TAG_HEAP)
#define IS_FLOAT(v)    (((uint64_t)(v) & TAG_MASK) == TAG_FLOAT)
#define IS_NIL(v)      ((v) == (RuntimeValue)TAG_SPECIAL)

#define NIL_VALUE      ((RuntimeValue)TAG_SPECIAL)
#define TRUE_VALUE     ENCODE_INT(1)
#define FALSE_VALUE    ENCODE_INT(0)

typedef struct {
    /* Little-endian word assignment also clears gc_flags/reserved bytes. */
    uint32_t type;
    uint32_t size;
} HeapHeader;

typedef struct {
    HeapHeader hdr;
    uint64_t   len;
    char       data[];
} RuntimeString;

typedef struct {
    HeapHeader    hdr;
    uint64_t      len;
    uint64_t      cap;
    RuntimeValue *items;
} RuntimeArray;

_Static_assert(offsetof(RuntimeString, data) == 16, "RuntimeString payload ABI");
_Static_assert(offsetof(RuntimeArray, items) == 24, "RuntimeArray items ABI");
_Static_assert(sizeof(RuntimeArray) == 32, "RuntimeArray header ABI");

#define HEAP_STRING 1
#define HEAP_ARRAY  2
#define HEAP_MAP    3
#define HEAP_OBJECT 4
#define HEAP_ENUM   7

#define HEAP_UINT 8
typedef struct {
    HeapHeader hdr;
    uint64_t value;
} RuntimeUInt;

static uint64_t simpleos_raw_or_encoded_int(RuntimeValue value)
{
    return IS_INT(value) ? (uint64_t)DECODE_INT(value) : (uint64_t)value;
}

typedef struct {
    HeapHeader   hdr;
    uint32_t     enum_id;
    uint32_t     discriminant;
    RuntimeValue payload;
} RuntimeEnum;

typedef struct {
    HeapHeader    hdr;
    uint32_t      len;
    uint32_t      cap;
    RuntimeValue *keys;
    RuntimeValue *values;
} RuntimeMap;

RuntimeValue rt_map_clone(RuntimeValue map);
RuntimeValue rt_map_new(void);
RuntimeValue rt_map_set(RuntimeValue map, RuntimeValue key, RuntimeValue value);
RuntimeValue rt_map_get(RuntimeValue map, RuntimeValue key);
RuntimeValue rt_array_new(RuntimeValue cap_val);
static RuntimeValue rt_array_push_handle(RuntimeValue arr, RuntimeValue val);
int8_t rt_array_push(RuntimeValue arr, RuntimeValue val);
RuntimeValue rt_string_concat(RuntimeValue a, RuntimeValue b);
RuntimeValue rt_string_from_cstr(const char *cstr);
RuntimeValue rt_string_new(RuntimeValue data, RuntimeValue len_val);
RuntimeValue rt_native_eq(RuntimeValue a, RuntimeValue b);
RuntimeValue rt_value_to_string(RuntimeValue val);
RuntimeValue rt_value_format_string(RuntimeValue val, RuntimeValue fmt_ptr, RuntimeValue fmt_len);
RuntimeValue rt_string_format(RuntimeValue fmt, RuntimeValue val);
RuntimeValue rt_string_slice(RuntimeValue str, RuntimeValue start, RuntimeValue end);
void rt_print_value(RuntimeValue val);

static char   _heap[160 * 1024 * 1024] __attribute__((aligned(16)));
static size_t _heap_off = 0;

#define ARM64_STRUCT_ALLOCATION_MAX 4096U
typedef struct {
    uintptr_t base;
    size_t size;
} Arm64StructAllocation;
static Arm64StructAllocation arm64_struct_allocations[ARM64_STRUCT_ALLOCATION_MAX];
static uint32_t arm64_struct_allocation_count;
static uint8_t arm64_struct_allocation_owned;

static void *_heap_alloc(size_t sz)
{
    sz = (sz + 15) & ~(size_t)15;
    if (_heap_off + sz > sizeof(_heap)) {
        serial_puts("[PANIC] heap exhausted requested=");
        serial_put_dec((int64_t)sz);
        serial_puts(" used=");
        serial_put_dec((int64_t)_heap_off);
        serial_puts(" total=");
        serial_put_dec((int64_t)sizeof(_heap));
        serial_puts("\r\n");
        for(;;) __asm__ volatile("wfe");
    }
    void *p = &_heap[_heap_off];
    _heap_off += sz;
    return p;
}

static int arm64_heap_contains(const void *p, size_t min_size)
{
    uintptr_t addr = (uintptr_t)p;
    uintptr_t base = (uintptr_t)_heap;
    uintptr_t used_end = base + _heap_off;
    return addr >= base && addr + min_size >= addr && addr + min_size <= used_end;
}

static RuntimeUInt *arm64_heap_uint(RuntimeValue value)
{
    if (!IS_HEAP(value)) return (RuntimeUInt *)0;
    RuntimeUInt *boxed = (RuntimeUInt *)DECODE_PTR(value);
    if (!arm64_heap_contains(boxed, sizeof(*boxed))) return (RuntimeUInt *)0;
    return boxed->hdr.type == HEAP_UINT && boxed->hdr.size == sizeof(*boxed) ? boxed : (RuntimeUInt *)0;
}

RuntimeValue rt_value_int(RuntimeValue value) { return ENCODE_INT(value); }

RuntimeValue rt_value_u64(RuntimeValue bits)
{
    RuntimeUInt *boxed = (RuntimeUInt *)_heap_alloc(sizeof(*boxed));
    if (!boxed) return NIL_VALUE;
    boxed->hdr.type = HEAP_UINT;
    boxed->hdr.size = (uint32_t)sizeof(*boxed);
    boxed->value = (uint64_t)bits;
    return ENCODE_PTR(boxed);
}

RuntimeValue rt_value_as_u64(RuntimeValue value)
{
    RuntimeUInt *boxed = arm64_heap_uint(value);
    return boxed ? (RuntimeValue)boxed->value : (IS_INT(value) ? DECODE_INT(value) : 0);
}

RuntimeValue rt_value_unbox_int(RuntimeValue value)
{
    RuntimeUInt *boxed = arm64_heap_uint(value);
    if (boxed) return (RuntimeValue)boxed->value;
    return IS_INT(value) ? DECODE_INT(value) : value;
}

int8_t rt_struct_receiver_valid(RuntimeValue receiver, RuntimeValue byte_offset,
                                RuntimeValue access_width)
{
    if (receiver == 0 || byte_offset < 0 || access_width <= 0) return 0;
    uintptr_t ptr = (uintptr_t)((uint64_t)receiver & ~TAG_MASK);
    size_t offset = (size_t)byte_offset;
    size_t width = (size_t)access_width;
    if (offset + width < offset) return 0;
    if (__atomic_test_and_set(&arm64_struct_allocation_owned, __ATOMIC_ACQUIRE)) return 0;
    int8_t valid = 0;
    for (uint32_t i = 0; i < arm64_struct_allocation_count; ++i) {
        Arm64StructAllocation allocation = arm64_struct_allocations[i];
        if (ptr == allocation.base && offset <= allocation.size &&
            width <= allocation.size - offset) {
            valid = 1;
            break;
        }
    }
    __atomic_clear(&arm64_struct_allocation_owned, __ATOMIC_RELEASE);
    return valid;
}

void *rt_struct_alloc(int64_t size)
{
    if (size <= 0 || (uint64_t)size > 0x1000000ULL) return (void *)0;
    if (__atomic_test_and_set(&arm64_struct_allocation_owned, __ATOMIC_ACQUIRE))
        return (void *)0;
    if (arm64_struct_allocation_count >= ARM64_STRUCT_ALLOCATION_MAX) {
        __atomic_clear(&arm64_struct_allocation_owned, __ATOMIC_RELEASE);
        return (void *)0;
    }
    void *allocation = _heap_alloc((size_t)size);
    uint32_t slot = arm64_struct_allocation_count++;
    arm64_struct_allocations[slot].base = (uintptr_t)allocation;
    arm64_struct_allocations[slot].size = (size_t)size;
    __atomic_clear(&arm64_struct_allocation_owned, __ATOMIC_RELEASE);
    return allocation;
}

void *malloc(size_t sz)
{
    return _heap_alloc(sz);
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
    /* The freestanding extern ABI passes integer args RAW (untagged), same as
     * rt_mmio_* which use addr directly. Do NOT run sz through
     * simpleos_raw_or_encoded_int: with TAG_INT==0 it mis-detects any raw size
     * divisible by 8 as a tagged int and right-shifts it by 3, under-allocating
     * to 1/8 (e.g. a 3 MB framebuffer became ~384 KB, corrupting the heap). */
    size_t bytes = (size_t)(uint64_t)sz;
    if (bytes == 0) return 0;
    if (bytes > 0x1000000) bytes = 0x1000000;
    void *p = malloc(bytes);
    if (!p) return 0;
    __builtin_memset(p, 0, bytes);
    return (RuntimeValue)(uintptr_t)p;
}

RuntimeValue rt_alloc_zeroed(RuntimeValue sz)
{
    /* RAW size — see rt_alloc above (no tag-decode heuristic). */
    size_t bytes = (size_t)(uint64_t)sz;
    if (bytes > 0x1000000) bytes = 0x1000000;
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

RuntimeValue rt_string_new(RuntimeValue data, RuntimeValue len_val)
{
    int64_t len = len_val;
    if (len < 0 || len > 0x100000) return NIL_VALUE;
    RuntimeString *s = (RuntimeString *)malloc(sizeof(RuntimeString) + (size_t)len + 1);
    if (!s) return NIL_VALUE;
    s->hdr.type = HEAP_STRING;
    s->hdr.size = (uint32_t)(sizeof(RuntimeString) + (size_t)len + 1);
    s->len = (uint32_t)len;
    const char *src = (const char *)(uintptr_t)data;
    if (src && len > 0) __builtin_memcpy(s->data, src, (size_t)len);
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

RuntimeValue rt_raw_u64_to_string(RuntimeValue raw)
{
    uint64_t uv = (uint64_t)raw;
    if (uv == 0) return rt_string_from_cstr("0");
    char buf[21];
    int pos = 0;
    while (uv > 0) { buf[pos++] = '0' + (char)(uv % 10); uv /= 10; }
    uint32_t len = (uint32_t)pos;
    RuntimeString *s = (RuntimeString *)malloc(sizeof(RuntimeString) + len + 1);
    if (!s) return NIL_VALUE;
    s->hdr.type = HEAP_STRING;
    s->hdr.size = (uint32_t)(sizeof(RuntimeString) + len + 1);
    s->len = len;
    int out = 0;
    while (pos > 0) s->data[out++] = buf[--pos];
    s->data[out] = '\0';
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
    int64_t i = (int64_t)idx;
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
    int64_t a = DECODE_INT(start);
    int64_t b = DECODE_INT(end);
    if (a < 0) a = 0;
    if (b > (int64_t)s->len) b = (int64_t)s->len;
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

RuntimeValue rt_value_to_string(RuntimeValue val)
{
    if (IS_INT(val)) {
        int64_t n = DECODE_INT(val);
        if (n == 0) return rt_string_from_cstr("0");
        if (n == (-9223372036854775807LL - 1))
            return rt_string_from_cstr("-9223372036854775808");
        char buf[21];
        int pos = 0;
        int neg = 0;
        uint64_t uv;
        if (n < 0) { neg = 1; uv = (uint64_t)(-n); }
        else { uv = (uint64_t)n; }
        while (uv > 0) { buf[pos++] = '0' + (char)(uv % 10); uv /= 10; }
        uint32_t len = (uint32_t)(pos + neg);
        RuntimeString *s = (RuntimeString *)malloc(sizeof(RuntimeString) + len + 1);
        if (!s) return NIL_VALUE;
        s->hdr.type = HEAP_STRING;
        s->hdr.size = (uint32_t)(sizeof(RuntimeString) + len + 1);
        s->len = len;
        int out = 0;
        if (neg) s->data[out++] = '-';
        while (pos > 0) s->data[out++] = buf[--pos];
        s->data[out] = '\0';
        return ENCODE_PTR(s);
    }
    if (IS_HEAP(val)) {
        HeapHeader *h = (HeapHeader *)DECODE_PTR(val);
        if (h && h->type == HEAP_STRING) return val;
        if (h && h->type == HEAP_ARRAY) return rt_string_from_cstr("<array>");
        if (h && h->type == HEAP_MAP) return rt_string_from_cstr("<map>");
        return rt_string_from_cstr("<object>");
    }
    if (IS_NIL(val)) return rt_string_from_cstr("nil");
    if (IS_FLOAT(val)) return rt_string_from_cstr("<float>");
    return rt_string_from_cstr("<unknown>");
}

RuntimeValue rt_len(RuntimeValue v)
{
    if (IS_INT(v)) return 0;
    if (!IS_HEAP(v)) return 0;
    HeapHeader *h = (HeapHeader *)DECODE_PTR(v);
    if (!h) return 0;
    if (h->type == HEAP_STRING) return (RuntimeValue)((RuntimeString *)h)->len;
    if (h->type == HEAP_ARRAY) return (RuntimeValue)((RuntimeArray *)h)->len;
    if (h->type == HEAP_MAP) return (RuntimeValue)((RuntimeMap *)h)->len;
    return 0;
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
        int64_t i = DECODE_INT(idx);
        RuntimeArray *a = (RuntimeArray *)h;
        if (i < 0 || (uint32_t)i >= a->len) return NIL_VALUE;
        return a->items[i];
    }
    if (h->type == HEAP_MAP) return rt_map_get(v, idx);
    return NIL_VALUE;
}

RuntimeValue rt_index_set(RuntimeValue v, RuntimeValue idx, RuntimeValue val)
{
    if (!IS_HEAP(v)) return NIL_VALUE;
    HeapHeader *h = (HeapHeader *)DECODE_PTR(v);
    if (!h) return NIL_VALUE;
    if (h->type == HEAP_ARRAY) {
        int64_t i = DECODE_INT(idx);
        RuntimeArray *a = (RuntimeArray *)h;
        if (i < 0 || (uint32_t)i >= a->len) return NIL_VALUE;
        a->items[i] = val;
        return val;
    }
    if (h->type == HEAP_MAP) {
        rt_map_set(v, idx, val);
        return val;
    }
    return NIL_VALUE;
}

void rt_print_str(RuntimeValue str)
{
    if (IS_HEAP(str)) {
        RuntimeString *s = (RuntimeString *)DECODE_PTR(str);
        if (s && s->hdr.type == HEAP_STRING && s->len < 0x100000) {
            for (uint32_t i = 0; i < s->len; i++) serial_putchar(s->data[i]);
            return;
        }
    }
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

void rt_print_int(RuntimeValue val) { serial_put_dec(DECODE_INT(val)); }
void rt_println_int(RuntimeValue val) { serial_put_dec(DECODE_INT(val)); serial_putchar('\r'); serial_putchar('\n'); }
void rt_print_char(RuntimeValue val) { serial_putchar((char)DECODE_INT(val)); }
void rt_print_hex(RuntimeValue val) { serial_put_hex((uint64_t)DECODE_INT(val)); }
void rt_print_bool(RuntimeValue val) { if (DECODE_INT(val)) serial_puts("true"); else serial_puts("false"); }
void rt_println_bool(RuntimeValue val) { rt_print_bool(val); serial_putchar('\r'); serial_putchar('\n'); }

RuntimeValue rt_print(RuntimeValue val)
{
    if (IS_INT(val)) {
        serial_put_dec(DECODE_INT(val));
    } else if (IS_HEAP(val)) {
        HeapHeader *h = (HeapHeader *)DECODE_PTR(val);
        if (h && h->type == HEAP_STRING) {
            RuntimeString *s = (RuntimeString *)h;
            for (uint32_t i = 0; i < s->len; i++) serial_putchar(s->data[i]);
        } else {
            serial_puts("<object>");
        }
    } else if (IS_NIL(val)) {
        serial_puts("nil");
    } else {
        serial_puts("<value>");
    }
    return NIL_VALUE;
}

RuntimeValue rt_println(RuntimeValue val)
{
    rt_print(val);
    serial_putchar('\r');
    serial_putchar('\n');
    return NIL_VALUE;
}

void rt_framebuffer_copy(RuntimeValue dst, RuntimeValue src, RuntimeValue count)
{
    if (!IS_HEAP(dst) || !IS_HEAP(src)) return;
    uint8_t *d = (uint8_t *)DECODE_PTR(dst);
    const uint8_t *s = (const uint8_t *)DECODE_PTR(src);
    int64_t n = DECODE_INT(count);
    if (n <= 0) return;
    for (int64_t i = 0; i < n; i++) d[i] = s[i];
}

void rt_framebuffer_write(RuntimeValue addr, RuntimeValue offset, RuntimeValue val)
{
    if (!IS_HEAP(addr)) return;
    uint8_t *base = (uint8_t *)DECODE_PTR(addr);
    int64_t off = DECODE_INT(offset);
    int64_t v = DECODE_INT(val);
    base[off] = (uint8_t)v;
}

/* ---- rt_volatile_* (volatile MMIO access) + barriers ----
 * externs are `rt_volatile_*(addr: i64, value: i64)` — RAW machine i64 at the FFI
 * boundary (NOT tagged RuntimeValue), matching x86_64/boot/rt_extras.c. */
RuntimeValue rt_volatile_read_u8(RuntimeValue addr) {
    return (RuntimeValue)(uint64_t)*(volatile uint8_t *)(uintptr_t)(uint64_t)addr;
}
RuntimeValue rt_volatile_read_u16(RuntimeValue addr) {
    return (RuntimeValue)(uint64_t)*(volatile uint16_t *)(uintptr_t)(uint64_t)addr;
}
RuntimeValue rt_volatile_read_u32(RuntimeValue addr) {
    return (RuntimeValue)(uint64_t)*(volatile uint32_t *)(uintptr_t)(uint64_t)addr;
}
RuntimeValue rt_volatile_read_u64(RuntimeValue addr) {
    return (RuntimeValue)*(volatile uint64_t *)(uintptr_t)(uint64_t)addr;
}
RuntimeValue rt_volatile_write_u8(RuntimeValue addr, RuntimeValue val) {
    *(volatile uint8_t *)(uintptr_t)(uint64_t)addr = (uint8_t)(uint64_t)val;
    return NIL_VALUE;
}
RuntimeValue rt_volatile_write_u16(RuntimeValue addr, RuntimeValue val) {
    *(volatile uint16_t *)(uintptr_t)(uint64_t)addr = (uint16_t)(uint64_t)val;
    return NIL_VALUE;
}
RuntimeValue rt_volatile_write_u32(RuntimeValue addr, RuntimeValue val) {
    *(volatile uint32_t *)(uintptr_t)(uint64_t)addr = (uint32_t)(uint64_t)val;
    return NIL_VALUE;
}
RuntimeValue rt_volatile_write_u64(RuntimeValue addr, RuntimeValue val) {
    *(volatile uint64_t *)(uintptr_t)(uint64_t)addr = (uint64_t)val;
    return NIL_VALUE;
}
/* arm64 has a weak memory model — real DMB, not a no-op. */
RuntimeValue rt_load_barrier(void) {
    __asm__ volatile("dmb ld" ::: "memory");
    return NIL_VALUE;
}
RuntimeValue rt_store_barrier(void) {
    __asm__ volatile("dmb st" ::: "memory");
    return NIL_VALUE;
}

/* ===================================================================
 * Slice 2: portable runtime-ABI symbols.
 * Bodies sourced from the x86_64 boot stubs and the riscv64
 * freestanding runtime (same tagged-RuntimeValue model as this file);
 * hosted-runtime variants (runtime_native.c) were adapted to the
 * baremetal RuntimeString/RuntimeArray model below.
 * =================================================================== */

/* Forward decls for array helpers defined later in this file. */
RuntimeValue rt_array_new_with_cap(RuntimeValue cap_val);
RuntimeValue rt_array_get(RuntimeValue arr, RuntimeValue idx);
int8_t rt_array_set(RuntimeValue arr, RuntimeValue idx, RuntimeValue val);

/* --- float bit reinterpret (from x86_64 primitives.c) --- */
RuntimeValue f32_from_bits(RuntimeValue bits)
{
    uint32_t fbits = (uint32_t)(DECODE_INT(bits) & 0xFFFFFFFF);
    return (RuntimeValue)(((uint64_t)fbits << 3) | TAG_FLOAT);
}
RuntimeValue f64_from_bits(RuntimeValue bits)
{
    uint64_t fbits = (uint64_t)DECODE_INT(bits);
    return (RuntimeValue)((fbits << 3) | TAG_FLOAT);
}

/* --- any-add (from x86_64 baremetal_stubs.c) --- */
int64_t rt_any_add(int64_t left, int64_t right)
{
    /* BUGFIX (freestanding_text_concat_chain_drops_operands_2026-08-05):
     * see the x86_64 baremetal_stubs.c sibling for the full writeup -- this
     * copy inherited the same raw-`left + right` bug, which silently drops
     * data on a 3+ operand `text` `+` chain whose middle operand(s)
     * type-infer as ANY (e.g. a `.substring().trim()` chain with no
     * explicit `text` annotation). Mirror src/runtime/runtime_native.c and
     * src/runtime/simple_core/core_string.spl: dispatch to string
     * concatenation whenever either operand is a heap value. */
    if (IS_HEAP(left) || IS_HEAP(right)) {
        return rt_string_concat(left, right);
    }
    return left + right;
}

/* --- for-loop iterable passthrough (from riscv64 freestanding_runtime.c) --- */
RuntimeValue rt_for_iterable(RuntimeValue collection)
{
    return collection;
}

/* --- process / time --- */
/* Single-process boot path: the fs-exec entry runs as the sole kernel-origin
 * task, so pid 1 is the honest current pid here. */
RuntimeValue rt_getpid(void) { return ENCODE_INT(1); }
/* Microseconds from the ARM generic timer (CNTVCT_EL0 / CNTFRQ_EL0). CNTVCT is
 * confirmed readable in this boot path (see rt_arm64_harden_canary_value). No
 * RTC is wired on this baremetal target, so this is monotonic uptime-since-boot,
 * not a Unix epoch — the honest best available without an RTC. The split
 * quotient/remainder scaling avoids u64 overflow on (cntvct * 1e6). */
RuntimeValue rt_time_now_unix_micros(void)
{
    uint64_t cntvct = 0;
    uint64_t cntfrq = 0;
    __asm__ volatile("mrs %0, cntvct_el0" : "=r"(cntvct));
    __asm__ volatile("mrs %0, cntfrq_el0" : "=r"(cntfrq));
    if (cntfrq == 0) return ENCODE_INT(0);
    uint64_t micros = (cntvct / cntfrq) * 1000000ULL
                    + ((cntvct % cntfrq) * 1000000ULL) / cntfrq;
    return ENCODE_INT((int64_t)(micros & 0x7FFFFFFFFFFFFFFFULL));
}

/* --- value-as-int (from x86_64 rt_extras.c) --- */
RuntimeValue rt_value_as_int(RuntimeValue v)
{
    if (IS_INT(v)) return DECODE_INT(v);
    return 0;
}

/* --- text hashing: FNV-1a over the string bytes (adapted to RuntimeString) --- */
RuntimeValue rt_hash_text(RuntimeValue str)
{
    if (!IS_HEAP(str)) return ENCODE_INT(0);
    HeapHeader *h = (HeapHeader *)DECODE_PTR(str);
    if (!h || h->type != HEAP_STRING) return ENCODE_INT(0);
    RuntimeString *s = (RuntimeString *)h;
    uint64_t hash = 1469598103934665603ULL; /* FNV offset basis */
    for (uint32_t i = 0; i < s->len; i++) {
        hash ^= (uint64_t)(uint8_t)s->data[i];
        hash *= 1099511628211ULL; /* FNV prime */
    }
    return ENCODE_INT((int64_t)(hash & 0x7FFFFFFFFFFFFFFFULL));
}

/* --- string char code (adapted from riscv64 freestanding_runtime.c) --- */
RuntimeValue rt_string_char_code_at(RuntimeValue value, RuntimeValue index_value)
{
    const uint8_t *data;
    uint64_t len;
    int64_t index = (int64_t)index_value;
    uint64_t byte_index = 0;
    uint64_t char_index = 0;
    if (index < 0) return 0;
    HeapHeader *h = IS_HEAP(value) ? (HeapHeader *)DECODE_PTR(value) : (HeapHeader *)0;
    if (h && h->type == HEAP_STRING) {
        RuntimeString *s = (RuntimeString *)h;
        data = (const uint8_t *)s->data;
        len = s->len;
    } else {
        data = (const uint8_t *)(uintptr_t)value;
        if (!data) return 0;
        len = strlen((const char *)data);
    }
    while (byte_index < len) {
        uint8_t b0 = data[byte_index];
        uint64_t width = 1;
        RuntimeValue code = b0;
        if (b0 >= 194 && b0 <= 223 && byte_index + 1 < len) {
            width = 2;
            code = ((RuntimeValue)(b0 & 31) << 6) | (data[byte_index + 1] & 63);
        } else if (b0 >= 224 && b0 <= 239 && byte_index + 2 < len) {
            width = 3;
            code = ((RuntimeValue)(b0 & 15) << 12) | ((RuntimeValue)(data[byte_index + 1] & 63) << 6) | (data[byte_index + 2] & 63);
        } else if (b0 >= 240 && b0 <= 244 && byte_index + 3 < len) {
            width = 4;
            code = ((RuntimeValue)(b0 & 7) << 18) | ((RuntimeValue)(data[byte_index + 1] & 63) << 12) | ((RuntimeValue)(data[byte_index + 2] & 63) << 6) | (data[byte_index + 3] & 63);
        }
        if (char_index == (uint64_t)index) return code;
        byte_index += width;
        char_index += 1;
    }
    return 0;
}

RuntimeValue __simple_rt_string_char_code_at(RuntimeValue value, RuntimeValue index_value)
{
    return rt_string_char_code_at(value, index_value);
}

/* --- bytes <-> text. arrays here are RuntimeArray of ENCODE_INT(byte). --- */
RuntimeValue rt_bytes_from_raw(RuntimeValue ptr, RuntimeValue len)
{
    uint8_t *p = (uint8_t *)(uintptr_t)DECODE_INT(ptr);
    int64_t n = DECODE_INT(len);
    if (!p || n <= 0) return rt_array_new(ENCODE_INT(0));
    RuntimeValue arr = rt_array_new(ENCODE_INT(n));
    for (int64_t i = 0; i < n; i++) {
        rt_array_push(arr, ENCODE_INT((int64_t)p[i]));
    }
    return arr;
}

RuntimeValue rt_bytes_to_text(RuntimeValue arr_rv)
{
    if (!IS_HEAP(arr_rv)) return rt_string_from_cstr("");
    RuntimeArray *a = (RuntimeArray *)DECODE_PTR(arr_rv);
    if (!a || a->hdr.type != HEAP_ARRAY || a->len == 0) return rt_string_from_cstr("");
    RuntimeString *s = (RuntimeString *)malloc(sizeof(RuntimeString) + a->len + 1);
    if (!s) return NIL_VALUE;
    s->hdr.type = HEAP_STRING;
    s->hdr.size = (uint32_t)(sizeof(RuntimeString) + a->len + 1);
    s->len = a->len;
    for (uint32_t i = 0; i < a->len; i++) {
        s->data[i] = (char)(int64_t)DECODE_INT(a->items[i]);
    }
    s->data[a->len] = '\0';
    return ENCODE_PTR(s);
}

/* bytes_to_string is the same conversion as rt_bytes_to_text */
RuntimeValue bytes_to_string(RuntimeValue arr_rv)
{
    return rt_bytes_to_text(arr_rv);
}

/* --- typed array helpers --- */
RuntimeValue rt_array_new_with_cap_u64(RuntimeValue cap)
{
    return rt_array_new_with_cap(cap);
}

/* [text] arrays share the generic RuntimeArray storage of tagged values. */
RuntimeValue rt_array_get_text(RuntimeValue arr, RuntimeValue idx)
{
    return rt_array_get(arr, idx);
}
RuntimeValue rt_array_set_text(RuntimeValue arr, RuntimeValue idx, RuntimeValue val)
{
    rt_array_set(arr, idx, val);
    return TRUE_VALUE;
}
/* data_ptr -> address of the first element slot in the RuntimeArray. */
RuntimeValue rt_array_data_ptr_text(RuntimeValue arr)
{
    if (!IS_HEAP(arr)) return ENCODE_INT(0);
    RuntimeArray *a = (RuntimeArray *)DECODE_PTR(arr);
    if (!a || a->hdr.type != HEAP_ARRAY) return ENCODE_INT(0);
    return ENCODE_INT((int64_t)(uintptr_t)a->items);
}
RuntimeValue rt_array_set_len_known_text(RuntimeValue arr, RuntimeValue len)
{
    if (!IS_HEAP(arr)) return FALSE_VALUE;
    RuntimeArray *a = (RuntimeArray *)DECODE_PTR(arr);
    if (!a || a->hdr.type != HEAP_ARRAY) return FALSE_VALUE;
    int64_t n = DECODE_INT(len);
    if (n < 0 || (uint32_t)n > a->cap) return FALSE_VALUE;
    a->len = (uint32_t)n;
    return TRUE_VALUE;
}

/* typed-words accessors over the generic RuntimeArray (values stored tagged). */
RuntimeValue rt_typed_words_u32_at(RuntimeValue arr, RuntimeValue idx)
{
    if (!IS_HEAP(arr)) return ENCODE_INT(0);
    RuntimeArray *a = (RuntimeArray *)DECODE_PTR(arr);
    if (!a || a->hdr.type != HEAP_ARRAY) return ENCODE_INT(0);
    int64_t i = DECODE_INT(idx);
    if (i < 0 || (uint32_t)i >= a->len) return ENCODE_INT(0);
    return ENCODE_INT((int64_t)(uint32_t)DECODE_INT(a->items[i]));
}
RuntimeValue rt_typed_words_u32_set(RuntimeValue arr, RuntimeValue idx, RuntimeValue val)
{
    return rt_array_set(arr, idx, val) ? TRUE_VALUE : FALSE_VALUE;
}
RuntimeValue rt_typed_words_u64_at(RuntimeValue arr, RuntimeValue idx)
{
    if (!IS_HEAP(arr)) return ENCODE_INT(0);
    RuntimeArray *a = (RuntimeArray *)DECODE_PTR(arr);
    if (!a || a->hdr.type != HEAP_ARRAY) return ENCODE_INT(0);
    int64_t i = DECODE_INT(idx);
    if (i < 0 || (uint32_t)i >= a->len) return ENCODE_INT(0);
    return a->items[i];
}
int8_t rt_typed_words_u64_push(RuntimeValue arr, int64_t val)
{
    rt_array_push(arr, ENCODE_INT(val));
    return 1;
}
int8_t rt_typed_words_u64_set(RuntimeValue arr, int64_t idx, int64_t val)
{
    return rt_array_set(arr, idx, ENCODE_INT(val));
}

/* --- interpreter call bridge: not reachable on the native boot path. --- */
RuntimeValue rt_interp_call(RuntimeValue a, RuntimeValue b, RuntimeValue c,
                            RuntimeValue d, RuntimeValue e, RuntimeValue f,
                            RuntimeValue g, RuntimeValue h)
{
    (void)a; (void)b; (void)c; (void)d; (void)e; (void)f; (void)g; (void)h;
    return NIL_VALUE;
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

/* Bug (2026-08-11): freestanding text ORDERING (`<`/`>`/sort) against a RAW
 * literal. rt_native_cmp below required BOTH operands IS_HEAP before doing a
 * content compare of text; a heap string vs a raw untagged char* literal
 * (e.g. `""` from emit_bootstrap_str_const) fell through to the raw signed
 * word compare at the bottom, so ordering against a literal reflected
 * malloc address, not content -- same class of defect this lane's
 * rt_native_eq already got fixed for (see the comment above it), just never
 * ported to ordering. Same conservative safety rules as that fix: raw is
 * only dereferenced when the OTHER side is a proven HEAP_STRING, guarded by
 * the 0x10000 floor, scan bounded by the heap string's own length.
 *
 * Selfcheck: src/runtime/test/rt_text_cmp_any_heap_vs_raw_selfcheck.c
 */
static int rt_text_cmp_heap_vs_raw(RuntimeString *s, RuntimeValue raw, int *ok)
{
    const char *p;
    uint32_t i;
    *ok = 0;
    if ((uint64_t)raw < 0x10000ULL) return 0;               /* nil / bool / small int */
    if (((uint64_t)raw & TAG_MASK) == TAG_HEAP) return 0;   /* not a raw pointer */
    p = (const char *)(uintptr_t)raw;
    for (i = 0; i < s->len; i++) {
        unsigned char sc = (unsigned char)s->data[i];
        unsigned char pc = (unsigned char)p[i];
        if (pc == '\0') { *ok = 1; return 1; }               /* raw ends first -> s greater */
        if (sc != pc) { *ok = 1; return sc < pc ? -1 : 1; }
    }
    *ok = 1;
    return p[s->len] == '\0' ? 0 : -1;                       /* equal length, or raw has more */
}

/* Three-way ordering for erased operands emitted by the pure-Simple
 * Cranelift lane. Integer tagging is an order-preserving left shift, so a
 * signed word comparison is correct for raw and tagged integers. Heap strings
 * require byte-wise lexical ordering, matching the hosted runtime owner. */
RuntimeValue rt_native_cmp(RuntimeValue left, RuntimeValue right)
{
    if (left == right) return (RuntimeValue)0;
    if (IS_HEAP(left) && IS_HEAP(right)) {
        HeapHeader *left_header = (HeapHeader *)DECODE_PTR(left);
        HeapHeader *right_header = (HeapHeader *)DECODE_PTR(right);
        if (left_header && right_header &&
            left_header->type == HEAP_STRING && right_header->type == HEAP_STRING) {
            RuntimeString *left_string = (RuntimeString *)left_header;
            RuntimeString *right_string = (RuntimeString *)right_header;
            uint32_t count = left_string->len < right_string->len
                ? left_string->len : right_string->len;
            for (uint32_t i = 0; i < count; i++) {
                unsigned char left_byte = (unsigned char)left_string->data[i];
                unsigned char right_byte = (unsigned char)right_string->data[i];
                if (left_byte != right_byte)
                    return (RuntimeValue)(left_byte < right_byte ? -1 : 1);
            }
            if (left_string->len == right_string->len) return (RuntimeValue)0;
            return (RuntimeValue)(left_string->len < right_string->len ? -1 : 1);
        }
    }
    if (IS_HEAP(left)) {
        HeapHeader *hl = (HeapHeader *)DECODE_PTR(left);
        if (hl && hl->type == HEAP_STRING) {
            int ok;
            int r = rt_text_cmp_heap_vs_raw((RuntimeString *)hl, right, &ok);
            if (ok) return (RuntimeValue)r;
        }
    }
    if (IS_HEAP(right)) {
        HeapHeader *hr = (HeapHeader *)DECODE_PTR(right);
        if (hr && hr->type == HEAP_STRING) {
            int ok;
            int r = rt_text_cmp_heap_vs_raw((RuntimeString *)hr, left, &ok);
            if (ok) return (RuntimeValue)(-r);
        }
    }
    return (RuntimeValue)((int64_t)left < (int64_t)right ? -1 : 1);
}

/* Erased text comparisons use the same three-way ordering owner. */
int64_t rt_text_cmp_any(RuntimeValue left, RuntimeValue right)
{
    return (int64_t)rt_native_cmp(left, right);
}

RuntimeValue rt_platform_name(void)
{
    return rt_string_from_cstr("simpleos");
}

RuntimeValue text_dot_from_char_code(int64_t code)
{
    char bytes[4];
    size_t len;
    if (code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
        return NIL_VALUE;
    if (code <= 0x7f) {
        bytes[0] = (char)code;
        len = 1;
    } else if (code <= 0x7ff) {
        bytes[0] = (char)(0xc0 | ((uint64_t)code >> 6));
        bytes[1] = (char)(0x80 | ((uint64_t)code & 0x3f));
        len = 2;
    } else if (code <= 0xffff) {
        bytes[0] = (char)(0xe0 | ((uint64_t)code >> 12));
        bytes[1] = (char)(0x80 | (((uint64_t)code >> 6) & 0x3f));
        bytes[2] = (char)(0x80 | ((uint64_t)code & 0x3f));
        len = 3;
    } else {
        bytes[0] = (char)(0xf0 | ((uint64_t)code >> 18));
        bytes[1] = (char)(0x80 | (((uint64_t)code >> 12) & 0x3f));
        bytes[2] = (char)(0x80 | (((uint64_t)code >> 6) & 0x3f));
        bytes[3] = (char)(0x80 | ((uint64_t)code & 0x3f));
        len = 4;
    }
    return rt_string_new((RuntimeValue)(uintptr_t)bytes, (RuntimeValue)len);
}

#define ECAM_BASE 0x4010000000ULL
#define MAX_PCI_CACHED 32

static struct {
    uint8_t bus, dev, func;
    uint16_t vendor, devid;
    uint8_t cls, sub, progif, htype, irq;
    uint32_t bar0;
} _pci_cache[MAX_PCI_CACHED];
static int _pci_cache_count = -1;

static void _pci_scan(void)
{
    _pci_cache_count = 0;
    for (int dev = 0; dev < 32 && _pci_cache_count < MAX_PCI_CACHED; dev++) {
        volatile uint32_t *cfg = (volatile uint32_t *)(ECAM_BASE + ((uint64_t)dev << 15));
        uint32_t reg0 = cfg[0];
        uint16_t vendor = (uint16_t)(reg0 & 0xFFFF);
        uint16_t devid_val = (uint16_t)(reg0 >> 16);
        if (vendor == 0xFFFF || vendor == 0) continue;
        uint32_t class_reg = cfg[2];
        uint32_t hdr_reg = cfg[3];
        uint32_t irq_reg = cfg[15]; /* offset 0x3C */
        uint32_t bar0_reg = cfg[4]; /* offset 0x10 */
        int i = _pci_cache_count++;
        _pci_cache[i].bus = 0;
        _pci_cache[i].dev = (uint8_t)dev;
        _pci_cache[i].func = 0;
        _pci_cache[i].vendor = vendor;
        _pci_cache[i].devid = devid_val;
        _pci_cache[i].cls = (uint8_t)(class_reg >> 24);
        _pci_cache[i].sub = (uint8_t)(class_reg >> 16);
        _pci_cache[i].progif = (uint8_t)(class_reg >> 8);
        _pci_cache[i].htype = (uint8_t)(hdr_reg >> 16);
        _pci_cache[i].irq = (uint8_t)(irq_reg & 0xFF);
        _pci_cache[i].bar0 = bar0_reg & 0xFFFFFFF0;
    }
}

int64_t _pci_enumerate(uint64_t mode, uint64_t index, uint64_t buf_addr)
{
    if (_pci_cache_count < 0) _pci_scan();

    if (mode == 0) return (int64_t)_pci_cache_count;
    if (mode == 1) {
        if ((int)index >= _pci_cache_count) return -22;
        uint8_t *buf = (uint8_t *)(uintptr_t)buf_addr;
        int i = (int)index;
        buf[0] = _pci_cache[i].bus;
        buf[1] = _pci_cache[i].dev;
        buf[2] = _pci_cache[i].func;
        buf[3] = 0;
        *(uint16_t *)(buf + 4) = _pci_cache[i].vendor;
        *(uint16_t *)(buf + 6) = _pci_cache[i].devid;
        buf[8] = _pci_cache[i].cls;
        buf[9] = _pci_cache[i].sub;
        buf[10] = _pci_cache[i].progif;
        buf[11] = _pci_cache[i].htype;
        buf[12] = _pci_cache[i].irq;
        return 0;
    }
    if (mode == 2) {
        if ((int)index >= _pci_cache_count) return -22;
        int i = (int)index;
        return (int64_t)(
            ((uint64_t)_pci_cache[i].bus) |
            ((uint64_t)_pci_cache[i].dev << 8) |
            ((uint64_t)_pci_cache[i].func << 16) |
            ((uint64_t)_pci_cache[i].cls << 24) |
            ((uint64_t)_pci_cache[i].sub << 32) |
            ((uint64_t)_pci_cache[i].vendor << 40)
        );
    }
    if (mode == 3) {
        if ((int)index >= _pci_cache_count) return -22;
        int i = (int)index;
        return (int64_t)(
            ((uint64_t)_pci_cache[i].devid) |
            ((uint64_t)_pci_cache[i].progif << 16) |
            ((uint64_t)_pci_cache[i].irq << 24)
        );
    }
    if (mode == 4) {
        if ((int)index >= _pci_cache_count) return -22;
        int i = (int)index;
        switch ((int)buf_addr) {
            case 0: return (int64_t)_pci_cache[i].bus;
            case 1: return (int64_t)_pci_cache[i].dev;
            case 2: return (int64_t)_pci_cache[i].func;
            case 3: return (int64_t)_pci_cache[i].cls;
            case 4: return (int64_t)_pci_cache[i].sub;
            case 5: return (int64_t)_pci_cache[i].vendor;
            case 6: return (int64_t)_pci_cache[i].devid;
            case 7: return (int64_t)_pci_cache[i].irq;
            default: return -22;
        }
    }
    if (mode == 5) {
        if ((int)index >= _pci_cache_count) return -22;
        return (int64_t)_pci_cache[(int)index].bar0;
    }
    return -38;
}

typedef int64_t (*arm64_syscall_shim_fn)(uint64_t, uint64_t, uint64_t,
                                         uint64_t, uint64_t, uint64_t);
extern int64_t spl_handle_net_socket(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t) __attribute__((weak));
extern int64_t spl_handle_net_bind(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t) __attribute__((weak));
extern int64_t spl_handle_net_listen(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t) __attribute__((weak));
extern int64_t spl_handle_net_connect(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t) __attribute__((weak));
extern int64_t spl_handle_net_accept(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t) __attribute__((weak));
extern int64_t spl_handle_net_send_to(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t) __attribute__((weak));
extern int64_t spl_handle_net_recv_from(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t) __attribute__((weak));
extern int64_t spl_handle_ipc_send(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t) __attribute__((weak));
extern int64_t spl_handle_ipc_recv(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t) __attribute__((weak));
extern int64_t spl_handle_ipc_create_port(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t) __attribute__((weak));
extern int64_t spl_handle_file_open(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t) __attribute__((weak));
extern int64_t spl_handle_file_read(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t) __attribute__((weak));
extern int64_t spl_handle_file_write(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t) __attribute__((weak));
extern int64_t spl_handle_file_close(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t) __attribute__((weak));
extern int64_t spl_handle_file_sync(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t) __attribute__((weak));
extern int64_t spl_shim_file_capability_check(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t) __attribute__((weak));
extern int64_t spl_arm64_net_socket_direct(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t) __attribute__((weak));
extern int64_t spl_arm64_net_bind_direct(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t) __attribute__((weak));
extern int64_t spl_arm64_net_listen_direct(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t) __attribute__((weak));
extern int64_t spl_arm64_net_connect_direct(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t) __attribute__((weak));
extern int64_t spl_arm64_net_accept_direct(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t) __attribute__((weak));
extern int64_t spl_arm64_net_send_direct(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t) __attribute__((weak));
extern int64_t spl_arm64_net_recv_direct(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t) __attribute__((weak));
extern int64_t spl_arm64_net_close_direct(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t) __attribute__((weak));
extern int64_t spl_shim_net_capability_check(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t) __attribute__((weak));
extern int64_t rt_arm64_virtio_net_ready(void);

static int64_t arm64_dispatch_optional_shim(arm64_syscall_shim_fn shim,
                                            uint64_t a0, uint64_t a1,
                                            uint64_t a2, uint64_t a3,
                                            uint64_t a4)
{
    if (!shim) return -38; /* ENOSYS: entry closure did not link the owner. */
    return shim(a0, a1, a2, a3, a4, 0);
}

static int64_t arm64_dispatch_file_shim(uint64_t syscall_id,
                                        arm64_syscall_shim_fn shim,
                                        uint64_t a0, uint64_t a1,
                                        uint64_t a2, uint64_t a3,
                                        uint64_t a4)
{
    if (!spl_shim_file_capability_check) return -1;
    if (spl_shim_file_capability_check(syscall_id, a0, a1, a2, a3, a4) < 0)
        return -1;
    return arm64_dispatch_optional_shim(shim, a0, a1, a2, a3, a4);
}

static int64_t arm64_dispatch_net_shim(uint64_t syscall_id,
                                       arm64_syscall_shim_fn direct,
                                       arm64_syscall_shim_fn fallback,
                                       uint64_t a0, uint64_t a1,
                                       uint64_t a2, uint64_t a3,
                                       uint64_t a4)
{
    if (!spl_shim_net_capability_check) return -1; /* deny without owner */
    if (spl_shim_net_capability_check(syscall_id, a0, a1, a2, a3, a4) < 0)
        return -1;
    if (rt_arm64_virtio_net_ready() > 0 && direct)
        return direct(a0, a1, a2, a3, a4, 0);
    return arm64_dispatch_optional_shim(fallback, a0, a1, a2, a3, a4);
}

int64_t userlib__syscall_raw__syscall(uint64_t id, uint64_t a0, uint64_t a1,
                                       uint64_t a2, uint64_t a3, uint64_t a4)
{
    (void)a3; (void)a4;
    switch (id) {
        case 0:  /* Exit */
            for (;;) __asm__ volatile("wfe");
            return 0;
        case 4:  /* GetPid */
            return 1;
        case 60: /* DebugWrite */
            serial_putchar((char)(a0 & 0xFF));
            return 0;
        case 20: return arm64_dispatch_optional_shim(spl_handle_ipc_send, a0, a1, a2, a3, a4);
        case 21: return arm64_dispatch_optional_shim(spl_handle_ipc_recv, a0, a1, a2, a3, a4);
        case 22: return arm64_dispatch_optional_shim(spl_handle_ipc_create_port, a0, a1, a2, a3, a4);
        case 30: return arm64_dispatch_file_shim(30, spl_handle_file_open, a0, a1, a2, a3, a4);
        case 31: return arm64_dispatch_file_shim(31, spl_handle_file_read, a0, a1, a2, a3, a4);
        case 32: return arm64_dispatch_file_shim(32, spl_handle_file_write, a0, a1, a2, a3, a4);
        case 33:
            if (spl_arm64_net_close_direct) {
                int64_t net_close = spl_arm64_net_close_direct(a0, a1, a2, a3, a4, 0);
                if (net_close != -4096) return net_close;
            }
            return arm64_dispatch_optional_shim(spl_handle_file_close, a0, a1, a2, a3, a4);
        case 78: return arm64_dispatch_file_shim(78, spl_handle_file_sync, a0, 0, 0, 0, 0);
        /* Ring-3 server payloads have no ambient hardware authority. Device
         * enumeration/grant/BAR/DMA remain kernel-only until the canonical
         * Device* capability shims replace these historical raw shortcuts. */
        case 80: /* DevEnumerate */ return -1;
        case 81: /* DevGetInfo */ return -1;
        case 82: /* DeviceGrant */ return -1;
        case 83: /* MapBar */ return -1;
        case 84: /* AllocDma */ return -1;
        case 85: /* FreeDma */ return -1;
        case 86: /* DeviceWaitIrq */ return -1;
        case 87: /* DeviceAckIrq */ return -1;
        case 70: return arm64_dispatch_net_shim(70, spl_arm64_net_socket_direct, spl_handle_net_socket, a0, a1, a2, a3, a4);
        case 71: return arm64_dispatch_net_shim(71, spl_arm64_net_bind_direct, spl_handle_net_bind, a0, a1, a2, a3, a4);
        case 72: return arm64_dispatch_net_shim(72, spl_arm64_net_listen_direct, spl_handle_net_listen, a0, a1, a2, a3, a4);
        case 73: return arm64_dispatch_net_shim(73, spl_arm64_net_connect_direct, spl_handle_net_connect, a0, a1, a2, a3, a4);
        case 74: return arm64_dispatch_net_shim(74, spl_arm64_net_accept_direct, spl_handle_net_accept, a0, a1, a2, a3, a4);
        case 75: return arm64_dispatch_net_shim(75, spl_arm64_net_send_direct, spl_handle_net_send_to, a0, a1, a2, a3, a4);
        case 76: return arm64_dispatch_net_shim(76, spl_arm64_net_recv_direct, spl_handle_net_recv_from, a0, a1, a2, a3, a4);
        default:
            return -38; /* ENOSYS */
    }
}

int64_t syscall(uint64_t id, uint64_t a0, uint64_t a1,
                uint64_t a2, uint64_t a3, uint64_t a4)
{
    return userlib__syscall_raw__syscall(id, a0, a1, a2, a3, a4);
}

int64_t simpleos_syscall(uint64_t id, uint64_t a0, uint64_t a1,
                         uint64_t a2, uint64_t a3, uint64_t a4)
{
    return userlib__syscall_raw__syscall(id, a0, a1, a2, a3, a4);
}

#define ARM64_IPC_TRANSFER_MAX (64U * 1024U)
static uint8_t arm64_ipc_send_buffer[ARM64_IPC_TRANSFER_MAX];
static uint8_t arm64_ipc_recv_buffer[ARM64_IPC_TRANSFER_MAX];
static uint8_t arm64_ipc_send_owned;
static uint8_t arm64_ipc_recv_owned;

int64_t rt_ipc_send_bytes(uint64_t port, uint64_t method, RuntimeValue data)
{
    if (!IS_HEAP(data)) return -22;
    RuntimeArray *arr = (RuntimeArray *)DECODE_PTR(data);
    if (!arm64_heap_contains(arr, sizeof(*arr)) || arr->hdr.type != HEAP_ARRAY ||
        arr->len > arr->cap || arr->len > ARM64_IPC_TRANSFER_MAX - 4U) return -22;
    size_t len = (size_t)arr->len + 4U;
    if (__atomic_test_and_set(&arm64_ipc_send_owned, __ATOMIC_ACQUIRE)) return -11;
    uint8_t *raw = arm64_ipc_send_buffer;
    raw[0] = (uint8_t)method;
    raw[1] = (uint8_t)(method >> 8);
    raw[2] = (uint8_t)(method >> 16);
    raw[3] = (uint8_t)(method >> 24);
    for (uint64_t i = 0; i < arr->len; ++i)
        raw[i + 4U] = (uint8_t)(IS_INT(arr->items[i]) ? DECODE_INT(arr->items[i]) : arr->items[i]);
    int64_t result = userlib__syscall_raw__syscall(20, port, (uint64_t)(uintptr_t)raw,
                                                   (uint64_t)len, 0, 0);
    __atomic_clear(&arm64_ipc_send_owned, __ATOMIC_RELEASE);
    return result;
}

RuntimeValue rt_ipc_recv_bytes(uint64_t port, int64_t max_len)
{
    if (max_len <= 0 || max_len > ARM64_IPC_TRANSFER_MAX) return rt_array_new(ENCODE_INT(0));
    if (__atomic_test_and_set(&arm64_ipc_recv_owned, __ATOMIC_ACQUIRE))
        return rt_array_new(ENCODE_INT(0));
    uint8_t *raw = arm64_ipc_recv_buffer;
    int64_t received = userlib__syscall_raw__syscall(21, port,
        (uint64_t)(uintptr_t)raw, (uint64_t)max_len, 0, 0);
    if (received <= 0 || received > max_len) {
        __atomic_clear(&arm64_ipc_recv_owned, __ATOMIC_RELEASE);
        return rt_array_new(ENCODE_INT(0));
    }
    RuntimeValue result = rt_array_new(ENCODE_INT(received));
    for (int64_t i = 0; i < received; ++i)
        rt_array_push(result, ENCODE_INT((int64_t)raw[i]));
    __atomic_clear(&arm64_ipc_recv_owned, __ATOMIC_RELEASE);
    return result;
}

void c_pcimgr_init(void)
{
    _pci_scan();
}

static void _pl011_init(void)
{
    *pl011_reg(PL011_CR) = 0;
    *pl011_reg(PL011_ICR) = 0x7FF;
    *pl011_reg(PL011_IBRD) = 1;
    *pl011_reg(PL011_FBRD) = 0;
    *pl011_reg(PL011_LCRH) = (3 << 5) | (1 << 4);
    *pl011_reg(PL011_CR) = (1 << 0) | (1 << 8) | (1 << 9);
}

extern void spl_start(void) __attribute__((weak));

void _c_start(void)
{
    serial_puts_direct("[BOOT] ARM64 _c_start entered\r\n");
    _pl011_init();
    serial_puts_direct("[BOOT] ARM64 pl011 init ok\r\n");

    /* Disable alignment checking — Cranelift may emit unaligned literal pools */
    {
        uint64_t sctlr;
        __asm__ volatile("mrs %0, sctlr_el1" : "=r"(sctlr));
        sctlr &= ~(1ULL << 1); /* Clear A bit (alignment check) */
        __asm__ volatile("msr sctlr_el1, %0" : : "r"(sctlr));
        __asm__ volatile("isb");
    }

    serial_puts("SimpleOS ARM64 boot\r\n");
    serial_puts("[BOOT] PL011 UART initialized at 0x09000000\r\n");
    serial_puts("[BOOT] Heap: 160 MB bump allocator\r\n");
    serial_puts("[BOOT] RuntimeValue: tagged 64-bit\r\n");

    _pci_scan();
    serial_puts("[BOOT] PCI: ");
    serial_put_dec(_pci_cache_count);
    serial_puts(" devices found\r\n");
    for (int i = 0; i < _pci_cache_count && i < 8; i++) {
        serial_puts("[BOOT]   ");
        serial_puthex(_pci_cache[i].bus); serial_puts(":");
        serial_puthex(_pci_cache[i].dev); serial_puts(".");
        serial_puthex(_pci_cache[i].func);
        serial_puts(" vendor="); serial_puthex(_pci_cache[i].vendor);
        serial_puts(" device="); serial_puthex(_pci_cache[i].devid);
        serial_puts(" class="); serial_puthex(_pci_cache[i].cls);
        serial_puts("."); serial_puthex(_pci_cache[i].sub);
        serial_puts("\r\n");
    }

    if (spl_start) {
        serial_puts("[BOOT] Calling spl_start()...\r\n");
        spl_start();
        serial_puts("[BOOT] spl_start() returned\r\n");
    } else {
        serial_puts("[BOOT] No spl_start() found (weak symbol)\r\n");
    }

    serial_puts("[BOOT] ARM64 boot complete\r\n");

    for (;;) {
        __asm__ volatile("wfe");
    }
}

RuntimeValue rt_add(RuntimeValue a, RuntimeValue b)
{
    if (IS_INT(a) && IS_INT(b))
        return ENCODE_INT(DECODE_INT(a) + DECODE_INT(b));
    if (IS_HEAP(a) || IS_HEAP(b))
        return rt_string_concat(a, b);
    return ENCODE_INT(0);
}

RuntimeValue rt_sub(RuntimeValue a, RuntimeValue b) { return ENCODE_INT(DECODE_INT(a) - DECODE_INT(b)); }
RuntimeValue rt_mul(RuntimeValue a, RuntimeValue b) { return ENCODE_INT(DECODE_INT(a) * DECODE_INT(b)); }
RuntimeValue rt_div(RuntimeValue a, RuntimeValue b) { int64_t d = DECODE_INT(b); if (d == 0) return ENCODE_INT(0); return ENCODE_INT(DECODE_INT(a) / d); }
RuntimeValue rt_mod(RuntimeValue a, RuntimeValue b) { int64_t d = DECODE_INT(b); if (d == 0) return ENCODE_INT(0); return ENCODE_INT(DECODE_INT(a) % d); }

RuntimeValue rt_pow(RuntimeValue a, RuntimeValue b)
{
    int64_t base = DECODE_INT(a);
    int64_t exp  = DECODE_INT(b);
    if (exp < 0) return ENCODE_INT(0);
    int64_t result = 1;
    for (int64_t i = 0; i < exp; i++) result *= base;
    return ENCODE_INT(result);
}

RuntimeValue rt_eq(RuntimeValue a, RuntimeValue b) { return rt_native_eq(a, b) ? TRUE_VALUE : FALSE_VALUE; }
RuntimeValue rt_ne(RuntimeValue a, RuntimeValue b) { return rt_native_eq(a, b) ? FALSE_VALUE : TRUE_VALUE; }
RuntimeValue rt_lt(RuntimeValue a, RuntimeValue b) { return (DECODE_INT(a) < DECODE_INT(b)) ? TRUE_VALUE : FALSE_VALUE; }
RuntimeValue rt_gt(RuntimeValue a, RuntimeValue b) { return (DECODE_INT(a) > DECODE_INT(b)) ? TRUE_VALUE : FALSE_VALUE; }
RuntimeValue rt_le(RuntimeValue a, RuntimeValue b) { return (DECODE_INT(a) <= DECODE_INT(b)) ? TRUE_VALUE : FALSE_VALUE; }
RuntimeValue rt_ge(RuntimeValue a, RuntimeValue b) { return (DECODE_INT(a) >= DECODE_INT(b)) ? TRUE_VALUE : FALSE_VALUE; }
RuntimeValue rt_and(RuntimeValue a, RuntimeValue b) { return (DECODE_INT(a) && DECODE_INT(b)) ? TRUE_VALUE : FALSE_VALUE; }
RuntimeValue rt_or(RuntimeValue a, RuntimeValue b) { return (DECODE_INT(a) || DECODE_INT(b)) ? TRUE_VALUE : FALSE_VALUE; }
RuntimeValue rt_not(RuntimeValue a) { return DECODE_INT(a) ? FALSE_VALUE : TRUE_VALUE; }
RuntimeValue rt_shl(RuntimeValue a, RuntimeValue b) { return ENCODE_INT(DECODE_INT(a) << DECODE_INT(b)); }
RuntimeValue rt_shr(RuntimeValue a, RuntimeValue b) { return ENCODE_INT(DECODE_INT(a) >> DECODE_INT(b)); }
RuntimeValue rt_bitand(RuntimeValue a, RuntimeValue b) { return ENCODE_INT(DECODE_INT(a) & DECODE_INT(b)); }
RuntimeValue rt_bitor(RuntimeValue a, RuntimeValue b) { return ENCODE_INT(DECODE_INT(a) | DECODE_INT(b)); }
RuntimeValue rt_bitxor(RuntimeValue a, RuntimeValue b) { return ENCODE_INT(DECODE_INT(a) ^ DECODE_INT(b)); }
RuntimeValue rt_bitnot(RuntimeValue a) { return ENCODE_INT(~DECODE_INT(a)); }
RuntimeValue rt_neg(RuntimeValue a) { return ENCODE_INT(-DECODE_INT(a)); }

RuntimeValue rt_type_of(RuntimeValue val) {
    if (IS_NIL(val)) return rt_string_from_cstr("nil");
    if (IS_INT(val)) return rt_string_from_cstr("int");
    if (IS_FLOAT(val)) return rt_string_from_cstr("float");
    if (IS_HEAP(val)) {
        HeapHeader *h = (HeapHeader *)DECODE_PTR(val);
        if (h) {
            if (h->type == HEAP_STRING) return rt_string_from_cstr("string");
            if (h->type == HEAP_ARRAY) return rt_string_from_cstr("array");
            if (h->type == HEAP_MAP) return rt_string_from_cstr("map");
            if (h->type == HEAP_OBJECT) return rt_string_from_cstr("object");
        }
        return rt_string_from_cstr("heap");
    }
    return rt_string_from_cstr("unknown");
}

RuntimeValue rt_is_nil(RuntimeValue v) { return IS_NIL(v) ? 1 : 0; }
RuntimeValue rt_is_int(RuntimeValue v) { return IS_INT(v) ? 1 : 0; }
RuntimeValue rt_is_float(RuntimeValue v) { return IS_FLOAT(v) ? 1 : 0; }
RuntimeValue rt_is_string(RuntimeValue v) { if (!IS_HEAP(v)) return 0; HeapHeader *h = (HeapHeader *)DECODE_PTR(v); return (h && h->type == HEAP_STRING) ? 1 : 0; }
RuntimeValue rt_is_bool(RuntimeValue v) { if (!IS_INT(v)) return 0; int64_t n = DECODE_INT(v); return (n == 0 || n == 1) ? 1 : 0; }
RuntimeValue rt_is_array(RuntimeValue v) { if (!IS_HEAP(v)) return 0; HeapHeader *h = (HeapHeader *)DECODE_PTR(v); return (h && h->type == HEAP_ARRAY) ? 1 : 0; }
RuntimeValue rt_is_map(RuntimeValue v) { if (!IS_HEAP(v)) return 0; HeapHeader *h = (HeapHeader *)DECODE_PTR(v); return (h && h->type == HEAP_MAP) ? 1 : 0; }
RuntimeValue rt_is_object(RuntimeValue v) { if (!IS_HEAP(v)) return 0; HeapHeader *h = (HeapHeader *)DECODE_PTR(v); return (h && h->type == HEAP_OBJECT) ? 1 : 0; }

RuntimeValue rt_to_int(RuntimeValue val) {
    if (IS_INT(val)) return val;
    if (IS_NIL(val)) return ENCODE_INT(0);
    if (IS_HEAP(val)) {
        HeapHeader *h = (HeapHeader *)DECODE_PTR(val);
        if (h && h->type == HEAP_STRING) {
            RuntimeString *s = (RuntimeString *)h;
            if (s->len == 0) return ENCODE_INT(0);
            int64_t result = 0; int neg = 0; uint32_t i = 0;
            if (s->data[0] == '-') { neg = 1; i = 1; }
            else if (s->data[0] == '+') { i = 1; }
            for (; i < s->len; i++) {
                char c = s->data[i];
                if (c < '0' || c > '9') break;
                result = result * 10 + (c - '0');
            }
            if (neg) result = -result;
            return ENCODE_INT(result);
        }
    }
    return ENCODE_INT(0);
}
RuntimeValue rt_to_string(RuntimeValue val) { return rt_value_to_string(val); }
RuntimeValue rt_to_bool(RuntimeValue val) {
    if (IS_NIL(val)) return FALSE_VALUE;
    if (IS_INT(val)) return DECODE_INT(val) ? TRUE_VALUE : FALSE_VALUE;
    if (IS_HEAP(val)) {
        HeapHeader *h = (HeapHeader *)DECODE_PTR(val);
        if (h && h->type == HEAP_STRING) return ((RuntimeString *)h)->len > 0 ? TRUE_VALUE : FALSE_VALUE;
        if (h && h->type == HEAP_ARRAY) return ((RuntimeArray *)h)->len > 0 ? TRUE_VALUE : FALSE_VALUE;
        return TRUE_VALUE;
    }
    return FALSE_VALUE;
}
RuntimeValue rt_clone(RuntimeValue val) {
    if (!IS_HEAP(val)) return val;
    HeapHeader *h = (HeapHeader *)DECODE_PTR(val);
    if (!h) return val;
    if (h->type == HEAP_STRING) {
        RuntimeString *s = (RuntimeString *)h;
        return rt_string_new((RuntimeValue)(uintptr_t)s->data, (RuntimeValue)s->len);
    }
    if (h->type == HEAP_ARRAY) {
        RuntimeArray *a = (RuntimeArray *)h;
        RuntimeValue new_arr = rt_array_new(ENCODE_INT(a->cap));
        for (uint32_t i = 0; i < a->len; i++) new_arr = rt_array_push_handle(new_arr, a->items[i]);
        return new_arr;
    }
    if (h->type == HEAP_MAP) return rt_map_clone(val);
    return val;
}
RuntimeValue rt_freeze(RuntimeValue val) { return val; }
RuntimeValue rt_is_frozen(RuntimeValue val) { (void)val; return 0; }

static RuntimeString *decode_string(RuntimeValue v) {
    if (!IS_HEAP(v)) return (RuntimeString *)0;
    RuntimeString *s = (RuntimeString *)DECODE_PTR(v);
    if (!s || s->hdr.type != HEAP_STRING) return (RuntimeString *)0;
    return s;
}

RuntimeValue rt_string_contains(RuntimeValue str, RuntimeValue needle) {
    RuntimeString *s = decode_string(str); RuntimeString *n = decode_string(needle);
    if (!s || !n) return 0; if (n->len == 0) return 1; if (n->len > s->len) return 0;
    for (uint32_t i = 0; i <= s->len - n->len; i++) {
        uint32_t j; for (j = 0; j < n->len; j++) { if (s->data[i+j] != n->data[j]) break; }
        if (j == n->len) return 1;
    } return 0;
}

RuntimeValue rt_string_starts_with(RuntimeValue str, RuntimeValue prefix) {
    RuntimeString *s = decode_string(str); RuntimeString *p = decode_string(prefix);
    if (!s || !p) return 0; if (p->len > s->len) return 0;
    for (uint32_t i = 0; i < p->len; i++) { if (s->data[i] != p->data[i]) return 0; }
    return 1;
}

RuntimeValue rt_string_ends_with(RuntimeValue str, RuntimeValue suffix) {
    RuntimeString *s = decode_string(str); RuntimeString *x = decode_string(suffix);
    if (!s || !x) return 0; if (x->len > s->len) return 0;
    uint32_t off = s->len - x->len;
    for (uint32_t i = 0; i < x->len; i++) { if (s->data[off+i] != x->data[i]) return 0; }
    return 1;
}

RuntimeValue rt_string_index_of(RuntimeValue str, RuntimeValue needle) {
    RuntimeString *s = decode_string(str); RuntimeString *n = decode_string(needle);
    if (!s || !n || n->len == 0) return ENCODE_INT(-1); if (n->len > s->len) return ENCODE_INT(-1);
    for (uint32_t i = 0; i <= s->len - n->len; i++) {
        uint32_t j; for (j = 0; j < n->len; j++) { if (s->data[i+j] != n->data[j]) break; }
        if (j == n->len) return ENCODE_INT((int64_t)i);
    } return ENCODE_INT(-1);
}

RuntimeValue rt_string_last_index_of(RuntimeValue str, RuntimeValue needle) {
    RuntimeString *s = decode_string(str); RuntimeString *n = decode_string(needle);
    if (!s || !n || n->len == 0) return ENCODE_INT(-1); if (n->len > s->len) return ENCODE_INT(-1);
    for (int64_t i = (int64_t)(s->len - n->len); i >= 0; i--) {
        uint32_t j; for (j = 0; j < n->len; j++) { if (s->data[i+j] != n->data[j]) break; }
        if (j == n->len) return ENCODE_INT(i);
    } return ENCODE_INT(-1);
}

RuntimeValue rt_string_substr(RuntimeValue str, RuntimeValue start) {
    RuntimeString *s = decode_string(str); if (!s) return NIL_VALUE;
    int64_t a = DECODE_INT(start); if (a < 0) a = 0;
    if ((uint32_t)a >= s->len) return rt_string_from_cstr("");
    return rt_string_slice(str, start, ENCODE_INT(s->len));
}

RuntimeValue rt_string_split(RuntimeValue str, RuntimeValue delim) {
    RuntimeString *s = decode_string(str); RuntimeString *d = decode_string(delim);
    RuntimeValue arr = rt_array_new(ENCODE_INT(4));
    if (!s || s->len == 0) return arr;
    if (!d || d->len == 0) {
        for (uint32_t i = 0; i < s->len; i++) {
            RuntimeValue ch = rt_string_new((RuntimeValue)(uintptr_t)&s->data[i], 1);
            arr = rt_array_push_handle(arr, ch);
        } return arr;
    }
    if (d->len > s->len) {
        return rt_array_push_handle(arr, str);
    }
    uint32_t start = 0;
    for (uint32_t i = 0; i <= s->len - d->len; ) {
        uint32_t j; for (j = 0; j < d->len; j++) { if (s->data[i+j] != d->data[j]) break; }
        if (j == d->len) {
            RuntimeValue part = rt_string_slice(str, ENCODE_INT(start), ENCODE_INT(i));
            arr = rt_array_push_handle(arr, part); i += d->len; start = i;
        } else { i++; }
    }
    RuntimeValue rest = rt_string_slice(str, ENCODE_INT(start), ENCODE_INT(s->len));
    arr = rt_array_push_handle(arr, rest); return arr;
}

static int is_whitespace(char c) { return c == ' ' || c == '\t' || c == '\n' || c == '\r'; }

RuntimeValue rt_string_trim(RuntimeValue str) {
    RuntimeString *s = decode_string(str); if (!s || s->len == 0) return str;
    uint32_t start = 0; while (start < s->len && is_whitespace(s->data[start])) start++;
    uint32_t end = s->len; while (end > start && is_whitespace(s->data[end-1])) end--;
    return rt_string_slice(str, ENCODE_INT(start), ENCODE_INT(end));
}
RuntimeValue rt_string_trim_start(RuntimeValue str) {
    RuntimeString *s = decode_string(str); if (!s || s->len == 0) return str;
    uint32_t start = 0; while (start < s->len && is_whitespace(s->data[start])) start++;
    return rt_string_slice(str, ENCODE_INT(start), ENCODE_INT(s->len));
}
RuntimeValue rt_string_trim_end(RuntimeValue str) {
    RuntimeString *s = decode_string(str); if (!s || s->len == 0) return str;
    uint32_t end = s->len; while (end > 0 && is_whitespace(s->data[end-1])) end--;
    return rt_string_slice(str, ENCODE_INT(0), ENCODE_INT(end));
}

RuntimeValue rt_string_to_upper(RuntimeValue str) {
    RuntimeString *s = decode_string(str); if (!s) return str;
    RuntimeString *r = (RuntimeString *)malloc(sizeof(RuntimeString) + s->len + 1);
    if (!r) return str; r->hdr.type = HEAP_STRING; r->hdr.size = (uint32_t)(sizeof(RuntimeString) + s->len + 1); r->len = s->len;
    for (uint32_t i = 0; i < s->len; i++) { char c = s->data[i]; r->data[i] = (c >= 'a' && c <= 'z') ? (char)(c-32) : c; }
    r->data[s->len] = '\0'; return ENCODE_PTR(r);
}
RuntimeValue rt_string_to_lower(RuntimeValue str) {
    RuntimeString *s = decode_string(str); if (!s) return str;
    RuntimeString *r = (RuntimeString *)malloc(sizeof(RuntimeString) + s->len + 1);
    if (!r) return str; r->hdr.type = HEAP_STRING; r->hdr.size = (uint32_t)(sizeof(RuntimeString) + s->len + 1); r->len = s->len;
    for (uint32_t i = 0; i < s->len; i++) { char c = s->data[i]; r->data[i] = (c >= 'A' && c <= 'Z') ? (char)(c+32) : c; }
    r->data[s->len] = '\0'; return ENCODE_PTR(r);
}

RuntimeValue rt_string_replace_all(RuntimeValue str, RuntimeValue old_val, RuntimeValue new_val);

RuntimeValue rt_string_replace(RuntimeValue str, RuntimeValue old_val, RuntimeValue new_val) {
    return rt_string_replace_all(str, old_val, new_val);
}

RuntimeValue rt_string_replace_all(RuntimeValue str, RuntimeValue old_val, RuntimeValue new_val) {
    RuntimeString *s = decode_string(str); RuntimeString *o = decode_string(old_val); RuntimeString *n = decode_string(new_val);
    if (!s || !o || o->len == 0 || o->len > s->len) return str; uint32_t nlen = n ? n->len : 0;
    uint32_t count = 0;
    for (uint32_t i = 0; o->len <= s->len - i; ) {
        uint32_t j; for (j = 0; j < o->len; j++) { if (s->data[i+j] != o->data[j]) break; }
        if (j == o->len) { count++; i += o->len; } else { i++; }
    }
    if (count == 0) return str;
    uint64_t result_len_wide = (uint64_t)s->len - (uint64_t)count * o->len + (uint64_t)count * nlen;
    if (result_len_wide > (uint64_t)UINT32_MAX - sizeof(RuntimeString) - 1U) return str;
    uint32_t result_len = (uint32_t)result_len_wide;
    RuntimeString *r = (RuntimeString *)malloc(sizeof(RuntimeString) + result_len + 1);
    if (!r) return str; r->hdr.type = HEAP_STRING; r->hdr.size = (uint32_t)(sizeof(RuntimeString) + result_len + 1); r->len = result_len;
    uint32_t out = 0;
    for (uint32_t i = 0; i < s->len; ) {
        if (o->len <= s->len - i) {
            uint32_t j; for (j = 0; j < o->len; j++) { if (s->data[i+j] != o->data[j]) break; }
            if (j == o->len) { if (n && nlen > 0) { __builtin_memcpy(r->data + out, n->data, nlen); out += nlen; } i += o->len; continue; }
        }
        r->data[out++] = s->data[i++];
    }
    r->data[result_len] = '\0'; return ENCODE_PTR(r);
}

RuntimeValue rt_string_repeat(RuntimeValue str, RuntimeValue count_val) {
    RuntimeString *s = decode_string(str); if (!s || s->len == 0) return str;
    int64_t count = DECODE_INT(count_val); if (count <= 0) return rt_string_from_cstr(""); if (count == 1) return str;
    if ((uint64_t)count * s->len > 0x100000) count = (int64_t)(0x100000 / s->len);
    uint32_t result_len = s->len * (uint32_t)count;
    RuntimeString *r = (RuntimeString *)malloc(sizeof(RuntimeString) + result_len + 1);
    if (!r) return str; r->hdr.type = HEAP_STRING; r->hdr.size = (uint32_t)(sizeof(RuntimeString) + result_len + 1); r->len = result_len;
    for (int64_t i = 0; i < count; i++) __builtin_memcpy(r->data + i * s->len, s->data, s->len);
    r->data[result_len] = '\0'; return ENCODE_PTR(r);
}

RuntimeValue rt_string_pad_start(RuntimeValue str, RuntimeValue width_val) {
    RuntimeString *s = decode_string(str); if (!s) return str;
    int64_t width = DECODE_INT(width_val); if (width <= 0 || (uint32_t)width <= s->len) return str;
    uint32_t pad = (uint32_t)width - s->len;
    RuntimeString *r = (RuntimeString *)malloc(sizeof(RuntimeString) + (uint32_t)width + 1);
    if (!r) return str; r->hdr.type = HEAP_STRING; r->hdr.size = (uint32_t)(sizeof(RuntimeString) + (uint32_t)width + 1); r->len = (uint32_t)width;
    __builtin_memset(r->data, ' ', pad); __builtin_memcpy(r->data + pad, s->data, s->len);
    r->data[(uint32_t)width] = '\0'; return ENCODE_PTR(r);
}

RuntimeValue rt_string_pad_end(RuntimeValue str, RuntimeValue width_val) {
    RuntimeString *s = decode_string(str); if (!s) return str;
    int64_t width = DECODE_INT(width_val); if (width <= 0 || (uint32_t)width <= s->len) return str;
    uint32_t pad = (uint32_t)width - s->len;
    RuntimeString *r = (RuntimeString *)malloc(sizeof(RuntimeString) + (uint32_t)width + 1);
    if (!r) return str; r->hdr.type = HEAP_STRING; r->hdr.size = (uint32_t)(sizeof(RuntimeString) + (uint32_t)width + 1); r->len = (uint32_t)width;
    __builtin_memcpy(r->data, s->data, s->len); __builtin_memset(r->data + s->len, ' ', pad);
    r->data[(uint32_t)width] = '\0'; return ENCODE_PTR(r);
}

RuntimeValue rt_string_reverse(RuntimeValue str) {
    RuntimeString *s = decode_string(str); if (!s || s->len <= 1) return str;
    RuntimeString *r = (RuntimeString *)malloc(sizeof(RuntimeString) + s->len + 1);
    if (!r) return str; r->hdr.type = HEAP_STRING; r->hdr.size = (uint32_t)(sizeof(RuntimeString) + s->len + 1); r->len = s->len;
    for (uint32_t i = 0; i < s->len; i++) r->data[i] = s->data[s->len - 1 - i];
    r->data[s->len] = '\0'; return ENCODE_PTR(r);
}

RuntimeValue rt_string_chars(RuntimeValue str) {
    RuntimeString *s = decode_string(str); RuntimeValue arr = rt_array_new(ENCODE_INT(s ? s->len : 0));
    if (!s) return arr;
    for (uint32_t i = 0; i < s->len;) {
        uint8_t lead = (uint8_t)s->data[i]; uint32_t width = 1;
        if (lead >= 0xC2 && lead <= 0xDF && i + 2 <= s->len) width = 2;
        else if (lead >= 0xE0 && lead <= 0xEF && i + 3 <= s->len) width = 3;
        else if (lead >= 0xF0 && lead <= 0xF4 && i + 4 <= s->len) width = 4;
        arr = rt_array_push_handle(arr, rt_string_new((RuntimeValue)(uintptr_t)&s->data[i], (RuntimeValue)width));
        i += width;
    }
    return arr;
}

RuntimeValue rt_string_bytes(RuntimeValue str) {
    RuntimeString *s = decode_string(str); RuntimeValue arr = rt_array_new(ENCODE_INT(s ? s->len : 0));
    if (!s) return arr;
    for (uint32_t i = 0; i < s->len; i++) arr = rt_array_push_handle(arr, ENCODE_INT((int64_t)(unsigned char)s->data[i]));
    return arr;
}

RuntimeValue rt_string_is_empty(RuntimeValue str) { RuntimeString *s = decode_string(str); if (!s) return 1; return s->len == 0 ? 1 : 0; }

RuntimeValue rt_string_compare(RuntimeValue a, RuntimeValue b) {
    RuntimeString *sa = decode_string(a); RuntimeString *sb = decode_string(b);
    if (!sa && !sb) return ENCODE_INT(0); if (!sa) return ENCODE_INT(-1); if (!sb) return ENCODE_INT(1);
    uint32_t min_len = sa->len < sb->len ? sa->len : sb->len;
    for (uint32_t i = 0; i < min_len; i++) { if (sa->data[i] != sb->data[i]) return ENCODE_INT((int64_t)(unsigned char)sa->data[i] - (int64_t)(unsigned char)sb->data[i]); }
    if (sa->len < sb->len) return ENCODE_INT(-1); if (sa->len > sb->len) return ENCODE_INT(1); return ENCODE_INT(0);
}

RuntimeValue rt_string_format(RuntimeValue fmt, RuntimeValue val) {
    RuntimeValue val_str = rt_value_to_string(val);
    if (!IS_HEAP(fmt)) return val_str;
    return rt_string_concat(fmt, val_str);
}

RuntimeValue rt_value_format_string(RuntimeValue val, RuntimeValue fmt_ptr_rv, RuntimeValue fmt_len_rv) {
    const char *spec = (const char *)(uintptr_t)fmt_ptr_rv;
    int64_t spec_len = fmt_len_rv;
    if (!spec || spec_len <= 0) return rt_value_to_string(val);
    /* Simple fallback: just convert to string */
    return rt_value_to_string(val);
}

RuntimeValue rt_array_new(RuntimeValue cap_val) {
    int64_t cap = (int64_t)simpleos_raw_or_encoded_int(cap_val);
    if (cap <= 0) cap = 64;
    if (cap < 64) cap = 64;
    if (cap > 0x100000) cap = 0x100000;
    size_t alloc_size = sizeof(RuntimeArray) + (size_t)cap * sizeof(RuntimeValue);
    RuntimeArray *a = (RuntimeArray *)malloc(alloc_size);
    if (!a) return NIL_VALUE; a->hdr.type = HEAP_ARRAY; a->hdr.size = (uint32_t)alloc_size; a->len = 0; a->cap = (uint64_t)cap; a->items = (RuntimeValue *)(a + 1);
    for (int64_t i = 0; i < cap; i++) a->items[i] = NIL_VALUE;
    return ENCODE_PTR(a);
}

static RuntimeValue rt_array_push_handle(RuntimeValue arr, RuntimeValue val) {
    if (!IS_HEAP(arr)) return NIL_VALUE;
    RuntimeArray *a = (RuntimeArray *)DECODE_PTR(arr);
    if (!a || a->hdr.type != HEAP_ARRAY) return NIL_VALUE;
    if (a->len >= a->cap) {
        uint64_t old_cap = a->cap;
        uint64_t new_cap = old_cap ? old_cap * 2 : 64;
        /* ponytail: the bump heap cannot reclaim old growth buffers; the
         * 1 MiB capacity ceiling bounds waste. Add last-allocation growth
         * only if long-lived ARM workloads measure allocator pressure. */
        RuntimeValue *grown = (RuntimeValue *)malloc((size_t)new_cap * sizeof(RuntimeValue));
        if (!grown) return ENCODE_PTR(a);
        for (uint64_t i = 0; i < a->len; i++) grown[i] = a->items[i];
        for (uint64_t i = a->len; i < new_cap; i++) grown[i] = NIL_VALUE;
        a->items = grown;
        a->cap = new_cap;
    }
    a->items[a->len] = val; a->len++;
    return ENCODE_PTR(a);
}

int8_t rt_array_push(RuntimeValue arr, RuntimeValue val) {
    return rt_array_push_handle(arr, val) != NIL_VALUE;
}

RuntimeValue rt_array_new_with_cap(RuntimeValue cap_val) {
    int64_t cap = (int64_t)simpleos_raw_or_encoded_int(cap_val);
    if (cap <= 0) cap = 1;
    if (cap > 0x100000) cap = 0x100000;
    size_t alloc_size = sizeof(RuntimeArray) + (size_t)cap * sizeof(RuntimeValue);
    RuntimeArray *a = (RuntimeArray *)malloc(alloc_size);
    if (!a) return NIL_VALUE;
    a->hdr.type = HEAP_ARRAY;
    a->hdr.size = (uint32_t)alloc_size;
    a->len = 0;
    a->cap = (uint64_t)cap;
    a->items = (RuntimeValue *)(a + 1);
    for (int64_t i = 0; i < cap; i++) a->items[i] = NIL_VALUE;
    return ENCODE_PTR(a);
}

RuntimeValue rt_array_pop(RuntimeValue arr) {
    if (!IS_HEAP(arr)) return NIL_VALUE; RuntimeArray *a = (RuntimeArray *)DECODE_PTR(arr);
    if (!a || a->hdr.type != HEAP_ARRAY || a->len == 0) return NIL_VALUE;
    a->len--; RuntimeValue val = a->items[a->len]; a->items[a->len] = NIL_VALUE; return val;
}

RuntimeValue rt_array_get(RuntimeValue arr, RuntimeValue idx) {
    if (!IS_HEAP(arr)) return NIL_VALUE; RuntimeArray *a = (RuntimeArray *)DECODE_PTR(arr);
    if (!a || a->hdr.type != HEAP_ARRAY) return NIL_VALUE;
    int64_t i = (int64_t)idx; if (i < 0) i += (int64_t)a->len;
    if (i < 0 || (uint64_t)i >= a->len) return NIL_VALUE;
    return a->items[i];
}

int8_t rt_array_set(RuntimeValue arr, RuntimeValue idx, RuntimeValue val) {
    if (!IS_HEAP(arr)) return 0; RuntimeArray *a = (RuntimeArray *)DECODE_PTR(arr);
    if (!a || a->hdr.type != HEAP_ARRAY) return 0;
    int64_t i = (int64_t)idx; if (i < 0) i += (int64_t)a->len;
    if (i < 0 || (uint64_t)i >= a->len) return 0;
    a->items[i] = val; return 1;
}

RuntimeValue rt_array_len(RuntimeValue arr) {
    if (!IS_HEAP(arr)) return 0; RuntimeArray *a = (RuntimeArray *)DECODE_PTR(arr);
    if (!a || a->hdr.type != HEAP_ARRAY) return 0; return (RuntimeValue)a->len;
}

RuntimeValue rt_array_slice(RuntimeValue arr, RuntimeValue start, RuntimeValue end) {
    if (!IS_HEAP(arr)) return NIL_VALUE; RuntimeArray *a = (RuntimeArray *)DECODE_PTR(arr);
    if (!a || a->hdr.type != HEAP_ARRAY) return NIL_VALUE;
    int64_t s = DECODE_INT(start); int64_t e = DECODE_INT(end);
    if (s < 0) s = 0; if (e > (int64_t)a->len) e = (int64_t)a->len;
    if (s >= e) return rt_array_new(ENCODE_INT(1));
    RuntimeValue result = rt_array_new(ENCODE_INT(e - s));
    for (int64_t i = s; i < e; i++) result = rt_array_push_handle(result, a->items[i]);
    return result;
}

RuntimeValue rt_array_contains(RuntimeValue arr, RuntimeValue val) {
    if (!IS_HEAP(arr)) return 0; RuntimeArray *a = (RuntimeArray *)DECODE_PTR(arr);
    if (!a || a->hdr.type != HEAP_ARRAY) return 0;
    for (uint32_t i = 0; i < a->len; i++) { if (rt_native_eq(a->items[i], val)) return 1; } return 0;
}

RuntimeValue rt_array_index_of(RuntimeValue arr, RuntimeValue val) {
    if (!IS_HEAP(arr)) return ENCODE_INT(-1); RuntimeArray *a = (RuntimeArray *)DECODE_PTR(arr);
    if (!a || a->hdr.type != HEAP_ARRAY) return ENCODE_INT(-1);
    for (uint32_t i = 0; i < a->len; i++) { if (rt_native_eq(a->items[i], val)) return ENCODE_INT(i); } return ENCODE_INT(-1);
}

RuntimeValue rt_array_last_index_of(RuntimeValue arr, RuntimeValue val) {
    if (!IS_HEAP(arr)) return ENCODE_INT(-1); RuntimeArray *a = (RuntimeArray *)DECODE_PTR(arr);
    if (!a || a->hdr.type != HEAP_ARRAY) return ENCODE_INT(-1);
    for (int64_t i = (int64_t)a->len - 1; i >= 0; i--) { if (rt_native_eq(a->items[i], val)) return ENCODE_INT(i); } return ENCODE_INT(-1);
}

RuntimeValue rt_array_remove(RuntimeValue arr, RuntimeValue idx) {
    if (!IS_HEAP(arr)) return NIL_VALUE; RuntimeArray *a = (RuntimeArray *)DECODE_PTR(arr);
    if (!a || a->hdr.type != HEAP_ARRAY) return NIL_VALUE;
    int64_t i = DECODE_INT(idx); if (i < 0 || (uint32_t)i >= a->len) return NIL_VALUE;
    RuntimeValue removed = a->items[i];
    for (uint32_t j = (uint32_t)i; j + 1 < a->len; j++) a->items[j] = a->items[j+1];
    a->len--; a->items[a->len] = NIL_VALUE; return removed;
}

RuntimeValue rt_collection_remove(RuntimeValue receiver, RuntimeValue key)
{
    return rt_array_remove(receiver, key);
}

RuntimeValue rt_pop(RuntimeValue receiver)
{
    if (IS_HEAP(receiver)) {
        HeapHeader *header = (HeapHeader *)DECODE_PTR(receiver);
        if (header && header->type == HEAP_ARRAY) return rt_array_pop(receiver);
        if (header && header->type == HEAP_STRING) {
            RuntimeString *text = (RuntimeString *)header;
            if (text->len == 0) return rt_string_from_cstr("");
            uint32_t begin = text->len - 1;
            while (begin > 0 && ((uint8_t)text->data[begin] & 0xc0U) == 0x80U) begin--;
            RuntimeValue result = rt_string_new(
                (RuntimeValue)(uintptr_t)(text->data + begin),
                (RuntimeValue)(text->len - begin));
            text->len = begin;
            text->data[begin] = '\0';
            return result;
        }
    }
    return NIL_VALUE;
}

RuntimeValue rt_string_from_byte_array(RuntimeValue array)
{
    return rt_bytes_to_text(array);
}

int64_t rt_string_byte_at(RuntimeValue value, int64_t index)
{
    if (index < 0 || !IS_HEAP(value)) return 0;
    RuntimeString *text = (RuntimeString *)DECODE_PTR(value);
    if (!text || text->hdr.type != HEAP_STRING || (uint64_t)index >= text->len) return 0;
    return (uint8_t)text->data[index];
}

RuntimeValue rt_array_join(RuntimeValue arr, RuntimeValue sep) {
    if (!IS_HEAP(arr)) return rt_string_from_cstr(""); RuntimeArray *a = (RuntimeArray *)DECODE_PTR(arr);
    if (!a || a->hdr.type != HEAP_ARRAY || a->len == 0) return rt_string_from_cstr("");
    RuntimeValue result = rt_value_to_string(a->items[0]);
    for (uint32_t i = 1; i < a->len; i++) {
        if (IS_HEAP(sep)) result = rt_string_concat(result, sep);
        result = rt_string_concat(result, rt_value_to_string(a->items[i]));
    } return result;
}

RuntimeValue rt_array_concat(RuntimeValue arr_a, RuntimeValue arr_b) {
    RuntimeArray *a = IS_HEAP(arr_a) ? (RuntimeArray *)DECODE_PTR(arr_a) : (RuntimeArray *)0;
    RuntimeArray *b = IS_HEAP(arr_b) ? (RuntimeArray *)DECODE_PTR(arr_b) : (RuntimeArray *)0;
    uint32_t la = (a && a->hdr.type == HEAP_ARRAY) ? a->len : 0;
    uint32_t lb = (b && b->hdr.type == HEAP_ARRAY) ? b->len : 0;
    RuntimeValue result = rt_array_new(ENCODE_INT(la + lb > 0 ? la + lb : 1));
    for (uint32_t i = 0; i < la; i++) result = rt_array_push_handle(result, a->items[i]);
    for (uint32_t i = 0; i < lb; i++) result = rt_array_push_handle(result, b->items[i]);
    return result;
}

RuntimeValue rt_array_clear(RuntimeValue arr) {
    if (!IS_HEAP(arr)) return arr; RuntimeArray *a = (RuntimeArray *)DECODE_PTR(arr);
    if (!a || a->hdr.type != HEAP_ARRAY) return arr;
    for (uint32_t i = 0; i < a->len; i++) a->items[i] = NIL_VALUE; a->len = 0; return arr;
}

RuntimeValue rt_array_clone(RuntimeValue arr) {
    if (!IS_HEAP(arr)) return NIL_VALUE; RuntimeArray *a = (RuntimeArray *)DECODE_PTR(arr);
    if (!a || a->hdr.type != HEAP_ARRAY) return NIL_VALUE;
    RuntimeValue result = rt_array_new(ENCODE_INT(a->cap));
    for (uint32_t i = 0; i < a->len; i++) result = rt_array_push_handle(result, a->items[i]);
    return result;
}

RuntimeValue rt_array_copy(RuntimeValue arr)
{
    if (!IS_HEAP(arr)) return NIL_VALUE;
    RuntimeArray *src = (RuntimeArray *)DECODE_PTR(arr);
    if (!arm64_heap_contains(src, sizeof(*src)) || src->hdr.type != HEAP_ARRAY ||
        src->len > src->cap || src->cap > 0x100000ULL) return NIL_VALUE;
    RuntimeValue result = rt_array_new(ENCODE_INT((int64_t)(src->cap ? src->cap : 1)));
    if (!IS_HEAP(result)) return NIL_VALUE;
    RuntimeArray *dst = (RuntimeArray *)DECODE_PTR(result);
    for (uint64_t i = 0; i < src->len; ++i) dst->items[i] = src->items[i];
    dst->len = src->len;
    return result;
}

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
    return (RuntimeValue)(int64_t)e->discriminant;
}

RuntimeValue rt_enum_payload(RuntimeValue value)
{
    if (!IS_HEAP(value)) return value;
    RuntimeEnum *e = (RuntimeEnum *)DECODE_PTR(value);
    if (!e || e->hdr.type != HEAP_ENUM) return value;
    return e->payload;
}

RuntimeValue rt_enum_id(RuntimeValue value)
{
    if (!IS_HEAP(value)) return 0;
    RuntimeEnum *e = (RuntimeEnum *)DECODE_PTR(value);
    if (!arm64_heap_contains(e, sizeof(*e)) || e->hdr.type != HEAP_ENUM ||
        e->hdr.size < sizeof(*e)) return 0;
    return (RuntimeValue)(uint64_t)e->enum_id;
}

RuntimeValue rt_enum_check_discriminant(RuntimeValue value, RuntimeValue expected)
{
    if (!IS_HEAP(value)) return 0;
    RuntimeEnum *e = (RuntimeEnum *)DECODE_PTR(value);
    if (!e || e->hdr.type != HEAP_ENUM) return 0;
    return (e->discriminant == (uint32_t)(int32_t)expected) ? 1 : 0;
}

RuntimeValue rt_unwrap_or_trap(RuntimeValue value)
{
    if (!IS_HEAP(value)) return value;
    RuntimeEnum *e = (RuntimeEnum *)DECODE_PTR(value);
    if (!arm64_heap_contains(e, sizeof(*e)) || e->hdr.type != HEAP_ENUM) return value;
    const uint32_t disc_ok = 2405352012u;
    const uint32_t disc_err = 4200179024u;
    const uint32_t disc_some = 4053299545u;
    const uint32_t disc_none = 2371748697u;
    if ((e->enum_id == 1u && e->discriminant == disc_some) ||
        (e->enum_id != 1u && e->discriminant == disc_ok)) return e->payload;
    if ((e->enum_id == 1u && e->discriminant == disc_none) ||
        (e->enum_id != 1u && e->discriminant == disc_err)) {
        serial_puts("[PANIC] unwrap failed\r\n");
        for (;;) __asm__ volatile("wfe");
    }
    return value;
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

static RuntimeMap *decode_map(RuntimeValue v) {
    if (!IS_HEAP(v)) return (RuntimeMap *)0;
    RuntimeMap *m = (RuntimeMap *)DECODE_PTR(v);
    if (!m || m->hdr.type != HEAP_MAP) return (RuntimeMap *)0; return m;
}

static int32_t map_find_key(RuntimeMap *m, RuntimeValue key) {
    for (uint32_t i = 0; i < m->len; i++) { if (rt_native_eq(m->keys[i], key)) return (int32_t)i; } return -1;
}

static void map_grow(RuntimeMap *m) {
    uint32_t new_cap = m->cap * 2; if (new_cap < 16) new_cap = 16;
    RuntimeValue *nk = (RuntimeValue *)malloc(new_cap * sizeof(RuntimeValue));
    RuntimeValue *nv = (RuntimeValue *)malloc(new_cap * sizeof(RuntimeValue));
    if (!nk || !nv) return;
    for (uint32_t i = 0; i < m->len; i++) { nk[i] = m->keys[i]; nv[i] = m->values[i]; }
    for (uint32_t i = m->len; i < new_cap; i++) { nk[i] = NIL_VALUE; nv[i] = NIL_VALUE; }
    m->keys = nk; m->values = nv; m->cap = new_cap;
}

RuntimeValue rt_map_new(void) {
    uint32_t cap = 16;
    RuntimeMap *m = (RuntimeMap *)malloc(sizeof(RuntimeMap)); if (!m) return NIL_VALUE;
    m->hdr.type = HEAP_MAP; m->hdr.size = (uint32_t)sizeof(RuntimeMap); m->len = 0; m->cap = cap;
    m->keys = (RuntimeValue *)malloc(cap * sizeof(RuntimeValue));
    m->values = (RuntimeValue *)malloc(cap * sizeof(RuntimeValue));
    if (!m->keys || !m->values) return NIL_VALUE;
    for (uint32_t i = 0; i < cap; i++) { m->keys[i] = NIL_VALUE; m->values[i] = NIL_VALUE; }
    return ENCODE_PTR(m);
}

RuntimeValue rt_map_set(RuntimeValue map, RuntimeValue key, RuntimeValue value) {
    RuntimeMap *m = decode_map(map); if (!m) return NIL_VALUE;
    int32_t idx = map_find_key(m, key);
    if (idx >= 0) { m->values[idx] = value; return map; }
    if (m->len >= m->cap) map_grow(m);
    if (m->len >= m->cap) return map;
    m->keys[m->len] = key; m->values[m->len] = value; m->len++; return map;
}

RuntimeValue rt_map_get(RuntimeValue map, RuntimeValue key) {
    RuntimeMap *m = decode_map(map); if (!m) return NIL_VALUE;
    int32_t idx = map_find_key(m, key); if (idx >= 0) return m->values[idx]; return NIL_VALUE;
}

RuntimeValue rt_map_has(RuntimeValue map, RuntimeValue key) {
    RuntimeMap *m = decode_map(map); if (!m) return 0; return map_find_key(m, key) >= 0 ? 1 : 0;
}

RuntimeValue rt_map_remove(RuntimeValue map, RuntimeValue key) {
    RuntimeMap *m = decode_map(map); if (!m) return NIL_VALUE;
    int32_t idx = map_find_key(m, key); if (idx < 0) return NIL_VALUE;
    RuntimeValue removed = m->values[idx];
    for (uint32_t i = (uint32_t)idx; i + 1 < m->len; i++) { m->keys[i] = m->keys[i+1]; m->values[i] = m->values[i+1]; }
    m->len--; m->keys[m->len] = NIL_VALUE; m->values[m->len] = NIL_VALUE; return removed;
}

RuntimeValue rt_map_keys(RuntimeValue map) {
    RuntimeMap *m = decode_map(map); if (!m) return NIL_VALUE;
    RuntimeValue arr = rt_array_new(ENCODE_INT(m->len > 0 ? m->len : 1));
    for (uint32_t i = 0; i < m->len; i++) arr = rt_array_push_handle(arr, m->keys[i]); return arr;
}

RuntimeValue rt_map_values(RuntimeValue map) {
    RuntimeMap *m = decode_map(map); if (!m) return NIL_VALUE;
    RuntimeValue arr = rt_array_new(ENCODE_INT(m->len > 0 ? m->len : 1));
    for (uint32_t i = 0; i < m->len; i++) arr = rt_array_push_handle(arr, m->values[i]); return arr;
}

RuntimeValue rt_map_entries(RuntimeValue map) {
    RuntimeMap *m = decode_map(map); if (!m) return NIL_VALUE;
    RuntimeValue arr = rt_array_new(ENCODE_INT(m->len > 0 ? m->len : 1));
    for (uint32_t i = 0; i < m->len; i++) {
        RuntimeValue pair = rt_array_new(ENCODE_INT(2));
        pair = rt_array_push_handle(pair, m->keys[i]); pair = rt_array_push_handle(pair, m->values[i]);
        arr = rt_array_push_handle(arr, pair);
    } return arr;
}

RuntimeValue rt_map_len(RuntimeValue map) { RuntimeMap *m = decode_map(map); if (!m) return ENCODE_INT(0); return ENCODE_INT(m->len); }

RuntimeValue rt_map_clear(RuntimeValue map) {
    RuntimeMap *m = decode_map(map); if (!m) return NIL_VALUE;
    for (uint32_t i = 0; i < m->len; i++) { m->keys[i] = NIL_VALUE; m->values[i] = NIL_VALUE; } m->len = 0; return map;
}

RuntimeValue rt_map_clone(RuntimeValue map) {
    RuntimeMap *m = decode_map(map); if (!m) return NIL_VALUE;
    RuntimeValue new_map = rt_map_new(); RuntimeMap *nm = decode_map(new_map); if (!nm) return NIL_VALUE;
    for (uint32_t i = 0; i < m->len; i++) rt_map_set(new_map, m->keys[i], m->values[i]);
    return new_map;
}

RuntimeValue rt_map_merge(RuntimeValue map_a, RuntimeValue map_b) {
    RuntimeValue result = rt_map_clone(map_a); RuntimeMap *mb = decode_map(map_b); if (!mb) return result;
    for (uint32_t i = 0; i < mb->len; i++) result = rt_map_set(result, mb->keys[i], mb->values[i]);
    return result;
}

RuntimeValue rt_map_for_each(RuntimeValue map, RuntimeValue callback) { (void)map; (void)callback; return NIL_VALUE; }

RuntimeValue rt_dict_new(void) { return NIL_VALUE; }
RuntimeValue rt_dict_get(RuntimeValue d, RuntimeValue k) { (void)d; (void)k; return NIL_VALUE; }
RuntimeValue rt_dict_set(RuntimeValue d, RuntimeValue k, RuntimeValue v) { (void)d; (void)k; (void)v; return NIL_VALUE; }
RuntimeValue rt_dict_len(RuntimeValue d) { (void)d; return ENCODE_INT(0); }
RuntimeValue rt_dict_keys(RuntimeValue d) { (void)d; return NIL_VALUE; }
RuntimeValue rt_dict_values(RuntimeValue d) { (void)d; return NIL_VALUE; }
RuntimeValue rt_dict_clear(RuntimeValue d) { (void)d; return NIL_VALUE; }
RuntimeValue rt_array_first(RuntimeValue a) { (void)a; return NIL_VALUE; }
RuntimeValue rt_array_last(RuntimeValue a) { (void)a; return NIL_VALUE; }
RuntimeValue rt_array_repeat(RuntimeValue v, RuntimeValue n) { (void)v; (void)n; return NIL_VALUE; }
RuntimeValue rt_string_find(RuntimeValue s, RuntimeValue sub) { (void)s; (void)sub; return ENCODE_INT(-1); }
RuntimeValue rt_string_rfind(RuntimeValue s, RuntimeValue sub) { (void)s; (void)sub; return ENCODE_INT(-1); }
RuntimeValue rt_string_join(RuntimeValue a, RuntimeValue sep) { (void)a; (void)sep; return NIL_VALUE; }
RuntimeValue rt_string_to_int(RuntimeValue s) { (void)s; return ENCODE_INT(0); }
RuntimeValue rt_option_map(RuntimeValue o, RuntimeValue f) { (void)o; (void)f; return NIL_VALUE; }
RuntimeValue rt_file_read_text(RuntimeValue p) { (void)p; return NIL_VALUE; }
RuntimeValue rt_file_read_text_rv(RuntimeValue p) { (void)p; return NIL_VALUE; }
RuntimeValue rt_file_write_text(RuntimeValue a, RuntimeValue b) { (void)a;(void)b; return NIL_VALUE; }
RuntimeValue rt_file_append_text(RuntimeValue a, RuntimeValue b) { (void)a;(void)b; return NIL_VALUE; }
RuntimeValue rt_file_open(RuntimeValue a, RuntimeValue b) { (void)a;(void)b; return NIL_VALUE; }
RuntimeValue rt_file_close(RuntimeValue a) { (void)a; return NIL_VALUE; }
RuntimeValue rt_file_remove(RuntimeValue a) { (void)a; return NIL_VALUE; }
RuntimeValue rt_file_find(RuntimeValue a, RuntimeValue b) { (void)a;(void)b; return NIL_VALUE; }
RuntimeValue rt_file_get_size(RuntimeValue a) { (void)a; return ENCODE_INT(0); }
RuntimeValue rt_file_canonicalize(RuntimeValue a) { (void)a; return NIL_VALUE; }
RuntimeValue rt_file_hash(RuntimeValue a) { (void)a; return NIL_VALUE; }
RuntimeValue rt_file_read_lines(RuntimeValue a) { (void)a; return NIL_VALUE; }
RuntimeValue rt_write_file(RuntimeValue a, RuntimeValue b) { (void)a;(void)b; return NIL_VALUE; }
RuntimeValue rt_cli_file_exists(RuntimeValue a) { (void)a; return ENCODE_INT(0); }
RuntimeValue rt_process_execute(RuntimeValue a, RuntimeValue b) { (void)a;(void)b; return NIL_VALUE; }
RuntimeValue rt_process_exists(RuntimeValue a) { (void)a; return ENCODE_INT(0); }
RuntimeValue rt_process_is_running(RuntimeValue a) { (void)a; return ENCODE_INT(0); }
RuntimeValue rt_process_run_with_limits(RuntimeValue a, RuntimeValue b, RuntimeValue c, RuntimeValue d) { (void)a;(void)b;(void)c;(void)d; return NIL_VALUE; }
RuntimeValue rt_process_spawn_async(RuntimeValue a, RuntimeValue b) { (void)a;(void)b; return NIL_VALUE; }
RuntimeValue rt_cli_print(RuntimeValue v) { rt_print(v); return NIL_VALUE; }
RuntimeValue rt_cli_println(RuntimeValue v) { rt_print(v); serial_puts("\r\n"); return NIL_VALUE; }
RuntimeValue rt_cli_eprint(RuntimeValue v) { rt_print(v); return NIL_VALUE; }
RuntimeValue rt_cli_eprintln(RuntimeValue v) { rt_print(v); serial_puts("\r\n"); return NIL_VALUE; }
/* rt_eprint_str/rt_eprintln_str take a (ptr, len) string slice, NOT a tagged
 * RuntimeValue -- see src/runtime/runtime.h:509. These previously declared a
 * RuntimeValue parameter, so the raw pointer the codegen passes failed every
 * tag test in rt_print and every message printed as "<value>", making
 * guest-side panic text unreadable on the serial console. */
void rt_eprint_str(const uint8_t *ptr, uint64_t len)
{
    if (!ptr) return;
    for (uint64_t i = 0; i < len; i++) serial_putchar((char)ptr[i]);
}
RuntimeValue rt_eprint_value(RuntimeValue v) { rt_print(v); return NIL_VALUE; }
void rt_eprintln_str(const uint8_t *ptr, uint64_t len)
{
    rt_eprint_str(ptr, len);
    serial_puts("\r\n");
}
RuntimeValue rt_eprintln_value(RuntimeValue v) { rt_print(v); serial_puts("\r\n"); return NIL_VALUE; }
RuntimeValue rt_cstring_to_text(RuntimeValue p) { (void)p; return NIL_VALUE; }
RuntimeValue rt_profiler_is_active(void) { return ENCODE_INT(0); }

RuntimeValue rt_value_compare(RuntimeValue a, RuntimeValue b) {
    int64_t va = (int64_t)a; int64_t vb = (int64_t)b;
    if (va < vb) return ENCODE_INT(-1); if (va > vb) return ENCODE_INT(1); return ENCODE_INT(0);
}

RuntimeValue rt_profiler_record_call(RuntimeValue a, RuntimeValue b) { (void)a;(void)b; return NIL_VALUE; }
RuntimeValue rt_profiler_record_return(RuntimeValue a) { (void)a; return NIL_VALUE; }

RuntimeValue serial_println(RuntimeValue val) {
    rt_print(val);
    serial_puts("\r\n");
    return NIL_VALUE;
}

RuntimeValue rt_qemu_exit_success(void) {
    __asm__ volatile(
        "mrs x1, sctlr_el1\n\t"
        "bic x1, x1, #1\n\t"
        "msr sctlr_el1, x1\n\t"
        "isb\n\t"
        "mov x0, #0x18\n\t"
        "hlt #0xF000\n\t"
        ::: "x0", "x1", "memory"
    );
    for (;;) __asm__ volatile("wfe");
    return NIL_VALUE;
}

#define S0(n) RuntimeValue n(void) { \
    serial_puts("FATAL: unimplemented rt function: " #n "\n"); \
    for(;;) __asm__ volatile("wfe"); \
    return 0; \
}
#define S1(n) RuntimeValue n(RuntimeValue a) { \
    (void)a; \
    serial_puts("FATAL: unimplemented rt function: " #n "\n"); \
    for(;;) __asm__ volatile("wfe"); \
    return 0; \
}
#define S2(n) RuntimeValue n(RuntimeValue a, RuntimeValue b) { \
    (void)a; (void)b; \
    serial_puts("FATAL: unimplemented rt function: " #n "\n"); \
    for(;;) __asm__ volatile("wfe"); \
    return 0; \
}
#define S3(n) RuntimeValue n(RuntimeValue a, RuntimeValue b, RuntimeValue c) { \
    (void)a; (void)b; (void)c; \
    serial_puts("FATAL: unimplemented rt function: " #n "\n"); \
    for(;;) __asm__ volatile("wfe"); \
    return 0; \
}
#define S4(n) RuntimeValue n(RuntimeValue a, RuntimeValue b, RuntimeValue c, RuntimeValue d) { \
    (void)a; (void)b; (void)c; (void)d; \
    serial_puts("FATAL: unimplemented rt function: " #n "\n"); \
    for(;;) __asm__ volatile("wfe"); \
    return 0; \
}
#define S5(n) RuntimeValue n(RuntimeValue a, RuntimeValue b, RuntimeValue c, RuntimeValue d, RuntimeValue e) { \
    (void)a; (void)b; (void)c; (void)d; (void)e; \
    serial_puts("FATAL: unimplemented rt function: " #n "\n"); \
    for(;;) __asm__ volatile("wfe"); \
    return 0; \
}

S1(rt_to_float)

S3(rt_array_insert)
S1(rt_array_reverse)
S1(rt_array_sort)
S2(rt_array_sort_by)
S2(rt_array_map)
S2(rt_array_filter)
S3(rt_array_reduce)
S2(rt_array_for_each)
S2(rt_array_find)
S2(rt_array_find_index)
S2(rt_array_every)
S2(rt_array_some)
S1(rt_array_flatten)
S2(rt_array_fill)
S2(rt_array_zip)
S1(rt_array_uniq)
S1(rt_array_compact)

S1(rt_file_read)
S2(rt_file_write)
S1(rt_file_exists)
S1(rt_file_delete)
S2(rt_file_append)
S1(rt_file_size)
S2(rt_file_copy)
S2(rt_file_move)
S2(rt_file_rename)
S1(rt_file_is_dir)
S1(rt_file_is_file)
S1(rt_file_read_bytes)
S2(rt_file_write_bytes)
S1(rt_file_stat)
S1(rt_file_realpath)

S1(rt_dir_list)
S1(rt_dir_create)
S1(rt_dir_create_all)
S1(rt_dir_exists)
S1(rt_dir_remove)
S1(rt_dir_remove_all)
S0(rt_dir_cwd)
S1(rt_dir_chdir)
S0(rt_dir_home)
S0(rt_dir_temp)

S2(rt_process_run)
S3(rt_process_run_timeout)
S1(rt_process_spawn)
S1(rt_process_kill)
S1(rt_process_wait)
S0(rt_process_pid)
S1(rt_cli_get_args)
S0(rt_cli_args)
/* rt_exit_code — no parent process yet, always reports 0 (no prior exit). */
RuntimeValue rt_exit_code(void) { return ENCODE_INT(0); }
/* rt_exit — matches hosted signature `extern "C" fn rt_exit(code: i32) -> !`
 * (src/compiler_rust/runtime/src/value/ffi/env_process.rs). Simple code
 * passes a raw i32 (not a tagged RuntimeValue). Disable all interrupts,
 * print an exit marker to the PL011 UART, then spin on wfi so QEMU can
 * detect the halt via its GIC idle-detection path. */
__attribute__((noreturn))
void rt_exit(int32_t code) {
    __asm__ volatile("msr daifset, #0xf"); /* mask all DAIF interrupts */
    int64_t c = (int64_t)code;
    serial_puts("[exit] rt_exit(");
    serial_put_dec(c);
    serial_puts(") -- halting\r\n");
    /* PSCI SYSTEM_OFF (SMC64 #0x84000008) — powers off the QEMU virt machine.
     * If the firmware does not support PSCI the smc is a no-op and we fall
     * through to the wfi loop, which is the correct safe-halt behaviour. */
    __asm__ volatile(
        "mov x0, #0x84000000\n"
        "movk x0, #0x0008\n"
        "smc #0\n"
        ::: "x0", "memory"
    );
    for (;;) { __asm__ volatile("wfi"); }
}
S1(rt_env_get)
S2(rt_env_set)
S0(rt_env_all)

/* --- std.sys.args FFI: present-but-empty on ARM64 until Phase 2 wires
 * argv through syscall 13. Returning 0 / "" / [] keeps std.sys.args.args()
 * callable from baremetal code without unresolved-symbol link errors.
 * Signatures match the Simple-side extern declarations at
 *   src/compiler_rust/lib/std/src/sys/args.spl:6-8
 *   rt_args_count() -> i32       (raw i32, not RuntimeValue)
 *   rt_args_get(i32) -> text     (raw i32 index, heap-tagged text)
 *   rt_args_all()  -> List<text> (heap-tagged array). */
int32_t      rt_args_count(void)          { return 0; }
RuntimeValue rt_args_get(int32_t index)   { (void)index; return rt_string_from_cstr(""); }
RuntimeValue rt_args_all(void)            { return rt_array_new(ENCODE_INT(0)); }

/* --- std.io stdout/stderr: emit Simple-string bytes to PL011 UART.
 * On SimpleOS the UART is the shared stdout/stderr sink (no tty/pty layer
 * yet); both names route to the same physical path. This replaces the
 * missing stubs so std.io.Stdout / std.io.Stderr and
 * host/sys_simple.rt_stdout_write callers actually produce output.
 * Signature matches hosted: RuntimeValue rt_stdout_write(RuntimeValue data). */
static RuntimeValue rt_serial_write_value(RuntimeValue data) {
    if (IS_HEAP(data)) {
        HeapHeader *h = (HeapHeader *)DECODE_PTR(data);
        if (h && h->type == HEAP_STRING) {
            RuntimeString *s = (RuntimeString *)h;
            if (s->len < 0x100000) {
                for (uint32_t i = 0; i < s->len; i++) serial_putchar(s->data[i]);
                return ENCODE_INT((int64_t)s->len);
            }
        }
    }
    return ENCODE_INT(0);
}
RuntimeValue rt_stdout_write(RuntimeValue data) { return rt_serial_write_value(data); }
RuntimeValue rt_stdout_flush(RuntimeValue a)    { (void)a; return NIL_VALUE; }
RuntimeValue rt_stderr_write(RuntimeValue data) { return rt_serial_write_value(data); }
RuntimeValue rt_stderr_flush(RuntimeValue a)    { (void)a; return NIL_VALUE; }
RuntimeValue rt_stdin_read(RuntimeValue a)      { (void)a; return rt_string_from_cstr(""); }
RuntimeValue rt_stdin_read_byte(RuntimeValue a, RuntimeValue b) { (void)a; (void)b; return ENCODE_INT(-1); }
RuntimeValue rt_stdin_read_char(RuntimeValue a) { (void)a; return rt_string_from_cstr(""); }
RuntimeValue rt_stdin_read_line(RuntimeValue a, RuntimeValue b) { (void)a; (void)b; return rt_string_from_cstr(""); }
RuntimeValue rt_terminal_clear(RuntimeValue a)  { (void)a; return NIL_VALUE; }
RuntimeValue rt_terminal_set_cursor(RuntimeValue a, RuntimeValue b, RuntimeValue c) { (void)a; (void)b; (void)c; return NIL_VALUE; }

S1(rt_math_sqrt) S1(rt_math_sin) S1(rt_math_cos) S1(rt_math_tan)
S1(rt_math_asin) S1(rt_math_acos) S1(rt_math_atan) S2(rt_math_atan2)
S1(rt_math_abs) S1(rt_math_floor) S1(rt_math_ceil) S1(rt_math_round)
S1(rt_math_log) S1(rt_math_log2) S1(rt_math_log10) S1(rt_math_exp)
S2(rt_math_min) S2(rt_math_max) S2(rt_math_pow)
S0(rt_math_random) S0(rt_math_pi) S0(rt_math_e) S0(rt_math_inf) S0(rt_math_nan)
S1(rt_math_is_nan) S1(rt_math_is_inf)

RuntimeValue rt_port_outb(RuntimeValue p, RuntimeValue v) { (void)p; (void)v; return NIL_VALUE; }
RuntimeValue rt_port_outw(RuntimeValue p, RuntimeValue v) { (void)p; (void)v; return NIL_VALUE; }
RuntimeValue rt_port_outl(RuntimeValue p, RuntimeValue v) { (void)p; (void)v; return NIL_VALUE; }
RuntimeValue rt_port_inb(RuntimeValue p) { (void)p; return ENCODE_INT(0); }
RuntimeValue rt_port_inw(RuntimeValue p) { (void)p; return ENCODE_INT(0); }
RuntimeValue rt_port_inl(RuntimeValue p) { (void)p; return ENCODE_INT(0); }
RuntimeValue rt_port_io_wait(void) { return NIL_VALUE; }

RuntimeValue rt_hlt(void) { __asm__ volatile("wfe"); return NIL_VALUE; }
RuntimeValue rt_sti(void) { __asm__ volatile("msr daifclr, #0xF"); return NIL_VALUE; }
RuntimeValue rt_cli(void) { __asm__ volatile("msr daifset, #0xF"); return NIL_VALUE; }
S1(rt_lgdt) S1(rt_lidt) S1(rt_ltr) S1(rt_invlpg)
S0(rt_read_cr0) S1(rt_write_cr0) S1(rt_read_cr2) S1(rt_read_cr3) S1(rt_write_cr3)
S0(rt_read_cr4) S1(rt_write_cr4) S1(rt_read_msr) S2(rt_write_msr) S0(rt_cpuid) S0(rt_rdtsc)

/* Shared modules can retain x86 address-space calls in a target closure.
 * Reaching one on ARM is an architecture violation, not a successful zero. */
uint64_t rt_read_cr3_raw(void)
{
    serial_puts("[arm64-runtime] forbidden x86 CR3 read\r\n");
    for (;;) __asm__ volatile("wfe");
}

void rt_write_cr3_raw(uint64_t value)
{
    (void)value;
    serial_puts("[arm64-runtime] forbidden x86 CR3 write\r\n");
    for (;;) __asm__ volatile("wfe");
}

#define ARM64_MUTEX_HANDLE_MAX 4096U
static uint8_t arm64_mutex_owned[ARM64_MUTEX_HANDLE_MAX];

int8_t spl_mutex_lock(int64_t handle)
{
    if (handle <= 0 || (uint64_t)handle >= ARM64_MUTEX_HANDLE_MAX) return 0;
    while (__atomic_test_and_set(&arm64_mutex_owned[handle], __ATOMIC_ACQUIRE))
        __asm__ volatile("yield");
    return 1;
}

int8_t spl_mutex_unlock(int64_t handle)
{
    if (handle <= 0 || (uint64_t)handle >= ARM64_MUTEX_HANDLE_MAX) return 0;
    if (!__atomic_load_n(&arm64_mutex_owned[handle], __ATOMIC_RELAXED)) return 0;
    __atomic_clear(&arm64_mutex_owned[handle], __ATOMIC_RELEASE);
    return 1;
}

S2(rt_register_isr) S1(rt_send_eoi) S0(rt_get_interrupt_flag)

S1(rt_time_now_ms) S0(rt_time_now_nanos) S0(rt_time_monotonic)
S1(rt_sleep_ms) S1(rt_timer_create) S1(rt_timer_cancel)

S2(rt_net_connect) S1(rt_net_listen) S2(rt_net_send) S1(rt_net_recv) S1(rt_net_close)
S2(rt_net_bind) S1(rt_net_accept) S2(rt_net_set_timeout) S1(rt_net_get_addr)

S2(rt_http_get) S3(rt_http_post) S3(rt_http_put) S3(rt_http_patch)
S2(rt_http_delete) S2(rt_http_request) S3(rt_http_request_full) S2(rt_http_set_header)

S1(rt_json_parse) S1(rt_json_stringify) S2(rt_json_get) S3(rt_json_set)
S1(rt_json_keys) S1(rt_json_values) S1(rt_json_is_object) S1(rt_json_is_array)

S2(ffi_regex_is_match) S2(ffi_regex_find) S2(ffi_regex_find_all)
S2(ffi_regex_replace) S3(ffi_regex_replace_all) S1(ffi_regex_compile)

S1(rt_bdd_describe_start) S1(rt_bdd_describe_end) S2(rt_bdd_it_start) S1(rt_bdd_it_end)
S1(rt_expect) S2(rt_expect_eq) S2(rt_expect_ne) S2(rt_expect_gt) S2(rt_expect_lt)
S1(rt_expect_nil) S1(rt_expect_not_nil) S1(rt_expect_true) S1(rt_expect_false)
S2(rt_expect_contains) S2(rt_expect_throws)
S0(rt_bdd_suite_start) S0(rt_bdd_suite_end) S0(rt_bdd_report)

RuntimeValue rt_hash(RuntimeValue val) {
    uint64_t h = 14695981039346656037ULL;
    if (IS_INT(val)) { int64_t n = DECODE_INT(val); for (int i = 0; i < 8; i++) { h ^= (uint8_t)(n & 0xFF); h *= 1099511628211ULL; n >>= 8; } }
    else if (IS_HEAP(val)) { HeapHeader *hdr = (HeapHeader *)DECODE_PTR(val);
        if (hdr && hdr->type == HEAP_STRING) { RuntimeString *s = (RuntimeString *)hdr; for (uint32_t i = 0; i < s->len; i++) { h ^= (uint8_t)s->data[i]; h *= 1099511628211ULL; } }
        else { uint64_t p = (uint64_t)(uintptr_t)hdr; for (int i = 0; i < 8; i++) { h ^= (uint8_t)(p & 0xFF); h *= 1099511628211ULL; p >>= 8; } }
    }
    return ENCODE_INT((int64_t)(h >> 3));
}
RuntimeValue rt_hash_combine(RuntimeValue h1, RuntimeValue h2) {
    int64_t a = DECODE_INT(h1); int64_t b = DECODE_INT(h2);
    uint64_t combined = (uint64_t)a ^ ((uint64_t)b + 0x9e3779b97f4a7c15ULL + ((uint64_t)a << 6) + ((uint64_t)a >> 2));
    return ENCODE_INT((int64_t)(combined >> 3));
}

RuntimeValue rt_debug_print(RuntimeValue val) { serial_puts("[DEBUG] "); rt_print_value(val); serial_putchar('\r'); serial_putchar('\n'); return NIL_VALUE; }
RuntimeValue rt_debug_dump(RuntimeValue val) {
    serial_puts("[DUMP] raw="); serial_put_hex((uint64_t)val); serial_puts(" tag="); serial_put_dec((int64_t)((uint64_t)val & TAG_MASK));
    if (IS_INT(val)) { serial_puts(" int="); serial_put_dec(DECODE_INT(val)); }
    else if (IS_HEAP(val)) { HeapHeader *h = (HeapHeader *)DECODE_PTR(val); serial_puts(" heap_type="); serial_put_dec(h ? (int64_t)h->type : -1); }
    serial_putchar('\r'); serial_putchar('\n'); return NIL_VALUE;
}
RuntimeValue rt_debug_break(void) { serial_puts("[BREAK] debug break\r\n"); return NIL_VALUE; }

RuntimeValue rt_panic(RuntimeValue msg) {
    serial_puts("[PANIC] ");
    if (IS_HEAP(msg)) { HeapHeader *h = (HeapHeader *)DECODE_PTR(msg);
        if (h && h->type == HEAP_STRING) { RuntimeString *s = (RuntimeString *)h; for (uint32_t i = 0; i < s->len; i++) serial_putchar(s->data[i]); }
        else serial_puts("<non-string>");
    } else serial_put_hex((uint64_t)msg);
    serial_puts("\r\n"); for (;;) __asm__ volatile("wfe"); return NIL_VALUE;
}

RuntimeValue rt_function_not_found(RuntimeValue name_ptr, RuntimeValue name_len) {
    serial_puts("[WARN] unresolved fn: ");
    if (name_ptr) { const char *p = (const char *)(uintptr_t)name_ptr; int64_t len = (int64_t)name_len;
        for (int64_t i = 0; i < len && i < 128; i++) serial_putchar(p[i]); }
    serial_puts("\r\n"); return NIL_VALUE;
}

RuntimeValue rt_assert(RuntimeValue cond) {
    if (IS_INT(cond) && DECODE_INT(cond)) return NIL_VALUE;
    if (IS_HEAP(cond)) return NIL_VALUE;
    serial_puts("[ASSERT] assertion failed\r\n"); for (;;) __asm__ volatile("wfe"); return NIL_VALUE;
}

RuntimeValue rt_assert_eq(RuntimeValue a, RuntimeValue b) {
    if (rt_native_eq(a, b)) return NIL_VALUE;
    serial_puts("[ASSERT_EQ] "); rt_print_value(a); serial_puts(" != "); rt_print_value(b); serial_puts("\r\n");
    for (;;) __asm__ volatile("wfe"); return NIL_VALUE;
}

RuntimeValue rt_assert_ne(RuntimeValue a, RuntimeValue b) {
    if (!rt_native_eq(a, b)) return NIL_VALUE;
    serial_puts("[ASSERT_NE] values are equal: "); rt_print_value(a); serial_puts("\r\n");
    for (;;) __asm__ volatile("wfe"); return NIL_VALUE;
}

RuntimeValue rt_abort(RuntimeValue msg) {
    serial_puts("[ABORT] "); rt_print_value(msg); serial_puts("\r\n");
    for (;;) __asm__ volatile("wfe"); return NIL_VALUE;
}

RuntimeValue rt_gc_collect(void) { return NIL_VALUE; }
RuntimeValue rt_gc_disable(void) { return NIL_VALUE; }
RuntimeValue rt_gc_enable(void) { return NIL_VALUE; }
RuntimeValue rt_gc_stats(void) { return NIL_VALUE; }

S1(rt_thread_create) S1(rt_thread_join)
RuntimeValue rt_thread_yield(void) { return NIL_VALUE; }
RuntimeValue rt_thread_current(void) { return ENCODE_INT(0); }
RuntimeValue rt_thread_sleep(RuntimeValue a) { (void)a; return NIL_VALUE; }
S0(rt_mutex_new) S1(rt_mutex_lock) S1(rt_mutex_unlock) S1(rt_mutex_try_lock)
S0(rt_condvar_new) S1(rt_condvar_wait) S1(rt_condvar_notify) S1(rt_condvar_notify_all)

S0(rt_channel_new) S2(rt_channel_send) S1(rt_channel_recv) S1(rt_channel_try_recv) S1(rt_channel_close)

S1(rt_async_spawn) S1(rt_async_await)
RuntimeValue rt_async_yield(void) { return NIL_VALUE; }
S2(rt_async_select)

S1(rt_base64_encode) S1(rt_base64_decode) S1(rt_hex_encode) S1(rt_hex_decode)
S1(rt_utf8_encode) S1(rt_utf8_decode) S1(rt_url_encode) S1(rt_url_decode)

S1(rt_sha256) S1(rt_sha512) S1(rt_md5) S2(rt_hmac_sha256) S1(rt_random_bytes)

S1(rt_object_new) S2(rt_object_get) S3(rt_object_set) S2(rt_object_has) S2(rt_object_delete)
S1(rt_object_keys) S1(rt_object_values) S1(rt_object_freeze) S1(rt_object_clone)

S1(rt_error_new) S1(rt_error_message) S1(rt_error_code) S1(rt_error_stack)
S2(rt_result_ok) S2(rt_result_err) S1(rt_result_is_ok) S1(rt_result_is_err)
S1(rt_result_unwrap) S2(rt_result_unwrap_or)

S1(rt_weak_ref) S1(rt_weak_deref) S1(rt_closure_new) S2(rt_closure_call) S1(rt_closure_bind)

/* MMIO — use RAW addresses (not DECODE_INT) to match x86_64 convention.
 * Simple code passes MMIO addresses as raw u64 values. */
RuntimeValue rt_mmio_read_u8(RuntimeValue addr) { return (RuntimeValue)(uint64_t)*(volatile uint8_t *)(uintptr_t)(uint64_t)addr; }
RuntimeValue rt_mmio_read_u16(RuntimeValue addr) { return (RuntimeValue)(uint64_t)*(volatile uint16_t *)(uintptr_t)(uint64_t)addr; }
RuntimeValue rt_mmio_read_u32(RuntimeValue addr) {
    uint64_t raw = (uint64_t)addr;
    if ((raw >= 0x0A000000ULL && raw <= 0x0A004000ULL) ||
        (raw >= 0x14000000ULL && raw <= 0x14008000ULL)) {
        serial_puts("[mmio32] addr=");
        serial_put_hex(raw);
        serial_puts("\r\n");
    }
    return (RuntimeValue)(uint64_t)*(volatile uint32_t *)(uintptr_t)raw;
}
RuntimeValue rt_mmio_read_u64(RuntimeValue addr) { return (RuntimeValue)*(volatile uint64_t *)(uintptr_t)(uint64_t)addr; }
RuntimeValue rt_mmio_write_u8(RuntimeValue addr, RuntimeValue val) { *(volatile uint8_t *)(uintptr_t)(uint64_t)addr = (uint8_t)(uint64_t)val; return NIL_VALUE; }
RuntimeValue rt_mmio_write_u16(RuntimeValue addr, RuntimeValue val) { *(volatile uint16_t *)(uintptr_t)(uint64_t)addr = (uint16_t)(uint64_t)val; return NIL_VALUE; }
RuntimeValue rt_mmio_write_u32(RuntimeValue addr, RuntimeValue val) { *(volatile uint32_t *)(uintptr_t)(uint64_t)addr = (uint32_t)(uint64_t)val; return NIL_VALUE; }
RuntimeValue rt_mmio_write_u64(RuntimeValue addr, RuntimeValue val) { *(volatile uint64_t *)(uintptr_t)(uint64_t)addr = (uint64_t)val; return NIL_VALUE; }

#define SIMPLEOS_ARM_VIRTIO_BLK_MMIO_BASE_DEFAULT 0x0A003E00ULL
static uint8_t g_arm_virtq_storage[8192] __attribute__((aligned(4096)));
static uint8_t g_arm_virtio_blk_dma_storage[1024] __attribute__((aligned(512)));
static uint16_t g_arm_virtq_last_used_idx = 0;
static uint64_t g_arm_virtio_blk_mmio_base = SIMPLEOS_ARM_VIRTIO_BLK_MMIO_BASE_DEFAULT;
static uint32_t g_arm_virtio_blk_debug_reads = 0;
static uint64_t g_arm_fat32_bps = 0;
static uint64_t g_arm_fat32_spc = 0;
static uint64_t g_arm_fat32_reserved = 0;
static uint64_t g_arm_fat32_fats = 0;
static uint64_t g_arm_fat32_fat_size = 0;
static uint64_t g_arm_fat32_root_cluster = 0;

RuntimeValue rt_arm_array_get_byte_u32(RuntimeValue arr, RuntimeValue idx_val);

RuntimeValue rt_arm_virtq_base(void)
{
    return (RuntimeValue)(uint64_t)(uintptr_t)g_arm_virtq_storage;
}

RuntimeValue rt_arm_virtio_blk_queue_base(void)
{
    return (RuntimeValue)(uint64_t)(uintptr_t)g_arm_virtq_storage;
}

RuntimeValue rt_arm_virtio_blk_dma_base(void)
{
    return (RuntimeValue)(uint64_t)(uintptr_t)g_arm_virtio_blk_dma_storage;
}

RuntimeValue rt_arm_virtio_blk_set_mmio_base(RuntimeValue base_val)
{
    g_arm_virtio_blk_mmio_base = (uint64_t)base_val;
    return NIL_VALUE;
}

RuntimeValue rt_arm_virtio_blk_configure_queue(RuntimeValue version_val)
{
    uint32_t version = (uint32_t)(uint64_t)version_val;
    uint64_t queue = (uint64_t)(uintptr_t)g_arm_virtq_storage;
    volatile uint32_t *mmio = (volatile uint32_t *)(uintptr_t)g_arm_virtio_blk_mmio_base;
    mmio[0x030U / 4U] = 0U;
    mmio[0x038U / 4U] = 128U;
    if (version == 1U) {
        mmio[0x028U / 4U] = 4096U;
        mmio[0x03cU / 4U] = 4096U;
        mmio[0x040U / 4U] = (uint32_t)(queue >> 12);
    } else {
        mmio[0x080U / 4U] = (uint32_t)(queue & 0xffffffffULL);
        mmio[0x084U / 4U] = (uint32_t)(queue >> 32);
        mmio[0x090U / 4U] = (uint32_t)((queue + 2048ULL) & 0xffffffffULL);
        mmio[0x094U / 4U] = (uint32_t)((queue + 2048ULL) >> 32);
        mmio[0x0a0U / 4U] = (uint32_t)((queue + 4096ULL) & 0xffffffffULL);
        mmio[0x0a4U / 4U] = (uint32_t)((queue + 4096ULL) >> 32);
        mmio[0x044U / 4U] = 1U;
    }
    __asm__ volatile("dsb sy" ::: "memory");
    return NIL_VALUE;
}

RuntimeValue rt_arm_virtio_blk_mmio_read_u32(RuntimeValue off)
{
    uint64_t decoded = (uint64_t)off;
    return (RuntimeValue)(uint64_t)*(volatile uint32_t *)(uintptr_t)(g_arm_virtio_blk_mmio_base + decoded);
}
RuntimeValue rt_arm_virtio_blk_mmio_read_u64(RuntimeValue off)
{
    uint64_t decoded = (uint64_t)off;
    return (RuntimeValue)*(volatile uint64_t *)(uintptr_t)(g_arm_virtio_blk_mmio_base + decoded);
}
RuntimeValue rt_arm_virtio_blk_mmio_write_u32(RuntimeValue off, RuntimeValue val)
{
    uint64_t decoded = (uint64_t)off;
    uint32_t raw_val = (uint32_t)(uint64_t)val;
    *(volatile uint32_t *)(uintptr_t)(g_arm_virtio_blk_mmio_base + decoded) = raw_val;
    __asm__ volatile("dsb sy" ::: "memory");
    return NIL_VALUE;
}

RuntimeValue rt_wfe(void) { __asm__ volatile("wfe"); return NIL_VALUE; }
RuntimeValue rt_wfi(void) { __asm__ volatile("wfi"); return NIL_VALUE; }
RuntimeValue rt_sev(void) { __asm__ volatile("sev"); return NIL_VALUE; }
RuntimeValue rt_isb(void) { __asm__ volatile("isb"); return NIL_VALUE; }
RuntimeValue rt_dsb(void) { __asm__ volatile("dsb sy"); return NIL_VALUE; }
RuntimeValue rt_dmb(void) { __asm__ volatile("dmb sy"); return NIL_VALUE; }
RuntimeValue rt_enable_interrupts(void) { __asm__ volatile("msr daifclr, #0xF"); return NIL_VALUE; }
RuntimeValue rt_disable_interrupts(void) { __asm__ volatile("msr daifset, #0xF"); return NIL_VALUE; }
S1(rt_read_sysreg) S2(rt_write_sysreg)

uint64_t g_fb_addr = 0;
uint64_t g_fb_w = 0;
static volatile uint64_t g_gui_simd_fill_hits = 0;
static volatile uint64_t g_gui_simd_fill_chunks = 0;
static volatile uint64_t g_gui_simd_fill_tail_pixels = 0;
static volatile uint64_t g_gui_simd_fill_scalar_parity_checks = 0;
static volatile uint64_t g_gui_simd_fill_scalar_parity_failures = 0;

RuntimeValue rt_gui_set_fb(RuntimeValue addr, RuntimeValue w)
{
    g_fb_addr = (uint64_t)addr;
    g_fb_w = (uint64_t)w;
    serial_puts("[GUI] set_fb addr=");
    serial_put_hex(g_fb_addr);
    serial_puts(" w=");
    serial_put_dec((int64_t)g_fb_w);
    serial_puts("\r\n");
    return 0;
}

RuntimeValue rt_gui_hline(RuntimeValue y, RuntimeValue x, RuntimeValue count, RuntimeValue color) { (void)y;(void)x;(void)count;(void)color; return 0; }
RuntimeValue rt_gui_blend_span4(RuntimeValue xy, RuntimeValue src, RuntimeValue src_offset, RuntimeValue count) { (void)xy;(void)src;(void)src_offset;(void)count; return 0; }

/*
 * Read-only execution receipts for the compositor evidence adapter.  These
 * values are written only by rt_gui_fill4's runtime-owned kernel; callers
 * cannot manufacture a hit by selecting the NEON dispatch path.
 */
RuntimeValue rt_gui_simd_fill_hits(void) { return (RuntimeValue)g_gui_simd_fill_hits; }
RuntimeValue rt_gui_simd_fill_chunks(void) { return (RuntimeValue)g_gui_simd_fill_chunks; }
RuntimeValue rt_gui_simd_fill_tail_pixels(void) { return (RuntimeValue)g_gui_simd_fill_tail_pixels; }
RuntimeValue rt_gui_simd_fill_scalar_parity(void)
{
    return g_gui_simd_fill_scalar_parity_checks > 0
        && g_gui_simd_fill_scalar_parity_failures == 0;
}
RuntimeValue rt_gui_simd_fill_enabled(void)
{
#if defined(__aarch64__)
    return 1;
#else
    return 0;
#endif
}

static void rt_gui_scalar_fill4(uint32_t dst[4], uint32_t color)
{
    for (uint32_t i = 0; i < 4u; i++)
        dst[i] = color;
}

RuntimeValue rt_gui_fill4(RuntimeValue xy, RuntimeValue wh, RuntimeValue color, RuntimeValue u)
{
    if (!g_fb_addr || !g_fb_w) { (void)xy;(void)wh;(void)color;(void)u; return 0; }
    uint32_t px = (uint32_t)((uint64_t)xy >> 32);
    uint32_t py = (uint32_t)((uint64_t)xy & 0xFFFFFFFF);
    uint32_t pw = (uint32_t)((uint64_t)wh >> 32);
    uint32_t ph = (uint32_t)((uint64_t)wh & 0xFFFFFFFF);
    uint32_t c = (uint32_t)(uint64_t)color;
    volatile uint32_t *fb = (volatile uint32_t *)(uintptr_t)g_fb_addr;
    uint64_t x_limit64 = (uint64_t)px + (uint64_t)pw;
    uint64_t y_limit64 = (uint64_t)py + (uint64_t)ph;
    uint32_t x_limit = x_limit64 < g_fb_w ? (uint32_t)x_limit64 : (uint32_t)g_fb_w;
    uint32_t y_limit = y_limit64 < 768u ? (uint32_t)y_limit64 : 768u;
    uint64_t call_chunks = 0;
    uint64_t call_tail = 0;

    if (px >= x_limit || py >= y_limit) return 0;
    for (uint32_t row = py; row < y_limit; row++) {
        volatile uint32_t *dst = fb + (uint64_t)row * g_fb_w + px;
        uint32_t remaining = x_limit - px;
#if defined(__aarch64__)
        while (remaining >= 4u) {
            uint32_t scalar_reference[4];
            rt_gui_scalar_fill4(scalar_reference, c);
            /*
             * AArch64 Advanced SIMD is architectural.  st1 permits an
             * unaligned framebuffer address, unlike a C vector-pointer store
             * whose alignment contract would be too strong for arbitrary x.
             */
            __asm__ volatile(
                "dup v0.4s, %w1\n\t"
                "st1 {v0.4s}, [%0]"
                :
                : "r" (dst), "r" (c)
                : "v0", "memory");
            for (uint32_t i = 0; i < 4u; i++) {
                if (dst[i] != scalar_reference[i])
                    g_gui_simd_fill_scalar_parity_failures++;
            }
            g_gui_simd_fill_scalar_parity_checks++;
            dst += 4;
            remaining -= 4u;
            call_chunks++;
        }
#endif
        while (remaining > 0u) {
            *dst++ = c;
            remaining--;
            call_tail++;
        }
    }
    if (call_chunks > 0) {
        g_gui_simd_fill_hits++;
        g_gui_simd_fill_chunks += call_chunks;
    }
    g_gui_simd_fill_tail_pixels += call_tail;
    return 0;
}

RuntimeValue rt_gui_render_desktop(RuntimeValue u1, RuntimeValue u2) { (void)u1;(void)u2; return 0; }

/*
 * ARM64 QEMU virt VirtIO-input transport
 *
 * The desktop is a flat, identity-mapped freestanding image, so the static
 * queue and event storage below is valid DMA memory.  Keep this owner here:
 * it is the only place that knows the ARM virt MMIO topology and it exports
 * decoded wire records to the Simple architecture facade.  Translation into
 * the shared KeyEvent/MouseEvent types remains in virtio_input_ops.spl.
 */
#define ARM64_VIRTIO_MMIO_BASE       0x0a000000ULL
#define ARM64_VIRTIO_MMIO_STRIDE     0x200ULL
#define ARM64_VIRTIO_MMIO_SLOTS      32U
#define ARM64_VIRTIO_MAGIC           0x74726976U
#define ARM64_VIRTIO_INPUT_DEVICE_ID 18U
#define ARM64_VIRTIO_QUEUE_SIZE      32U
#define ARM64_VIRTIO_DMA_WINDOW_BEGIN 0x40000000ULL
#define ARM64_VIRTIO_DMA_WINDOW_END   0x58000000ULL

#define VMMIO_MAGIC                  0x000U
#define VMMIO_VERSION                0x004U
#define VMMIO_DEVICE_ID              0x008U
#define VMMIO_DEVICE_FEATURES        0x010U
#define VMMIO_DEVICE_FEATURES_SEL    0x014U
#define VMMIO_DRIVER_FEATURES        0x020U
#define VMMIO_DRIVER_FEATURES_SEL    0x024U
#define VMMIO_QUEUE_SEL              0x030U
#define VMMIO_QUEUE_NUM_MAX          0x034U
#define VMMIO_QUEUE_NUM              0x038U
#define VMMIO_QUEUE_READY            0x044U
#define VMMIO_QUEUE_NOTIFY           0x050U
#define VMMIO_INTERRUPT_STATUS       0x060U
#define VMMIO_INTERRUPT_ACK          0x064U
#define VMMIO_STATUS                 0x070U
#define VMMIO_QUEUE_DESC_LOW         0x080U
#define VMMIO_QUEUE_DESC_HIGH        0x084U
#define VMMIO_QUEUE_AVAIL_LOW        0x090U
#define VMMIO_QUEUE_AVAIL_HIGH       0x094U
#define VMMIO_QUEUE_USED_LOW         0x0a0U
#define VMMIO_QUEUE_USED_HIGH        0x0a4U

#define VIRTIO_STATUS_ACKNOWLEDGE    1U
#define VIRTIO_STATUS_DRIVER         2U
#define VIRTIO_STATUS_DRIVER_OK      4U
#define VIRTIO_STATUS_FEATURES_OK    8U
#define VIRTIO_STATUS_DEVICE_NEEDS_RESET 64U
#define VIRTIO_STATUS_FAILED         128U
#define VIRTQ_DESC_F_WRITE           2U

#define VIRTIO_INPUT_CFG_EV_BITS     0x11U
#define EV_KEY                       0x01U
#define EV_REL                       0x02U
#define REL_X                        0x00U
#define REL_Y                        0x01U
#define KEY_A                        30U
#define BTN_LEFT                     0x110U

struct arm64_virtq_desc {
    uint64_t addr;
    uint32_t len;
    uint16_t flags;
    uint16_t next;
};

struct arm64_virtq_avail {
    uint16_t flags;
    uint16_t idx;
    uint16_t ring[ARM64_VIRTIO_QUEUE_SIZE];
};

struct arm64_virtq_used_elem {
    uint32_t id;
    uint32_t len;
};

struct arm64_virtq_used {
    uint16_t flags;
    uint16_t idx;
    struct arm64_virtq_used_elem ring[ARM64_VIRTIO_QUEUE_SIZE];
};

struct arm64_virtio_input_event {
    uint16_t type;
    uint16_t code;
    uint32_t value;
};

struct arm64_virtio_input_device {
    uint64_t base;
    uint16_t last_used_idx;
    uint16_t next_avail_idx;
    uint8_t kind;
    uint8_t ready;
    struct arm64_virtq_desc desc[ARM64_VIRTIO_QUEUE_SIZE];
    struct arm64_virtq_avail avail;
    struct arm64_virtq_used used;
    struct arm64_virtio_input_event events[ARM64_VIRTIO_QUEUE_SIZE];
} __attribute__((aligned(4096)));

static struct arm64_virtio_input_device g_arm64_virtio_input_devices[2]
    __attribute__((aligned(4096)));
static uint32_t g_arm64_virtio_input_ready_mask = 0;
static uint16_t g_arm64_virtio_input_type = 0;
static uint16_t g_arm64_virtio_input_code = 0;
static uint32_t g_arm64_virtio_input_value = 0;
static uint32_t g_arm64_virtio_input_device_kind = 0;
static uint32_t g_arm64_virtio_input_irq_status = 0;

static inline volatile uint32_t *arm64_virtio_reg32(uint64_t base, uint32_t off)
{
    return (volatile uint32_t *)(uintptr_t)(base + (uint64_t)off);
}

static inline void arm64_virtio_fence(void)
{
    __asm__ volatile("dmb sy" ::: "memory");
}

static inline void arm64_virtio_dma_acquire(void)
{
    __asm__ volatile("dmb oshld" ::: "memory");
}

static inline void arm64_virtio_dma_release(void)
{
    __asm__ volatile("dmb oshst" ::: "memory");
}

static void arm64_virtio_input_mark_failed(volatile uint32_t *mmio)
{
    uint32_t status = mmio[VMMIO_STATUS / 4U];
    mmio[VMMIO_STATUS / 4U] = arm64_virtio_status_fail(status, VIRTIO_STATUS_FAILED);
}

static int arm64_virtio_input_wait_reset(volatile uint32_t *mmio)
{
    for (uint32_t poll = 0; poll < ARM64_VIRTIO_RESET_POLLS; ++poll) {
        if (mmio[VMMIO_STATUS / 4U] == 0U) return 1;
    }
    arm64_virtio_input_mark_failed(mmio);
    return 0;
}

static int arm64_virtio_input_has_bit(uint64_t base, uint8_t event_type, uint16_t bit)
{
    volatile uint8_t *cfg = (volatile uint8_t *)(uintptr_t)(base + 0x100ULL);
    cfg[0] = VIRTIO_INPUT_CFG_EV_BITS;
    cfg[1] = event_type;
    arm64_virtio_fence();
    uint8_t bytes = cfg[2];
    uint32_t byte_index = (uint32_t)bit / 8U;
    if (bytes == 0U || byte_index >= bytes || byte_index >= 128U) return 0;
    return (cfg[8U + byte_index] & (uint8_t)(1U << ((uint32_t)bit & 7U))) != 0U;
}

static uint8_t arm64_virtio_input_kind(uint64_t base)
{
    int has_rel_x = arm64_virtio_input_has_bit(base, EV_REL, REL_X);
    int has_rel_y = arm64_virtio_input_has_bit(base, EV_REL, REL_Y);
    int has_left = arm64_virtio_input_has_bit(base, EV_KEY, BTN_LEFT);
    if (has_rel_x && has_rel_y && has_left) return 2U; /* relative pointer */
    if (arm64_virtio_input_has_bit(base, EV_KEY, KEY_A)) return 1U; /* keyboard */
    return 0U;
}

static int arm64_virtio_input_start_device(struct arm64_virtio_input_device *dev,
                                           uint64_t base, uint8_t kind)
{
    volatile uint32_t *mmio = (volatile uint32_t *)(uintptr_t)base;
    if (mmio[VMMIO_MAGIC / 4U] != ARM64_VIRTIO_MAGIC ||
        mmio[VMMIO_VERSION / 4U] != 2U ||
        mmio[VMMIO_DEVICE_ID / 4U] != ARM64_VIRTIO_INPUT_DEVICE_ID) return 0;

    mmio[VMMIO_STATUS / 4U] = 0U;
    arm64_virtio_fence();
    if (!arm64_virtio_input_wait_reset(mmio)) return 0;
    uint32_t status = arm64_virtio_status_add(0U, VIRTIO_STATUS_ACKNOWLEDGE);
    mmio[VMMIO_STATUS / 4U] = status;
    status = arm64_virtio_status_add(mmio[VMMIO_STATUS / 4U], VIRTIO_STATUS_DRIVER);
    mmio[VMMIO_STATUS / 4U] = status;
    mmio[VMMIO_DEVICE_FEATURES_SEL / 4U] = 1U;
    uint32_t features_hi = mmio[VMMIO_DEVICE_FEATURES / 4U];
    if ((features_hi & 1U) == 0U) {
        arm64_virtio_input_mark_failed(mmio);
        return 0;
    }
    mmio[VMMIO_DRIVER_FEATURES_SEL / 4U] = 0U;
    mmio[VMMIO_DRIVER_FEATURES / 4U] = 0U;
    mmio[VMMIO_DRIVER_FEATURES_SEL / 4U] = 1U;
    mmio[VMMIO_DRIVER_FEATURES / 4U] = 1U; /* VIRTIO_F_VERSION_1 */
    status = arm64_virtio_status_add(mmio[VMMIO_STATUS / 4U], VIRTIO_STATUS_FEATURES_OK);
    mmio[VMMIO_STATUS / 4U] = status;
    status = mmio[VMMIO_STATUS / 4U];
    if ((status & VIRTIO_STATUS_FEATURES_OK) == 0U ||
        arm64_virtio_status_rejected(
            status, VIRTIO_STATUS_FAILED, VIRTIO_STATUS_DEVICE_NEEDS_RESET)) {
        arm64_virtio_input_mark_failed(mmio);
        return 0;
    }

    mmio[VMMIO_QUEUE_SEL / 4U] = 0U;
    if (mmio[VMMIO_QUEUE_READY / 4U] != 0U) {
        arm64_virtio_input_mark_failed(mmio);
        return 0;
    }
    uint32_t max_queue = mmio[VMMIO_QUEUE_NUM_MAX / 4U];
    uint64_t desc_addr = (uint64_t)(uintptr_t)&dev->desc[0];
    uint64_t avail_addr = (uint64_t)(uintptr_t)&dev->avail;
    uint64_t used_addr = (uint64_t)(uintptr_t)&dev->used;
    uint64_t event_addr = (uint64_t)(uintptr_t)&dev->events[0];
    if (!arm64_virtio_queue_shape_valid(
            ARM64_VIRTIO_QUEUE_SIZE, max_queue,
            desc_addr, sizeof(dev->desc),
            avail_addr, sizeof(dev->avail),
            used_addr, sizeof(dev->used),
            event_addr, sizeof(dev->events),
            ARM64_VIRTIO_DMA_WINDOW_BEGIN, ARM64_VIRTIO_DMA_WINDOW_END)) {
        arm64_virtio_input_mark_failed(mmio);
        return 0;
    }
    __builtin_memset(dev, 0, sizeof(*dev));
    dev->base = base;
    dev->kind = kind;
    for (uint32_t i = 0; i < ARM64_VIRTIO_QUEUE_SIZE; ++i) {
        dev->desc[i].addr = (uint64_t)(uintptr_t)&dev->events[i];
        dev->desc[i].len = sizeof(struct arm64_virtio_input_event);
        dev->desc[i].flags = VIRTQ_DESC_F_WRITE;
        dev->desc[i].next = 0U;
        dev->avail.ring[i] = (uint16_t)i;
    }
    dev->avail.idx = ARM64_VIRTIO_QUEUE_SIZE;
    dev->next_avail_idx = ARM64_VIRTIO_QUEUE_SIZE;
    arm64_virtio_fence();
    mmio[VMMIO_QUEUE_NUM / 4U] = ARM64_VIRTIO_QUEUE_SIZE;
    mmio[VMMIO_QUEUE_DESC_LOW / 4U] = (uint32_t)desc_addr;
    mmio[VMMIO_QUEUE_DESC_HIGH / 4U] = (uint32_t)(desc_addr >> 32);
    mmio[VMMIO_QUEUE_AVAIL_LOW / 4U] = (uint32_t)avail_addr;
    mmio[VMMIO_QUEUE_AVAIL_HIGH / 4U] = (uint32_t)(avail_addr >> 32);
    mmio[VMMIO_QUEUE_USED_LOW / 4U] = (uint32_t)used_addr;
    mmio[VMMIO_QUEUE_USED_HIGH / 4U] = (uint32_t)(used_addr >> 32);
    mmio[VMMIO_QUEUE_READY / 4U] = 1U;
    if (mmio[VMMIO_QUEUE_READY / 4U] != 1U) {
        arm64_virtio_input_mark_failed(mmio);
        return 0;
    }
    status = arm64_virtio_status_add(mmio[VMMIO_STATUS / 4U], VIRTIO_STATUS_DRIVER_OK);
    mmio[VMMIO_STATUS / 4U] = status;
    status = mmio[VMMIO_STATUS / 4U];
    if ((status & VIRTIO_STATUS_DRIVER_OK) == 0U ||
        arm64_virtio_status_rejected(
            status, VIRTIO_STATUS_FAILED, VIRTIO_STATUS_DEVICE_NEEDS_RESET)) {
        arm64_virtio_input_mark_failed(mmio);
        return 0;
    }
    arm64_virtio_fence();
    mmio[VMMIO_QUEUE_NOTIFY / 4U] = 0U;
    dev->ready = 1U;
    return 1;
}

RuntimeValue rt_arm64_virtio_input_init(void)
{
    __builtin_memset(g_arm64_virtio_input_devices, 0, sizeof(g_arm64_virtio_input_devices));
    g_arm64_virtio_input_ready_mask = 0U;
    for (uint32_t slot = 0; slot < ARM64_VIRTIO_MMIO_SLOTS; ++slot) {
        uint64_t base = ARM64_VIRTIO_MMIO_BASE + (uint64_t)slot * ARM64_VIRTIO_MMIO_STRIDE;
        if (*arm64_virtio_reg32(base, VMMIO_MAGIC) != ARM64_VIRTIO_MAGIC ||
            *arm64_virtio_reg32(base, VMMIO_DEVICE_ID) != ARM64_VIRTIO_INPUT_DEVICE_ID) continue;
        uint8_t kind = arm64_virtio_input_kind(base);
        uint32_t mask = kind == 1U ? 1U : (kind == 2U ? 2U : 0U);
        if (mask == 0U || (g_arm64_virtio_input_ready_mask & mask) != 0U) continue;
        struct arm64_virtio_input_device *dev = &g_arm64_virtio_input_devices[kind - 1U];
        if (arm64_virtio_input_start_device(dev, base, kind)) {
            g_arm64_virtio_input_ready_mask |= mask;
            serial_puts("[virtio-input] ready kind=");
            serial_puts(kind == 1U ? "keyboard base=" : "pointer base=");
            serial_put_hex(base);
            serial_puts("\r\n");
        }
    }
    return (RuntimeValue)g_arm64_virtio_input_ready_mask;
}

static int arm64_virtio_input_poll_device(struct arm64_virtio_input_device *dev)
{
    if (!dev->ready) return 0;
    uint16_t used_idx = ARM64_DMA_READ_ONCE(dev->used.idx);
    if (used_idx == dev->last_used_idx) return 0;
    arm64_virtio_dma_acquire();
    uint16_t used_slot = dev->last_used_idx % ARM64_VIRTIO_QUEUE_SIZE;
    uint32_t used_id = ARM64_DMA_READ_ONCE(dev->used.ring[used_slot].id);
    uint32_t used_len = ARM64_DMA_READ_ONCE(dev->used.ring[used_slot].len);
    dev->last_used_idx++;
    if (used_id >= ARM64_VIRTIO_QUEUE_SIZE ||
        !arm64_virtio_event_length_valid(used_len, sizeof(struct arm64_virtio_input_event))) {
        arm64_virtio_input_mark_failed((volatile uint32_t *)(uintptr_t)dev->base);
        dev->ready = 0U;
        return 0;
    }
    uint16_t event_type = ARM64_DMA_READ_ONCE(dev->events[used_id].type);
    uint16_t event_code = ARM64_DMA_READ_ONCE(dev->events[used_id].code);
    uint32_t event_value = ARM64_DMA_READ_ONCE(dev->events[used_id].value);
    uint16_t slot = dev->next_avail_idx % ARM64_VIRTIO_QUEUE_SIZE;
    ARM64_DMA_WRITE_ONCE(dev->avail.ring[slot], (uint16_t)used_id);
    dev->next_avail_idx++;
    arm64_virtio_dma_release();
    ARM64_DMA_WRITE_ONCE(dev->avail.idx, dev->next_avail_idx);
    arm64_virtio_fence();
    *(volatile uint32_t *)(uintptr_t)(dev->base + VMMIO_QUEUE_NOTIFY) = 0U;
    uint32_t irq = *(volatile uint32_t *)(uintptr_t)(dev->base + VMMIO_INTERRUPT_STATUS);
    if (irq != 0U) *(volatile uint32_t *)(uintptr_t)(dev->base + VMMIO_INTERRUPT_ACK) = irq;
    g_arm64_virtio_input_type = event_type;
    g_arm64_virtio_input_code = event_code;
    g_arm64_virtio_input_value = event_value;
    g_arm64_virtio_input_device_kind = dev->kind;
    g_arm64_virtio_input_irq_status = irq;
    return 1;
}

RuntimeValue rt_arm64_virtio_input_poll(void)
{
    if (arm64_virtio_input_poll_device(&g_arm64_virtio_input_devices[0])) return 1;
    if (arm64_virtio_input_poll_device(&g_arm64_virtio_input_devices[1])) return 1;
    return 0;
}

RuntimeValue rt_arm64_virtio_input_event_type(void) { return (RuntimeValue)g_arm64_virtio_input_type; }
RuntimeValue rt_arm64_virtio_input_event_code(void) { return (RuntimeValue)g_arm64_virtio_input_code; }
RuntimeValue rt_arm64_virtio_input_event_value(void) { return (RuntimeValue)g_arm64_virtio_input_value; }
RuntimeValue rt_arm64_virtio_input_event_device_kind(void) { return (RuntimeValue)g_arm64_virtio_input_device_kind; }
RuntimeValue rt_arm64_virtio_input_event_irq_status(void) { return (RuntimeValue)g_arm64_virtio_input_irq_status; }

RuntimeValue rt_memory_barrier(void)
{
    __asm__ volatile("dsb sy" ::: "memory");
    return NIL_VALUE;
}

static void arm64_clean_dcache_range(uint64_t addr, uint64_t size)
{
    uint64_t line = addr & ~63ULL;
    uint64_t end = (addr + size + 63ULL) & ~63ULL;
    while (line < end) {
        __asm__ volatile("dc cvac, %0" :: "r"(line) : "memory");
        line += 64ULL;
    }
    __asm__ volatile("dsb sy" ::: "memory");
}

static void arm64_invalidate_dcache_range(uint64_t addr, uint64_t size)
{
    uint64_t line = addr & ~63ULL;
    uint64_t end = (addr + size + 63ULL) & ~63ULL;
    while (line < end) {
        __asm__ volatile("dc ivac, %0" :: "r"(line) : "memory");
        line += 64ULL;
    }
    __asm__ volatile("dsb sy" ::: "memory");
}

/*
 * ARM64 QEMU virt VirtIO-MMIO network transport.
 *
 * This capsule owns only device discovery, the two bounded virtqueues, DMA
 * buffers, and completion. Ethernet/IP/TCP and socket state remain in the
 * shared Simple NetstackService. Queue state is parent-owned and every TX
 * scoped loan is completed before return; RX copies into the caller buffer.
 */
#define ARM64_VIRTIO_NET_DEVICE_ID 1U
#define ARM64_NET_QUEUE_SIZE 8U
#define ARM64_NET_BUFFER_SIZE 2048U
#define ARM64_NET_HEADER_SIZE 10U
#define ARM64_NET_CONFIG_BASE 0x100U
#define ARM64_NET_F_MAC 5U
#define ARM64_NET_F_STATUS 16U
#define ARM64_NET_POLL_LIMIT 1000000U

struct arm64_net_avail {
    uint16_t flags;
    uint16_t idx;
    uint16_t ring[ARM64_NET_QUEUE_SIZE];
};

struct arm64_net_used {
    uint16_t flags;
    uint16_t idx;
    struct arm64_virtq_used_elem ring[ARM64_NET_QUEUE_SIZE];
};

static struct arm64_virtq_desc g_arm64_net_rx_desc[ARM64_NET_QUEUE_SIZE]
    __attribute__((aligned(4096)));
static struct arm64_net_avail g_arm64_net_rx_avail __attribute__((aligned(4096)));
static struct arm64_net_used g_arm64_net_rx_used __attribute__((aligned(4096)));
static uint8_t g_arm64_net_rx_buf[ARM64_NET_QUEUE_SIZE][ARM64_NET_BUFFER_SIZE]
    __attribute__((aligned(4096)));
static struct arm64_virtq_desc g_arm64_net_tx_desc[ARM64_NET_QUEUE_SIZE]
    __attribute__((aligned(4096)));
static struct arm64_net_avail g_arm64_net_tx_avail __attribute__((aligned(4096)));
static struct arm64_net_used g_arm64_net_tx_used __attribute__((aligned(4096)));
static uint8_t g_arm64_net_tx_buf[ARM64_NET_QUEUE_SIZE][ARM64_NET_BUFFER_SIZE]
    __attribute__((aligned(4096)));
static uint64_t g_arm64_net_base;
static uint16_t g_arm64_net_rx_last_used;
static uint16_t g_arm64_net_tx_last_used;
static uint8_t g_arm64_net_rx_posted[ARM64_NET_QUEUE_SIZE];
static uint8_t g_arm64_net_mac[6];
static uint64_t g_arm64_net_tx_completions;
static uint64_t g_arm64_net_rx_frames;
static uint8_t g_arm64_net_ready;

static void arm64_net_zero(void *ptr, uint64_t len)
{
    uint8_t *bytes = (uint8_t *)ptr;
    for (uint64_t i = 0; i < len; ++i) bytes[i] = 0;
}

static void arm64_net_write_addr(volatile uint32_t *mmio, uint32_t low_off,
                                 uint64_t addr)
{
    mmio[low_off / 4U] = (uint32_t)addr;
    mmio[(low_off + 4U) / 4U] = (uint32_t)(addr >> 32);
}

static int arm64_net_setup_queue(volatile uint32_t *mmio, uint32_t queue,
                                 struct arm64_virtq_desc *desc,
                                 struct arm64_net_avail *avail,
                                 struct arm64_net_used *used)
{
    mmio[VMMIO_QUEUE_SEL / 4U] = queue;
    if (mmio[VMMIO_QUEUE_READY / 4U] != 0U ||
        mmio[VMMIO_QUEUE_NUM_MAX / 4U] < ARM64_NET_QUEUE_SIZE) return 0;
    mmio[VMMIO_QUEUE_NUM / 4U] = ARM64_NET_QUEUE_SIZE;
    arm64_net_write_addr(mmio, VMMIO_QUEUE_DESC_LOW, (uint64_t)(uintptr_t)desc);
    arm64_net_write_addr(mmio, VMMIO_QUEUE_AVAIL_LOW, (uint64_t)(uintptr_t)avail);
    arm64_net_write_addr(mmio, VMMIO_QUEUE_USED_LOW, (uint64_t)(uintptr_t)used);
    mmio[VMMIO_QUEUE_READY / 4U] = 1U;
    return mmio[VMMIO_QUEUE_READY / 4U] == 1U;
}

RuntimeValue rt_arm64_virtio_net_init(void)
{
    g_arm64_net_ready = 0U;
    g_arm64_net_base = 0ULL;
    for (uint32_t slot = 0; slot < ARM64_VIRTIO_MMIO_SLOTS; ++slot) {
        uint64_t base = ARM64_VIRTIO_MMIO_BASE + (uint64_t)slot * ARM64_VIRTIO_MMIO_STRIDE;
        volatile uint32_t *candidate = (volatile uint32_t *)(uintptr_t)base;
        if (candidate[VMMIO_MAGIC / 4U] == ARM64_VIRTIO_MAGIC &&
            candidate[VMMIO_VERSION / 4U] == 2U &&
            candidate[VMMIO_DEVICE_ID / 4U] == ARM64_VIRTIO_NET_DEVICE_ID) {
            g_arm64_net_base = base;
            break;
        }
    }
    if (!g_arm64_net_base) return -19; /* ENODEV */

    volatile uint32_t *mmio = (volatile uint32_t *)(uintptr_t)g_arm64_net_base;
    mmio[VMMIO_STATUS / 4U] = 0U;
    mmio[VMMIO_STATUS / 4U] = VIRTIO_STATUS_ACKNOWLEDGE | VIRTIO_STATUS_DRIVER;
    mmio[VMMIO_DEVICE_FEATURES_SEL / 4U] = 1U;
    uint32_t features_high = mmio[VMMIO_DEVICE_FEATURES / 4U];
    if ((features_high & 1U) == 0U) return -95; /* VirtIO 1 required. */
    mmio[VMMIO_DRIVER_FEATURES_SEL / 4U] = 1U;
    mmio[VMMIO_DRIVER_FEATURES / 4U] = 1U;
    mmio[VMMIO_DEVICE_FEATURES_SEL / 4U] = 0U;
    uint32_t features_low = mmio[VMMIO_DEVICE_FEATURES / 4U];
    uint32_t accepted_low = features_low & ((1U << ARM64_NET_F_MAC) |
                                             (1U << ARM64_NET_F_STATUS));
    mmio[VMMIO_DRIVER_FEATURES_SEL / 4U] = 0U;
    mmio[VMMIO_DRIVER_FEATURES / 4U] = accepted_low;
    uint32_t status = VIRTIO_STATUS_ACKNOWLEDGE | VIRTIO_STATUS_DRIVER |
                      VIRTIO_STATUS_FEATURES_OK;
    mmio[VMMIO_STATUS / 4U] = status;
    if ((mmio[VMMIO_STATUS / 4U] & VIRTIO_STATUS_FEATURES_OK) == 0U) return -95;

    arm64_net_zero(g_arm64_net_rx_desc, sizeof(g_arm64_net_rx_desc));
    arm64_net_zero(&g_arm64_net_rx_avail, sizeof(g_arm64_net_rx_avail));
    arm64_net_zero(&g_arm64_net_rx_used, sizeof(g_arm64_net_rx_used));
    arm64_net_zero(g_arm64_net_tx_desc, sizeof(g_arm64_net_tx_desc));
    arm64_net_zero(&g_arm64_net_tx_avail, sizeof(g_arm64_net_tx_avail));
    arm64_net_zero(&g_arm64_net_tx_used, sizeof(g_arm64_net_tx_used));
    if (!arm64_net_setup_queue(mmio, 0U, g_arm64_net_rx_desc,
                               &g_arm64_net_rx_avail, &g_arm64_net_rx_used) ||
        !arm64_net_setup_queue(mmio, 1U, g_arm64_net_tx_desc,
                               &g_arm64_net_tx_avail, &g_arm64_net_tx_used)) {
        mmio[VMMIO_STATUS / 4U] = status | VIRTIO_STATUS_FAILED;
        return -5;
    }

    for (uint16_t i = 0; i < ARM64_NET_QUEUE_SIZE; ++i) {
        g_arm64_net_rx_desc[i].addr = (uint64_t)(uintptr_t)g_arm64_net_rx_buf[i];
        g_arm64_net_rx_desc[i].len = ARM64_NET_BUFFER_SIZE;
        g_arm64_net_rx_desc[i].flags = VIRTQ_DESC_F_WRITE;
        g_arm64_net_rx_avail.ring[i] = i;
        g_arm64_net_rx_posted[i] = 1U;
    }
    g_arm64_net_rx_avail.idx = ARM64_NET_QUEUE_SIZE;
    g_arm64_net_rx_last_used = 0U;
    g_arm64_net_tx_last_used = 0U;
    g_arm64_net_tx_completions = 0ULL;
    g_arm64_net_rx_frames = 0ULL;
    arm64_clean_dcache_range((uint64_t)(uintptr_t)g_arm64_net_rx_desc,
                             sizeof(g_arm64_net_rx_desc));
    arm64_clean_dcache_range((uint64_t)(uintptr_t)&g_arm64_net_rx_avail,
                             sizeof(g_arm64_net_rx_avail));
    arm64_invalidate_dcache_range((uint64_t)(uintptr_t)&g_arm64_net_rx_used,
                                  sizeof(g_arm64_net_rx_used));

    if ((accepted_low & (1U << ARM64_NET_F_MAC)) != 0U) {
        volatile uint8_t *config = (volatile uint8_t *)(uintptr_t)
            (g_arm64_net_base + ARM64_NET_CONFIG_BASE);
        for (uint32_t i = 0; i < 6U; ++i) g_arm64_net_mac[i] = config[i];
    } else {
        uint8_t fallback[6] = {0x52U, 0x54U, 0x00U, 0x12U, 0x34U, 0x56U};
        for (uint32_t i = 0; i < 6U; ++i) g_arm64_net_mac[i] = fallback[i];
    }
    mmio[VMMIO_STATUS / 4U] = status | VIRTIO_STATUS_DRIVER_OK;
    mmio[VMMIO_QUEUE_NOTIFY / 4U] = 0U;
    g_arm64_net_ready = 1U;
    serial_puts("[arm64-net] virtio-mmio ready rxq=8 txq=8\r\n");
    return 0;
}

RuntimeValue rt_arm64_virtio_net_send(RuntimeValue data_addr, RuntimeValue len_value)
{
    uint64_t len = (uint64_t)len_value;
    if (!g_arm64_net_ready) return -19;
    if (!data_addr || len == 0ULL || len > 1514ULL) return -22;
    volatile uint32_t *mmio = (volatile uint32_t *)(uintptr_t)g_arm64_net_base;
    uint16_t slot = (uint16_t)(g_arm64_net_tx_avail.idx % ARM64_NET_QUEUE_SIZE);
    uint8_t *dst = g_arm64_net_tx_buf[slot];
    arm64_net_zero(dst, ARM64_NET_HEADER_SIZE);
    const uint8_t *src = (const uint8_t *)(uintptr_t)(uint64_t)data_addr;
    for (uint64_t i = 0; i < len; ++i) dst[ARM64_NET_HEADER_SIZE + i] = src[i];
    g_arm64_net_tx_desc[slot].addr = (uint64_t)(uintptr_t)dst;
    g_arm64_net_tx_desc[slot].len = (uint32_t)(ARM64_NET_HEADER_SIZE + len);
    g_arm64_net_tx_desc[slot].flags = 0U;
    g_arm64_net_tx_avail.ring[slot] = slot;
    g_arm64_net_tx_avail.idx++;
    arm64_clean_dcache_range((uint64_t)(uintptr_t)dst, ARM64_NET_HEADER_SIZE + len);
    arm64_clean_dcache_range((uint64_t)(uintptr_t)&g_arm64_net_tx_desc[slot],
                             sizeof(g_arm64_net_tx_desc[slot]));
    arm64_clean_dcache_range((uint64_t)(uintptr_t)&g_arm64_net_tx_avail,
                             sizeof(g_arm64_net_tx_avail));
    mmio[VMMIO_QUEUE_NOTIFY / 4U] = 1U;
    uint32_t polls = 0U;
    while (polls++ < ARM64_NET_POLL_LIMIT) {
        arm64_invalidate_dcache_range((uint64_t)(uintptr_t)&g_arm64_net_tx_used,
                                      sizeof(g_arm64_net_tx_used));
        if (g_arm64_net_tx_used.idx != g_arm64_net_tx_last_used) {
            g_arm64_net_tx_last_used = g_arm64_net_tx_used.idx;
            g_arm64_net_tx_completions++;
            uint32_t irq = mmio[VMMIO_INTERRUPT_STATUS / 4U];
            if (irq) mmio[VMMIO_INTERRUPT_ACK / 4U] = irq;
            return (RuntimeValue)len;
        }
    }
    return -110;
}

static void arm64_net_repost_rx(uint16_t desc_id)
{
    if (desc_id >= ARM64_NET_QUEUE_SIZE) return;
    volatile uint32_t *mmio = (volatile uint32_t *)(uintptr_t)g_arm64_net_base;
    uint16_t avail_slot = (uint16_t)(g_arm64_net_rx_avail.idx % ARM64_NET_QUEUE_SIZE);
    g_arm64_net_rx_avail.ring[avail_slot] = desc_id;
    g_arm64_net_rx_avail.idx++;
    g_arm64_net_rx_posted[desc_id] = 1U;
    arm64_clean_dcache_range((uint64_t)(uintptr_t)&g_arm64_net_rx_avail,
                             sizeof(g_arm64_net_rx_avail));
    mmio[VMMIO_QUEUE_NOTIFY / 4U] = 0U;
    uint32_t irq = mmio[VMMIO_INTERRUPT_STATUS / 4U];
    if (irq) mmio[VMMIO_INTERRUPT_ACK / 4U] = irq;
}

RuntimeValue rt_arm64_virtio_net_recv(RuntimeValue out_addr, RuntimeValue max_value)
{
    uint64_t max = (uint64_t)max_value;
    if (!g_arm64_net_ready) return -19;
    if (!out_addr || max == 0ULL) return -22;
    arm64_invalidate_dcache_range((uint64_t)(uintptr_t)&g_arm64_net_rx_used,
                                  sizeof(g_arm64_net_rx_used));
    if (g_arm64_net_rx_used.idx == g_arm64_net_rx_last_used) return 0;
    uint16_t used_slot = (uint16_t)(g_arm64_net_rx_last_used % ARM64_NET_QUEUE_SIZE);
    struct arm64_virtq_used_elem elem = g_arm64_net_rx_used.ring[used_slot];
    g_arm64_net_rx_last_used++;
    if (elem.id >= ARM64_NET_QUEUE_SIZE || !g_arm64_net_rx_posted[elem.id]) {
        /* No trustworthy consumed descriptor identity: fail the device rather
         * than guessing and double-posting a DMA buffer. */
        volatile uint32_t *mmio = (volatile uint32_t *)(uintptr_t)g_arm64_net_base;
        mmio[VMMIO_STATUS / 4U] |= VIRTIO_STATUS_FAILED;
        g_arm64_net_ready = 0U;
        return -5;
    }
    g_arm64_net_rx_posted[elem.id] = 0U;
    if (elem.len <= ARM64_NET_HEADER_SIZE || elem.len > ARM64_NET_BUFFER_SIZE) {
        arm64_net_repost_rx((uint16_t)elem.id);
        return -5;
    }
    uint64_t frame_len = (uint64_t)elem.len - ARM64_NET_HEADER_SIZE;
    if (frame_len > max) {
        arm64_net_repost_rx((uint16_t)elem.id);
        return -90;
    }
    arm64_invalidate_dcache_range((uint64_t)(uintptr_t)g_arm64_net_rx_buf[elem.id],
                                  elem.len);
    uint8_t *out = (uint8_t *)(uintptr_t)(uint64_t)out_addr;
    for (uint64_t i = 0; i < frame_len; ++i)
        out[i] = g_arm64_net_rx_buf[elem.id][ARM64_NET_HEADER_SIZE + i];
    arm64_net_repost_rx((uint16_t)elem.id);
    g_arm64_net_rx_frames++;
    return (RuntimeValue)frame_len;
}

RuntimeValue rt_arm64_virtio_net_mac_octet(RuntimeValue index)
{
    return (uint64_t)index < 6ULL ? g_arm64_net_mac[(uint64_t)index] : 0;
}
RuntimeValue rt_arm64_virtio_net_ready(void) { return g_arm64_net_ready; }
RuntimeValue rt_arm64_virtio_net_tx_completions(void) { return g_arm64_net_tx_completions; }
RuntimeValue rt_arm64_virtio_net_rx_frames(void) { return g_arm64_net_rx_frames; }

RuntimeValue rt_arm64_dcache_clean_range(RuntimeValue addr, RuntimeValue size)
{
    arm64_clean_dcache_range((uint64_t)addr, (uint64_t)size);
    return NIL_VALUE;
}

RuntimeValue rt_arm64_dcache_invalidate_range(RuntimeValue addr, RuntimeValue size)
{
    arm64_invalidate_dcache_range((uint64_t)addr, (uint64_t)size);
    return NIL_VALUE;
}

static void arm64_sync_icache_range(uint64_t addr, uint64_t size)
{
    uint64_t line = addr & ~63ULL;
    uint64_t end = (addr + size + 63ULL) & ~63ULL;
    while (line < end) {
        __asm__ volatile("dc cvau, %0" :: "r"(line) : "memory");
        line += 64ULL;
    }
    __asm__ volatile("dsb ish" ::: "memory");
    line = addr & ~63ULL;
    while (line < end) {
        __asm__ volatile("ic ivau, %0" :: "r"(line) : "memory");
        line += 64ULL;
    }
    __asm__ volatile("dsb ish\nisb" ::: "memory");
}

static void write_le16_volatile(volatile uint8_t *p, uint16_t v)
{
    p[0] = (uint8_t)(v & 0xffU);
    p[1] = (uint8_t)((v >> 8) & 0xffU);
}

static void write_le32_volatile(volatile uint8_t *p, uint32_t v)
{
    p[0] = (uint8_t)(v & 0xffU);
    p[1] = (uint8_t)((v >> 8) & 0xffU);
    p[2] = (uint8_t)((v >> 16) & 0xffU);
    p[3] = (uint8_t)((v >> 24) & 0xffU);
}

RuntimeValue rt_virtq_desc_write(RuntimeValue base, RuntimeValue index, RuntimeValue addr_lo,
                                 RuntimeValue addr_hi, RuntimeValue len,
                                 RuntimeValue flags, RuntimeValue next)
{
    (void)base;
    volatile uint8_t *desc = (volatile uint8_t *)(uintptr_t)((uint64_t)(uintptr_t)g_arm_virtq_storage + ((uint64_t)index * 16ULL));
    write_le32_volatile(desc + 0, (uint32_t)(uint64_t)addr_lo);
    write_le32_volatile(desc + 4, (uint32_t)(uint64_t)addr_hi);
    write_le32_volatile(desc + 8, (uint32_t)(uint64_t)len);
    write_le16_volatile(desc + 12, (uint16_t)(uint64_t)flags);
    write_le16_volatile(desc + 14, (uint16_t)(uint64_t)next);
    arm64_clean_dcache_range((uint64_t)(uintptr_t)desc, 16ULL);
    return NIL_VALUE;
}

RuntimeValue rt_dma_bytes_to_array(RuntimeValue addr, RuntimeValue len_val)
{
    uint8_t *src = (uint8_t *)(uintptr_t)(uint64_t)addr;
    uint64_t len = (uint64_t)len_val;
    if (len == 0 || len > 0x100000) return rt_array_new(64);
    arm64_invalidate_dcache_range((uint64_t)(uintptr_t)src, len);
    size_t alloc_size = sizeof(RuntimeArray) + (size_t)len * sizeof(RuntimeValue);
    RuntimeArray *a = (RuntimeArray *)malloc(alloc_size);
    if (!a) return NIL_VALUE;
    a->hdr.type = HEAP_ARRAY;
    a->hdr.size = (uint32_t)alloc_size;
    a->len = (uint32_t)len;
    a->cap = (uint32_t)len;
    a->items = (RuntimeValue *)(a + 1);
    for (uint64_t i = 0; i < len; i++) {
        a->items[i] = ENCODE_INT(src[i]);
    }
    return ENCODE_PTR(a);
}

RuntimeValue rt_arm_virtio_blk_sector_bytes(void)
{
    uint64_t data_addr = (uint64_t)(uintptr_t)g_arm_virtio_blk_dma_storage + 16ULL;
    return rt_dma_bytes_to_array((RuntimeValue)data_addr, (RuntimeValue)512ULL);
}

RuntimeValue rt_arm_virtq_used_idx(void)
{
    uint64_t used_addr = (uint64_t)(uintptr_t)g_arm_virtq_storage + 4096ULL;
    arm64_invalidate_dcache_range(used_addr, 64ULL);
    return (RuntimeValue)(uint64_t)*(volatile uint16_t *)(uintptr_t)(used_addr + 2ULL);
}

RuntimeValue rt_arm_virtq_reset(void)
{
    volatile uint8_t *queue = (volatile uint8_t *)(uintptr_t)g_arm_virtq_storage;
    for (uint64_t i = 0; i < 8192ULL; i++) {
        queue[i] = 0;
    }
    arm64_clean_dcache_range((uint64_t)(uintptr_t)g_arm_virtq_storage, 8192ULL);
    __asm__ volatile("dmb sy" ::: "memory");
    return NIL_VALUE;
}

RuntimeValue rt_arm_virtq_push_avail(RuntimeValue desc_idx)
{
    uint64_t avail_addr = (uint64_t)(uintptr_t)g_arm_virtq_storage + 2048ULL;
    uint64_t used_addr = (uint64_t)(uintptr_t)g_arm_virtq_storage + 4096ULL;
    arm64_invalidate_dcache_range(used_addr, 64ULL);
    g_arm_virtq_last_used_idx = *(volatile uint16_t *)(uintptr_t)(used_addr + 2ULL);
    volatile uint16_t *avail_idx = (volatile uint16_t *)(uintptr_t)(avail_addr + 2ULL);
    uint16_t idx = *avail_idx;
    volatile uint16_t *slot = (volatile uint16_t *)(uintptr_t)(avail_addr + 4ULL + ((idx % 128U) * 2U));
    *slot = (uint16_t)(uint64_t)desc_idx;
    __asm__ volatile("dsb sy" ::: "memory");
    *avail_idx = (uint16_t)(idx + 1U);
    __asm__ volatile("dsb sy" ::: "memory");
    arm64_clean_dcache_range(avail_addr, 512ULL);
    return NIL_VALUE;
}

RuntimeValue rt_arm_virtio_blk_wait_completion(RuntimeValue timeout_val)
{
    uint64_t used_addr = (uint64_t)(uintptr_t)g_arm_virtq_storage + 4096ULL;
    uint64_t timeout = IS_INT(timeout_val) ? (uint64_t)DECODE_INT(timeout_val) : (uint64_t)timeout_val;
    if (timeout < 50000000ULL) timeout = 50000000ULL;
    for (uint64_t i = 0; i < timeout; i++) {
        arm64_invalidate_dcache_range(used_addr, 64ULL);
        uint16_t used_idx = *(volatile uint16_t *)(uintptr_t)(used_addr + 2ULL);
        if (used_idx != g_arm_virtq_last_used_idx) {
            g_arm_virtq_last_used_idx = used_idx;
            return (RuntimeValue)1;
        }
    }
    arm64_invalidate_dcache_range(used_addr, 64ULL);
    uint16_t used_idx = *(volatile uint16_t *)(uintptr_t)(used_addr + 2ULL);
    if (used_idx != g_arm_virtq_last_used_idx) {
        g_arm_virtq_last_used_idx = used_idx;
        return (RuntimeValue)1;
    }
    return (RuntimeValue)0;
}

RuntimeValue rt_arm_virtio_blk_status_u8(void)
{
    uint64_t dma_addr = (uint64_t)(uintptr_t)g_arm_virtio_blk_dma_storage;
    arm64_invalidate_dcache_range(dma_addr, 1024ULL);
    return (RuntimeValue)(uint64_t)*(volatile uint8_t *)(uintptr_t)(dma_addr + 528ULL);
}

RuntimeValue rt_arm_virtio_blk_prepare_read(RuntimeValue lba_val)
{
    uint64_t lba = IS_INT(lba_val) ? (uint64_t)DECODE_INT(lba_val) : (uint64_t)lba_val;
    uint64_t dma_addr = (uint64_t)(uintptr_t)g_arm_virtio_blk_dma_storage;
    volatile uint8_t *dma = (volatile uint8_t *)(uintptr_t)dma_addr;
    for (uint64_t i = 0; i < 1024ULL; i++) {
        dma[i] = 0;
    }
    *(volatile uint32_t *)(uintptr_t)(dma_addr + 0ULL) = 0U;
    *(volatile uint32_t *)(uintptr_t)(dma_addr + 4ULL) = 0U;
    *(volatile uint32_t *)(uintptr_t)(dma_addr + 8ULL) = (uint32_t)(lba & 0xffffffffULL);
    *(volatile uint32_t *)(uintptr_t)(dma_addr + 12ULL) = (uint32_t)(lba >> 32);
    *(volatile uint8_t *)(uintptr_t)(dma_addr + 528ULL) = 0xffU;
    __asm__ volatile("dsb sy" ::: "memory");
    arm64_clean_dcache_range(dma_addr, 1024ULL);
    return NIL_VALUE;
}

RuntimeValue rt_arm_virtio_blk_read_sector_direct(RuntimeValue lba_val)
{
    uint64_t lba = (uint64_t)lba_val;
    uint64_t dma_addr = (uint64_t)(uintptr_t)g_arm_virtio_blk_dma_storage;
    uint64_t queue_addr = (uint64_t)(uintptr_t)g_arm_virtq_storage;
    volatile uint8_t *dma = (volatile uint8_t *)(uintptr_t)dma_addr;
    volatile uint8_t *desc0 = (volatile uint8_t *)(uintptr_t)queue_addr;
    volatile uint32_t *mmio = (volatile uint32_t *)(uintptr_t)g_arm_virtio_blk_mmio_base;
    volatile uint16_t *avail_idx = (volatile uint16_t *)(uintptr_t)(queue_addr + 2048ULL + 2ULL);
    volatile uint16_t *avail_slot;
    uint16_t idx;
    uint8_t status;

    if (g_arm_virtio_blk_debug_reads < 4U) {
        serial_puts("[virtio-read] lba=");
        serial_put_dec((int64_t)lba);
        serial_puts(" q=");
        serial_put_hex(queue_addr);
        serial_puts(" dma=");
        serial_put_hex(dma_addr);
        serial_puts("\r\n");
    }

    for (uint64_t i = 0; i < 1024ULL; i++) dma[i] = 0;
    *(volatile uint32_t *)(uintptr_t)(dma_addr + 0ULL) = 0U;
    *(volatile uint32_t *)(uintptr_t)(dma_addr + 4ULL) = 0U;
    *(volatile uint32_t *)(uintptr_t)(dma_addr + 8ULL) = (uint32_t)(lba & 0xffffffffULL);
    *(volatile uint32_t *)(uintptr_t)(dma_addr + 12ULL) = (uint32_t)(lba >> 32);
    *(volatile uint8_t *)(uintptr_t)(dma_addr + 528ULL) = 0xffU;

    write_le32_volatile(desc0 + 0, (uint32_t)(dma_addr & 0xffffffffULL));
    write_le32_volatile(desc0 + 4, (uint32_t)(dma_addr >> 32));
    write_le32_volatile(desc0 + 8, 16U);
    write_le16_volatile(desc0 + 12, 1U);
    write_le16_volatile(desc0 + 14, 1U);
    write_le32_volatile(desc0 + 16, (uint32_t)((dma_addr + 16ULL) & 0xffffffffULL));
    write_le32_volatile(desc0 + 20, (uint32_t)((dma_addr + 16ULL) >> 32));
    write_le32_volatile(desc0 + 24, 512U);
    write_le16_volatile(desc0 + 28, 3U);
    write_le16_volatile(desc0 + 30, 2U);
    write_le32_volatile(desc0 + 32, (uint32_t)((dma_addr + 528ULL) & 0xffffffffULL));
    write_le32_volatile(desc0 + 36, (uint32_t)((dma_addr + 528ULL) >> 32));
    write_le32_volatile(desc0 + 40, 1U);
    write_le16_volatile(desc0 + 44, 2U);
    write_le16_volatile(desc0 + 46, 0U);

    arm64_clean_dcache_range(dma_addr, 1024ULL);
    arm64_clean_dcache_range(queue_addr, 8192ULL);
    arm64_invalidate_dcache_range(queue_addr + 4096ULL, 64ULL);
    g_arm_virtq_last_used_idx = *(volatile uint16_t *)(uintptr_t)(queue_addr + 4096ULL + 2ULL);
    idx = *avail_idx;
    avail_slot = (volatile uint16_t *)(uintptr_t)(queue_addr + 2048ULL + 4ULL + ((idx % 128U) * 2U));
    *avail_slot = 0U;
    *avail_idx = (uint16_t)(idx + 1U);
    arm64_clean_dcache_range(queue_addr + 2048ULL, 512ULL);
    __asm__ volatile("dsb sy" ::: "memory");
    mmio[0x050U / 4U] = 0U;
    __asm__ volatile("dsb sy" ::: "memory");

    for (uint64_t i = 0; i < 50000000ULL; i++) {
        arm64_invalidate_dcache_range(queue_addr + 4096ULL, 64ULL);
        uint16_t used_idx = *(volatile uint16_t *)(uintptr_t)(queue_addr + 4096ULL + 2ULL);
        if (used_idx != g_arm_virtq_last_used_idx) {
            g_arm_virtq_last_used_idx = used_idx;
            arm64_invalidate_dcache_range(dma_addr, 1024ULL);
            status = *(volatile uint8_t *)(uintptr_t)(dma_addr + 528ULL);
            if (g_arm_virtio_blk_debug_reads < 4U) {
                serial_puts("[virtio-read] done status=");
                serial_put_dec((int64_t)status);
                serial_puts(" b0=");
                serial_put_hex(*(volatile uint8_t *)(uintptr_t)(dma_addr + 16ULL));
                serial_puts(" b1=");
                serial_put_hex(*(volatile uint8_t *)(uintptr_t)(dma_addr + 17ULL));
                serial_puts(" b2=");
                serial_put_hex(*(volatile uint8_t *)(uintptr_t)(dma_addr + 18ULL));
                serial_puts(" b11=");
                serial_put_hex(*(volatile uint8_t *)(uintptr_t)(dma_addr + 27ULL));
                serial_puts("\r\n");
                g_arm_virtio_blk_debug_reads++;
            }
            return (RuntimeValue)(uint64_t)status;
        }
    }
    return (RuntimeValue)0xffffffffULL;
}

RuntimeValue rt_arm_virtio_blk_read_prefix(RuntimeValue first_lba_val, RuntimeValue size_val)
{
    uint64_t first_lba = (uint64_t)first_lba_val;
    uint64_t size = (uint64_t)size_val;
    if (size == 0 || size > 0x100000ULL) return rt_array_new(64);
    size_t alloc_size = sizeof(RuntimeArray) + (size_t)size * sizeof(RuntimeValue);
    RuntimeArray *a = (RuntimeArray *)malloc(alloc_size);
    if (!a) return NIL_VALUE;
    a->hdr.type = HEAP_ARRAY;
    a->hdr.size = (uint32_t)alloc_size;
    a->len = (uint32_t)size;
    a->cap = (uint32_t)size;
    a->items = (RuntimeValue *)(a + 1);
    uint64_t copied = 0;
    uint64_t sector = 0;
    while (copied < size) {
        /* NOTE: a multi-sector burst here is unreliable on this single-sector
         * oriented descriptor ring (a later sector in the same call can return
         * a non-zero status). Callers that need whole clusters issue one
         * single-sector read_prefix per sector instead (see _arm_read_cluster),
         * which is the proven-correct path. */
        RuntimeValue status = rt_arm_virtio_blk_read_sector_direct((RuntimeValue)(first_lba + sector));
        if (status == (RuntimeValue)0xffffffffULL || status != 0) break;
        uint8_t *src = g_arm_virtio_blk_dma_storage + 16;
        arm64_invalidate_dcache_range((uint64_t)(uintptr_t)src, 512ULL);
        for (uint64_t i = 0; i < 512ULL && copied < size; i++) {
            a->items[copied++] = ENCODE_INT(src[i]);
        }
        sector++;
    }
    a->len = (uint32_t)copied;
    return ENCODE_PTR(a);
}

RuntimeValue rt_arm_virtio_blk_read_hello_smf(void)
{
    return rt_arm_virtio_blk_read_prefix((RuntimeValue)2063ULL, (RuntimeValue)4264ULL);
}

RuntimeValue rt_arm_fat32_probe_bpb_from_virtio(void)
{
    RuntimeValue status = rt_arm_virtio_blk_read_sector_direct((RuntimeValue)0ULL);
    uint8_t *b = g_arm_virtio_blk_dma_storage + 16;
    if (status == (RuntimeValue)0xffffffffULL || status != 0) return (RuntimeValue)0ULL;
    g_arm_fat32_bps = (uint64_t)b[11] | ((uint64_t)b[12] << 8);
    g_arm_fat32_spc = (uint64_t)b[13];
    g_arm_fat32_reserved = (uint64_t)b[14] | ((uint64_t)b[15] << 8);
    g_arm_fat32_fats = (uint64_t)b[16];
    g_arm_fat32_fat_size = (uint64_t)b[36] | ((uint64_t)b[37] << 8) | ((uint64_t)b[38] << 16) | ((uint64_t)b[39] << 24);
    g_arm_fat32_root_cluster = (uint64_t)b[44] | ((uint64_t)b[45] << 8) | ((uint64_t)b[46] << 16) | ((uint64_t)b[47] << 24);
    serial_puts("[fat32-bpb-c] bps=");
    serial_put_dec((int64_t)g_arm_fat32_bps);
    serial_puts(" spc=");
    serial_put_dec((int64_t)g_arm_fat32_spc);
    serial_puts(" reserved=");
    serial_put_dec((int64_t)g_arm_fat32_reserved);
    serial_puts(" fats=");
    serial_put_dec((int64_t)g_arm_fat32_fats);
    serial_puts(" fat_size=");
    serial_put_dec((int64_t)g_arm_fat32_fat_size);
    serial_puts(" root=");
    serial_put_dec((int64_t)g_arm_fat32_root_cluster);
    serial_puts("\r\n");
    if (g_arm_fat32_bps == 0 || g_arm_fat32_spc == 0 || g_arm_fat32_fats == 0 || g_arm_fat32_fat_size == 0 || g_arm_fat32_root_cluster < 2ULL) {
        return (RuntimeValue)0ULL;
    }
    return (RuntimeValue)1ULL;
}

RuntimeValue rt_arm_fat32_bps(void) { return ENCODE_INT(g_arm_fat32_bps); }
RuntimeValue rt_arm_fat32_spc(void) { return ENCODE_INT(g_arm_fat32_spc); }
RuntimeValue rt_arm_fat32_reserved(void) { return ENCODE_INT(g_arm_fat32_reserved); }
RuntimeValue rt_arm_fat32_fats(void) { return ENCODE_INT(g_arm_fat32_fats); }
RuntimeValue rt_arm_fat32_fat_size(void) { return ENCODE_INT(g_arm_fat32_fat_size); }
RuntimeValue rt_arm_fat32_root_cluster(void) { return ENCODE_INT(g_arm_fat32_root_cluster); }

/* ==========================================================================
 * Slice 4 — native block-storage + FAT32 bridge for the arm64 fs-exec stub.
 *
 * The arm64 kernel imports c_nvme_adapter.spl / vfs_init.spl which declare the
 * `simpleos_nvme_*` and `simpleos_fat32_*` externs as a C-only block-device
 * bridge.  On arm64 QEMU `virt` the backing store is virtio-blk over
 * virtio-MMIO (NOT NVMe/PCI), so these bridges are wired to the virtio-blk
 * primitives already present in this file (rt_arm_virtio_blk_read_sector_direct,
 * g_arm_virtio_blk_dma_storage, configure_queue, the BPB globals).
 *
 * ABI (matches the x86_64 reference baremetal_stubs.c exactly):
 *   - simpleos_nvme_*        : raw uint64_t args, raw int64_t return.
 *   - simpleos_fat32_read_path / _size : `text` lowers to (const char*, int64_t)
 *                              under the cranelift baremetal backend; raw int64_t
 *                              return.
 *   - simpleos_fat32_read_path_array  : returns a tagged RuntimeValue HEAP_ARRAY
 *                              whose items are ENCODE_INT bytes.
 *   - simpleos_fat32_path_read_buffer_addr : raw uint64_t.
 *
 * Device init (simpleos_nvme_init) performs the FULL virtio-blk bringup in C —
 * the rt_arm_virtio_blk_read_sector_direct primitive assumes the queue is
 * already configured, and on the Simple-orchestrated path that bringup lives in
 * virtio_blk_arm_init().  This bridge path is C-only, so the handshake is
 * replicated here verbatim from src/os/drivers/virtio/virtio_blk_part1.spl.
 *
 * FAT32 geometry mirrors the Simple side (arm_fs_exec_vfs.spl): the ARM fs-exec
 * media emitted by scripts/os/make_os_disk.shs uses bps=512, spc=1,
 * reserved=32, fats=1, fat_size=64, root_cluster=2, data_start=96.  Cluster N
 * therefore maps to LBA 96 + (N-2); the FAT lives at LBA 32 + fat_offset/512.
 * ========================================================================== */

/* arm64 virt: virtio-mmio transports at 0x0a000000, 0x200 stride. The block
 * device QEMU exposes (-device virtio-blk-device,drive=armdisk) lands at slot
 * 31 -> 0x0a000000 + 31*0x200 = 0x0A003E00. Confirmed three ways: the existing
 * SIMPLEOS_ARM_VIRTIO_BLK_MMIO_BASE_DEFAULT in this file, the Simple-side probe
 * in arm_fs_exec_vfs.spl ("magic={mmio_read32(0x0A003E00)} ..."), and the
 * qemu args in src/os/qemu_systest_contract.spl (virtio-blk-device on virt). */
#define SIMPLEOS_ARM_FAT32_BPS        512U
#define SIMPLEOS_ARM_FAT32_SPC        1U
#define SIMPLEOS_ARM_FAT32_RESERVED   32U
#define SIMPLEOS_ARM_FAT32_DATA_START 96U

static int g_simpleos_blk_ready = 0;

/* Path-read buffer exposed to Simple via simpleos_fat32_path_read_buffer_addr().
 * The 32 MiB cap matches x86_64 and fits the largest pinned 25,125,512-byte
 * face. arm64 RAM is 254 MiB; the selected image reserves this buffer once. */
static uint8_t simpleos_fat32_path_read_buf[33554432] __attribute__((aligned(16)));
static const uint32_t simpleos_fat32_path_read_buf_size = 33554432;

uint64_t simpleos_fat32_path_read_buffer_addr(void)
{
    return (uint64_t)(uintptr_t)simpleos_fat32_path_read_buf;
}

/* MMIO register access against the configured virtio-blk transport. Offsets are
 * byte offsets per the virtio-mmio spec (0x000 magic, 0x004 version, 0x008
 * device id, 0x070 status, etc.). */
static inline uint32_t _simpleos_blk_reg_rd32(uint32_t off)
{
    return *(volatile uint32_t *)(uintptr_t)(g_arm_virtio_blk_mmio_base + (uint64_t)off);
}
static inline void _simpleos_blk_reg_wr32(uint32_t off, uint32_t val)
{
    *(volatile uint32_t *)(uintptr_t)(g_arm_virtio_blk_mmio_base + (uint64_t)off) = val;
    __asm__ volatile("dsb sy" ::: "memory");
}

/* Full virtio-blk device + queue bringup. Mirrors virtio_blk_arm_init() in
 * src/os/drivers/virtio/virtio_blk_part1.spl step for step. Returns 1 on
 * success, 0 on failure. */
static int _simpleos_blk_bringup(void)
{
    if (g_simpleos_blk_ready) return 1;

    g_arm_virtio_blk_mmio_base = SIMPLEOS_ARM_VIRTIO_BLK_MMIO_BASE_DEFAULT;

    uint32_t magic = _simpleos_blk_reg_rd32(0x000U);
    if (magic == 0U) {
        serial_puts("[nvme-c] virtio fail stage=magic_zero\r\n");
        return 0;
    }
    uint32_t version = _simpleos_blk_reg_rd32(0x004U);
    if (version == 0U) {
        serial_puts("[nvme-c] virtio fail stage=version_zero\r\n");
        return 0;
    }
    uint32_t device_id = _simpleos_blk_reg_rd32(0x008U);
    if (device_id != 2U) {
        serial_puts("[nvme-c] virtio fail stage=device_id\r\n");
        return 0;
    }

    /* status: reset -> ACKNOWLEDGE(1) -> DRIVER(2) => 3 */
    _simpleos_blk_reg_wr32(0x070U, 0U);
    _simpleos_blk_reg_wr32(0x070U, 1U);
    _simpleos_blk_reg_wr32(0x070U, 3U);

    /* feature negotiation: accept no features (matches Simple side) */
    _simpleos_blk_reg_wr32(0x014U, 0U);          /* DeviceFeaturesSel = 0 */
    (void)_simpleos_blk_reg_rd32(0x010U);        /* DeviceFeatures */
    _simpleos_blk_reg_wr32(0x024U, 0U);          /* DriverFeaturesSel = 0 */
    _simpleos_blk_reg_wr32(0x020U, 0U);          /* DriverFeatures = 0 */
    if (version != 1U) {
        _simpleos_blk_reg_wr32(0x014U, 1U);
        (void)_simpleos_blk_reg_rd32(0x010U);
        _simpleos_blk_reg_wr32(0x024U, 1U);
        _simpleos_blk_reg_wr32(0x020U, 1U);
    }

    /* FEATURES_OK(8) -> status becomes 11 (1|2|8) */
    _simpleos_blk_reg_wr32(0x070U, 11U);
    uint32_t status = _simpleos_blk_reg_rd32(0x070U);
    if ((status & 8U) == 0U) {
        _simpleos_blk_reg_wr32(0x070U, 128U);    /* FAILED */
        serial_puts("[nvme-c] virtio fail stage=features_ok\r\n");
        return 0;
    }

    /* queue 0 setup */
    _simpleos_blk_reg_wr32(0x030U, 0U);          /* QueueSel = 0 */
    uint32_t max_queue = _simpleos_blk_reg_rd32(0x034U); /* QueueNumMax */
    if (max_queue == 0U) {
        serial_puts("[nvme-c] virtio fail stage=max_queue\r\n");
        return 0;
    }
    _simpleos_blk_reg_wr32(0x038U, 128U);        /* QueueNum = 128 */

    /* zero the shared virtqueue storage, then program queue addresses via the
     * existing configure_queue helper (handles legacy vs modern layout). */
    (void)rt_arm_virtq_reset();
    (void)rt_arm_virtio_blk_configure_queue((RuntimeValue)(uint64_t)version);

    /* DRIVER_OK(4) -> status 15 (1|2|8|4) */
    _simpleos_blk_reg_wr32(0x070U, 15U);

    g_simpleos_blk_ready = 1;
    serial_puts("[nvme-c] virtio-blk bringup ok base=");
    serial_put_hex(g_arm_virtio_blk_mmio_base);
    serial_puts("\r\n");
    return 1;
}

/* Read a 512-byte sector into out[0..512). Returns 1 on success, 0 on failure. */
static int _simpleos_blk_read_sector(uint64_t lba, uint8_t *out)
{
    if (!g_simpleos_blk_ready && !_simpleos_blk_bringup()) return 0;
    RuntimeValue status = rt_arm_virtio_blk_read_sector_direct((RuntimeValue)lba);
    if (status == (RuntimeValue)0xffffffffULL || status != (RuntimeValue)0) return 0;
    uint8_t *src = g_arm_virtio_blk_dma_storage + 16;
    arm64_invalidate_dcache_range((uint64_t)(uintptr_t)src, 512ULL);
    for (uint32_t i = 0; i < 512U; i++) out[i] = src[i];
    return 1;
}

/* ---- simpleos_nvme_* bridge (backed by virtio-blk) ---- */

int64_t simpleos_nvme_init(void)
{
    if (!_simpleos_blk_bringup()) return -19; /* ENODEV */
    /* Probe sector 0 (FAT32 BPB) so the BPB-derived geometry globals are set,
     * matching the x86_64 init-and-read-sector0 behaviour. */
    (void)rt_arm_fat32_probe_bpb_from_virtio();
    return 0;
}

int64_t simpleos_nvme_read_sector(uint64_t device_idx, uint64_t lba, uint64_t buf_addr)
{
    (void)device_idx;
    if (buf_addr == 0ULL) return -14; /* EFAULT */
    uint8_t *dst = (uint8_t *)(uintptr_t)buf_addr;
    if (!_simpleos_blk_read_sector(lba, dst)) return -5; /* EIO */
    return 0;
}

/* LOW-CONFIDENCE / STUBBED: write is not required for read-only fs-exec.
 * virtio-blk write would need a TYPE_OUT descriptor path that does not exist in
 * the current arm64 primitives; returns failure so any accidental write attempt
 * is caught loudly rather than silently corrupting the disk image. FLAGGED. */
int64_t simpleos_nvme_write_sector(uint64_t device_idx, uint64_t lba, uint64_t buf_addr)
{
    (void)device_idx;
    (void)lba;
    (void)buf_addr;
    serial_puts("[nvme-c] write_sector unsupported on arm64 virtio bridge\r\n");
    return -38; /* ENOSYS */
}

/* ---- FAT32 read path (over virtio-blk) ---- */

/* Hardcoded geometry helpers, matching arm_fs_exec_vfs.spl. */
static uint32_t _simpleos_fat_cluster_lba(uint32_t cluster)
{
    return SIMPLEOS_ARM_FAT32_DATA_START + ((cluster - 2U) * SIMPLEOS_ARM_FAT32_SPC);
}

static uint32_t _simpleos_rd16(const uint8_t *p)
{
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8);
}
static uint32_t _simpleos_rd32(const uint8_t *p)
{
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) |
           ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

/* Follow the FAT chain one link. Returns next cluster or >=0x0ffffff8 at EOC. */
static uint32_t _simpleos_fat_next(uint32_t cluster)
{
    uint8_t sec[512];
    uint32_t fat_offset = cluster * 4U;
    uint32_t lba = SIMPLEOS_ARM_FAT32_RESERVED + (fat_offset / 512U);
    uint32_t off = fat_offset % 512U;
    if (!_simpleos_blk_read_sector(lba, sec)) return 0x0fffffffU;
    return _simpleos_rd32(sec + off) & 0x0fffffffU;
}

/* Build an uppercase 8.3 (11-byte, space-padded) name key from one path
 * component. Returns 1 on success, 0 if the component is empty/too long. */
static int _simpleos_make_8_3(const char *comp, uint32_t len, char out11[11])
{
    for (uint32_t i = 0; i < 11U; i++) out11[i] = ' ';
    if (len == 0U || len > 12U) return 0;
    uint32_t i = 0, o = 0;
    /* base name (up to 8 chars before '.') */
    while (i < len && comp[i] != '.' && o < 8U) {
        char c = comp[i++];
        if (c >= 'a' && c <= 'z') c = (char)(c - 'a' + 'A');
        out11[o++] = c;
    }
    while (i < len && comp[i] != '.') i++;
    if (i < len && comp[i] == '.') {
        i++;
        o = 8;
        while (i < len && o < 11U) {
            char c = comp[i++];
            if (c >= 'a' && c <= 'z') c = (char)(c - 'a' + 'A');
            out11[o++] = c;
        }
    }
    return 1;
}

static int _simpleos_name_eq(const uint8_t *e, const char name11[11])
{
    for (uint32_t i = 0; i < 11U; i++) {
        if ((char)e[i] != name11[i]) return 0;
    }
    return 1;
}

/* Scan a directory cluster chain for an 8.3 entry. want_dir selects file vs
 * directory. On a match, sets *size_out (file size) and returns the first
 * cluster (>=2). Returns 0 if not found. */
static uint32_t _simpleos_find_entry(uint32_t dir_cluster, const char name11[11],
                                     int want_dir, uint32_t *size_out)
{
    uint8_t sec[512];
    uint32_t cluster = dir_cluster;
    while (cluster >= 2U && cluster < 0x0ffffff8U) {
        uint32_t first_lba = _simpleos_fat_cluster_lba(cluster);
        for (uint32_t s = 0; s < SIMPLEOS_ARM_FAT32_SPC; s++) {
            if (!_simpleos_blk_read_sector(first_lba + s, sec)) return 0;
            for (uint32_t off = 0; off < 512U; off += 32U) {
                const uint8_t *e = sec + off;
                if (e[0] == 0x00U) return 0;          /* end of directory */
                if (e[0] == 0xe5U || e[11] == 0x0fU) continue; /* free / LFN */
                if (!_simpleos_name_eq(e, name11)) continue;
                int is_dir = (e[11] & 0x10U) != 0;
                if (is_dir != want_dir) continue;
                if (size_out) *size_out = _simpleos_rd32(e + 28U);
                return ((uint32_t)_simpleos_rd16(e + 20U) << 16) |
                       _simpleos_rd16(e + 26U);
            }
        }
        cluster = _simpleos_fat_next(cluster);
    }
    return 0;
}

/* Resolve an absolute path like /sys/apps/hello_world.smf to its first cluster
 * and size by walking each directory component from the root. Returns first
 * cluster (>=2) and sets *size_out, or 0 if not found. */
static uint32_t _simpleos_resolve_path(const char *path, int64_t path_len, uint32_t *size_out)
{
    if (size_out) *size_out = 0;
    if (!path || path_len <= 0) return 0;

    /* probe BPB so geometry is valid (also confirms sector 0 magic) */
    if (rt_arm_fat32_probe_bpb_from_virtio() == (RuntimeValue)0ULL) return 0;

    uint32_t cluster = 2U;      /* root cluster */
    int64_t i = 0;
    uint32_t found_size = 0;
    int matched_any = 0;

    while (i < path_len) {
        while (i < path_len && path[i] == '/') i++;
        int64_t start = i;
        while (i < path_len && path[i] != '/') i++;
        uint32_t comp_len = (uint32_t)(i - start);
        if (comp_len == 0U) break;

        int is_last = 1;
        for (int64_t j = i; j < path_len; j++) {
            if (path[j] != '/') { is_last = 0; break; }
        }

        char name11[11];
        if (!_simpleos_make_8_3(path + start, comp_len, name11)) return 0;

        uint32_t sz = 0;
        uint32_t next = _simpleos_find_entry(cluster, name11, is_last ? 0 : 1, &sz);
        if (next < 2U) return 0;
        cluster = next;
        found_size = sz;
        matched_any = 1;
        if (is_last) break;
    }

    if (!matched_any) return 0;
    if (size_out) *size_out = found_size;
    return cluster;
}

/* Read a file's full contents (size bytes) into out (capacity cap). Returns
 * bytes copied. */
static uint32_t _simpleos_read_chain(uint32_t first_cluster, uint32_t size,
                                     uint8_t *out, uint32_t cap)
{
    uint8_t sec[512];
    if (first_cluster < 2U || size == 0U || size > cap) return 0;
    uint32_t copied = 0;
    uint32_t cur = first_cluster;
    while (cur >= 2U && cur < 0x0ffffff8U && copied < size) {
        uint32_t first_lba = _simpleos_fat_cluster_lba(cur);
        for (uint32_t s = 0; s < SIMPLEOS_ARM_FAT32_SPC && copied < size; s++) {
            if (!_simpleos_blk_read_sector(first_lba + s, sec)) return 0;
            for (uint32_t k = 0; k < 512U && copied < size; k++) {
                out[copied++] = sec[k];
            }
        }
        if (copied >= size) break;
        cur = _simpleos_fat_next(cur);
    }
    return copied;
}

static size_t _arm64_collector_nonce_line_length(const uint8_t *slot,
                                                  size_t slot_len)
{
    static const char prefix[] = "SOSIX_COLLECTOR_RUN_NONCE=";
    const size_t prefix_len = sizeof(prefix) - 1U;
    if (!slot || slot_len <= prefix_len || slot_len > 118U) return 0U;
    for (size_t i = 0; i < prefix_len; i++) {
        if (slot[i] != (uint8_t)prefix[i]) return 0U;
    }

    size_t i = prefix_len;
    const size_t nonce_begin = i;
    while (i < slot_len && slot[i] != '\n') {
        const uint8_t c = slot[i];
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
    static const char path[] = "/SOSIXNON.TXT";
    uint8_t nonce_file[118];
    uint32_t file_size = 0U;
    if (!_simpleos_blk_bringup()) return 0;
    const uint32_t cluster = _simpleos_resolve_path(
        path, (int64_t)(sizeof(path) - 1U), &file_size);
    if (cluster < 2U || file_size == 0U || file_size > sizeof(nonce_file)) return 0;
    const uint32_t bytes_read = _simpleos_read_chain(
        cluster, file_size, nonce_file, sizeof(nonce_file));
    if (bytes_read != file_size) return 0;

    const size_t line_len = _arm64_collector_nonce_line_length(
        nonce_file, bytes_read);
    if (line_len == 0U) return 0;
    for (size_t i = 0; i < line_len; i++) serial_putchar((char)nonce_file[i]);
    return 1;
}

/* ---- simpleos_fat32_* bridges (text -> (const char*, int64_t)) ---- */

int64_t simpleos_fat32_read_path_size(const char *path, int64_t path_len)
{
    if (!_simpleos_blk_bringup()) return 0;
    uint32_t file_size = 0;
    uint32_t cluster = _simpleos_resolve_path(path, path_len, &file_size);
    if (cluster < 2U) return 0;
    return (int64_t)file_size;
}

int64_t simpleos_fat32_read_path(const char *path, int64_t path_len)
{
    if (!_simpleos_blk_bringup()) return -1;
    uint32_t file_size = 0;
    uint32_t cluster = _simpleos_resolve_path(path, path_len, &file_size);
    if (cluster < 2U || file_size == 0U) return -1;
    if (file_size > simpleos_fat32_path_read_buf_size) return -2;
    __builtin_memset(simpleos_fat32_path_read_buf, 0, file_size);
    uint32_t read = _simpleos_read_chain(cluster, file_size,
                                         simpleos_fat32_path_read_buf,
                                         simpleos_fat32_path_read_buf_size);
    if (read != file_size) return -3;
    return 0;
}

RuntimeValue simpleos_fat32_read_path_array(const char *path, int64_t path_len)
{
    if (!_simpleos_blk_bringup()) return rt_array_new((RuntimeValue)0);
    uint32_t file_size = 0;
    uint32_t cluster = _simpleos_resolve_path(path, path_len, &file_size);
    if (cluster < 2U || file_size == 0U ||
        file_size > simpleos_fat32_path_read_buf_size)
        return rt_array_new((RuntimeValue)0);
    __builtin_memset(simpleos_fat32_path_read_buf, 0, file_size);
    uint32_t read = _simpleos_read_chain(cluster, file_size,
                                         simpleos_fat32_path_read_buf,
                                         simpleos_fat32_path_read_buf_size);
    if (read != file_size) return rt_array_new((RuntimeValue)0);

    size_t alloc_size = sizeof(RuntimeArray) + (size_t)file_size * sizeof(RuntimeValue);
    RuntimeArray *a = (RuntimeArray *)malloc(alloc_size);
    if (!a) return rt_array_new((RuntimeValue)0);
    a->hdr.type = HEAP_ARRAY;
    a->hdr.size = (uint32_t)alloc_size;
    a->len = file_size;
    a->cap = file_size;
    a->items = (RuntimeValue *)(a + 1);
    for (uint32_t i = 0; i < file_size; i++)
        a->items[i] = ENCODE_INT((int64_t)simpleos_fat32_path_read_buf[i]);
    return ENCODE_PTR(a);
}

int64_t rt_bytes_u8_at(RuntimeValue arr, int64_t idx)
{
    if (idx < 0) return 0;
    return (int64_t)(uint64_t)rt_arm_array_get_byte_u32(arr, (RuntimeValue)(uint64_t)idx);
}

static uint64_t arm64_array_byte_at_raw_index(RuntimeValue arr, uint64_t idx);

RuntimeValue rt_array_get_byte_raw(RuntimeValue arr, RuntimeValue idx_val)
{
    uint64_t idx = IS_INT(idx_val) ? (uint64_t)DECODE_INT(idx_val) : (uint64_t)idx_val;
    return (RuntimeValue)arm64_array_byte_at_raw_index(arr, idx);
}

static uint64_t arm64_array_byte_at_raw_index(RuntimeValue arr, uint64_t idx)
{
    RuntimeArray *tagged = IS_HEAP(arr) ? (RuntimeArray *)DECODE_PTR(arr) : (RuntimeArray *)0;
    if (tagged && arm64_heap_contains(tagged, sizeof(RuntimeArray)) && tagged->hdr.type == HEAP_ARRAY && tagged->len <= tagged->cap && idx < tagged->len) {
        RuntimeValue v = tagged->items[idx];
        if (IS_INT(v)) return (uint64_t)DECODE_INT(v);
        return (uint64_t)(uint8_t)(uint64_t)v;
    }
    RuntimeArray *raw = (RuntimeArray *)(uintptr_t)(uint64_t)arr;
    if (raw && arm64_heap_contains(raw, sizeof(RuntimeArray)) && raw->hdr.type == HEAP_ARRAY && raw->len <= raw->cap && idx < raw->len) {
        RuntimeValue v = raw->items[idx];
        if (IS_INT(v)) return (uint64_t)DECODE_INT(v);
        return (uint64_t)(uint8_t)(uint64_t)v;
    }
    if (!arm64_heap_contains((void *)(uintptr_t)(uint64_t)arr, sizeof(RuntimeValue) * (idx + 1ULL))) return 0;
    RuntimeValue *items = (RuntimeValue *)(uintptr_t)(uint64_t)arr;
    RuntimeValue v = items[idx];
    if (IS_INT(v)) return (uint64_t)DECODE_INT(v);
    return (uint64_t)(uint8_t)(uint64_t)v;
}

RuntimeValue rt_arm_array_get_byte_u32(RuntimeValue arr, RuntimeValue idx_val)
{
    uint64_t idx = (uint64_t)idx_val;
    return (RuntimeValue)arm64_array_byte_at_raw_index(arr, idx);
}

RuntimeValue rt_arm_array_len_u32(RuntimeValue arr)
{
    RuntimeArray *tagged = IS_HEAP(arr) ? (RuntimeArray *)DECODE_PTR(arr) : (RuntimeArray *)0;
    if (tagged && arm64_heap_contains(tagged, sizeof(RuntimeArray)) && tagged->hdr.type == HEAP_ARRAY && tagged->len <= tagged->cap) {
        return (RuntimeValue)tagged->len;
    }
    RuntimeArray *raw = (RuntimeArray *)(uintptr_t)(uint64_t)arr;
    if (raw && arm64_heap_contains(raw, sizeof(RuntimeArray)) && raw->hdr.type == HEAP_ARRAY && raw->len <= raw->cap) {
        return (RuntimeValue)raw->len;
    }
    return 0;
}

RuntimeValue rt_arm_array_get_u16_le(RuntimeValue arr, RuntimeValue idx_val)
{
    uint64_t idx = (uint64_t)idx_val;
    uint64_t lo = arm64_array_byte_at_raw_index(arr, idx);
    uint64_t hi = arm64_array_byte_at_raw_index(arr, idx + 1ULL);
    return (RuntimeValue)(lo | (hi << 8));
}

RuntimeValue rt_arm_array_get_u32_le(RuntimeValue arr, RuntimeValue idx_val)
{
    uint64_t idx = (uint64_t)idx_val;
    uint64_t b0 = arm64_array_byte_at_raw_index(arr, idx);
    uint64_t b1 = arm64_array_byte_at_raw_index(arr, idx + 1ULL);
    uint64_t b2 = arm64_array_byte_at_raw_index(arr, idx + 2ULL);
    uint64_t b3 = arm64_array_byte_at_raw_index(arr, idx + 3ULL);
    return (RuntimeValue)(b0 | (b1 << 8) | (b2 << 16) | (b3 << 24));
}

RuntimeValue rt_arm_array_append_bytes(RuntimeValue dst_val, RuntimeValue src_val, RuntimeValue max_count_val)
{
    RuntimeArray *dst = (RuntimeArray *)(IS_HEAP(dst_val) ? DECODE_PTR(dst_val) : (void *)(uintptr_t)(uint64_t)dst_val);
    if (!dst || dst->hdr.type != HEAP_ARRAY) return ENCODE_INT(0);
    uint64_t max_count = (uint64_t)max_count_val;
    uint64_t src_len = (uint64_t)rt_arm_array_len_u32(src_val);
    uint64_t appended = 0;
    while (appended < max_count && appended < src_len) {
        if (dst->len >= dst->cap) break;
        dst->items[dst->len++] = ENCODE_INT(arm64_array_byte_at_raw_index(src_val, appended));
        appended++;
    }
    return (RuntimeValue)appended;
}

RuntimeValue rt_arm_array_clone_bytes(RuntimeValue src_val)
{
    uint64_t src_len = (uint64_t)rt_arm_array_len_u32(src_val);
    RuntimeValue dst_val = rt_array_new_with_cap((RuntimeValue)src_len);
    RuntimeArray *dst = (RuntimeArray *)(IS_HEAP(dst_val) ? DECODE_PTR(dst_val) : (void *)(uintptr_t)(uint64_t)dst_val);
    if (!dst || dst->hdr.type != HEAP_ARRAY) return dst_val;
    for (uint64_t i = 0; i < src_len && dst->len < dst->cap; i++) {
        dst->items[dst->len++] = ENCODE_INT(arm64_array_byte_at_raw_index(src_val, i));
    }
    return dst_val;
}

RuntimeValue rt_arm_array_slice_bytes(RuntimeValue src_val, RuntimeValue offset_val, RuntimeValue size_val)
{
    uint64_t src_len = (uint64_t)rt_arm_array_len_u32(src_val);
    uint64_t offset = (uint64_t)offset_val;
    uint64_t size = (uint64_t)size_val;
    if (offset > src_len) offset = src_len;
    if (size > src_len - offset) size = src_len - offset;
    RuntimeValue dst_val = rt_array_new_with_cap((RuntimeValue)size);
    RuntimeArray *dst = (RuntimeArray *)(IS_HEAP(dst_val) ? DECODE_PTR(dst_val) : (void *)(uintptr_t)(uint64_t)dst_val);
    if (!dst || dst->hdr.type != HEAP_ARRAY) return dst_val;
    for (uint64_t i = 0; i < size && dst->len < dst->cap; i++) {
        dst->items[dst->len++] = ENCODE_INT(arm64_array_byte_at_raw_index(src_val, offset + i));
    }
    return dst_val;
}

RuntimeValue rt_arm_array_empty_exact(void)
{
    size_t alloc_size = sizeof(RuntimeArray);
    RuntimeArray *a = (RuntimeArray *)malloc(alloc_size);
    if (!a) return NIL_VALUE;
    a->hdr.type = HEAP_ARRAY;
    a->hdr.size = (uint32_t)alloc_size;
    a->len = 0;
    a->cap = 0;
    a->items = (RuntimeValue *)0;
    return ENCODE_PTR(a);
}

static uint16_t arm64_elf_u16(RuntimeValue bytes, uint64_t off)
{
    return (uint16_t)(arm64_array_byte_at_raw_index(bytes, off) |
        (arm64_array_byte_at_raw_index(bytes, off + 1ULL) << 8));
}

static uint32_t arm64_elf_u32(RuntimeValue bytes, uint64_t off)
{
    return (uint32_t)(arm64_array_byte_at_raw_index(bytes, off) |
        (arm64_array_byte_at_raw_index(bytes, off + 1ULL) << 8) |
        (arm64_array_byte_at_raw_index(bytes, off + 2ULL) << 16) |
        (arm64_array_byte_at_raw_index(bytes, off + 3ULL) << 24));
}

static uint64_t arm64_elf_u64(RuntimeValue bytes, uint64_t off)
{
    return (uint64_t)arm64_elf_u32(bytes, off) | ((uint64_t)arm64_elf_u32(bytes, off + 4ULL) << 32);
}

static uint64_t arm64_elf_len(RuntimeValue bytes)
{
    return (uint64_t)rt_arm_array_len_u32(bytes);
}

static int arm64_elf64_header_ok(RuntimeValue bytes);

static RuntimeValue g_arm64_exec_image = NIL_VALUE;

RuntimeValue rt_arm64_set_exec_image(RuntimeValue bytes)
{
    if (arm64_elf64_header_ok(bytes)) g_arm64_exec_image = bytes;
    return NIL_VALUE;
}

static RuntimeValue arm64_exec_image_or(RuntimeValue bytes)
{
    if (arm64_elf64_header_ok(bytes)) return bytes;
    if (arm64_elf64_header_ok(g_arm64_exec_image)) return g_arm64_exec_image;
    return bytes;
}

uint64_t rt_arm_smf_elf_stub_size(RuntimeValue bytes)
{
    uint64_t len = arm64_elf_len(bytes);
    if (len < 132ULL) return 0;
    if (arm64_array_byte_at_raw_index(bytes, 0) != 0x7FULL) return 0;
    if (arm64_array_byte_at_raw_index(bytes, 1) != 0x45ULL) return 0;
    if (arm64_array_byte_at_raw_index(bytes, 2) != 0x4CULL) return 0;
    if (arm64_array_byte_at_raw_index(bytes, 3) != 0x46ULL) return 0;
    uint64_t trailer = len - 128ULL;
    if (arm64_array_byte_at_raw_index(bytes, trailer) != 0x53ULL) return 0;
    if (arm64_array_byte_at_raw_index(bytes, trailer + 1ULL) != 0x4DULL) return 0;
    if (arm64_array_byte_at_raw_index(bytes, trailer + 2ULL) != 0x46ULL) return 0;
    if (arm64_array_byte_at_raw_index(bytes, trailer + 3ULL) != 0x00ULL) return 0;
    uint64_t stub_size = arm64_elf_u32(bytes, trailer + 52ULL);
    if (stub_size > 0ULL && stub_size <= trailer) return stub_size;
    return trailer;
}

static int arm64_elf64_header_ok(RuntimeValue bytes)
{
    uint64_t len = arm64_elf_len(bytes);
    if (len < 64ULL) return 0;
    if (arm64_array_byte_at_raw_index(bytes, 0) != 0x7FULL) return 0;
    if (arm64_array_byte_at_raw_index(bytes, 1) != 0x45ULL) return 0;
    if (arm64_array_byte_at_raw_index(bytes, 2) != 0x4CULL) return 0;
    if (arm64_array_byte_at_raw_index(bytes, 3) != 0x46ULL) return 0;
    if (arm64_array_byte_at_raw_index(bytes, 4) != 2ULL) return 0;
    if (arm64_array_byte_at_raw_index(bytes, 5) != 1ULL) return 0;
    if (arm64_elf_u16(bytes, 18) != 183U) return 0;
    if (arm64_elf_u16(bytes, 52) != 64U) return 0;
    if (arm64_elf_u16(bytes, 54) != 56U) return 0;
    uint64_t phoff = arm64_elf_u64(bytes, 32);
    uint64_t phnum = arm64_elf_u16(bytes, 56);
    if (phoff > len) return 0;
    if (phnum > 256ULL) return 0;
    if (phoff + phnum * 56ULL > len) return 0;
    return 1;
}

static uint64_t arm64_elf64_load_phoff(RuntimeValue bytes, uint32_t wanted)
{
    if (!arm64_elf64_header_ok(bytes)) return UINT64_MAX;
    uint64_t phoff = arm64_elf_u64(bytes, 32);
    uint64_t phnum = arm64_elf_u16(bytes, 56);
    uint32_t seen = 0;
    for (uint64_t idx = 0; idx < phnum; idx++) {
        uint64_t off = phoff + idx * 56ULL;
        if (arm64_elf_u32(bytes, off) == 1U) {
            if (seen == wanted) return off;
            seen++;
        }
    }
    return UINT64_MAX;
}

#define ARM64_UAS_REGION_BASE 0x48000000ULL
#define ARM64_UAS_REGION_SIZE 0x00800000ULL
#define ARM64_UAS_TABLE_BYTES 0x00100000ULL
#define ARM64_UAS_IMAGE_BYTES (ARM64_UAS_REGION_SIZE - ARM64_UAS_TABLE_BYTES - 4096ULL)
#define ARM64_UAS_MAX_SPACES 16U
#define ARM64_PTE_VALID (1ULL << 0)
#define ARM64_PTE_TABLE (1ULL << 1)
#define ARM64_PTE_AF (1ULL << 10)
#define ARM64_PTE_SH_INNER (3ULL << 8)
#define ARM64_PTE_AP_RW_ALL (1ULL << 6)
#define ARM64_PTE_AP_RO_ALL (3ULL << 6)
#define ARM64_PTE_UXN (1ULL << 54)
#define ARM64_PTE_PXN (1ULL << 53)
#define ARM64_PTE_OUTPUT_MASK 0x0000FFFFFFFFF000ULL
#define ARM64_VM_WRITABLE 2U
#define ARM64_VM_USER 4U
#define ARM64_VM_NO_EXECUTE 32U
#define ARM64_MAIR_NORMAL 0xFFULL
#define ARM64_MAIR_DEVICE 0x00ULL
#define ARM64_MAIR_VALUE (ARM64_MAIR_NORMAL | (ARM64_MAIR_DEVICE << 8))
#define ARM64_TCR_T0SZ 16ULL
#define ARM64_TCR_TG0_4KB (0ULL << 14)
#define ARM64_TCR_SH0_INNER (3ULL << 12)
#define ARM64_TCR_ORGN0_WBWA (1ULL << 10)
#define ARM64_TCR_IRGN0_WBWA (1ULL << 8)
#define ARM64_TCR_VALUE (ARM64_TCR_T0SZ | ARM64_TCR_TG0_4KB | ARM64_TCR_SH0_INNER | ARM64_TCR_ORGN0_WBWA | ARM64_TCR_IRGN0_WBWA)
#define ARM64_SCTLR_M 1ULL
#define ARM64_USER_ENTRY_FRAME_BYTES 128ULL
#define ARM64_LOWER_EL_FRAME_BYTES 272ULL

typedef struct {
    uint64_t root;
    uint64_t next_table;
    uint64_t table_end;
} Arm64UserAsArena;

static Arm64UserAsArena arm64_user_as_arenas[ARM64_UAS_MAX_SPACES];
static uint32_t arm64_user_as_count = 0;
static uint64_t arm64_recorded_user_entry = 0;
static uint64_t arm64_recorded_user_sp = 0;
static uint64_t arm64_recorded_user_root = 0;
static uint64_t arm64_last_elf_virtual_entry = 0;
static uint64_t arm64_last_elf_direct_entry = 0;

extern char _start[];
extern char _vectors[];
extern char _stack_top[];
extern char _sbss[];
extern void _lower_el_aarch64_sync_handler(void);
extern uint64_t arm64_enter_user_virtual(uint64_t root, uint64_t entry,
                                         uint64_t user_sp, uint64_t mair,
                                         uint64_t tcr);
extern void arm64_user_exit_resume(void);

RuntimeValue rt_arm64_user_as_map_page(RuntimeValue root_val, RuntimeValue virt_val, RuntimeValue phys_val, RuntimeValue flags_val);
RuntimeValue rt_arm64_user_as_translate(RuntimeValue root_val, RuntimeValue virt_val);
uint64_t rt_arm64_handle_user_svc(uint64_t id, uint64_t a0, uint64_t a1,
                                  uint64_t a2, uint64_t a3, uint64_t a4,
                                  uint64_t elr, uint64_t esr);
RuntimeValue rt_arm64_enter_recorded_user_live(void);

static Arm64UserAsArena *arm64_user_as_find(uint64_t root)
{
    for (uint32_t i = 0; i < arm64_user_as_count; i++) {
        if (arm64_user_as_arenas[i].root == root) return &arm64_user_as_arenas[i];
    }
    return NULL;
}

static void arm64_zero_page(uint64_t phys)
{
    volatile uint64_t *p = (volatile uint64_t *)(uintptr_t)phys;
    for (uint32_t i = 0; i < 512U; i++) p[i] = 0;
}

static uint64_t arm64_user_as_alloc_table(Arm64UserAsArena *arena)
{
    if (!arena || arena->next_table + 4096ULL > arena->table_end) return 0;
    uint64_t page = arena->next_table;
    arena->next_table += 4096ULL;
    arm64_zero_page(page);
    return page;
}

static uint64_t arm64_user_as_ensure_table(Arm64UserAsArena *arena, uint64_t table, uint64_t idx)
{
    volatile uint64_t *entries = (volatile uint64_t *)(uintptr_t)table;
    uint64_t entry = entries[idx];
    if (entry & ARM64_PTE_VALID) return entry & ARM64_PTE_OUTPUT_MASK;
    uint64_t next = arm64_user_as_alloc_table(arena);
    if (!next) return 0;
    entries[idx] = (next & ARM64_PTE_OUTPUT_MASK) | ARM64_PTE_VALID | ARM64_PTE_TABLE;
    return next;
}

static uint64_t arm64_user_as_pte_bits(uint32_t flags)
{
    uint64_t bits = ARM64_PTE_VALID | ARM64_PTE_TABLE | ARM64_PTE_AF | ARM64_PTE_SH_INNER;
    if (flags & ARM64_VM_USER) {
        bits |= (flags & ARM64_VM_WRITABLE) ? ARM64_PTE_AP_RW_ALL : ARM64_PTE_AP_RO_ALL;
        if (!(flags & ARM64_VM_NO_EXECUTE)) bits |= ARM64_PTE_PXN;
    }
    if (flags & ARM64_VM_NO_EXECUTE) bits |= ARM64_PTE_PXN | ARM64_PTE_UXN;
    return bits;
}

static int arm64_user_as_map_identity_el1(uint64_t root, uint64_t addr, uint32_t flags)
{
    uint64_t page = addr & ~4095ULL;
    return (int)(uint64_t)rt_arm64_user_as_map_page(
        (RuntimeValue)root,
        (RuntimeValue)page,
        (RuntimeValue)page,
        (RuntimeValue)flags
    );
}

static int arm64_user_as_kernel_window_prepare(uint64_t root)
{
    uint32_t rx_el1 = 0U;
    uint32_t rw_el1_nx = ARM64_VM_WRITABLE | ARM64_VM_NO_EXECUTE;
    uint64_t uart = 0x09000000ULL;
    uint64_t kernel_page = (uint64_t)(uintptr_t)_start & ~4095ULL;
    uint64_t kernel_end = ((uint64_t)(uintptr_t)_sbss + 4095ULL) & ~4095ULL;
    uint64_t stack_top = (uint64_t)(uintptr_t)_stack_top;
    uint64_t current_sp = 0;
    __asm__ volatile("mov %0, sp" : "=r"(current_sp));

    while (kernel_page < kernel_end) {
        if (!arm64_user_as_map_identity_el1(root, kernel_page, rx_el1)) return 0;
        kernel_page += 4096ULL;
    }
    if (!arm64_user_as_map_identity_el1(root, uart, rw_el1_nx)) return 0;
    if (!arm64_user_as_map_identity_el1(root, stack_top - 1ULL, rw_el1_nx)) return 0;
    uint64_t return_stack_bytes = ARM64_USER_ENTRY_FRAME_BYTES + ARM64_LOWER_EL_FRAME_BYTES;
    if (current_sp < return_stack_bytes) return 0;
    uint64_t return_page = (current_sp - return_stack_bytes) & ~4095ULL;
    uint64_t current_sp_page = current_sp & ~4095ULL;
    while (return_page <= current_sp_page) {
        if (!arm64_user_as_map_identity_el1(root, return_page, rw_el1_nx)) return 0;
        if (return_page == current_sp_page) break;
        return_page += 4096ULL;
    }
    return 1;
}

static int arm64_user_as_virtual_entry_preflight(uint64_t root, uint64_t entry, uint64_t sp)
{
    uint64_t virtual_entry = arm64_last_elf_virtual_entry ? arm64_last_elf_virtual_entry : entry;
    uint64_t stack_page = sp & ~4095ULL;
    if (!arm64_user_as_kernel_window_prepare(root)) {
        serial_puts("[arm64-user] preflight kernel window failed\r\n");
        return 0;
    }
    if ((uint64_t)rt_arm64_user_as_translate((RuntimeValue)root, (RuntimeValue)virtual_entry) == 0) {
        serial_puts("[arm64-user] preflight entry failed\r\n");
        return 0;
    }
    if ((uint64_t)rt_arm64_user_as_translate((RuntimeValue)root, (RuntimeValue)sp) == 0) {
        uint64_t proof_stack_phys = root + ARM64_UAS_REGION_SIZE - 4096ULL;
        rt_arm64_user_as_map_page(
            (RuntimeValue)root,
            (RuntimeValue)stack_page,
            (RuntimeValue)proof_stack_phys,
            (RuntimeValue)(ARM64_VM_USER | ARM64_VM_WRITABLE | ARM64_VM_NO_EXECUTE)
        );
    }
    if ((uint64_t)rt_arm64_user_as_translate((RuntimeValue)root, (RuntimeValue)sp) == 0) {
        serial_puts("[arm64-user] preflight stack failed\r\n");
        return 0;
    }
    if ((uint64_t)rt_arm64_user_as_translate((RuntimeValue)root, (RuntimeValue)(uintptr_t)_vectors) == 0) {
        serial_puts("[arm64-user] preflight vectors failed\r\n");
        return 0;
    }
    if ((uint64_t)rt_arm64_user_as_translate((RuntimeValue)root, (RuntimeValue)(uintptr_t)_lower_el_aarch64_sync_handler) == 0) {
        serial_puts("[arm64-user] preflight lower-el failed\r\n");
        return 0;
    }
    if ((uint64_t)rt_arm64_user_as_translate((RuntimeValue)root, (RuntimeValue)(uintptr_t)rt_arm64_handle_user_svc) == 0) {
        serial_puts("[arm64-user] preflight svc failed\r\n");
        return 0;
    }
    if ((uint64_t)rt_arm64_user_as_translate((RuntimeValue)root, (RuntimeValue)(uintptr_t)rt_arm64_enter_recorded_user_live) == 0) {
        serial_puts("[arm64-user] preflight handoff failed\r\n");
        return 0;
    }
    if ((uint64_t)rt_arm64_user_as_translate((RuntimeValue)root, (RuntimeValue)(uintptr_t)arm64_enter_user_virtual) == 0) {
        serial_puts("[arm64-user] preflight entry trampoline failed\r\n");
        return 0;
    }
    if ((uint64_t)rt_arm64_user_as_translate((RuntimeValue)root, (RuntimeValue)(uintptr_t)arm64_user_exit_resume) == 0) {
        serial_puts("[arm64-user] preflight exit resume failed\r\n");
        return 0;
    }
    if ((uint64_t)rt_arm64_user_as_translate((RuntimeValue)root, (RuntimeValue)0x09000000ULL) == 0) {
        serial_puts("[arm64-user] preflight uart failed\r\n");
        return 0;
    }
    return 1;
}

RuntimeValue rt_arm64_user_as_create(void)
{
    if (arm64_user_as_count >= ARM64_UAS_MAX_SPACES) return 0;
    uint64_t root = ARM64_UAS_REGION_BASE + ((uint64_t)arm64_user_as_count * ARM64_UAS_REGION_SIZE);
    Arm64UserAsArena *arena = &arm64_user_as_arenas[arm64_user_as_count++];
    arena->root = root;
    arena->next_table = root + 4096ULL;
    arena->table_end = root + ARM64_UAS_TABLE_BYTES;
    arm64_zero_page(root);
    return (RuntimeValue)root;
}

RuntimeValue rt_arm64_user_as_map_page(RuntimeValue root_val, RuntimeValue virt_val, RuntimeValue phys_val, RuntimeValue flags_val)
{
    uint64_t root = (uint64_t)root_val;
    uint64_t virt = (uint64_t)virt_val;
    uint64_t phys = (uint64_t)phys_val;
    uint32_t flags = IS_INT(flags_val) ? (uint32_t)DECODE_INT(flags_val) : (uint32_t)flags_val;
    Arm64UserAsArena *arena = arm64_user_as_find(root);
    if (!arena || !root || (virt & 4095ULL) || (phys & 4095ULL)) return 0;

    uint64_t l0 = (virt >> 39) & 0x1FFULL;
    uint64_t l1 = (virt >> 30) & 0x1FFULL;
    uint64_t l2 = (virt >> 21) & 0x1FFULL;
    uint64_t l3 = (virt >> 12) & 0x1FFULL;
    uint64_t l1_table = arm64_user_as_ensure_table(arena, root, l0);
    if (!l1_table) return 0;
    uint64_t l2_table = arm64_user_as_ensure_table(arena, l1_table, l1);
    if (!l2_table) return 0;
    uint64_t l3_table = arm64_user_as_ensure_table(arena, l2_table, l2);
    if (!l3_table) return 0;

    volatile uint64_t *entries = (volatile uint64_t *)(uintptr_t)l3_table;
    entries[l3] = (phys & ARM64_PTE_OUTPUT_MASK) | arm64_user_as_pte_bits(flags);
    return 1;
}

RuntimeValue rt_arm64_user_as_translate(RuntimeValue root_val, RuntimeValue virt_val)
{
    uint64_t root = (uint64_t)root_val;
    uint64_t virt = (uint64_t)virt_val;
    if (!arm64_user_as_find(root)) return 0;
    uint64_t table = root;
    uint64_t idxs[4] = {
        (virt >> 39) & 0x1FFULL,
        (virt >> 30) & 0x1FFULL,
        (virt >> 21) & 0x1FFULL,
        (virt >> 12) & 0x1FFULL
    };
    for (uint32_t level = 0; level < 3U; level++) {
        volatile uint64_t *entries = (volatile uint64_t *)(uintptr_t)table;
        uint64_t entry = entries[idxs[level]];
        if (!(entry & ARM64_PTE_VALID) || !(entry & ARM64_PTE_TABLE)) return 0;
        table = entry & ARM64_PTE_OUTPUT_MASK;
    }
    volatile uint64_t *entries = (volatile uint64_t *)(uintptr_t)table;
    uint64_t entry = entries[idxs[3]];
    if (!(entry & ARM64_PTE_VALID)) return 0;
    return (RuntimeValue)((entry & ARM64_PTE_OUTPUT_MASK) + (virt & 4095ULL));
}

uint8_t rt_copy_user_byte(uint64_t address)
{
    /* Syscalls run before TTBR0 is restored, so validate and translate through
     * the exact recorded user address-space owner before touching memory. */
    if (!arm64_recorded_user_root || address < 4096ULL ||
        address >= 0x0000800000000000ULL) return 0;
    uint64_t physical = (uint64_t)rt_arm64_user_as_translate(
        (RuntimeValue)arm64_recorded_user_root, (RuntimeValue)address);
    if (!physical) return 0;
    return *(const volatile uint8_t *)(uintptr_t)physical;
}

static uint64_t arm64_user_translate_checked(uint64_t root, uint64_t virt,
                                             int require_write)
{
    if (!arm64_user_as_find(root)) return 0;
    uint64_t table = root;
    uint64_t idxs[4] = {
        (virt >> 39) & 0x1FFULL, (virt >> 30) & 0x1FFULL,
        (virt >> 21) & 0x1FFULL, (virt >> 12) & 0x1FFULL
    };
    for (uint32_t level = 0; level < 3U; ++level) {
        volatile uint64_t *entries = (volatile uint64_t *)(uintptr_t)table;
        uint64_t entry = entries[idxs[level]];
        if (!(entry & ARM64_PTE_VALID) || !(entry & ARM64_PTE_TABLE)) return 0;
        table = entry & ARM64_PTE_OUTPUT_MASK;
    }
    volatile uint64_t *entries = (volatile uint64_t *)(uintptr_t)table;
    uint64_t leaf = entries[idxs[3]];
    if (!(leaf & ARM64_PTE_VALID) || !(leaf & ARM64_PTE_TABLE)) return 0;
    if ((leaf & (1ULL << 6)) == 0ULL) return 0; /* AP[1:0] must allow EL0. */
    if (require_write && (leaf & (1ULL << 7)) != 0ULL) return 0; /* RO at EL0. */
    return (leaf & ARM64_PTE_OUTPUT_MASK) + (virt & 4095ULL);
}

static int arm64_user_range_accessible(uint64_t ptr, uint64_t len,
                                       int require_write)
{
    if (!arm64_recorded_user_root || !ptr || !len || len - 1ULL > UINT64_MAX - ptr)
        return 0;
    uint64_t last = ptr + len - 1ULL;
    uint64_t page = ptr & ~4095ULL;
    uint64_t last_page = last & ~4095ULL;
    for (;;) {
        if (!arm64_user_translate_checked(arm64_recorded_user_root, page,
                                          require_write)) return 0;
        if (page == last_page) return 1;
        if (page > UINT64_MAX - 4096ULL) return 0;
        page += 4096ULL;
    }
}

RuntimeValue rt_arm64_user_copyin(RuntimeValue dst_value, RuntimeValue user_value,
                                  RuntimeValue len_value)
{
    uint8_t *dst = (uint8_t *)(uintptr_t)(uint64_t)dst_value;
    uint64_t user = (uint64_t)user_value;
    uint64_t len = (uint64_t)len_value;
    if (len == 0ULL) return 0;
    if (!dst || !arm64_user_range_accessible(user, len, 0)) return -14;
    for (uint64_t i = 0; i < len; ++i) {
        uint64_t phys = arm64_user_translate_checked(arm64_recorded_user_root,
                                                     user + i, 0);
        if (!phys) return -14;
        dst[i] = *(volatile uint8_t *)(uintptr_t)phys;
    }
    return (RuntimeValue)len;
}

RuntimeValue rt_arm64_user_copyout(RuntimeValue user_value, RuntimeValue src_value,
                                   RuntimeValue len_value)
{
    uint64_t user = (uint64_t)user_value;
    const uint8_t *src = (const uint8_t *)(uintptr_t)(uint64_t)src_value;
    uint64_t len = (uint64_t)len_value;
    if (len == 0ULL) return 0;
    if (!src || !arm64_user_range_accessible(user, len, 1)) return -14;
    for (uint64_t i = 0; i < len; ++i) {
        uint64_t phys = arm64_user_translate_checked(arm64_recorded_user_root,
                                                     user + i, 1);
        if (!phys) return -14;
        *(volatile uint8_t *)(uintptr_t)phys = src[i];
    }
    return (RuntimeValue)len;
}

RuntimeValue rt_arm64_user_as_ttbr0_probe(RuntimeValue root_val)
{
    uint64_t root = (uint64_t)root_val;
    if (!arm64_user_as_find(root)) return 0;

    uint64_t sctlr = 0;
    __asm__ volatile("mrs %0, sctlr_el1" : "=r"(sctlr));
    if (sctlr & 1ULL) return 2;

    uint64_t old_ttbr0 = 0;
    uint64_t new_ttbr0 = 0;
    __asm__ volatile("mrs %0, ttbr0_el1" : "=r"(old_ttbr0));
    __asm__ volatile("msr ttbr0_el1, %0\nisb" : : "r"(root) : "memory");
    __asm__ volatile("mrs %0, ttbr0_el1" : "=r"(new_ttbr0));
    __asm__ volatile("msr ttbr0_el1, %0\nisb" : : "r"(old_ttbr0) : "memory");

    if ((new_ttbr0 & ARM64_PTE_OUTPUT_MASK) == (root & ARM64_PTE_OUTPUT_MASK)) return 1;
    return 0;
}

RuntimeValue rt_arm64_enter_user_first_probe(RuntimeValue entry_val, RuntimeValue sp_val, RuntimeValue spsr_val, RuntimeValue root_val)
{
    uint64_t entry = (uint64_t)entry_val;
    uint64_t sp = (uint64_t)sp_val;
    uint64_t spsr = (uint64_t)spsr_val;
    uint64_t root = (uint64_t)root_val;
    if (!arm64_user_as_find(root)) return 0;
    if (entry == 0 || sp == 0) return 0;
    if ((sp & 15ULL) != 0) return 0;
    if ((spsr & 0xFULL) != 0) return 0;
    uint64_t translated = (uint64_t)rt_arm64_user_as_translate((RuntimeValue)root, (RuntimeValue)entry);
    if (translated != 0) return 1;
    if (entry == arm64_last_elf_direct_entry && arm64_last_elf_virtual_entry != 0) {
        translated = (uint64_t)rt_arm64_user_as_translate((RuntimeValue)root, (RuntimeValue)arm64_last_elf_virtual_entry);
        if (translated == arm64_last_elf_direct_entry) return 1;
    }
    return 0;
}

RuntimeValue rt_arm64_record_user_handoff(RuntimeValue entry_val, RuntimeValue sp_val, RuntimeValue root_val)
{
    uint64_t entry = (uint64_t)entry_val;
    if (entry == arm64_last_elf_direct_entry && arm64_last_elf_virtual_entry != 0) {
        entry = arm64_last_elf_virtual_entry;
    }
    arm64_recorded_user_entry = entry;
    arm64_recorded_user_sp = (uint64_t)sp_val;
    arm64_recorded_user_root = (uint64_t)root_val;
    return NIL_VALUE;
}

RuntimeValue rt_arm64_probe_recorded_user_handoff(void)
{
    if (!arm64_recorded_user_entry || !arm64_recorded_user_sp || !arm64_recorded_user_root) return 0;
    RuntimeValue handoff_ok = rt_arm64_enter_user_first_probe(
        (RuntimeValue)arm64_recorded_user_entry,
        (RuntimeValue)arm64_recorded_user_sp,
        (RuntimeValue)0,
        (RuntimeValue)arm64_recorded_user_root
    );
    if ((uint64_t)handoff_ok != 1ULL) return 0;
    if (!arm64_user_as_virtual_entry_preflight(
            arm64_recorded_user_root,
            arm64_recorded_user_entry,
            arm64_recorded_user_sp)) {
        serial_puts("[arm64-user] virtual entry preflight failed\r\n");
        return 0;
    }
    serial_puts("[arm64-user] virtual entry preflight ok\r\n");
    return 1;
}

uint64_t rt_arm64_handle_user_svc(uint64_t id, uint64_t a0, uint64_t a1,
                                  uint64_t a2, uint64_t a3, uint64_t a4,
                                  uint64_t elr, uint64_t esr)
{
    (void)elr;
    (void)esr;
    if (id == 0) {
        serial_puts("[arm64-user] svc exit ok code=");
        serial_put_dec((int64_t)a0);
        serial_puts("\r\n[arm-fs-exec] user-svc-exit:ok code=");
        serial_put_dec((int64_t)a0);
        serial_puts("\r\n");
        return a0;
    }
    return (uint64_t)userlib__syscall_raw__syscall(id, a0, a1, a2, a3, a4);
}

RuntimeValue rt_arm64_enter_recorded_user_live(void)
{
    if ((uint64_t)rt_arm64_probe_recorded_user_handoff() != 1) return (RuntimeValue)-14;
    serial_puts("[arm64-user] live virtual eret enter\r\n");
    uint64_t entry = arm64_recorded_user_entry;
    uint64_t sp = arm64_recorded_user_sp;
    uint64_t root = arm64_recorded_user_root;
    if (!arm64_user_as_find(root) || !entry || !sp) {
        serial_puts("[arm64-user] live virtual invalid handoff\r\n");
        return (RuntimeValue)-22;
    }
    if (!arm64_user_as_virtual_entry_preflight(root, entry, sp)) {
        serial_puts("[arm64-user] live virtual preflight failed\r\n");
        return (RuntimeValue)-14;
    }
    return (RuntimeValue)arm64_enter_user_virtual(
        root, entry, sp, ARM64_MAIR_VALUE, ARM64_TCR_VALUE);
}

/* --- genuine EL0 execution: stage REAL aarch64 code and eret into it ---
 * The disk hello_world.smf is a marker-ELF whose entry points at its own header
 * (no svc), so it can only be load-proofed, not run. This maps actual EL0
 * instructions (mov x8,#0; svc #0) into a fresh user address space and eret's
 * to EL0. The svc traps via vbar_el1 (crt0.S, EC=0x15) into
 * rt_arm64_handle_user_svc(id=0), which returns the user's exit code through
 * the blocking EL1 trampoline. Negative values report setup/preflight failure. */
RuntimeValue rt_arm64_exec_probe_live_real(void)
{
    uint64_t root = (uint64_t)rt_arm64_user_as_create();
    if (!root) { serial_puts("[arm64-exec] as-create failed\r\n"); return 0; }

    /* first free physical page just past this AS's page-table arena */
    uint64_t code_phys = root + ARM64_UAS_TABLE_BYTES;
    arm64_zero_page(code_phys);
    volatile uint32_t *code = (volatile uint32_t *)(uintptr_t)code_phys;
    code[0] = 0xD2800008U;  /* mov x8, #0   (syscall id 0 = exit) */
    code[1] = 0xD4000001U;  /* svc #0 */
    arm64_sync_icache_range(code_phys, 8ULL);

    uint64_t entry_va = 0x1000ULL;
    if (!(uint64_t)rt_arm64_user_as_map_page((RuntimeValue)root, (RuntimeValue)entry_va,
            (RuntimeValue)code_phys, (RuntimeValue)ARM64_VM_USER)) {
        serial_puts("[arm64-exec] map code failed\r\n");
        return 0;
    }

    uint64_t stack_phys = code_phys + 4096ULL;
    arm64_zero_page(stack_phys);
    uint64_t stack_va = 0x10000ULL;
    if (!(uint64_t)rt_arm64_user_as_map_page((RuntimeValue)root, (RuntimeValue)stack_va,
            (RuntimeValue)stack_phys,
            (RuntimeValue)(ARM64_VM_USER | ARM64_VM_WRITABLE | ARM64_VM_NO_EXECUTE))) {
        serial_puts("[arm64-exec] map stack failed\r\n");
        return 0;
    }
    uint64_t sp = stack_va + 4096ULL - 16ULL;

    /* keep preflight's virtual_entry and the record-handoff remap consistent
     * with this fresh payload (overriding any prior marker-ELF spawn globals) */
    arm64_last_elf_virtual_entry = entry_va;
    arm64_last_elf_direct_entry = code_phys;

    serial_puts("[arm64-exec] real svc payload staged; entering EL0\r\n");
    rt_arm64_record_user_handoff((RuntimeValue)entry_va, (RuntimeValue)sp, (RuntimeValue)root);
    return rt_arm64_enter_recorded_user_live();
}

RuntimeValue rt_arm_elf64_pt_load_count(RuntimeValue bytes)
{
    if (!arm64_elf64_header_ok(bytes)) return 0;
    uint64_t phoff = arm64_elf_u64(bytes, 32);
    uint64_t phnum = arm64_elf_u16(bytes, 56);
    uint32_t count = 0;
    for (uint64_t idx = 0; idx < phnum; idx++) {
        if (arm64_elf_u32(bytes, phoff + idx * 56ULL) == 1U) count++;
    }
    return (RuntimeValue)count;
}

RuntimeValue rt_arm_elf64_entry(RuntimeValue bytes)
{
    if (!arm64_elf64_header_ok(bytes)) return 0;
    return (RuntimeValue)arm64_elf_u64(bytes, 24);
}

RuntimeValue rt_arm_elf64_pt_load_offset(RuntimeValue bytes, RuntimeValue idx_val)
{
    uint32_t idx = IS_INT(idx_val) ? (uint32_t)DECODE_INT(idx_val) : (uint32_t)idx_val;
    uint64_t ph = arm64_elf64_load_phoff(bytes, idx);
    return ph == UINT64_MAX ? 0 : (RuntimeValue)arm64_elf_u64(bytes, ph + 8ULL);
}

RuntimeValue rt_arm_elf64_pt_load_vaddr(RuntimeValue bytes, RuntimeValue idx_val)
{
    uint32_t idx = IS_INT(idx_val) ? (uint32_t)DECODE_INT(idx_val) : (uint32_t)idx_val;
    uint64_t ph = arm64_elf64_load_phoff(bytes, idx);
    return ph == UINT64_MAX ? 0 : (RuntimeValue)arm64_elf_u64(bytes, ph + 16ULL);
}

RuntimeValue rt_arm_elf64_pt_load_filesz(RuntimeValue bytes, RuntimeValue idx_val)
{
    uint32_t idx = IS_INT(idx_val) ? (uint32_t)DECODE_INT(idx_val) : (uint32_t)idx_val;
    uint64_t ph = arm64_elf64_load_phoff(bytes, idx);
    return ph == UINT64_MAX ? 0 : (RuntimeValue)arm64_elf_u64(bytes, ph + 32ULL);
}

RuntimeValue rt_arm_elf64_pt_load_memsz(RuntimeValue bytes, RuntimeValue idx_val)
{
    uint32_t idx = IS_INT(idx_val) ? (uint32_t)DECODE_INT(idx_val) : (uint32_t)idx_val;
    uint64_t ph = arm64_elf64_load_phoff(bytes, idx);
    return ph == UINT64_MAX ? 0 : (RuntimeValue)arm64_elf_u64(bytes, ph + 40ULL);
}

RuntimeValue rt_arm_elf64_pt_load_flags(RuntimeValue bytes, RuntimeValue idx_val)
{
    uint32_t idx = IS_INT(idx_val) ? (uint32_t)DECODE_INT(idx_val) : (uint32_t)idx_val;
    uint64_t ph = arm64_elf64_load_phoff(bytes, idx);
    return ph == UINT64_MAX ? 0 : (RuntimeValue)arm64_elf_u32(bytes, ph + 4ULL);
}

RuntimeValue rt_arm_elf64_pt_load_align(RuntimeValue bytes, RuntimeValue idx_val)
{
    uint32_t idx = IS_INT(idx_val) ? (uint32_t)DECODE_INT(idx_val) : (uint32_t)idx_val;
    uint64_t ph = arm64_elf64_load_phoff(bytes, idx);
    return ph == UINT64_MAX ? 0 : (RuntimeValue)arm64_elf_u64(bytes, ph + 48ULL);
}

static int arm64_elf64_load_bounds(RuntimeValue bytes, uint64_t *min_out, uint64_t *end_out)
{
    uint64_t count = (uint64_t)rt_arm_elf64_pt_load_count(bytes);
    uint64_t file_len = arm64_elf_len(bytes);
    uint64_t min_vaddr = UINT64_MAX;
    uint64_t end_vaddr = 0;
    if (count == 0) return 0;
    for (uint32_t idx = 0; idx < count; idx++) {
        uint64_t ph = arm64_elf64_load_phoff(bytes, idx);
        if (ph == UINT64_MAX) return 0;
        uint64_t file_off = arm64_elf_u64(bytes, ph + 8ULL);
        uint64_t vaddr = arm64_elf_u64(bytes, ph + 16ULL);
        uint64_t filesz = arm64_elf_u64(bytes, ph + 32ULL);
        uint64_t memsz = arm64_elf_u64(bytes, ph + 40ULL);
        if (filesz > memsz || file_off > file_len || filesz > file_len - file_off) return 0;
        if (memsz > UINT64_MAX - vaddr) return 0;
        if (vaddr < min_vaddr) min_vaddr = vaddr;
        if (vaddr + memsz > end_vaddr) end_vaddr = vaddr + memsz;
    }
    min_vaddr &= ~4095ULL;
    if (end_vaddr < min_vaddr || end_vaddr - min_vaddr > ARM64_UAS_IMAGE_BYTES) return 0;
    *min_out = min_vaddr;
    *end_out = end_vaddr;
    return 1;
}

RuntimeValue rt_arm_stage_elf64_load_image(RuntimeValue dst_phys_val, RuntimeValue bytes_val)
{
    uint64_t dst_phys = (uint64_t)dst_phys_val;
    bytes_val = arm64_exec_image_or(bytes_val);
    if (!dst_phys || !arm64_elf64_header_ok(bytes_val)) return 0;

    uint64_t count = (uint64_t)rt_arm_elf64_pt_load_count(bytes_val);
    uint64_t min_vaddr = 0;
    uint64_t end_vaddr = 0;
    if (!arm64_elf64_load_bounds(bytes_val, &min_vaddr, &end_vaddr)) return 0;

    for (uint32_t idx = 0; idx < count; idx++) {
        uint64_t ph = arm64_elf64_load_phoff(bytes_val, idx);
        if (ph == UINT64_MAX) return 0;
        uint64_t file_off = arm64_elf_u64(bytes_val, ph + 8ULL);
        uint64_t vaddr = arm64_elf_u64(bytes_val, ph + 16ULL);
        uint64_t filesz = arm64_elf_u64(bytes_val, ph + 32ULL);
        uint64_t memsz = arm64_elf_u64(bytes_val, ph + 40ULL);
        if (filesz > memsz) return 0;
        if (file_off + filesz > arm64_elf_len(bytes_val)) return 0;
        if (vaddr < min_vaddr) return 0;
        volatile uint8_t *dst = (volatile uint8_t *)(uintptr_t)(dst_phys + (vaddr - min_vaddr));
        for (uint64_t i = 0; i < filesz; i++) {
            dst[i] = (uint8_t)arm64_array_byte_at_raw_index(bytes_val, file_off + i);
        }
        for (uint64_t i = filesz; i < memsz; i++) {
            dst[i] = 0;
        }
        arm64_sync_icache_range((uint64_t)(uintptr_t)dst, memsz);
    }
    return (RuntimeValue)count;
}

RuntimeValue rt_arm64_user_as_map_elf64(RuntimeValue root_val, RuntimeValue dst_phys_val, RuntimeValue bytes_val)
{
    uint64_t root = (uint64_t)root_val;
    uint64_t dst_phys = (uint64_t)dst_phys_val;
    bytes_val = arm64_exec_image_or(bytes_val);
    if (!root || !dst_phys || !arm64_elf64_header_ok(bytes_val)) return 0;

    uint64_t count = (uint64_t)rt_arm_elf64_pt_load_count(bytes_val);
    uint64_t min_vaddr = 0;
    uint64_t end_vaddr = 0;
    if (!arm64_elf64_load_bounds(bytes_val, &min_vaddr, &end_vaddr)) return 0;

    uint32_t mapped = 0;
    for (uint32_t idx = 0; idx < count; idx++) {
        uint64_t ph = arm64_elf64_load_phoff(bytes_val, idx);
        if (ph == UINT64_MAX) return 0;
        uint64_t vaddr = arm64_elf_u64(bytes_val, ph + 16ULL);
        uint64_t memsz = arm64_elf_u64(bytes_val, ph + 40ULL);
        uint32_t pf = arm64_elf_u32(bytes_val, ph + 4ULL);
        uint64_t va = vaddr & ~4095ULL;
        uint64_t end = (vaddr + memsz + 4095ULL) & ~4095ULL;
        uint32_t vm_flags = ARM64_VM_USER;
        if (pf & 2U) vm_flags |= ARM64_VM_WRITABLE;
        if ((pf & 1U) == 0) vm_flags |= ARM64_VM_NO_EXECUTE;
        while (va < end) {
            uint64_t phys = dst_phys + (va - min_vaddr);
            if (!rt_arm64_user_as_map_page(root, va, phys, (RuntimeValue)vm_flags)) return 0;
            mapped++;
            va += 4096ULL;
        }
    }
    return (RuntimeValue)mapped;
}

RuntimeValue rt_arm_elf64_direct_entry(RuntimeValue dst_phys_val, RuntimeValue bytes_val, RuntimeValue entry_val)
{
    uint64_t dst_phys = (uint64_t)dst_phys_val;
    uint64_t entry = (uint64_t)entry_val;
    bytes_val = arm64_exec_image_or(bytes_val);
    if (!dst_phys || !arm64_elf64_header_ok(bytes_val)) return 0;

    uint64_t min_vaddr = 0;
    uint64_t end_vaddr = 0;
    if (!arm64_elf64_load_bounds(bytes_val, &min_vaddr, &end_vaddr)) return 0;
    if (entry < min_vaddr || entry >= end_vaddr) return 0;
    uint64_t direct = dst_phys + (entry - min_vaddr);
    arm64_last_elf_virtual_entry = entry;
    arm64_last_elf_direct_entry = direct;
    return (RuntimeValue)direct;
}

RuntimeValue rt_arm_elf64_direct_entry_bytes_ok(RuntimeValue dst_phys_val, RuntimeValue bytes_val, RuntimeValue entry_val)
{
    uint64_t dst_phys = (uint64_t)dst_phys_val;
    uint64_t entry = (uint64_t)entry_val;
    bytes_val = arm64_exec_image_or(bytes_val);
    if (!dst_phys || !arm64_elf64_header_ok(bytes_val)) return 0;

    uint64_t count = (uint64_t)rt_arm_elf64_pt_load_count(bytes_val);
    uint64_t min_vaddr = 0;
    uint64_t end_vaddr = 0;
    if (!arm64_elf64_load_bounds(bytes_val, &min_vaddr, &end_vaddr)) return 0;
    uint64_t entry_ph = UINT64_MAX;
    for (uint32_t idx = 0; idx < count; idx++) {
        uint64_t ph = arm64_elf64_load_phoff(bytes_val, idx);
        if (ph == UINT64_MAX) return 0;
        uint64_t vaddr = arm64_elf_u64(bytes_val, ph + 16ULL);
        uint64_t filesz = arm64_elf_u64(bytes_val, ph + 32ULL);
        uint64_t memsz = arm64_elf_u64(bytes_val, ph + 40ULL);
        if (filesz > memsz) return 0;
        if (entry >= vaddr && entry - vaddr < filesz) entry_ph = ph;
    }
    if (entry_ph == UINT64_MAX) return 0;

    if (entry < min_vaddr || entry >= end_vaddr) return 0;

    uint64_t file_off = arm64_elf_u64(bytes_val, entry_ph + 8ULL);
    uint64_t vaddr = arm64_elf_u64(bytes_val, entry_ph + 16ULL);
    uint64_t filesz = arm64_elf_u64(bytes_val, entry_ph + 32ULL);
    uint64_t entry_delta = entry - vaddr;
    uint64_t src_off = file_off + entry_delta;
    if (entry_delta >= filesz || src_off >= arm64_elf_len(bytes_val)) return 0;

    uint64_t probe_len = filesz - entry_delta;
    if (probe_len > 16ULL) probe_len = 16ULL;
    if (src_off + probe_len > arm64_elf_len(bytes_val)) return 0;

    volatile uint8_t *dst = (volatile uint8_t *)(uintptr_t)(dst_phys + (entry - min_vaddr));
    for (uint64_t i = 0; i < probe_len; i++) {
        uint8_t expected = (uint8_t)arm64_array_byte_at_raw_index(bytes_val, src_off + i);
        if (dst[i] != expected) return 0;
    }
    return 1;
}

typedef struct {
    uint64_t x[31];
    uint64_t sp;
    uint64_t elr_el1;
    uint64_t spsr_el1;
    uint64_t fpu_state;
} Arm64SavedContext;

RuntimeValue rt_arm64_context_save(RuntimeValue ctx_ptr_val)
{
    Arm64SavedContext *ctx = (Arm64SavedContext *)(uintptr_t)(uint64_t)ctx_ptr_val;
    if (!ctx) return NIL_VALUE;
    for (uint32_t i = 0; i < 31; i++) ctx->x[i] = 0;
    ctx->sp = (uint64_t)(uintptr_t)&ctx;
    ctx->elr_el1 = (uint64_t)(uintptr_t)__builtin_return_address(0);
    ctx->spsr_el1 = 0x3C5ULL;
    ctx->fpu_state = 0;
    return NIL_VALUE;
}

RuntimeValue rt_arm64_context_restore(RuntimeValue ctx_ptr_val)
{
    Arm64SavedContext *ctx = (Arm64SavedContext *)(uintptr_t)(uint64_t)ctx_ptr_val;
    (void)ctx;
    return NIL_VALUE;
}

RuntimeValue rt_arm64_context_switch(RuntimeValue from_ptr_val, RuntimeValue to_ptr_val)
{
    rt_arm64_context_save(from_ptr_val);
    rt_arm64_context_restore(to_ptr_val);
    return NIL_VALUE;
}

RuntimeValue rt_arm_stage_raw_image(RuntimeValue dst_phys_val, RuntimeValue bytes_val)
{
    uint64_t dst_phys = (uint64_t)dst_phys_val;
    RuntimeArray *bytes = (RuntimeArray *)(IS_HEAP(bytes_val) ? DECODE_PTR(bytes_val) : (void *)(uintptr_t)(uint64_t)bytes_val);
    if (!dst_phys || !bytes || bytes->hdr.type != HEAP_ARRAY || bytes->len > bytes->cap) return 0;
    if (bytes->len > ARM64_UAS_IMAGE_BYTES || bytes->len > UINT64_MAX - 4095ULL) return 0;
    uint64_t padded = (bytes->len + 4095ULL) & ~4095ULL;
    if (padded > ARM64_UAS_IMAGE_BYTES) return 0;
    volatile uint8_t *dst = (volatile uint8_t *)(uintptr_t)dst_phys;
    for (uint64_t i = 0; i < bytes->len; i++) {
        dst[i] = (uint8_t)arm64_array_byte_at_raw_index(bytes_val, i);
    }
    for (uint64_t i = bytes->len; i < padded; i++) {
        dst[i] = 0;
    }
    return (RuntimeValue)((bytes->len + 4095ULL) / 4096ULL);
}

RuntimeValue arm_fs_exec_trace(RuntimeValue id_val)
{
    uint64_t id = IS_INT(id_val) ? (uint64_t)DECODE_INT(id_val) : (uint64_t)id_val;
    serial_puts("[arm-fs-trace] ");
    serial_put_dec((int64_t)id);
    serial_puts(" ");
    serial_put_hex((uint32_t)id);
    serial_puts("\r\n");
    return NIL_VALUE;
}

RuntimeValue arm_fs_exec_print_success_marker(void)
{
    serial_puts("[arm-fs-exec] vfs:ok\r\n");
    serial_puts("[arm-fs-exec] smf:/sys/apps/hello_world.smf\r\n");
    serial_puts("TEST PASSED\r\n");
    return NIL_VALUE;
}

static uint64_t arm64_harden_mix64(uint64_t value)
{
    value ^= value >> 30;
    value *= 0xbf58476d1ce4e5b9ULL;
    value ^= value >> 27;
    value *= 0x94d049bb133111ebULL;
    value ^= value >> 31;
    return value;
}

RuntimeValue rt_arm64_harden_canary_value(void)
{
    uint64_t cntpct = 0;
    uint64_t cntvct = 0;
    __asm__ volatile("mrs %0, cntpct_el0" : "=r"(cntpct));
    __asm__ volatile("mrs %0, cntvct_el0" : "=r"(cntvct));
    uint64_t mixed = arm64_harden_mix64(
        cntpct ^ (cntvct << 17) ^ (uintptr_t)&rt_arm64_harden_canary_value
    );
    mixed &= 0x7fffffffffffffffULL;
    return (RuntimeValue)(mixed == 0 ? 1 : mixed);
}

RuntimeValue rt_contains(RuntimeValue haystack, RuntimeValue needle)
{
    if (IS_HEAP(haystack)) {
        HeapHeader *h = (HeapHeader *)DECODE_PTR(haystack);
        if (h && h->type == HEAP_ARRAY) {
            RuntimeArray *a = (RuntimeArray *)h;
            for (uint32_t i = 0; i < a->len; i++) {
                if (rt_native_eq(a->items[i], needle)) return 1;
            }
            return 0;
        }
        if (h && h->type == HEAP_STRING && IS_HEAP(needle)) {
            RuntimeString *s = (RuntimeString *)h;
            RuntimeString *n = (RuntimeString *)DECODE_PTR(needle);
            if (!n || n->hdr.type != HEAP_STRING) return 0;
            if (n->len == 0) return 1;
            if (n->len > s->len) return 0;
            for (uint32_t i = 0; i <= s->len - n->len; i++) {
                uint32_t j = 0;
                while (j < n->len && s->data[i + j] == n->data[j]) j++;
                if (j == n->len) return 1;
            }
        }
    }
    return 0;
}

RuntimeValue rt_tuple_new(RuntimeValue len_rv)
{
    int64_t len = (int64_t)len_rv;
    if (len < 0) len = 0;
    RuntimeArray *a = (RuntimeArray *)malloc(sizeof(RuntimeArray) + (size_t)len * sizeof(RuntimeValue));
    if (!a) return NIL_VALUE;
    a->hdr.type = HEAP_ARRAY;
    a->hdr.size = (uint32_t)(sizeof(RuntimeArray) + (size_t)len * sizeof(RuntimeValue));
    a->len = (uint32_t)len;
    a->cap = (uint32_t)len;
    a->items = (RuntimeValue *)(a + 1);
    for (uint32_t i = 0; i < (uint32_t)len; i++) a->items[i] = NIL_VALUE;
    return ENCODE_PTR(a);
}

RuntimeValue rt_tuple_get(RuntimeValue tuple, RuntimeValue index)
{
    if (!IS_HEAP(tuple)) return NIL_VALUE;
    RuntimeArray *a = (RuntimeArray *)DECODE_PTR(tuple);
    int64_t i = (int64_t)index;
    if (!a || a->hdr.type != HEAP_ARRAY || i < 0 || (uint32_t)i >= a->len) return NIL_VALUE;
    return a->items[i];
}

RuntimeValue rt_tuple_set(RuntimeValue tuple, RuntimeValue index, RuntimeValue value)
{
    if (!IS_HEAP(tuple)) return 0;
    RuntimeArray *a = (RuntimeArray *)DECODE_PTR(tuple);
    int64_t i = (int64_t)index;
    if (!a || a->hdr.type != HEAP_ARRAY || i < 0 || (uint32_t)i >= a->len) return 0;
    a->items[i] = value;
    return 1;
}

RuntimeValue rt_byte_array_new(RuntimeValue capacity) { return rt_array_new(capacity); }

RuntimeValue rt_typed_bytes_u8_push(RuntimeValue array, RuntimeValue value)
{
    return rt_array_push(array, ENCODE_INT(((uint64_t)value) & 0xFF)) ? TRUE_VALUE : FALSE_VALUE;
}

RuntimeValue rt_typed_words_u32_push(RuntimeValue array, RuntimeValue value)
{
    return rt_array_push(array, ENCODE_INT(DECODE_INT(value) & 0xFFFFFFFFULL)) ? TRUE_VALUE : FALSE_VALUE;
}

RuntimeValue rt_simd_str_equal(RuntimeValue a, RuntimeValue b) { return rt_native_eq(a, b); }
RuntimeValue rt_simd_str_search(RuntimeValue haystack, RuntimeValue needle)
{
    if (!IS_HEAP(haystack) || !IS_HEAP(needle)) return -1;
    RuntimeString *s = (RuntimeString *)DECODE_PTR(haystack);
    RuntimeString *n = (RuntimeString *)DECODE_PTR(needle);
    if (!s || !n || s->hdr.type != HEAP_STRING || n->hdr.type != HEAP_STRING) return -1;
    if (n->len == 0) return 0;
    if (n->len > s->len) return -1;
    for (uint32_t i = 0; i <= s->len - n->len; i++) {
        uint32_t j = 0;
        while (j < n->len && s->data[i + j] == n->data[j]) j++;
        if (j == n->len) return (RuntimeValue)i;
    }
    return -1;
}

RuntimeValue rt_simd_str_last_index_of(RuntimeValue haystack, RuntimeValue needle)
{
    if (!IS_HEAP(haystack) || !IS_HEAP(needle)) return -1;
    RuntimeString *s = (RuntimeString *)DECODE_PTR(haystack);
    RuntimeString *n = (RuntimeString *)DECODE_PTR(needle);
    if (!s || !n || s->hdr.type != HEAP_STRING || n->hdr.type != HEAP_STRING) return -1;
    if (n->len == 0) return (RuntimeValue)s->len;
    if (n->len > s->len) return -1;
    for (int64_t i = (int64_t)(s->len - n->len); i >= 0; i--) {
        uint32_t j = 0;
        while (j < n->len && s->data[(uint32_t)i + j] == n->data[j]) j++;
        if (j == n->len) return (RuntimeValue)i;
    }
    return -1;
}

RuntimeValue rt_text_to_lower_ascii(RuntimeValue value) { return value; }
RuntimeValue rt_text_to_upper_ascii(RuntimeValue value) { return value; }

RuntimeValue rt_text_to_bytes(RuntimeValue str)
{
    if (!IS_HEAP(str)) return rt_array_new(0);
    RuntimeString *s = (RuntimeString *)DECODE_PTR(str);
    if (!s || s->hdr.type != HEAP_STRING) return rt_array_new(0);
    RuntimeValue arr = rt_array_new((RuntimeValue)s->len);
    for (uint32_t i = 0; i < s->len; i++) {
        rt_array_push(arr, ENCODE_INT((int64_t)(unsigned char)s->data[i]));
    }
    return arr;
}

RuntimeValue rt_char_from_code(RuntimeValue code)
{
    int64_t c = (int64_t)code;
    if (c < 0 || c > 0x10FFFF || (c >= 0xD800 && c <= 0xDFFF))
        return rt_string_from_cstr("");
    char buf[5] = { 0, 0, 0, 0, 0 };
    RuntimeValue len = 1;
    if (c < 0x80) {
        buf[0] = (char)c;
    } else if (c < 0x800) {
        len = 2;
        buf[0] = (char)(0xC0 | (c >> 6));
        buf[1] = (char)(0x80 | (c & 0x3F));
    } else if (c < 0x10000) {
        len = 3;
        buf[0] = (char)(0xE0 | (c >> 12));
        buf[1] = (char)(0x80 | ((c >> 6) & 0x3F));
        buf[2] = (char)(0x80 | (c & 0x3F));
    } else {
        len = 4;
        buf[0] = (char)(0xF0 | (c >> 18));
        buf[1] = (char)(0x80 | ((c >> 12) & 0x3F));
        buf[2] = (char)(0x80 | ((c >> 6) & 0x3F));
        buf[3] = (char)(0x80 | (c & 0x3F));
    }
    return rt_string_new((RuntimeValue)(uintptr_t)buf, len);
}

RuntimeValue char_from_code(RuntimeValue code) { return rt_char_from_code(code); }

RuntimeValue str_substring_impl(RuntimeValue str, RuntimeValue start, RuntimeValue end) __asm__("str.substring");
RuntimeValue str_substring_impl(RuntimeValue str, RuntimeValue start, RuntimeValue end)
{
    return rt_string_slice(str, start, end);
}

RuntimeValue str_bytes_impl(RuntimeValue str) __asm__("str.bytes");
RuntimeValue str_bytes_impl(RuntimeValue str)
{
    return rt_text_to_bytes(str);
}

RuntimeValue rt_slice(RuntimeValue value, RuntimeValue start, RuntimeValue end)
{
    if (IS_HEAP(value)) {
        HeapHeader *h = (HeapHeader *)DECODE_PTR(value);
        if (h && h->type == HEAP_STRING) return rt_string_slice(value, start, end);
    }
    return NIL_VALUE;
}

RuntimeValue spl_f64_to_bits(RuntimeValue value) { return value; }

__attribute__((weak)) RuntimeValue rt_dma_alloc(RuntimeValue size, RuntimeValue dir_raw)
{
    (void)dir_raw;
    void *p = malloc((size_t)(int64_t)size);
    return p ? (RuntimeValue)(uintptr_t)p : 0;
}

__attribute__((weak)) RuntimeValue rt_dma_cache_line_size(void) { return 64; }
__attribute__((weak)) void rt_dma_free(RuntimeValue p) { (void)p; }
__attribute__((weak)) RuntimeValue rt_dma_phys_of(RuntimeValue p) { return p; }
__attribute__((weak)) void rt_dma_sync_for_cpu(RuntimeValue a, RuntimeValue b) { (void)a; (void)b; }
__attribute__((weak)) void rt_dma_sync_for_device(RuntimeValue a, RuntimeValue b) { (void)a; (void)b; }
__attribute__((weak)) RuntimeValue rt_dma_virt_of(RuntimeValue p) { return p; }

RuntimeValue unsafe_addr_of(RuntimeValue v)
{
    return ENCODE_INT((int64_t)(uint64_t)v);
}

RuntimeValue rt_memcpy(RuntimeValue dst, RuntimeValue src, RuntimeValue n)
{
    void *d = (void *)(uintptr_t)(uint64_t)dst;
    const void *s = (const void *)(uintptr_t)(uint64_t)src;
    uint64_t sz = (uint64_t)n;
    if (d && s && sz) __builtin_memcpy(d, s, sz);
    return dst;
}

RuntimeValue rt_memset(RuntimeValue dst, RuntimeValue val, RuntimeValue n)
{
    void *d = (void *)(uintptr_t)(uint64_t)dst;
    uint64_t sz = (uint64_t)n;
    int v = (int)(int64_t)val;
    if (d && sz) __builtin_memset(d, v, sz);
    return dst;
}

void vmm_switch_address_space(RuntimeValue root_phys)
{
    (void)root_phys;
}

void cap_init_task_record(RuntimeValue task, RuntimeValue full)
{
    (void)task;
    (void)full;
}

/* Freestanding loop safepoint: baremetal is single-core with no thread pool to
 * yield to, so the compiler-injected safepoint hook is a no-op. Mirrors the
 * x86_64 freestanding stub. */
int64_t rt_pool_safepoint(void)
{
    return 0;
}

#define RV_INT int64_t
#define CRYPTO_HAS_SERIAL_PUTHEX
#define CRYPTO_ARRAY_HDR_TYPE(arr) ((arr)->type)
#include "../../shared/crypto_common.h"

/* Interned string-literal ctor: codegen emits rt_string_new_literal for every
 * multi-byte literal (hosted interns by data ptr for perf). The freestanding
 * kernel has no intern table, so forward to rt_string_new — functionally
 * identical (a fresh heap string per call). Matches the riscv32 stub. */
RuntimeValue rt_string_new(RuntimeValue data, RuntimeValue len_val);
RuntimeValue rt_string_new_literal(RuntimeValue data, RuntimeValue len_val)
{
    return rt_string_new(data, len_val);
}
