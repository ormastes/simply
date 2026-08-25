# Parallel Iterators (Thrust Equivalent)

**Tier:** 2 (Concept Adaptation)
**Original CUDA Concept:** Thrust library for parallel algorithms (transform, reduce, scan)

## Simple Approach

Simple replaces Thrust's C++ template-based parallel iterators with first-class
functional patterns that dispatch to GPU kernels. Operations like `map`, `reduce`,
and `scan` are expressed using lambdas and placeholder syntax (`_ * 2`), with the
GPU backend handling parallelization transparently.

Key differences from Thrust:
- **No iterator pairs:** Use array/slice directly, not `begin()`/`end()`
- **Lambda syntax:** `\x: x * 2` or `_ * 2` instead of C++ functors
- **Composition:** every stage returns `Result`, so chain with `?`: `val s = gpu_map(d, _ * 2)?` then `gpu_reduce(s, 0.0, _ + _)`
- **No execution policy:** no `thrust::device`; the helpers currently run a CPU fallback (`src/lib/gc_async_mut/gpu_ops.spl`)

## Concepts Covered

- `gpu_map` - parallel transform
- `gpu_reduce` - parallel reduction
- `gpu_scan` - inclusive prefix sum
- `gpu_filter` - parallel compaction
- `gpu_sort` - parallel sort
- Composition by unwrapping each stage with `?`

## Files

- `main.spl` - Parallel iterator operations with GPU backing
- `spec.spl` - Tests for parallel operations

## Run
```bash
bin/simple run examples/08_gpu/simple_cuda_example/30.cuda_libraries/35.Parallel_Iterators/main.spl
bin/simple test examples/08_gpu/simple_cuda_example/30.cuda_libraries/35.Parallel_Iterators/spec.spl
```

## Try it (verified doctest)
```sdoctest
>>> use std.gpu.*
>>> val squared = gpu_map([1.0, 2.0, 3.0, 4.0, 5.0], _ ** 2).unwrap()
>>> print "{squared}"
[1.0, 4.0, 9.0, 16.0, 25.0]
>>> val large = gpu_filter(squared, _ > 10.0).unwrap()
>>> val total = gpu_reduce(large, 0.0, _ + _).unwrap()
>>> print "sum of squares > 10: {total}"
sum of squares > 10: 41.0
>>> print "{gpu_scan([1.0, 2.0, 3.0, 4.0], 0.0, _ + _).unwrap()}"
[1.0, 3.0, 6.0, 10.0]
>>> if total != 41.0 or large.len() != 2: panic("iterator helpers drifted")
```
