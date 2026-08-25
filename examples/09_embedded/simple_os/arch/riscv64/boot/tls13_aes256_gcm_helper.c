/* Freestanding RV64 AES-256-GCM helper for SSH/TLS live paths. */

typedef long long spl_i64;
typedef unsigned long long spl_u64;
typedef unsigned int spl_u32;
typedef unsigned char spl_u8;

extern spl_i64 rt_byte_array_new_len(spl_i64 len_value);
extern spl_i64 rt_array_len(spl_i64 array_value);
extern spl_i64 rt_array_get(spl_i64 collection, spl_i64 index_value);
extern spl_i64 rt_array_data_ptr(spl_i64 collection);
extern signed char rt_array_push(spl_i64 array_value, spl_i64 value);

#define AES256_GCM_MAX_INPUT 4096ULL

static spl_i64 rt_int(spl_i64 value) {
    return value << 3;
}

static spl_i64 rt_index_arg(spl_i64 value) {
    return value >> 3;
}

static spl_i64 rt_empty_bytes(void) {
    return rt_byte_array_new_len(rt_int(0));
}

static int rt_copy_bytes_in(spl_i64 array_value, spl_u8 *out, spl_u64 cap, spl_u64 *len_out) {
    spl_u64 len = (spl_u64)rt_array_len(array_value);
    if (len > cap) {
        return 0;
    }
    for (spl_u64 i = 0ULL; i < len; i = i + 1ULL) {
        spl_i64 value = rt_array_get(array_value, rt_int((spl_i64)i));
        out[i] = (spl_u8)((spl_u64)rt_index_arg(value) & 0xffULL);
    }
    *len_out = len;
    return 1;
}

static spl_i64 rt_copy_bytes_out(const spl_u8 *in, spl_u64 len) {
    spl_i64 out = rt_byte_array_new_len(rt_int((spl_i64)len));
    spl_i64 *data = (spl_i64 *)(spl_u64)rt_array_data_ptr(out);
    if (!data) {
        return rt_empty_bytes();
    }
    for (spl_u64 i = 0ULL; i < len; i = i + 1ULL) {
        data[i] = rt_int((spl_i64)in[i]);
    }
    return out;
}

static spl_i64 rt_copy_bytes_out_pushed(const spl_u8 *in, spl_u64 len) {
    spl_i64 out = rt_byte_array_new_len(rt_int(0));
    for (spl_u64 i = 0ULL; i < len; i = i + 1ULL) {
        rt_array_push(out, rt_int((spl_i64)in[i]));
    }
    return out;
}

static void rv_memzero_u8(spl_u8 *dst, spl_u64 len) {
    for (spl_u64 i = 0ULL; i < len; i = i + 1ULL) {
        dst[i] = 0U;
    }
}

static void rv_memcpy_u8(spl_u8 *dst, const spl_u8 *src, spl_u64 len) {
    for (spl_u64 i = 0ULL; i < len; i = i + 1ULL) {
        dst[i] = src[i];
    }
}

static int rv_memeq_u8(const spl_u8 *a, const spl_u8 *b, spl_u64 len) {
    spl_u8 diff = 0U;
    for (spl_u64 i = 0ULL; i < len; i = i + 1ULL) {
        diff = (spl_u8)(diff | (a[i] ^ b[i]));
    }
    return diff == 0U;
}

static const spl_u8 aes_sbox[256] = {
    0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
    0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
    0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
    0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
    0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
    0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
    0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
    0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
    0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
    0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
    0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
    0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
    0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
    0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
    0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
    0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16
};

static const spl_u32 aes_rcon[10] = {
    0x01000000U, 0x02000000U, 0x04000000U, 0x08000000U,
    0x10000000U, 0x20000000U, 0x40000000U, 0x80000000U,
    0x1b000000U, 0x36000000U
};

static spl_u8 aes_xtime(spl_u8 b) {
    spl_u32 shifted = ((spl_u32)b << 1) & 0xffU;
    return (b & 0x80U) ? (spl_u8)(shifted ^ 0x1bU) : (spl_u8)shifted;
}

