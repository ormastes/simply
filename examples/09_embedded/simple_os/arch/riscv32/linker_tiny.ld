/* RISC-V 32 TINY Linker Script — BRAM-only FPGA soft-core (no external DDR)
 *
 * Goal: fit the WHOLE SimpleOS rv32 SMF/FS smoke image (code + data + stack +
 * heap) inside the KV260 xck26 PL fabric's on-chip block RAM, so the soft-core
 * boots with no DDR controller at all. Budget ~2.8 MB of BRAM; this script
 * targets 2 MB and the resulting image lands far below that.
 *
 * WHY THIS EXISTS (measured, not guessed)
 * ---------------------------------------
 * `llvm-size build/os/simpleos_riscv32_smf_fs.elf` reports:
 *     text 9065   data 4   bss 75603972   (~72 MB "bss")
 * That 72 MB is NOT static data. llvm-size folds every NOBITS section into its
 * "bss" column, and the default image has three of them:
 *     .bss    0x0001a004  =    106,500 B   <- real static data
 *     .stack  0x00800000  =  8,388,608 B   <- linker reservation
 *     .heap   0x04000000  = 67,108,864 B   <- linker reservation
 *                            ----------
 *                            75,603,972 B  == the reported "bss", exactly.
 *
 * So 99.86% of the footprint is two `. += <N>` reservations in
 * ../../common/linker_riscv_common.ld, not a single oversized array.
 *
 * The real .bss (~104 KB) is all load-bearing for the smoke path and is left
 * ALONE — every one of its symbols is on the marker chain:
 *     g_heap                 65,536 B  bump allocator backing rt_string_new
 *     g_riscv_process_arena  16,384 B  2 x 8 KB ELF load arenas (cli + wm SMF)
 *     g_virtq                 8,192 B  virtio-blk split virtqueue
 *     g_riscv_file_buf        8,192 B  FAT32 file read buffer
 *     g_dma                   1,024 B  virtio DMA bounce buffer
 *     g_riscv_gui_surface       256 B  WM surface scratch
 *
 * HEAP: the 64 MB .heap region is DEAD in this image. The C runtime allocates
 * from its own static `g_heap[64 * 1024]` in .bss (see
 * ../../common/baremetal_bump_heap.h); nothing references __heap_start or
 * __heap_end. Verified by disassembly: `llvm-objdump -d` finds zero
 * instructions materialising an address in the .heap range. It is kept here at
 * a token 4 KB purely so the __heap_start/__heap_end symbols keep resolving.
 *
 * STACK: 256 KB. baremetal_stubs.c paints the whole [_stack_bottom,
 * _stack_top) span with 0xADDECA5E at _start whenever the linker reserved a
 * BRAM-sized stack, and reports the high-water mark over the UART as
 * `[tiny] stack_used=<bytes> of=<bytes>` once the full marker chain has run.
 * NOTE: the original probe scanned for the first SURVIVING sentinel (which is
 * _stack_bottom on any healthy boot), so it reported exactly 100% used at
 * every size — the earlier "64 KB fully consumed" reading was that bug, not a
 * real overflow. The corrected probe (2026-07-26) measures the true boot
 * high-water at 344 bytes, so even 64 KB is ample: see linker_tiny64.ld and
 * build/ghdl/tiny/tiny64_256k_boot.log (256 KB RAM + 320 KB ramdisk, PASS).
 *
 * RESULTING LAYOUT (ORIGIN 0x80000000):
 *     .text .rodata .data .bss   -> ends 0x8001f004  (~124 KB)
 *     .stack  256 KB             -> ends ~0x8005f010
 *     .heap     4 KB             -> ends ~0x80061000
 *     total                      ~388 KB, vs a 2 MB region and ~2.8 MB of BRAM.
 *
 * Overflow is caught by ld's region-size check ("section will not fit in
 * region RAM") rather than silently aliasing, which is what made the older
 * 64 KB-window nvme_fw_rv32_bram.ld fragile.
 *
 * The FAT32 ramdisk is NOT in this region — the core maps it as a separate
 * bank at 0x88000000 (rv32_exec_core_flat.vhd RDISK_WORDS), so it is budgeted
 * separately from this 2 MB.
 *
 * Output format: ELF32 little-endian RISC-V.
 * Shared SECTIONS block: ../../common/linker_riscv_common.ld
 */

OUTPUT_ARCH(riscv)
OUTPUT_FORMAT("elf32-littleriscv")
ENTRY(_start)

MEMORY {
    RAM (rwx) : ORIGIN = 0x80000000, LENGTH = 2M
}

/* Overrides for the shared SECTIONS block (defaults there: 8M / 64M). */
__stack_size = 256K;
__heap_size  = 4K;

INCLUDE "examples/09_embedded/simple_os/arch/common/linker_riscv_common.ld"
