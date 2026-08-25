# 11. Foundations - GPU Architecture Concepts

## Concept

This section provides foundational understanding of GPU architecture.
The only code is a device query (`main.spl`): initialise the driver, count
the devices, print name and compute capability -- the `deviceQuery` sample.

## GPU vs CPU

| Property            | CPU                     | GPU                          |
|---------------------|-------------------------|------------------------------|
| Cores               | 4-128 (complex)         | 1,000-16,000+ (simple)       |
| Clock speed         | 3-6 GHz                 | 1-2 GHz                      |
| Cache per core      | Large (MB)              | Small (KB)                   |
| Optimised for       | Latency (single thread) | Throughput (many threads)     |
| Control flow        | Complex branching        | SIMT (Single Instruction, Multiple Threads) |

## CUDA Execution Model

```
Grid
 +-- Block (0,0)   Block (1,0)   Block (2,0)
 |    +-- Thread 0   Thread 0      Thread 0
 |    +-- Thread 1   Thread 1      Thread 1
 |    +-- ...        ...           ...
 |    +-- Thread N   Thread N      Thread N
 +-- Block (0,1)   Block (1,1)   Block (2,1)
      ...
```

- **Grid**: Collection of thread blocks launched by a single kernel call.
- **Block**: Group of threads that can cooperate via shared memory and synchronisation barriers.
- **Thread**: Smallest unit of execution. Each thread has a unique ID within its block and the grid.

## Memory Hierarchy

| Memory          | Scope            | Speed   | Size      |
|-----------------|------------------|---------|-----------|
| Registers       | Per thread       | Fastest | ~256 KB per SM |
| Shared memory   | Per block        | Fast    | 48-228 KB per SM |
| L1 / L2 cache   | Per SM / device  | Medium  | MB range  |
| Global memory   | All threads      | Slow    | GB range (VRAM) |
| Host memory     | CPU only         | Slowest | System RAM |

## Simple Language Mapping

| CUDA C concept                | Simple equivalent               |
|-------------------------------|---------------------------------|
| `__global__ void fn()`        | `@gpu_kernel fn name():`        |
| `__device__ void fn()`        | `@gpu_device fn name():`        |
| `threadIdx.x`                 | `gpu_local_id_x()`              |
| `blockIdx.x`                  | `gpu_block_id_x()`              |
| `blockDim.x`                  | `gpu_block_dim_x()`             |
| `gridDim.x`                   | `gpu_grid_dim_x()`              |
| `__shared__ float s[N]`       | `val s = gpu_shared_array_f32(N)` (+ `gpu_shared_load_f32` / `gpu_shared_store_f32`) |
| `__syncthreads()`             | `gpu_barrier()` / `gpu_syncthreads()` |
| `atomicAdd(&x[i], v)`         | `gpu_atomic_add_i32(x, i, v)`    |
| `kernel<<<grid, block>>>()`   | `kernel<<<grid: (gx,gy,gz), block: (bx,by,bz)>>>()` |

## Run
```bash
bin/simple run examples/08_gpu/simple_cuda_example/10.cuda_basic/11.Foundations/main.spl
bin/simple test examples/08_gpu/simple_cuda_example/10.cuda_basic/11.Foundations/spec.spl
```

`std.cuda` exposes the driver API as plain status words and `i64` handles:
`cuda_init()` first (like `cuInit`), then `cuda_device_count()`,
`cuda_device_get(i)`, `cuda_device_name(handle)` and
`cuda_device_compute_capability(handle)` (packed as `major * 10 + minor`).

## Try it (verified doctest)
The grid/block arithmetic every later module uses, with no device needed:

```sdoctest
>>> val n = 1000
>>> val block = 256
>>> val grid = (n + block - 1) / block
>>> print "{grid} blocks x {block} threads = {grid * block} slots for {n} elements"
4 blocks x 256 threads = 1024 slots for 1000 elements
>>> val packed = 86
>>> print "sm_{packed / 10}{packed % 10}"
sm_86
>>> if grid != 4 or grid * block < n: panic("grid does not cover the input")
```

## Key Principles

1. **Parallelism**: Thousands of threads execute the same kernel simultaneously.
2. **Data parallelism**: Each thread operates on a different element of data.
3. **Coalesced access**: Adjacent threads should access adjacent memory addresses.
4. **Occupancy**: Keep the GPU busy by launching enough threads to hide memory latency.
5. **Divergence**: Avoid branches where threads in the same warp take different paths.

## Further Reading

- `12.First_Kernel/` -- Your first kernel: vector addition with 2D grid/block
- `15.Unit_Testing/` -- SSpec-based GPU test patterns
- `16.Error_Handling/` -- `Result<T, GpuError>` error propagation