static spl_u8 aes_gf_mul(spl_u8 a, spl_u8 b) {
    spl_u8 result = 0U;
    spl_u8 aa = a;
    spl_u8 bb = b;
    for (int i = 0; i < 8; i = i + 1) {
        if ((bb & 1U) != 0U) {
            result = (spl_u8)(result ^ aa);
        }
        aa = aes_xtime(aa);
        bb = (spl_u8)(bb >> 1);
    }
    return result;
}

static void aes_sub_bytes(spl_u8 state[16]) {
    for (int i = 0; i < 16; i = i + 1) {
        state[i] = aes_sbox[state[i]];
    }
}

static void aes_shift_rows(spl_u8 state[16]) {
    spl_u8 tmp[16];
    tmp[0] = state[0];  tmp[1] = state[5];  tmp[2] = state[10]; tmp[3] = state[15];
    tmp[4] = state[4];  tmp[5] = state[9];  tmp[6] = state[14]; tmp[7] = state[3];
    tmp[8] = state[8];  tmp[9] = state[13]; tmp[10] = state[2]; tmp[11] = state[7];
    tmp[12] = state[12]; tmp[13] = state[1]; tmp[14] = state[6]; tmp[15] = state[11];
    rv_memcpy_u8(state, tmp, 16ULL);
}

static void aes_mix_columns(spl_u8 state[16]) {
    for (int c = 0; c < 4; c = c + 1) {
        int base = c * 4;
        spl_u8 s0 = state[base];
        spl_u8 s1 = state[base + 1];
        spl_u8 s2 = state[base + 2];
        spl_u8 s3 = state[base + 3];
        state[base]     = (spl_u8)(aes_gf_mul(0x02U, s0) ^ aes_gf_mul(0x03U, s1) ^ s2 ^ s3);
        state[base + 1] = (spl_u8)(s0 ^ aes_gf_mul(0x02U, s1) ^ aes_gf_mul(0x03U, s2) ^ s3);
        state[base + 2] = (spl_u8)(s0 ^ s1 ^ aes_gf_mul(0x02U, s2) ^ aes_gf_mul(0x03U, s3));
        state[base + 3] = (spl_u8)(aes_gf_mul(0x03U, s0) ^ s1 ^ s2 ^ aes_gf_mul(0x02U, s3));
    }
}

static void aes_add_round_key(spl_u8 state[16], const spl_u8 *round_keys, spl_u32 round) {
    const spl_u8 *rk = round_keys + round * 16U;
    for (int i = 0; i < 16; i = i + 1) {
        state[i] = (spl_u8)(state[i] ^ rk[i]);
    }
}

static void aes256_key_expansion(const spl_u8 key[32], spl_u8 out[240]) {
    rv_memcpy_u8(out, key, 32ULL);
    spl_u32 bytes = 32U;
    spl_u8 temp[4];
    spl_u32 rcon_idx = 0U;
    while (bytes < 240U) {
        temp[0] = out[bytes - 4U];
        temp[1] = out[bytes - 3U];
        temp[2] = out[bytes - 2U];
        temp[3] = out[bytes - 1U];
        if ((bytes % 32U) == 0U) {
            spl_u8 rot0 = temp[1], rot1 = temp[2], rot2 = temp[3], rot3 = temp[0];
            temp[0] = (spl_u8)(aes_sbox[rot0] ^ ((aes_rcon[rcon_idx] >> 24) & 0xffU));
            temp[1] = aes_sbox[rot1];
            temp[2] = aes_sbox[rot2];
            temp[3] = aes_sbox[rot3];
            rcon_idx = rcon_idx + 1U;
        } else if ((bytes % 32U) == 16U) {
            temp[0] = aes_sbox[temp[0]];
            temp[1] = aes_sbox[temp[1]];
            temp[2] = aes_sbox[temp[2]];
            temp[3] = aes_sbox[temp[3]];
        }
        for (int i = 0; i < 4; i = i + 1) {
            out[bytes] = (spl_u8)(out[bytes - 32U] ^ temp[i]);
            bytes = bytes + 1U;
        }
    }
}

