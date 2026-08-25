# Backpropagation

**Tier:** 2 (Concept Adaptation)
**Original CUDA Concept:** hand-written backprop kernels (72.Backprop_CPU_PyCUDA)

## Simple Approach

The original writes one CUDA kernel per step of a training iteration and checks
each against a CPU version. This module keeps that decomposition:

| step | host function | kernel formulation |
|---|---|---|
| `y = x W + b` | `linear_forward` (via `gpu_gemm`) | - |
| ReLU | `relu_forward` / `relu_backward` | `relu_*_kernel`, one thread per element |
| loss gradient | `softmax_xent_backward` | per-row softmax minus one-hot |
| `dx = dy W^T` | `linear_backward_input` (via `gpu_gemm`) | - |
| `dW = x^T dy` | `linear_backward_weights` | `linear_backward_weights_kernel` with `gpu_atomic_add_f32` |
| SGD | `sgd_update` / `LinearLayer.apply_sgd` | `sgd_update_kernel` |

`LinearLayer` is a plain class (composition, no inheritance) holding weights,
bias and their gradients; `train_step` runs forward, backward and update.

## Concepts Covered

- Forward/backward decomposition of a linear layer
- Atomic accumulation of weight gradients across a batch
- Numerically stable softmax (max-subtracted) and its gradient
- SGD update as an elementwise kernel

## Files

- `main.spl` - kernels, host reference, `LinearLayer`, `train_step`
- `spec.spl` - Tests for every step plus a loss-decreases check

## Status
The host functions are the verified path on this seed; `gpu_gemm` from
`std.gpu` runs a CPU fallback here (`src/lib/gc_async_mut/gpu_ops.spl`), so
all results are exact and deterministic. The `@gpu_kernel` bodies are the
device-side formulation of the same steps.

## Run
```bash
bin/simple run examples/08_gpu/simple_cuda_example/70.gpu_optimization/72.Backprop/main.spl
bin/simple test examples/08_gpu/simple_cuda_example/70.gpu_optimization/72.Backprop/spec.spl
```

## Try it (verified doctest)
```sdoctest
>>> use std.gpu.*
>>> fn relu_backward(d_out: [f32], x: [f32]) -> [f32]:
...     [for i in 0..x.len(): if x[i] > 0.0: d_out[i] else: 0.0]
>>> val d = relu_backward([1.0, 1.0, 1.0], [-2.0, 0.0, 3.0])
>>> print "relu grad = [{d[0]}, {d[1]}, {d[2]}]"
relu grad = [0.0, 0.0, 1.0]
>>> val dx = gpu_gemm([1.0, 1.0], [1.0, 3.0, 2.0, 4.0], 1, 2, 2).unwrap()
>>> print "dx = dy W^T = [{dx[0]}, {dx[1]}]"
dx = dy W^T = [3.0, 7.0]
>>> if d[2] != 1.0 or dx[1] != 7.0: panic("backprop steps drifted")
```
