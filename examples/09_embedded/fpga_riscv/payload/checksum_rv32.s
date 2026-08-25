/* checksum_rv32.s  (Lane OO — payload source)
 *
 * Linux-loading integrity payload for the rv32 exec core. The host preloads a
 * deterministic blob into the core's data ROM (0x40000000..0x4000FFFF, 64 KB,
 * from rv32_fat32.mem). This program sums all @WORDCOUNT@ 32-bit words of that
 * loaded region with 32-bit wrap-around and emits the result over UART as
 *     CS=XXXXXXXX~
 * (uppercase hex, MSB first, 0x7E sentinel). The host computes the identical
 * 32-bit sum over the same blob; a match proves the FPGA load path (BRAM
 * .mem preload == on-hardware bitstream BRAM-init) carried every byte intact.
 *
 * @WORDCOUNT@ is substituted by check_linux_loading_rv32.shs before assembly.
 * Uses only rv32i base ops the read-only core is proven to decode.
 */
    .option norelax
    .section .text
    .global _start
_start:
    li   s4, 0x10000000      /* UART TX (store-byte port) */
    li   s0, 0x40000000      /* data ROM base */
    li   s1, @WORDCOUNT@      /* number of words to sum */
    li   s2, 0               /* i */
    li   s3, 0               /* running 32-bit sum */
sum_loop:
    beq  s2, s1, sum_done
    slli t0, s2, 2           /* byte offset = i*4 */
    add  t0, s0, t0          /* addr = base + off */
    lw   t1, 0(t0)           /* load data-ROM word */
    add  s3, s3, t1          /* sum += word (wraps at 2^32) */
    addi s2, s2, 1
    j    sum_loop
sum_done:
    li   t1, 0x43            /* 'C' */
    sb   t1, 0(s4)
    li   t1, 0x53            /* 'S' */
    sb   t1, 0(s4)
    li   t1, 0x3D            /* '=' */
    sb   t1, 0(s4)
    li   s5, 28              /* shift for MSB nibble first */
hex_loop:
    srl  t0, s3, s5
    andi t0, t0, 15
    li   t1, 10
    blt  t0, t1, hex_digit
    addi t0, t0, 0x37        /* 'A'..'F' */
    j    hex_emit
hex_digit:
    addi t0, t0, 0x30        /* '0'..'9' */
hex_emit:
    sb   t0, 0(s4)
    addi s5, s5, -4
    bgez s5, hex_loop
    li   t1, 0x7E            /* '~' end sentinel */
    sb   t1, 0(s4)
halt:
    j    halt
