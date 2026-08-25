/* Freestanding RV64 SHA-512 helper for live Ed25519 signing. */

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

static spl_u64 rotr64(spl_u64 x, spl_u32 n) {
    return (x >> n) | (x << (64U - n));
}

static spl_u64 ch64(spl_u64 x, spl_u64 y, spl_u64 z) {
    return (x & y) ^ ((~x) & z);
}

static spl_u64 maj64(spl_u64 x, spl_u64 y, spl_u64 z) {
    return (x & y) ^ (x & z) ^ (y & z);
}

static spl_u64 bsig0(spl_u64 x) {
    return rotr64(x, 28U) ^ rotr64(x, 34U) ^ rotr64(x, 39U);
}

static spl_u64 bsig1(spl_u64 x) {
    return rotr64(x, 14U) ^ rotr64(x, 18U) ^ rotr64(x, 41U);
}

static spl_u64 ssig0(spl_u64 x) {
    return rotr64(x, 1U) ^ rotr64(x, 8U) ^ (x >> 7U);
}

static spl_u64 ssig1(spl_u64 x) {
    return rotr64(x, 19U) ^ rotr64(x, 61U) ^ (x >> 6U);
}

static const spl_u64 k512[80] = {
    0x428a2f98d728ae22ULL, 0x7137449123ef65cdULL, 0xb5c0fbcfec4d3b2fULL, 0xe9b5dba58189dbbcULL,
    0x3956c25bf348b538ULL, 0x59f111f1b605d019ULL, 0x923f82a4af194f9bULL, 0xab1c5ed5da6d8118ULL,
    0xd807aa98a3030242ULL, 0x12835b0145706fbeULL, 0x243185be4ee4b28cULL, 0x550c7dc3d5ffb4e2ULL,
    0x72be5d74f27b896fULL, 0x80deb1fe3b1696b1ULL, 0x9bdc06a725c71235ULL, 0xc19bf174cf692694ULL,
    0xe49b69c19ef14ad2ULL, 0xefbe4786384f25e3ULL, 0x0fc19dc68b8cd5b5ULL, 0x240ca1cc77ac9c65ULL,
    0x2de92c6f592b0275ULL, 0x4a7484aa6ea6e483ULL, 0x5cb0a9dcbd41fbd4ULL, 0x76f988da831153b5ULL,
    0x983e5152ee66dfabULL, 0xa831c66d2db43210ULL, 0xb00327c898fb213fULL, 0xbf597fc7beef0ee4ULL,
    0xc6e00bf33da88fc2ULL, 0xd5a79147930aa725ULL, 0x06ca6351e003826fULL, 0x142929670a0e6e70ULL,
    0x27b70a8546d22ffcULL, 0x2e1b21385c26c926ULL, 0x4d2c6dfc5ac42aedULL, 0x53380d139d95b3dfULL,
    0x650a73548baf63deULL, 0x766a0abb3c77b2a8ULL, 0x81c2c92e47edaee6ULL, 0x92722c851482353bULL,
    0xa2bfe8a14cf10364ULL, 0xa81a664bbc423001ULL, 0xc24b8b70d0f89791ULL, 0xc76c51a30654be30ULL,
    0xd192e819d6ef5218ULL, 0xd69906245565a910ULL, 0xf40e35855771202aULL, 0x106aa07032bbd1b8ULL,
    0x19a4c116b8d2d0c8ULL, 0x1e376c085141ab53ULL, 0x2748774cdf8eeb99ULL, 0x34b0bcb5e19b48a8ULL,
    0x391c0cb3c5c95a63ULL, 0x4ed8aa4ae3418acbULL, 0x5b9cca4f7763e373ULL, 0x682e6ff3d6b2b8a3ULL,
    0x748f82ee5defb2fcULL, 0x78a5636f43172f60ULL, 0x84c87814a1f0ab72ULL, 0x8cc702081a6439ecULL,
    0x90befffa23631e28ULL, 0xa4506cebde82bde9ULL, 0xbef9a3f7b2c67915ULL, 0xc67178f2e372532bULL,
    0xca273eceea26619cULL, 0xd186b8c721c0c207ULL, 0xeada7dd6cde0eb1eULL, 0xf57d4f7fee6ed178ULL,
    0x06f067aa72176fbaULL, 0x0a637dc5a2c898a6ULL, 0x113f9804bef90daeULL, 0x1b710b35131c471bULL,
    0x28db77f523047d84ULL, 0x32caab7b40c72493ULL, 0x3c9ebe0a15c9bebcULL, 0x431d67c49c100d4cULL,
    0x4cc5d4becb3e42b6ULL, 0x597f299cfc657e2aULL, 0x5fcb6fab3ad6faecULL, 0x6c44198c4a475817ULL
};

