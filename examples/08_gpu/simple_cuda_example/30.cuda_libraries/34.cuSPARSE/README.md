# cuSPARSE

**Tier:** 3 (Skip)
**Status:** Not applicable to Simple

## Why Skipped

cuSPARSE is an NVIDIA proprietary library for sparse matrix operations on GPU. It is
a closed-source, hardware-specific library that cannot be meaningfully translated to
Simple's GPU abstraction.

For sparse matrix operations in Simple, consider:
- **CSR format:** Implement Compressed Sparse Row format with custom `@gpu_kernel` SpMV
- **Dense fallback:** For small-to-medium matrices, dense operations may be sufficient
- **Vendor sparse:** Use Simple's FFI to call platform-appropriate sparse libraries

## Original CUDA Exercise

See the original cuSPARSE exercise for the NVIDIA-specific implementation using
`cusparseCreate()`, `cusparseSpMV()`, etc.

**Reference:** [NVIDIA cuSPARSE Documentation](https://docs.nvidia.com/cuda/cusparse/index.html)

## Simple Equivalent (status 2026-08-25)
**Not available.** No sparse (CSR/COO) matrix type or SpMV exists in `std.*`,
and no cuSPARSE SFFI binding. Dense fallback: `gpu_gemm(a, b, m, n, k)` from
`std.gpu` (module 31) on a densified matrix.

## Try it (verified doctest)
CSR construction on the CPU: count the non-zeros of a 3x3 matrix and build
`row_ptr` (what `cusparseXcoo2csr` would produce):

```sdoctest
>>> val dense = [5.0, 0.0, 0.0, 0.0, 8.0, 3.0, 0.0, 0.0, 6.0]
>>> var row_ptr = [0]
>>> var nnz = 0
>>> for r in 0..3:
...     for c in 0..3:
...         if dense[r * 3 + c] != 0.0:
...             nnz = nnz + 1
...     row_ptr.push(nnz)
>>> print "nnz={nnz} row_ptr={row_ptr}"
nnz=4 row_ptr=[0, 1, 3, 4]
>>> if nnz != 4 or row_ptr[2] != 3: panic("CSR bookkeeping drifted")
```
