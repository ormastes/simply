# NVMe firmware — Lean4 formal verification (`fw/proofs/`)

Standalone Lean4 proofs of the firmware's **safety-critical FTL invariants** (research
requirements 6 and 7). Each file checks with `lean <file>` at exit 0 with no `sorry`/`admit`,
using only Lean core + `omega` (no mathlib). The models are hand-transcribed from the
cited Simple sources and the constants match the device geometry (64 blocks × 64 pages =
4096 pages, `GC_RESERVE = 2`); these are proofs *of the algorithms*, not a mechanical
extraction of the executed bytes (same approach as the sibling `emu/proofs/`).

| Proof | Mirrors | Properties proven |
|-------|---------|-------------------|
| `Alloc.lean` | `ftl_band.spl` (`alloc_page`, `alloc_page_host`) | Allocated pages are in range; the write pointer is a strict monotonic cursor (no page handed out twice in a block); the host path never breaches the GC reserve, so GC always has scratch; a non-full victim yields a strict net free-space gain (GC progress). |
| `Recover.lean` | `ftl.spl` (`recover`) | Replaying the journal in append (ascending-seq) order yields, for every LBA, the new_ppn of its **last** record — the committed prefix: newest write wins, a trim clears the LBA unless a later write supersedes it, and an un-journaled LBA stays unmapped. |
| `Gc.lean` | `ftl.spl` (`reclaim_block`) | A relocated page lands **outside** the victim block, so erasing the victim never destroys the current copy of a relocated LBA; a relocation is local (other LBAs untouched); and the abort path (alloc failed → no erase) is a no-op on the map. Together: whether GC succeeds or aborts, no committed data is lost. |
| `Hooks.lean` | `sandbox.spl` + `hooks.spl` + `ftl.spl` (`policy_gc_victim`) | **Sandboxed dynamic policy hooks (req 7).** Only the four policy kinds (0..3) install; every forbidden metadata/recovery/commit domain (≥100) is rejected. The output clamps map any hook return into the safe set (priority ∈ [0,3], flag ∈ {0,1}). Flagship: the firmware only asks the untrusted hook to **score** its own CLOSED candidates, so the selected victim is always an offered candidate — CLOSED for any score function, never a FREE/OPEN/BAD block. |
| `Fmc.lean` | `fil_fmc.spl` (FMC status state machine) | **Flash-controller register discipline (gap-closure P1).** `issue` completes a command (DONE/ERR) only from BUSY, so a completed status never appears without a prior load+issue; from BUSY, issue reaches exactly DONE or ERR; ERR is sticky under poll (read-only) and is cleared only by ack. |
| `Rain.lean` | `rain.spl` (XOR parity reconstruction) | **Internal RAID/RAIN channel resilience (gap-closure P8).** For any data and any survivor combination, reconstructing a failed channel from the parity + survivors recovers the **exact** lost word — the survivors cancel because XOR is its own inverse (`parity = lost ⊕ s ⇒ parity ⊕ s = lost`). A genuine algebraic guarantee, not a restatement. |

Run all six:

```bash
export PATH="$HOME/.elan/bin:$PATH"
for f in Alloc Recover Gc Hooks Fmc Rain; do lean examples/09_embedded/simpleos_nvme_fw/fw/proofs/$f.lean && echo "$f OK"; done
```

They are also gated by the system spec
`test/03_system/app/nvme_firmware/nvme_firmware_simulation_spec.spl` (the "Lean4 formal
verification" scenario), alongside the runnable regressions (`gc_safety_check`,
`durability_check`, `wear_scrub_check`, `policy_hooks_check`) whose assertions these proofs
generalize.

## Generated-mirror / manual-proof split

Each proof is internally split so a later change to the Simple code re-applies to Lean with
minimal effort (see the canonical convention in
[`doc/07_guide/compiler/lean_verification_workflow.md`](../../../../../doc/07_guide/compiler/lean_verification_workflow.md)
§ "Generated-mirror / manual-proof split"):

- A **`-- BEGIN gen lean … -- END gen lean`** section holds *only* the `def`s — the
  mechanical mirror of the i64 logic in the cited `.spl` (constants, geometry, the
  selection/replay model). This is the **single place coupled to the implementation**: when
  the Simple code changes, re-transcribe just this section.
- The **`-- MANUAL PROOFS`** section below holds the hand-written theorems. A re-mirror leaves
  them untouched when the model's shape is unchanged; a constant that *also* appears in a
  theorem statement (e.g. a geometry bound) couples to the code and is updated in both places.

The split is **in-file** (not two files) on purpose: these proofs are verified by raw
`lean <file>`, which does not resolve sibling-source `import`s without a Lake project or a
precompiled `.olean` on `LEAN_PATH`. The two-file `Basic.lean`(defs) / `Theorems.lean`(proofs,
`import X.Basic`) shape used under `src/verification/<project>/` is the alternative for
projects already built with Lake. There is **no automatic generator**: the Simple→Lean
`gen-lean` CLI runs a fixed inventory of regeneration modules and cannot consume an arbitrary
firmware `.spl` (and is currently broken — see
`doc/08_tracking/bug/gen_lean_cli_infinite_recursion_2026-06-30.md`), so the `gen lean`
section is re-transcribed by hand. Keeping it marked and contiguous is what makes that cheap.
