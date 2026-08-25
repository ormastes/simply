/* aarch64 freestanding runtime bridge — ported from
 * src/os/kernel/arch/riscv64/boot/freestanding_runtime.c (see git history
 * for the RV64 original this was copied from on 2026-08-07).
 *
 * This file is compiled as a boot object by native-build (auto-discovered
 * as a sibling of the entry .spl's `boot/` dir, see
 * link_objects_freestanding() in
 * src/compiler_rust/compiler/src/pipeline/native_project/linker.rs) for the
 * aarch64 Limine-protocol boot lane
 * (examples/09_embedded/simple_os/arch/aarch64/, entry kernel_main in
 * src/os/kernel/boot/limine_boot_aarch64.spl). Keep it libc-free: no
 * includes, no malloc, no formatted I/O.
 *
 * Deltas vs the RV64 original:
 *   - No custom `_start` asm entry stub: Limine's ELF loader jumps to the
 *     ELF entry point with a stack already set up per the Limine boot
 *     protocol. The ELF entry itself is `fn _start()` defined in Simple in
 *     examples/09_embedded/simple_os/arch/aarch64/limine_entry.spl (see
 *     that file's header for why the top-level entry function must be
 *     literally named `_start`, and `ENTRY(_start)` in
 *     examples/09_embedded/simple_os/arch/aarch64/boot/linker_limine.ld) —
 *     no C/asm boot glue is needed here at all, unlike RV64's
 *     `_start: la sp, _stack_top; j __simple_entry_start` (RISC-V-only asm,
 *     would not even assemble under --target=aarch64-none-elf), which this
 *     file drops entirely.
 *   - UART: PL011 MMIO single-byte busy-free store to DR at QEMU `virt`
 *     UART0 base 0x09000000, replacing the RV64 NS16550 store at
 *     0x10000000. No PL011 init or FR/TXFF busy-wait — the hand-written C
 *     probe kernel validated 2026-08-06 (see
 *     doc/08_tracking/bug/aarch64_real_firmware_boot_gap_and_seed_defects_2026-07-14.md)
 *     proved a bare DR store works against QEMU's firmware-initialized
 *     PL011 for this milestone's short boot-banner output.
 *   - Truncated after the arch-agnostic core runtime section (string/array/
 *     tuple helpers) — the RV64-only PMM/virtio-blk/virtio-input/virtio-gpu
 *     drivers and the `.incbin "build/os/fat32-riscv64.img"` FAT32 image
 *     embed (RV64 original's tail, ~3000 lines) are out of scope for this
 *     boot-entry-only milestone (no FS, no virtio devices touched yet) and
 *     reference RV64-specific QEMU `virt` MMIO addresses that do not apply
 *     to the aarch64 `virt` machine's device layout. Port them here if/when
 *     an aarch64 SimpleOS milestone actually needs them.
 */

typedef long long spl_i64;
typedef unsigned long long spl_u64;
typedef unsigned int spl_u32;
typedef unsigned short spl_u16;
typedef unsigned char spl_u8;

#define RT_VALUE_TAG_MASK 0x7ULL
#define RT_VALUE_TAG_INT 0x0ULL
#define RT_VALUE_TAG_HEAP 0x1ULL
#define RT_VALUE_TAG_SPECIAL 0x3ULL
#define RT_VALUE_SPECIAL_NIL 0x0ULL
#define RT_VALUE_SPECIAL_TRUE 0x1ULL
#define RT_VALUE_SPECIAL_FALSE 0x2ULL
#define RT_HEAP_STRING 0x01U
#define RT_HEAP_ARRAY 0x02U
#define RT_HEAP_TUPLE 0x04U
#define RT_HEAP_ENUM 0x07U

typedef struct RtHeapHeader {
    spl_u8 object_type;
    spl_u8 gc_flags;
    unsigned short reserved;
    spl_u32 size;
} RtHeapHeader;

typedef struct RtString {
    RtHeapHeader header;
    spl_u64 len;
    spl_u64 hash;
    char data[];
} RtString;

typedef struct RtArray {
    RtHeapHeader header;
    spl_u64 len;
    spl_u64 capacity;
    spl_i64 *data;
} RtArray;

typedef struct RtTuple {
    RtHeapHeader header;
    spl_u64 len;
    spl_i64 data[];
} RtTuple;

typedef struct RtEnum {
    RtHeapHeader header;
    spl_u32 enum_id;
    spl_u32 discriminant;
    spl_i64 payload;
} RtEnum;

/* No custom _start entry stub here — see file header. Limine jumps directly
 * to kernel_main with the stack already set up. */

static spl_u64 g_freestanding_heap_next = 0x41000000ULL;
/* QEMU aarch64 `virt` machine RAM base is 0x40000000 (vs RV64 `virt`'s
 * 0x80000000). The kernel itself loads at phys 0x40100000 (see
 * linker_limine.ld); this bump heap starts at 0x41000000 (16 MiB past RAM
 * base, well clear of the kernel image) and is capped at 0x48000000
 * (0x40000000 + 128 MiB), matching the QEMU invocation's `-m 128M` (or
 * larger) used by the validated probe-kernel boot — see
 * doc/08_tracking/bug/aarch64_real_firmware_boot_gap_and_seed_defects_2026-07-14.md. */
static spl_u64 g_freestanding_heap_limit = 0x48000000ULL;

static spl_u64 rt_align8(spl_u64 value) {
    return (value + 7ULL) & ~7ULL;
}

void *rt_alloc(spl_i64 size) {
    spl_u64 next;
    spl_u64 bytes;
    void *boot_alloc;
    if (size <= 0) {
        return (void *)0;
    }
    /* Bypass the riscv_noalloc_heap allocator: its pool is too small / overlaps
     * for repeated multi-KB sector buffers, corrupting later reads. The bump
     * heap (g_freestanding_heap_next..limit, enlarged) is correct for the
     * self-contained shell ls test. (ponytail: noalloc restored when its pool
     * is sized for FS-sector churn.) */
    bytes = rt_align8((spl_u64)size);
    next = rt_align8(g_freestanding_heap_next);
    if (next + bytes > g_freestanding_heap_limit) {
        return (void *)0;
    }
    g_freestanding_heap_next = next + bytes;
    return (void *)next;
}

void rt_free(void *ptr) {
    (void)ptr;
}

spl_i64 rt_pool_safepoint(void) {
    return 0;
}

void *rt_memcpy(void *dst, const void *src, spl_i64 n) {
    unsigned char *d = (unsigned char *)dst;
    const unsigned char *s = (const unsigned char *)src;
    if (n <= 0) {
        return dst;
    }
    for (spl_i64 i = 0; i < n; i = i + 1) {
        d[i] = s[i];
    }
    return dst;
}

void *rt_memset(void *dst, signed char val, spl_i64 n) {
    unsigned char *d = (unsigned char *)dst;
    if (n <= 0) {
        return dst;
    }
    for (spl_i64 i = 0; i < n; i = i + 1) {
        d[i] = (unsigned char)val;
    }
    return dst;
}

static spl_i64 rt_special(spl_u64 payload) {
    return (spl_i64)((payload << 3) | RT_VALUE_TAG_SPECIAL);
}

static spl_i64 rt_int(spl_i64 value) {
    return value << 3;
}

static spl_i64 rt_nil(void) {
    return rt_special(RT_VALUE_SPECIAL_NIL);
}

static spl_i64 rt_heap(void *ptr) {
    if (!ptr) {
        return rt_nil();
    }
    return (spl_i64)(((spl_u64)ptr) | RT_VALUE_TAG_HEAP);
}

spl_i64 rt_array_new(spl_i64 capacity_value);
spl_i64 rt_array_push(spl_i64 array_value, spl_i64 value);

static RtHeapHeader *rt_as_heap(spl_i64 value, spl_u8 kind) {
    spl_u64 raw = (spl_u64)value;
    RtHeapHeader *header;
    if ((raw & RT_VALUE_TAG_MASK) != RT_VALUE_TAG_HEAP) {
        return (RtHeapHeader *)0;
    }
    header = (RtHeapHeader *)(raw & ~RT_VALUE_TAG_MASK);
    if (!header || header->object_type != kind) {
        return (RtHeapHeader *)0;
    }
    return header;
}

static RtString *rt_as_string(spl_i64 value) {
    return (RtString *)rt_as_heap(value, RT_HEAP_STRING);
}

static RtArray *rt_as_array(spl_i64 value) {
    return (RtArray *)rt_as_heap(value, RT_HEAP_ARRAY);
}

static RtTuple *rt_as_tuple(spl_i64 value) {
    return (RtTuple *)rt_as_heap(value, RT_HEAP_TUPLE);
}

static RtEnum *rt_as_enum(spl_i64 value) {
    return (RtEnum *)rt_as_heap(value, RT_HEAP_ENUM);
}

static spl_i64 rt_index_arg(spl_i64 value) {
    if ((((spl_u64)value) & RT_VALUE_TAG_MASK) == RT_VALUE_TAG_INT) {
        return value >> 3;
    }
    return value;
}

static void rt_write_decimal(char *buf, spl_u64 *len, spl_u64 value) {
    char tmp[20];
    spl_u64 count = 0;
    if (value == 0) {
        buf[0] = '0';
        *len = 1;
        return;
    }
    while (value > 0) {
        tmp[count] = (char)('0' + (value % 10));
        value = value / 10;
        count = count + 1;
    }
    *len = count;
    for (spl_u64 i = 0; i < count; i = i + 1) {
        buf[i] = tmp[count - 1 - i];
    }
}

spl_i64 rt_string_new(spl_i64 bytes_value, spl_i64 len_value) {
    const spl_u8 *bytes = (const spl_u8 *)(spl_u64)bytes_value;
    spl_u64 len = len_value < 0 ? 0 : (spl_u64)len_value;
    RtString *out = (RtString *)rt_alloc((spl_i64)(sizeof(RtString) + len + 1));
    if (!out) {
        return rt_nil();
    }
    out->header.object_type = RT_HEAP_STRING;
    out->header.gc_flags = 0;
    out->header.reserved = 0;
    out->header.size = (spl_u32)(sizeof(RtString) + len);
    out->len = len;
    out->hash = 0;
    for (spl_u64 i = 0; i < len; i = i + 1) {
        out->data[i] = bytes ? (char)bytes[i] : 0;
    }
    out->data[len] = 0;
    return rt_heap(out);
}

spl_i64 rt_raw_u64_to_string(spl_i64 raw) {
    char buf[20];
    spl_u64 len = 0;
    rt_write_decimal(buf, &len, (spl_u64)raw);
    return rt_string_new((spl_i64)(spl_u64)buf, (spl_i64)len);
}

/* rt_raw_i64_to_string — freestanding mirror of the same function in
 * src/runtime/runtime_native.c:3228. That one uses snprintf("%lld"); there is
 * no libc here, so the sign is handled explicitly. INT64_MIN cannot be negated
 * in two's complement, so the magnitude is taken in unsigned space
 * (0 - (spl_u64)raw), which is exact for every input including INT64_MIN.
 * Needed by limine_aarch64_boot_main()'s `{...}` interpolation of raw i64
 * values (found by a real ld.lld undefined-symbol error, not speculation). */
spl_i64 rt_raw_i64_to_string(spl_i64 raw) {
    char buf[21];
    spl_u64 len = 0;
    if (raw < 0) {
        buf[0] = '-';
        rt_write_decimal(buf + 1, &len, (spl_u64)0 - (spl_u64)raw);
        return rt_string_new((spl_i64)(spl_u64)buf, (spl_i64)(len + 1));
    }
    rt_write_decimal(buf, &len, (spl_u64)raw);
    return rt_string_new((spl_i64)(spl_u64)buf, (spl_i64)len);
}

spl_i64 rt_to_string(spl_i64 value) {
    char buf[21];
    spl_u64 len = 0;
    spl_i64 signed_value;
    if (rt_as_string(value)) {
        return value;
    }
    if ((((spl_u64)value) & RT_VALUE_TAG_MASK) == RT_VALUE_TAG_INT) {
        signed_value = value >> 3;
        if (signed_value < 0) {
            buf[0] = '-';
            rt_write_decimal(buf + 1, &len, (spl_u64)(-signed_value));
            return rt_string_new((spl_i64)(spl_u64)buf, (spl_i64)(len + 1));
        }
        rt_write_decimal(buf, &len, (spl_u64)signed_value);
        return rt_string_new((spl_i64)(spl_u64)buf, (spl_i64)len);
    }
    if (value == rt_special(RT_VALUE_SPECIAL_TRUE)) {
        return rt_string_new((spl_i64)(spl_u64)"true", 4);
    }
    if (value == rt_special(RT_VALUE_SPECIAL_FALSE)) {
        return rt_string_new((spl_i64)(spl_u64)"false", 5);
    }
    if (value == rt_nil()) {
        return rt_string_new((spl_i64)(spl_u64)"nil", 3);
    }
    return rt_string_new((spl_i64)(spl_u64)"<value>", 7);
}

spl_i64 rt_value_to_string(spl_i64 value) {
    return rt_to_string(value);
}

spl_i64 rt_string_concat(spl_i64 left, spl_i64 right) {
    RtString *a;
    RtString *b;
    RtString *out;
    spl_i64 left_text = rt_to_string(left);
    spl_i64 right_text = rt_to_string(right);
    a = rt_as_string(left_text);
    b = rt_as_string(right_text);
    if (!a || !b) {
        return rt_nil();
    }
    out = (RtString *)rt_alloc((spl_i64)(sizeof(RtString) + a->len + b->len + 1));
    if (!out) {
        return rt_nil();
    }
    out->header.object_type = RT_HEAP_STRING;
    out->header.gc_flags = 0;
    out->header.reserved = 0;
    out->header.size = (spl_u32)(sizeof(RtString) + a->len + b->len);
    out->len = a->len + b->len;
    out->hash = 0;
    for (spl_u64 i = 0; i < a->len; i = i + 1) {
        out->data[i] = a->data[i];
    }
    for (spl_u64 i = 0; i < b->len; i = i + 1) {
        out->data[a->len + i] = b->data[i];
    }
    out->data[out->len] = 0;
    return rt_heap(out);
}

spl_i64 rt_string_bytes(spl_i64 value) {
    RtString *s = rt_as_string(value);
    spl_i64 out = rt_array_new(s ? (spl_i64)s->len : 0);
    if (!s) {
        return out;
    }
    for (spl_u64 i = 0; i < s->len; i = i + 1) {
        rt_array_push(out, rt_int((spl_i64)(spl_u8)s->data[i]));
    }
    return out;
}

spl_i64 rt_string_chars(spl_i64 value) {
    RtString *s = rt_as_string(value);
    spl_i64 out = rt_array_new(s ? (spl_i64)s->len : 0);
    if (!s) {
        return out;
    }
    for (spl_u64 i = 0; i < s->len;) {
        spl_u8 lead = (spl_u8)s->data[i];
        spl_u64 width = 1;
        if (lead >= 0xC2 && lead <= 0xDF && i + 2 <= s->len) width = 2;
        else if (lead >= 0xE0 && lead <= 0xEF && i + 3 <= s->len) width = 3;
        else if (lead >= 0xF0 && lead <= 0xF4 && i + 4 <= s->len) width = 4;
        rt_array_push(out, rt_string_new((spl_i64)(spl_u64)(s->data + i), (spl_i64)width));
        i += width;
    }
    return out;
}

typedef struct RtStringBuilder {
    spl_u64 len;
    spl_u64 capacity;
    char *data;
} RtStringBuilder;

spl_i64 rt_string_builder_new(void) {
    RtStringBuilder *builder = (RtStringBuilder *)rt_alloc((spl_i64)sizeof(RtStringBuilder));
    if (!builder) {
        return 0;
    }
    builder->len = 0;
    builder->capacity = 0;
    builder->data = (char *)0;
    return (spl_i64)(spl_u64)builder;
}

spl_i64 rt_string_builder_push(spl_i64 handle, spl_i64 value) {
    RtStringBuilder *builder = (RtStringBuilder *)(spl_u64)handle;
    RtString *s = rt_as_string(value);
    spl_u64 required;
    char *new_data;
    spl_u64 new_capacity;
    if (!builder || !s) {
        return 0;
    }
    if (s->len == 0) {
        return 1;
    }
    required = builder->len + s->len;
    if (required > builder->capacity) {
        new_capacity = builder->capacity == 0 ? 32 : builder->capacity;
        while (new_capacity < required) {
            new_capacity = new_capacity * 2;
        }
        new_data = (char *)rt_alloc((spl_i64)(new_capacity + 1));
        if (!new_data) {
            return 0;
        }
        for (spl_u64 i = 0; i < builder->len; i = i + 1) {
            new_data[i] = builder->data ? builder->data[i] : 0;
        }
        builder->data = new_data;
        builder->capacity = new_capacity;
    }
    for (spl_u64 i = 0; i < s->len; i = i + 1) {
        builder->data[builder->len + i] = s->data[i];
    }
    builder->len = required;
    builder->data[builder->len] = 0;
    return 1;
}

spl_i64 rt_string_builder_finish(spl_i64 handle) {
    RtStringBuilder *builder = (RtStringBuilder *)(spl_u64)handle;
    if (!builder || !builder->data) {
        return rt_string_new((spl_i64)(spl_u64)"", 0);
    }
    return rt_string_new((spl_i64)(spl_u64)builder->data, (spl_i64)builder->len);
}

spl_i64 rt_string_builder_len(spl_i64 handle) {
    RtStringBuilder *builder = (RtStringBuilder *)(spl_u64)handle;
    return builder ? (spl_i64)builder->len : -1;
}

void rt_string_builder_free(spl_i64 handle) {
    (void)handle;
}

spl_i64 rt_hash_text(spl_i64 value) {
    RtString *s = rt_as_string(value);
    spl_u64 hash = 1469598103934665603ULL;
    if (!s) {
        return 0;
    }
    for (spl_u64 i = 0; i < s->len; i = i + 1) {
        hash ^= (spl_u64)(spl_u8)s->data[i];
        hash *= 1099511628211ULL;
    }
    return (spl_i64)hash;
}

/* Forward declarations: the PL011 writers are defined further down this file,
 * below the print family that now uses them. */
static void uart_write_bytes(const char *data, spl_u64 len);
static void uart_put_byte(spl_u8 byte);

/* REAL, as of Route A step 3 (2026-08-24). These four were `(void)value;`
 * no-ops, which this design doc already flagged as an erratum and then left
 * alone. Leaving them alone is what made the first in-guest MCP round trip
 * fail in a genuinely confusing way: the server READ the request correctly,
 * dispatched it, built the response, called mcp_write_message() -> print ->
 * rt_println_str... and the bytes went into a no-op. The serve loop then read
 * again, got EOF, and exited 0 — a transcript indistinguishable from "the
 * request never arrived". Three separate hypotheses (pacing, heap, framing)
 * were tested and eliminated before this one.
 *
 * ABI note, taken from the host rather than guessed: rt_print_str takes a RAW
 * (ptr, len) pair — `void rt_print_str(const uint8_t*, uint64_t)`
 * (src/runtime/runtime_native.c) — NOT a tagged value like print_raw's
 * argument. Reading it as a tagged value would decode a pointer as an integer
 * and print nothing or garbage.
 *
 * `\n` only, matching the host's rt_println_str exactly, because this stream
 * is a JSONL protocol channel and not just a console: the marker helpers in
 * this file use `\r\n`, and adding a stray CR here would put a carriage
 * return inside a JSON-RPC frame. stdout and stderr are the same PL011 in this
 * lane, which is a real property of the guest, not a shortcut. */