static void aes256_encrypt_block_raw(const spl_u8 key[32], const spl_u8 in[16], spl_u8 out[16]) {
    spl_u8 round_keys[240];
    spl_u8 state[16];
    rv_memcpy_u8(state, in, 16ULL);
    aes256_key_expansion(key, round_keys);
    aes_add_round_key(state, round_keys, 0U);
    for (spl_u32 round = 1U; round < 14U; round = round + 1U) {
        aes_sub_bytes(state);
        aes_shift_rows(state);
        aes_mix_columns(state);
        aes_add_round_key(state, round_keys, round);
    }
    aes_sub_bytes(state);
    aes_shift_rows(state);
    aes_add_round_key(state, round_keys, 14U);
    rv_memcpy_u8(out, state, 16ULL);
}

static void gcm_inc32(spl_u8 counter[16]) {
    spl_u32 c =
        ((spl_u32)counter[12] << 24) |
        ((spl_u32)counter[13] << 16) |
        ((spl_u32)counter[14] << 8) |
        (spl_u32)counter[15];
    c = c + 1U;
    counter[12] = (spl_u8)((c >> 24) & 0xffU);
    counter[13] = (spl_u8)((c >> 16) & 0xffU);
    counter[14] = (spl_u8)((c >> 8) & 0xffU);
    counter[15] = (spl_u8)(c & 0xffU);
}

static void gcm_gf_mul(const spl_u8 x[16], const spl_u8 y[16], spl_u8 out[16]) {
    spl_u8 z[16];
    spl_u8 v[16];
    rv_memzero_u8(z, 16ULL);
    rv_memcpy_u8(v, y, 16ULL);
    for (spl_u32 i = 0U; i < 128U; i = i + 1U) {
        spl_u32 byte_idx = i >> 3;
        spl_u32 bit_idx = 7U - (i & 7U);
        if (((x[byte_idx] >> bit_idx) & 1U) != 0U) {
            for (spl_u32 j = 0U; j < 16U; j = j + 1U) {
                z[j] = (spl_u8)(z[j] ^ v[j]);
            }
        }
        spl_u8 lsb = (spl_u8)(v[15] & 1U);
        spl_u8 next[16];
        next[0] = (spl_u8)((v[0] >> 1) & 0x7fU);
        if (lsb != 0U) {
            next[0] = (spl_u8)(next[0] ^ 0xe1U);
        }
        for (spl_u32 j = 1U; j < 16U; j = j + 1U) {
            next[j] = (spl_u8)(((v[j] >> 1) | ((v[j - 1U] & 1U) << 7)) & 0xffU);
        }
        rv_memcpy_u8(v, next, 16ULL);
    }
    rv_memcpy_u8(out, z, 16ULL);
}

static void gcm_ghash(const spl_u8 h[16], const spl_u8 *aad, spl_u64 aad_len,
                      const spl_u8 *ciphertext, spl_u64 ct_len, spl_u8 out[16]) {
    spl_u8 y[16];
    rv_memzero_u8(y, 16ULL);

    for (spl_u64 off = 0ULL; off < aad_len; off = off + 16ULL) {
        spl_u8 block[16];
        rv_memzero_u8(block, 16ULL);
        spl_u64 take = (aad_len - off) < 16ULL ? (aad_len - off) : 16ULL;
        rv_memcpy_u8(block, aad + off, take);
        for (spl_u32 i = 0U; i < 16U; i = i + 1U) {
            block[i] = (spl_u8)(block[i] ^ y[i]);
        }
        gcm_gf_mul(block, h, y);
    }

    for (spl_u64 off = 0ULL; off < ct_len; off = off + 16ULL) {
        spl_u8 block[16];
        rv_memzero_u8(block, 16ULL);
        spl_u64 take = (ct_len - off) < 16ULL ? (ct_len - off) : 16ULL;
        rv_memcpy_u8(block, ciphertext + off, take);
        for (spl_u32 i = 0U; i < 16U; i = i + 1U) {
            block[i] = (spl_u8)(block[i] ^ y[i]);
        }
        gcm_gf_mul(block, h, y);
    }

    spl_u8 len_block[16];
    spl_u64 aad_bits = aad_len * 8ULL;
    spl_u64 ct_bits = ct_len * 8ULL;
    rv_memzero_u8(len_block, 16ULL);
    for (int i = 0; i < 8; i = i + 1) {
        len_block[i] = (spl_u8)(aad_bits >> (56 - i * 8));
        len_block[8 + i] = (spl_u8)(ct_bits >> (56 - i * 8));
    }
    for (spl_u32 i = 0U; i < 16U; i = i + 1U) {
        len_block[i] = (spl_u8)(len_block[i] ^ y[i]);
    }
    gcm_gf_mul(len_block, h, out);
}

