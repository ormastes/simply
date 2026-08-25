# Cooperative Groups

**Tier:** 3 (Skip)
**Status:** Not applicable to Simple

## Why Skipped

Cooperative groups are a CUDA-specific feature for flexible thread synchronization
beyond the traditional block-level `__syncthreads()`. This includes grid-level
synchronization, warp-level primitives, and dynamic group partitioning, all of which
are tightly coupled to NVIDIA's warp execution model.

In Simple, equivalent functionality is achieved through:
- **`sync_threads()`:** Block-level synchronization in `@gpu_kernel` functions
- **Atomic operations:** `atomic_add`, `atomic_cas` for inter-block coordination
- **Multi-kernel dispatch:** Separate kernel launches with device synchronization between them

## Original CUDA Exercise

See the original CUDA cooperative groups exercise for the NVIDIA-specific implementation
using `cooperative_groups::this_grid()`, `tiled_partition()`, and `grid_group::sync()`.

**Reference:** [NVIDIA Cooperative Groups](https://docs.nvidia.com/cuda/cuda-c-programming-guide/index.html#cooperative-groups)

## Doctest: a grid-wide reduction, on the CPU

There is no Simple equivalent of `grid_group::sync()`, so the runnable part
of this exercise is the *result* a grid-synchronised reduction produces:
every block reduces its tile, the whole grid synchronises, then block 0 sums
the partials. On the host the two phases are two loops with a barrier in
between; a multi-kernel version in Simple would put a `cuda_sync()` there:

```sdoctest
>>> fn block_partials(data: [i64], block: i64) -> [i64]:
...     var partials: [i64] = []
...     var i = 0
...     while i < data.len():
...         var s = 0
...         for j in i..(i + block):
...             if j < data.len():
...                 s = s + data[j]
...         partials.push(s)
...         i = i + block
...     partials
>>> fn grid_reduce(data: [i64], block: i64) -> i64:
...     val partials = block_partials(data, block)
...     var total = 0
...     for p in partials:
...         total = total + p
...     total
>>> val data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
>>> print block_partials(data, 4)
[10, 26, 19]
>>> val total = grid_reduce(data, 4)
>>> print total
55
>>> assert total == 55 and block_partials(data, 4).len() == 3
```