void rt_print_str(spl_i64 value, spl_i64 len) {
    const char *p = (const char *)(spl_u64)value;
    if (!p || len <= 0) {
        return;
    }
    uart_write_bytes(p, (spl_u64)len);
}

void rt_println_str(spl_i64 value, spl_i64 len) {
    rt_print_str(value, len);
    uart_put_byte((spl_u8)'\n');
}

void rt_eprint_str(spl_i64 value, spl_i64 len) {
    rt_print_str(value, len);
}

void rt_eprintln_str(spl_i64 value, spl_i64 len) {
    rt_println_str(value, len);
}

/* REAL as of Route A step 3 (2026-08-24), and THIS is the pair that actually
 * carries the MCP response.
 *
 * How this was found, because the symptom pointed everywhere else: a Simple
 * `print_raw(x)` call does NOT lower to the C symbol `print_raw`. Codegen
 * lowers it to rt_string_new_literal(ptr,len) followed by **rt_print_value**.
 * Disassembly of app__mcp__main__mcp_serve_entry shows exactly that — a blr to
 * 0x...80100ed0 (rt_print_value), while print_raw sits unused at 0x...801030a0.
 * So every Simple-level print in the MCP server was landing in a `(void)value;`
 * no-op, including mcp_write_message()'s response write
 * (src/app/mcp/main_transport.spl:15).
 *
 * The symptom was badly misleading: the server read the request correctly,
 * dispatched it, built the response, wrote it into the void, looped, hit EOF
 * and exit(0) — a transcript identical to "the request never arrived". Pacing,
 * heap exhaustion and JSON framing were each tested and eliminated first; the
 * P9 STDOUT-PROBE's green result actively misled, because that probe calls
 * print_raw from C, which is the one path that never goes through here.
 *
 * Body mirrors print_raw's: take the tagged value, render non-strings via
 * rt_to_string, write the bytes to PL011. stdout and stderr are the same UART
 * in this lane. `\n` only for the println forms — this is a JSONL protocol
 * channel, so a stray CR would sit inside a JSON-RPC frame. */
static void rt_write_value_to_uart(spl_i64 value) {
    RtString *text = rt_as_string(value);
    spl_i64 rendered;
    if (!text) {
        rendered = rt_to_string(value);
        text = rt_as_string(rendered);
    }
    if (text) {
        uart_write_bytes(text->data, text->len);
    }
}

void rt_print_value(spl_i64 value) {
    rt_write_value_to_uart(value);
}

void rt_println_value(spl_i64 value) {
    rt_write_value_to_uart(value);
    uart_put_byte((spl_u8)'\n');
}

void rt_eprint_value(spl_i64 value) {
    rt_write_value_to_uart(value);
}

void rt_eprintln_value(spl_i64 value) {
    rt_write_value_to_uart(value);
    uart_put_byte((spl_u8)'\n');
}

spl_i64 rt_interp_call(spl_i64 a, spl_i64 b, spl_i64 c, spl_i64 d, spl_i64 e, spl_i64 f, spl_i64 g, spl_i64 h) {
    (void)a;
    (void)b;
    (void)c;
    (void)d;
    (void)e;
    (void)f;
    (void)g;
    (void)h;
    return rt_nil();
}

spl_i64 rt_function_not_found(spl_i64 name_ptr, spl_i64 name_len) {
    (void)name_ptr;
    (void)name_len;
    return rt_nil();
}

double rt_math_pow(double base, double exponent) {
    spl_i64 n = (spl_i64)exponent;
    double out = 1.0;
    if (exponent < 0.0 || (double)n != exponent) {
        return 0.0;
    }
    for (spl_i64 i = 0; i < n; i = i + 1) {
        out = out * base;
    }
    return out;
}

spl_i64 rt_len(spl_i64 value) {
    RtString *s = rt_as_string(value);
    RtArray *a;
    RtTuple *t;
    if (s) {
        return (spl_i64)s->len;
    }
    a = rt_as_array(value);
    if (a) {
        return (spl_i64)a->len;
    }
    t = rt_as_tuple(value);
    if (t) {
        return (spl_i64)t->len;
    }
    return 0;
}

spl_i64 rt_array_new(spl_i64 capacity_value) {
    spl_u64 capacity = capacity_value <= 4 ? 4 : (spl_u64)capacity_value;
    RtArray *array = (RtArray *)rt_alloc((spl_i64)sizeof(RtArray));
    if (!array) {
        return rt_nil();
    }
    array->data = (spl_i64 *)rt_alloc((spl_i64)(capacity * sizeof(spl_i64)));
    if (!array->data) {
        return rt_nil();
    }
    array->header.object_type = RT_HEAP_ARRAY;
    array->header.gc_flags = 0;
    array->header.reserved = 0;
    array->header.size = (spl_u32)sizeof(RtArray);
    array->len = 0;
    array->capacity = capacity;
    for (spl_u64 i = 0; i < capacity; i = i + 1) {
        array->data[i] = rt_nil();
    }
    return rt_heap(array);
}

spl_i64 rt_array_len(spl_i64 array_value) {
    RtArray *array = rt_as_array(array_value);
    return array ? (spl_i64)array->len : -1;
}

spl_i64 rt_array_get(spl_i64 collection, spl_i64 index_value) {
    RtArray *array = rt_as_array(collection);
    spl_i64 index = rt_index_arg(index_value);
    if (!array) {
        return rt_nil();
    }
    if (index < 0) {
        index = (spl_i64)array->len + index;
    }
    if (index < 0 || (spl_u64)index >= array->len) {
        return rt_nil();
    }
    return array->data[index];
}

spl_i64 rt_array_get_text(spl_i64 collection, spl_i64 index_value) {
    return rt_array_get(collection, index_value);
}

spl_i64 rt_array_new_with_cap_u64(spl_i64 capacity_value) {
    return rt_array_new(capacity_value);
}

spl_i64 rt_array_push(spl_i64 array_value, spl_i64 value) {
    RtArray *array = rt_as_array(array_value);
    spl_i64 *new_data;
    spl_u64 new_capacity;
    if (!array) {
        return 0;
    }
    if (array->len >= array->capacity) {
        new_capacity = array->capacity < 4 ? 4 : array->capacity * 2;
        new_data = (spl_i64 *)rt_alloc((spl_i64)(new_capacity * sizeof(spl_i64)));
        if (!new_data) {
            return 0;
        }
        for (spl_u64 i = 0; i < array->len; i = i + 1) {
            new_data[i] = array->data[i];
        }
        for (spl_u64 i = array->len; i < new_capacity; i = i + 1) {
            new_data[i] = rt_nil();
        }
        array->data = new_data;
        array->capacity = new_capacity;
    }
    array->data[array->len] = value;
    array->len = array->len + 1;
    return 1;
}

spl_i64 rt_array_concat(spl_i64 left_value, spl_i64 right_value) {
    RtArray *left = rt_as_array(left_value);
    RtArray *right = rt_as_array(right_value);
    spl_u64 left_len = left ? left->len : 0ULL;
    spl_u64 right_len = right ? right->len : 0ULL;
    spl_i64 out = rt_array_new((spl_i64)(left_len + right_len));
    if (!rt_as_array(out)) {
        return rt_nil();
    }
    for (spl_u64 i = 0; i < left_len; i = i + 1) {
        rt_array_push(out, left->data[i]);
    }
    for (spl_u64 i = 0; i < right_len; i = i + 1) {
        rt_array_push(out, right->data[i]);
    }
    return out;
}

spl_i64 rt_index_get(spl_i64 collection, spl_i64 index_value) {
    RtArray *array = rt_as_array(collection);
    RtTuple *tuple;
    RtString *string;
    spl_i64 index = rt_index_arg(index_value);
    if (array) {
        if (index < 0) {
            index = (spl_i64)array->len + index;
        }
        if (index < 0 || (spl_u64)index >= array->len) {
            return rt_nil();
        }
        return array->data[index];
    }
    tuple = rt_as_tuple(collection);
    if (tuple) {
        if (index < 0) {
            index = (spl_i64)tuple->len + index;
        }
        if (index < 0 || (spl_u64)index >= tuple->len) {
            return rt_nil();
        }
        return tuple->data[index];
    }
    string = rt_as_string(collection);
    if (string) {
        if (index < 0) {
            index = (spl_i64)string->len + index;
        }
        if (index < 0 || (spl_u64)index >= string->len) {
            return rt_nil();
        }
        return rt_string_new((spl_i64)(spl_u64)&string->data[index], 1);
    }
    return rt_nil();
}

spl_i64 rt_index_set(spl_i64 collection, spl_i64 index_value, spl_i64 value) {
    RtArray *array = rt_as_array(collection);
    spl_i64 index = rt_index_arg(index_value);
    if (!array) {
        return 0;
    }
    if (index < 0) {
        index = (spl_i64)array->len + index;
    }
    if (index < 0 || (spl_u64)index >= array->len) {
        return 0;
    }
    array->data[index] = value;
    return 1;
}

spl_i64 rt_typed_words_u64_set(spl_i64 collection, spl_i64 index_value, spl_i64 value) {
    return rt_index_set(collection, index_value, value);
}

spl_i64 rt_typed_bytes_u8_push(spl_i64 collection, spl_i64 value) {
    return rt_array_push(collection, rt_int(value & 0xffLL));
}

spl_i64 rt_push_byte(spl_i64 collection, spl_i64 value) {
    rt_array_push(collection, rt_int(value & 0xffLL));
    return collection;
}

spl_i64 rt_typed_words_u32_push(spl_i64 collection, spl_i64 value) {
    return rt_array_push(collection, value & 0xffffffffLL);
}

spl_i64 rt_typed_words_u32_set(spl_i64 collection, spl_i64 index_value, spl_i64 value) {
    return rt_index_set(collection, index_value, value & 0xffffffffLL);
}

spl_i64 rt_typed_words_u64_push(spl_i64 collection, spl_i64 value) {
    return rt_array_push(collection, value);
}

spl_i64 rt_array_data_ptr(spl_i64 collection) {
    RtArray *array = rt_as_array(collection);
    if (!array || !array->data) {
        return 0;
    }
    return (spl_i64)(spl_u64)array->data;
}

spl_i64 rt_array_data_ptr_text(spl_i64 collection) {
    return rt_array_data_ptr(collection);
}

spl_i64 rt_array_set_len_known_text(spl_i64 collection, spl_i64 len_value) {
    RtArray *array = rt_as_array(collection);
    spl_i64 len = rt_index_arg(len_value);
    if (!array || len < 0 || (spl_u64)len > array->capacity) {
        return 0;
    }
    array->len = (spl_u64)len;
    return 1;
}

spl_i64 rt_array_set_text(spl_i64 collection, spl_i64 index_value, spl_i64 value) {
    return rt_index_set(collection, index_value, value);
}

spl_i64 rt_slice(spl_i64 value, spl_i64 start_value, spl_i64 end_value, spl_i64 step_value) {
    RtString *string = rt_as_string(value);
    spl_i64 start = rt_index_arg(start_value);
    spl_i64 end = rt_index_arg(end_value);
    spl_i64 step = rt_index_arg(step_value);
    if (!string) {
        return rt_nil();
    }
    if (step == 0) {
        step = 1;
    }
    if (start < 0) {
        start = (spl_i64)string->len + start;
    }
    if (end < 0) {
        end = (spl_i64)string->len + end;
    }
    if (start < 0) {
        start = 0;
    }
    if (end < start) {
        end = start;
    }
    if ((spl_u64)end > string->len) {
        end = (spl_i64)string->len;
    }
    if (step != 1) {
        return rt_string_new((spl_i64)(spl_u64)"", 0);
    }
    return rt_string_new((spl_i64)(spl_u64)&string->data[start], end - start);
}

spl_i64 rt_array_repeat(spl_i64 value, spl_i64 count_value) {
    spl_i64 count = rt_index_arg(count_value);
    spl_i64 array;
    if (count <= 0) {
        return rt_array_new(0);
    }
    array = rt_array_new(count);
    for (spl_i64 i = 0; i < count; i = i + 1) {
        rt_array_push(array, value);
    }
    return array;
}

spl_i64 rt_tuple_new(spl_i64 len_value) {
    spl_u64 len = len_value < 0 ? 0 : (spl_u64)len_value;
    RtTuple *tuple = (RtTuple *)rt_alloc((spl_i64)(sizeof(RtTuple) + len * sizeof(spl_i64)));
    if (!tuple) {
        return rt_nil();
    }
    tuple->header.object_type = RT_HEAP_TUPLE;
    tuple->header.gc_flags = 0;
    tuple->header.reserved = 0;
    tuple->header.size = (spl_u32)(sizeof(RtTuple) + len * sizeof(spl_i64));
    tuple->len = len;
    for (spl_u64 i = 0; i < len; i = i + 1) {
        tuple->data[i] = rt_nil();
    }
    return rt_heap(tuple);
}

spl_i64 rt_tuple_get(spl_i64 tuple_value, spl_i64 index_value) {
    RtTuple *tuple = rt_as_tuple(tuple_value);
    spl_i64 index = rt_index_arg(index_value);
    if (!tuple || index < 0 || (spl_u64)index >= tuple->len) {
        return rt_nil();
    }
    return tuple->data[index];
}

spl_i64 rt_tuple_set(spl_i64 tuple_value, spl_i64 index_value, spl_i64 value) {
    RtTuple *tuple = rt_as_tuple(tuple_value);
    spl_i64 index = rt_index_arg(index_value);
    if (!tuple || index < 0 || (spl_u64)index >= tuple->len) {
        return 0;
    }
    tuple->data[index] = value;
    return 1;
}

spl_i64 rt_enum_new(spl_u32 enum_id, spl_u32 discriminant, spl_i64 payload) {
    RtEnum *value = (RtEnum *)rt_alloc((spl_i64)sizeof(RtEnum));
    if (!value) {
        return rt_nil();
    }
    value->header.object_type = RT_HEAP_ENUM;
    value->header.gc_flags = 0;
    value->header.reserved = 0;
    value->header.size = (spl_u32)sizeof(RtEnum);
    value->enum_id = enum_id;
    value->discriminant = discriminant;
    value->payload = payload;
    return rt_heap(value);
}

spl_i64 rt_enum_payload(spl_i64 value) {
    RtEnum *enum_value = rt_as_enum(value);
    return enum_value ? enum_value->payload : rt_nil();
}

spl_i64 rt_enum_check_discriminant(spl_i64 value, spl_i64 expected) {
    RtEnum *enum_value = rt_as_enum(value);
    return enum_value && enum_value->discriminant == (spl_u32)expected ? 1 : 0;
}

spl_i64 common__config_env__ConfigEnv_dot_len(spl_i64 value) {
    (void)value;
    return 0;
}

/* Bug (2026-08-11): freestanding `text == ""` / `!= ""` against a RAW literal.
 *
 * A `.trim()` / `.lower()` result on this lane is a tagged heap string, but a
 * bare `""` literal is emitted as a RAW, untagged char* global
 * (emit_bootstrap_str_const), for which rt_as_string() returns NULL. The
 * `!a || !b` guard below therefore answered NOT EQUAL unconditionally for
 * every heap-vs-literal text comparison, so `x != ""` was TRUE even when x was
 * genuinely empty -- while `{x}` interpolated as empty and `.len() == 0` still
 * worked. Observed live on an x86_64 OVMF SimpleOS boot as
 *   [backend-resolve] override  rejected: Unknown backend:
 * (note the double space). Same defect as the baremetal_stubs.c lanes; this is
 * hosted bug #148 (fixed there by rt_text_eq_any's tagged-or-raw normalization
 * in runtime_native.c) never having been ported to the freestanding lanes.
 *
 * rt_string_char_code_at just below already uses exactly this raw-buffer
 * fallback idiom, so the shape is the established one for this file.
 *
 * Conservative by construction: the raw side is only ever interpreted as a
 * char* when the OTHER side is a proven RtString, so a non-text word is never
 * dereferenced in a non-text comparison (cf.
 * doc/08_tracking/bug/native_text_eq_any_untagged_smallint_deref_2026-07-23.md),
 * and a plausibility floor rejects small words. The scan is bounded by the
 * decoded string's length and demands a NUL exactly at that offset.
 *
 * Selfcheck: src/runtime/test/rt_native_eq_heap_vs_raw_empty_literal_selfcheck.c
 */
static spl_i64 rt_text_eq_str_vs_raw(RtString *s, spl_i64 raw) {
    const spl_u8 *p;
    spl_u64 i;
    if ((spl_u64)raw < 0x10000u) return 0;   /* nil / bool / small int */
    p = (const spl_u8 *)(spl_u64)raw;
    for (i = 0; i < s->len; i = i + 1) {
        if (p[i] == 0 || p[i] != (spl_u8)s->data[i]) return 0;
    }
    return p[s->len] == 0 ? 1 : 0;
}

spl_i64 rt_native_eq(spl_i64 lhs, spl_i64 rhs) {
    RtString *a = rt_as_string(lhs);
    RtString *b = rt_as_string(rhs);
    if (a || b) {
        if (!a && b) {
            return rt_text_eq_str_vs_raw(b, lhs);
        }
        if (a && !b) {
            return rt_text_eq_str_vs_raw(a, rhs);
        }
        if (a->len != b->len) {
            return 0;
        }
        for (spl_u64 i = 0; i < a->len; i = i + 1) {
            if (a->data[i] != b->data[i]) {
                return 0;
            }
        }
        return 1;
    }
    return lhs == rhs ? 1 : 0;
}

spl_i64 rt_string_eq(spl_i64 lhs, spl_i64 rhs) {
    RtString *a = rt_as_string(lhs);
    RtString *b = rt_as_string(rhs);
    if (!a || !b || a->len != b->len) {
        return 0;
    }
    for (spl_u64 i = 0; i < a->len; i = i + 1) {
        if (a->data[i] != b->data[i]) {
            return 0;
        }
    }
    return 1;
}