static int aes256_gcm_encrypt_raw(const spl_u8 key[32], const spl_u8 nonce[12],
                                  const spl_u8 *plaintext, spl_u64 pt_len,
                                  const spl_u8 *aad, spl_u64 aad_len,
                                  spl_u8 *ciphertext_out, spl_u8 tag_out[16]) {
    spl_u8 zero[16];
    spl_u8 h[16];
    spl_u8 j0[16];
    spl_u8 s[16];
    spl_u8 ej0[16];
    rv_memzero_u8(zero, 16ULL);
    aes256_encrypt_block_raw(key, zero, h);
    rv_memcpy_u8(j0, nonce, 12ULL);
    j0[12] = 0U; j0[13] = 0U; j0[14] = 0U; j0[15] = 1U;

    spl_u8 counter[16];
    rv_memcpy_u8(counter, j0, 16ULL);
    gcm_inc32(counter);
    for (spl_u64 off = 0ULL; off < pt_len; off = off + 16ULL) {
        spl_u8 stream[16];
        aes256_encrypt_block_raw(key, counter, stream);
        spl_u64 take = (pt_len - off) < 16ULL ? (pt_len - off) : 16ULL;
        for (spl_u64 i = 0ULL; i < take; i = i + 1ULL) {
            ciphertext_out[off + i] = (spl_u8)(plaintext[off + i] ^ stream[i]);
        }
        gcm_inc32(counter);
    }

    gcm_ghash(h, aad, aad_len, ciphertext_out, pt_len, s);
    aes256_encrypt_block_raw(key, j0, ej0);
    for (spl_u32 i = 0U; i < 16U; i = i + 1U) {
        tag_out[i] = (spl_u8)(s[i] ^ ej0[i]);
    }
    return 0;
}

static int aes256_gcm_decrypt_raw(const spl_u8 key[32], const spl_u8 nonce[12],
                                  const spl_u8 *ciphertext, spl_u64 ct_len,
                                  const spl_u8 *aad, spl_u64 aad_len,
                                  const spl_u8 tag[16], spl_u8 *plaintext_out) {
    spl_u8 zero[16];
    spl_u8 h[16];
    spl_u8 j0[16];
    spl_u8 s[16];
    spl_u8 ej0[16];
    spl_u8 expected[16];
    rv_memzero_u8(zero, 16ULL);
    aes256_encrypt_block_raw(key, zero, h);
    rv_memcpy_u8(j0, nonce, 12ULL);
    j0[12] = 0U; j0[13] = 0U; j0[14] = 0U; j0[15] = 1U;

    gcm_ghash(h, aad, aad_len, ciphertext, ct_len, s);
    aes256_encrypt_block_raw(key, j0, ej0);
    for (spl_u32 i = 0U; i < 16U; i = i + 1U) {
        expected[i] = (spl_u8)(s[i] ^ ej0[i]);
    }
    if (!rv_memeq_u8(expected, tag, 16ULL)) {
        return -1;
    }

    spl_u8 counter[16];
    rv_memcpy_u8(counter, j0, 16ULL);
    gcm_inc32(counter);
    for (spl_u64 off = 0ULL; off < ct_len; off = off + 16ULL) {
        spl_u8 stream[16];
        aes256_encrypt_block_raw(key, counter, stream);
        spl_u64 take = (ct_len - off) < 16ULL ? (ct_len - off) : 16ULL;
        for (spl_u64 i = 0ULL; i < take; i = i + 1ULL) {
            plaintext_out[off + i] = (spl_u8)(ciphertext[off + i] ^ stream[i]);
        }
        gcm_inc32(counter);
    }
    return 0;
}

