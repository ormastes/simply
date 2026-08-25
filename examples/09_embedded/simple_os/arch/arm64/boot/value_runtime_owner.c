/* SimpleOS ARM64 scalar/value ABI owners needed by filesystem applications. */
#include <stdint.h>
#ifndef SIMPLEOS_RUNTIME_OWNER_EMBEDDED
#include "../../common/baremetal_runtime.h"
#endif

extern void *malloc(size_t size);

RuntimeValue rt_raw_i64_to_string(RuntimeValue raw)
{
    int64_t value = (int64_t)raw;
    uint64_t magnitude = value < 0
        ? (uint64_t)(-(value + 1)) + 1u
        : (uint64_t)value;
    char buffer[21];
    int position = 0;
    do {
        buffer[position++] = '0' + (char)(magnitude % 10u);
        magnitude /= 10u;
    } while (magnitude);
    if (value < 0) buffer[position++] = '-';

    RuntimeString *string = malloc(sizeof(RuntimeString) + (size_t)position + 1u);
    if (!string) return NIL_VALUE;
#ifdef SIMPLEOS_RUNTIME_OWNER_EMBEDDED
    /* This ARM64 runtime stores type/flags/reserved in one zeroed word. */
    string->hdr.type = HEAP_STRING;
#else
    string->hdr.type = HEAP_STRING;
    string->hdr.gc_flags = 0;
    string->hdr.reserved = 0;
#endif
    string->hdr.size = (uint32_t)(sizeof(RuntimeString) + (size_t)position + 1u);
    string->len = (uint64_t)position;
    int output = 0;
    while (position > 0) string->data[output++] = buffer[--position];
    string->data[output] = '\0';
    return ENCODE_PTR(string);
}

static double any_as_f64(RuntimeValue value)
{
    if (IS_FLOAT(value)) {
        uint64_t bits = (uint64_t)value & ~TAG_MASK;
        double result;
        __builtin_memcpy(&result, &bits, sizeof(result));
        return result;
    }
    return (double)DECODE_INT(value);
}

static RuntimeValue any_box_f64(double value)
{
    uint64_t bits;
    __builtin_memcpy(&bits, &value, sizeof(bits));
    return (RuntimeValue)((bits & ~TAG_MASK) | TAG_FLOAT);
}

RuntimeValue rt_any_sub(RuntimeValue left, RuntimeValue right)
{
    if (IS_FLOAT(left) || IS_FLOAT(right)) return any_box_f64(any_as_f64(left) - any_as_f64(right));
    return ENCODE_INT(DECODE_INT(left) - DECODE_INT(right));
}

RuntimeValue rt_any_mul(RuntimeValue left, RuntimeValue right)
{
    if (IS_FLOAT(left) || IS_FLOAT(right)) return any_box_f64(any_as_f64(left) * any_as_f64(right));
    return ENCODE_INT(DECODE_INT(left) * DECODE_INT(right));
}

RuntimeValue rt_any_div(RuntimeValue left, RuntimeValue right)
{
    if (IS_FLOAT(left) || IS_FLOAT(right)) return any_box_f64(any_as_f64(left) / any_as_f64(right));
    int64_t l = DECODE_INT(left), r = DECODE_INT(right);
    return ENCODE_INT(r == 0 || (l == INT64_MIN && r == -1) ? 0 : l / r);
}

RuntimeValue rt_any_mod(RuntimeValue left, RuntimeValue right)
{
    if (IS_FLOAT(left) || IS_FLOAT(right)) {
        double l = any_as_f64(left), r = any_as_f64(right);
        if (r == 0.0) return any_box_f64(0.0 / 0.0);
        int64_t quotient = (int64_t)(l / r);
        return any_box_f64(l - (double)quotient * r);
    }
    int64_t l = DECODE_INT(left), r = DECODE_INT(right);
    return ENCODE_INT(r == 0 || (l == INT64_MIN && r == -1) ? 0 : l % r);
}

#define ARM_ANY_ORDERED(name, op) \
RuntimeValue name(RuntimeValue left, RuntimeValue right) { \
    if (IS_FLOAT(left) || IS_FLOAT(right)) return any_as_f64(left) op any_as_f64(right); \
    return DECODE_INT(left) op DECODE_INT(right); \
}
ARM_ANY_ORDERED(rt_any_lt, <)
ARM_ANY_ORDERED(rt_any_gt, >)
ARM_ANY_ORDERED(rt_any_le, <=)
ARM_ANY_ORDERED(rt_any_ge, >=)
#undef ARM_ANY_ORDERED