spl_i64 rt_string_char_code_at(spl_i64 value, spl_i64 index_value) {
    RtString *string = rt_as_string(value);
    const spl_u8 *data;
    spl_u64 len;
    spl_i64 index = index_value;
    spl_u64 byte_index = 0;
    spl_u64 char_index = 0;
    if (index < 0) return 0;
    if (string) {
        data = (const spl_u8 *)string->data;
        len = string->len;
    } else {
        data = (const spl_u8 *)(spl_u64)value;
        if (!data) return 0;
        len = 0;
        while (data[len] != 0) len = len + 1;
    }
    while (byte_index < len) {
        spl_u8 b0 = data[byte_index];
        spl_u64 width = 1;
        spl_i64 code = (spl_i64)b0;
        if (b0 >= 194 && b0 <= 223 && byte_index + 1 < len) {
            width = 2;
            code = ((spl_i64)(b0 & 31) << 6) | (data[byte_index + 1] & 63);
        } else if (b0 >= 224 && b0 <= 239 && byte_index + 2 < len) {
            width = 3;
            code = ((spl_i64)(b0 & 15) << 12) | ((spl_i64)(data[byte_index + 1] & 63) << 6) | (data[byte_index + 2] & 63);
        } else if (b0 >= 240 && b0 <= 244 && byte_index + 3 < len) {
            width = 4;
            code = ((spl_i64)(b0 & 7) << 18) | ((spl_i64)(data[byte_index + 1] & 63) << 12) | ((spl_i64)(data[byte_index + 2] & 63) << 6) | (data[byte_index + 3] & 63);
        }
        if (char_index == (spl_u64)index) return code;
        byte_index = byte_index + width;
        char_index = char_index + 1;
    }
    return 0;
}

spl_i64 __simple_rt_string_char_code_at(spl_i64 value, spl_i64 index_value) {
    return rt_string_char_code_at(value, index_value);
}

/* Return the raw BYTE at BYTE index `index`, or 0 if out of range.
 *
 * Deliberately NOT rt_string_char_code_at: that one is CHARACTER-indexed and
 * the two disagree on any non-ASCII text ("café,".byte_at(3) is 195, the
 * 0xC3 lead byte, while char_code_at(3) is 233 for 'é'). Byte-framing callers
 * (e.g. dtb_parser.spl / fd_io.spl scanning raw bytes) index the raw UTF-8
 * buffer directly, so a character index would desync at the first
 * multi-byte codepoint. O(1): straight buffer read, no codepoint walk. */
spl_i64 rt_string_byte_at(spl_i64 value, spl_i64 index_value) {
    RtString *string = rt_as_string(value);
    const spl_u8 *data;
    spl_u64 len;
    spl_i64 index = index_value;
    if (index < 0) return 0;
    if (string) {
        data = (const spl_u8 *)string->data;
        len = string->len;
    } else {
        data = (const spl_u8 *)(spl_u64)value;
        if (!data) return 0;
        len = 0;
        while (data[len] != 0) len = len + 1;
    }
    if ((spl_u64)index >= len) return 0;
    return data[index];
}

spl_i64 __simple_rt_string_byte_at(spl_i64 value, spl_i64 index_value) {
    return rt_string_byte_at(value, index_value);
}

spl_i64 rt_string_starts_with(spl_i64 value, spl_i64 prefix_value) {
    RtString *string = rt_as_string(value);
    RtString *prefix = rt_as_string(prefix_value);
    if (!string || !prefix) {
        return 0;
    }
    if (prefix->len > string->len) {
        return 0;
    }
    for (spl_u64 i = 0; i < prefix->len; i = i + 1) {
        if (string->data[i] != prefix->data[i]) {
            return 0;
        }
    }
    return 1;
}

spl_i64 rt_string_find(spl_i64 value, spl_i64 needle_value) {
    RtString *string = rt_as_string(value);
    RtString *needle = rt_as_string(needle_value);
    if (!string || !needle) {
        return -1;
    }
    if (needle->len == 0) {
        return 0;
    }
    if (needle->len > string->len) {
        return -1;
    }
    for (spl_u64 i = 0; i + needle->len <= string->len; i = i + 1) {
        spl_u64 j = 0;
        while (j < needle->len && string->data[i + j] == needle->data[j]) {
            j = j + 1;
        }
        if (j == needle->len) {
            return (spl_i64)i;
        }
    }
    return -1;
}

spl_i64 rt_string_trim(spl_i64 value) {
    RtString *string = rt_as_string(value);
    spl_u64 start = 0;
    spl_u64 end;
    if (!string) {
        return rt_nil();
    }
    end = string->len;
    while (start < end) {
        spl_u8 ch = (spl_u8)string->data[start];
        if (ch == ' ' || ch == '\n' || ch == '\r' || ch == '\t') {
            start = start + 1;
        } else {
            break;
        }
    }
    while (end > start) {
        spl_u8 ch = (spl_u8)string->data[end - 1];
        if (ch == ' ' || ch == '\n' || ch == '\r' || ch == '\t') {
            end = end - 1;
        } else {
            break;
        }
    }
    return rt_string_new((spl_i64)(spl_u64)&string->data[start], (spl_i64)(end - start));
}

/* Mirrors src/runtime/simple_core/core_string.spl rt_string_to_int:
 * parse a base-10 integer from a string value, returning the raw i64 (0 on
 * non-string / empty). Freestanding: no libc strtoll, so parse inline. Honors
 * an optional leading '+'/'-' and stops at the first non-digit (strtoll-style).
 */
spl_i64 rt_string_to_int(spl_i64 value) {
    RtString *string = rt_as_string(value);
    if (!string || string->len == 0) {
        return 0;
    }
    spl_u64 i = 0;
    spl_i64 sign = 1;
    if (string->data[0] == '-') {
        sign = -1;
        i = 1;
    } else if (string->data[0] == '+') {
        i = 1;
    }
    spl_i64 acc = 0;
    while (i < string->len) {
        spl_u8 ch = (spl_u8)string->data[i];
        if (ch < '0' || ch > '9') {
            break;
        }
        acc = acc * 10 + (spl_i64)(ch - '0');
        i = i + 1;
    }
    return sign * acc;
}

/* Mirrors src/runtime/simple_core/core_string.spl rt_contains:
 * substring membership when both operands are strings, else array membership
 * via element-wise rt_native_eq. Returns raw 0/1 (matching rt_native_eq).
 */
spl_i64 rt_contains(spl_i64 collection, spl_i64 value) {
    RtString *text = rt_as_string(collection);
    RtString *needle = rt_as_string(value);
    if (text && needle) {
        return rt_string_find(collection, value) >= 0 ? 1 : 0;
    }
    RtArray *array = rt_as_array(collection);
    if (array) {
        spl_i64 len = rt_array_len(collection);
        for (spl_i64 i = 0; i < len; i = i + 1) {
            if (rt_native_eq(rt_array_get(collection, rt_int(i)), value) > 0) {
                return 1;
            }
        }
    }
    return 0;
}

spl_i64 rt_string_ends_with(spl_i64 value, spl_i64 suffix_value) {
    RtString *string = rt_as_string(value);
    RtString *suffix = rt_as_string(suffix_value);
    if (!string || !suffix) {
        return 0;
    }
    if (suffix->len > string->len) {
        return 0;
    }
    for (spl_u64 i = 0; i < suffix->len; i = i + 1) {
        if (string->data[string->len - suffix->len + i] != suffix->data[i]) {
            return 0;
        }
    }
    return 1;
}

spl_i64 rt_string_split(spl_i64 value, spl_i64 sep_value) {
    RtString *string = rt_as_string(value);
    RtString *sep = rt_as_string(sep_value);
    spl_i64 out = rt_array_new(4);
    spl_u64 start = 0;
    if (!string || !sep) {
        return out;
    }
    if (sep->len == 0) {
        rt_array_push(out, value);
        return out;
    }
    while (start <= string->len) {
        spl_u64 match_at = string->len;
        for (spl_u64 i = start; i + sep->len <= string->len; i = i + 1) {
            spl_i64 matched = 1;
            for (spl_u64 j = 0; j < sep->len; j = j + 1) {
                if (string->data[i + j] != sep->data[j]) {
                    matched = 0;
                    break;
                }
            }
            if (matched) {
                match_at = i;
                break;
            }
        }
        if (match_at == string->len) {
            rt_array_push(out, rt_string_new((spl_i64)(spl_u64)&string->data[start], (spl_i64)(string->len - start)));
            break;
        }
        rt_array_push(out, rt_string_new((spl_i64)(spl_u64)&string->data[start], (spl_i64)(match_at - start)));
        start = match_at + sep->len;
        if (start == string->len) {
            rt_array_push(out, rt_string_new((spl_i64)(spl_u64)"", 0));
            break;
        }
    }
    return out;
}

spl_i64 rt_string_from_byte_array(spl_i64 array_value) {
    RtArray *array = rt_as_array(array_value);
    RtString *out;
    if (!array) {
        return rt_string_new((spl_i64)(spl_u64)"", 0);
    }
    out = (RtString *)rt_alloc((spl_i64)(sizeof(RtString) + array->len + 1));
    if (!out) {
        return rt_nil();
    }
    out->header.object_type = RT_HEAP_STRING;
    out->header.gc_flags = 0;
    out->header.reserved = 0;
    out->header.size = (spl_u32)(sizeof(RtString) + array->len);
    out->len = array->len;
    out->hash = 0;
    for (spl_u64 i = 0; i < array->len; i = i + 1) {
        out->data[i] = (char)(rt_index_arg(array->data[i]) & 0xff);
    }
    out->data[array->len] = 0;
    return rt_heap(out);
}

spl_i64 rt_bytes_slice(spl_i64 array_value, spl_i64 start_value, spl_i64 len_value) {
    RtArray *array = rt_as_array(array_value);
    spl_i64 start = rt_index_arg(start_value);
    spl_i64 len = rt_index_arg(len_value);
    spl_i64 out;
    if (!array || len <= 0) {
        return rt_array_new(0);
    }
    if (start < 0) {
        start = (spl_i64)array->len + start;
    }
    if (start < 0) {
        start = 0;
    }
    if ((spl_u64)start >= array->len) {
        return rt_array_new(0);
    }
    if ((spl_u64)(start + len) > array->len) {
        len = (spl_i64)array->len - start;
    }
    out = rt_array_new(len);
    for (spl_i64 i = 0; i < len; i = i + 1) {
        rt_array_push(out, array->data[start + i]);
    }
    return out;
}

spl_i64 rt_bytes_u8_at(spl_i64 array_value, spl_i64 index_value) {
    RtArray *array = rt_as_array(array_value);
    spl_i64 index = rt_index_arg(index_value);
    if (!array) {
        return 0;
    }
    if (index < 0) {
        index = (spl_i64)array->len + index;
    }
    if (index < 0 || (spl_u64)index >= array->len) {
        return 0;
    }
    return rt_index_arg(array->data[index]) & 0xffLL;
}

spl_i64 rt_bytes_concat(spl_i64 left_value, spl_i64 right_value) {
    RtArray *left = rt_as_array(left_value);
    RtArray *right = rt_as_array(right_value);
    spl_i64 out;
    if (!left || !right) {
        return rt_array_new(0);
    }
    out = rt_array_new((spl_i64)(left->len + right->len));
    for (spl_u64 i = 0; i < left->len; i = i + 1) {
        rt_array_push(out, left->data[i]);
    }
    for (spl_u64 i = 0; i < right->len; i = i + 1) {
        rt_array_push(out, right->data[i]);
    }
    return out;
}

spl_i64 rt_for_iterable(spl_i64 collection) {
    return collection;
}

spl_i64 rt_native_neq(spl_i64 lhs, spl_i64 rhs) {
    return rt_native_eq(lhs, rhs) ? 0 : 1;
}

spl_i64 rt_any_add(spl_i64 lhs, spl_i64 rhs) {
    if (rt_as_string(lhs) || rt_as_string(rhs)) {
        return rt_string_concat(lhs, rhs);
    }
    return lhs + rhs;
}

spl_i64 rt_mmio_read_u8(spl_i64 addr) {
    return (spl_i64)(*(volatile unsigned char *)(spl_u64)addr);
}

spl_i64 rt_mmio_read_u16(spl_i64 addr) {
    return (spl_i64)(*(volatile unsigned short *)(spl_u64)addr);
}

spl_i64 rt_mmio_read_u32(spl_i64 addr) {
    return (spl_i64)(*(volatile unsigned int *)(spl_u64)addr);
}

spl_i64 rt_mmio_read_u64(spl_i64 addr) {
    return (spl_i64)(*(volatile spl_u64 *)(spl_u64)addr);
}

void rt_mmio_write_u8(spl_i64 addr, spl_i64 value) {
    *(volatile unsigned char *)(spl_u64)addr = (unsigned char)value;
}

void rt_mmio_write_u16(spl_i64 addr, spl_i64 value) {
    *(volatile unsigned short *)(spl_u64)addr = (unsigned short)value;
}

void rt_mmio_write_u32(spl_i64 addr, spl_i64 value) {
    *(volatile unsigned int *)(spl_u64)addr = (unsigned int)value;
}

void rt_mmio_write_u64(spl_i64 addr, spl_i64 value) {
    *(volatile spl_u64 *)(spl_u64)addr = (spl_u64)value;
}

/* Bridge aliases: arch-neutral kernel modules (VFS readdir, ssh_auth,
 * fs_exec_spawn) call the runtime_native.c API names, but this freestanding
 * runtime uses rt_mmio_* and rt_int/rt_index_arg internally. The value
 * tagging is identical (int = value << 3, tag in low 3 bits), so these are
 * direct bridges — no representation change. */
spl_i64 rt_value_int(spl_i64 value) {
    return value << 3;
}
spl_i64 rt_value_as_int(spl_i64 value) {
    return value >> 3;
}
spl_i64 rt_volatile_read_u8(spl_i64 addr) {
    return rt_mmio_read_u8(addr);
}
void rt_volatile_write_u8(spl_i64 addr, spl_i64 value) {
    rt_mmio_write_u8(addr, value);
}
/* rt_volatile_read/write_u16/u32/u64 and rt_load_barrier/rt_store_barrier:
 * completing the rt_volatile_* family declared in src/runtime/runtime.h and
 * implemented for the hosted build in
 * src/runtime/runtime_native.c:4874-4906 (int64_t addr/value ABI, matching
 * the `extern fn` declarations in src/lib/nogc_sync_mut/io/volatile_ops.spl).
 * Only the u8 pair existed here before; the riscv64 kernel closure's
 * os.kernel.boot.mmio_hardware module calls the u16/u32/u64 read/write and
 * io.volatile_ops calls load_barrier(), all of which linked as undefined
 * symbols until this fix. Bridged onto the existing rt_mmio_* primitives
 * above (same pattern as the u8 pair) rather than reimplementing the raw
 * volatile access, so there is exactly one MMIO access site per width.
 * rt_load_barrier/rt_store_barrier are declared in runtime.h but were never
 * implemented in EITHER runtime variant (hosted or freestanding) before this
 * fix; they are directional fences with no allocator/heap dependency, so are
 * safe to implement here as acquire/release barriers, matching the semantics
 * documented in io/volatile_ops.spl ("load_barrier() - acquire fence",
 * "store_barrier() - release fence"). */
spl_i64 rt_volatile_read_u16(spl_i64 addr) {
    return rt_mmio_read_u16(addr);
}
spl_i64 rt_volatile_read_u32(spl_i64 addr) {
    return rt_mmio_read_u32(addr);
}
spl_i64 rt_volatile_read_u64(spl_i64 addr) {
    return rt_mmio_read_u64(addr);
}
void rt_volatile_write_u16(spl_i64 addr, spl_i64 value) {
    rt_mmio_write_u16(addr, value);
}
void rt_volatile_write_u32(spl_i64 addr, spl_i64 value) {
    rt_mmio_write_u32(addr, value);
}
void rt_volatile_write_u64(spl_i64 addr, spl_i64 value) {
    rt_mmio_write_u64(addr, value);
}
void rt_load_barrier(void) {
    __atomic_thread_fence(__ATOMIC_ACQUIRE);
}
void rt_store_barrier(void) {
    __atomic_thread_fence(__ATOMIC_RELEASE);
}
/* unsafe_addr_of: identity cast, no allocator/heap dependency — mirrors the
 * hosted implementation exactly (src/runtime/runtime_native.c:4853,
 * `return (uint64_t)value;`). Surfaced as undefined once the rt_volatile
 * family / rt_load_barrier fixes above let the linker get further into this
 * closure. */
spl_u64 unsafe_addr_of(spl_i64 value) {
    return (spl_u64)value;
}

/* PL011 UART0 on QEMU aarch64 `virt` machine: DR (data register) at MMIO
 * base 0x09000000, offset 0x00. A raw store to DR is sufficient here — no
 * PL011 init (QEMU/EDK2 firmware leaves it enabled) and no FR/TXFF
 * busy-wait spin, matching the hand-written probe kernel that validated
 * this exact MMIO sequence booting through Limine on 2026-08-06 (see
 * doc/08_tracking/bug/aarch64_real_firmware_boot_gap_and_seed_defects_2026-07-14.md).
 * Add an FR&TXFF spin here if dropped characters are ever observed. */
#define PL011_UART0_BASE 0x09000000ULL
#define PL011_DR_OFFSET 0x00ULL

static void uart_put_byte(spl_u8 byte) {
    *(volatile spl_u8 *)(PL011_UART0_BASE + PL011_DR_OFFSET) = byte;
}

void rt_aarch64_uart_put(spl_u64 byte) {
    uart_put_byte((spl_u8)byte);
}

/* ---- PL011 UART0 RX: guest stdin (P8) ------------------------------------
 * The TX path above deliberately does no FR busy-wait. RX cannot be that
 * casual: reading DR while the receive FIFO is empty returns stale/garbage
 * data rather than blocking, so RXFE (FR bit 4) MUST be consulted first.
 *
 * BOUNDED, NON-BLOCKING BY DESIGN. The spin bound mirrors serial_putchar()'s
 * TXFF bound in ../../common/baremetal_pl011_serial.h (100000 iterations), and
 * the "poll for readiness, then read" contract mirrors the only other live RX
 * consumer in the tree: gui_entry_desktop.spl:364-365 tests
 * uart_data_ready() == 1 before calling uart_read_char(). An unbounded block
 * here would wedge every existing aarch64 boot gate, all of which run with
 * `-serial file:` (TX-only) and therefore never deliver a byte -- the guest
 * would spin forever and the four boot markers would never be reached.
 * "No data" is reported as an empty string, exactly as the hosted
 * stdin_read_char() (src/runtime/runtime_native.c:2210) reports EOF. */
#define PL011_FR_OFFSET 0x018ULL
#define PL011_FR_RXFE (1U << 4)

#ifndef SIMPLEOS_STDIN_RX_SPIN
#define SIMPLEOS_STDIN_RX_SPIN 100000U
#endif

static spl_i64 uart_try_get_byte_bounded(spl_u64 spins) {
    for (spl_u64 spin = 0; spin < spins; spin = spin + 1) {
        spl_u32 fr = *(volatile spl_u32 *)(PL011_UART0_BASE + PL011_FR_OFFSET);
        if ((fr & PL011_FR_RXFE) == 0U) {
            spl_u32 dr = *(volatile spl_u32 *)(PL011_UART0_BASE + PL011_DR_OFFSET);
            return (spl_i64)(dr & 0xFFU);
        }
    }
    return -1;
}

