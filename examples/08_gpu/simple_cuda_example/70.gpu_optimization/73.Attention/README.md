# Optimized Attention

**Tier:** 2 (Concept Adaptation)
**Original CUDA Concept:** naive vs flash attention kernels (73.Attention_CPU_PyCUDA)

## Simple Approach

Two single-head attention implementations over flat row-major `[f32]`
(`seq_len x head_dim`), both taking a `causal` flag:

1. **Naive:** materialise the full score row `S = Q K^T / sqrt(d)`, softmax it,
   multiply by `V` - the reference
2. **Flash:** stream `K`/`V` in `BLOCK_SIZE` blocks and keep a running max `m`
   and running sum `l`, rescaling the partial output by `exp(m_old - m_new)` -
   the score row never exists

Each host function has a matching `@gpu_kernel` formulation (one thread per
query row; the flash kernel stages K/V tiles through `gpu_shared_array_f32`).

## Concepts Covered

- Scaled dot-product attention and the `1/sqrt(head_dim)` scale
- Online (streaming) softmax with running max/sum rescaling
- Causal masking (position `i` attends to `0..=i`)
- K/V tiling into shared memory

## Files

- `main.spl` - naive and flash attention, kernels + host reference
- `spec.spl` - Tests that flash == naive with/without mask, plus edge cases

## Status
The host functions are the verified path on this seed; the kernels are the
device-side formulation of the same algorithm. `BLOCK_SIZE` is 4 here (64 in
the original) so the 6-token example exercises a partial last block.

## Run
```bash
bin/simple run examples/08_gpu/simple_cuda_example/70.gpu_optimization/73.Attention/main.spl
bin/simple test examples/08_gpu/simple_cuda_example/70.gpu_optimization/73.Attention/spec.spl
```

## Try it (verified doctest)
```sdoctest
>>> fn online_softmax_weights(scores: [f32]) -> [f32]:
...     var m = -1.0e30
...     var l = 0.0
...     var i = 0
...     while i < scores.len():
...         val m_new = if scores[i] > m: scores[i] else: m
...         l = l * (m - m_new).exp() + (scores[i] - m_new).exp()
...         m = m_new
...         i = i + 1
...     [for s in scores: (s - m).exp() / l]
>>> val w = online_softmax_weights([1.0, 1.0, 1.0, 1.0])
>>> print "uniform weights = [{w[0]}, {w[1]}, {w[2]}, {w[3]}]"
uniform weights = [0.25, 0.25, 0.25, 0.25]
>>> val w2 = online_softmax_weights([0.0, 100.0])
>>> print "dominant key wins: {w2[1] > 0.999}"
dominant key wins: true
>>> if w[0] != 0.25 or w2[1] < 0.999: panic("online softmax drifted")
```
