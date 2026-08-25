#include <efi.h>
#include <efilib.h>
#include <stdint.h>

#define UP2_DCI_MAGIC UINT64_C(0x3130494344325055)
#define UP2_DCI_SCHEMA UINT16_C(1)
#define UP2_DCI_WIRE_SIZE UINT16_C(128)
#define UP2_DCI_BOOT_COMMAND UINT32_C(1)
#define UP2_DCI_COMMITTED UINT32_C(2)
#define UP2_DCI_MAILBOX_ADDRESS UINT64_C(0x0c000000)
#define UP2_DCI_PAYLOAD_ADDRESS UINT64_C(0x0c100000)
#define UP2_DCI_PAYLOAD_BYTES UINT64_C(0x01000000)
#define UP2_DCI_FALLBACK_POLLS 100u
#define UP2_DCI_KERNEL_ADDRESS UINT64_C(0x08000000)
#define UP2_DCI_KERNEL_BYTES UINT64_C(0x03000000)
#define UP2_DCI_MBI_ADDRESS UINT64_C(0x0c001000)
#define UP2_DCI_MBI_BYTES UINT64_C(0x00040000)
#define UP2_DCI_SHIM_ADDRESS UINT64_C(0x00100000)
#define UP2_DCI_SHIM_BYTES UINT64_C(0x00010000)
#define UP2_DCI_MAX_PROGRAM_HEADERS 32u
#define ELF_PROGRAM_LOAD UINT32_C(1)
#define ELF_FLAG_EXECUTE UINT32_C(1)
#define MULTIBOOT2_BOOT_MAGIC UINT32_C(0x36d76289)
#define MULTIBOOT2_TAG_END UINT32_C(0)
#define MULTIBOOT2_TAG_MODULE UINT32_C(3)
#define MULTIBOOT2_TAG_EFI_MEMORY_MAP UINT32_C(17)

typedef struct {
    uint32_t state[8];
    uint64_t total_bytes;
    uint32_t block_bytes;
    uint8_t block[64];
} Sha256Context;

typedef struct {
    uint64_t source_offset;
    uint64_t destination;
    uint64_t file_bytes;
    uint64_t memory_bytes;
} ElfLoadSegment;

extern void up2_dci_enter32(uint32_t entry, uint32_t multiboot_info)
    __attribute__((noreturn));
extern const uint8_t _binary_shim_elf_start[];
extern const uint8_t _binary_shim_elf_end[];

static const uint32_t sha256_initial[8] = {
    0x6a09e667u, 0xbb67ae85u, 0x3c6ef372u, 0xa54ff53au,
    0x510e527fu, 0x9b05688cu, 0x1f83d9abu, 0x5be0cd19u
};

static const uint32_t sha256_round[64] = {
    0x428a2f98u, 0x71374491u, 0xb5c0fbcfu, 0xe9b5dba5u,
    0x3956c25bu, 0x59f111f1u, 0x923f82a4u, 0xab1c5ed5u,
    0xd807aa98u, 0x12835b01u, 0x243185beu, 0x550c7dc3u,
    0x72be5d74u, 0x80deb1feu, 0x9bdc06a7u, 0xc19bf174u,
    0xe49b69c1u, 0xefbe4786u, 0x0fc19dc6u, 0x240ca1ccu,
    0x2de92c6fu, 0x4a7484aau, 0x5cb0a9dcu, 0x76f988dau,
    0x983e5152u, 0xa831c66du, 0xb00327c8u, 0xbf597fc7u,
    0xc6e00bf3u, 0xd5a79147u, 0x06ca6351u, 0x14292967u,
    0x27b70a85u, 0x2e1b2138u, 0x4d2c6dfcu, 0x53380d13u,
    0x650a7354u, 0x766a0abbu, 0x81c2c92eu, 0x92722c85u,
    0xa2bfe8a1u, 0xa81a664bu, 0xc24b8b70u, 0xc76c51a3u,
    0xd192e819u, 0xd6990624u, 0xf40e3585u, 0x106aa070u,
    0x19a4c116u, 0x1e376c08u, 0x2748774cu, 0x34b0bcb5u,
    0x391c0cb3u, 0x4ed8aa4au, 0x5b9cca4fu, 0x682e6ff3u,
    0x748f82eeu, 0x78a5636fu, 0x84c87814u, 0x8cc70208u,
    0x90befffau, 0xa4506cebu, 0xbef9a3f7u, 0xc67178f2u
};