static spl_i64 uart_try_get_byte(void) {
    return uart_try_get_byte_bounded(SIMPLEOS_STDIN_RX_SPIN);
}

/* INTER-BYTE bound for stdin_read_char, deliberately much larger than the
 * probe's. Measured 2026-08-24 bringing up the round trip: with both on the
 * same 100k bound, an `initialize` request (~180 bytes) never arrived intact.
 * The PL011 FIFO is 16 bytes deep, so a multi-hundred-byte request is
 * delivered in refill bursts, and QEMU only refills on a main-loop turn.
 * _mcp_read_line() (src/app/mcp/main.spl:292) treats a single empty read as
 * EOF, so one refill gap wider than the bound truncates the message and the
 * server exits(0) on a FALSE EOF — which is exactly what the first two
 * round-trip attempts showed.
 *
 * Why this does not weaken anything: `uart_try_get_byte` keeps the original
 * 100k bound, so rt_aarch64_stdin_probe and every existing TX-only aarch64
 * gate are bit-for-bit unaffected — they never call stdin_read_char. Only the
 * MCP transport pays the longer wait, and it is still BOUNDED: a genuine EOF
 * is still reported as an empty string, just after a longer look. */
#ifndef SIMPLEOS_STDIN_READ_SPIN
#define SIMPLEOS_STDIN_READ_SPIN 40000000ULL
#endif

/* Raw byte reader for Simple callers that want the no-data case as a value
 * rather than as an empty string: byte 0..255, or -1 when the window expired. */
spl_i64 rt_aarch64_uart_try_get(void) {
    return uart_try_get_byte();
}

/* NON-CONSUMING readiness wait, for the MCP transport shim (Route A step 3).
 *
 * This exists because of the pacing hazard P8 recorded and this doc's §4.3
 * flagged as a DESIGN INPUT: bytes written before the guest reaches its
 * polling window are swallowed by EDK2/Limine's own console, but the serve
 * loop's first read is bounded at SIMPLEOS_STDIN_RX_SPIN (~100k spins), which
 * is far shorter than a host round trip. So a host that waits to see the
 * guest's "entering" marker before writing will ALWAYS miss the window, and
 * the server exits on a false EOF before a byte can land.
 *
 * The fix belongs here and not in uart_try_get_byte(): the design doc is
 * explicit that "MCP's blocking-read semantics belong in the P10 transport
 * shim, not in the UART primitive". uart_try_get_byte() stays bounded and
 * non-blocking, so every existing TX-only gate is unaffected — none of them
 * calls this function at all.
 *
 * Polls FR/RXFE only; it never touches DR, so it CONSUMES NOTHING and the
 * byte it saw is still there for stdin_read_char(). Returns 1 if data became
 * available, 0 if `rounds` windows expired first. Bounded, never infinite:
 * an unbounded wait would wedge a guest whose host never writes. */
spl_i64 rt_aarch64_stdin_wait_ready(spl_i64 rounds) {
    if (rounds <= 0) {
        return 0;
    }
    for (spl_i64 r = 0; r < rounds; r = r + 1) {
        for (spl_u32 spin = 0; spin < SIMPLEOS_STDIN_RX_SPIN; spin = spin + 1) {
            spl_u32 fr = *(volatile spl_u32 *)(PL011_UART0_BASE + PL011_FR_OFFSET);
            if ((fr & PL011_FR_RXFE) == 0U) {
                return 1;
            }
        }
    }
    return 0;
}

static spl_i64 stdin_read_char_impl(spl_u64 spins) {
    spl_i64 byte = uart_try_get_byte_bounded(spins);
    if (byte < 0) {
        return rt_string_new(0, 0);
    }
    spl_u8 raw = (spl_u8)byte;
    return rt_string_new((spl_i64)(spl_u64)(spl_u8 *)&raw, 1);
}

/* `stdin_read_char` is the symbol the Simple `extern fn stdin_read_char() ->
 * text` declarations actually bind to (src/lib/nogc_sync_mut/mcp_sdk/transport/
 * stdio.spl:15, lsp_protocol.spl:5) -- it is NOT rt_-prefixed on the host
 * either. `rt_stdin_read_char` is provided alongside it for the rt_* naming
 * convention used by the other freestanding arch stubs. */
spl_i64 stdin_read_char(void) {
    return stdin_read_char_impl(SIMPLEOS_STDIN_READ_SPIN);
}

spl_i64 rt_stdin_read_char(void) {
    return stdin_read_char_impl(SIMPLEOS_STDIN_READ_SPIN);
}

/* The P8 probe's reader, pinned to the SHORT bound. rt_aarch64_stdin_probe
 * does `rounds` reads in a row, so it must NOT inherit the long inter-byte
 * bound stdin_read_char now uses: measured 2026-08-24, 300 rounds x 40M spins
 * wedged the boot past the gate's 90s timeout and the transcript stopped dead
 * at "[STDIN-PROBE] armed rounds=300". Keeping the probe on 100k restores its
 * previous timing exactly, which is what every existing TX-only aarch64 gate
 * depends on. */
static spl_i64 stdin_read_char_probe(void) {
    return stdin_read_char_impl(SIMPLEOS_STDIN_RX_SPIN);
}

static void uart_write_bytes(const char *data, spl_u64 len) {
    if (!data) {
        return;
    }
    for (spl_u64 i = 0; i < len; i = i + 1) {
        uart_put_byte((spl_u8)data[i]);
    }
}

static void uart_write_hex_byte(spl_u8 value) {
    static const char hex[] = "0123456789abcdef";
    uart_put_byte((spl_u8)hex[(value >> 4) & 0x0fU]);
    uart_put_byte((spl_u8)hex[value & 0x0fU]);
}

/* ---- P8 evidence probe ----------------------------------------------------
 * Exercises the REAL stdin_read_char() above (not a private byte reader) and
 * reports the result as a hex-framed marker line, per the framing decision in
 * doc/05_design/os/simpleos/mcp_in_guest_qemu_2026-08-23.md section 2.3: QEMU
 * `virt` has a single PL011, so kernel log lines and payload share one wire and
 * the payload must survive interleaving. Hex does that.
 *
 * Emits exactly one of:
 *     [STDIN-PROBE] armed rounds=<n>
 *     [STDIN-ECHO] len=<n> hex=<...>      (at least one byte crossed in)
 *     [STDIN-PROBE] no-data               (window expired, nothing received)
 * The armed/no-data pair is what makes a negative result precise: it
 * distinguishes "the stub was never reached" from "reached, but RX stayed
 * empty". Reads until LF or the byte cap, so a line-oriented host feed frames
 * naturally. Returns the number of bytes received. */
#define SIMPLEOS_STDIN_PROBE_CAP 64U

spl_i64 rt_aarch64_stdin_probe(spl_i64 rounds) {
    spl_u8 buf[SIMPLEOS_STDIN_PROBE_CAP];
    spl_u64 len = 0;
    spl_i64 max_rounds = rounds > 0 ? rounds : 1;

    uart_write_bytes("[STDIN-PROBE] armed rounds=", 27);
    {
        char dec[21];
        spl_u64 dlen = 0;
        rt_write_decimal(dec, &dlen, (spl_u64)max_rounds);
        uart_write_bytes(dec, dlen);
    }
    uart_put_byte('\r');
    uart_put_byte('\n');

    for (spl_i64 round = 0; round < max_rounds && len < SIMPLEOS_STDIN_PROBE_CAP; round = round + 1) {
        spl_i64 value = stdin_read_char_probe();
        RtString *s = rt_as_string(value);
        if (!s || s->len == 0) {
            continue;
        }
        spl_u8 byte = (spl_u8)s->data[0];
        if (byte == (spl_u8)'\n') {
            break;
        }
        if (byte == (spl_u8)'\r') {
            continue;
        }
        buf[len] = byte;
        len = len + 1;
    }

    if (len == 0) {
        uart_write_bytes("[STDIN-PROBE] no-data\r\n", 23);
        return 0;
    }

    uart_write_bytes("[STDIN-ECHO] len=", 17);
    {
        char dec[21];
        spl_u64 dlen = 0;
        rt_write_decimal(dec, &dlen, len);
        uart_write_bytes(dec, dlen);
    }
    uart_write_bytes(" hex=", 5);
    for (spl_u64 i = 0; i < len; i = i + 1) {
        uart_write_hex_byte(buf[i]);
    }
    uart_put_byte('\r');
    uart_put_byte('\n');
    return (spl_i64)len;
}

static void uart_line_tcp_read5(const spl_u8 *data, spl_u64 len) {
    uart_write_bytes("BTCP READ5 ", 11);
    for (spl_u64 i = 0ULL; i < len; i = i + 1ULL) {
        if (i > 0ULL) {
            uart_put_byte(' ');
        }
        uart_write_hex_byte(data[i]);
    }
    uart_put_byte(13);
    uart_put_byte(10);
}

void log_raw_println(spl_i64 msg) {
    RtString *text = rt_as_string(msg);
    spl_i64 rendered;
    if (!text) {
        rendered = rt_to_string(msg);
        text = rt_as_string(rendered);
    }
    if (text) {
        uart_write_bytes(text->data, text->len);
    }
    uart_put_byte(13);
    uart_put_byte(10);
}

void serial_println(spl_i64 msg) {
    log_raw_println(msg);
}

/* ---- P9: freestanding stdout ---------------------------------------------
 * `print_raw` is the symbol the Simple `extern fn print_raw(s: text)`
 * declarations actually bind to -- it is NOT rt_-prefixed on the host either
 * (src/runtime/runtime_native.c:2226). Declaring sites:
 *     src/app/mcp/main_transport.spl:1        extern fn print_raw(s: text)
 *     src/app/simple_lsp_mcp/json_helpers.spl:13   extern fn print_raw(s: text)
 *     src/app/io/cli_ops.spl:31               extern fn print_raw(value: text) -> i64
 *     src/app/dashboard/framework_policy.spl:22    (same, -> i64)
 * The two spellings disagree on the return; one C symbol satisfies both,
 * because an AAPCS64 caller that declared void simply ignores x0. Returns 0,
 * matching the host implementation.
 *
 * RAW means raw: no framing and no implicit newline. Per
 * doc/05_design/os/simpleos/mcp_in_guest_qemu_2026-08-23.md section 2.3, the
 * hex marker-line framing that makes a single shared PL011 safe is the
 * PROTOCOL layer's job, not this sink's.
 *
 * NOTE (corrects an earlier assumption): rt_print_str / rt_println_str /
 * rt_print_value in this file are `(void)value;` no-ops (:445-478) and route
 * nowhere. The working TX path is log_raw_println above. This is modelled on
 * that, minus the trailing CR/LF. */
spl_i64 print_raw(spl_i64 value) {
    RtString *text = rt_as_string(value);
    spl_i64 rendered;
    if (!text) {
        rendered = rt_to_string(value);
        text = rt_as_string(rendered);
    }
    if (text) {
        uart_write_bytes(text->data, text->len);
    }
    return 0;
}

/* P9 evidence probe. Mirrors the P8 stdin probe: exercises the REAL print_raw()
 * above (not uart_write_bytes directly), so a surviving nonce in the serial log
 * proves that symbol executed. Also the --gc-sections root: after P8, nm showed
 * rt_stdin_read_char and rt_aarch64_uart_try_get discarded and stdin_read_char
 * kept solely because a live boot path called it. Emits its own CRLF, since
 * print_raw deliberately adds none. Returns the byte count it handed to
 * print_raw. */
spl_i64 rt_aarch64_stdout_probe(spl_i64 msg) {
    RtString *text = rt_as_string(msg);
    spl_i64 len = text ? (spl_i64)text->len : 0;
    print_raw(msg);
    uart_put_byte(13);
    uart_put_byte(10);
    return len;
}

spl_i64 rt_string_len(spl_i64 value) {
    RtString *string = rt_as_string(value);
    return string ? (spl_i64)string->len : 0;
}

spl_i64 rt_string_data(spl_i64 value) {
    RtString *string = rt_as_string(value);
    if (!string) {
        return 0;
    }
    return (spl_i64)(spl_u64)string->data;
}

spl_i64 rt_byte_array_new(spl_i64 capacity_value) {
    return rt_array_new(capacity_value);
}

spl_i64 rt_byte_array_new_len(spl_i64 len_value) {
    spl_i64 array = rt_array_new(len_value);
    RtArray *arr = rt_as_array(array);
    spl_i64 len = rt_index_arg(len_value);
    if (!arr || len <= 0) {
        return array;
    }
    for (spl_i64 i = 0; i < len; i = i + 1) {
        rt_array_push(array, rt_int(0));
    }
    return array;
}

spl_i64 rt_text_to_bytes(spl_i64 text_value) {
    RtString *string = rt_as_string(text_value);
    spl_i64 out;
    if (!string) {
        return rt_array_new(0);
    }
    out = rt_array_new((spl_i64)string->len);
    for (spl_u64 i = 0; i < string->len; i = i + 1) {
        rt_array_push(out, rt_int((spl_i64)(unsigned char)string->data[i]));
    }
    return out;
}

spl_i64 rt_ssh_userauth_password_only_failure_payload(void) {
    spl_i64 out = rt_array_new(14);
    rt_array_push(out, rt_int(51));
    rt_array_push(out, rt_int(0));
    rt_array_push(out, rt_int(0));
    rt_array_push(out, rt_int(0));
    rt_array_push(out, rt_int(8));
    rt_array_push(out, rt_int('p'));
    rt_array_push(out, rt_int('a'));
    rt_array_push(out, rt_int('s'));
    rt_array_push(out, rt_int('s'));
    rt_array_push(out, rt_int('w'));
    rt_array_push(out, rt_int('o'));
    rt_array_push(out, rt_int('r'));
    rt_array_push(out, rt_int('d'));
    rt_array_push(out, rt_special(RT_VALUE_SPECIAL_FALSE));
    return out;
}

spl_i64 rt_string_join(spl_i64 array_value, spl_i64 separator_value) {
    RtArray *array = rt_as_array(array_value);
    RtString *separator = rt_as_string(separator_value);
    RtString *joined;
    spl_u64 total_len = 0;
    spl_u64 out_index = 0;
    if (!array) {
        return rt_string_new((spl_i64)(spl_u64)"", 0);
    }
    for (spl_u64 i = 0; i < array->len; i = i + 1) {
        RtString *elem = rt_as_string(rt_to_string(array->data[i]));
        if (elem) {
            total_len = total_len + elem->len;
        }
        if (separator && i + 1 < array->len) {
            total_len = total_len + separator->len;
        }
    }
    joined = (RtString *)rt_alloc((spl_i64)(sizeof(RtString) + total_len + 1));
    if (!joined) {
        return rt_nil();
    }
    joined->header.object_type = RT_HEAP_STRING;
    joined->header.gc_flags = 0;
    joined->header.reserved = 0;
    joined->header.size = (spl_u32)(sizeof(RtString) + total_len);
    joined->len = total_len;
    joined->hash = 0;
    for (spl_u64 i = 0; i < array->len; i = i + 1) {
        RtString *elem = rt_as_string(rt_to_string(array->data[i]));
        if (elem) {
            for (spl_u64 j = 0; j < elem->len; j = j + 1) {
                joined->data[out_index] = elem->data[j];
                out_index = out_index + 1;
            }
        }
        if (separator && i + 1 < array->len) {
            for (spl_u64 j = 0; j < separator->len; j = j + 1) {
                joined->data[out_index] = separator->data[j];
                out_index = out_index + 1;
            }
        }
    }
    joined->data[out_index] = 0;
    return rt_heap(joined);
}

void unsafe(void) {
}

/* Linker-provided symbols from linker_limine.ld (_kernel_end / _bss_start),
 * exposed to limine_boot_aarch64.spl's `extern fn _get_kernel_end() -> u64`
 * / `extern fn _get_bss_start() -> u64` for kernel-size estimation. Mirrors
 * x86_64's examples/09_embedded/simple_os/arch/x86_64/boot/type_stubs.c
 * `_get_kernel_end`, but with the plain zero-arg C signature that matches
 * this file's native-ABI convention (the x86_64 file's RuntimeValue(a..h)
 * signature belongs to a different, interpreter-dispatch calling
 * convention not used by this freestanding native-codegen boot lane). */
extern char _kernel_end[];
extern char _bss_start[];

spl_u64 _get_kernel_end(void) {
    return (spl_u64)(spl_u64)(void *)_kernel_end;
}

spl_u64 _get_bss_start(void) {
    return (spl_u64)(spl_u64)(void *)_bss_start;
}

/* Local aarch64 halt: WFE spin loop, matches limine_boot_aarch64.spl's
 * `extern fn rt_aarch64_wfe_spin()` (used instead of the x86_64-only
 * os.kernel.boot.cpu.halt_loop, whose rt_cli/rt_hlt are x86 instructions
 * with no aarch64 meaning). No interrupt controller is configured yet at
 * this boot-entry milestone, so this never wakes — that is intentional: it
 * is the terminal state after the milestone's real klog line is printed. */
void rt_aarch64_wfe_spin(void) {
    for (;;) {
        __asm__ volatile("wfe" ::: "memory");
    }
}

/* rt_arm64_mrs_sctlr_el1: bare read of SCTLR_EL1 (System Control Register,
 * EL1), used by limine_boot_aarch64.spl's memory_init to log whether the
 * MMU (bit 0, "M") is on at kernel entry. No side effect, no write half —
 * this lane never touches the page tables Limine already built. Matches the
 * `mrs_sctlr_el1` accessor in src/os/kernel/arch/arm64/cpu.spl (the older
 * non-Limine boot lane's `rt_arm64_mrs_sctlr_el1` extern), but that lane's
 * own C implementation is not linked into this freestanding runtime, so the
 * symbol is re-provided here rather than pulling that whole EL1-direct boot
 * lane's object graph into the Limine link closure. */
spl_u64 rt_arm64_mrs_sctlr_el1(void) {
    spl_u64 value;
    __asm__ volatile("mrs %0, sctlr_el1" : "=r"(value));
    return value;
}

/* ============================================================================
 * Remaining generic rt_* primitives needed to link limine_boot_aarch64.spl +
 * klog_api.spl + os.kernel.boot.mmio against this file. Ported/adapted from
 * the canonical hosted implementations in src/runtime/runtime_native.c (the
 * cited functions there) and examples/09_embedded/simple_os/arch/arm64/boot/
 * baremetal_stubs.c (the arm64 EL1-direct lane's dcache helpers, adapted from
 * its RuntimeValue ABI to this file's spl_i64 tagged-value scheme), found
 * missing by iterating real `ld.lld` unresolved-symbol errors 2026-08-07.
 * ==========================================================================*/

/* rt_string_new_literal: same contract as rt_string_new (this file already
 * defines it above) — kept as a distinct symbol because codegen emits calls
 * to both names for different literal-vs-computed string call sites (see
 * src/runtime/runtime_native.c's own rt_string_new_literal). */
spl_i64 rt_string_new_literal(spl_i64 bytes_value, spl_i64 len_value) {
    return rt_string_new(bytes_value, len_value);
}

