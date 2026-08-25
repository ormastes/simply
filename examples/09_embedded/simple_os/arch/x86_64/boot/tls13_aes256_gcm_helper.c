#include <stdint.h>
#include <stddef.h>

typedef long long spl_i64;

#define X86_TAG_MASK 0x7ULL
#define X86_TAG_INT 0x0ULL
#define X86_TAG_HEAP 0x1ULL
#define X86_HEAP_ARRAY 2

#define X86_GC_BYTE_PACKED 0x08

/* Native heap-header contract: type byte at offset 0, gc_flags byte at
 * offset 1. gc_flags bit 0x08 (BYTE_PACKED) marks a [u8] array whose payload
 * is packed bytes (1 byte/element) instead of 8-byte tagged slots. Binary
 * compatible with the old uint32 `type` when flags are zero. */
typedef struct {
    uint8_t  type;
    uint8_t  gc_flags;
    uint16_t reserved;
    uint32_t size;
} X86HeapHeader;

typedef struct {
    X86HeapHeader hdr;
    uint64_t len;
    uint64_t cap;
    spl_i64 *items;
} X86RuntimeArray;

extern void *malloc(size_t size);

static inline spl_i64 *x86_runtime_array_inline_items(X86RuntimeArray *a)
{
    return (spl_i64 *)((uint8_t *)a + sizeof(X86RuntimeArray));
}

static inline spl_i64 *x86_runtime_array_items(X86RuntimeArray *a)
{
    return a && a->items ? a->items : x86_runtime_array_inline_items(a);
}

static spl_i64 x86_aes_helper_byte_array_new_len(spl_i64 encoded_len)
{
    uint64_t len = ((uint64_t)encoded_len) >> 3;
    size_t bytes = sizeof(X86RuntimeArray) + (size_t)len * sizeof(spl_i64);
    X86RuntimeArray *a = (X86RuntimeArray *)malloc(bytes);
    if (!a) return 0x3;
    a->hdr.type = X86_HEAP_ARRAY;
    a->hdr.gc_flags = 0; /* tagged slots; entry points repack to BYTE_PACKED */
    a->hdr.reserved = 0;
    a->hdr.size = (uint32_t)bytes;
    a->len = len;
    a->cap = len;
    a->items = x86_runtime_array_inline_items(a);
    for (uint64_t i = 0; i < len; i++) a->items[i] = 0;
    return (spl_i64)((uint64_t)(uintptr_t)a | X86_TAG_HEAP);
}

static spl_i64 x86_aes_helper_array_data_ptr(spl_i64 array_value)
{
    if ((((uint64_t)array_value) & X86_TAG_MASK) != X86_TAG_HEAP) return 0;
    X86RuntimeArray *a = (X86RuntimeArray *)((uint64_t)array_value & ~X86_TAG_MASK);
    if (!a || a->hdr.type != X86_HEAP_ARRAY) return 0;
    return (spl_i64)(uintptr_t)x86_runtime_array_items(a);
}

static spl_i64 x86_aes_helper_array_get(spl_i64 array_value, spl_i64 encoded_index)
{
    if ((((uint64_t)array_value) & X86_TAG_MASK) != X86_TAG_HEAP) return 0x3;
    X86RuntimeArray *a = (X86RuntimeArray *)((uint64_t)array_value & ~X86_TAG_MASK);
    uint64_t index = ((uint64_t)encoded_index) >> 3;
    if (!a || a->hdr.type != X86_HEAP_ARRAY || index >= a->len) return 0x3;
    spl_i64 *it = x86_runtime_array_items(a);
    if (a->hdr.gc_flags & X86_GC_BYTE_PACKED) {
        /* Packed [u8] from Simple: 1 byte/element; return rt_int-encoded so
         * the included rv64 code's >>3 decode recovers the byte. */
        return (spl_i64)(((uint64_t)((const uint8_t *)it)[index]) << 3);
    }
    return it[index];
}

/* The included rv64 helper writes tagged 8-byte slots into arrays via
 * rt_array_data_ptr / rt_array_push. Simple-visible [u8] must be packed, so
 * repack in place before returning (tagged slots occupy 8x the packed size,
 * so the packed payload always fits in the existing items region). */
static spl_i64 x86_aes_repack_bytes(spl_i64 rv)
{
    if ((((uint64_t)rv) & X86_TAG_MASK) != X86_TAG_HEAP) return rv;
    X86RuntimeArray *a = (X86RuntimeArray *)((uint64_t)rv & ~X86_TAG_MASK);
    if (!a || a->hdr.type != X86_HEAP_ARRAY) return rv;
    if (a->hdr.gc_flags & X86_GC_BYTE_PACKED) return rv;
    spl_i64 *it = x86_runtime_array_items(a);
    uint8_t *dst = (uint8_t *)it;
    for (uint64_t i = 0; i < a->len; i++) {
        uint64_t v = (uint64_t)it[i];
        dst[i] = (uint8_t)((((v & X86_TAG_MASK) == X86_TAG_INT) ? (v >> 3) : v) & 0xffULL);
    }
    a->hdr.gc_flags |= X86_GC_BYTE_PACKED;
    a->cap = a->len;
    return rv;
}

#define rt_byte_array_new_len x86_aes_helper_byte_array_new_len
#define rt_array_data_ptr x86_aes_helper_array_data_ptr
#define rt_array_get x86_aes_helper_array_get

/* Rename the byte-returning entry points so we can wrap them below with a
 * tagged->packed repack before the arrays cross into Simple as [u8]. */
#define rt_tls13_aes256_gcm_encrypt x86_tls13_aes256_gcm_encrypt_tagged
#define rt_tls13_aes256_gcm_decrypt x86_tls13_aes256_gcm_decrypt_tagged
#define rt_ssh_aes256_gcm_decrypt_packet x86_ssh_aes256_gcm_decrypt_packet_tagged

#include "../../riscv64/boot/tls13_aes256_gcm_helper.c"

#undef rt_tls13_aes256_gcm_encrypt
#undef rt_tls13_aes256_gcm_decrypt
#undef rt_ssh_aes256_gcm_decrypt_packet

spl_i64 rt_tls13_aes256_gcm_encrypt(spl_i64 key_value, spl_i64 nonce_value,
                                    spl_i64 plaintext_value, spl_i64 aad_value)
{
    return x86_aes_repack_bytes(x86_tls13_aes256_gcm_encrypt_tagged(
        key_value, nonce_value, plaintext_value, aad_value));
}

spl_i64 rt_tls13_aes256_gcm_decrypt(spl_i64 key_value, spl_i64 nonce_value,
                                    spl_i64 ciphertext_value, spl_i64 aad_value,
                                    spl_i64 tag_value)
{
    return x86_aes_repack_bytes(x86_tls13_aes256_gcm_decrypt_tagged(
        key_value, nonce_value, ciphertext_value, aad_value, tag_value));
}

spl_i64 rt_ssh_aes256_gcm_decrypt_packet(spl_i64 key_value, spl_i64 iv_value,
                                         spl_i64 seq_value, spl_i64 packet_value)
{
    return x86_aes_repack_bytes(x86_ssh_aes256_gcm_decrypt_packet_tagged(
        key_value, iv_value, seq_value, packet_value));
}
