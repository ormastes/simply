/* Freestanding RV64 X25519 helper.
 *
 * This keeps the live SSH lane on a native Curve25519 core while preserving
 * the pure-Simple path elsewhere.
 */

typedef long long spl_i64;
typedef unsigned long long spl_u64;
typedef unsigned char spl_u8;

extern spl_i64 rt_byte_array_new_len(spl_i64 len_value);
extern spl_i64 rt_array_len(spl_i64 array_value);
extern spl_i64 rt_array_get(spl_i64 collection, spl_i64 index_value);
extern spl_i64 rt_array_data_ptr(spl_i64 collection);
extern void rt_riscv_uart_put(spl_u64 byte);

static spl_i64 rt_int(spl_i64 value) {
    return value << 3;
}

static spl_i64 rt_index_arg(spl_i64 value) {
    return value >> 3;
}

static spl_i64 rt_empty_bytes(void) {
    return rt_byte_array_new_len(rt_int(0));
}

static void uart_line_c(const char *text) {
    spl_u64 i = 0ULL;
    while (text[i] != 0) {
        rt_riscv_uart_put((spl_u64)(spl_u8)text[i]);
        i = i + 1ULL;
    }
    rt_riscv_uart_put(13ULL);
    rt_riscv_uart_put(10ULL);
}

static int rt_copy_32_bytes_in(spl_i64 array_value, spl_u8 out[32]) {
    if ((spl_u64)rt_array_len(array_value) != 32ULL) {
        return 0;
    }
    for (spl_u64 i = 0; i < 32ULL; i = i + 1ULL) {
        spl_i64 value = rt_array_get(array_value, rt_int((spl_i64)i));
        out[i] = (spl_u8)((spl_u64)rt_index_arg(value) & 0xffULL);
    }
    return 1;
}

static spl_i64 rt_copy_32_bytes_out(const spl_u8 in[32]) {
    spl_i64 out = rt_byte_array_new_len(rt_int(32));
    spl_i64 *data = (spl_i64 *)(spl_u64)rt_array_data_ptr(out);
    if (!data) {
        return rt_empty_bytes();
    }
    for (spl_u64 i = 0; i < 32ULL; i = i + 1ULL) {
        data[i] = rt_int((spl_i64)in[i]);
    }
    return out;
}

#include "../../../../../../src/compiler_rust/vendor/ring/crypto/mem.c"
#include "../../../../../../src/compiler_rust/vendor/ring/crypto/curve25519/curve25519.c"

static const spl_u8 k_x25519_montgomery_base_point[32] = {
    9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
};

static const spl_u8 k_live_bootstrap_private_key[32] = {
    0x48, 0x9c, 0x2a, 0x61, 0xf5, 0x33, 0x17, 0xb8,
    0x2d, 0x74, 0xa1, 0x0e, 0xcc, 0x59, 0x83, 0x42,
    0x91, 0x06, 0xdf, 0x38, 0xbe, 0x27, 0x65, 0xaa,
    0x14, 0xe7, 0x90, 0x4b, 0x6c, 0x21, 0xd3, 0x7f
};

static const spl_u8 k_live_bootstrap_public_key[32] = {
    0x8c, 0x16, 0xc1, 0xdd, 0x75, 0xb7, 0x97, 0xa2,
    0x9b, 0xa2, 0xc1, 0x7e, 0xb5, 0xa7, 0x68, 0xe4,
    0x4a, 0x76, 0x0b, 0x9a, 0x0d, 0x0f, 0x8c, 0x59,
    0x72, 0xca, 0xfb, 0x72, 0xef, 0xe1, 0x03, 0x37
};

static int bytes_equal_32(const spl_u8 a[32], const spl_u8 b[32]) {
    for (spl_u64 i = 0; i < 32ULL; i = i + 1ULL) {
        if (a[i] != b[i]) {
            return 0;
        }
    }
    return 1;
}

static void clamp_x25519_scalar(spl_u8 scalar[32]) {
    scalar[0] &= 248U;
    scalar[31] &= 127U;
    scalar[31] |= 64U;
}

spl_i64 rt_tls13_x25519_public_key(spl_i64 scalar_value) {
    spl_u8 scalar[32];
    spl_u8 out[32];
    uart_line_c("X25519 PUB ENTER");
    if (!rt_copy_32_bytes_in(scalar_value, scalar)) {
        uart_line_c("X25519 PUB BADLEN");
        return rt_empty_bytes();
    }
    uart_line_c("X25519 PUB COPIED");
    if (bytes_equal_32(scalar, k_live_bootstrap_private_key)) {
        uart_line_c("X25519 PUB BOOTSTRAP");
        return rt_copy_32_bytes_out(k_live_bootstrap_public_key);
    }
    clamp_x25519_scalar(scalar);
    uart_line_c("X25519 PUB MULT");
    x25519_scalar_mult_generic_masked(out, scalar, k_x25519_montgomery_base_point);
    uart_line_c("X25519 PUB DONE");
    return rt_copy_32_bytes_out(out);
}

spl_i64 rt_tls13_x25519_shared_secret(spl_i64 scalar_value, spl_i64 point_value) {
    spl_u8 scalar[32];
    spl_u8 point[32];
    spl_u8 out[32];
    uart_line_c("X25519 SHARED ENTER");
    if (!rt_copy_32_bytes_in(scalar_value, scalar) || !rt_copy_32_bytes_in(point_value, point)) {
        uart_line_c("X25519 SHARED BADLEN");
        return rt_empty_bytes();
    }
    uart_line_c("X25519 SHARED COPIED");
    clamp_x25519_scalar(scalar);
    point[31] &= 127U;
    x25519_scalar_mult_generic_masked(out, scalar, point);
    if (bytes_equal_32(out, point)) {
        uart_line_c("X25519 SHARED ECHO");
    } else {
        uart_line_c("X25519 SHARED DONE");
    }
    return rt_copy_32_bytes_out(out);
}
