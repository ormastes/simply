/* Freestanding RV64 SHA-256 helper for TLS/SSH transcript hashing. */

typedef long long spl_i64;
typedef unsigned long long spl_u64;
typedef unsigned int spl_u32;
typedef unsigned char spl_u8;

extern spl_i64 rt_byte_array_new_len(spl_i64 len_value);
extern spl_i64 rt_array_len(spl_i64 array_value);
extern spl_i64 rt_array_get(spl_i64 collection, spl_i64 index_value);
extern spl_i64 rt_array_data_ptr(spl_i64 collection);

static spl_i64 rt_int(spl_i64 value) {
    return value << 3;
}

static spl_i64 rt_index_arg(spl_i64 value) {
    return value >> 3;
}

static spl_i64 rt_empty_bytes(void) {
    return rt_byte_array_new_len(rt_int(0));
}

static spl_u8 rt_array_u8_at(spl_i64 array_value, spl_u64 index) {
    return (spl_u8)((spl_u64)rt_index_arg(rt_array_get(array_value, rt_int((spl_i64)index))) & 0xffULL);
}

static spl_u32 rotr32(spl_u32 x, spl_u32 n) {
    return (x >> n) | (x << (32U - n));
}

static spl_u32 ch32(spl_u32 x, spl_u32 y, spl_u32 z) {
    return (x & y) ^ ((~x) & z);
}

static spl_u32 maj32(spl_u32 x, spl_u32 y, spl_u32 z) {
    return (x & y) ^ (x & z) ^ (y & z);
}

static spl_u32 bsig0(spl_u32 x) {
    return rotr32(x, 2U) ^ rotr32(x, 13U) ^ rotr32(x, 22U);
}

static spl_u32 bsig1(spl_u32 x) {
    return rotr32(x, 6U) ^ rotr32(x, 11U) ^ rotr32(x, 25U);
}

static spl_u32 ssig0(spl_u32 x) {
    return rotr32(x, 7U) ^ rotr32(x, 18U) ^ (x >> 3U);
}

static spl_u32 ssig1(spl_u32 x) {
    return rotr32(x, 17U) ^ rotr32(x, 19U) ^ (x >> 10U);
}

static const spl_u32 k256[64] = {
    0x428a2f98U, 0x71374491U, 0xb5c0fbcfU, 0xe9b5dba5U,
    0x3956c25bU, 0x59f111f1U, 0x923f82a4U, 0xab1c5ed5U,
    0xd807aa98U, 0x12835b01U, 0x243185beU, 0x550c7dc3U,
    0x72be5d74U, 0x80deb1feU, 0x9bdc06a7U, 0xc19bf174U,
    0xe49b69c1U, 0xefbe4786U, 0x0fc19dc6U, 0x240ca1ccU,
    0x2de92c6fU, 0x4a7484aaU, 0x5cb0a9dcU, 0x76f988daU,
    0x983e5152U, 0xa831c66dU, 0xb00327c8U, 0xbf597fc7U,
    0xc6e00bf3U, 0xd5a79147U, 0x06ca6351U, 0x14292967U,
    0x27b70a85U, 0x2e1b2138U, 0x4d2c6dfcU, 0x53380d13U,
    0x650a7354U, 0x766a0abbU, 0x81c2c92eU, 0x92722c85U,
    0xa2bfe8a1U, 0xa81a664bU, 0xc24b8b70U, 0xc76c51a3U,
    0xd192e819U, 0xd6990624U, 0xf40e3585U, 0x106aa070U,
    0x19a4c116U, 0x1e376c08U, 0x2748774cU, 0x34b0bcb5U,
    0x391c0cb3U, 0x4ed8aa4aU, 0x5b9cca4fU, 0x682e6ff3U,
    0x748f82eeU, 0x78a5636fU, 0x84c87814U, 0x8cc70208U,
    0x90befffaU, 0xa4506cebU, 0xbef9a3f7U, 0xc67178f2U
};

