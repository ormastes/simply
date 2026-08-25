# Exercise 18: Thread Hierarchy

## GPU Thread Organization

CUDA organizes threads into a two-level hierarchy: **grids** of **blocks**.
Simple exposes the same model through built-in intrinsics.

### Hierarchy

```
Grid (all blocks)
 +-- Block (0,0)     Block (1,0)     Block (2,0)
 |    +-- Thread 0    +-- Thread 0    +-- Thread 0
 |    +-- Thread 1    +-- Thread 1    +-- Thread 1
 |    +-- ...         +-- ...         +-- ...
 +-- Block (0,1)     Block (1,1)     Block (2,1)
      +-- Thread 0    +-- Thread 0    +-- Thread 0
      ...             ...             ...
```

### Simple Intrinsics

| Simple | CUDA | Description |
|--------|------|-------------|
| `gpu_block_id_x()` | `blockIdx.x` | Block index in grid (x) |
| `gpu_block_id_y()` | `blockIdx.y` | Block index in grid (y) |
| `gpu_block_dim_x()` | `blockDim.x` | Threads per block (x) |
| `gpu_block_dim_y()` | `blockDim.y` | Threads per block (y) |
| `gpu_local_id_x()` | `threadIdx.x` | Thread index in block (x) |
| `gpu_local_id_y()` | `threadIdx.y` | Thread index in block (y) |
| `gpu_grid_dim_x()` | `gridDim.x` | Blocks per grid (x) |
| `gpu_grid_dim_y()` | `gridDim.y` | Blocks per grid (y) |

### Global Thread ID Calculation

```simple
val global_x = gpu_block_id_x() * gpu_block_dim_x() + gpu_local_id_x()
val global_y = gpu_block_id_y() * gpu_block_dim_y() + gpu_local_id_y()
```

### Launch Configuration

```simple
# 1D launch: N elements with 256 threads per block
val block = (256, 1, 1)
val grid = ((n + 255) / 256, 1, 1)
kernel<<<grid: grid, block: block>>>(args)

# 2D launch: NxM matrix with 16x16 thread blocks
val block = (16, 16, 1)
val grid = ((cols + 15) / 16, (rows + 15) / 16, 1)
kernel<<<grid: grid, block: block>>>(args)
```

### Choosing Block Size

- Must be a multiple of warp size (32) for full utilization
- Common choices: 128, 256, 512 threads per block
- Max 1024 threads per block on most hardware
- 2D blocks: 16x16=256 or 32x32=1024

## Files

- `main.spl` - Multiple kernel variants with different grid/block configurations
- `spec.spl` - Tests verifying all configurations produce correct results

## Learning Goals

- Map thread IDs to data indices
- Choose appropriate block and grid dimensions
- Handle boundary conditions when data size is not a multiple of block size
- Understand 1D vs 2D thread layouts

## Run
```bash
bin/simple run examples/08_gpu/simple_cuda_example/10.cuda_basic/18.Thread_Hierarchy/main.spl
bin/simple test examples/08_gpu/simple_cuda_example/10.cuda_basic/18.Thread_Hierarchy/spec.spl
```

## Try it (verified doctest)
`cpu_kernel_run_1d(total, block_size, kernel)` executes a kernel-shaped
function once per work-item on the CPU, driving `gpu_block_id_x()` /
`gpu_local_id_x()` / `gpu_grid_dim_x()` exactly like a real launch, and
returns how many items ran. 1000 elements in blocks of 256 run 1000 times
across 4 blocks - the tail of the last block is skipped:

```sdoctest
>>> use std.gpu.*
>>> fn probe():
...     pass_dn
>>> val ran = cpu_kernel_run_1d(1000, 256, probe)
>>> print "{ran} work-items over {(1000 + 255) / 256} blocks"
1000 work-items over 4 blocks
>>> val stride_passes = (4096 + 1023) / 1024
>>> print "grid-stride: 1024 threads cover 4096 elements in {stride_passes} passes"
grid-stride: 1024 threads cover 4096 elements in 4 passes
>>> if ran != 1000 or stride_passes != 4: panic("thread accounting drifted")
```