static void sha512_compress(spl_u64 state[8], const spl_u8 block[128]) {
    spl_u64 w[80];
    spl_u64 a, b, c, d, e, f, g, h;
    spl_u64 t1, t2;
    spl_u32 i;

    for (i = 0; i < 16U; i++) {
        spl_u32 j = i * 8U;
        w[i] = ((spl_u64)block[j] << 56) |
               ((spl_u64)block[j + 1U] << 48) |
               ((spl_u64)block[j + 2U] << 40) |
               ((spl_u64)block[j + 3U] << 32) |
               ((spl_u64)block[j + 4U] << 24) |
               ((spl_u64)block[j + 5U] << 16) |
               ((spl_u64)block[j + 6U] << 8) |
               (spl_u64)block[j + 7U];
    }
    for (i = 16U; i < 80U; i++) {
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

    for (i = 0; i < 80U; i++) {
        t1 = h + bsig1(e) + ch64(e, f, g) + k512[i] + w[i];
        t2 = bsig0(a) + maj64(a, b, c);
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

spl_i64 rt_tls13_sha512_full(spl_i64 data_value) {
    spl_i64 len_i64 = rt_array_len(data_value);
    spl_u64 len = len_i64 < 0 ? 0ULL : (spl_u64)len_i64;
    spl_u64 total = ((len + 17ULL + 127ULL) / 128ULL) * 128ULL;
    spl_u8 block[128];
    spl_u64 state[8] = {
        0x6a09e667f3bcc908ULL, 0xbb67ae8584caa73bULL,
        0x3c6ef372fe94f82bULL, 0xa54ff53a5f1d36f1ULL,
        0x510e527fade682d1ULL, 0x9b05688c2b3e6c1fULL,
        0x1f83d9abfb41bd6bULL, 0x5be0cd19137e2179ULL
    };
    spl_u64 offset = 0ULL;

    while (offset < total) {
        spl_u64 i;
        for (i = 0ULL; i < 128ULL; i++) {
            spl_u64 pos = offset + i;
            if (pos < len) {
                block[i] = (spl_u8)((spl_u64)rt_index_arg(rt_array_get(data_value, rt_int((spl_i64)pos))) & 0xffULL);
            } else if (pos == len) {
                block[i] = 0x80U;
            } else {
                block[i] = 0U;
            }
        }
        if (offset + 128ULL == total) {
            spl_u64 bit_len = len * 8ULL;
            block[120] = (spl_u8)((bit_len >> 56) & 0xffULL);
            block[121] = (spl_u8)((bit_len >> 48) & 0xffULL);
            block[122] = (spl_u8)((bit_len >> 40) & 0xffULL);
            block[123] = (spl_u8)((bit_len >> 32) & 0xffULL);
            block[124] = (spl_u8)((bit_len >> 24) & 0xffULL);
            block[125] = (spl_u8)((bit_len >> 16) & 0xffULL);
            block[126] = (spl_u8)((bit_len >> 8) & 0xffULL);
            block[127] = (spl_u8)(bit_len & 0xffULL);
        }
        sha512_compress(state, block);
        offset += 128ULL;
    }

    {
        spl_i64 out = rt_byte_array_new_len(rt_int(64));
        spl_i64 *data = (spl_i64 *)(spl_u64)rt_array_data_ptr(out);
        if (!data) {
            return rt_empty_bytes();
        }
        for (spl_u32 i = 0U; i < 8U; i++) {
            spl_u64 word = state[i];
            data[i * 8U + 0U] = rt_int((spl_i64)((word >> 56) & 0xffULL));
            data[i * 8U + 1U] = rt_int((spl_i64)((word >> 48) & 0xffULL));
            data[i * 8U + 2U] = rt_int((spl_i64)((word >> 40) & 0xffULL));
            data[i * 8U + 3U] = rt_int((spl_i64)((word >> 32) & 0xffULL));
            data[i * 8U + 4U] = rt_int((spl_i64)((word >> 24) & 0xffULL));
            data[i * 8U + 5U] = rt_int((spl_i64)((word >> 16) & 0xffULL));
            data[i * 8U + 6U] = rt_int((spl_i64)((word >> 8) & 0xffULL));
            data[i * 8U + 7U] = rt_int((spl_i64)(word & 0xffULL));
        }
        return out;
    }
}