/* rt_enum_id / rt_enum_discriminant: field accessors on the tagged RtEnum
 * heap object this file already defines (RT_HEAP_ENUM). Return 0 for a
 * non-enum operand rather than trapping — matches this file's general
 * "return a safe default on a bad tag" convention (e.g. rt_string_len). */
spl_i64 rt_enum_id(spl_i64 value) {
    RtEnum *e = rt_as_enum(value);
    return e ? rt_int((spl_i64)e->enum_id) : rt_int(0);
}

spl_i64 rt_enum_discriminant(spl_i64 value) {
    RtEnum *e = rt_as_enum(value);
    return e ? rt_int((spl_i64)e->discriminant) : rt_int(0);
}

/* Bug (2026-08-11): freestanding text ORDERING (`<`/`>`/sort) against a RAW
 * literal -- the sibling of rt_text_eq_str_vs_raw above for `<`/`>` instead
 * of `==`/`!=`. Before this fix, rt_text_cmp_any treated a non-heap operand
 * (rt_as_string() == NULL, e.g. a raw `""` literal from
 * emit_bootstrap_str_const) as a zero-length string rather than reading its
 * actual bytes, so a heap string compared against ANY raw literal always
 * came out "greater than" the literal regardless of content -- `x < "foo"`
 * for a genuinely lesser `x` returned false, and `x == "foo"` routed through
 * rt_native_cmp returned nonzero even for equal content. Same
 * heap-vs-raw class of defect as rt_text_eq_str_vs_raw; same safety rules:
 * the raw side is interpreted as a char* ONLY when the other side is a
 * proven RtString, a plausibility floor rejects small words (nil/bool/small
 * int), and the scan is bounded by the decoded string's own length.
 *
 * Selfcheck: src/runtime/test/rt_text_cmp_any_heap_vs_raw_selfcheck.c
 */
static spl_i64 rt_text_cmp_str_vs_raw(RtString *s, spl_i64 raw) {
    const spl_u8 *p;
    spl_u64 i;
    if ((spl_u64)raw < 0x10000u) return 2;   /* sentinel: unsafe, caller falls back */
    p = (const spl_u8 *)(spl_u64)raw;
    for (i = 0; i < s->len; i = i + 1) {
        spl_u8 sc = (spl_u8)s->data[i];
        spl_u8 pc = p[i];
        if (pc == 0) return 1;               /* raw ends first -> s is greater */
        if (sc != pc) return sc < pc ? -1 : 1;
    }
    return p[s->len] == 0 ? 0 : -1;          /* equal length, or raw has more */
}

/* rt_text_cmp_any / rt_native_cmp: dynamic ordering fallback for codegen
 * sites that cannot statically prove operand types (mirrors
 * src/runtime/runtime_native.c's rt_text_cmp_any / rt_native_cmp). Byte-wise
 * lexical order for tagged heap strings (including a heap-vs-raw mix via
 * rt_text_cmp_str_vs_raw), signed value order otherwise — this file's
 * integer tagging is an order-preserving left shift (see the
 * u8/u16/u32/u64 rt_volatile_* comment above), so a raw signed compare is
 * correct for tagged ints too. */
spl_i64 rt_text_cmp_any(spl_i64 left, spl_i64 right) {
    RtString *a = rt_as_string(left);
    RtString *b = rt_as_string(right);
    if (a && b) {
        spl_u64 alen = a->len;
        spl_u64 blen = b->len;
        spl_u64 count = alen < blen ? alen : blen;
        for (spl_u64 i = 0; i < count; i = i + 1) {
            unsigned char ac = (unsigned char)a->data[i];
            unsigned char bc = (unsigned char)b->data[i];
            if (ac != bc) {
                return rt_int(ac < bc ? -1 : 1);
            }
        }
        if (alen == blen) {
            return rt_int(0);
        }
        return rt_int(alen < blen ? -1 : 1);
    }
    if (a && !b) {
        spl_i64 r = rt_text_cmp_str_vs_raw(a, right);
        if (r != 2) return rt_int(r);
    }
    if (b && !a) {
        spl_i64 r = rt_text_cmp_str_vs_raw(b, left);
        if (r != 2) return rt_int(-r);
    }
    return rt_int(left == right ? 0 : (left < right ? -1 : 1));
}

spl_i64 rt_native_cmp(spl_i64 left, spl_i64 right) {
    RtString *a = rt_as_string(left);
    RtString *b = rt_as_string(right);
    if (a || b) {
        return rt_text_cmp_any(left, right);
    }
    if (left == right) {
        return rt_int(0);
    }
    return rt_int(left < right ? -1 : 1);
}

/* rt_opt_i64_to_string / rt_opt_bool_to_string / rt_opt_f64_to_string: P1
 * flat-optional-to-text helpers (mirrors src/runtime/runtime_native.c's
 * rt_opt_* family). A flat `i64?`/`bool?`/`f64?` is a RAW payload carrying
 * either the bare inner value or the nil sentinel — never a tagged
 * RuntimeValue — so these take/return raw i64, not rt_int()-tagged values,
 * matching the hosted contract exactly. rt_core_nil() there is the nil
 * sentinel value 3== RT_VALUE_TAG_SPECIAL|RT_VALUE_SPECIAL_NIL<<2-ish
 * bit-for-bit; this file's rt_special(RT_VALUE_SPECIAL_NIL) already
 * produces the equivalent tagged nil, but the raw-payload nil sentinel the
 * hosted runtime compares against is the plain integer 3 — reproduced
 * directly here to avoid depending on rt_special()'s exact bit layout for a
 * raw (non-heap-tagged) comparison. */
#define RT_OPT_RAW_NIL 3LL

spl_i64 rt_opt_i64_to_string(spl_i64 raw) {
    if (raw == RT_OPT_RAW_NIL) {
        return rt_string_new((spl_i64)(spl_u64)"nil", 3);
    }
    return rt_raw_u64_to_string(raw);
}

spl_i64 rt_opt_bool_to_string(spl_i64 raw) {
    if (raw == RT_OPT_RAW_NIL) {
        return rt_string_new((spl_i64)(spl_u64)"nil", 3);
    }
    if (raw != 0) {
        return rt_string_new((spl_i64)(spl_u64)"true", 4);
    }
    return rt_string_new((spl_i64)(spl_u64)"false", 5);
}

spl_i64 rt_opt_f64_to_string(spl_i64 raw) {
    /* No float formatting in this minimal boot-entry runtime (no floats are
     * used anywhere in this milestone's actual boot path) — a real f64
     * formatter (rt_raw_f64_to_string in src/runtime/runtime_native.c) is
     * out of scope here. Distinguish nil from "unsupported" rather than
     * silently rendering a wrong number. */
    if (raw == RT_OPT_RAW_NIL) {
        return rt_string_new((spl_i64)(spl_u64)"nil", 3);
    }
    return rt_string_new((spl_i64)(spl_u64)"<f64:unsupported>", 18);
}

/* rt_value_float: box an f64 (passed as its raw i64 bit pattern) into a
 * tagged heap value. This minimal runtime has no float-aware GC/registry
 * (src/runtime/runtime_native.c's RtCoreFloat registry) — box as an
 * RT_HEAP_TUPLE-shaped 1-word payload instead, sufficient to round-trip the
 * bits since nothing in this milestone's boot path actually reads a boxed
 * float back out. Present only so the symbol resolves; not exercised. */
spl_i64 rt_value_float(spl_i64 raw_bits) {
    RtTuple *box = (RtTuple *)rt_alloc((spl_i64)(sizeof(RtTuple) + sizeof(spl_i64)));
    if (!box) {
        return rt_nil();
    }
    box->header.object_type = RT_HEAP_TUPLE;
    box->header.gc_flags = 0;
    box->header.reserved = 0;
    box->header.size = (spl_u32)(sizeof(RtTuple) + sizeof(spl_i64));
    box->len = 1;
    box->data[0] = raw_bits;
    return rt_heap(box);
}

/* rt_typed_words_u32_at / rt_typed_words_u64_at: indexed reads over the
 * generic RtArray (values stored as tagged spl_i64 words, matching the
 * arm64 EL1-direct lane's rt_typed_words_u32_at/u64_at in baremetal_stubs.c
 * adapted to this file's RtArray/rt_index_arg helpers). Return 0 on any
 * out-of-range/bad-type access rather than trapping. */
spl_i64 rt_typed_words_u32_at(spl_i64 array_value, spl_i64 index_value) {
    RtArray *arr = rt_as_array(array_value);
    if (!arr) {
        return rt_int(0);
    }
    spl_i64 i = rt_index_arg(index_value);
    if (i < 0 || (spl_u64)i >= arr->len) {
        return rt_int(0);
    }
    return rt_int((spl_i64)(spl_u32)rt_index_arg(arr->data[i]));
}

spl_i64 rt_typed_words_u64_at(spl_i64 array_value, spl_i64 index_value) {
    RtArray *arr = rt_as_array(array_value);
    if (!arr) {
        return rt_int(0);
    }
    spl_i64 i = rt_index_arg(index_value);
    if (i < 0 || (spl_u64)i >= arr->len) {
        return rt_int(0);
    }
    return arr->data[i];
}

/* rt_memory_barrier / rt_invlpg: aarch64 analogs of the RV64 originals
 * further down this file's history (`fence rw,rw` / `sfence.vma`) — `dsb
 * sy` is the aarch64 full system barrier (matches
 * examples/09_embedded/simple_os/arch/arm64/boot/baremetal_stubs.c's own
 * rt_memory_barrier), and a single-address TLB invalidate is `tlbi
 * vaae1is` on the by-VA (all-ASID, inner-shareable, EL1) entry, bracketed
 * by DSB+ISB per the ARM ARM's required TLB-maintenance sequence. Neither
 * MMU nor a page table is set up yet at this boot-entry milestone (no
 * caller in the current reachable graph actually invokes rt_invlpg) — this
 * exists to satisfy the link, matching this file's `rt_value_float`
 * above. */
void rt_memory_barrier(void) {
    __asm__ volatile("dsb sy" ::: "memory");
}

void rt_invlpg(spl_u64 addr) {
    spl_u64 page = addr >> 12;
    __asm__ volatile(
        "dsb ishst\n"
        "tlbi vaae1is, %0\n"
        "dsb ish\n"
        "isb\n"
        :
        : "r"(page)
        : "memory");
}

/* rt_arm64_dcache_clean_range / rt_arm64_dcache_invalidate_range: ported
 * near-verbatim from
 * examples/09_embedded/simple_os/arch/arm64/boot/baremetal_stubs.c
 * (arm64_clean_dcache_range / arm64_invalidate_dcache_range +
 * their rt_arm64_dcache_* wrappers), which are architecturally identical
 * for this (aarch64) target — only the RuntimeValue vs spl_i64 ABI differs
 * (both are plain 64-bit integers here). CACHE_LINE_SIZE 64 bytes matches
 * QEMU's cortex-a72/virt CTR_EL0 (and is the conservative common case
 * across current aarch64 cores generally). */
#define AARCH64_DCACHE_LINE_SIZE 64ULL

void rt_arm64_dcache_clean_range(spl_i64 addr, spl_i64 size) {
    spl_u64 line = (spl_u64)addr & ~(AARCH64_DCACHE_LINE_SIZE - 1ULL);
    spl_u64 end = ((spl_u64)addr + (spl_u64)size + AARCH64_DCACHE_LINE_SIZE - 1ULL) & ~(AARCH64_DCACHE_LINE_SIZE - 1ULL);
    while (line < end) {
        __asm__ volatile("dc cvac, %0" ::"r"(line) : "memory");
        line = line + AARCH64_DCACHE_LINE_SIZE;
    }
    __asm__ volatile("dsb sy" ::: "memory");
}

void rt_arm64_dcache_invalidate_range(spl_i64 addr, spl_i64 size) {
    spl_u64 line = (spl_u64)addr & ~(AARCH64_DCACHE_LINE_SIZE - 1ULL);
    spl_u64 end = ((spl_u64)addr + (spl_u64)size + AARCH64_DCACHE_LINE_SIZE - 1ULL) & ~(AARCH64_DCACHE_LINE_SIZE - 1ULL);
    while (line < end) {
        __asm__ volatile("dc ivac, %0" ::"r"(line) : "memory");
        line = line + AARCH64_DCACHE_LINE_SIZE;
    }
    __asm__ volatile("dsb sy" ::: "memory");
}

/* ============================================================================
 * Limine boot-protocol requests — moved here from limine_boot_aarch64.spl.
 *
 * Two independent defects made the Simple-side globals unusable:
 *
 * 1. `# @section(".limine_reqs")` above each `var ..._request` in
 *    limine_boot_aarch64.spl (and limine_boot.spl on x86_64) is a plain `#`
 *    comment, not a real attribute — Simple has no decorator slot on
 *    top-level `var` declarations at all (checked the parser AST:
 *    `definitions.rs` gives `decorators`/`attributes` fields to
 *    FunctionDef/ClassDef/ExternDef etc., never to a global var/let). So
 *    `readelf -S` on the linked kernel showed no `.limine_reqs` section and
 *    Limine's base_revision==0 ELF-section scan could never find these
 *    requests, no matter what the boot lane did afterward.
 * 2. Independently, and worse: `hhdm_request.response` (plain field access
 *    on a `@repr("C")` global struct) does not compile to a `base +
 *    offsetof` load on this aarch64/cranelift target. Disassembly of the
 *    linked kernel.elf showed the compiled `_parse_hhdm` loading
 *    `hhdm_request`'s *first* word (the id[0] magic constant, not
 *    `.response` at struct offset 0x28), masking its low 3 bits, and
 *    branching on a tagged-pointer/Option-style unboxing pattern — the
 *    codegen used for accessing a boxed/nilable value, not a POD C struct
 *    field. That is why `_parse_hhdm` hung silently immediately after
 *    printing "_parse_hhdm: enter": the field read landed on nonsense,
 *    masked it, and the resulting control flow never reached either the
 *    nil-check WARNING print or the offset-parse print. Both defects are
 *    real; #2 is the one that produced the reported hang (confirmed by
 *    bisecting with log_raw_println calls immediately before/after the
 *    field read — "enter" printed, "read done" never did). See the bug
 *    doc's 2026-08-07 section for the full disassembly.
 *
 * Fix scope: rather than building full parser->HIR->MIR->codegen support
 * for a `@section`/`@link_section` global-var attribute (a large,
 * general-purpose compiler feature out of scope for this boot milestone),
 * the five Limine request structs are defined here in C as plain `static
 * volatile` globals with `used` (so they survive as real data in the
 * linked ELF's .rodata/.data, matching the x86_64 linker script's own
 * comment: "Limine scans the binary for the magic IDs at boot time" —
 * i.e. Limine does NOT require a specially-named section, only that the
 * request structs actually exist as real bytes somewhere inside a loaded
 * PT_LOAD segment and are not stripped/optimized away), with accessor
 * functions that return the bootloader-filled `.response` pointer as a
 * plain `u64`. This sidesteps defect #2 as well: Simple never does a
 * `@repr("C")` struct-field read on these globals at all anymore, only
 * calls a zero-arg extern fn.
 *
 * An explicit `.limine_reqs`-named section (via
 * `__attribute__((section(".limine_reqs")))`, matching
 * linker_limine.ld's already-present `.limine_reqs : AT(...) { *(.limine_reqs) }`
 * output section) was tried first and is NOT used here: with that
 * attribute added, Limine's own loader reproducibly (verified twice,
 * bit-identical fault address both times) hit `Synchronous Exception at
 * 0x000000004C66A2E0` while parsing the kernel, before printing anything
 * from this kernel at all — a regression from the working (if
 * request-blind) banner-only boot. Root cause not isolated further (no
 * Limine source in-tree to cross-check `AT()` physical-address arithmetic
 * against its loader's segment-copy expectations); since the plain
 * `used`-global form above boots end-to-end for real (verified below),
 * that is the form kept. The unused, now-always-empty `.limine_reqs`
 * output section in linker_limine.ld is left in place (harmless — an
 * empty `KEEP(*(.limine_reqs))` costs nothing) as a documented landing
 * spot if that regression is root-caused later.
 */

typedef struct {
    spl_u64 id[4];
    spl_u64 revision;
    spl_u64 response;
} limine_request_t;

#define LIMINE_COMMON_MAGIC_0 0xc7b1dd30df4c8b88ULL
#define LIMINE_COMMON_MAGIC_1 0x0a82e883a194f07bULL

__attribute__((used, aligned(8)))
static volatile limine_request_t g_limine_memmap_request = {
    { LIMINE_COMMON_MAGIC_0, LIMINE_COMMON_MAGIC_1,
      0x67cf3d9d378a806fULL, 0xe304acdfc50c3c62ULL },
    0, 0
};

__attribute__((used, aligned(8)))
static volatile limine_request_t g_limine_framebuffer_request = {
    { LIMINE_COMMON_MAGIC_0, LIMINE_COMMON_MAGIC_1,
      0x9d5827dcd881dd75ULL, 0xa3148604f6fab11bULL },
    0, 0
};

__attribute__((used, aligned(8)))
static volatile limine_request_t g_limine_rsdp_request = {
    { LIMINE_COMMON_MAGIC_0, LIMINE_COMMON_MAGIC_1,
      0xc5e77b6b397e7b43ULL, 0x27637845accdcf3cULL },
    0, 0
};

__attribute__((used, aligned(8)))
static volatile limine_request_t g_limine_hhdm_request = {
    { LIMINE_COMMON_MAGIC_0, LIMINE_COMMON_MAGIC_1,
      0x48dcf1cb8ad2b852ULL, 0x63984e959a98244bULL },
    0, 0
};

__attribute__((used, aligned(8)))
static volatile limine_request_t g_limine_kernel_addr_request = {
    { LIMINE_COMMON_MAGIC_0, LIMINE_COMMON_MAGIC_1,
      0x71ba76863cc55f63ULL, 0xb2644a48c516a487ULL },
    0, 0
};

spl_u64 rt_limine_memmap_response(void) {
    return (spl_u64)g_limine_memmap_request.response;
}

spl_u64 rt_limine_framebuffer_response(void) {
    return (spl_u64)g_limine_framebuffer_request.response;
}

spl_u64 rt_limine_rsdp_response(void) {
    return (spl_u64)g_limine_rsdp_request.response;
}

spl_u64 rt_limine_hhdm_response(void) {
    return (spl_u64)g_limine_hhdm_request.response;
}

spl_u64 rt_limine_kernel_addr_response(void) {
    return (spl_u64)g_limine_kernel_addr_request.response;
}

