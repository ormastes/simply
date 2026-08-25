# SimpleOS NVMe SSD firmware (`fw/`)

A bare-metal **NVMe SSD controller firmware**, written in pure Simple as a host-runnable
**simulation** of the full data path: host NVMe queues → translation layer → flash media.
Built layer-by-layer with parallel agents (Sonnet builders + Opus review gates), gated by
`bin/simple run` self-tests (the `check` typecheck path is avoided — see `CONVENTIONS.md`).

> Simulation only — no hardware, no QEMU, no real MMIO. The geometry (4 planes × 16 blocks ×
> 64 pages = 4096 pages, 3072 surfaced LBAs) and a one-byte-per-page payload stand in for a
> real device so the entire stack runs and self-verifies on the host.

> A bare-metal **rv32** scalar firmware floor (the sibling `../fw_rv32/entry.spl`,
> gap-closure P9) exists and is host-verified. It covers RAIN, ECC, scheduler, power/thermal,
> map-cache, band, journal, HIL/queue, IO/admin/flush, reactor, policy/target,
> DRAM/durability, wear/scrub, media-retire, power-cycle, backpressure/abort,
> feature/namespace guards, and the Cosmos+ OpenSSD target profile. The full no-alloc firmware
> port is still the ceiling, so the "simulation only" scope above is unchanged.
> The sibling `../fw_rv64/` lane now has an explicit direct-build recipe and fail-closed
> QEMU boot SSpec; the real boot remains red until `build/nvme_fw_rv64.elf` is produced.

## Run it

```bash
bin/simple run examples/09_embedded/simpleos_nvme_fw/fw/sim_main.spl   # single-queue end-to-end demo
bin/simple run examples/09_embedded/simpleos_nvme_fw/fw/test_fw.spl    # full self-test suite (1174 checks)
bin/simple run examples/09_embedded/simpleos_nvme_fw/fw/nvme_main.spl  # NVMe admin/multi-IO-queue controller e2e
```

Standalone production-hardening regressions and proofs:

```bash
bin/simple run examples/09_embedded/simpleos_nvme_fw/fw/gc_safety_check.spl   # GC data-loss guard + no write-cliff
bin/simple run examples/09_embedded/simpleos_nvme_fw/fw/durability_check.spl  # power-loss recovery + WAL overflow
bin/simple run examples/09_embedded/simpleos_nvme_fw/fw/wear_scrub_check.spl  # static wear-leveling + read-disturb scrub
bin/simple run examples/09_embedded/simpleos_nvme_fw/fw/task_pool_fail_closed_check.spl # invalid task pool rejects writes
lean examples/09_embedded/simpleos_nvme_fw/fw/proofs/Alloc.lean              # + Recover, Gc, Hooks, Fmc, Rain .lean (6 proofs, req 6)
```

> **Production-hardening status & acceptance bar:** `fw/PRODUCTION_STATUS.md` — production-grade
> *logic and NVMe protocol compliance, simulation-validated* (the silicon boundary is stated there).
>
> Operator guide (both `fw/` firmware and the sibling `emu/` emulator):
> `doc/07_guide/hardware/nvme_firmware/`.

`sim_main` drives a full workload: 128 writes → read-back → overwrite-all (write
amplification) → **garbage collection** (reclaim stale blocks, logical view preserved) →
trim → **power-fail + recovery** (committed state survives, trim stays trimmed).

## Architecture (MDSOC+ : layered domains)

```
   CTRL ┌───────────────────────┐   nvme_admin (Identify, Create/Delete IO SQ/CQ,
        │ admin + IO queue sets │   Get/Set Features, Get Log Page) · nvme_qset
        │ + power / thermal     │   (round-robin) · nvme_controller · power_thermal
        └───────────┬───────────┘   (live composite temp → SMART, gap-closure P7)
                    │
            host NVMe SQ/CQ rings
                    │
   HIL  ┌───────────▼───────────┐   hil_queue · hil_command · fw_pool · hil
        │ fetch → validate →    │   (decode, generation-handle task context,
        │ dispatch → complete   │    SQ→CQ reactor)
        └───────────┬───────────┘
   FTL  ┌───────────▼───────────┐   ftl_map (DFTL write-back cache) · ftl_band
        │ L2P map · log alloc · │   (log-structured allocator + valid bitmap) ·
        │ WAL · GC · recovery   │   ftl_journal (WAL+checkpoint+A/B superblock) ·
        └───────────┬───────────┘   ftl_gc (wear victim) · ftl (write/read/trim/recover) · rain (XOR-parity channel rebuild)
   FIL  ┌───────────▼───────────┐   fil_nand (sim NAND + OOB) · fil_nand_device (ONFI NAND
        │ program/read/erase +  │   device) · fil_fmc (every op via FMC register handshake;
        │ ECC + bad-block remap │   owns the NAND device) · fil_ecc · fil_badblock
        └───────────────────────┘   · fil (ECC-verified reads, bad-block retirement)
   firmware.spl — cooperative reactor wrapping the stack (service cycle = drain queues +
   background GC below the free-block watermark; checkpoint; power-cycle).
```

