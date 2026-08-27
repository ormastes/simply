# NVMe firmware build status

Host-runnable simulation, layered HIL → FTL → FIL. Gate: `bin/simple run` (not `check`).
Build workspace: git worktree `simple_nvme_fw_build/` (churn-isolated). Land via worktree
commit → rebase onto origin/main (adds-only) → non-force SSH push.

## Done (run-green, on origin/main)
- `nvme_types.spl` — frozen shared interface (constants, Handle, NvmeCmd/Cpl, helpers, expect_eq).
- **FIL complete**: `fil_nand` (sim NAND), `fil_ecc`, `fil_badblock`, `fil_fmc` (P1 — wired into FIL),
  `fil_scheduler` (P2 — wired timing-floor scheduler), **`fil.spl`** (NAND+ECC+bad-block remap,
  page API for FTL; `FilRead{data,lba,seq,code}`).
- **FTL leaves**: `ftl_map` (DFTL write-back cache), `ftl_band` (log allocator + valid bitmap), `ftl_journal` (WAL+checkpoint+A/B superblock).
- **HIL+core leaves**: `hil_queue` (SQ/CQ rings), `hil_command` (decode/validate), `fw_pool` (gen-handle task pool; accessors cid/lba/data/status/old_ppn/new_ppn/seq/phase).
- `test_leaves.spl` runs all 9 leaf self-tests (176 assertions). `CONVENTIONS.md`, bug docs.

## Architecture decisions (verified)
- **Nested struct field-method mutation PERSISTS**: `me.field.method(...)` mutates the field in
  place (tested). So compose cleanly: `Fil{nand,bbt}`, `Ftl{fil,map,band,journal,seq}`,
  `Hil{queues,ftl,pool}`, `Firmware{hil}` — methods call `me.fil.program(...)` etc. directly.
- **Value semantics**: structs copy on assignment; mutate only via `me.field` / `me.field.method`.
- **Conditional first-param ×8 interp bug**: isolated to `ftl_journal.append` (dummy `_p0`
  leading param; callers pass 0). Every multi-param `me` method's self-test must round-trip
  each stored value. See `CONVENTIONS.md`.

## Integration — COMPLETE (run-green, end-to-end verified, on origin/main)

All layers implemented and verified. `test_fw.spl` emits the full self-test suite
(gate name `ALL FIRMWARE SELF-TESTS PASS`); `sim_main.spl` = full single-queue end-to-end (128 writes → read-back → overwrite/GC →
trim → power-fail + recovery); `nvme_main.spl` = the admin-driven controller e2e (27 asserts) —
all green via `bin/simple run`.

- **`ftl.spl`** — `Ftl{fil,map,band,journal,seq}`: `write` (alloc → fil.program → journal →
  map.update → mark_valid + invalidate old), `read`/`read_status`, `trim`, `checkpoint`,
  `crash`, `recover` (WAL replay, newest-seq wins), `gc_once` (transactional relocate→erase).
- **`ftl_gc.spl`** — `gc_select_victim(band)` greedy (CLOSED block, fewest valid pages).
- **`hil.spl`** — `Hil{q,ftl,pool}`: `submit`, `tick` (fetch SQ → validate → dispatch behind a
  `fw_pool` WriteTask state machine → post CQ), `run`, `reap`, `gc`/`crash`/`recover`.
- **`firmware.spl`** — `Firmware{hil}` cooperative reactor: `service` (drain queues + background
  GC below the free-block watermark), `gc_sweep`, `checkpoint`, `power_cycle`, `reap_all`.
- **`sim_main.spl`** — the production end-to-end gate (`fn main()`).
- **`test_fw.spl`** — full self-test suite. `README.md` — architecture + requirements coverage.

## NVMe controller front end — COMPLETE (admin + multi IO queue + ONFI NAND)

The full-controller layer, on top of the FTL/FIL stack (legacy single-queue
`hil.spl`/`firmware.spl` left untouched so its assertions stay the regression gate):

- **`nvme_admin_types.spl`** — admin opcodes, CNS/feature/log ids, admin status codes,
  `AdminCmd{cid,opcode,nsid,cdw10..12}`, `IdentifyData`, `SmartLog` (types only, no `me`).
- **`nvme_admin.spl`** — `AdminQueue` (qid-0 SQ/CQ rings), `FeatureStore` (Get/Set Features),
  command-dword decoders + `AdminCmd` builders, Identify Controller/Namespace + SMART builders.
- **`nvme_qset.spl`** — `QueueSet`: up to `MAX_IO_QUEUES` IO SQ/CQ pairs in flat parallel
  arrays (ring of qid q at offset `q*MAX_QUEUE_SIZE`). Enforces NVMe-faithful semantics:
  CQ-before-SQ, SQ binds to an existing CQ (`SC_CQ_INVALID`), no delete of an SQ/CQ with
  pending work/completions (`SC_QUEUE_BUSY`), qid range / in-use / size checks; fair
  round-robin `next_pending_sq`.