typedef struct __attribute__((packed, aligned(4))) {
    uint64_t magic;
    uint16_t version;
    uint16_t header_size;
    uint32_t total_size;
    uint64_t generation;
    uint64_t nonce;
    uint64_t payload_address;
    uint64_t payload_capacity;
    uint64_t payload_size;
    uint8_t payload_sha256[32];
    uint32_t command;
    uint32_t status;
    uint32_t error;
    uint8_t reserved[24];
    volatile uint32_t commit;
} Up2DciMailboxWireV1;

_Static_assert(sizeof(Up2DciMailboxWireV1) == 128, "UP2 DCI wire size");
_Static_assert(__builtin_offsetof(Up2DciMailboxWireV1, commit) == 124,
    "UP2 DCI commit offset");

static EFI_GUID up2_dci_mailbox_guid = {
    0x5dc2a332, 0x36d8, 0x4bd2,
    {0xa8, 0xa9, 0x33, 0x91, 0xe5, 0x65, 0xe2, 0x15}
};

static EFI_GUID efi_rng_protocol_guid = EFI_RNG_PROTOCOL_GUID;

static void io_out8(uint16_t port, uint8_t value) {
    __asm__ volatile("outb %0, %1" : : "a"(value), "Nd"(port));
}

static uint8_t io_in8(uint16_t port) {
    uint8_t value;
    __asm__ volatile("inb %1, %0" : "=a"(value) : "Nd"(port));
    return value;
}

static void serial_init(void) {
    io_out8(0x3f9, 0x00);
    io_out8(0x3fb, 0x80);
    io_out8(0x3f8, 0x03);
    io_out8(0x3f9, 0x00);
    io_out8(0x3fb, 0x03);
    io_out8(0x3fa, 0xc7);
    io_out8(0x3fc, 0x0b);
}

static void serial_putc(char value) {
    uint32_t spins = 1000000u;
    while ((io_in8(0x3fd) & 0x20u) == 0u && spins != 0u) {
        --spins;
    }
    if (spins != 0u) {
        io_out8(0x3f8, (uint8_t)value);
    }
}

static void serial_puts(const char *value) {
    while (*value != '\0') {
        serial_putc(*value++);
    }
}

static void serial_hex64(uint64_t value) {
    static const char digits[] = "0123456789abcdef";
    for (int shift = 60; shift >= 0; shift -= 4) {
        serial_putc(digits[(value >> (unsigned)shift) & 0xfu]);
    }
}

static uint32_t rotate_right(uint32_t value, unsigned shift) {
    return (value >> shift) | (value << (32u - shift));
}

static void sha256_process(Sha256Context *context, const uint8_t block[64]) {
    uint32_t schedule[64];
    uint32_t a, b, c, d, e, f, g, h;
    for (unsigned index = 0; index < 16u; ++index) {
        unsigned offset = index * 4u;
        schedule[index] = ((uint32_t)block[offset] << 24) |
            ((uint32_t)block[offset + 1u] << 16) |
            ((uint32_t)block[offset + 2u] << 8) |
            (uint32_t)block[offset + 3u];
    }
    for (unsigned index = 16u; index < 64u; ++index) {
        uint32_t x = schedule[index - 15u];
        uint32_t y = schedule[index - 2u];
        uint32_t sigma0 = rotate_right(x, 7u) ^ rotate_right(x, 18u) ^ (x >> 3u);
        uint32_t sigma1 = rotate_right(y, 17u) ^ rotate_right(y, 19u) ^ (y >> 10u);
        schedule[index] = schedule[index - 16u] + sigma0 +
            schedule[index - 7u] + sigma1;
    }
    a = context->state[0]; b = context->state[1];
    c = context->state[2]; d = context->state[3];
    e = context->state[4]; f = context->state[5];
    g = context->state[6]; h = context->state[7];
    for (unsigned index = 0; index < 64u; ++index) {
        uint32_t sum1 = rotate_right(e, 6u) ^ rotate_right(e, 11u) ^
            rotate_right(e, 25u);
        uint32_t choose = (e & f) ^ (~e & g);
        uint32_t temp1 = h + sum1 + choose + sha256_round[index] + schedule[index];
        uint32_t sum0 = rotate_right(a, 2u) ^ rotate_right(a, 13u) ^
            rotate_right(a, 22u);
        uint32_t majority = (a & b) ^ (a & c) ^ (b & c);
        uint32_t temp2 = sum0 + majority;
        h = g; g = f; f = e; e = d + temp1;
        d = c; c = b; b = a; a = temp1 + temp2;
    }
    context->state[0] += a; context->state[1] += b;
    context->state[2] += c; context->state[3] += d;
    context->state[4] += e; context->state[5] += f;
    context->state[6] += g; context->state[7] += h;
}

static void sha256_init(Sha256Context *context) {
    CopyMem(context->state, sha256_initial, sizeof(sha256_initial));
    context->total_bytes = 0;
    context->block_bytes = 0;
}

