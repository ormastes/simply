# Exercise 24: Memory Coalescing

## What is Memory Coalescing?

GPU global memory is accessed in large transactions (32, 64, or 128 bytes).
When consecutive threads access consecutive memory addresses, the hardware
can combine (coalesce) their requests into a single transaction. When
threads access scattered addresses, each thread may trigger a separate
transaction, wasting bandwidth.

### Coalesced vs Strided Access

**Coalesced (good):** Thread i reads element i.
```
Thread 0 -> addr[0]
Thread 1 -> addr[1]
Thread 2 -> addr[2]
...
```
One memory transaction serves all 32 threads in a warp.

**Strided (bad):** Thread i reads element i*stride.
```
Thread 0 -> addr[0]
Thread 1 -> addr[stride]
Thread 2 -> addr[2*stride]
...
```
Up to 32 separate memory transactions for one warp.

### Row-Major vs Column-Major

For an MxN matrix stored row-major:
- **Column sum (coalesced):** thread `j` walks `data[r * N + j]` — at every
  step the warp's 32 threads read 32 adjacent floats of one row.
- **Row sum (strided):** thread `r` walks `data[r * N + c]` — neighbouring
  threads are `N` floats apart, so each step touches up to 32 lines.
- **Transpose:** a 2D grid of `TILE x TILE` blocks converts the column
  access into a row access.

### Performance Impact

Coalesced access can be 10-20x faster than fully strided access. The
difference is most visible with large strides that exceed cache line
boundaries. Both kernels here produce the same numbers — the example is
about *how* the warp reaches memory, which the correctness tests cannot
see; `nsys`/`ncu` show the transaction counts.

## How it runs in Simple

The four kernels (`column_sum_coalesced`, `row_sum_strided`,
`transpose_kernel`, `scale_coalesced`) are hand-written PTX launched through
`std.cuda` via `../gpu_test_helpers.spl`. The CPU references are plain
scalar loops: the upstream `@simd` / `Vec4f` / `Vec8f` comparison was
dropped because this stdlib does not provide `std.simd`.

## Doctest: the index math on the CPU

Which element a thread reads is pure integer arithmetic. For a 3x4 row-major
matrix the coalesced column sum and the strided row sum are:

```sdoctest
>>> fn column_sum(data: [i64], rows: i64, cols: i64) -> [i64]:
...     var out: [i64] = []
...     for c in 0..cols:
...         var s = 0
...         for r in 0..rows:
...             s = s + data[r * cols + c]
...         out.push(s)
...     out
>>> fn transpose(data: [i64], rows: i64, cols: i64) -> [i64]:
...     var out: [i64] = []
...     for c in 0..cols:
...         for r in 0..rows:
...             out.push(data[r * cols + c])
...     out
>>> val m = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
>>> val cs = column_sum(m, 3, 4)
>>> print cs
[12, 15, 18, 21]
>>> val t = transpose(m, 3, 4)
>>> print t
[0, 4, 8, 1, 5, 9, 2, 6, 10, 3, 7, 11]
>>> print (128 + 16 - 1) / 16
8
>>> assert cs[0] == 12 and cs[3] == 21 and t[1] == 4 and t[3] == 1 and (128 + 16 - 1) / 16 == 8
```

(The `assert` keeps the block fail-closed: the seed's md doctest runner only
checks that a block exits 0 and does not compare printed output.)

## Files

- `main.spl` - Coalesced column sum vs strided row sum, tiled transpose, contiguous scale
- `spec.spl` - CPU-reference checks plus device runs of all four kernels

## Learning Goals

- Understand memory coalescing and why it matters
- Compare coalesced vs strided access patterns
- Transpose a matrix to convert column access to row access
