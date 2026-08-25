# Dynamic Parallelism

**Tier:** 3 (Skip)
**Status:** Not applicable to Simple

## Why Skipped

Dynamic parallelism is a CUDA-specific hardware feature that allows GPU kernels to
launch child kernels directly from the device. This is tightly coupled to NVIDIA's
GPU execution model and has no direct equivalent in Simple's GPU abstraction.

In Simple, equivalent functionality is achieved through:
- **Host-side dispatch:** The CPU orchestrates kernel launches based on data-dependent decisions
- **Persistent kernels:** Long-running kernels with work queues instead of recursive launches
- **Compute graphs:** Pre-built execution graphs that handle dynamic workloads

## Original CUDA Exercise

See the original CUDA dynamic parallelism exercise for the NVIDIA-specific implementation
using `cudaLaunchDevice()` from within device code.

**Reference:** [NVIDIA CUDA Dynamic Parallelism](https://docs.nvidia.com/cuda/cuda-c-programming-guide/index.html#cuda-dynamic-parallelism)

## Doctest: what a child launch computes, on the CPU

There is no Simple equivalent of a kernel launching a kernel, so the
runnable part of this exercise is the *result* dynamic parallelism produces:
a parent grid over `n` elements that, wherever it finds a positive value,
would launch a child grid to fill that many slots. On the host that is a
parent loop plus a nested "child" loop, and the total work count is what a
device-side launch would have to match:

```sdoctest
>>> fn child_kernel(out: [i64], base: i64, count: i64) -> [i64]:
...     var o = out
...     for i in 0..count:
...         o.push(base + i)
...     o
>>> fn parent_kernel(work: [i64]) -> [i64]:
...     var out: [i64] = []
...     var base = 0
...     for w in work:
...         if w > 0:
...             out = child_kernel(out, base, w)
...         base = base + w
...     out
>>> val launched = parent_kernel([2, 0, 3, 1])
>>> print launched
[0, 1, 2, 3, 4, 5]
>>> assert launched.len() == 6 and launched[5] == 5
```
