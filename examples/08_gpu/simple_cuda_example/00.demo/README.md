# 00. Demo - Hello GPU

## Concept
Introduction to GPU programming in Simple. Demonstrates device detection and a minimal kernel launch.

## C/CUDA vs Simple
| C/CUDA | Simple |
|--------|--------|
| `__global__ void kernel()` | `@gpu_kernel fn kernel():` |
| `kernel<<<1, 1>>>()` | `kernel<<<grid: (1,1,1), block: (1,1,1)>>>()` |
| `cuInit(0)` | `gpu_init()` (call it FIRST - device queries report 0 before init) |
| `cudaGetDeviceCount(&count)` | `gpu_device_count()` |
| `cudaSetDevice(0)` | `gpu_set_device(0)` (creates the context) |
| `cudaDeviceSynchronize()` | `gpu_sync()` |

Every host call returns `Result<_, GpuError>`; `main` matches on it and prints
`GpuError.to_text()` instead of propagating with `?` (a `main` that returns
`Result` cannot be turned into a process exit code).

## Run
```bash
bin/simple run examples/08_gpu/simple_cuda_example/00.demo/main.spl
bin/simple test examples/08_gpu/simple_cuda_example/00.demo/spec.spl
```

## Try it (verified doctest)
A launch of `grid: (1,1,1), block: (1,1,1)` runs exactly one thread; the
CPU emulator `cpu_kernel_run_1d(total, block_size, kernel)` reports how many
work-items a launch shape executes (tail items past `total` are skipped, so
6 items in blocks of 4 still run 6 times over 2 blocks):

```sdoctest
>>> use std.gc_async_mut.gpu_ops.{cpu_kernel_run_1d}
>>> fn noop():
...     pass_dn
>>> val one = cpu_kernel_run_1d(1, 1, noop)
>>> print "{one}"
1
>>> val six = cpu_kernel_run_1d(6, 4, noop)
>>> print "{six} items over {(6 + 4 - 1) / 4} blocks"
6 items over 2 blocks
>>> assert one == 1 and six == 6
```
