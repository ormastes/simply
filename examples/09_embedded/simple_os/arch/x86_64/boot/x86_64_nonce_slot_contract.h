#ifndef SIMPLEOS_X86_64_NONCE_SLOT_CONTRACT_H
#define SIMPLEOS_X86_64_NONCE_SLOT_CONTRACT_H

#include <stddef.h>
#include <stdint.h>

static size_t x86_64_nonce_slot_line_length_with_prefix(
    const uint8_t *slot, size_t slot_len, const char *prefix, size_t prefix_len)
{
    if (!slot || !prefix || prefix_len == 0U || slot_len <= prefix_len || slot_len > 118U) return 0;
    for (size_t i = 0; i < prefix_len; i++)
        if (slot[i] != (uint8_t)prefix[i]) return 0;
    size_t i = prefix_len;
    size_t nonce_begin = i;
    while (i < slot_len && slot[i] != '\n') {
        uint8_t c = slot[i];
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
              (c >= '0' && c <= '9') || c == '.' || c == '_' ||
              c == ':' || c == '-')) return 0;
        i++;
    }
    if (i == nonce_begin || i >= slot_len || slot[i] != '\n') return 0;
    size_t line_len = i + 1U;
    for (i = line_len; i < slot_len; i++) if (slot[i] != 0U) return 0;
    return line_len;
}

static size_t x86_64_nonce_slot_line_length(const uint8_t *slot, size_t slot_len)
{
    static const char prefix[] = "SIMPLEOS_QEMU_NONCE=";
    return x86_64_nonce_slot_line_length_with_prefix(
        slot, slot_len, prefix, sizeof(prefix) - 1U);
}

static size_t x86_64_collector_nonce_slot_line_length(const uint8_t *slot, size_t slot_len)
{
    static const char prefix[] = "SOSIX_COLLECTOR_RUN_NONCE=";
    return x86_64_nonce_slot_line_length_with_prefix(
        slot, slot_len, prefix, sizeof(prefix) - 1U);
}

#endif
