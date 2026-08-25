#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <zlib.h>

static char SIMPLE_ZLIB_LAST_ERROR[256];

char* simple_zlib_compress_bytes_to_hex(const char* input, int64_t input_len);
char* simple_zlib_decompress_hex_bytes(const char* hex, int64_t hex_len);

static void simple_zlib_clear_error(void) {
    SIMPLE_ZLIB_LAST_ERROR[0] = '\0';
}

static void simple_zlib_set_errorf(const char* message, long value) {
    snprintf(SIMPLE_ZLIB_LAST_ERROR, sizeof(SIMPLE_ZLIB_LAST_ERROR), "%s (%ld)", message, value);
}

static int simple_zlib_hex_value(char c) {
    if (c >= '0' && c <= '9') {
        return c - '0';
    }
    if (c >= 'a' && c <= 'f') {
        return 10 + (c - 'a');
    }
    if (c >= 'A' && c <= 'F') {
        return 10 + (c - 'A');
    }
    return -1;
}

const char* simple_zlib_version(void) {
    return zlibVersion();
}

const char* simple_zlib_last_error(void) {
    return SIMPLE_ZLIB_LAST_ERROR;
}

void simple_zlib_string_free(char* ptr) {
    free(ptr);
}

int64_t simple_zlib_roundtrip_selftest(void) {
    static const char sample[] = "Simple external zlib roundtrip";
    char* compressed = simple_zlib_compress_bytes_to_hex(sample, (int64_t)(sizeof(sample) - 1));
    if (compressed == NULL) {
        return 0;
    }
    char* restored = simple_zlib_decompress_hex_bytes(compressed, (int64_t)strlen(compressed));
    free(compressed);
    if (restored == NULL) {
        return 0;
    }
    const int ok = strcmp(restored, sample) == 0;
    free(restored);
    if (!ok) {
        simple_zlib_set_errorf("selftest roundtrip mismatch", 0);
        return 0;
    }
    simple_zlib_clear_error();
    return 1;
}

char* simple_zlib_compress_bytes_to_hex(const char* input, int64_t input_len) {
    if (input == NULL) {
        simple_zlib_set_errorf("compress input was null", 0);
        return NULL;
    }
    if (input_len < 0) {
        simple_zlib_set_errorf("compress input length was negative", input_len);
        return NULL;
    }

    uLongf compressed_len = compressBound((uLong)input_len);
    unsigned char* compressed = (unsigned char*)malloc(compressed_len);
    if (compressed == NULL) {
        simple_zlib_set_errorf("compress allocation failed", (long)compressed_len);
        return NULL;
    }

    const int rc = compress2(compressed, &compressed_len, (const Bytef*)input, (uLong)input_len, Z_BEST_SPEED);
    if (rc != Z_OK) {
        free(compressed);
        simple_zlib_set_errorf("compress2 failed", rc);
        return NULL;
    }

    char* hex = (char*)malloc((compressed_len * 2) + 1);
    if (hex == NULL) {
        free(compressed);
        simple_zlib_set_errorf("hex allocation failed", (long)compressed_len);
        return NULL;
    }

    for (uLongf i = 0; i < compressed_len; i++) {
        snprintf(hex + (i * 2), 3, "%02x", compressed[i]);
    }
    hex[compressed_len * 2] = '\0';
    free(compressed);
    simple_zlib_clear_error();
    return hex;
}

char* simple_zlib_decompress_hex_bytes(const char* hex, int64_t hex_len) {
    if (hex == NULL) {
        simple_zlib_set_errorf("decompress input was null", 0);
        return NULL;
    }
    if (hex_len < 0) {
        simple_zlib_set_errorf("decompress input length was negative", hex_len);
        return NULL;
    }

    if (((size_t)hex_len % 2) != 0) {
        simple_zlib_set_errorf("hex payload length must be even", hex_len);
        return NULL;
    }

    const size_t compressed_len = (size_t)hex_len / 2;
    unsigned char* compressed = (unsigned char*)malloc(compressed_len == 0 ? 1 : compressed_len);
    if (compressed == NULL) {
        simple_zlib_set_errorf("compressed allocation failed", (long)compressed_len);
        return NULL;
    }

    for (size_t i = 0; i < compressed_len; i++) {
        const int hi = simple_zlib_hex_value(hex[i * 2]);
        const int lo = simple_zlib_hex_value(hex[(i * 2) + 1]);
        if (hi < 0 || lo < 0) {
            free(compressed);
            simple_zlib_set_errorf("invalid hex digit", (long)i);
            return NULL;
        }
        compressed[i] = (unsigned char)((hi << 4) | lo);
    }

    uLongf output_cap = compressed_len == 0 ? 64 : (uLongf)(compressed_len * 8) + 64;
    unsigned char* output = (unsigned char*)malloc(output_cap);
    if (output == NULL) {
        free(compressed);
        simple_zlib_set_errorf("output allocation failed", (long)output_cap);
        return NULL;
    }

    int rc = Z_BUF_ERROR;
    while (rc == Z_BUF_ERROR) {
        uLongf attempt_len = output_cap;
        rc = uncompress(output, &attempt_len, compressed, (uLong)compressed_len);
        if (rc == Z_OK) {
            char* text = (char*)malloc((size_t)attempt_len + 1);
            if (text == NULL) {
                free(compressed);
                free(output);
                simple_zlib_set_errorf("text allocation failed", (long)attempt_len);
                return NULL;
            }
            memcpy(text, output, (size_t)attempt_len);
            text[attempt_len] = '\0';
            free(compressed);
            free(output);
            simple_zlib_clear_error();
            return text;
        }
        if (rc == Z_BUF_ERROR) {
            output_cap *= 2;
            unsigned char* grown = (unsigned char*)realloc(output, output_cap);
            if (grown == NULL) {
                free(compressed);
                free(output);
                simple_zlib_set_errorf("output realloc failed", (long)output_cap);
                return NULL;
            }
            output = grown;
        }
    }

    free(compressed);
    free(output);
    simple_zlib_set_errorf("uncompress failed", rc);
    return NULL;
}
