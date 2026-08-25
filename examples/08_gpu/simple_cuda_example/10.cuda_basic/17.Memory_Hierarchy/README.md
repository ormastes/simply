# Exercise 17: Memory Hierarchy

## CUDA Memory Model vs Simple GPU API

CUDA exposes a multi-level memory hierarchy. Simple wraps these with safe,
typed APIs that prevent common errors like uninitialized shared memory or
out-of-bounds global accesses.

### Memory Levels

| Level | CUDA | Simple | Scope | Latency |
|-------|------|--------|-------|---------|
| **Registers** | `int x = 0;` | `val x = 0` | Per-thread | ~1 cycle |
| **Shared** | `__shared__ float s[N];` | `gpu_shared_array_f32(N)` + `gpu_shared_load_f32` / `gpu_shared_store_f32` | Per-block | ~5 cycles |
| **Global** | `float* d; cudaMalloc(&d, N);` | `gpu_alloc(N * 4)` -> `GpuPtr`, `gpu_load_f32` / `gpu_store_f32` | All threads | ~400-600 cycles |
| **Constant** | `__constant__ float c[N];` | (not exposed by std.gpu; use a kernel argument or a read-only global buffer) | All threads (cached) | ~5 cycles (cached) |

### Key Differences from CUDA C

1. **Shared memory is a handle, sized at call site:**
   CUDA uses `__shared__` declarations; Simple uses `gpu_shared_array_f32(count)`
   and reads/writes it through `gpu_shared_load_f32` / `gpu_shared_store_f32`.

2. **Untyped device pointers:** device memory is a `GpuPtr` (bytes + validity);
   the element type lives in the typed accessors (`gpu_upload_f32`,
   `gpu_download_f32`, `gpu_load_f32`, `gpu_store_f32`).

3. **Explicit sync:** `gpu_syncthreads()` is required before reading shared memory
   written by other threads, same as `__syncthreads()` in CUDA.

4. **Result-based errors:** Memory allocation returns `Result<GpuPtr, GpuError>`
   instead of error codes.

### Tiling Pattern for Shared Memory

The core optimization pattern:

```
For each tile of the output:
  1. Load tile from global -> shared memory
  2. gpu_syncthreads()
  3. Compute on shared memory (fast)
  4. gpu_syncthreads()
  5. Write result back to global
```

This reduces global memory accesses from O(N) to O(N / TILE_SIZE) per thread.

## Files

- `main.spl` - Matrix multiplication: naive vs shared-memory tiled
- `spec.spl` - Correctness tests comparing both variants

## Learning Goals

- Understand the GPU memory hierarchy
- Use `gpu_shared_array_f32()` for block-local fast memory
- Apply the tiling pattern to reduce global memory traffic
- Use `gpu_syncthreads()` correctly to avoid race conditions

## Run
```bash
bin/simple run examples/08_gpu/simple_cuda_example/10.cuda_basic/17.Memory_Hierarchy/main.spl
bin/simple test examples/08_gpu/simple_cuda_example/10.cuda_basic/17.Memory_Hierarchy/spec.spl
```

## Try it (verified doctest)
Tile bookkeeping on the CPU: a 20x20 matrix needs 2x2 tiles of 16, and the
flat shared-memory index of tile cell (ty=1, tx=3) is `1 * 16 + 3`:

```sdoctest
>>> val tile = 16
>>> val n = 20
>>> val tiles = (n + tile - 1) / tile
>>> print "{tiles}x{tiles} tiles, {tiles * tile - n} padding rows"
2x2 tiles, 12 padding rows
>>> print "shared index of (ty 1, tx 3) = {1 * tile + 3}"
shared index of (ty 1, tx 3) = 19
>>> if tiles != 2 or 1 * tile + 3 != 19: panic("tile arithmetic drifted")
```
