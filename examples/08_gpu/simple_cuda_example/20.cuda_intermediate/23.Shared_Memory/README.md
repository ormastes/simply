# Exercise 23: Shared Memory - Parallel Reduction

## Shared Memory in Simple vs CUDA

Shared memory is a small, fast, per-block scratchpad. The classic use is a
tree reduction: each block loads a tile into shared memory, halves the number
of active threads each step, and writes one partial sum. This module ports
`reduction.cu` from `cuda_exercise/20.cuda_intermediate/23.Shared_Memory`
and runs all three variants on a real CUDA device.

| Kernel | CUDA idiom | Cost |
|--------|-----------|------|
| `reduce_naive` | `if (tid % (2*s) == 0) sh[tid] += sh[tid+s]` | divergent warps, bank conflicts |
| `reduce_sequential` | `if (tid < s) sh[tid] += sh[tid+s]` | no intra-warp divergence until s < 32 |
| `reduce_optimized` | first add during global load, half the blocks | halves global reads per block |

Each kernel writes `output[blockIdx.x]`; the host sums the partials.

### Why the kernels are PTX

On the deployed Rust seed `@gpu_kernel` + `kernel<<<grid:, block:>>>(...)` is
a no-op in the interpreter and `std.gpu`'s `gpu_shared_array_f32` /
`gpu_syncthreads` are CPU stubs, so nothing would actually reduce on the
device. The kernels are therefore written directly as PTX (`.shared .align 4
.b8 sh[1024]`, `bar.sync 0`) and launched through `std.cuda`; see
`lib/gpu_test_helpers.spl`.

| Concept | CUDA | PTX used here |
|---------|------|---------------|
| Static shared array | `__shared__ float sh[256]` | `.shared .align 4 .b8 sh[1024]` |
| Barrier | `__syncthreads()` | `bar.sync 0` |
| Thread / block ids | `threadIdx.x`, `blockIdx.x`, `blockDim.x` | `%tid.x`, `%ctaid.x`, `%ntid.x` |

## Files

- `main.spl` - Three reduction kernels + host driver and CPU reference
- `spec.spl` - Device tests, including non-block-multiple sizes and an empty input

## Running

```bash
SIMPLE_EXECUTION_MODE=interpreter bin/simple run examples/08_gpu/simple_cuda_example/20.cuda_intermediate/23.Shared_Memory/main.spl
bin/simple test examples/08_gpu/simple_cuda_example/20.cuda_intermediate/23.Shared_Memory/spec.spl
```

`main.spl` reduces 65,536 elements: the interpreter marshals every host
element byte by byte, and the seed's 10 s per-run watchdog trips at 1M.

## Doctest: the reduction tree on the CPU

Sequential addressing shrinks the active range by half each step; this is the
exact loop the `reduce_sequential` kernel runs on 256 threads, here on 8
values:

```sdoctest
>>> fn reduce_sequential_cpu(input: [f64]) -> f64:
...     var sh = input
...     var s = sh.len() / 2
...     while s > 0:
...         for tid in 0..s:
...             sh[tid] = sh[tid] + sh[tid + s]
...         s = s / 2
...     sh[0]
>>> val total = reduce_sequential_cpu([1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0])
>>> print total
36.0
>>> print (65536 + 255) / 256
256
>>> assert total == 36.0 and (65536 + 255) / 256 == 256
```

(The `assert` keeps the block fail-closed: the seed's md doctest runner only
checks that a block exits 0 and does not compare printed output.)

## Learning Goals

- Stage a tile in shared memory and reduce it with a barrier between steps
- Recognise why interleaved addressing diverges and sequential addressing does not
- Fold the first addition into the global load to halve the block count
- Combine per-block partials on the host (or with an atomic, see exercise 21)