- **`nvme_controller.spl`** — `NvmeController{aq,qset,features,ftl,pool,last_id,smart,…}`:
  `admin_process` (Create/Delete IO SQ/CQ, Identify, Get/Set Features, Get Log Page) and
  `io_process` (round-robins active SQs → FTL → FIL, posts to each SQ's bound CQ).
- **`fil_nand_device.spl`** — protocol-accurate ONFI NAND *device* model: CMD/ADDR/DATA latch +
  `exec()` state machine (READ 00h/30h, PROGRAM 80h/10h main+spare, ERASE 60h/D0h, STATUS 70h,
  RESET FFh), status register (FAIL/ARDY/RDY/WP_N), OOB {lba,seq} spare area, no-overwrite rule,
  per-page bit-flip injection, bad-block + one-shot program/erase fault injection. **Faithful
  drop-in for `fil_nand.Nand`** — same `program/read_page/erase_block/erase_count/inject_*/set_bad`
  seam, each driving the ONFI bus internally.
- **`nvme_main.spl`** — the controller acceptance e2e: host bring-up (Identify → Features →
  Create CQ→SQ) → multi-queue IO + round-robin → negative cases (SQ→missing-CQ, invalid
  namespace, delete-bound-CQ) → reverse-order teardown → SMART log → power-cycle survival.

**The FIL runs on the ONFI device** (plan phase E3, done): `fil.spl` composes `NandDevice` (not the
behavioural `fil_nand.Nand`), so every write/read/GC-erase/recovery-OOB-scan in `sim_main` and
`nvme_main` goes through the real ONFI handshake. `fil_ecc` keeps the FIL-level ECC; NAND stores
the SECDED payload-window ECC in spare-area state at program time, the FMC latches it on read, and
FIL decodes the stored value instead of recomputing from read data. One silent payload-bit error
through bit 16 is corrected; double-bit payload and stored-ECC/OOB metadata corruption fail closed. The self-test
suite is green (gate
`ALL FIRMWARE SELF-TESTS PASS`).

Scope note (explicit): "full NVMe SSD fw" here = the host-runnable simulation (run-green).
P9 — bare-metal **rv32** scalar firmware floor: `fw_rv32/entry.spl` is written as an array-free scalar
re-expression of the RAIN reconstruct, SECDED ECC floor, fixed scheduler, fixed power/thermal model, fixed map cache, fixed band allocator, fixed journal ring, fixed HIL command/queue, fixed queue-phase handling, fixed io-opcode-read-zero-trim-flush handling, fixed admin/format/fw-log handling, fixed reactor handling, fixed policy/target handling, fixed DRAM/durability handling, fixed wear/scrub handling, fixed media-retire handling, fixed power-cycle handling, fixed backpressure/abort handling, fixed feature-guard handling, and fixed namespace-guard handling, `bin/simple check`-clean, host-verified, and wired through
the stable Pure-Simple rv32 HAL provider. As of 2026-07-25,
the direct rv32 QEMU smoke prints `RV32 NVME FW BEGIN` and
`ALL RV32 NVME FW CHECKS PASS`; internal rv32 counters use bounded no-alloc caps
while host simulation owns full-width counter stress. The full 22-module no-alloc firmware
has not been ported into that boot path yet. P9 is therefore **reference-wired, full-port pending**.
The sibling **rv64** lane now has `fw_rv64/build.shs` and a fail-closed QEMU boot SSpec, but
`NVME_RV64_BUILD_TIMEOUT_SECS=120 sh examples/09_embedded/simpleos_nvme_fw/fw_rv64/build.shs`
currently terminates before `build/nvme_fw_rv64.elf`; see
`doc/08_tracking/bug/nvme_fw_rv64_direct_build_timeout_2026-07-07.md`.

## Production hardening — DONE (run-green, on origin/main)

See `PRODUCTION_STATUS.md` for the acceptance bar. Landed since the initial build:
- **Data-path correctness**: GC data-loss guard (a victim is erased only after every live page
  is relocated), a GC scratch reserve eliminating the write-cliff, and no silent journal-record
  drop on WAL overflow. Regressions: `gc_safety_check.spl`, `durability_check.spl`,
  `thermal_check.spl`, `rain_ftl_check.spl`.
- **Faithful durability**: power loss wipes all volatile DRAM (map cache + band bitmap); recovery
  replays the journal onto the flash-resident L2P, rebuilds the band, and re-applies the
  persistent bad-block table.
- **Protocol surface**: overflow-safe command validation (correct `SC_*`, no crash) + the
  mandatory admin set (Abort, Async Event Request, Format NVM, Firmware Download/Commit).
- **Host data transport floor (P4) — WIRED**: `hil_command.prp_byte` decodes a compact
  two-segment PRP descriptor from `NvmeCmd.data`, and both HIL + multi-queue NVMe controller
  program every LBA in `nblocks` from the modeled host segments rather than only the first block.
  Full HostMem/SGL/IOMMU descriptors remain out of scope.
- **DRAM floor (P5) — WIRED**: `ftl_map` is the live FTL's bounded LRU write-back cache,
  with `MAP_CACHE_DRAM_BUDGET_BYTES` making the cache budget explicit. `dram.spl` adds a bounded
  arena span used by HIL and the multi-queue NVMe controller before FTL programming; oversized
  writes fail before partial media updates and released spans are reusable. Full DRAM refresh/ECC/
  bandwidth modeling remains out of scope.
- **Cooperative concurrency floor (P6) — WIRED**: `firmware.service()` drains through
  `service_tick()`, which serializes foreground HIL work and background GC behind an explicit
  FTL-map owner token. Multicore/preemptive behavior remains out of scope.
- **Media management**: static wear-leveling (`wear_level_once`) + read-disturb scrub (`scrub_once`).
- **Health**: SMART wired to real activity (wear, spare, media errors, unsafe shutdowns) + error log.
- **Live thermal (P7) — WIRED**: `pt: PowerThermal` field ticked in `process_one_io` on every
  program/read; `do_get_log(LOG_SMART)` reports the **live composite temperature** and ORs the
  thermal critical-warning bit — replacing the former hardcoded `temperature: 313`. Proven by
  `thermal_check.spl` (gated `THERMAL OK`), `power_thermal_selftest`, and two
  `nvme_controller_selftest` thermal asserts.
- **Formal (req 6) — DONE**: `proofs/{Alloc,Recover,Gc}.lean` (`lean`-checked).
- **Policy hooks (req 7) — DONE**: sandboxed runtime policy hooks — `hooks.spl` registry
  (GC-score / QoS / hot-cold / telemetry) + `sandbox.spl` install gate (forbidden
  metadata/recovery/commit domains rejected), modeled fuel bound, and output clamps; wired into
  FTL GC victim selection, which only asks the hook to **score** its own CLOSED candidates (the
  hook never names a block). Tested by `policy_hooks_check.spl` + `hooks_selftest`/`sandbox_selftest`
  and proven by `proofs/Hooks.lean`.
- **RAIN (req 8) — DONE (single-power-session scope)**: `rain_parity` field +
  `rain_recover_channel()` wired into the live
  `Ftl`. Writes and GC relocations add new page payloads to parity; successful erases from GC/Format
  remove old page payloads; `rain_seal` remains the scrub/repair pass. Parity is DRAM-only — not
  persisted and not rebuilt by `recover()` — so channel recovery is not power-cycle-safe (see
  `doc/08_tracking/bug/rain_parity_volatile_channel_recovery_dataloss_2026-07-18.md`). `rain_recover_channel`
  rebuilds a corrupted/failed channel in place (recovered = parity XOR survivors; erase the failed
  block; reprogram its live pages; L2P unchanged). Proven by `rain_ftl_check.spl` (256 LBAs survive
  a whole-channel uncorrectable failure without a pre-rebuild seal, gated `RAIN-FTL OK`), the
  standalone `rain_check.spl` (`RAIN OK`), `ftl_rain_selftest`, and `proofs/Rain.lean`.
- **Reliability engine, rel_* v1 + nd_types (2026-07-19) — DONE, run-green**: typed NAND
  coordinates (`nd_types.spl`) plus the `rel_types`/`rel_health`/`rel_vref`/`rel_ladder`/
  `rel_refresh`/`rel_disturb`/`rel_wear` module family, wired into `fil.spl`/`ftl.spl`/
  `nvme_controller.spl`/`firmware.spl` (recovery-ladder reads, one-reclaim-per-tick
  scrub/WL/refresh, spare substitution on retire). Each module has its own
  `rel_*_check.spl`/`nd_types_check.spl`; `rel_wiring_check.spl` is the integration gate.
  See `PRODUCTION_STATUS.md` § "Reliability engine" for the full acceptance detail.

Integration status (canonical: `doc/03_plan/hardware/nvme_fw_gap_closure_plan.md` § "Integration
status", wired-vs-shelf table): P1 `fil_fmc`, P2 `fil_scheduler`, P7 `power_thermal`, and P8
`rain` are all **WIRED** into the live controller/FTL; P2 remains a timing floor because
channel-level parallelism is a model a single-threaded sim cannot physically exhibit; P3 has a
**wired SECDED payload-window stored-ECC simulation floor** (full BCH/LDPC remains silicon/out of
scope); P4 has a **wired segmented-PRP host-byte floor** (full HostMem/SGL/IOMMU remains out of scope);
P5 has a **wired bounded-map-cache + fixed arena/free-list floor** (full DRAM subsystem remains out of scope);
P6 has a **wired cooperative-owner floor** (true multicore/preemption remains out of scope);
P9 is **reference-wired, full-port pending** (rv32 note above, including the task-pool fail-closed scalar floor; rv64 recipe present, ELF output blocked).

Silicon-only pieces remain out of scope (real BCH/RS/LDPC hardware ECC, MMIO/PCIe, full PRP/SGL DMA, real DRAM refresh/ECC/bandwidth, multicore/preemptive scheduling, persistent backing
store) — see `PRODUCTION_STATUS.md` § Silicon boundary. This is a hardware-FAITHFUL **simulation**,
not a silicon-shippable binary; "production level" in the literal sense is NOT done.
