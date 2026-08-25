# Model Loading and Inference

**Tier:** 3 (CPU model only)
**Original CUDA Concept:** Weight deserialization, int8 quantization, KV-cached inference (`66.Model_Loading_Inference`)

## Honest status

There is no `main.spl` here on purpose. The original exercise loads a
GGUF/safetensors checkpoint into device memory, dequantizes int8/int4
weights inside the GEMM kernels, and serves tokens with a KV cache. On the
Rust seed a `<<<>>>` launch is a no-op and no checkpoint reader or
quantized GEMM exists in the public stdlib (`std.ml.Tensor` loading is not
available; the SMF format under `src/compiler/80.driver/` is a *compiler
module* format, not a model-weight format), so a device-side inference
demo would only ever print zeros.

What can be shown honestly is the host-side arithmetic: a checkpoint header
describing tensor shapes, symmetric int8 quantization with a per-tensor
scale, dequantization error bounds, and the KV-cache bookkeeping that makes
generation O(seq) per token instead of O(seq^2). The doctest below is the
executable reference.

## CPU model (doctest)

```sdoctest
>>> fn quantize_int8(w: [f64]) -> ([i64], f64):
...     var amax = 0.0
...     for x in w:
...         val a = if x < 0.0: 0.0 - x else: x
...         if a > amax: amax = a
...     val scale = amax / 127.0
...     var q: [i64] = []
...     for x in w:
...         val r = x / scale
...         q.push((if r < 0.0: r - 0.5 else: r + 0.5) as i64)
...     (q, scale)
>>> fn dequantize(q: [i64], scale: f64) -> [f64]:
...     var out: [f64] = []
...     for v in q:
...         out.push((v as f64) * scale)
...     out
>>> val packed = quantize_int8([1.27, -0.635, 0.0, 0.01])
>>> print "int8: {packed.0}, scale x1000 = {(packed.1 * 1000.0 + 0.5) as i64}"
int8: [127, -63, 0, 1], scale x1000 = 10
>>> val back = dequantize(packed.0, packed.1)
>>> fn check_err(a: [f64], b: [f64], scale: f64) -> bool:
...     for i in 0..a.len():
...         val d = if a[i] > b[i]: a[i] - b[i] else: b[i] - a[i]
...         if d > scale / 2.0 + 0.000001: return false
...     true
>>> print "dequantized within half a step: {check_err([1.27, -0.635, 0.0, 0.01], back, packed.1)}"
dequantized within half a step: true
>>> val n_layers = 12
>>> val seq = 1024
>>> val d_model = 768
>>> val kv_floats = 2 * n_layers * seq * d_model
>>> print "KV cache for {seq} tokens: {kv_floats * 4 / 1048576} MiB (f32), reused per token instead of recomputing {seq} positions"
KV cache for 1024 tokens: 72 MiB (f32), reused per token instead of recomputing 1024 positions
>>> assert packed.0[0] == 127 and check_err([1.27, -0.635, 0.0, 0.01], back, packed.1) and kv_floats * 4 / 1048576 == 72
```

## Original CUDA exercise

The CUDA version memory-maps a GGUF file, uploads each tensor with
`cudaMemcpy`, runs int8 x int8 GEMMs with per-row scales, and appends each
new token's K/V projections to a preallocated device cache. Module 64 (GPT
Architecture) is the CPU forward pass those kernels accelerate.
