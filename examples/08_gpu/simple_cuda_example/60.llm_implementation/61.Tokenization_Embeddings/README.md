# Tokenization and Embeddings

**Tier:** 2 (Concept Adaptation)
**Original CUDA Concept:** Token embedding lookup on GPU (`61.Foundation_Tokenization_Embeddings`)

## What this module does

Token IDs become dense vectors in two steps:

1. **Embedding gather** — `out[t, :] = table[ids[t], :]`, one thread per token.
2. **Positional encoding** — sinusoidal `pe[pos, 2i] = sin(pos / 10000^(2i/dim))`,
   `pe[pos, 2i+1] = cos(...)`, added row-wise.

`main.spl` runs a CPU reference model (the checked result) and then the same
gather as a `@gpu_kernel` through `std.gpu` (module 12 pattern). The GPU result
is compared against the CPU model and reported honestly: on the Rust seed a
`<<<>>>` launch is a no-op, so the demo prints a mismatch instead of a fake pass.

## Honest status

- Works: CPU embedding gather + positional encoding, `std.gpu` alloc/upload/download.
- Not in the current API: `std.ml` `Embedding` / `PositionalEncoding` layers and
  the `~>` layer-composition operator the original draft used. They are described
  here as the target shape only.

## CPU model (doctest)

```sdoctest
>>> fn lookup(ids: [i64], table: [f32], dim: i64) -> [f32]:
...     var out: [f32] = []
...     for t in 0..ids.len():
...         for d in 0..dim:
...             out.push(table[ids[t] * dim + d])
...     out
>>> val table: [f32] = [0.0, 0.0, 1.0, 1.0, 2.0, 2.0]
>>> val out = lookup([2, 0], table, 2)
>>> print "{out.len()} values, row0 = {out[0] as i64}, row1 = {out[2] as i64}"
4 values, row0 = 2, row1 = 0
>>> val grid = (1000 + 255) / 256
>>> print "grid for 1000 tokens: {grid}"
grid for 1000 tokens: 4
>>> assert out.len() == 4 and grid == 4
```

## Files

- `main.spl` - CPU embedding pipeline + `@gpu_kernel` gather demo
- `spec.spl` - CPU-reference tests (table, gather, positional encoding, geometry)
