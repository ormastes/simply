# Attention Kernels

**Tier:** 2 (Concept Adaptation)
**Original CUDA Concept:** batched multi-head attention kernels (82.Attention_Kernels)

## Simple Approach

The three kernels of a transformer attention block, over flat row-major `[f32]`:

| stage | host function | kernel formulation |
|---|---|---|
| fused QKV projection | `fused_qkv_projection` (`gpu_gemm` against `[Wq | Wk | Wv]`) | `fused_qkv_projection_kernel` |
| per-(batch, head) attention | `multi_head_attention` (softmax(Q K^T / sqrt(d_head)) V, optional causal mask) | `multi_head_attention_kernel` with online softmax |
| output projection | `output_projection` (`gpu_gemm` against `Wo`) | `output_projection_kernel` |

`BatchedMultiHeadAttention` composes the weights with a `forward(input, batch,
seq_len, causal)` method. `make_identity_attention` builds `W_qkv = [I | I | I]`
and `Wo = I` so Q = K = V = input and every result is checkable by hand.

## Concepts Covered

- Fusing the three projections into one GEMM
- Head slicing inside a `(batch*seq_len) x 3*d_model` buffer
- Batched attention with a (batch, head) grid dimension
- Causal masking and the online-softmax kernel form

## Files

- `main.spl` - kernels, host reference, `BatchedMultiHeadAttention`
- `spec.spl` - Tests with identity projections, uniform keys, causal mask, batching

## Status
The host functions are the verified path on this seed; `gpu_gemm` from
`std.gpu` runs a CPU fallback here (`src/lib/gc_async_mut/gpu_ops.spl`), so
results are exact and deterministic. The `@gpu_kernel` bodies are the
device-side formulation of the same three stages.

## Run
```bash
bin/simple run examples/08_gpu/simple_cuda_example/80.transformer/82.Attention_Kernels/main.spl
bin/simple test examples/08_gpu/simple_cuda_example/80.transformer/82.Attention_Kernels/spec.spl
```

## Try it (verified doctest)
```sdoctest
>>> use std.gpu.*
>>> # fused QKV with W_qkv = [I | I | I] (d_model = 2): one GEMM yields Q, K and V
>>> val w_qkv = [1.0, 0.0, 1.0, 0.0, 1.0, 0.0,  0.0, 1.0, 0.0, 1.0, 0.0, 1.0]
>>> val qkv = gpu_gemm([3.0, 4.0], w_qkv, 1, 6, 2).unwrap()
>>> print "Q = [{qkv[0]}, {qkv[1]}], K = [{qkv[2]}, {qkv[3]}], V = [{qkv[4]}, {qkv[5]}]"
Q = [3.0, 4.0], K = [3.0, 4.0], V = [3.0, 4.0]
>>> val out = gpu_gemm(qkv.slice(4, 6), [0.0, 1.0, 1.0, 0.0], 1, 2, 2).unwrap()
>>> print "Wo swaps: [{out[0]}, {out[1]}]"
Wo swaps: [4.0, 3.0]
>>> if qkv[5] != 4.0 or out[0] != 4.0: panic("attention projections drifted")
```
