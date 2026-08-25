#include <stdint.h>
#include <stddef.h>

typedef int64_t RuntimeValue;

#define RV_INT int64_t

#define TAG_MASK    0x7ULL
#define TAG_INT     0x0ULL
#define TAG_HEAP    0x1ULL
#define TAG_SPECIAL 0x3ULL

#define ENCODE_INT(v)  ((RuntimeValue)(((uint64_t)(int64_t)(v) << 3) | TAG_INT))
#define ENCODE_PTR(p)  ((RuntimeValue)((uint64_t)(uintptr_t)(p) | TAG_HEAP))
#define DECODE_PTR(v)  ((void*)((uint64_t)(v) & ~TAG_MASK))
#define DECODE_INT(v)  ((int64_t)(v) >> 3)
#define IS_INT(v)      (((uint64_t)(v) & TAG_MASK) == TAG_INT)
#define IS_HEAP(v)     (((uint64_t)(v) & TAG_MASK) == TAG_HEAP)
#define NIL_VALUE      ((RuntimeValue)TAG_SPECIAL)

/* Native heap-header contract: type byte at offset 0, gc_flags byte at
 * offset 1. gc_flags bit 0x08 (BYTE_PACKED) marks a [u8] array whose payload
 * is packed bytes (1 byte/element) instead of 8-byte tagged slots. Binary
 * compatible with the old uint32 `type` when flags are zero. */
typedef struct {
    uint8_t  type;
    uint8_t  gc_flags;
    uint16_t reserved;
    uint32_t size;
} HeapHeader;

/* Arrays received here come from Simple/baremetal_stubs.c, whose layout is
 * 64-bit len/cap plus an items pointer (pointing at the inline region right
 * after the struct, or at a heap buffer). */
typedef struct {
    HeapHeader   hdr;
    uint64_t     len;
    uint64_t     cap;
    RuntimeValue *items;
} RuntimeArray;

#define HEAP_ARRAY 2
#define GC_BYTE_PACKED 0x08
#define CRYPTO_ARRAY_HDR_TYPE(hdr_ptr) ((hdr_ptr)->type)
#define CRYPTO_ARRAY_ITEMS(arr_ptr) \
    ((arr_ptr)->items ? (arr_ptr)->items \
                      : (RuntimeValue *)((uint8_t *)(arr_ptr) + sizeof(RuntimeArray)))

extern void *malloc(size_t size);
extern void free(void *ptr);
extern void *memcpy(void *dst, const void *src, size_t n);
extern void serial_puts(const char *s);
extern void serial_puthex(uint8_t v);
extern int64_t rt_tls13_ring_ed25519_verify_raw(const uint8_t *msg, uint32_t msg_len,
                                                const uint8_t pk[32], const uint8_t sig[64]);

/*
 * Import the shared portable Ed25519 implementation under helper-local names
 * so x86_64 baremetal can expose a known-good TLS CertificateVerify verifier
 * without colliding with any other runtime implementation.
 */
#define rt_sha512_K tls13_ed25519_helper_rt_sha512_K
#define rt_sha512_H tls13_ed25519_helper_rt_sha512_H
#define rt_sha256_K tls13_ed25519_helper_rt_sha256_K
#define rt_sha256_H tls13_ed25519_helper_rt_sha256_H
#define rt_aes_sbox tls13_ed25519_helper_rt_aes_sbox
#define rt_aes_inv_sbox tls13_ed25519_helper_rt_aes_inv_sbox
#define rt_aes_rcon tls13_ed25519_helper_rt_aes_rcon
#define rt_sha512_hash tls13_ed25519_helper_rt_sha512_hash
#define rt_sha512_byte tls13_ed25519_helper_rt_sha512_byte
#define rt_aes128_encrypt_block_into tls13_ed25519_helper_rt_aes128_encrypt_block_into
#define rt_ed25519_keypair tls13_ed25519_helper_rt_ed25519_keypair
#define rt_ed25519_sign tls13_ed25519_helper_rt_ed25519_sign
#define rt_ed25519_sign_seed tls13_ed25519_helper_rt_ed25519_sign_seed
#define rt_ed25519_verify tls13_ed25519_helper_rt_ed25519_verify
#define rt_ed25519_self_test tls13_ed25519_helper_rt_ed25519_self_test
#include "../../shared/crypto_common.h"
#undef rt_sha512_K
#undef rt_sha512_H
#undef rt_sha256_K
#undef rt_sha256_H
#undef rt_aes_sbox
#undef rt_aes_inv_sbox
#undef rt_aes_rcon
#undef rt_sha512_hash
#undef rt_sha512_byte
#undef rt_aes128_encrypt_block_into
#undef rt_ed25519_keypair
#undef rt_ed25519_sign
#undef rt_ed25519_sign_seed
#undef rt_ed25519_verify
#undef rt_ed25519_self_test
#undef RV_INT

static uint8_t _ed_rv_byte(RuntimeValue rv)
{
    return IS_INT(rv) ? (uint8_t)DECODE_INT(rv) : 0;
}

static uint8_t *_ed_rv_to_bytes(RuntimeValue rv, uint32_t *out_len)
{
    *out_len = 0;
    if (!IS_HEAP(rv)) return NULL;
    RuntimeArray *arr = (RuntimeArray *)DECODE_PTR(rv);
    if (!arr || CRYPTO_ARRAY_HDR_TYPE(&arr->hdr) != HEAP_ARRAY) return NULL;
    uint32_t len = (uint32_t)arr->len;
    uint8_t *buf = (uint8_t *)malloc(len > 0 ? len : 1);
    if (!buf) return NULL;
    RuntimeValue *it = CRYPTO_ARRAY_ITEMS(arr);
    if (arr->hdr.gc_flags & GC_BYTE_PACKED) {
        /* Packed [u8]: 1 byte per element. */
        for (uint32_t i = 0; i < len; i++) buf[i] = ((const uint8_t *)it)[i];
    } else {
        for (uint32_t i = 0; i < len; i++) buf[i] = _ed_rv_byte(it[i]);
    }
    *out_len = len;
    return buf;
}

int64_t rt_tls13_ed25519_verify_raw(const uint8_t *msg, uint32_t msg_len,
                                    const uint8_t pk[32], const uint8_t sig[64])
{
    if (!pk || !sig) return -1;
    return _ed25519_verify(msg ? msg : (const uint8_t *)"", msg_len, pk, sig);
}

int64_t rt_tls13_ed25519_verify(RuntimeValue msg_rv, RuntimeValue pk_rv, RuntimeValue sig_rv)
{
    uint32_t msg_len = 0, pk_len = 0, sig_len = 0;
    uint8_t *msg = _ed_rv_to_bytes(msg_rv, &msg_len);
    uint8_t *pk = _ed_rv_to_bytes(pk_rv, &pk_len);
    uint8_t *sig = _ed_rv_to_bytes(sig_rv, &sig_len);
    if (!pk || pk_len != 32 || !sig || sig_len != 64) {
        if (msg) free(msg);
        if (pk) free(pk);
        if (sig) free(sig);
        return -1;
    }
    int64_t rc = rt_tls13_ed25519_verify_raw(msg ? msg : (const uint8_t *)"", msg_len, pk, sig);
    if (msg) free(msg);
    free(pk);
    free(sig);
    return rc;
}
