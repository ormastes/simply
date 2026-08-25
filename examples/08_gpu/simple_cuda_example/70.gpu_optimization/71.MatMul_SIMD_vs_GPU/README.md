# Matrix Multiply: SIMD vs GPU

**Tier:** 2 (Concept Adaptation)
**Original CUDA Concept:** GPU matrix multiply optimization (71.MatMul_CPU_PyCUDA)

## Simple Approach

This exercise compares three ways of multiplying matrices in Simple:
1. **Naive CPU:** plain triple loop - the reference everything is checked against
2. **SIMD (CPU):** `std.simd` `Vec4f`/`Vec8f` lanes along the `k` dimension
   (`simd_mul_f32x4`/`simd_add_f32x4`, plus a transposed B for contiguous 8-wide loads)
3. **GPU kernel:** `@gpu_kernel` tiled shared-memory matmul, launched through `gpu_gemm`

Key features:
- **SIMD types:** `Vec4f`, `Vec8f` built with `from_array`, reduced with `to_array`
- **GPU shared memory:** `gpu_shared_array_f32` tiles with `gpu_syncthreads`
- **One contract:** every path takes flat row-major `[f32]` plus `m, n, k`

## Concepts Covered

- SIMD vectorized matrix multiplication with remainder-lane handling
- GPU tiled matrix multiplication with shared memory
- Grid sizing in `TILE_SIZE` blocks (`blocks_for`)
- Cross-checking implementations against a reference (`max_abs_diff`)

## Files

- `main.spl` - naive, SIMD and GPU matmul implementations
- `spec.spl` - Tests verifying all paths agree

## Status
`gpu_gemm` is exported by `std.gpu` and currently runs a CPU fallback on this
seed (see `src/lib/gc_async_mut/gpu_ops.spl`), so its result is exact and
deterministic; the tiled `matmul_gpu_kernel` in `main.spl` is the device-side
formulation it will dispatch to. Timings are not printed - the verified claim
is agreement, not speed. Note: `std.simd` lane ops reject `Float32` values
(`as f32`), so inputs are built as plain floats.

## Run
```bash
bin/simple run examples/08_gpu/simple_cuda_example/70.gpu_optimization/71.MatMul_SIMD_vs_GPU/main.spl
bin/simple test examples/08_gpu/simple_cuda_example/70.gpu_optimization/71.MatMul_SIMD_vs_GPU/spec.spl
```

## Try it (verified doctest)
```sdoctest
>>> use std.gpu.*
>>> use std.simd.{Vec4f, simd_mul_f32x4}
>>> val lanes = simd_mul_f32x4(Vec4f.from_array([1.0, 2.0, 3.0, 4.0]), Vec4f.from_array([5.0, 6.0, 7.0, 8.0])).to_array()
>>> print "lanes = [{lanes[0]}, {lanes[1]}, {lanes[2]}, {lanes[3]}]"
lanes = [5.0, 12.0, 21.0, 32.0]
>>> val c = gpu_gemm([1.0, 2.0, 3.0, 4.0], [5.0, 6.0, 7.0, 8.0], 2, 2, 2).unwrap()
>>> print "C = [{c[0]}, {c[1]}; {c[2]}, {c[3]}]"
C = [19.0, 22.0; 43.0, 50.0]
>>> if lanes[3] != 32.0 or c[3] != 50.0: panic("matmul paths drifted")
```