static void sha256_compress(spl_u32 state[8], const spl_u8 block[64]) {
    spl_u32 w[64];
    spl_u32 a, b, c, d, e, f, g, h;
    spl_u32 t1, t2;
    spl_u32 i;

    for (i = 0; i < 16U; i++) {
        spl_u32 j = i * 4U;
        w[i] = ((spl_u32)block[j] << 24) |
               ((spl_u32)block[j + 1U] << 16) |
               ((spl_u32)block[j + 2U] << 8) |
               (spl_u32)block[j + 3U];
    }
    for (i = 16U; i < 64U; i++) {
        w[i] = ssig1(w[i - 2U]) + w[i - 7U] + ssig0(w[i - 15U]) + w[i - 16U];
    }

    a = state[0];
    b = state[1];
    c = state[2];
    d = state[3];
    e = state[4];
    f = state[5];
    g = state[6];
    h = state[7];

    for (i = 0; i < 64U; i++) {
        t1 = h + bsig1(e) + ch32(e, f, g) + k256[i] + w[i];
        t2 = bsig0(a) + maj32(a, b, c);
        h = g;
        g = f;
        f = e;
        e = d + t1;
        d = c;
        c = b;
        b = a;
        a = t1 + t2;
    }

    state[0] += a;
    state[1] += b;
    state[2] += c;
    state[3] += d;
    state[4] += e;
    state[5] += f;
    state[6] += g;
    state[7] += h;
}

static spl_i64 sha256_bytes(const spl_u8 *input, spl_u64 len) {
    spl_u64 total = ((len + 9ULL + 63ULL) / 64ULL) * 64ULL;
    spl_u8 block[64];
    spl_u32 state[8] = {
        0x6a09e667U, 0xbb67ae85U, 0x3c6ef372U, 0xa54ff53aU,
        0x510e527fU, 0x9b05688cU, 0x1f83d9abU, 0x5be0cd19U
    };
    spl_u64 offset = 0ULL;

    while (offset < total) {
        spl_u64 i;
        for (i = 0ULL; i < 64ULL; i++) {
            spl_u64 pos = offset + i;
            if (pos < len) {
                block[i] = input[pos];
            } else if (pos == len) {
                block[i] = 0x80U;
            } else {
                block[i] = 0U;
            }
        }
        if (offset + 64ULL == total) {
            spl_u64 bit_len = len * 8ULL;
            block[56] = (spl_u8)((bit_len >> 56) & 0xffULL);
            block[57] = (spl_u8)((bit_len >> 48) & 0xffULL);
            block[58] = (spl_u8)((bit_len >> 40) & 0xffULL);
            block[59] = (spl_u8)((bit_len >> 32) & 0xffULL);
            block[60] = (spl_u8)((bit_len >> 24) & 0xffULL);
            block[61] = (spl_u8)((bit_len >> 16) & 0xffULL);
            block[62] = (spl_u8)((bit_len >> 8) & 0xffULL);
            block[63] = (spl_u8)(bit_len & 0xffULL);
        }
        sha256_compress(state, block);
        offset += 64ULL;
    }

    {
        spl_i64 out = rt_byte_array_new_len(rt_int(32));
        spl_i64 *data = (spl_i64 *)(spl_u64)rt_array_data_ptr(out);
        if (!data) {
            return rt_empty_bytes();
        }
        for (spl_u32 i = 0U; i < 8U; i++) {
            spl_u32 word = state[i];
            data[i * 4U + 0U] = rt_int((spl_i64)((word >> 24) & 0xffU));
            data[i * 4U + 1U] = rt_int((spl_i64)((word >> 16) & 0xffU));
            data[i * 4U + 2U] = rt_int((spl_i64)((word >> 8) & 0xffU));
            data[i * 4U + 3U] = rt_int((spl_i64)(word & 0xffU));
        }
        return out;
    }
}

static void put_u32_be(spl_u8 *out, spl_u64 *off, spl_u64 value) {
    out[(*off)++] = (spl_u8)((value >> 24) & 0xffULL);
    out[(*off)++] = (spl_u8)((value >> 16) & 0xffULL);
    out[(*off)++] = (spl_u8)((value >> 8) & 0xffULL);
    out[(*off)++] = (spl_u8)(value & 0xffULL);
}

static int append_ssh_string(spl_u8 *out, spl_u64 *off, spl_u64 cap, spl_i64 array_value) {
    spl_i64 len_i64 = rt_array_len(array_value);
    spl_u64 len = len_i64 < 0 ? 0ULL : (spl_u64)len_i64;
    if (*off + 4ULL + len > cap) {
        return 0;
    }
    put_u32_be(out, off, len);
    for (spl_u64 i = 0ULL; i < len; i++) {
        out[(*off)++] = rt_array_u8_at(array_value, i);
    }
    return 1;
}

