# Tensor Core Operations

**Tier:** 2 (Concept Adaptation)
**Original CUDA Concept:** WMMA (Warp Matrix Multiply-Accumulate) API for tensor cores

## Simple Approach

**Honest status:** `std.gpu` exposes no tensor-core API - there is no
`TensorFragment`, `tensor_load`, `tensor_mma` and no `f16` element type in the
GPU helpers. The nearest facility is the tile-shaped f32 GEMM `gpu_gemm(a, b, m, n, k)`
(currently a CPU fallback). This module keeps the WMMA bookkeeping (16x16x16
fragments, one warp per output tile) and computes the products with `gpu_gemm`,
so the numbers match what a WMMA kernel produces on exactly-representable inputs,
without claiming tensor-core execution.

Key differences from CUDA WMMA:
- **No fragments:** flat row-major `[f32]` in, `[f32]` out
- **Dimensions are arguments:** `m, n, k` passed explicitly, no compile-time shape types
- **No layout flags:** row-major only
- **f32 throughout:** no `half` inputs; the f32 accumulator matches WMMA numerics

## Concepts Covered

- Tensor fragment loading and storing
- Matrix multiply-accumulate (MMA) on tensor cores
- Mixed-precision computation (f16 inputs, f32 accumulator)
- Tiled GEMM using tensor cores
- ML-oriented matrix operations

## Files

- `main.spl` - WMMA-shaped GEMM (fragment bookkeeping + `gpu_gemm`)
- `spec.spl` - Tests for fragment geometry and the tile-shaped GEMM

## Run
```bash
bin/simple run examples/08_gpu/simple_cuda_example/30.cuda_libraries/38.Tensor_Cores/main.spl
bin/simple test examples/08_gpu/simple_cuda_example/30.cuda_libraries/38.Tensor_Cores/spec.spl
```

## Try it (verified doctest)
Fragment arithmetic: a 32x256 output is 2x16 fragments of 16x16, one warp each.

```sdoctest
>>> use std.gpu.*
>>> val warps = ((32 + 15) / 16) * ((256 + 15) / 16)
>>> print "{warps} warps"
32 warps
>>> val c = gpu_gemm([1.0, 1.0, 1.0, 1.0], [2.0, 3.0, 4.0, 5.0], 2, 2, 2).unwrap()
>>> print "[{c[0]}, {c[1]}, {c[2]}, {c[3]}]"
[6.0, 8.0, 6.0, 8.0]
>>> if warps != 32 or c[1] != 8.0: panic("fragment GEMM drifted")
```