> **MDSOC vs MDSOC+ — a note on the label.** "MDSOC+" above is the research's *multi-domain
> SoC* sense (host / runtime / FTL / media / recovery / offload / verification —
> `doc/01_research/hardware/nvme_firmware/nvme_ssd_firmware_architecture.md` §5), which is a
> different sense from the compiler architecture contract's **MDSOC+ = MDSOC outer + ECS inner**
> (`doc/04_architecture/compiler/mdsoc/mdsoc_architecture_tobe.md`). That contract's Layer Rules
> reserve the ECS business layer for **userland services/apps** and keep **kernel and drivers
> MDSOC-only** (ECS forbidden — "drivers are IO-bound state machines, not entity graphs"). Both
> senses hold here without conflict: this firmware is a **driver**, so it is correctly
> **MDSOC-only** — pure composition (no inheritance), strictly downward-only domain layering
> (HIL → FTL → FIL; every cross-domain import points down), no shared mutable global, and **no
> ECS** (`grep -r "use std.ecs" fw/` returns nothing). It realizes the research's multi-domain
> decomposition *with* MDSOC structure — exactly what the contract asks of a driver.

## Module map

| Layer | Modules |
|-------|---------|
| Interface | `nvme_types` (constants, `Handle`, `NvmeCmd`/`NvmeCpl`, geometry, helpers) |
| **FIL** | `fil_nand`, `fil_nand_device` (ONFI NAND *device*), `fil_fmc` (flash-memory-controller register driver, gap-closure P1 — **wired**: every program/read/erase routes through the FMC register handshake; the `Fmc` owns `fil_nand_device`), `fil_scheduler` (multi-channel request scheduler, gap-closure P2 — **wired timing floor**: every valid program/read/erase routes through it; the single-threaded host sim cannot physically exhibit channel-level parallelism), `fil_ecc`, `fil_badblock`, `fil` |
| **FTL** | `ftl_map`, `ftl_band`, `ftl_journal`, `ftl_gc`, `ftl`, `rain` (XOR-parity die/channel resilience, gap-closure P8 — **wired**: the FTL maintains parity on writes/GC/format and rebuilds a failed channel in place via `rain_recover_channel`; `rain_seal` remains the scrub/repair pass) |
| **HIL + core** | `hil_queue`, `hil_command`, `fw_pool`, `hil`, `firmware` |
| **NVMe controller front end** | `nvme_admin_types`, `nvme_admin` (admin queue: Identify, Create/Delete IO SQ/CQ, Get/Set Features, Get Log Page), `nvme_qset` (multi IO queue, round-robin), `nvme_controller`, `power_thermal` (power states + thermal throttling, gap-closure P7 — **wired**: the controller IO path drives it and SMART reports its live composite temperature) |
| Tests | `test_fw` (all self-tests, 1174 checks), `sim_main` (single-queue e2e), `nvme_main` (controller e2e) |

> **Integration status (wired vs. shelf).** The authoritative wired-vs-shelf accounting is
> `doc/03_plan/hardware/nvme_fw_gap_closure_plan.md` § "Integration status — wired vs. shelf" —
> P1/P2/P7/P8 are **wired**, P3/P4/P5/P6 have wired simulation floors, and P9
> (`../fw_rv32/entry.spl`) is the host-verified rv32 scalar firmware floor wired through the rv32
> boot hook. The rv64 sibling has a build recipe plus missing-media gate, but native-build
> currently terminates before ELF output; the full no-alloc firmware port remains the ceiling.

## Requirements coverage (from the research report)

| # | Requirement | Where |
|---|-------------|-------|
| 1 | Coroutine / cooperative tasks | `firmware.service()` reactor; `fw_pool` write-task state machine driven by `hil.tick()` |
| 2 | State-machine memory vars over locals | task phase (`PH_*`) held in the `fw_pool` slot (task context), not call-stack locals |
| 3 | Index pointer + object pool | `fw_pool` generation-checked `Handle{pool,index,generation}` (use-after-free guard) |
| 4 | MDSOC+ multi-domain architecture | HIL / FTL / FIL domains, composed structs (`Firmware{hil{ftl{fil}}}`) — **MDSOC-only** for the driver tier (ECS-free, composition not inheritance, downward-only layering); see the MDSOC note above |
| 5 | Offloadable operations | `fil` offload-op seam: ECC / bad-block / ONFI NAND-device as separately composed modules behind an abstract page-level API (a compile-time module seam, not a runtime-swappable op) |
| 6 | Lean4 formal verification | **done** — `fw/proofs/{Alloc,Recover,Gc}.lean` prove the allocator/GC-reserve, committed-prefix recovery, and GC data-loss-guard invariants (standalone, `lean`-checked, no mechanical link to executed bytes). The sibling **`emu/`** has its own proofs (`emu/proofs/*.lean`) |
| 7 | Dynamic loaded code hooks | **done** — sandboxed runtime policy hooks: `fw/hooks.spl` registry (GC-score / QoS / hot-cold / telemetry) + `fw/sandbox.spl` install gate (forbidden metadata/recovery/commit domains rejected), modeled fuel bound, output clamps; wired into FTL GC victim selection, which only asks the hook to **score** its own CLOSED candidates (the hook never names a block). The four kinds are req 7's mandated policy domains: GC-score is the worked live consumer; QoS/hot-cold/telemetry ship safe defaults behind the same gate/fuel/clamps/tests as the sanctioned extension surface. Tests: `fw/policy_hooks_check.spl` + `hooks_selftest`/`sandbox_selftest`; proof `fw/proofs/Hooks.lean` |

Recovery and verification are architectural (committed-prefix recovery is proven by the
crash/recover self-tests and `sim_main`), per the report's central recommendation. Research +
build plan: `doc/01_research/hardware/nvme_firmware/` and
`doc/03_plan/hardware/nvme_fw_baremetal_parallel_agent_plan.md`.