static int append_ssh_mpint(spl_u8 *out, spl_u64 *off, spl_u64 cap, spl_i64 array_value) {
    spl_i64 len_i64 = rt_array_len(array_value);
    spl_u64 len = len_i64 < 0 ? 0ULL : (spl_u64)len_i64;
    spl_u64 start = 0ULL;
    spl_u64 body_len;
    spl_u8 first;

    while (start < len && rt_array_u8_at(array_value, start) == 0U) {
        start++;
    }
    if (start >= len) {
        if (*off + 4ULL > cap) {
            return 0;
        }
        put_u32_be(out, off, 0ULL);
        return 1;
    }

    first = rt_array_u8_at(array_value, start);
    body_len = len - start + ((first & 0x80U) ? 1ULL : 0ULL);
    if (*off + 4ULL + body_len > cap) {
        return 0;
    }
    put_u32_be(out, off, body_len);
    if ((first & 0x80U) != 0U) {
        out[(*off)++] = 0U;
    }
    for (spl_u64 i = start; i < len; i++) {
        out[(*off)++] = rt_array_u8_at(array_value, i);
    }
    return 1;
}

spl_i64 rt_ssh_curve25519_exchange_hash(
    spl_i64 client_version,
    spl_i64 server_version,
    spl_i64 client_kexinit,
    spl_i64 server_kexinit,
    spl_i64 host_key_blob,
    spl_i64 client_public,
    spl_i64 server_public,
    spl_i64 shared_secret
) {
    spl_u8 input[4096];
    spl_u64 off = 0ULL;
    if (!append_ssh_string(input, &off, sizeof(input), client_version)) return rt_empty_bytes();
    if (!append_ssh_string(input, &off, sizeof(input), server_version)) return rt_empty_bytes();
    if (!append_ssh_string(input, &off, sizeof(input), client_kexinit)) return rt_empty_bytes();
    if (!append_ssh_string(input, &off, sizeof(input), server_kexinit)) return rt_empty_bytes();
    if (!append_ssh_string(input, &off, sizeof(input), host_key_blob)) return rt_empty_bytes();
    if (!append_ssh_string(input, &off, sizeof(input), client_public)) return rt_empty_bytes();
    if (!append_ssh_string(input, &off, sizeof(input), server_public)) return rt_empty_bytes();
    if (!append_ssh_mpint(input, &off, sizeof(input), shared_secret)) return rt_empty_bytes();
    return sha256_bytes(input, off);
}

spl_i64 rt_tls13_sha256(spl_i64 data_value) {
    spl_i64 len_i64 = rt_array_len(data_value);
    spl_u64 len = len_i64 < 0 ? 0ULL : (spl_u64)len_i64;
    spl_u64 total = ((len + 9ULL + 63ULL) / 64ULL) * 64ULL;
    spl_u8 block[64];
    spl_u32 state[8] = {
        0x6a09e667U, 0xbb67ae85U, 0x3c6ef372U, 0xa54ff53aU,
        0x510e527fU, 0x9b05688cU, 0x1f83d9abU, 0x5be0cd19U
    };
    spl_u64 offset = 0ULL;

    while (offset < total) {
        spl_u64 i;
        for (i = 0ULL; i < 64ULL; i++) {
            spl_u64 pos = offset + i;
            if (pos < len) {
                block[i] = (spl_u8)((spl_u64)rt_index_arg(rt_array_get(data_value, rt_int((spl_i64)pos))) & 0xffULL);
            } else if (pos == len) {
                block[i] = 0x80U;
            } else {
                block[i] = 0U;
            }
        }
        if (offset + 64ULL == total) {
            spl_u64 bit_len = len * 8ULL;
            block[56] = (spl_u8)((bit_len >> 56) & 0xffULL);
            block[57] = (spl_u8)((bit_len >> 48) & 0xffULL);
            block[58] = (spl_u8)((bit_len >> 40) & 0xffULL);
            block[59] = (spl_u8)((bit_len >> 32) & 0xffULL);
            block[60] = (spl_u8)((bit_len >> 24) & 0xffULL);
            block[61] = (spl_u8)((bit_len >> 16) & 0xffULL);
            block[62] = (spl_u8)((bit_len >> 8) & 0xffULL);
            block[63] = (spl_u8)(bit_len & 0xffULL);
        }
        sha256_compress(state, block);
        offset += 64ULL;
    }

    {
        spl_i64 out = rt_byte_array_new_len(rt_int(32));
        spl_i64 *data = (spl_i64 *)(spl_u64)rt_array_data_ptr(out);
        if (!data) {
            return rt_empty_bytes();
        }
        for (spl_u32 i = 0U; i < 8U; i++) {
            spl_u32 word = state[i];
            data[i * 4U + 0U] = rt_int((spl_i64)((word >> 24) & 0xffU));
            data[i * 4U + 1U] = rt_int((spl_i64)((word >> 16) & 0xffU));
            data[i * 4U + 2U] = rt_int((spl_i64)((word >> 8) & 0xffU));
            data[i * 4U + 3U] = rt_int((spl_i64)(word & 0xffU));
        }
        return out;
    }
}
