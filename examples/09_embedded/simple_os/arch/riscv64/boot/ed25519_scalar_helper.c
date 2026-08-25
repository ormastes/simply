/* Freestanding RV64 Ed25519 scalar helpers.
 *
 * This keeps the live SSH lane on native scalar reduction for the nonce/challenge
 * paths while preserving the pure-Simple scalar code elsewhere.
 */

typedef long long spl_i64;
typedef unsigned long long spl_u64;
typedef unsigned char spl_u8;

#define ED25519_HELPER_MAX_CONCAT 4096ULL

extern spl_i64 rt_byte_array_new_len(spl_i64 len_value);
extern spl_i64 rt_array_len(spl_i64 array_value);
extern spl_i64 rt_array_get(spl_i64 collection, spl_i64 index_value);
extern spl_i64 rt_array_data_ptr(spl_i64 collection);
extern spl_i64 rt_tls13_sha512_full(spl_i64 data_value);

static spl_i64 rt_int(spl_i64 value) {
    return value << 3;
}

static spl_i64 rt_index_arg(spl_i64 value) {
    return value >> 3;
}

static spl_i64 rt_empty_bytes(void) {
    return rt_byte_array_new_len(rt_int(0));
}

static spl_i64 rt_nil(void) {
    return 3;
}

static int rt_copy_64_bytes_in(spl_i64 array_value, spl_u8 out[64]) {
    if ((spl_u64)rt_array_len(array_value) != 64ULL) {
        return 0;
    }
    for (spl_u64 i = 0; i < 64ULL; i = i + 1ULL) {
        spl_i64 value = rt_array_get(array_value, rt_int((spl_i64)i));
        out[i] = (spl_u8)((spl_u64)rt_index_arg(value) & 0xffULL);
    }
    return 1;
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

static spl_i64 rt_copy_64_bytes_out(const spl_u8 in[64]) {
    spl_i64 out = rt_byte_array_new_len(rt_int(64));
    spl_i64 *data = (spl_i64 *)(spl_u64)rt_array_data_ptr(out);
    if (!data) {
        return rt_empty_bytes();
    }
    for (spl_u64 i = 0; i < 64ULL; i = i + 1ULL) {
        data[i] = rt_int((spl_i64)in[i]);
    }
    return out;
}

static spl_i64 rt_concat_arrays3(spl_i64 a_value, spl_i64 b_value, spl_i64 c_value) {
    spl_u64 a_len = (spl_u64)rt_array_len(a_value);
    spl_u64 b_len = (spl_u64)rt_array_len(b_value);
    spl_u64 c_len = (spl_u64)rt_array_len(c_value);
    spl_u64 total = a_len + b_len + c_len;
    if (total > ED25519_HELPER_MAX_CONCAT) {
        return rt_empty_bytes();
    }
    spl_i64 staged[ED25519_HELPER_MAX_CONCAT];
    spl_u64 out_i = 0;
    for (spl_u64 i = 0; i < a_len; i = i + 1ULL) {
        staged[out_i] = rt_array_get(a_value, rt_int((spl_i64)i));
        out_i = out_i + 1ULL;
    }
    for (spl_u64 i = 0; i < b_len; i = i + 1ULL) {
        staged[out_i] = rt_array_get(b_value, rt_int((spl_i64)i));
        out_i = out_i + 1ULL;
    }
    for (spl_u64 i = 0; i < c_len; i = i + 1ULL) {
        staged[out_i] = rt_array_get(c_value, rt_int((spl_i64)i));
        out_i = out_i + 1ULL;
    }

    spl_i64 out = rt_byte_array_new_len(rt_int((spl_i64)total));
    spl_i64 *data = (spl_i64 *)(spl_u64)rt_array_data_ptr(out);
    if (!data) {
        return rt_empty_bytes();
    }
    for (spl_u64 i = 0; i < total; i = i + 1ULL) {
        data[i] = staged[i];
    }
    return out;
}

static void ed25519_clamp_scalar(spl_u8 a[32]) {
    a[0] &= 248u;
    a[31] &= 127u;
    a[31] |= 64u;
}

/* Keep this helper's embedded ring copy private. The RV64 boot image also
 * links curve25519_ring_helper.c; exporting two strong ring_core x25519/scalar
 * symbol sets leaves the final freestanding image at the mercy of link order. */
#define ring_core_0_17_14__CRYPTO_memcmp ed25519_scalar_ring_CRYPTO_memcmp
#define ring_core_0_17_14__x25519_fe_invert ed25519_scalar_ring_x25519_fe_invert
#define ring_core_0_17_14__x25519_fe_isnegative ed25519_scalar_ring_x25519_fe_isnegative
#define ring_core_0_17_14__x25519_fe_mul_ttt ed25519_scalar_ring_x25519_fe_mul_ttt
#define ring_core_0_17_14__x25519_fe_neg ed25519_scalar_ring_x25519_fe_neg
#define ring_core_0_17_14__x25519_fe_tobytes ed25519_scalar_ring_x25519_fe_tobytes
#define ring_core_0_17_14__x25519_ge_double_scalarmult_vartime ed25519_scalar_ring_x25519_ge_double_scalarmult_vartime
#define ring_core_0_17_14__x25519_ge_frombytes_vartime ed25519_scalar_ring_x25519_ge_frombytes_vartime
#define ring_core_0_17_14__x25519_ge_scalarmult_base ed25519_scalar_ring_x25519_ge_scalarmult_base
#define ring_core_0_17_14__x25519_public_from_private_generic_masked ed25519_scalar_ring_x25519_public_from_private_generic_masked
#define ring_core_0_17_14__x25519_scalar_mult_generic_masked ed25519_scalar_ring_x25519_scalar_mult_generic_masked
#define ring_core_0_17_14__x25519_sc_mask ed25519_scalar_ring_x25519_sc_mask
#define ring_core_0_17_14__x25519_sc_muladd ed25519_scalar_ring_x25519_sc_muladd
#define ring_core_0_17_14__x25519_sc_reduce ed25519_scalar_ring_x25519_sc_reduce

#include "../../../../../../src/compiler_rust/vendor/ring/crypto/mem.c"
#include "../../../../../../src/compiler_rust/vendor/ring/crypto/curve25519/curve25519.c"

static void ed25519_encode_point(spl_u8 out[32], const ge_p3 *p) {
    fe recip;
    fe x;
    fe y;
    fe_invert(&recip, &p->Z);
    fe_mul_ttt(&x, &p->X, &recip);
    fe_mul_ttt(&y, &p->Y, &recip);
    fe_tobytes(out, &y);
    out[31] ^= fe_isnegative(&x) << 7;
}

spl_i64 rt_ed25519_sc_reduce_64(spl_i64 scalar64_value) {
    spl_u8 scalar[64];
    if (!rt_copy_64_bytes_in(scalar64_value, scalar)) {
        return rt_empty_bytes();
    }
    x25519_sc_reduce(scalar);
    return rt_copy_32_bytes_out(scalar);
}

spl_i64 rt_ed25519_sc_muladd(spl_i64 a_value, spl_i64 b_value, spl_i64 c_value) {
    spl_u8 a[32];
    spl_u8 b[32];
    spl_u8 c[32];
    spl_u8 out[32];
    if (!rt_copy_32_bytes_in(a_value, a) ||
        !rt_copy_32_bytes_in(b_value, b) ||
        !rt_copy_32_bytes_in(c_value, c)) {
        return rt_empty_bytes();
    }
    x25519_sc_muladd(out, a, b, c);
    return rt_copy_32_bytes_out(out);
}

spl_i64 rt_ed25519_sign_seed(spl_i64 seed_value, spl_i64 public_key_value, spl_i64 message_value) {
    spl_u8 seed[32];
    spl_u8 public_key[32];
    spl_u8 h[64];
    spl_u8 a[32];
    spl_u8 r_scalar[32];
    spl_u8 r_enc[32];
    spl_u8 s_scalar[32];
    if (!rt_copy_32_bytes_in(seed_value, seed) || !rt_copy_32_bytes_in(public_key_value, public_key)) {
        return rt_nil();
    }

    spl_i64 h_value = rt_tls13_sha512_full(seed_value);
    if (!rt_copy_64_bytes_in(h_value, h)) {
        return rt_nil();
    }
    for (spl_u64 i = 0; i < 32ULL; i = i + 1ULL) {
        a[i] = h[i];
    }
    ed25519_clamp_scalar(a);

    spl_i64 prefix_value = rt_byte_array_new_len(rt_int(32));
    spl_i64 *prefix_data = (spl_i64 *)(spl_u64)rt_array_data_ptr(prefix_value);
    if (!prefix_data) {
        return rt_nil();
    }
    for (spl_u64 i = 0; i < 32ULL; i = i + 1ULL) {
        prefix_data[i] = rt_int((spl_i64)h[32ULL + i]);
    }

    spl_i64 prefix_msg_value = rt_concat_arrays3(prefix_value, message_value, rt_empty_bytes());
    spl_i64 r_hash_value = rt_tls13_sha512_full(prefix_msg_value);
    spl_i64 r_value = rt_ed25519_sc_reduce_64(r_hash_value);
    if (!rt_copy_32_bytes_in(r_value, r_scalar)) {
        return rt_nil();
    }

    ge_p3 r_point;
    x25519_ge_scalarmult_base(&r_point, r_scalar, 0);
    ed25519_encode_point(r_enc, &r_point);

    spl_i64 r_enc_value = rt_copy_32_bytes_out(r_enc);
    spl_i64 k_input_value = rt_concat_arrays3(r_enc_value, public_key_value, message_value);
    spl_i64 k_hash_value = rt_tls13_sha512_full(k_input_value);
    spl_i64 k_value = rt_ed25519_sc_reduce_64(k_hash_value);
    spl_u8 k_scalar[32];
    if (!rt_copy_32_bytes_in(k_value, k_scalar)) {
        return rt_nil();
    }

    x25519_sc_muladd(s_scalar, k_scalar, a, r_scalar);

    spl_u8 sig[64];
    for (spl_u64 i = 0; i < 32ULL; i = i + 1ULL) {
        sig[i] = r_enc[i];
        sig[32ULL + i] = s_scalar[i];
    }
    spl_i64 out = rt_byte_array_new_len(rt_int(64));
    spl_i64 *out_data = (spl_i64 *)(spl_u64)rt_array_data_ptr(out);
    if (!out_data) {
        return rt_nil();
    }
    for (spl_u64 i = 0; i < 64ULL; i = i + 1ULL) {
        out_data[i] = rt_int((spl_i64)sig[i]);
    }
    return out;
}
