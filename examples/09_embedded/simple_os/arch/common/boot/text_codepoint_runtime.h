#ifndef SIMPLEOS_TEXT_CODEPOINT_RUNTIME_H
#define SIMPLEOS_TEXT_CODEPOINT_RUNTIME_H

RuntimeValue text_dot_from_char_code(int64_t code)
{
    int64_t scalar = code;
    unsigned char utf8[4];
    RuntimeValue len;

    if (scalar < 0 || scalar > 0x10ffff ||
        (scalar >= 0xd800 && scalar <= 0xdfff)) {
        return NIL_VALUE;
    }
    if (scalar <= 0x7f) {
        utf8[0] = (unsigned char)scalar;
        len = 1;
    } else if (scalar <= 0x7ff) {
        utf8[0] = (unsigned char)(0xc0 | (scalar >> 6));
        utf8[1] = (unsigned char)(0x80 | (scalar & 0x3f));
        len = 2;
    } else if (scalar <= 0xffff) {
        utf8[0] = (unsigned char)(0xe0 | (scalar >> 12));
        utf8[1] = (unsigned char)(0x80 | ((scalar >> 6) & 0x3f));
        utf8[2] = (unsigned char)(0x80 | (scalar & 0x3f));
        len = 3;
    } else {
        utf8[0] = (unsigned char)(0xf0 | (scalar >> 18));
        utf8[1] = (unsigned char)(0x80 | ((scalar >> 12) & 0x3f));
        utf8[2] = (unsigned char)(0x80 | ((scalar >> 6) & 0x3f));
        utf8[3] = (unsigned char)(0x80 | (scalar & 0x3f));
        len = 4;
    }
    return rt_string_new((RuntimeValue)(uintptr_t)utf8, len);
}

#endif
