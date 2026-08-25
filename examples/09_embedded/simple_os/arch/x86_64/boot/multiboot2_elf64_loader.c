#include <stdint.h>
#include <stddef.h>

#define MB2_TAG_END 0u
#define MB2_TAG_MODULE 3u
#define PT_LOAD 1u
#define EM_X86_64 62u
#define MAX_PHNUM 32u
#define MODULE_COMMAND "simpleos-kernel"

static inline void outb(uint16_t port, uint8_t value) {
    __asm__ volatile("outb %0, %1" : : "a"(value), "Nd"(port));
}

static inline uint8_t inb(uint16_t port) {
    uint8_t value;
    __asm__ volatile("inb %1, %0" : "=a"(value) : "Nd"(port));
    return value;
}

static void serial_init(void) {
    outb(0x3f9, 0x00);
    outb(0x3fb, 0x80);
    outb(0x3f8, 0x03);
    outb(0x3f9, 0x00);
    outb(0x3fb, 0x03);
    outb(0x3fa, 0xc7);
    outb(0x3fc, 0x0b);
}

static void serial_putc(char value) {
    uint32_t spins = 1000000u;
    while ((inb(0x3fd) & 0x20u) == 0u && spins != 0u) {
        --spins;
    }
    if (spins != 0u) {
        outb(0x3f8, (uint8_t)value);
    }
}

static void serial_puts(const char *value) {
    while (*value != '\0') {
        serial_putc(*value++);
    }
}

static void fail(const char *reason) {
    serial_puts("[UP2-SHIM] fail=");
    serial_puts(reason);
    serial_puts("\r\n");
}

static uint16_t rd16(const uint8_t *p) {
    return (uint16_t)p[0] | ((uint16_t)p[1] << 8);
}

static uint32_t rd32(const uint8_t *p) {
    return (uint32_t)p[0] |
           ((uint32_t)p[1] << 8) |
           ((uint32_t)p[2] << 16) |
           ((uint32_t)p[3] << 24);
}

static int text_equal(const char *left, const char *right, uint32_t limit) {
    uint32_t i = 0u;
    while (i < limit) {
        if (left[i] != right[i]) {
            return 0;
        }
        if (left[i] == '\0') {
            return 1;
        }
        ++i;
    }
    return 0;
}

static int add_ok(uint32_t left, uint32_t right, uint32_t *sum) {
    *sum = left + right;
    return *sum >= left;
}

static uint32_t find_kernel_module(uint32_t mbi, uint32_t *module_end) {
    const uint8_t *base = (const uint8_t *)(uintptr_t)mbi;
    uint32_t total = rd32(base);
    uint32_t offset = 8u;
    if (total < 16u || total > (16u * 1024u * 1024u)) {
        fail("mbi-size");
        return 0u;
    }
    while (offset + 8u <= total) {
        const uint8_t *tag = base + offset;
        uint32_t type = rd32(tag);
        uint32_t size = rd32(tag + 4u);
        if (size < 8u || size > total - offset) {
            fail("tag-bounds");
            return 0u;
        }
        if (type == MB2_TAG_END) {
            break;
        }
        if (type == MB2_TAG_MODULE && size >= 17u) {
            uint32_t start = rd32(tag + 8u);
            uint32_t end = rd32(tag + 12u);
            const char *command = (const char *)(tag + 16u);
            if (end > start && text_equal(command, MODULE_COMMAND, size - 16u)) {
                *module_end = end;
                return start;
            }
        }
        uint32_t aligned = (size + 7u) & ~7u;
        if (aligned < size || aligned > total - offset) {
            fail("tag-align");
            return 0u;
        }
        offset += aligned;
    }
    fail("module-missing");
    return 0u;
}

uint32_t up2_elf64_module_load(uint32_t mbi) {
    serial_init();
    serial_puts("[UP2-SHIM] entry\r\n");

    uint32_t module_end = 0u;
    uint32_t module_start = find_kernel_module(mbi, &module_end);
    if (module_start == 0u || module_end <= module_start) {
        return 0u;
    }
    serial_puts("[UP2-SHIM] module\r\n");

    const uint8_t *elf = (const uint8_t *)(uintptr_t)module_start;
    uint32_t module_size = module_end - module_start;
    if (module_size < 64u || elf[0] != 0x7fu || elf[1] != 'E' ||
        elf[2] != 'L' || elf[3] != 'F' || elf[4] != 2u || elf[5] != 1u) {
        fail("elf-ident");
        return 0u;
    }
    if (rd16(elf + 18u) != EM_X86_64 || rd32(elf + 28u) != 0u ||
        rd32(elf + 36u) != 0u) {
        fail("elf-machine-or-high-address");
        return 0u;
    }
    uint32_t entry = rd32(elf + 24u);
    uint32_t phoff = rd32(elf + 32u);
    uint16_t phentsize = rd16(elf + 54u);
    uint16_t phnum = rd16(elf + 56u);
    if (entry < 0x00100000u || phentsize != 56u || phnum == 0u || phnum > MAX_PHNUM) {
        fail("elf-header");
        return 0u;
    }
    uint32_t phbytes = (uint32_t)phentsize * (uint32_t)phnum;
    uint32_t phend = 0u;
    if (!add_ok(phoff, phbytes, &phend) || phend > module_size) {
        fail("phdr-bounds");
        return 0u;
    }

    uint32_t loaded = 0u;
    for (uint32_t index = 0u; index < (uint32_t)phnum; ++index) {
        const uint8_t *ph = elf + phoff + index * 56u;
        if (rd32(ph) != PT_LOAD) {
            continue;
        }
        if (rd32(ph + 12u) != 0u || rd32(ph + 20u) != 0u ||
            rd32(ph + 28u) != 0u || rd32(ph + 36u) != 0u ||
            rd32(ph + 44u) != 0u) {
            fail("segment-high-address");
            return 0u;
        }
        uint32_t file_offset = rd32(ph + 8u);
        uint32_t destination = rd32(ph + 24u);
        uint32_t file_size = rd32(ph + 32u);
        uint32_t memory_size = rd32(ph + 40u);
        uint32_t file_end = 0u;
        uint32_t memory_end = 0u;
        if (file_size > memory_size ||
            !add_ok(file_offset, file_size, &file_end) || file_end > module_size ||
            destination < 0x01000000u ||
            !add_ok(destination, memory_size, &memory_end) || memory_end >= 0xf0000000u) {
            fail("segment-bounds");
            return 0u;
        }
        uint8_t *out = (uint8_t *)(uintptr_t)destination;
        const uint8_t *in = elf + file_offset;
        for (uint32_t byte = 0u; byte < file_size; ++byte) {
            out[byte] = in[byte];
        }
        for (uint32_t byte = file_size; byte < memory_size; ++byte) {
            out[byte] = 0u;
        }
        ++loaded;
    }
    if (loaded == 0u) {
        fail("no-load-segments");
        return 0u;
    }
    serial_puts("[UP2-SHIM] elf64-loaded\r\n");
    serial_puts("[UP2-SHIM] jump\r\n");
    return entry;
}