/* ===========================================================================
 * P10 — the mechanical half of the MCP module graph's freestanding runtime ABI
 * ===========================================================================
 *
 * Design: doc/05_design/os/simpleos/mcp_in_guest_qemu_2026-08-23.md, "P10
 * INVENTORY". The transitive `use` closure of src/app/mcp/main.spl declares
 * 151 extern symbols; 11 were already defined above (P8 `stdin_read_char`, P9
 * `print_raw`, and nine string/hash helpers). This section adds the buckets
 * that are pure computation or have a defined "unavailable" answer:
 *
 *     text / utf8 / string-index    19  real implementations
 *     rt_simd_* capability probes    8  real answers for this lane
 *     rt_simd_* arithmetic kernels  41  NAMED TRAPS (see the policy note below)
 *     atomics / atexit / signal      7  real atomics; signals honestly absent
 *     env / exit / args              5  honestly empty freestanding answers
 *     stdio siblings of print_raw    3  real, out the same PL011
 *     sqrt                           1  real (AArch64 FSQRT)
 *
 * THE REMAINING 56 ARE NAMED TRAPS (added 2026-08-24, Route A step 1). They
 * need real subsystems, not shims, and a VALUE returned by any of them would
 * be a lie the caller cannot detect: filesystem (rt_file_* / rt_dir_*, 29),
 * process (rt_process_* / rt_shell_exec / rt_getpid / spl_thread_cpu_count,
 * 18), rt_mmap/munmap/madvise/msync (4), time/thread (3),
 * rt_browser_renderer_* (2).
 *
 * They are defined here ONLY to reach link closure, which is a different
 * question from being implemented. A static freestanding link must resolve a
 * symbol whose CALL SITE is emitted even when that call never executes, and
 * every one of these is reachable only from MCP `tools/call` handlers —
 * measured, see the trap block below. Leaving them undefined does not keep
 * the link "honest about the gap" (the previous wording here): it keeps the
 * link from happening at all, which blocks the milestone rather than
 * documenting it. Outcome (3) of the honesty rule below is what documents it.
 *
 * ---------------------------------------------------------------------------
 * THE HONESTY RULE THIS SECTION FOLLOWS
 * ---------------------------------------------------------------------------
 * Three outcomes are allowed per symbol, and nothing here invents a fourth:
 *   (1) REAL SEMANTICS — the computation is performed for real.
 *   (2) A DEFINED "UNAVAILABLE" ANSWER, but only where the CALLER is written
 *       to recognise it (e.g. rt_swi_build returning 0 makes
 *       src/lib/common/encoding/width_index.spl:49 stay in its linear-scan
 *       mode; rt_signal_install returning 0 makes signal_stubs.spl's
 *       signal_handler_install return false).
 *   (3) A NAMED LOUD TRAP — rt_trap_unimplemented("rt_x") prints the symbol
 *       over the UART and parks the core. A STUB, not an implementation:
 *       strictly better than a NULL GOT slot (you learn WHICH call died) and
 *       strictly worse than the real thing (the guest still stops).
 * A plausible-looking wrong value is never allowed. This mirrors
 * src/runtime/runtime_native.c:11596-11631.
 */

/* Freestanding twin of src/runtime/runtime_native.c:11623. The host version
 * uses fprintf/abort; this file is libc-free by charter (see the file header),
 * so the trap writes over PL011 and then parks the core in a WFE spin, exactly
 * like rt_aarch64_wfe_spin above. It MUST print: a silent park is
 * indistinguishable from any other guest wedge, which would defeat the whole
 * point of a named trap. */
static void uart_write_cstr(const char *s) {
    spl_u64 n = 0;
    if (!s) {
        return;
    }
    while (s[n] != 0 && n < 4096ULL) {
        n = n + 1ULL;
    }
    uart_write_bytes(s, n);
}

void rt_trap_unimplemented(const char *symbol) {
    uart_write_cstr("\r\n[TRAP] simple runtime: unimplemented entrypoint `");
    uart_write_cstr(symbol ? symbol : "(null)");
    uart_write_cstr("` was called.\r\n[TRAP] This is a NAMED TRAP stub, not an "
                    "implementation. Core parked.\r\n");
    for (;;) {
        __asm__ __volatile__("wfe");
    }
}

/* ---- stdio siblings of print_raw (3) --------------------------------------
 * The guest has ONE PL011. stderr and stdout are therefore the same sink here;
 * that is a real property of this lane, not a stub. Flushes are no-ops because
 * uart_put_byte stores straight to DR — there is no buffer that could hold a
 * byte back, so "flushed" is already true on return from every write. */
void rt_stderr_write(spl_i64 value) {
    RtString *text = rt_as_string(value);
    spl_i64 rendered;
    if (!text) {
        rendered = rt_to_string(value);
        text = rt_as_string(rendered);
    }
    if (text) {
        uart_write_bytes(text->data, text->len);
    }
}

void rt_stderr_flush(void) {
    /* Unbuffered by construction — see the note above. */
}

void rt_stdout_flush(void) {
    /* Unbuffered by construction — see the note above. */
}

/* ---- env / exit / args (5) ------------------------------------------------
 * A freestanding kernel has no environment block, no argv, and no process to
 * exit from. Each answer below is the TRUE one for this lane, not a placeholder:
 *   rt_env_get  -> "" is exactly what the host returns for an unset variable,
 *                  and every caller in the closure spells it `env_get(k) ?? ""`.
 *   rt_env_set  -> false, i.e. "the set did not happen". Reporting true would
 *                  be the lie, because a later rt_env_get could never see it.
 *   sys_get_args-> an empty [text]; the guest was not handed an argv.
 *   rt_exit     -> there is no parent to report a code to, so it prints the
 *                  code and parks. Returning would let the caller continue past
 *                  an exit(), which is worse than stopping. */
spl_i64 rt_env_get(spl_i64 key_value) {
    (void)key_value;
    return rt_string_new(0, 0);
}

spl_i64 rt_env_set(spl_i64 key_value, spl_i64 value_value) {
    (void)key_value;
    (void)value_value;
    return 0;
}

spl_i64 rt_platform_name(void) {
    static const char name[] = "simpleos";
    return rt_string_new((spl_i64)(spl_u64)name, 8);
}

spl_i64 sys_get_args(void) {
    return rt_array_new(0);
}

/* Codegen's twin of sys_get_args: `get_args()` in Simple lowers to rt_get_args,
 * which no `extern fn` declares (it is one of the 16 second-layer symbols found
 * in Route A step 2). Same REAL freestanding answer for the same reason — this
 * guest was never handed an argv, so an empty [text] is the truth here, not a
 * stub. Promoted out of the step-2 trap block once a live boot showed it was
 * the first symbol main() reaches: src/app/mcp/main.spl:345 calls
 * mcp_get_cli_args() on its very first line. */
spl_i64 rt_get_args(void) {
    return rt_array_new(0);
}

void rt_exit(spl_i64 code) {
    char buf[20];
    spl_u64 len = 0;
    spl_i64 raw = rt_index_arg(code);
    uart_write_cstr("\r\n[EXIT] rt_exit(");
    if (raw < 0) {
        uart_put_byte('-');
    }
    rt_write_decimal(buf, &len, raw < 0 ? (spl_u64)(-raw) : (spl_u64)raw);
    uart_write_bytes(buf, len);
    uart_write_cstr(") - no process model in this lane; core parked.\r\n");
    for (;;) {
        __asm__ __volatile__("wfe");
    }
}

/* ---- atomics / atexit / signal (7) ----------------------------------------
 * The atomics are REAL: __atomic_* are clang builtins, not libc, and lower to
 * AArch64 LDAXR/STLXR (or LSE) inline — they need no runtime support and are
 * correct on this target today, single-core or not. The handle is a pointer to
 * an 8-byte cell from the bump allocator, matching how every other handle in
 * this file is minted.
 *
 * Signals and atexit are honestly ABSENT. SimpleOS has no POSIX signal
 * delivery and no process teardown, and the caller
 * (src/lib/nogc_sync_mut/io/signal_stubs.spl:29,37) reads `installed <= 0` as
 * "not installed" and returns false. Returning 1 here would register a handler
 * that could never fire — a silent lie — so 0 is the honest answer, and
 * rt_signal_check/rt_atexit_check correspondingly report nothing pending. */
spl_i64 rt_atomic_int_new(spl_i64 initial) {
    spl_i64 *cell = (spl_i64 *)rt_alloc((spl_i64)sizeof(spl_i64));
    if (!cell) {
        return 0;
    }
    *cell = rt_index_arg(initial);
    return (spl_i64)(spl_u64)cell;
}

spl_i64 rt_atomic_int_load(spl_i64 handle) {
    spl_i64 *cell = (spl_i64 *)(spl_u64)handle;
    if (!cell) {
        return 0;
    }
    return __atomic_load_n(cell, __ATOMIC_SEQ_CST);
}

spl_i64 rt_atomic_int_compare_exchange(spl_i64 handle, spl_i64 current, spl_i64 new_value) {
    spl_i64 *cell = (spl_i64 *)(spl_u64)handle;
    spl_i64 expected = rt_index_arg(current);
    if (!cell) {
        return 0;
    }
    return __atomic_compare_exchange_n(cell, &expected, rt_index_arg(new_value),
                                       0, __ATOMIC_SEQ_CST, __ATOMIC_SEQ_CST) ? 1 : 0;
}

spl_i64 rt_signal_install(spl_i64 signal_num) {
    (void)signal_num;
    return 0;
}

spl_i64 rt_signal_check(spl_i64 signal_num) {
    (void)signal_num;
    return 0;
}

spl_i64 rt_atexit_install(void) {
    return 0;
}

spl_i64 rt_atexit_check(void) {
    return 0;
}

/* ---- text / utf8 / string index (19) --------------------------------------
 * Pure computation. No host C file implements the rt_utf8_* array forms (they
 * live only in the Rust seed), so these follow the byte-structure table
 * documented in src/lib/common/encoding/utf8.spl:6-10 and the lead-byte
 * classification in its utf8_seq_len() at :45-60, which IS the tree's
 * authority for this codec.
 *
 * SIGNATURE NOTE, worth reading before editing: the rt_utf8_* family takes
 * `[i64]`, NOT `[u8]` — src/lib/common/encoding/utf8.spl:14-16. The arrays are
 * RtArray of TAGGED ints (rt_int(byte)), exactly what rt_text_to_bytes above
 * produces, so every element must go through rt_index_arg. `rt_bytes_to_text`
 * is declared BOTH ways in the closure (`[u8]` at utf8.spl:18, `[i64]` at
 * width_index.spl:19); one C body satisfies both because both are the same
 * RtArray-of-tagged-ints at the ABI. */

static spl_i64 utf8_seq_len_of(spl_u32 lead) {
    if (lead < 0x80U) return 1;
    if (lead < 0xC0U) return 0;   /* continuation byte — invalid as lead */
    if (lead < 0xE0U) return 2;
    if (lead < 0xF0U) return 3;
    if (lead < 0xF8U) return 4;
    return 0;                     /* 5+ byte forms are not UTF-8 */
}

/* Scan `len` bytes and return the index of the first byte that begins (or is
 * part of) an ill-formed sequence, or -1 when the whole range is valid UTF-8.
 * Rejects over-long encodings, surrogates (U+D800..U+DFFF) and values above
 * U+10FFFF, matching the constraints utf8.spl encodes. */
static spl_i64 utf8_scan_invalid(const spl_u8 *data, spl_u64 len) {
    spl_u64 i = 0;
    while (i < len) {
        spl_u32 b0 = data[i];
        spl_i64 need = utf8_seq_len_of(b0);
        spl_u32 cp;
        if (need == 0) {
            return (spl_i64)i;
        }
        if (i + (spl_u64)need > len) {
            return (spl_i64)i;
        }
        if (need == 1) {
            i = i + 1ULL;
            continue;
        }
        for (spl_i64 k = 1; k < need; k = k + 1) {
            if ((data[i + (spl_u64)k] & 0xC0U) != 0x80U) {
                return (spl_i64)i;
            }
        }
        if (need == 2) {
            cp = ((b0 & 0x1FU) << 6) | (data[i + 1] & 0x3FU);
            if (cp < 0x80U) return (spl_i64)i;
        } else if (need == 3) {
            cp = ((b0 & 0x0FU) << 12) | ((data[i + 1] & 0x3FU) << 6) | (data[i + 2] & 0x3FU);
            if (cp < 0x800U) return (spl_i64)i;
            if (cp >= 0xD800U && cp <= 0xDFFFU) return (spl_i64)i;
        } else {
            cp = ((b0 & 0x07U) << 18) | ((data[i + 1] & 0x3FU) << 12) |
                 ((data[i + 2] & 0x3FU) << 6) | (data[i + 3] & 0x3FU);
            if (cp < 0x10000U || cp > 0x10FFFFU) return (spl_i64)i;
        }
        i = i + (spl_u64)need;
    }
    return -1;
}

/* Codepoints == bytes that are not UTF-8 continuation bytes. This is the
 * standard O(n) count and is exact for well-formed input; for ill-formed input
 * it degrades the same way the host's SIMD counter does. */
static spl_i64 utf8_count_cp(const spl_u8 *data, spl_u64 len) {
    spl_i64 count = 0;
    for (spl_u64 i = 0; i < len; i = i + 1ULL) {
        if ((data[i] & 0xC0U) != 0x80U) {
            count = count + 1;
        }
    }
    return count;
}

spl_i64 rt_text_count_codepoints(spl_i64 value) {
    RtString *s = rt_as_string(value);
    return s ? utf8_count_cp((const spl_u8 *)s->data, s->len) : 0;
}

/* No cache: the host's cached variant memoises into the string's spare header
 * word, which this file's RtString does not carry (its `hash` field is owned by
 * rt_hash_text). The ANSWER is identical — only the complexity differs, so this
 * is a real implementation of the contract, not a stub. */
spl_i64 rt_text_count_codepoints_cached(spl_i64 value) {
    return rt_text_count_codepoints(value);
}

spl_i64 rt_text_is_ascii(spl_i64 value) {
    RtString *s = rt_as_string(value);
    if (!s) {
        return 1;
    }
    for (spl_u64 i = 0; i < s->len; i = i + 1ULL) {
        if ((spl_u8)s->data[i] >= 0x80U) {
            return 0;
        }
    }
    return 1;
}

spl_i64 rt_text_validate_utf8(spl_i64 value) {
    RtString *s = rt_as_string(value);
    if (!s) {
        return 1;
    }
    return utf8_scan_invalid((const spl_u8 *)s->data, s->len) < 0 ? 1 : 0;
}

spl_i64 rt_text_to_upper_ascii(spl_i64 value) {
    RtString *s = rt_as_string(value);
    spl_i64 out;
    RtString *dst;
    if (!s) {
        return rt_string_new(0, 0);
    }
    out = rt_string_new((spl_i64)(spl_u64)s->data, (spl_i64)s->len);
    dst = rt_as_string(out);
    if (!dst) {
        return out;
    }
    for (spl_u64 i = 0; i < dst->len; i = i + 1ULL) {
        char c = dst->data[i];
        if (c >= 'a' && c <= 'z') {
            dst->data[i] = (char)(c - 32);
        }
    }
    return out;
}

spl_i64 rt_text_to_lower_ascii(spl_i64 value) {
    RtString *s = rt_as_string(value);
    spl_i64 out;
    RtString *dst;
    if (!s) {
        return rt_string_new(0, 0);
    }
    out = rt_string_new((spl_i64)(spl_u64)s->data, (spl_i64)s->len);
    dst = rt_as_string(out);
    if (!dst) {
        return out;
    }
    for (spl_u64 i = 0; i < dst->len; i = i + 1ULL) {
        char c = dst->data[i];
        if (c >= 'A' && c <= 'Z') {
            dst->data[i] = (char)(c + 32);
        }
    }
    return out;
}

/* The rt_utf8_* trio works on an RtArray of tagged bytes rather than on an
 * RtString, so it reads elements directly instead of going through a copy. */
spl_i64 rt_utf8_count_codepoints(spl_i64 array_value) {
    RtArray *array = rt_as_array(array_value);
    spl_i64 count = 0;
    if (!array) {
        return 0;
    }
    for (spl_u64 i = 0; i < array->len; i = i + 1ULL) {
        if (((spl_u32)(rt_index_arg(array->data[i]) & 0xFF) & 0xC0U) != 0x80U) {
            count = count + 1;
        }
    }
    return count;
}

/* Returns the byte index of the first ill-formed byte, or -1 when the array is
 * entirely valid UTF-8. No host C body exists to port from (the array forms
 * live only in the Rust seed), so the -1-means-valid convention is taken from
 * the name and from how utf8.spl's own scanners report "nothing wrong". Stated
 * here rather than left implicit, because a caller that expected 0-means-valid
 * would silently invert. */
spl_i64 rt_utf8_find_invalid(spl_i64 array_value) {
    RtArray *array = rt_as_array(array_value);
    spl_u64 i = 0;
    if (!array) {
        return -1;
    }
    while (i < array->len) {
        spl_u32 b0 = (spl_u32)(rt_index_arg(array->data[i]) & 0xFF);
        spl_i64 need = utf8_seq_len_of(b0);
        spl_u32 cp;
        if (need == 0 || i + (spl_u64)need > array->len) {
            return (spl_i64)i;
        }
        if (need == 1) {
            i = i + 1ULL;
            continue;
        }
        for (spl_i64 k = 1; k < need; k = k + 1) {
            spl_u32 bk = (spl_u32)(rt_index_arg(array->data[i + (spl_u64)k]) & 0xFF);
            if ((bk & 0xC0U) != 0x80U) {
                return (spl_i64)i;
            }
        }
        {
            spl_u32 b1 = need > 1 ? (spl_u32)(rt_index_arg(array->data[i + 1]) & 0xFF) : 0U;
            spl_u32 b2 = need > 2 ? (spl_u32)(rt_index_arg(array->data[i + 2]) & 0xFF) : 0U;
            spl_u32 b3 = need > 3 ? (spl_u32)(rt_index_arg(array->data[i + 3]) & 0xFF) : 0U;
            if (need == 2) {
                cp = ((b0 & 0x1FU) << 6) | (b1 & 0x3FU);
                if (cp < 0x80U) return (spl_i64)i;
            } else if (need == 3) {
                cp = ((b0 & 0x0FU) << 12) | ((b1 & 0x3FU) << 6) | (b2 & 0x3FU);
                if (cp < 0x800U) return (spl_i64)i;
                if (cp >= 0xD800U && cp <= 0xDFFFU) return (spl_i64)i;
            } else {
                cp = ((b0 & 0x07U) << 18) | ((b1 & 0x3FU) << 12) |
                     ((b2 & 0x3FU) << 6) | (b3 & 0x3FU);
                if (cp < 0x10000U || cp > 0x10FFFFU) return (spl_i64)i;
            }
        }
        i = i + (spl_u64)need;
    }
    return -1;
}

spl_i64 rt_utf8_validate(spl_i64 array_value) {
    return rt_utf8_find_invalid(array_value) < 0 ? 1 : 0;
}

/* Inverse of rt_text_to_bytes above: RtArray of tagged bytes -> RtString.
 * Byte-for-byte copy with no re-encoding, which is the documented contract at
 * src/lib/common/encoding/utf8.spl:18. */
