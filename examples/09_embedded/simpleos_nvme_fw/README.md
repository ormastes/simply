# simpleos_nvme_fw — NVMe SSD firmware + emulator (and a teaching scaffold)

**Simulation only — no hardware, no QEMU, no real MMIO.**  
Host-runnable, pure-Simple NVMe SSD firmware on SimpleOS.

## Subdirectories (the two real deliverables)

- **`fw/`** — the full layered NVMe SSD **firmware**: HIL/FTL/FIL + an NVMe admin/multi-IO-queue
  controller front end over an ONFI NAND device. 300 self-test asserts. See `fw/README.md`.
- **`emu/`** — a pure-Simple NVMe **host/device emulator** with a settable memcpy/DMA seam on
  both sides, ONFI NAND, domain newtypes, and **Lean4 proofs**. See `emu/README.md`.
- **Operator guide for both:** `doc/07_guide/hardware/nvme_firmware/`.

The two files below (`main.spl`, `pool_demo.spl`) are the original **Phase-1 teaching slice** —
the smallest standalone illustrations of the FTL and the object pool. The production firmware
lives in `fw/`.

## What it demonstrates

Two complementary files, each runnable independently:

### `main.spl` — Log-structured FTL + P2L crash recovery

- **Simulated NAND** — each page stores a data byte plus OOB metadata
  `{logical addr, write sequence}`
- **Log-structured FTL** — `Ftl` holds an L2P map (lba→ppn), a monotonic write
  sequence counter, and a free-ppn cursor (the log append point)
- **Write path** — `ftl.write(lba, data)` appends a NAND page with OOB, then
  repoints L2P at the new physical page (the old page is left as a stale version)
- **Crash recovery** — `ftl.crash_reset()` zeroes the in-RAM L2P; `ftl.recover()`
  rebuilds it by scanning page OOB and keeping the highest write sequence per LBA
  (a P2L scan — the committed-prefix property in miniature)
- **Offload-op seam** — `offload_checksum(data, lba)` calls a software byte-fold
  fallback; in production this indirection routes to `common.bytes.checksum.Crc32`
  or a hardware CRC engine without changing FTL logic

### `pool_demo.spl` — Generation-checked object pool

- **`TaskPool`** — bounded slots addressed by `Handle{index, generation}` instead of
  a raw pointer
- **Stale-handle guard** — `pool.release(h)` bumps the slot's generation counter;
  any still-live `Handle` is then rejected by `pool.get_phase(h)` and `pool.step(h)`
  (use-after-free equivalent for bare-metal task slots)
- **Cooperative state machine** — `pool.step(h)` advances the slot's phase through
  `PHASE_INIT → PHASE_PROGRAM → PHASE_JOURNAL → PHASE_UPDATE_L2P → PHASE_DONE`;
  state lives in the slot (task context), not on a call-stack local

## How to run

```bash
bin/simple run examples/09_embedded/simpleos_nvme_fw/main.spl
bin/simple run examples/09_embedded/simpleos_nvme_fw/pool_demo.spl
```

Both print per-check `PASS:` lines and a final `PASS` line on success.

## Known issue

`bin/simple check` times out on both files due to a superlinear type-checker blowup
triggered by multiple `me` methods on structs with array fields. The interpreter
(`bin/simple run`) is unaffected — all assertions pass. See:

```
doc/08_tracking/bug/sspec_simple_check_superlinear_two_impls_2026-06-29.md
```
