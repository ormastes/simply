#ifndef SIMPLEOS_FREESTANDING_VALUE_REGISTRY_H
#define SIMPLEOS_FREESTANDING_VALUE_REGISTRY_H

#include <stddef.h>
#include <stdint.h>
#include "../baremetal_runtime.h"

#define SIMPLEOS_FV_ABI_VERSION 1u
#define SIMPLEOS_FV_UINT_MAGIC 0x55494E54u
#define SIMPLEOS_FV_KIND_UINT 1u
#define SIMPLEOS_FV_REGISTRY_CAP 4096u
#ifndef HEAP_ENUM
#define HEAP_ENUM 7
#endif

typedef struct {
    HeapHeader hdr;
    uint32_t enum_id;
    uint32_t discriminant;
    RuntimeValue payload;
} SimpleOsFreestandingEnumV1;

typedef struct {
    uint32_t magic;
    uint16_t abi_version;
    uint16_t kind;
    uint64_t payload;
} SimpleOsFreestandingWideValueV1;

_Static_assert(sizeof(SimpleOsFreestandingWideValueV1) == 16,
               "freestanding wide-value ABI v1 must remain 16 bytes");

int simpleos_fv_register_enum(void *ptr, size_t bytes);
RuntimeValue rt_value_u64(RuntimeValue bits);
RuntimeValue rt_value_as_u64(RuntimeValue value);
RuntimeValue rt_value_unbox_int(RuntimeValue value);
void *rt_struct_alloc(int64_t size);
int8_t rt_struct_receiver_valid(RuntimeValue receiver,
                                RuntimeValue byte_offset,
                                RuntimeValue access_width);
RuntimeValue rt_unwrap_or_trap(RuntimeValue value);

#endif
