# slang

vLLM-like LLM serving engine for Simple / SimpleOS.

This repository is the **product** wrapping of slang — the service binary,
deployment configs, and integration tests. The reusable library logic
lives in the main [`simple`](https://github.com/ormastes/simple) repo
under `src/lib/gc_async_mut/slang/` and is pulled in when this repo is
checked out as a submodule at `examples/slang/` in the main tree.

## Status

**Phase A1 — Model-loader baseline.** Stub only. The binary prints help
and exits. The real serving pipeline (KV cache, scheduler, batcher,
OpenAI-compatible API) lands in Phases A4–A6.

## Layout

```
src/bin/slang.spl      # service entry point (A1: stub)
test/02_integration/      # TTFT / throughput benchmarks (A6+)
doc/                   # runbooks, deployment notes
```

## Design docs

Canonical design lives in the main `simple` repo:

- `doc/05_design/slang/slang_master_plan.md` — phased roadmap
- `doc/05_design/nvfs/slang_requirements.md` — filesystem contract slang asks for

## Build & run

From the main `simple` repo, once this is checked out as a submodule:

```sh
cd examples/slang
bin/simple run src/bin/slang.spl
```

## License

MIT — see [LICENSE](LICENSE).
