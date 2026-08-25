# Transformer Blocks

**Tier:** 2 (Concept Adaptation)
**Original CUDA Concept:** Pre-norm decoder block: LayerNorm, GELU, residual, FFN (`63.Transformer_Blocks`)

## What this module does

```
h = x + Attention(LayerNorm(x))
y = h + FFN(LayerNorm(h))          FFN(z) = GELU(z W1 + b1) W2 + b2
```

`main.spl` runs the block as a CPU reference model (the checked result): a
per-row LayerNorm, the tanh-approximation GELU, residual adds, two linear
layers and a compact causal self-attention. The GELU kernel is then run as a
`@gpu_kernel` through `std.gpu` (module 12 pattern) and compared against the
CPU model, reported honestly: a `<<<>>>` launch is a no-op on the Rust seed, so
the demo prints MISMATCH instead of a fake pass.

## Honest status

- Works: CPU LayerNorm / GELU / residual / linear / block composition;
  `std.gpu` buffers and a 1D element-wise launch.
- Not in the current API: `std.ml` layer types (`Linear`, `LayerNorm`, `GELU`,
  `Residual`, `MultiHeadAttention`) and `~>` layer composition; block-wide
  LayerNorm reductions need `@shared` arrays, which `@gpu_kernel` lacks.

## CPU model (doctest)

```sdoctest
>>> fn layer_norm_row(xs: [f64]) -> [f64]:
...     var mean = 0.0
...     for x in xs:
...         mean = mean + x
...     mean = mean / (xs.len() as f64)
...     var variance = 0.0
...     for x in xs:
...         variance = variance + (x - mean) * (x - mean)
...     variance = variance / (xs.len() as f64)
...     val inv = 1.0 / (variance + 0.00001).sqrt()
...     var out: [f64] = []
...     for x in xs:
...         out.push((x - mean) * inv)
...     out
>>> fn gelu(x: f64) -> f64:
...     0.5 * x * (1.0 + (0.7978845608 * (x + 0.044715 * x * x * x)).tanh())
>>> val n = layer_norm_row([1.0, 3.0])
>>> print "normalised [1, 3] -> [{(n[0] - 0.5) as i64}, {(n[1] + 0.5) as i64}]"
normalised [1, 3] -> [-1, 1]
>>> print "gelu(0) = {gelu(0.0) as i64}, gelu(5) rounded = {(gelu(5.0) + 0.5) as i64}"
gelu(0) = 0, gelu(5) rounded = 5
>>> assert (n[0] - 0.5) as i64 == -1 and (gelu(5.0) + 0.5) as i64 == 5
```

## Files

- `main.spl` - CPU pre-norm block + `@gpu_kernel` GELU demo
- `spec.spl` - CPU-reference tests (LayerNorm, GELU, residual, linear, widths)
