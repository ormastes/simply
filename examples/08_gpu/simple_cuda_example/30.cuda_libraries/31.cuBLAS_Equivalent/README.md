# GPU BLAS Operations

**Tier:** 2 (Concept Adaptation)
**Original CUDA Concept:** cuBLAS library for linear algebra on GPU

## Simple Approach

Instead of wrapping cuBLAS, Simple provides GPU-accelerated linear algebra through
native kernels and the `std.gpu` module. Matrix operations are expressed as kernel
launches with familiar mathematical notation.

Key differences from cuBLAS:
- **No opaque handles:** No `cublasCreate()`/`cublasDestroy()` lifecycle
- **Direct kernel launch:** Write or use built-in GEMM kernels directly
- **Dimensions are plain arguments:** `gpu_gemm(a, b, m, n, k)` on flat row-major `[f32]`
- **Error handling:** `Result<T, GpuError>` instead of `cublasStatus_t`

## Concepts Covered

- GPU matrix multiplication (GEMM)
- GPU vector dot product
- GPU vector scaling (AXPY)
- Shared memory tiling for performance

## Files

- `main.spl` - BLAS operations: GEMM, dot product, AXPY
- `spec.spl` - Tests for correctness of GPU linear algebra

## Status
`gpu_gemm` / `gpu_dot` / `gpu_axpy` are exported by `std.gpu` and currently run
a CPU fallback (see `src/lib/gc_async_mut/gpu_ops.spl`), so results are exact
and deterministic; the tiled `gemm_kernel` in `main.spl` is the device-side
formulation they will dispatch to.

## Run
```bash
bin/simple run examples/08_gpu/simple_cuda_example/30.cuda_libraries/31.cuBLAS_Equivalent/main.spl
bin/simple test examples/08_gpu/simple_cuda_example/30.cuda_libraries/31.cuBLAS_Equivalent/spec.spl
```

## Try it (verified doctest)
```sdoctest
>>> use std.gpu.*
>>> val c = gpu_gemm([1.0, 2.0, 3.0, 4.0, 5.0, 6.0], [7.0, 8.0, 9.0, 10.0, 11.0, 12.0], 2, 2, 3).unwrap()
>>> print "C = [{c[0]}, {c[1]}; {c[2]}, {c[3]}]"
C = [58.0, 64.0; 139.0, 154.0]
>>> print "dot = {gpu_dot([1.0, 2.0, 3.0, 4.0], [5.0, 6.0, 7.0, 8.0]).unwrap()}"
dot = 70.0
>>> val y2 = gpu_axpy(2.0, [1.0, 2.0], [10.0, 20.0]).unwrap()
>>> print "axpy = [{y2[0]}, {y2[1]}]"
axpy = [12.0, 24.0]
>>> if c[3] != 154.0 or y2[1] != 24.0: panic("BLAS helpers drifted")
```
