# GPT Architecture

**Tier:** 2 (Concept Adaptation)
**Original CUDA Concept:** Complete decoder-only GPT forward pass + generation (`64.GPT_Architecture`)

## What this module does

```
x      = embed(ids) + pos(ids)              module 61
x      = block_i(x)   for i in 0..n_layers  module 63 (pre-norm blocks)
x      = LayerNorm(x)
logits = x W_lm                             LM head, seq x vocab
next   = argmax(logits[last])               greedy decode, repeat
```

`main.spl` runs a tiny GPT (vocab 16, d_model 8, 2 layers) end to end as a CPU
reference model (the checked result) and generates three tokens greedily. The LM
head is then run as a `@gpu_kernel` through `std.gpu` with a 2D tiling (one
thread per logit, module 12 pattern) and compared against the CPU model,
reported honestly: a `<<<>>>` launch is a no-op on the Rust seed, so the demo
prints MISMATCH instead of a fake pass.

## Honest status

- Works: `GptConfig` with a parameter count, the CPU forward pass, argmax and a
  greedy decode loop; `std.gpu` buffers and a 2D launch.
- Not in the current API: `std.ml` layers / `Tensor.randn`, `~>` layer
  composition, and sampling helpers (top-k, temperature) as library calls.
  Weights are deterministic synthetic values, not trained parameters.

## CPU model (doctest)

```sdoctest
>>> fn argmax(xs: [f32]) -> i64:
...     var best = 0
...     for i in 1..xs.len():
...         if xs[i] > xs[best]: best = i
...     best
>>> fn greedy(prompt: [i64], vocab: i64, max_new: i64) -> [i64]:
...     var ids = prompt
...     for step in 0..max_new:
...         var row: [f32] = []
...         for v in 0..vocab:
...             row.push(if v == (ids[ids.len() - 1] + 1) % vocab: 1.0 else: 0.0)
...         ids.push(argmax(row))
...     ids
>>> val out = greedy([7], 10, 4)
>>> print "greedy decode: {out}"
greedy decode: [7, 8, 9, 0, 1]
>>> val params = 16 * 8 + 8 * 8 + 2 * (2 * 8 * 32) + 8 * 16
>>> print "tiny GPT params: {params}"
tiny GPT params: 1344
>>> assert out.len() == 5 and out[4] == 1 and params == 1344
```

## Files

- `main.spl` - CPU tiny-GPT forward + greedy generation + `@gpu_kernel` LM-head demo
- `spec.spl` - CPU-reference tests (config, LM head, argmax, decode loop)