spl_i64 rt_tls13_aes256_gcm_encrypt(spl_i64 key_value, spl_i64 nonce_value, spl_i64 plaintext_value, spl_i64 aad_value) {
    spl_u8 key[32];
    spl_u8 nonce[12];
    spl_u8 plaintext[AES256_GCM_MAX_INPUT];
    spl_u8 aad[AES256_GCM_MAX_INPUT];
    spl_u8 out[AES256_GCM_MAX_INPUT + 16ULL];
    spl_u64 key_len = 0ULL, nonce_len = 0ULL, pt_len = 0ULL, aad_len = 0ULL;
    if (!rt_copy_bytes_in(key_value, key, 32ULL, &key_len) ||
        !rt_copy_bytes_in(nonce_value, nonce, 12ULL, &nonce_len) ||
        !rt_copy_bytes_in(plaintext_value, plaintext, AES256_GCM_MAX_INPUT, &pt_len) ||
        !rt_copy_bytes_in(aad_value, aad, AES256_GCM_MAX_INPUT, &aad_len) ||
        key_len != 32ULL || nonce_len != 12ULL) {
        return rt_empty_bytes();
    }
    if (aes256_gcm_encrypt_raw(key, nonce, plaintext, pt_len, aad, aad_len, out, out + pt_len) != 0) {
        return rt_empty_bytes();
    }
    return rt_copy_bytes_out(out, pt_len + 16ULL);
}

spl_i64 rt_tls13_aes256_gcm_decrypt(spl_i64 key_value, spl_i64 nonce_value, spl_i64 ciphertext_value, spl_i64 aad_value, spl_i64 tag_value) {
    spl_u8 key[32];
    spl_u8 nonce[12];
    spl_u8 ciphertext[AES256_GCM_MAX_INPUT];
    spl_u8 aad[AES256_GCM_MAX_INPUT];
    spl_u8 tag[16];
    spl_u8 out[AES256_GCM_MAX_INPUT + 1ULL];
    spl_u64 key_len = 0ULL, nonce_len = 0ULL, ct_len = 0ULL, aad_len = 0ULL, tag_len = 0ULL;
    if (!rt_copy_bytes_in(key_value, key, 32ULL, &key_len) ||
        !rt_copy_bytes_in(nonce_value, nonce, 12ULL, &nonce_len) ||
        !rt_copy_bytes_in(ciphertext_value, ciphertext, AES256_GCM_MAX_INPUT, &ct_len) ||
        !rt_copy_bytes_in(aad_value, aad, AES256_GCM_MAX_INPUT, &aad_len) ||
        !rt_copy_bytes_in(tag_value, tag, 16ULL, &tag_len) ||
        key_len != 32ULL || nonce_len != 12ULL || tag_len != 16ULL) {
        return rt_empty_bytes();
    }
    if (aes256_gcm_decrypt_raw(key, nonce, ciphertext, ct_len, aad, aad_len, tag, out + 1ULL) != 0) {
        out[0] = 0U;
        return rt_copy_bytes_out(out, 1ULL);
    }
    out[0] = 1U;
    return rt_copy_bytes_out(out, ct_len + 1ULL);
}