spl_i64 rt_bytes_to_text(spl_i64 array_value) {
    RtArray *array = rt_as_array(array_value);
    RtString *out;
    spl_i64 value;
    if (!array) {
        return rt_string_new(0, 0);
    }
    value = rt_string_new(0, (spl_i64)array->len);
    out = rt_as_string(value);
    if (!out) {
        return value;
    }
    for (spl_u64 i = 0; i < array->len; i = i + 1ULL) {
        out->data[i] = (char)(rt_index_arg(array->data[i]) & 0xFF);
    }
    out->data[array->len] = 0;
    return value;
}

/* Bulk i64 copy: dst[0..count) <- src[0..count). Returns 1 on a full copy, 0
 * when either side is not an array or is too short — never a partial success
 * reported as success. Elements are copied as RAW SLOTS (already-tagged
 * values), which is what the declaring comment at
 * src/lib/nogc_sync_mut/simd.spl:38-40 means by "copies count i64 elements at
 * the runtime level". */
spl_i64 rt_array_extend_i64(spl_i64 dst_value, spl_i64 src_value, spl_i64 count_value) {
    RtArray *dst = rt_as_array(dst_value);
    RtArray *src = rt_as_array(src_value);
    spl_i64 count = rt_index_arg(count_value);
    if (!dst || !src || count < 0) {
        return 0;
    }
    if ((spl_u64)count > src->len) {
        return 0;
    }
    for (spl_i64 i = 0; i < count; i = i + 1) {
        if (!rt_array_push(dst_value, src->data[i])) {
            return 0;
        }
    }
    return 1;
}

/* ---- Segmented Width Index / rank-select ----------------------------------
 * Both handle families answer the SAME question — the byte<->codepoint index
 * mapping — and differ on the host only in the acceleration structure they
 * build. Here the handle is a small record pinning the string, and the queries
 * scan. The RESULTS are exactly the host's; only the complexity is O(n)
 * instead of O(log B) / O(1). That is a real implementation of the contract,
 * which is a mapping, not a complexity guarantee — stated explicitly so nobody
 * later mistakes it for a stub and deletes it.
 *
 * `*_free` is a no-op: rt_alloc above is a bump allocator with no reclaim (see
 * rt_free at :133, which is already a no-op for every other object here).
 * Handles are raw pointers, so a caller's `handle > 0` test behaves. */
typedef struct RtTextIndex {
    RtString *s;
} RtTextIndex;

static spl_i64 rt_text_index_build(spl_i64 value) {
    RtString *s = rt_as_string(value);
    RtTextIndex *idx;
    if (!s) {
        return 0;
    }
    idx = (RtTextIndex *)rt_alloc((spl_i64)sizeof(RtTextIndex));
    if (!idx) {
        return 0;
    }
    idx->s = s;
    return (spl_i64)(spl_u64)idx;
}

/* char_idx -> byte offset. -1 when out of range, which both callers
 * (width_index.spl:68,74) treat as "ask the other structure / fall back". */
static spl_i64 rt_text_index_char_to_byte(spl_i64 handle, spl_i64 char_idx_value) {
    RtTextIndex *idx = (RtTextIndex *)(spl_u64)handle;
    spl_i64 want = rt_index_arg(char_idx_value);
    spl_i64 seen = 0;
    if (!idx || !idx->s || want < 0) {
        return -1;
    }
    for (spl_u64 i = 0; i < idx->s->len; i = i + 1ULL) {
        if (((spl_u8)idx->s->data[i] & 0xC0U) != 0x80U) {
            if (seen == want) {
                return (spl_i64)i;
            }
            seen = seen + 1;
        }
    }
    return -1;
}

/* byte offset -> number of whole codepoints before it (the rank). -1 when the
 * offset is past the end. */
static spl_i64 rt_text_index_byte_to_char(spl_i64 handle, spl_i64 byte_idx_value) {
    RtTextIndex *idx = (RtTextIndex *)(spl_u64)handle;
    spl_i64 want = rt_index_arg(byte_idx_value);
    spl_i64 seen = 0;
    if (!idx || !idx->s || want < 0) {
        return -1;
    }
    if ((spl_u64)want > idx->s->len) {
        return -1;
    }
    for (spl_i64 i = 0; i < want; i = i + 1) {
        if (((spl_u8)idx->s->data[i] & 0xC0U) != 0x80U) {
            seen = seen + 1;
        }
    }
    return seen;
}

spl_i64 rt_swi_build(spl_i64 value) {
    return rt_text_index_build(value);
}

spl_i64 rt_swi_char_to_byte(spl_i64 handle, spl_i64 char_idx) {
    return rt_text_index_char_to_byte(handle, char_idx);
}

spl_i64 rt_swi_byte_to_char(spl_i64 handle, spl_i64 byte_idx) {
    return rt_text_index_byte_to_char(handle, byte_idx);
}

void rt_swi_free(spl_i64 handle) {
    (void)handle;   /* bump allocator: no reclaim — see rt_free at :133 */
}

spl_i64 rt_rank_select_build(spl_i64 value) {
    return rt_text_index_build(value);
}

spl_i64 rt_rank_query(spl_i64 handle, spl_i64 byte_pos) {
    return rt_text_index_byte_to_char(handle, byte_pos);
}

spl_i64 rt_select_query(spl_i64 handle, spl_i64 char_idx) {
    return rt_text_index_char_to_byte(handle, char_idx);
}

void rt_rank_select_free(spl_i64 handle) {
    (void)handle;
}

/* ---- sqrt (1) -------------------------------------------------------------
 * libm's name, but no libm is needed: AArch64 has FSQRT as a single
 * instruction and clang lowers __builtin_sqrt to it with -ffreestanding. */
double sqrt(double x) {
    return __builtin_sqrt(x);
}

/* ---- rt_simd_* (49) -------------------------------------------------------
 * SPLIT DELIBERATELY, and the split is the whole point of this block.
 *
 * (a) CAPABILITY PROBES AND STRING SEARCH — real answers.
 *     The probes report SCALAR / no-accelerator. That is not a claim about the
 *     CPU (a cortex-a72 obviously has NEON); it is a claim about THIS LANE,
 *     which ships no vector kernels at all — see (b). Reporting NEON available
 *     would route std.simd's dispatchers straight into the traps below, which
 *     is precisely the failure the probes exist to prevent. Tier codes are
 *     std.simd's own: 0=scalar, 1=SSE2, 2=AVX2, 4=NEON, 7=RVV
 *     (src/lib/nogc_sync_mut/simd.spl:55-60).
 *     rt_simd_str_search is a real scalar substring search with the host's
 *     exact contract (src/runtime/runtime_simd_search.c:550): byte offset of
 *     the first occurrence, 0 for an empty needle, -1 when absent.
 *
 * (b) ARITHMETIC / LANE KERNELS — NAMED TRAPS, on purpose.
 *     These take and return Vec4f/Vec8i/... — CLASS values whose native
 *     representation this freestanding runtime cannot construct: it knows only
 *     String/Array/Tuple/Enum (RT_HEAP_* above), and the seed's own authority
 *     for the type is a field-bearing object
 *     (src/compiler_rust/compiler/src/interpreter_extern/simd.rs:619-636,
 *     class "Vec4f" with x/y/z/w). Guessing that layout and returning a
 *     plausible vector would be silent numeric corruption, which the tree
 *     already has a written policy against — see
 *     src/compiler/70.backend/backend/simpleos_native_symbols.spl:158-163:
 *     "`rt_simd_` ... is dominated by ARITHMETIC kernels ... where nil is
 *     silent numeric corruption, not 'unavailable'". Only the capability
 *     probes are allowlisted there, by exact name, and that is exactly the
 *     line drawn here.
 *     Note also that on the native path most of these names never become calls
 *     at all: src/compiler/60.mir_opt/mir_opt/simd_lowering.spl:96-160 rewrites
 *     them into MIR SIMD instructions. The trap bodies are the link surface for
 *     the paths where lowering does NOT fire, and are meant never to execute. */
spl_i64 rt_simd_has_sse(void) { return 0; }
spl_i64 rt_simd_has_avx(void) { return 0; }
spl_i64 rt_simd_has_avx2(void) { return 0; }
spl_i64 rt_simd_has_neon(void) { return 0; }
spl_i64 rt_simd_has_rvv(void) { return 0; }

spl_i64 rt_simd_detect_profile(void) {
    return 0;   /* SimdTier.scalar */
}

spl_i64 rt_simd_profile_name(void) {
    static const char name[] = "scalar";
    return rt_string_new((spl_i64)(spl_u64)name, 6);
}

spl_i64 rt_simd_str_search(spl_i64 haystack_value, spl_i64 needle_value) {
    RtString *h = rt_as_string(haystack_value);
    RtString *n = rt_as_string(needle_value);
    if (!h) {
        return -1;
    }
    if (!n || n->len == 0) {
        return 0;
    }
    if (n->len > h->len) {
        return -1;
    }
    for (spl_u64 i = 0; i + n->len <= h->len; i = i + 1ULL) {
        spl_u64 k = 0;
        while (k < n->len && h->data[i + k] == n->data[k]) {
            k = k + 1ULL;
        }
        if (k == n->len) {
            return (spl_i64)i;
        }
    }
    return -1;
}

/* The 41 vector kernels. Each is a distinct named trap so a serial transcript
 * names the exact operation that was reached. Arity is irrelevant to an
 * AAPCS64 trap that never returns, so one macro shape covers all of them. */
