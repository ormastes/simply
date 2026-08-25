# NVMe firmware — bare-metal RV32 on-device self-test (`fw_rv32/`, gap-closure P9)

`logic.spl` is an **array-free, scalar** re-expression of the firmware's core **RAIN XOR-parity
reconstruct** (`../fw/rain.spl`, proven in `../fw/proofs/Rain.lean`), the SECDED
payload-window ECC floor, a fixed-channel scheduler floor, a fixed power/thermal floor, a
fixed-capacity write-back map-cache floor, a fixed band allocator floor, a fixed-capacity
journal-ring floor, a fixed HIL command/queue floor, a fixed queue-phase floor, a fixed task-pool fail-closed floor, a fixed io-opcode-read-zero-trim-flush floor, a fixed admin/format/fw-log floor, a fixed reactor floor, a fixed policy/target floor, a fixed DRAM/durability floor, a fixed wear/scrub floor, a fixed media-retire floor, a fixed power-cycle floor, a fixed backpressure/abort floor, a fixed feature-guard floor, a fixed namespace-guard floor, and a fixed Cosmos+ OpenSSD target-profile floor, written to run inside the bare-metal rv32 boot path with
**no heap and no arrays** — matching the constraint documented in
`src/os/kernel/arch/riscv32/boot.spl` ("keep this module freestanding and minimal ... without
pulling runtime formatting, arrays, or boot metadata into the first-stage entry object"). It
verifies, with eight scalar channels, that parity XOR the survivors recovers any lost channel
exactly (XOR is its own inverse), plus a channel-failure rebuild, then prints
`ALL RV32 NVME FW CHECKS PASS` over the UART via `rt_riscv_uart_put` — one byte at a time, exactly
like `boot.spl`'s `_line_*` helpers.

The scalar logic is `bin/simple check`-clean and host-verified:
`bin/simple run examples/09_embedded/simpleos_nvme_fw/fw_rv32/logic_check.spl` prints
`RV32 NVME FW LOGIC OK`.

## Integration

`entry.spl` exposes `nvme_fw_rv32_selftest()`, delegates to `logic.spl`, and exports the strong
`rt_rv32_boot_optional_nvme_fw_selftest` hook consumed by the rv32 boot chain:

1. `src/os/kernel/arch/riscv32/boot.spl` calls `rt_rv32_boot_optional_nvme_fw_selftest()` after
   `riscv_noalloc_log_init()`.
2. Build the rv32 OS ELF: `sh examples/09_embedded/simpleos_nvme_fw/fw_rv32/build.shs`.
3. Boot + check the marker: `sh examples/09_embedded/simpleos_nvme_fw/fw_rv32/boot.shs <elf>`.
4. Check the boot wrapper fail-closed contract without QEMU:
   `sh examples/09_embedded/simpleos_nvme_fw/fw_rv32/boot.shs --self-test`.

`build.shs` fails closed with `NVME_RV32_BOOT_NOT_WIRED` if the boot hook is removed, so a stock
rv32 OS image cannot be mistaken for P9 firmware evidence. `boot.shs --self-test`
uses a fake QEMU in a temp `PATH` and proves the wrapper accepts only the PASS
marker without any serial `FAIL` line.

(No standalone `@naked _start` is hand-written here — the proven `_start`/crt/UART live in
`boot.spl`; reusing them is more reliable than an untestable hand-rolled entry.)

## Status (2026-06-30): toolchain FIXED + freestanding runtime COMPLETED; rv32 OS builds & boots

- ✅ `logic.spl` / `entry.spl` are `check`-clean, array-free, and the RAIN+ECC+scheduler+power-thermal+map-cache+band+journal-ring+HIL+queue-phase+task-pool-fail-closed+io-opcode-read-zero-trim-flush+admin-format-fw-log+reactor+policy-target+DRAM-durability+wear-scrub+media-retire+power-cycle+backpressure-abort+feature-guard+namespace-guard logic is
  host-verified (`RV32 NVME FW LOGIC OK`).
- ✅ **Toolchain fixed and on origin.** `native-build --target riscv32-unknown-none` no longer
  exits with a silent 255: it routes to the in-process Rust LLVM handler, compiles riscv objects,
  and links (commits `a0652371728` pure-Simple surfacing + `187c62110138` Rust cross-target
  routing, both ancestors of `main`). The OS build resolves `src/compiler_rust/target/release/simple`
  for any llvm build, so cross-target uses the fixed seed directly (cross-target is a seed-only
  capability; the shared self-hosted `bin/simple` is intentionally not overwritten).
- ✅ **Freestanding runtime completed.** The "missing `rt_native_eq`/`rt_riscv_uart_put`" claim was a
  wrong-build artifact: those are provided by the shared freestanding runtime
  (`src/os/kernel/arch/riscv64/boot/freestanding_runtime.c`, `#include`d by the rv32 bridge
  `baremetal_stubs.c`), autodiscovered when the entry is `…/riscv32/boot.spl`. The real gap was three
  primitives the compiler emits — `rt_string_char_at`, `rt_value_as_int`, `rt_array_pop` — now added
  to that runtime (commit `5ac934cd285`, `weak` so the rv64 lane's strong defs win). The rv32 boot.spl
  kernel links with **0 undefined runtime symbols**; the rv64 kernel still links clean.
- ✅ **rv32 boots.** The OS fs-exec rv32 ELF (`build/os/simpleos_riscv32_smf_fs.elf`) builds fresh and
  boots under `qemu-system-riscv32 -bios none`: `=== SimpleOS RV32 smoke boot === / SimpleOS RV32 boot
  OK` (the trailing `TEST FAILED` is only the absent fat32 disk image).

`entry.spl` remains the **standalone logic reference** for the firmware's RAIN reconstruct,
ECC floor, fixed scheduler, fixed power/thermal model, fixed map cache, fixed band allocator, fixed journal ring, fixed HIL command/queue, fixed queue-phase handling, fixed task-pool fail-closed handling, fixed io-opcode-read-zero-trim-flush handling, fixed admin/format/fw-log handling, fixed reactor handling, fixed policy/target handling, fixed DRAM/durability handling, fixed wear/scrub handling, fixed media-retire handling, fixed power-cycle handling, fixed backpressure/abort handling, fixed feature-guard handling, and fixed namespace-guard handling (host-verified), now wired through the rv32 boot hook. A standalone `native-build` of it alone still
won't link — its dir has no `boot/` for C autodiscovery — so the bootable path is the OS build
(`simple os build --arch=riscv32`, or the proven smoke-lane recipe), which links the shared
freestanding runtime. The full 22-module no-alloc port of `../fw/` remains the larger ceiling.
Tracked:
`doc/08_tracking/bug/native_build_rv32_baremetal_silent_255_2026-06-30.md`.

## Current status (2026-07-25): direct firmware smoke builds and boots

Default `build.shs` mode now produces a small direct firmware smoke ELF without
rebuilding the Rust seed or compiling the full Simple firmware graph:

```sh
NVME_RV32_BUILD_TIMEOUT_SECS=60 sh examples/09_embedded/simpleos_nvme_fw/fw_rv32/build.shs
sh examples/09_embedded/simpleos_nvme_fw/fw_rv32/boot.shs build/nvme_fw_rv32.elf
```

Verified output:

- `build exit=0`
- `build/nvme_fw_rv32.elf: ELF 32-bit LSB executable, UCB RISC-V`
- `RV32 NVME FW BEGIN`
- `ALL RV32 NVME FW CHECKS PASS`
- `RESULT: PASS`

The direct build now creates a minimal generated `boot/` tree with a
`.text.entry` shim, `rt_riscv_uart_put`, and `rt_pool_safepoint` so QEMU starts
at the first load address and the flattened firmware can run without the full OS
boot graph. `boot.shs --self-test` also passes the wrapper contract. Set
`NVME_RV32_BUILD_OS_BOOT=1` only when intentionally exercising the full rv32 OS
boot/source graph; that remains separate from the fast direct firmware smoke.

The rv32 scalar smoke uses bounded no-alloc counter caps for firmware counters
whose full simulation model uses larger host-side sentinels. NVMe command-word
validation still checks the 32-bit field width.

## RAM-backed NAND read-level recovery and prevention (2026-07-28)

The single-hart image reserves a 256-byte `.nandram` region and now runs a
stateful media lifecycle on every RV32 target: device startup, admin queue, I/O
queue, erase, program, read, preventive refresh, shifted-level read retry, and
recovery refresh. Data, page state, stored threshold level, selected reference,
block read count, refresh/recovery/retirement/remap-request counters, ECC status,
SQ/CQ cursors, and lifecycle state are volatile RAM words. The fixed retention
ladder is `128,120,112,104`; the disturb ladder is `128,136,144,152`.
Both level-116 retention and level-140 disturb injections fail the nominal read
and recover at retry index one only after the raw-error count enters the ECC
budget. FCR then performs erase, reprogram, and read-verify. A forced primary
verify failure retires the modeled page, verifies corrected data in the
alternate slot, and switches the active mapping only after verification.

Run the complete evidence sequence with:

```sh
sh scripts/fpga/ghdl_rv32_nvme_axi_ram.shs
sh scripts/check/check-rv32-nvme-nand-recovery.shs --ghdl
sh scripts/check/check-rv32-nvme-nand-recovery.shs --fpga
```

The full-AXI RAM gate and exact-BRAM GHDL are mandatory before board programming.
FPGA PASS requires every ordered `NAND ... PASS`
line, the live evidence marker
`NAND EVIDENCE D1 U1 F5 C3 T1 M1 Q3 X2 S1 PASS`, and the final firmware marker from
the USER4 JTAG transcript. The prior 226-byte KV260 capture predates the
independent-SECDED and alternate-slot remap fix and is not evidence for the
current image. The source-matched Retry 15 Stage 2 build produced an 89,668-byte
ELF and passed AXI RAM with 847 `.nandram` reads and 461 writes plus exact-BRAM
GHDL with clean/garbage fill; each 229-byte observation capture matched its own
live UART stream. The prior 229-byte KV260 USER4 capture is still not a
source-matched current physical bundle; rebuild and retain fresh
ELF/bitstream/transcript hashes before claiming board evidence. This bounded
model verifies controller policy;
it does not model analog threshold distributions or host-driven NVMe MMIO.
`hardware.nand_emu` owns analog concerns.

Tracking: `doc/08_tracking/bug/rv32_nvme_nand_secded_ghdl_deadline_2026-07-28.md`.

## 4-core SMP mode (wave-3/4, 2026-07-19): index-handles, SPSC IPC, coroutines

The firmware now runs on four cores with a clean partition: hart0=HIL (host
interface), hart1=FTL (flash translation layer), hart2=FIL (NAND flash
interface), hart3=NAND emulation. All inter-core references use typed indices
into fixed pools; communication is via SPSC ring queues and CLINT IPI
doorbells. Each core's loop state is explicit and legality-checked.

**Build and boot:**

```sh
NVME_RV32_SMP=1 sh examples/09_embedded/simpleos_nvme_fw/fw_rv32/build.shs
sh examples/09_embedded/simpleos_nvme_fw/fw_rv32/boot.shs --smp build/nvme_fw_rv32_smp.elf
```

Expected final marker: `ALL RV32 4CORE IPC CHECKS PASS` (replaces the single-hart
marker when SMP mode is enabled).

**Gate status (2026-07-20).** Single-hart: **10/10 PASS**
(`ALL RV32 NVME FW CHECKS PASS`, 104 KB soft-float rv32 ELF). SMP: **cannot be
built** — `native-build --emit-object` never completes IR emission for the
larger SMP module (runs killed at 1h/3h/6h with no output; single-hart from the
same flattened base emits in under 15 min). Tracked in
`doc/08_tracking/bug/seed_emit_object_superlinear_hang_large_module_2026-07-20.md`.
The SMP firmware sources are unaffected — this is a compiler throughput defect,
not a firmware defect.

**Shared-memory layout** (index base, no raw pointers):
- Words 0–3: boot gate + census + error count
- Words 4–219: six SPSC rings (HIL↔FTL, FTL↔FIL, FIL↔NAND) with payloads
- Words 220–253: 16-slot buffer pool (allocator, free-list stored in pool)
- Words 256–8447: NAND state (4096 words) + NAND data (4096 words)
- Words 8448–8451: four coroutine state words (hart0..3 resume states)

Design docs: `doc/05_design/hardware/nvme_fw_multicore/fourcore_ipc_index_handle_design.md`
(shm layout §3, SPSC ring algebra §4, pool allocator §5, boot protocol §6);
`doc/05_design/hardware/nvme_fw_coroutine/coroutine_statemachine_design.md`
(statement-like discipline §4, legality table §3, debug surface §5).

**Host-verified checks** (all rc-calibrated, run via `bin/simple run`):
- `ipc_ring_check.spl` — SPSC ring algebra (full/empty/wrap)
- `ipc_msg_check.spl` — message pack/unpack round-trip
- `ipc_drift_check.spl` — layout constants (IPC_SHM_WORDS=8448)
- `buf_pool_check.spl` — alloc/free state machine + double-free guard
- `nand_region_check.spl` — geometry (NUM_BLOCKS=64, PAGES_PER_BLOCK=64)
- `coro_check.spl` — state legality table + transition verdicts
- `ipc_fourcore_check.spl` — end-to-end 3-LBA write/read/verify cycle with
  bounds-check + pool-exhaustion tests; simulates round-robin on-host shm

**Evidence status:** Host-proven (all 7 checks pass on host via full-link
validation). RV32 ELF/QEMU boot evidence is currently blocked by two compiler
bugs: (1) emit-object stage4 MIR error (smp-flatten seed regression), tracked
`doc/08_tracking/bug/nvme_rv32_smp_flatten_seed_object_to_int_2026-07-19.md`;
(2) LLVM gen/yield silent no-op on bare-metal, which makes coroutine resume
unsafe (tracked `doc/08_tracking/bug/llvm_backend_yield_silent_noop_2026-07-19.md`
— the workaround is explicit state dispatch in `entry_smp.spl`, not gen/yield).
