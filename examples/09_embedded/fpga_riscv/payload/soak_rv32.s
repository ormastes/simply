/* soak_rv32.s  (Lane OO — payload source)
 *
 * Sustained hard-job compute soak for the rv32 exec core. Runs an Adler-32
 * reduction over the deterministic byte sequence (i & 0xFF) for i in
 * [0, @COUNT@). Each iteration does two `remu` operations, driving the core's
 * multi-cycle divider (the unit Lane KK fixed) hard for the full run. A '0x50'
 * ('P') progress marker is emitted over UART every @INTERVAL@ iterations (via
 * a countdown register, so the interval is unrestricted by the 12-bit andi
 * immediate) to prove sustained liveliness with no stall/livelock, and the
 * final Adler-32 golden value is emitted as
 *     DONE=XXXXXXXX~
 * (uppercase hex, MSB first, 0x7E sentinel). @COUNT@ and @INTERVAL@ are
 * substituted by soak_rv32_hard_job.shs; the host computes the identical
 * Adler-32 golden for the chosen @COUNT@. Uses only rv32im ops the read-only
 * core is proven to decode.
 */
    .option norelax
    .section .text
    .global _start
_start:
    li   s4, 0x10000000      /* UART TX */
    li   s0, 1               /* a = 1 */
    li   s1, 0               /* b = 0 */
    li   s2, 0               /* i */
    li   s3, @COUNT@         /* iteration budget */
    li   s6, 65521           /* Adler modulus */
    li   s7, @INTERVAL@      /* progress-marker countdown */
soak_loop:
    beq  s2, s3, soak_done
    andi t0, s2, 0xFF        /* byte = i & 0xFF */
    add  s0, s0, t0          /* a += byte */
    remu s0, s0, s6          /* a %= 65521   (divider) */
    add  s1, s1, s0          /* b += a */
    remu s1, s1, s6          /* b %= 65521   (divider) */
    addi s7, s7, -1          /* progress countdown */
    bne  s7, zero, soak_next
    li   t2, 0x50            /* 'P' */
    sb   t2, 0(s4)
    li   s7, @INTERVAL@      /* reload countdown */
soak_next:
    addi s2, s2, 1
    j    soak_loop
soak_done:
    slli s1, s1, 16          /* checksum = (b<<16) | a */
    or   s0, s0, s1
    li   t1, 0x44            /* 'D' */
    sb   t1, 0(s4)
    li   t1, 0x4F            /* 'O' */
    sb   t1, 0(s4)
    li   t1, 0x4E            /* 'N' */
    sb   t1, 0(s4)
    li   t1, 0x45            /* 'E' */
    sb   t1, 0(s4)
    li   t1, 0x3D            /* '=' */
    sb   t1, 0(s4)
    li   s5, 28
hex_loop:
    srl  t0, s0, s5
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
    li   t1, 0x7E            /* '~' sentinel */
    sb   t1, 0(s4)
halt:
    j    halt