static void sha256_update(Sha256Context *context, const uint8_t *bytes,
    uint64_t byte_count) {
    context->total_bytes += byte_count;
    while (byte_count != 0u) {
        uint32_t available = 64u - context->block_bytes;
        uint32_t take = byte_count < available ? (uint32_t)byte_count : available;
        CopyMem(context->block + context->block_bytes, bytes, take);
        context->block_bytes += take;
        bytes += take;
        byte_count -= take;
        if (context->block_bytes == 64u) {
            sha256_process(context, context->block);
            context->block_bytes = 0;
        }
    }
}

static void sha256_final(Sha256Context *context, uint8_t digest[32]) {
    uint64_t bit_count = context->total_bytes * UINT64_C(8);
    uint8_t suffix[128];
    uint32_t suffix_bytes = context->block_bytes;
    CopyMem(suffix, context->block, suffix_bytes);
    suffix[suffix_bytes++] = 0x80u;
    while ((suffix_bytes % 64u) != 56u) {
        suffix[suffix_bytes++] = 0;
    }
    for (unsigned index = 0; index < 8u; ++index) {
        suffix[suffix_bytes++] = (uint8_t)(bit_count >> (56u - index * 8u));
    }
    for (uint32_t offset = 0; offset < suffix_bytes; offset += 64u) {
        sha256_process(context, suffix + offset);
    }
    for (unsigned index = 0; index < 8u; ++index) {
        digest[index * 4u] = (uint8_t)(context->state[index] >> 24);
        digest[index * 4u + 1u] = (uint8_t)(context->state[index] >> 16);
        digest[index * 4u + 2u] = (uint8_t)(context->state[index] >> 8);
        digest[index * 4u + 3u] = (uint8_t)context->state[index];
    }
}

static int bytes_equal(const uint8_t *left, const uint8_t *right,
    uint32_t byte_count) {
    uint8_t difference = 0;
    for (uint32_t index = 0; index < byte_count; ++index) {
        difference |= left[index] ^ right[index];
    }
    return difference == 0;
}

static int reserved_is_zero(const uint8_t reserved[24]) {
    uint8_t combined = 0;
    for (unsigned index = 0; index < 24u; ++index) {
        combined |= reserved[index];
    }
    return combined == 0;
}

static void invalidate_payload(const uint8_t *payload, uint64_t byte_count) {
    for (uint64_t offset = 0; offset < byte_count; offset += 64u) {
        __asm__ volatile("clflush (%0)" : : "r"(payload + offset) : "memory");
    }
    __asm__ volatile("mfence" : : : "memory");
}

static const char *validate_committed_mailbox(
    const Up2DciMailboxWireV1 *mailbox, uint64_t expected_nonce) {
    if (mailbox->magic != UP2_DCI_MAGIC || mailbox->version != UP2_DCI_SCHEMA ||
        mailbox->header_size != UP2_DCI_WIRE_SIZE ||
        mailbox->total_size != UP2_DCI_WIRE_SIZE) {
        return "schema";
    }
    if (mailbox->generation == 0u || mailbox->nonce != expected_nonce) {
        return "freshness";
    }
    if (mailbox->payload_address != UP2_DCI_PAYLOAD_ADDRESS ||
        mailbox->payload_capacity != UP2_DCI_PAYLOAD_BYTES ||
        mailbox->payload_size == 0u ||
        mailbox->payload_size > UP2_DCI_PAYLOAD_BYTES) {
        return "payload-bounds";
    }
    if (mailbox->command != UP2_DCI_BOOT_COMMAND || mailbox->status != 0u ||
        mailbox->error != 0u || !reserved_is_zero(mailbox->reserved) ||
        mailbox->commit != UP2_DCI_COMMITTED) {
        return "control";
    }
    return NULL;
}

static uint16_t read_le16(const uint8_t *bytes) {
    return (uint16_t)bytes[0] | ((uint16_t)bytes[1] << 8);
}

static uint32_t read_le32(const uint8_t *bytes) {
    return (uint32_t)bytes[0] | ((uint32_t)bytes[1] << 8) |
        ((uint32_t)bytes[2] << 16) | ((uint32_t)bytes[3] << 24);
}

static uint64_t read_le64(const uint8_t *bytes) {
    return (uint64_t)read_le32(bytes) | ((uint64_t)read_le32(bytes + 4) << 32);
}

static int range_within(uint64_t start, uint64_t byte_count,
    uint64_t lower, uint64_t upper) {
    return start >= lower && byte_count <= upper - lower &&
        start - lower <= (upper - lower) - byte_count;
}

