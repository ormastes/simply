#ifndef SIMPLEOS_FV_ALLOC
#error "SIMPLEOS_FV_ALLOC must name the target allocator"
#endif
#ifndef SIMPLEOS_FV_PANIC
#error "SIMPLEOS_FV_PANIC must name the non-returning target panic hook"
#endif

#include "freestanding_value_registry.h"

typedef struct { uintptr_t ptr; size_t bytes; } SimpleOsFvAllocation;
static SimpleOsFvAllocation simpleos_fv_structs[SIMPLEOS_FV_REGISTRY_CAP];
static SimpleOsFvAllocation simpleos_fv_wide[SIMPLEOS_FV_REGISTRY_CAP];
static SimpleOsFvAllocation simpleos_fv_enums[SIMPLEOS_FV_REGISTRY_CAP];
static size_t simpleos_fv_struct_count;
static size_t simpleos_fv_wide_count;
static size_t simpleos_fv_enum_count;
static uint8_t simpleos_fv_registry_lock;

static void simpleos_fv_lock(void)
{
    while (__atomic_test_and_set(&simpleos_fv_registry_lock, __ATOMIC_ACQUIRE)) {
        __asm__ volatile("" ::: "memory");
    }
}

static void simpleos_fv_unlock(void)
{
    __atomic_clear(&simpleos_fv_registry_lock, __ATOMIC_RELEASE);
}

static int simpleos_fv_register(SimpleOsFvAllocation *entries, size_t *count,
                                void *ptr, size_t bytes)
{
    if (!ptr || bytes == 0) return 0;
    uintptr_t raw = (uintptr_t)ptr;
    if (raw + bytes < raw) return 0;
    simpleos_fv_lock();
    if (*count >= SIMPLEOS_FV_REGISTRY_CAP) {
        simpleos_fv_unlock();
        return 0;
    }
    entries[*count].ptr = raw;
    entries[*count].bytes = bytes;
    *count += 1;
    simpleos_fv_unlock();
    return 1;
}

static int simpleos_fv_contains(const SimpleOsFvAllocation *entries,
                                const size_t *count, uintptr_t ptr, size_t bytes)
{
    if (!ptr || !bytes || ptr + bytes < ptr) return 0;
    simpleos_fv_lock();
    for (size_t i = 0; i < *count; ++i) {
        uintptr_t base = entries[i].ptr;
        size_t extent = entries[i].bytes;
        if (ptr >= base && ptr - base <= extent && bytes <= extent - (ptr - base)) {
            simpleos_fv_unlock();
            return 1;
        }
    }
    simpleos_fv_unlock();
    return 0;
}

int simpleos_fv_register_enum(void *ptr, size_t bytes)
{
    return simpleos_fv_register(simpleos_fv_enums, &simpleos_fv_enum_count,
                                ptr, bytes);
}

static SimpleOsFreestandingWideValueV1 *simpleos_fv_as_uint(RuntimeValue value)
{
    if (!IS_HEAP(value)) return (SimpleOsFreestandingWideValueV1 *)0;
    uintptr_t raw = (uintptr_t)DECODE_PTR(value);
    if (!simpleos_fv_contains(simpleos_fv_wide, &simpleos_fv_wide_count,
                              raw, sizeof(SimpleOsFreestandingWideValueV1))) return 0;
    SimpleOsFreestandingWideValueV1 *box = (SimpleOsFreestandingWideValueV1 *)raw;
    if (box->magic != SIMPLEOS_FV_UINT_MAGIC ||
        box->abi_version != SIMPLEOS_FV_ABI_VERSION ||
        box->kind != SIMPLEOS_FV_KIND_UINT) return 0;
    return box;
}

RuntimeValue rt_value_u64(RuntimeValue bits)
{
    SimpleOsFreestandingWideValueV1 *box =
        (SimpleOsFreestandingWideValueV1 *)SIMPLEOS_FV_ALLOC(sizeof(*box));
    if (!box || !simpleos_fv_register(simpleos_fv_wide, &simpleos_fv_wide_count,
                                       box, sizeof(*box))) SIMPLEOS_FV_PANIC("wide-value registry exhausted");
    box->magic = SIMPLEOS_FV_UINT_MAGIC;
    box->abi_version = SIMPLEOS_FV_ABI_VERSION;
    box->kind = SIMPLEOS_FV_KIND_UINT;
    box->payload = (uint64_t)bits;
    return ENCODE_PTR(box);
}

RuntimeValue rt_value_as_u64(RuntimeValue value)
{
    SimpleOsFreestandingWideValueV1 *box = simpleos_fv_as_uint(value);
    if (box) return (RuntimeValue)box->payload;
    return value >> 3;
}

RuntimeValue rt_value_unbox_int(RuntimeValue value)
{
    SimpleOsFreestandingWideValueV1 *box = simpleos_fv_as_uint(value);
    if (box) return (RuntimeValue)box->payload;
    if (IS_INT(value)) return DECODE_INT(value);
    if (value == 11) return 1;
    if (value == 19) return 0;
    return value;
}

void *rt_struct_alloc(int64_t size)
{
    if (size <= 0) return 0;
    void *ptr = SIMPLEOS_FV_ALLOC((size_t)size);
    if (!ptr || !simpleos_fv_register(simpleos_fv_structs, &simpleos_fv_struct_count,
                                       ptr, (size_t)size)) return 0;
    return ptr;
}

int8_t rt_struct_receiver_valid(RuntimeValue receiver,
                                RuntimeValue byte_offset,
                                RuntimeValue access_width)
{
    if (!receiver || byte_offset < 0 || access_width <= 0) return 0;
    uintptr_t base = ((uintptr_t)receiver) & ~(uintptr_t)TAG_MASK;
    uintptr_t offset = (uintptr_t)byte_offset;
    if (base + offset < base) return 0;
    return simpleos_fv_contains(simpleos_fv_structs, &simpleos_fv_struct_count,
                                base + offset, (size_t)access_width) ? 1 : 0;
}

RuntimeValue rt_unwrap_or_trap(RuntimeValue value)
{
    if (!IS_HEAP(value)) return value;
    uintptr_t raw = (uintptr_t)DECODE_PTR(value);
    if (!simpleos_fv_contains(simpleos_fv_enums, &simpleos_fv_enum_count,
                              raw, sizeof(SimpleOsFreestandingEnumV1))) return value;
    SimpleOsFreestandingEnumV1 *e = (SimpleOsFreestandingEnumV1 *)raw;
    if (e->hdr.type != HEAP_ENUM) return value;
    const uint32_t ok = 2405352012u, err = 4200179024u;
    const uint32_t some = 4053299545u, none = 2371748697u;
    if (e->enum_id == 1u) {
        if (e->discriminant == some) return e->payload;
        if (e->discriminant == none) SIMPLEOS_FV_PANIC("called unwrap on None");
        return value;
    }
    if (e->discriminant == ok) return e->payload;
    if (e->discriminant == err) SIMPLEOS_FV_PANIC("called unwrap on Err");
    return value;
}
