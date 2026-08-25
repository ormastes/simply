/* Bounded x86_64 runtime owners added by the filesystem-server kernel.
 * Private device state stays in baremetal_stubs.c behind one narrow query.
 */
#include <stdint.h>
#ifndef SIMPLEOS_RUNTIME_OWNER_EMBEDDED
#include "../../common/baremetal_runtime.h"
#else
#define BAREMETAL_GC_BYTE_PACKED BYTE_PACKED
#endif

extern RuntimeValue rt_boot_tcp_read_bytes(int64_t max_len);
extern int64_t rt_net_stats(void);

static inline void service_owner_outb(uint16_t port, uint8_t value)
{
    __asm__ volatile("outb %0, %1" : : "a"(value), "Nd"(port));
}

RuntimeValue rt_debug_exit_failure(void)
{
    /* QEMU isa-debug-exit reports (value << 1) | 1. */
    service_owner_outb((uint16_t)0xF4, (uint8_t)1);
    return 0;
}

static RuntimeArray *array_from_abi(RuntimeValue value)
{
    RuntimeArray *array = IS_HEAP(value)
        ? (RuntimeArray *)DECODE_PTR(value)
        : (RuntimeArray *)(uintptr_t)value;
    return array && array->hdr.type == HEAP_ARRAY ? array : (RuntimeArray *)0;
}

static RuntimeValue *array_items(RuntimeArray *array)
{
    return array->items
        ? array->items
        : (RuntimeValue *)((uint8_t *)array + sizeof(RuntimeArray));
}

RuntimeValue rt_boot_tcp_read_bytes_for_fd(int64_t fd, int64_t max_len)
{
    if (fd != 200)
        return rt_array_new(ENCODE_INT(0));
    return rt_boot_tcp_read_bytes(max_len);
}

int64_t rt_net_tx_test(void)
{
    return DECODE_INT(rt_net_stats());
}

int64_t rt_net_rx_ready(void)
{
    return DECODE_INT(rt_net_stats());
}

RuntimeValue rt_collection_remove(RuntimeValue receiver, RuntimeValue key)
{
    RuntimeArray *array = array_from_abi(receiver);
    if (!array) return NIL_VALUE;
    int64_t index = IS_INT(key) ? DECODE_INT(key) : (int64_t)key;
    if (index < 0 || (uint64_t)index >= array->len) return NIL_VALUE;

    if (array->hdr.gc_flags & BAREMETAL_GC_BYTE_PACKED) {
        uint8_t *items = (uint8_t *)array_items(array);
        RuntimeValue removed = ENCODE_INT(items[index]);
        for (uint64_t i = (uint64_t)index; i + 1U < array->len; i++)
            items[i] = items[i + 1U];
        array->len--;
        return removed;
    }

    RuntimeValue *items = array_items(array);
    RuntimeValue removed = items[index];
    for (uint64_t i = (uint64_t)index; i + 1U < array->len; i++)
        items[i] = items[i + 1U];
    array->len--;
    items[array->len] = NIL_VALUE;
    return removed;
}

/* Cached CPUID topology decoder. selector: SMT shift, package shift, x2APIC. */
uint32_t rt_x86_topology_field(uint32_t selector)
{
    static uint32_t initialized;
    static uint32_t fields[3];
    if (!initialized) {
        uint32_t max_leaf = 0, ebx = 0, ecx = 0, edx = 0;
        uint32_t leaf = 0;
        __asm__ volatile("cpuid"
                         : "+a"(max_leaf), "=b"(ebx), "=c"(ecx), "=d"(edx)
                         : : "memory");
        if (max_leaf >= 0x1fu) leaf = 0x1fu;
        else if (max_leaf >= 0x0bu) leaf = 0x0bu;
        if (leaf) {
            for (uint32_t subleaf = 0; subleaf < 8u; subleaf++) {
                uint32_t eax = leaf;
                ecx = subleaf;
                __asm__ volatile("cpuid"
                                 : "+a"(eax), "=b"(ebx), "+c"(ecx), "=d"(edx)
                                 : : "memory");
                uint32_t type = (ecx >> 8) & 0xffu;
                if (!type || !(ebx & 0xffffu)) break;
                fields[2] = edx;
                if (type == 1u) fields[0] = eax & 0x1fu;
                else if (type == 2u) fields[1] = eax & 0x1fu;
            }
        }
        if (fields[1] < fields[0]) fields[1] = fields[0];
        initialized = 1u;
    }
    return selector < 3u ? fields[selector] : 0u;
}