static int ranges_overlap(uint64_t left_start, uint64_t left_bytes,
    uint64_t right_start, uint64_t right_bytes) {
    return left_start < right_start + right_bytes &&
        right_start < left_start + left_bytes;
}

static const char *load_kernel_elf64(const uint8_t *elf, uint64_t elf_bytes,
    uint32_t *entry_out) {
    ElfLoadSegment segments[UP2_DCI_MAX_PROGRAM_HEADERS];
    uint32_t segment_count = 0;
    int entry_is_executable = 0;
    if (elf_bytes < 64u || elf[0] != 0x7fu || elf[1] != 'E' ||
        elf[2] != 'L' || elf[3] != 'F' || elf[4] != 2u || elf[5] != 1u ||
        elf[6] != 1u || read_le16(elf + 16) != 2u ||
        read_le16(elf + 18) != 62u || read_le32(elf + 20) != 1u) {
        return "elf-ident";
    }
    uint64_t entry = read_le64(elf + 24);
    uint64_t program_offset = read_le64(elf + 32);
    uint16_t program_size = read_le16(elf + 54);
    uint16_t program_count = read_le16(elf + 56);
    if (entry > UINT32_MAX || program_size != 56u || program_count == 0u ||
        program_count > UP2_DCI_MAX_PROGRAM_HEADERS ||
        program_offset > elf_bytes ||
        (uint64_t)program_count * program_size > elf_bytes - program_offset) {
        return "elf-header";
    }
    for (uint32_t index = 0; index < program_count; ++index) {
        const uint8_t *program = elf + program_offset + (uint64_t)index * program_size;
        if (read_le32(program) != ELF_PROGRAM_LOAD) {
            continue;
        }
        uint32_t flags = read_le32(program + 4);
        uint64_t source_offset = read_le64(program + 8);
        uint64_t virtual_address = read_le64(program + 16);
        uint64_t destination = read_le64(program + 24);
        uint64_t file_bytes = read_le64(program + 32);
        uint64_t memory_bytes = read_le64(program + 40);
        if (virtual_address != destination || file_bytes > memory_bytes ||
            source_offset > elf_bytes || file_bytes > elf_bytes - source_offset ||
            memory_bytes == 0u || !range_within(destination, memory_bytes,
                UP2_DCI_KERNEL_ADDRESS,
                UP2_DCI_KERNEL_ADDRESS + UP2_DCI_KERNEL_BYTES)) {
            return "elf-segment-bounds";
        }
        for (uint32_t prior = 0; prior < segment_count; ++prior) {
            if (ranges_overlap(destination, memory_bytes,
                    segments[prior].destination, segments[prior].memory_bytes)) {
                return "elf-segment-overlap";
            }
        }
        segments[segment_count].source_offset = source_offset;
        segments[segment_count].destination = destination;
        segments[segment_count].file_bytes = file_bytes;
        segments[segment_count].memory_bytes = memory_bytes;
        ++segment_count;
        if ((flags & ELF_FLAG_EXECUTE) != 0u && entry >= destination &&
            entry < destination + memory_bytes) {
            entry_is_executable = 1;
        }
    }
    if (segment_count == 0u || !entry_is_executable) {
        return "elf-entry";
    }
    for (uint32_t index = 0; index < segment_count; ++index) {
        uint8_t *destination = (uint8_t *)(uintptr_t)segments[index].destination;
        CopyMem(destination, elf + segments[index].source_offset,
            (UINTN)segments[index].file_bytes);
        SetMem(destination + segments[index].file_bytes,
            (UINTN)(segments[index].memory_bytes - segments[index].file_bytes), 0);
    }
    *entry_out = (uint32_t)entry;
    return NULL;
}