spl_i64 rt_ssh_aes256_gcm_decrypt_packet(spl_i64 key_value, spl_i64 iv_value, spl_i64 seq_value, spl_i64 packet_value) {
    spl_u8 key[32];
    spl_u8 iv[12];
    spl_u8 packet[AES256_GCM_MAX_INPUT];
    spl_u8 nonce[12];
    spl_u8 plaintext[AES256_GCM_MAX_INPUT];
    spl_u64 key_len = 0ULL, iv_len = 0ULL, packet_len = 0ULL;
    spl_u64 ct_len;
    spl_u64 payload_len;
    spl_u64 seq = (spl_u64)seq_value;
    spl_u64 carry;

    if (!rt_copy_bytes_in(key_value, key, 32ULL, &key_len) ||
        !rt_copy_bytes_in(iv_value, iv, 12ULL, &iv_len) ||
        !rt_copy_bytes_in(packet_value, packet, AES256_GCM_MAX_INPUT, &packet_len) ||
        key_len != 32ULL || iv_len != 12ULL || packet_len < 21ULL) {
        return rt_empty_bytes();
    }

    rv_memcpy_u8(nonce, iv, 12ULL);
    carry = seq;
    for (spl_i64 i = 11; i >= 4; i = i - 1) {
        spl_u64 sum = (spl_u64)nonce[i] + (carry & 0xffULL);
        nonce[i] = (spl_u8)(sum & 0xffULL);
        carry = (carry >> 8) + (sum >> 8);
    }

    ct_len = packet_len - 4ULL - 16ULL;
    if (aes256_gcm_decrypt_raw(key, nonce, packet + 4ULL, ct_len, packet, 4ULL, packet + 4ULL + ct_len, plaintext) != 0) {
        return rt_empty_bytes();
    }
    if (ct_len < 2ULL) {
        return rt_empty_bytes();
    }
    if ((spl_u64)plaintext[0] + 1ULL > ct_len) {
        return rt_empty_bytes();
    }
    payload_len = ct_len - 1ULL - (spl_u64)plaintext[0];
    return rt_copy_bytes_out_pushed(plaintext + 1ULL, payload_len);
}

spl_i64 rt_ssh_aes256_gcm_decrypt_packet_payload_len(spl_i64 key_value, spl_i64 iv_value, spl_i64 seq_value, spl_i64 packet_value) {
    spl_u8 key[32];
    spl_u8 iv[12];
    spl_u8 packet[AES256_GCM_MAX_INPUT + 20ULL];
    spl_u8 body[AES256_GCM_MAX_INPUT];
    spl_u64 key_len = 0ULL, iv_len = 0ULL, packet_len = 0ULL;
    if (!rt_copy_bytes_in(key_value, key, 32ULL, &key_len) ||
        !rt_copy_bytes_in(iv_value, iv, 12ULL, &iv_len) ||
        !rt_copy_bytes_in(packet_value, packet, AES256_GCM_MAX_INPUT + 20ULL, &packet_len) ||
        key_len != 32ULL || iv_len != 12ULL || packet_len < 21ULL) {
        return -1;
    }

    spl_u64 body_len = packet_len - 4ULL - 16ULL;
    if (body_len == 0ULL || body_len > AES256_GCM_MAX_INPUT) {
        return -1;
    }

    spl_u8 nonce[12];
    rv_memcpy_u8(nonce, iv, 12ULL);
    spl_u64 carry = (spl_u64)seq_value;
    for (int i = 11; i >= 4 && carry > 0ULL; i = i - 1) {
        spl_u64 sum = (spl_u64)nonce[i] + (carry & 0xffULL);
        nonce[i] = (spl_u8)(sum & 0xffULL);
        carry = (carry >> 8) + (sum >> 8);
    }

    if (aes256_gcm_decrypt_raw(key, nonce, packet + 4ULL, body_len, packet, 4ULL, packet + 4ULL + body_len, body) != 0) {
        return -1;
    }

    spl_u32 padding_len = (spl_u32)body[0];
    if (1ULL + (spl_u64)padding_len > body_len) {
        return -1;
    }
    return (spl_i64)(body_len - 1ULL - (spl_u64)padding_len);
}
