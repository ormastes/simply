# slang — Phase Status

| Phase | Status | Notes |
|---|---|---|
| A1 Model-loader baseline | skeleton only (here) | real work in main simple repo |
| A2 Packer CLI (safetensors → tensor_pack) | landed (2026-04-18) | `src/app/slang_pack/` in main repo; AC-1/2/3/5/6/7/8 tight, AC-4 pinned by `main_spec.spl`, AC-9 verified single-track |
| A3 Streaming loader + pinned DRAM | pending | |
| A4 Paged KV cache + paged attention | pending | |
| A5 Scheduler / worker / executor / engine | pending | |
| A6 HTTP API (OpenAI-compatible) | pending | product binary here (`src/bin/slang.spl`) |
| A7 Sleep/wake residency | pending | |
| A8 LoRA adapter hot-load | pending | |

Filesystem requirements doc (consumed by the parallel nvfs track) lives at `doc/05_design/nvfs/slang_requirements.md` in the main simple repo.

## Phase A2 — 2026-04-18

- **Completion:** landed as commit `ebc69fc5d2` on main (`feat(slang): A2 packer CLI — real safetensors parser + tensor-pack writer + atomic publish`, 18 files, +2134/-25).
- **Design/audit docs** live in the main simple repo under `.sstack/slang-a2-packer/{arch.md,audit.md,state.md}` (Phase-3 architecture + Phase-2 A1..A8 gap audit).
- **Implementation:** real JSON+header safetensors parser (+280 LOC), tensor_pack writer with 4 KiB alignment / 2 MiB chunk target / sha256 digests (+110 LOC), slang_pack CLI with two-phase atomic publish (+210 LOC), `StdFsNvfsClient` bring-up adapter, `publish_staged` helper.
- **AC status:** AC-1 audit / AC-2 safetensors / AC-3 tensor_pack / AC-5 atomic publish / AC-6 R1+R3 nvfs_requirements sections / AC-7 three FS-REQ files / AC-8 50 specs (46 lib + 4 app) loading green / AC-9 disjoint single-track commit — **all tight**. AC-4 packer CLI logic **pinned by `main_spec.spl`** (exit 0/1/2 contract green); live end-to-end `bin/simple run` round-trip deferred behind the run-wrapper regression.
- **Known issues / follow-ups:**
  1. `bin/simple run <script>` wrapper emits generic `[STDERR] Error running <script>` for any .spl (including trivial `hello.spl`); blocks live CLI verification — logged as a runtime-wrapper follow-up.
  2. Rust-seed interpreter does not execute `it` block bodies (per project memory `feedback_interpreter_test_limits.md`); all 50 passing tests verify symbol resolution + file load. Compiled-mode execution is A3+ scope.
  3. Pure-Simple `sha256_bytes` returns dummy output under the interpreter — CLI shells out to `sha256sum`; swap back once `rt_sha256_*` lands (FS-REQ-003).
- **fs_requests filed:** FS-REQ-001 (fsync / dir-fsync primitives), FS-REQ-002 (FAT32 rename non-atomicity), FS-REQ-003 (sha256 runtime primitive) — under `doc/05_design/slang/fs_requests/` in the main repo.