static const char *load_embedded_shim(uint32_t *entry_out) {
    const uint8_t *elf = _binary_shim_elf_start;
    uint64_t elf_bytes = (uint64_t)(_binary_shim_elf_end - _binary_shim_elf_start);
    uint32_t segment_count = 0;
    int entry_is_executable = 0;
    if (elf_bytes < 52u || elf[0] != 0x7fu || elf[1] != 'E' ||
        elf[2] != 'L' || elf[3] != 'F' || elf[4] != 1u || elf[5] != 1u ||
        elf[6] != 1u || read_le16(elf + 16) != 2u ||
        read_le16(elf + 18) != 3u || read_le32(elf + 20) != 1u) {
        return "shim-ident";
    }
    uint32_t entry = read_le32(elf + 24);
    uint32_t program_offset = read_le32(elf + 28);
    uint16_t program_size = read_le16(elf + 42);
    uint16_t program_count = read_le16(elf + 44);
    if (program_size != 32u || program_count == 0u ||
        program_count > UP2_DCI_MAX_PROGRAM_HEADERS ||
        program_offset > elf_bytes ||
        (uint64_t)program_count * program_size > elf_bytes - program_offset) {
        return "shim-header";
    }
    for (uint32_t index = 0; index < program_count; ++index) {
        const uint8_t *program = elf + program_offset + (uint64_t)index * program_size;
        if (read_le32(program) != ELF_PROGRAM_LOAD) {
            continue;
        }
        uint32_t source_offset = read_le32(program + 4);
        uint32_t virtual_address = read_le32(program + 8);
        uint32_t destination = read_le32(program + 12);
        uint32_t file_bytes = read_le32(program + 16);
        uint32_t memory_bytes = read_le32(program + 20);
        uint32_t flags = read_le32(program + 24);
        if (virtual_address != destination || file_bytes > memory_bytes ||
            source_offset > elf_bytes || file_bytes > elf_bytes - source_offset ||
            memory_bytes == 0u || !range_within(destination, memory_bytes,
                UP2_DCI_SHIM_ADDRESS,
                UP2_DCI_SHIM_ADDRESS + UP2_DCI_SHIM_BYTES)) {
            return "shim-segment-bounds";
        }
        CopyMem((void *)(uintptr_t)destination, elf + source_offset, file_bytes);
        SetMem((void *)(uintptr_t)(destination + file_bytes),
            memory_bytes - file_bytes, 0);
        ++segment_count;
        if ((flags & ELF_FLAG_EXECUTE) != 0u && entry >= destination &&
            entry < destination + memory_bytes) {
            entry_is_executable = 1;
        }
    }
    if (segment_count == 0u || !entry_is_executable) {
        return "shim-entry";
    }
    *entry_out = entry;
    return NULL;
}

static EFI_STATUS exit_boot_services_with_mbi(EFI_HANDLE image_handle,
    EFI_SYSTEM_TABLE *system_table, uint32_t *mbi_out) {
    uint8_t *mbi = (uint8_t *)(uintptr_t)UP2_DCI_MBI_ADDRESS;
    const UINTN map_tag_offset = 40u;
    const UINTN map_offset = 56u;
    const UINTN map_capacity = (UINTN)UP2_DCI_MBI_BYTES - map_offset - 16u;
    for (unsigned attempt = 0; attempt < 2u; ++attempt) {
        UINTN map_bytes = map_capacity;
        UINTN map_key = 0;
        UINTN descriptor_bytes = 0;
        UINT32 descriptor_version = 0;
        EFI_STATUS status = uefi_call_wrapper(
            system_table->BootServices->GetMemoryMap, 5, &map_bytes,
            (EFI_MEMORY_DESCRIPTOR *)(mbi + map_offset), &map_key,
            &descriptor_bytes, &descriptor_version);
        if (EFI_ERROR(status)) {
            return status;
        }
        uint32_t tag_bytes = (uint32_t)(16u + map_bytes);
        uint32_t end_offset = (uint32_t)((map_tag_offset + tag_bytes + 7u) & ~7u);
        if ((uint64_t)end_offset + 8u > UP2_DCI_MBI_BYTES ||
            descriptor_bytes > UINT32_MAX) {
            return EFI_OUT_OF_RESOURCES;
        }
        SetMem(mbi, map_offset, 0);
        *(uint32_t *)(void *)(mbi + 0) = end_offset + 8u;
        *(uint32_t *)(void *)(mbi + 8) = MULTIBOOT2_TAG_MODULE;
        *(uint32_t *)(void *)(mbi + 12) = 32u;
        *(uint32_t *)(void *)(mbi + 16) = (uint32_t)UP2_DCI_PAYLOAD_ADDRESS;
        *(uint32_t *)(void *)(mbi + 20) =
            (uint32_t)(UP2_DCI_PAYLOAD_ADDRESS +
                ((Up2DciMailboxWireV1 *)(uintptr_t)UP2_DCI_MAILBOX_ADDRESS)->payload_size);
        CopyMem(mbi + 24, "simpleos-kernel", 16u);
        *(uint32_t *)(void *)(mbi + map_tag_offset) = MULTIBOOT2_TAG_EFI_MEMORY_MAP;
        *(uint32_t *)(void *)(mbi + map_tag_offset + 4u) = tag_bytes;
        *(uint32_t *)(void *)(mbi + map_tag_offset + 8u) = (uint32_t)descriptor_bytes;
        *(uint32_t *)(void *)(mbi + map_tag_offset + 12u) = descriptor_version;
        SetMem(mbi + map_tag_offset + tag_bytes,
            end_offset - (map_tag_offset + tag_bytes), 0);
        *(uint32_t *)(void *)(mbi + end_offset) = MULTIBOOT2_TAG_END;
        *(uint32_t *)(void *)(mbi + end_offset + 4u) = 8u;
        status = uefi_call_wrapper(system_table->BootServices->ExitBootServices,
            2, image_handle, map_key);
        if (!EFI_ERROR(status)) {
            *mbi_out = (uint32_t)UP2_DCI_MBI_ADDRESS;
            return EFI_SUCCESS;
        }
        if (status != EFI_INVALID_PARAMETER) {
            return status;
        }
    }
    return EFI_INVALID_PARAMETER;
}

