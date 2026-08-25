# Attention Mechanisms

**Tier:** 2 (Concept Adaptation)
**Original CUDA Concept:** Causal scaled dot-product attention (`62.Attention_Mechanisms`)

## What this module does

```
scores  = Q K^T / sqrt(d_k)          one thread per (row, col)
scores  = causal_mask(scores)        j > i  ->  -inf
weights = softmax_rows(scores)       row max / exp / sum reduction
out     = weights V
```

`main.spl` runs the whole chain as a CPU reference model (the checked result)
and then the score kernel as a `@gpu_kernel` through `std.gpu` with a 2D
`(16, 16)` block tiling, module 12 style. The GPU output is compared against the
CPU model and reported honestly: a `<<<>>>` launch is a no-op on the Rust seed,
so the demo prints MISMATCH instead of a fake pass.

## Honest status

- Works: CPU scores / causal mask / stable row softmax / weighted sum; `std.gpu`
  buffer management and 2D launch syntax.
- Not in the current API: `@shared` block arrays inside `@gpu_kernel`
  (the original draft's block-wide softmax reduction) and `std.ml.Tensor`.

## CPU model (doctest)

```sdoctest
>>> fn softmax_row(xs: [f64]) -> [f64]:
...     var m = xs[0]
...     for x in xs:
...         if x > m: m = x
...     var total = 0.0
...     var es: [f64] = []
...     for x in xs:
...         val e = (x - m).exp()
...         es.push(e)
...         total = total + e
...     var out: [f64] = []
...     for e in es:
...         out.push(e / total)
...     out
>>> val w = softmax_row([0.0, -1.0e9, -1.0e9])
>>> print "masked row -> first weight {(w[0] * 100.0 + 0.5) as i64}%, rest {(w[1] + w[2]) as i64}"
masked row -> first weight 100%, rest 0
>>> val u = softmax_row([3.0, 3.0, 3.0, 3.0])
>>> print "uniform row -> {(u[2] * 100.0 + 0.5) as i64}% each"
uniform row -> 25% each
>>> assert (w[0] * 100.0 + 0.5) as i64 == 100 and (u[2] * 100.0 + 0.5) as i64 == 25
```

## Files

- `main.spl` - CPU attention chain + `@gpu_kernel` score demo
- `spec.spl` - CPU-reference tests (scaling, mask, softmax, weighted sum, geometry)
