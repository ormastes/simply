# Exercise 22: Streams and Async Operations

## Asynchronous GPU Execution

By default, kernel launches and memory transfers are serialized on a single
stream. CUDA streams allow overlapping computation and data transfer for
better GPU utilization. The C++ original
(`cuda_exercise/20.cuda_intermediate/22.Streams_and_Async`) runs a
multi-stream pipeline; this Simple port is limited by what the deployed Rust
seed provides, and says so.

### What the seed does NOT provide (feature request filed)

The stream-launch form this module originally used

```simple
kernel<<<grid: (grid_size, 1, 1), block: (block_size, 1, 1), stream: s>>>(args)
```

fails to parse: `Unexpected token: expected TripleGt, found Comma`
(`src/compiler_rust/parser/src/expressions/postfix.rs:929` accepts only
`grid:` and `block:`). Beneath the grammar there is nothing to bind a stream
to either: `rt_cuda_launch_kernel` has no stream parameter and the runtime
(`compiler_rust/runtime/src/cuda_runtime.rs`) defines no `rt_cuda_stream_*`
functions at all, so `std.io.cuda_sffi.cuda_stream_create` is an unbacked
extern. Per the repo rule this is **not** silently normalized; it is recorded
as a concrete feature request with the proposed grammar
`<<<grid: g, block: b, stream: s, shared: n>>>`:

- `doc/08_tracking/bug/kernel_launch_grammar_no_stream_slot_2026-08-25.md`

### What this module demonstrates instead

| Demo | What it shows | Kernel |
|------|---------------|--------|
| `demo_single_stream` | launch -> sync -> download on the default stream | `scale_kernel` |
| `demo_two_streams` | two launches enqueued, ONE `cuCtxSynchronize` | `scale_kernel` x2 |
| `demo_pipeline` | chunked issue over sub-ranges of one buffer (pointer arithmetic), one sync | `scale_kernel` x4 |
| `demo_stream_add` | two producers then a consumer; in-order default-stream semantics | `scale_kernel`, `add_kernel` |
| `demo_event_timing` | `cuEventRecord`/`cuEventElapsedTime` on stream 0 (the seed's only async primitive) | `scale_kernel` |

Kernels are hand-written PTX launched through `std.cuda` (see
`lib/gpu_test_helpers.spl` for why `@gpu_kernel` + `<<<...>>>` cannot be used
for real execution on the seed).

### Stream API mapping (for when the runtime grows one)

| Simple (proposed) | CUDA | Status in seed |
|-------------------|------|----------------|
| `cuda_stream_create()` | `cuStreamCreate` | extern declared, no runtime backing |
| `cuda_stream_sync(s)` | `cuStreamSynchronize` | extern declared, no runtime backing |
| `cuda_stream_destroy(s)` | `cuStreamDestroy` | extern declared, no runtime backing |
| `rt_cuda_event_*` | `cuEvent*` | implemented and used here |
| `k<<<grid, block, stream: s>>>` | `k<<<grid, block, 0, s>>>` | grammar has no slot |

## Files

- `main.spl` - Default-stream ordering, chunked pipeline, producer/consumer, event timing
- `spec.spl` - Device tests (skip without a CUDA device)

## Running

```bash
SIMPLE_EXECUTION_MODE=interpreter bin/simple run examples/08_gpu/simple_cuda_example/20.cuda_intermediate/22.Streams_and_Async/main.spl
bin/simple test examples/08_gpu/simple_cuda_example/20.cuda_intermediate/22.Streams_and_Async/spec.spl
```

## Doctest: chunk arithmetic

The pipeline offsets each chunk by `k * chunk * 4` bytes and scales it by
`k + 1`; that bookkeeping is plain integer math:

```sdoctest
>>> val total = 1024
>>> val num_chunks = 4
>>> val chunk = total / num_chunks
>>> print chunk
256
>>> for k in 0..num_chunks:
...     print "chunk {k}: byte offset {k * chunk * 4}, scale {k + 1}"
chunk 0: byte offset 0, scale 1
chunk 1: byte offset 1024, scale 2
chunk 2: byte offset 2048, scale 3
chunk 3: byte offset 3072, scale 4
>>> assert chunk == 256 and 3 * chunk * 4 == 3072
```

(The `assert` keeps the block fail-closed: the seed's md doctest runner only
checks that a block exits 0 and does not compare printed output.)

## Learning Goals

- Understand default-stream (in-order) semantics: enqueue many, sync once
- Split work into chunks with device pointer arithmetic
- Chain producer kernels into a consumer kernel safely
- Time GPU work with CUDA events
- Know exactly which stream features the current toolchain lacks