static uint64_t fallback_nonce(EFI_SYSTEM_TABLE *system_table) {
    EFI_TIME now;
    uint64_t ticks;
    uint32_t ticks_low;
    uint32_t ticks_high;
    __asm__ volatile("rdtsc" : "=a"(ticks_low), "=d"(ticks_high));
    ticks = ((uint64_t)ticks_high << 32) | ticks_low;
    if (!EFI_ERROR(uefi_call_wrapper(system_table->RuntimeServices->GetTime,
            2, &now, NULL))) {
        ticks ^= ((uint64_t)now.Year << 48) ^ ((uint64_t)now.Month << 40) ^
            ((uint64_t)now.Day << 32) ^ ((uint64_t)now.Hour << 24) ^
            ((uint64_t)now.Minute << 16) ^ ((uint64_t)now.Second << 8) ^
            now.Nanosecond;
    }
    return ticks == 0 ? UINT64_C(1) : ticks;
}

static uint64_t generate_nonce(EFI_SYSTEM_TABLE *system_table,
    int *strong_out) {
    EFI_RNG_PROTOCOL *rng = NULL;
    uint64_t nonce = 0;
    EFI_STATUS status = uefi_call_wrapper(
        system_table->BootServices->LocateProtocol, 3,
        &efi_rng_protocol_guid, NULL, (void **)&rng);
    if (!EFI_ERROR(status) && rng != NULL) {
        status = uefi_call_wrapper(rng->GetRNG, 4, rng, NULL,
            sizeof(nonce), (uint8_t *)&nonce);
        if (!EFI_ERROR(status) && nonce != 0u) {
            *strong_out = 1;
            return nonce;
        }
    }
    uint32_t eax = 1u;
    uint32_t ebx;
    uint32_t ecx;
    uint32_t edx;
    __asm__ volatile("cpuid"
        : "+a"(eax), "=b"(ebx), "=c"(ecx), "=d"(edx));
    if ((ecx & (UINT32_C(1) << 30)) != 0u) {
        for (unsigned attempt = 0; attempt < 16u; ++attempt) {
            unsigned char ready;
            __asm__ volatile("rdrand %0; setc %1" : "=r"(nonce), "=qm"(ready));
            if (ready != 0u && nonce != 0u) {
                *strong_out = 1;
                return nonce;
            }
        }
    }
    *strong_out = 0;
    return fallback_nonce(system_table);
}

static void mailbox_visibility(Up2DciMailboxWireV1 *mailbox) {
    __asm__ volatile("clflush (%0)" : : "r"(mailbox) : "memory");
    __asm__ volatile("clflush 64(%0)" : : "r"(mailbox) : "memory");
    __asm__ volatile("mfence" : : : "memory");
}

static EFI_STATUS chainload_grub(EFI_HANDLE image_handle,
    EFI_SYSTEM_TABLE *system_table) {
    EFI_LOADED_IMAGE *loaded = NULL;
    EFI_DEVICE_PATH *path;
    EFI_HANDLE next_image = NULL;
    EFI_STATUS status = uefi_call_wrapper(system_table->BootServices->HandleProtocol,
        3, image_handle, &LoadedImageProtocol, (void **)&loaded);
    if (EFI_ERROR(status) || loaded == NULL) {
        return EFI_LOAD_ERROR;
    }
    path = FileDevicePath(loaded->DeviceHandle, L"\\EFI\\BOOT\\GRUBX64.EFI");
    if (path == NULL) {
        return EFI_OUT_OF_RESOURCES;
    }
    status = uefi_call_wrapper(system_table->BootServices->LoadImage, 6,
        FALSE, image_handle, path, NULL, 0, &next_image);
    if (EFI_ERROR(status)) {
        return status;
    }
    return uefi_call_wrapper(system_table->BootServices->StartImage, 3,
        next_image, NULL, NULL);
}

