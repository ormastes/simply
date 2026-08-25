# Core GEMM Operations

**Tier:** 2 (Concept Adaptation)
**Original CUDA Concept:** size-dispatched GEMM for transformer layers (81.Core_GEMM_Operations)

## Simple Approach

Every transformer layer is built on `C = A x B`. The original picks one of
three kernels by problem size; this module keeps the dispatcher and the two
implementations that exist in Simple today:

| `GemmStrategy` | when | implementation |
|---|---|---|
| `Simd` | `m*n <= 64*64` | `gemm_simd`: `Vec8f` lanes along `k` over a transposed B (`std.simd`) |
| `SharedMemory` | otherwise | `gemm_shared`: `gpu_gemm` from `std.gpu`; `gemm_shared_kernel` is the tiled formulation |
| `TensorCore` | `m*n >= 1M` and all dims `% 16 == 0` | selected, but executes the shared-memory path |

`select_strategy(m, n, k)` returns the enum, `strategy_name` its label, and
`gemm_dispatch` runs it. All paths agree exactly on representable inputs.

## Concepts Covered

- GEMM as the core transformer primitive (tokens x d_model x d_ff)
- Choosing a compute path by problem size and tile alignment
- SIMD inner product with remainder-lane handling
- Tiled shared-memory GEMM formulation

## Files

- `main.spl` - strategies, dispatcher, kernel formulation
- `spec.spl` - Tests for selection and for agreement between paths

## Status
`gpu_gemm` runs the CPU fallback on this seed (`src/lib/gc_async_mut/gpu_ops.spl`),
so results are exact. There is no tensor-core / f16 (WMMA) API in `std.gpu`,
so the `TensorCore` strategy is honest about running the shared-memory path -
the original's `[f16]` inputs and `tensor_mma` are not reproduced.

## Run
```bash
bin/simple run examples/08_gpu/simple_cuda_example/80.transformer/81.Core_GEMM/main.spl
bin/simple test examples/08_gpu/simple_cuda_example/80.transformer/81.Core_GEMM/spec.spl
```

## Try it (verified doctest)
```sdoctest
>>> use std.gpu.*
>>> fn pick(m: i64, n: i64) -> text:
...     if m * n <= 64 * 64: "simd" else: "shared_memory"
>>> print "32x32 -> {pick(32, 32)}, 256x256 -> {pick(256, 256)}"
32x32 -> simd, 256x256 -> shared_memory
>>> val c = gpu_gemm([1.0, 2.0, 3.0, 4.0, 5.0, 6.0], [7.0, 8.0, 9.0, 10.0, 11.0, 12.0], 2, 2, 3).unwrap()
>>> print "C = [{c[0]}, {c[1]}; {c[2]}, {c[3]}]"
C = [58.0, 64.0; 139.0, 154.0]
>>> if pick(32, 32) != "simd" or c[3] != 154.0: panic("GEMM dispatch drifted")
```