#define SPL_SIMD_TRAP(name)                                   \
    spl_i64 name(spl_i64 a, spl_i64 b, spl_i64 c) {           \
        (void)a; (void)b; (void)c;                            \
        rt_trap_unimplemented(#name);                         \
        return 0;                                             \
    }

SPL_SIMD_TRAP(rt_simd_add_f32x4)
SPL_SIMD_TRAP(rt_simd_sub_f32x4)
SPL_SIMD_TRAP(rt_simd_mul_f32x4)
SPL_SIMD_TRAP(rt_simd_div_f32x4)
SPL_SIMD_TRAP(rt_simd_fma_f32x4)
SPL_SIMD_TRAP(rt_simd_add_f32x8)
SPL_SIMD_TRAP(rt_simd_sub_f32x8)
SPL_SIMD_TRAP(rt_simd_mul_f32x8)
SPL_SIMD_TRAP(rt_simd_div_f32x8)
SPL_SIMD_TRAP(rt_simd_fma_f32x8)
SPL_SIMD_TRAP(rt_simd_add_f64x4)
SPL_SIMD_TRAP(rt_simd_sub_f64x4)
SPL_SIMD_TRAP(rt_simd_mul_f64x4)
SPL_SIMD_TRAP(rt_simd_div_f64x4)
SPL_SIMD_TRAP(rt_simd_fma_f64x4)
SPL_SIMD_TRAP(rt_simd_add_i32x4)
SPL_SIMD_TRAP(rt_simd_sub_i32x4)
SPL_SIMD_TRAP(rt_simd_mul_i32x4)
SPL_SIMD_TRAP(rt_simd_and_i32x4)
SPL_SIMD_TRAP(rt_simd_or_i32x4)
SPL_SIMD_TRAP(rt_simd_xor_i32x4)
SPL_SIMD_TRAP(rt_simd_shl_i32x4)
SPL_SIMD_TRAP(rt_simd_shr_i32x4)
SPL_SIMD_TRAP(rt_simd_add_i32x8)
SPL_SIMD_TRAP(rt_simd_sub_i32x8)
SPL_SIMD_TRAP(rt_simd_mul_i32x8)
SPL_SIMD_TRAP(rt_simd_and_i32x8)
SPL_SIMD_TRAP(rt_simd_or_i32x8)
SPL_SIMD_TRAP(rt_simd_xor_i32x8)
SPL_SIMD_TRAP(rt_simd_shl_i32x8)
SPL_SIMD_TRAP(rt_simd_shr_i32x8)
SPL_SIMD_TRAP(rt_simd_add_i64x4)
SPL_SIMD_TRAP(rt_simd_sub_i64x4)
SPL_SIMD_TRAP(rt_simd_add_u32x4)
SPL_SIMD_TRAP(rt_simd_sub_u32x4)
SPL_SIMD_TRAP(rt_simd_and_u32x4)
SPL_SIMD_TRAP(rt_simd_or_u32x4)
SPL_SIMD_TRAP(rt_simd_xor_u32x4)
SPL_SIMD_TRAP(rt_simd_hadd_f32x4)
SPL_SIMD_TRAP(rt_simd_hmax_f32x4)
SPL_SIMD_TRAP(rt_simd_hmin_f32x4)

#undef SPL_SIMD_TRAP

/* ---- P10 remainder: the 56 named traps (Route A step 1, 2026-08-24) --------
 * Link closure, NOT implementation. Each is a distinct named trap so a serial
 * transcript names the exact entrypoint that was reached — the same shape as
 * the 41 SIMD kernels above, and the same reason: a returned value would be
 * the silent-nil class this repo has already been bitten by twice
 * (doc/08_tracking/bug/unregistered_extern_silent_nil_2026-08-01.md, and the
 * rt_unwrap_or_trap NULL-GOT SEGV in
 * doc/08_tracking/bug/stage3_native_build_and_compile_segv_on_hello_world_2026-08-18.md).
 *
 * WHY TRAPPING ALL 56 IS SAFE TODAY, measured rather than assumed: none is on
 * a path this kernel executes, and none is on the M1 acceptance path either.
 * `main()`'s startup, serve loop, and `initialize` touch only get_args,
 * env_get, exit, stderr_write/stderr_flush, stdin_read_char and print_raw —
 * all six implemented for real above. `tools/list` is answered from a local
 * static payload. The only file_exists consumer, _mcp_find_simple_binary, is
 * reachable exclusively from `tools/call` (src/app/mcp/cli_passthrough.spl:21,
 * dap_bridge.spl:147, main_lazy_diag_tools.spl:137,261,
 * main_lazy_query_tools.spl:335). So the first thing any of these traps can
 * possibly interrupt is a tools/call — which is precisely the milestone that
 * still needs the real subsystem.
 *
 * Arity is irrelevant to an AAPCS64 function that never returns, so one macro
 * shape covers all 56 regardless of each symbol's real signature. */
#define SPL_P10_TRAP(name)                                    \
    spl_i64 name(spl_i64 a, spl_i64 b, spl_i64 c) {           \
        (void)a; (void)b; (void)c;                            \
        rt_trap_unimplemented(#name);                         \
        return 0;                                             \
    }

/* filesystem — rt_file_* / rt_dir_* (29) */
SPL_P10_TRAP(rt_dir_create)
SPL_P10_TRAP(rt_dir_create_all)
SPL_P10_TRAP(rt_dir_exists)
SPL_P10_TRAP(rt_dir_list)
SPL_P10_TRAP(rt_dir_remove)
SPL_P10_TRAP(rt_dir_remove_all)
SPL_P10_TRAP(rt_dir_walk)
SPL_P10_TRAP(rt_file_append_text)
SPL_P10_TRAP(rt_file_atomic_write)
SPL_P10_TRAP(rt_file_copy)
SPL_P10_TRAP(rt_file_delete)
SPL_P10_TRAP(rt_file_exists)
SPL_P10_TRAP(rt_file_hash_sha256)
SPL_P10_TRAP(rt_file_is_char_device)
SPL_P10_TRAP(rt_file_is_regular_no_follow)
SPL_P10_TRAP(rt_file_lock)
SPL_P10_TRAP(rt_file_mmap_read_bytes)
SPL_P10_TRAP(rt_file_mmap_read_text)
SPL_P10_TRAP(rt_file_move)
SPL_P10_TRAP(rt_file_read_bytes)
SPL_P10_TRAP(rt_file_read_text)
SPL_P10_TRAP(rt_file_read_text_at_checked)
SPL_P10_TRAP(rt_file_rename)
SPL_P10_TRAP(rt_file_size)
SPL_P10_TRAP(rt_file_stat)
SPL_P10_TRAP(rt_file_unlock)
SPL_P10_TRAP(rt_file_write_bytes)
SPL_P10_TRAP(rt_file_write_text)
SPL_P10_TRAP(rt_file_write_text_at)

/* process (18) */
SPL_P10_TRAP(rt_getpid)
SPL_P10_TRAP(rt_process_close_piped)
SPL_P10_TRAP(rt_process_is_alive)
SPL_P10_TRAP(rt_process_is_alive_checked)
SPL_P10_TRAP(rt_process_is_running)
SPL_P10_TRAP(rt_process_kill)
SPL_P10_TRAP(rt_process_read_stdout)
SPL_P10_TRAP(rt_process_read_stdout_checked)
SPL_P10_TRAP(rt_process_run)
SPL_P10_TRAP(rt_process_run_bounded)
SPL_P10_TRAP(rt_process_run_timeout)
SPL_P10_TRAP(rt_process_spawn_async)
SPL_P10_TRAP(rt_process_spawn_piped)
SPL_P10_TRAP(rt_process_wait)
SPL_P10_TRAP(rt_process_write_stdin)
SPL_P10_TRAP(rt_process_write_stdin_some)
SPL_P10_TRAP(rt_shell_exec)
SPL_P10_TRAP(spl_thread_cpu_count)

/* memory mapping (4) */
SPL_P10_TRAP(rt_madvise)
SPL_P10_TRAP(rt_mmap)
SPL_P10_TRAP(rt_msync)
SPL_P10_TRAP(rt_munmap)

/* time / thread (3) */
SPL_P10_TRAP(rt_thread_sleep)
SPL_P10_TRAP(rt_time_now_monotonic_ms)
SPL_P10_TRAP(rt_time_now_unix_micros)

/* browser renderer (2) */
SPL_P10_TRAP(rt_browser_renderer_sandbox_enter)
SPL_P10_TRAP(rt_browser_renderer_spawn_sandboxed)

#undef SPL_P10_TRAP

/* ---- P10 SECOND LAYER: the 16 UNDECLARED symbols (Route A step 2, 2026-08-24)
 * ---------------------------------------------------------------------------
 * These are the "not the total ABI bill" caveat, now measured. NO `extern fn`
 * anywhere in the transitive `use` closure of src/app/mcp/main.spl declares a
 * single one of them — they are emitted by CODEGEN for built-in method syntax
 * (`.to_upper()`, `.find()`, `.sort()`, dict literals, ...), so every
 * extern-based inventory, including this file's own 150-symbol one, was blind
 * to them by construction. They surfaced only when the MCP module graph was
 * actually compiled for this target.
 *
 * This is the symbol family of
 * doc/08_tracking/bug/stage3_native_build_and_compile_segv_on_hello_world_2026-08-18.md
 * (rt_unwrap_or_trap / NULL GOT slot). One difference worth recording, because
 * it is load-bearing and favourable: on THIS lane the link is fail-CLOSED.
 * ld.lld reported `undefined symbol: rt_text_find` and friends and exited
 * non-zero; it did not silently emit a null GOT slot to fault later. The
 * freestanding link names the gap instead of deferring it to runtime.
 *
 * MEASURED DEPTH: exactly ONE layer. Defining these 16 closes the link
 * (rc 0); no third layer appeared. 150 declared + 16 undeclared = 166 is the
 * complete ABI bill for the MCP graph on this route.
 *
 * All 16 are NAMED TRAPS, for link closure, on the same terms as the 56 above
 * — a returned value would be the silent-nil class. They are NOT equivalent
 * in difficulty, and grouping them honestly is the point of the buckets below:
 * the 12 string/array/args entries are pure computation and are the obvious
 * next increment, whereas rt_dict_new needs a heap kind this runtime does not
 * have (it knows RT_HEAP_STRING/ARRAY/TUPLE/ENUM only) and the 2 filesystem
 * entries need the same absent subsystem as the 29 above.
 *
 * CONSEQUENCE, stated plainly: a kernel with these as traps LINKS and BOOTS
 * but CANNOT answer an MCP request. rt_text_find is reached from
 * app__mcp__main_lazy_json___find_json_value_start, i.e. JSON parsing, which
 * is on the `initialize` path. Step 2 delivers a built-in, entered MCP graph
 * and a measured bill — not a round trip. Step 3 stays blocked until the
 * string/array dozen are real. */
#define SPL_P10L2_TRAP(name)                                  \
    spl_i64 name(spl_i64 a, spl_i64 b, spl_i64 c) {           \
        (void)a; (void)b; (void)c;                            \
        rt_trap_unimplemented(#name);                         \
        return 0;                                             \
    }

/* string / text primitives — 7 promoted to real implementations above,
 * these 3 remain traps (numeric parsing needs care, not just bytes) */
SPL_P10L2_TRAP(rt_string_to_float)
SPL_P10L2_TRAP(rt_string_to_int_lenient)
SPL_P10L2_TRAP(rt_value_as_float)

/* array primitives — rt_array_copy promoted to a real implementation below;
 * rt_array_sort remains a trap (an ordering predicate is not a byte loop) */
SPL_P10L2_TRAP(rt_array_sort)

/* dict — a heap kind this runtime does not have (1) */
SPL_P10L2_TRAP(rt_dict_new)

/* filesystem, same reason as the 29 above (2) */
SPL_P10L2_TRAP(rt_file_read_text_rv)
SPL_P10L2_TRAP(rt_file_remove)

#undef SPL_P10L2_TRAP

/* ---- Route A step 3: string/array primitives, REAL implementations --------
 * These are seven of the 16 undeclared codegen symbols found in step 2. They
 * are promoted out of the trap block because they are pure computation over
 * memory this runtime already owns — no subsystem is missing for them, so a
 * trap would be understating what this lane can do.
 *
 * Every one is a FAITHFUL PORT of the host semantics in
 * src/runtime/runtime_native.c (rt_text_find :3860, rt_string_rfind :3875,
 * rt_string_char_at :2918, rt_string_replace, rt_index_of, and the
 * rt_string_ascii_case pair), including the edge cases that are easy to get
 * subtly wrong and that a caller cannot detect: empty-needle returns `start`
 * (clamped to len) rather than -1 or 0; a negative `start` clamps to 0; an
 * out-of-range index yields nil, not an empty string; replace returns the
 * ORIGINAL value unchanged when the needle is empty or absent, rather than a
 * fresh copy. Divergence here would be the silent-wrong-value class, which is
 * strictly worse than the traps these replace. */

static spl_i64 rt_bytes_eq(const char *a, const char *b, spl_u64 n) {
    for (spl_u64 i = 0; i < n; i = i + 1) {
        if (a[i] != b[i]) {
            return 0;
        }
    }
    return 1;
}

/* Uninitialised string of exactly `len` bytes, header filled, NUL-terminated.
 * Mirrors rt_string_new's header setup; exists so replace() can write its
 * result once instead of building it in a scratch buffer and copying. */
static RtString *rt_string_alloc(spl_u64 len) {
    RtString *out = (RtString *)rt_alloc((spl_i64)(sizeof(RtString) + len + 1));
    if (!out) {
        return 0;
    }
    out->header.object_type = RT_HEAP_STRING;
    out->header.gc_flags = 0;
    out->header.reserved = 0;
    out->header.size = (spl_u32)(sizeof(RtString) + len);
    out->len = len;
    out->hash = 0;
    out->data[len] = 0;
    return out;
}

spl_i64 rt_text_find(spl_i64 value, spl_i64 needle, spl_i64 start) {
    RtString *s = rt_as_string(value);
    RtString *n = rt_as_string(needle);
    if (!s || !n) {
        return -1;
    }
    if (start < 0) {
        start = 0;
    }
    if (n->len == 0) {
        return start <= (spl_i64)s->len ? start : (spl_i64)s->len;
    }
    if (start >= (spl_i64)s->len || n->len > s->len) {
        return -1;
    }
    for (spl_u64 i = (spl_u64)start; i + n->len <= s->len; i = i + 1) {
        if (rt_bytes_eq(s->data + i, n->data, n->len)) {
            return (spl_i64)i;
        }
    }
    return -1;
}

spl_i64 rt_string_rfind(spl_i64 value, spl_i64 needle) {
    RtString *s = rt_as_string(value);
    RtString *n = rt_as_string(needle);
    if (!s || !n) {
        return -1;
    }
    if (n->len == 0) {
        return (spl_i64)s->len;
    }
    if (n->len > s->len) {
        return -1;
    }
    for (spl_u64 i = s->len - n->len + 1; i-- > 0;) {
        if (rt_bytes_eq(s->data + i, n->data, n->len)) {
            return (spl_i64)i;
        }
    }
    return -1;
}

spl_i64 rt_string_char_at(spl_i64 string, spl_i64 index) {
    RtString *s = rt_as_string(string);
    if (!s || index < 0 || (spl_u64)index >= s->len) {
        return rt_nil();
    }
    return rt_string_new((spl_i64)(spl_u64)(const spl_u8 *)(s->data + index), 1);
}

static spl_i64 rt_string_ascii_case(spl_i64 value, int to_lower) {
    RtString *s = rt_as_string(value);
    if (!s) {
        return value;
    }
    RtString *out = rt_string_alloc(s->len);
    if (!out) {
        return rt_nil();
    }
    for (spl_u64 i = 0; i < s->len; i = i + 1) {
        char c = s->data[i];
        if (to_lower) {
            out->data[i] = (c >= 'A' && c <= 'Z') ? (char)(c + 32) : c;
        } else {
            out->data[i] = (c >= 'a' && c <= 'z') ? (char)(c - 32) : c;
        }
    }
    return rt_heap(out);
}

spl_i64 rt_string_to_lower(spl_i64 value) {
    return rt_string_ascii_case(value, 1);
}

spl_i64 rt_string_to_upper(spl_i64 value) {
    return rt_string_ascii_case(value, 0);
}

/* Host contract (runtime_native.c): try the ARRAY interpretation first, fall
 * back to a string find from 0. Kept in that order deliberately — reversing it
 * would make an array of strings search its own bytes. */
spl_i64 rt_index_of(spl_i64 haystack, spl_i64 needle) {
    RtArray *a = rt_as_array(haystack);
    if (a) {
        for (spl_u64 i = 0; i < a->len; i = i + 1) {
            if (a->data[i] == needle) {
                return (spl_i64)i;
            }
            RtString *ea = rt_as_string(a->data[i]);
            RtString *en = rt_as_string(needle);
            if (ea && en && ea->len == en->len
                && rt_bytes_eq(ea->data, en->data, ea->len)) {
                return (spl_i64)i;
            }
        }
        return -1;
    }
    return rt_text_find(haystack, needle, 0);
}

/* Shallow copy of an array's backing buffer: a new array of the same length
 * with every element copied. Matches src/runtime/runtime_native.c:6960 and
 * simple_runtime::value::collections::rt_array_copy. This lane's RtArray has
 * no byte/u64-packed flag variants, so the flag branches of the host version
 * collapse to the single i64-element case.
 *
 * Reached because MIR lowering turns `var c = arr` into rt_array_copy(vreg)
 * (the array-place-alias-copy fix). Promoted out of the step-2 trap block once
 * a live boot showed the second `tools/list` — the one that serves the full
 * cached tool set — reaching it. Returning the ORIGINAL array on a non-array
 * input matches the host, and matters: it is what makes the alias-copy a no-op
 * for values that are not arrays, rather than nil.
 *
 * NOTE the length contract: rt_array_new() takes a CAPACITY and returns an
 * array with len 0 (and a floor of 4), so `len` must be assigned explicitly
 * after copying — copying elements alone would produce a correctly-populated
 * buffer that every caller reads as empty. */
spl_i64 rt_array_copy(spl_i64 array_value) {
    RtArray *src = rt_as_array(array_value);
    if (!src) {
        return array_value;
    }
    spl_i64 out_value = rt_array_new((spl_i64)src->len);
    RtArray *out = rt_as_array(out_value);
    if (!out) {
        return out_value;
    }
    for (spl_u64 i = 0; i < src->len; i = i + 1) {
        out->data[i] = src->data[i];
    }
    out->len = src->len;
    return out_value;
}

spl_i64 rt_string_replace(spl_i64 value, spl_i64 old_value, spl_i64 new_value) {
    RtString *s = rt_as_string(value);
    RtString *o = rt_as_string(old_value);
    RtString *w = rt_as_string(new_value);
    if (!s || !o || !w) {
        return value;
    }
    if (o->len == 0 || o->len > s->len) {
        return value;
    }
    spl_u64 count = 0;
    for (spl_u64 i = 0; i + o->len <= s->len;) {
        if (rt_bytes_eq(s->data + i, o->data, o->len)) {
            count = count + 1;
            i = i + o->len;
        } else {
            i = i + 1;
        }
    }
    if (count == 0) {
        return value;
    }
    spl_u64 out_len;
    if (w->len >= o->len) {
        out_len = s->len + count * (w->len - o->len);
    } else {
        out_len = s->len - count * (o->len - w->len);
    }
    RtString *out = rt_string_alloc(out_len);
    if (!out) {
        return rt_nil();
    }
    spl_u64 in_i = 0;
    spl_u64 out_i = 0;
    while (in_i < s->len) {
        if (o->len <= s->len - in_i && rt_bytes_eq(s->data + in_i, o->data, o->len)) {
            for (spl_u64 k = 0; k < w->len; k = k + 1) {
                out->data[out_i + k] = w->data[k];
            }
            out_i = out_i + w->len;
            in_i = in_i + o->len;
        } else {
            out->data[out_i] = s->data[in_i];
            out_i = out_i + 1;
            in_i = in_i + 1;
        }
    }
    return rt_heap(out);
}

/* ---- --gc-sections keepalive ----------------------------------------------
 * WHY THIS EXISTS, and why deleting it silently undoes this whole section:
 * the link runs with --gc-sections and -ffunction-sections, so a symbol that
 * nothing live REFERENCES is discarded from kernel.elf even though it compiled
 * cleanly. Measured during P8: nm showed stdin_read_char present while
 * rt_stdin_read_char and rt_aarch64_uart_try_get had been GC'd, the difference
 * being solely that the boot probe called one of them.
 *
 * Nothing in the current kernel calls any P10 symbol — the MCP module graph is
 * not built into this kernel yet (that is P6/P11) — so without a root, every
 * function above would vanish and the nm evidence would be empty.
 *
 * It takes ADDRESSES and never calls them. Calling would be wrong twice over:
 * rt_exit parks the core, and the 41 SIMD entries are traps. A volatile read
 * of the table defeats constant-folding, so the references survive -O2.
 * Returns the number of symbols pinned, which the boot probe prints. */
static void *const g_p10_keepalive[] = {
    (void *)rt_trap_unimplemented,
    (void *)rt_stderr_write, (void *)rt_stderr_flush, (void *)rt_stdout_flush,
    (void *)rt_env_get, (void *)rt_env_set, (void *)rt_platform_name,
    (void *)sys_get_args, (void *)rt_exit,
    (void *)rt_atomic_int_new, (void *)rt_atomic_int_load,
    (void *)rt_atomic_int_compare_exchange,
    (void *)rt_signal_install, (void *)rt_signal_check,
    (void *)rt_atexit_install, (void *)rt_atexit_check,
    (void *)rt_text_count_codepoints, (void *)rt_text_count_codepoints_cached,
    (void *)rt_text_is_ascii, (void *)rt_text_validate_utf8,
    (void *)rt_text_to_upper_ascii, (void *)rt_text_to_lower_ascii,
    (void *)rt_utf8_count_codepoints, (void *)rt_utf8_validate,
    (void *)rt_utf8_find_invalid, (void *)rt_bytes_to_text,
    (void *)rt_array_extend_i64,
    (void *)rt_swi_build, (void *)rt_swi_char_to_byte,
    (void *)rt_swi_byte_to_char, (void *)rt_swi_free,
    (void *)rt_rank_select_build, (void *)rt_rank_query,
    (void *)rt_select_query, (void *)rt_rank_select_free,
    (void *)sqrt,
    (void *)rt_simd_has_sse, (void *)rt_simd_has_avx, (void *)rt_simd_has_avx2,
    (void *)rt_simd_has_neon, (void *)rt_simd_has_rvv,
    (void *)rt_simd_detect_profile, (void *)rt_simd_profile_name,
    (void *)rt_simd_str_search,
    (void *)rt_simd_add_f32x4, (void *)rt_simd_sub_f32x4,
    (void *)rt_simd_mul_f32x4, (void *)rt_simd_div_f32x4,
    (void *)rt_simd_fma_f32x4,
    (void *)rt_simd_add_f32x8, (void *)rt_simd_sub_f32x8,
    (void *)rt_simd_mul_f32x8, (void *)rt_simd_div_f32x8,
    (void *)rt_simd_fma_f32x8,
    (void *)rt_simd_add_f64x4, (void *)rt_simd_sub_f64x4,
    (void *)rt_simd_mul_f64x4, (void *)rt_simd_div_f64x4,
    (void *)rt_simd_fma_f64x4,
    (void *)rt_simd_add_i32x4, (void *)rt_simd_sub_i32x4,
    (void *)rt_simd_mul_i32x4, (void *)rt_simd_and_i32x4,
    (void *)rt_simd_or_i32x4, (void *)rt_simd_xor_i32x4,
    (void *)rt_simd_shl_i32x4, (void *)rt_simd_shr_i32x4,
    (void *)rt_simd_add_i32x8, (void *)rt_simd_sub_i32x8,
    (void *)rt_simd_mul_i32x8, (void *)rt_simd_and_i32x8,
    (void *)rt_simd_or_i32x8, (void *)rt_simd_xor_i32x8,
    (void *)rt_simd_shl_i32x8, (void *)rt_simd_shr_i32x8,
    (void *)rt_simd_add_i64x4, (void *)rt_simd_sub_i64x4,
    (void *)rt_simd_add_u32x4, (void *)rt_simd_sub_u32x4,
    (void *)rt_simd_and_u32x4, (void *)rt_simd_or_u32x4,
    (void *)rt_simd_xor_u32x4,
    (void *)rt_simd_hadd_f32x4, (void *)rt_simd_hmax_f32x4,
    (void *)rt_simd_hmin_f32x4,
    /* --- the 56 P10-remainder traps (2026-08-24). Same reason as every entry
     * above: nothing live calls them, so without this table --gc-sections
     * discards all 56 and `nm` on kernel.elf would show the link closure that
     * was just added as absent. Addresses only — these PARK THE CORE if
     * called. --- */
    /* filesystem — rt_file_* / rt_dir_* (29) */
    (void *)rt_dir_create, (void *)rt_dir_create_all,
    (void *)rt_dir_exists, (void *)rt_dir_list,
    (void *)rt_dir_remove, (void *)rt_dir_remove_all,
    (void *)rt_dir_walk, (void *)rt_file_append_text,
    (void *)rt_file_atomic_write, (void *)rt_file_copy,
    (void *)rt_file_delete, (void *)rt_file_exists,
    (void *)rt_file_hash_sha256, (void *)rt_file_is_char_device,
    (void *)rt_file_is_regular_no_follow, (void *)rt_file_lock,
    (void *)rt_file_mmap_read_bytes, (void *)rt_file_mmap_read_text,
    (void *)rt_file_move, (void *)rt_file_read_bytes,
    (void *)rt_file_read_text, (void *)rt_file_read_text_at_checked,
    (void *)rt_file_rename, (void *)rt_file_size,
    (void *)rt_file_stat, (void *)rt_file_unlock,
    (void *)rt_file_write_bytes, (void *)rt_file_write_text,
    (void *)rt_file_write_text_at,
    /* process (18) */
    (void *)rt_getpid, (void *)rt_process_close_piped,
    (void *)rt_process_is_alive, (void *)rt_process_is_alive_checked,
    (void *)rt_process_is_running, (void *)rt_process_kill,
    (void *)rt_process_read_stdout, (void *)rt_process_read_stdout_checked,
    (void *)rt_process_run, (void *)rt_process_run_bounded,
    (void *)rt_process_run_timeout, (void *)rt_process_spawn_async,
    (void *)rt_process_spawn_piped, (void *)rt_process_wait,
    (void *)rt_process_write_stdin, (void *)rt_process_write_stdin_some,
    (void *)rt_shell_exec, (void *)spl_thread_cpu_count,
    /* memory mapping (4) */
    (void *)rt_madvise, (void *)rt_mmap,
    (void *)rt_msync, (void *)rt_munmap,
    /* time / thread (3) */
    (void *)rt_thread_sleep, (void *)rt_time_now_monotonic_ms,
    (void *)rt_time_now_unix_micros,
    /* browser renderer (2) */
    (void *)rt_browser_renderer_sandbox_enter, (void *)rt_browser_renderer_spawn_sandboxed,
    /* --- the 16 undeclared second-layer traps (Route A step 2). Same
     * --gc-sections reason as every entry above. --- */
    /* string / text primitives — 7 promoted to real implementations above,
 * these 3 remain traps (numeric parsing needs care, not just bytes) */
    (void *)rt_index_of, (void *)rt_string_char_at,
    (void *)rt_string_replace, (void *)rt_string_rfind,
    (void *)rt_string_to_float, (void *)rt_string_to_int_lenient,
    (void *)rt_string_to_lower, (void *)rt_string_to_upper,
    (void *)rt_text_find, (void *)rt_value_as_float,
    /* array primitives — rt_array_copy promoted to a real implementation below;
 * rt_array_sort remains a trap (an ordering predicate is not a byte loop) */
    (void *)rt_array_copy, (void *)rt_array_sort,
    /* dict — a heap kind this runtime does not have (1) */
    (void *)rt_dict_new,
    /* filesystem, same reason as the 29 above (2) */
    (void *)rt_file_read_text_rv, (void *)rt_file_remove,
    (void *)rt_get_args,
    (void *)rt_aarch64_stdin_wait_ready,
};

spl_i64 rt_aarch64_p10_keepalive(void) {
    spl_u64 n = sizeof(g_p10_keepalive) / sizeof(g_p10_keepalive[0]);
    spl_i64 live = 0;
    for (spl_u64 i = 0; i < n; i = i + 1ULL) {
        void *const volatile *slot = &g_p10_keepalive[i];
        if (*slot) {
            live = live + 1;
        }
    }
    return live;
}