EFI_STATUS EFIAPI efi_main(EFI_HANDLE image_handle,
    EFI_SYSTEM_TABLE *system_table) {
    EFI_PHYSICAL_ADDRESS mailbox_address = UP2_DCI_MAILBOX_ADDRESS;
    EFI_PHYSICAL_ADDRESS payload_address = UP2_DCI_PAYLOAD_ADDRESS;
    EFI_PHYSICAL_ADDRESS kernel_address = UP2_DCI_KERNEL_ADDRESS;
    EFI_PHYSICAL_ADDRESS mbi_address = UP2_DCI_MBI_ADDRESS;
    EFI_PHYSICAL_ADDRESS shim_address = UP2_DCI_SHIM_ADDRESS;
    EFI_STATUS status;
    Up2DciMailboxWireV1 *mailbox;
    uint64_t published_nonce;
    uint32_t shim_entry = 0;
    const char *shim_blocked;
    int nonce_strong = 0;

    InitializeLib(image_handle, system_table);
    serial_init();
    uefi_call_wrapper(system_table->BootServices->SetWatchdogTimer,
        4, 0, 0, 0, NULL);

    status = uefi_call_wrapper(system_table->BootServices->AllocatePages, 4,
        AllocateAddress, EfiLoaderData, 1, &mailbox_address);
    if (EFI_ERROR(status)) {
        serial_puts("UP2 DCI UEFI blocked=mailbox-allocation\r\n");
        return status;
    }
    status = uefi_call_wrapper(system_table->BootServices->AllocatePages, 4,
        AllocateAddress, EfiLoaderData, UP2_DCI_PAYLOAD_BYTES / 4096u,
        &payload_address);
    if (EFI_ERROR(status)) {
        serial_puts("UP2 DCI UEFI blocked=payload-allocation\r\n");
        return status;
    }
    status = uefi_call_wrapper(system_table->BootServices->AllocatePages, 4,
        AllocateAddress, EfiLoaderData, UP2_DCI_KERNEL_BYTES / 4096u,
        &kernel_address);
    if (EFI_ERROR(status)) {
        serial_puts("UP2 DCI UEFI blocked=kernel-reservation\r\n");
        return status;
    }
    status = uefi_call_wrapper(system_table->BootServices->AllocatePages, 4,
        AllocateAddress, EfiLoaderData, UP2_DCI_MBI_BYTES / 4096u,
        &mbi_address);
    if (EFI_ERROR(status)) {
        serial_puts("UP2 DCI UEFI blocked=mbi-reservation\r\n");
        return status;
    }
    status = uefi_call_wrapper(system_table->BootServices->AllocatePages, 4,
        AllocateAddress, EfiLoaderData, UP2_DCI_SHIM_BYTES / 4096u,
        &shim_address);
    if (EFI_ERROR(status)) {
        serial_puts("UP2 DCI UEFI blocked=shim-reservation\r\n");
        return status;
    }
    shim_blocked = load_embedded_shim(&shim_entry);
    if (shim_blocked != NULL) {
        serial_puts("UP2 DCI UEFI blocked=");
        serial_puts(shim_blocked);
        serial_puts("\r\n");
        return EFI_LOAD_ERROR;
    }

    mailbox = (Up2DciMailboxWireV1 *)(uintptr_t)mailbox_address;
    SetMem(mailbox, sizeof(*mailbox), 0);
    mailbox->magic = UP2_DCI_MAGIC;
    mailbox->version = UP2_DCI_SCHEMA;
    mailbox->header_size = UP2_DCI_WIRE_SIZE;
    mailbox->total_size = UP2_DCI_WIRE_SIZE;
    mailbox->nonce = generate_nonce(system_table, &nonce_strong);
    published_nonce = mailbox->nonce;
    mailbox->payload_address = payload_address;
    mailbox->payload_capacity = UP2_DCI_PAYLOAD_BYTES;
    mailbox->command = UP2_DCI_BOOT_COMMAND;
    mailbox->commit = 0;
    mailbox_visibility(mailbox);

    status = uefi_call_wrapper(system_table->BootServices->InstallConfigurationTable,
        2, &up2_dci_mailbox_guid, mailbox);
    if (EFI_ERROR(status)) {
        serial_puts("UP2 DCI UEFI blocked=config-table\r\n");
        return status;
    }

    serial_puts("UP2 DCI UEFI resident-ready mailbox=0x");
    serial_hex64(mailbox_address);
    serial_puts(" payload=0x");
    serial_hex64(payload_address);
    serial_puts(" capacity=0x");
    serial_hex64(UP2_DCI_PAYLOAD_BYTES);
    serial_puts(" nonce=0x");
    serial_hex64(mailbox->nonce);
    serial_puts(" nonce-source=");
    serial_puts(nonce_strong ? "firmware-or-rdrand" : "diagnostic-fallback");
    serial_puts("\r\n");

    for (uint32_t poll = 0; poll < UP2_DCI_FALLBACK_POLLS; ++poll) {
        mailbox_visibility(mailbox);
        if (mailbox->commit == UP2_DCI_COMMITTED) {
            Up2DciMailboxWireV1 before_hash;
            Up2DciMailboxWireV1 after_hash;
            Sha256Context hash;
            uint8_t observed_digest[32];
            uint8_t second_digest[32];
            const char *blocked;
            uint32_t kernel_entry = 0;
            uint32_t multiboot_info = 0;
            if (!nonce_strong) {
                serial_puts("UP2 DCI UEFI blocked=weak-nonce\r\n");
                return EFI_SECURITY_VIOLATION;
            }
            CopyMem(&before_hash, mailbox, sizeof(before_hash));
            blocked = validate_committed_mailbox(&before_hash, published_nonce);
            if (blocked != NULL) {
                serial_puts("UP2 DCI UEFI blocked=");
                serial_puts(blocked);
                serial_puts("\r\n");
                return EFI_SECURITY_VIOLATION;
            }
            invalidate_payload((const uint8_t *)(uintptr_t)before_hash.payload_address,
                before_hash.payload_size);
            sha256_init(&hash);
            sha256_update(&hash,
                (const uint8_t *)(uintptr_t)before_hash.payload_address,
                before_hash.payload_size);
            sha256_final(&hash, observed_digest);
            mailbox_visibility(mailbox);
            CopyMem(&after_hash, mailbox, sizeof(after_hash));
            if (after_hash.commit != UP2_DCI_COMMITTED ||
                !bytes_equal((const uint8_t *)&before_hash,
                    (const uint8_t *)&after_hash, 124u)) {
                serial_puts("UP2 DCI UEFI blocked=unstable-mailbox\r\n");
                return EFI_SECURITY_VIOLATION;
            }
            if (!bytes_equal(observed_digest, before_hash.payload_sha256, 32u)) {
                serial_puts("UP2 DCI UEFI blocked=payload-sha256\r\n");
                return EFI_SECURITY_VIOLATION;
            }
            serial_puts("UP2 DCI UEFI admitted sha256=");
            for (unsigned index = 0; index < 32u; ++index) {
                static const char digits[] = "0123456789abcdef";
                serial_putc(digits[observed_digest[index] >> 4]);
                serial_putc(digits[observed_digest[index] & 0x0fu]);
            }
            serial_puts(" bytes=0x");
            serial_hex64(before_hash.payload_size);
            serial_puts(" generation=0x");
            serial_hex64(before_hash.generation);
            serial_puts("\r\n");
            blocked = load_kernel_elf64(
                (const uint8_t *)(uintptr_t)before_hash.payload_address,
                before_hash.payload_size, &kernel_entry);
            if (blocked != NULL) {
                serial_puts("UP2 DCI UEFI blocked=");
                serial_puts(blocked);
                serial_puts("\r\n");
                return EFI_LOAD_ERROR;
            }
            invalidate_payload((const uint8_t *)(uintptr_t)before_hash.payload_address,
                before_hash.payload_size);
            sha256_init(&hash);
            sha256_update(&hash,
                (const uint8_t *)(uintptr_t)before_hash.payload_address,
                before_hash.payload_size);
            sha256_final(&hash, second_digest);
            mailbox_visibility(mailbox);
            CopyMem(&after_hash, mailbox, sizeof(after_hash));
            if (!bytes_equal(observed_digest, second_digest, 32u) ||
                after_hash.commit != UP2_DCI_COMMITTED ||
                !bytes_equal((const uint8_t *)&before_hash,
                    (const uint8_t *)&after_hash, 124u)) {
                serial_puts("UP2 DCI UEFI blocked=unstable-payload\r\n");
                return EFI_SECURITY_VIOLATION;
            }
            serial_puts("UP2 DCI UEFI transition=multiboot2 shim=0x");
            serial_hex64(shim_entry);
            serial_puts(" kernel=0x");
            serial_hex64(kernel_entry);
            serial_puts("\r\n");
            status = exit_boot_services_with_mbi(image_handle, system_table,
                &multiboot_info);
            if (EFI_ERROR(status)) {
                serial_puts("UP2 DCI UEFI blocked=exit-boot-services\r\n");
                return status;
            }
            up2_dci_enter32(shim_entry, multiboot_info);
        }
        uefi_call_wrapper(system_table->BootServices->Stall, 1, 100000u);
    }

    serial_puts("UP2 DCI UEFI fallback=grub\r\n");
    status = chainload_grub(image_handle, system_table);
    if (EFI_ERROR(status)) {
        serial_puts("UP2 DCI UEFI blocked=grub-chainload\r\n");
    }
    return status;
}
