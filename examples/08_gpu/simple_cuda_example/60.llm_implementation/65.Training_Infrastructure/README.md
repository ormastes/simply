# Training Infrastructure

**Tier:** 3 (CPU model only)
**Original CUDA Concept:** Optimizer step, gradient accumulation, LR schedule, mixed-precision loss scaling, checkpointing (`65.Training_Infrastructure`)

## Honest status

There is no `main.spl` here on purpose. The original exercise is an
end-to-end training loop: autograd for every kernel in modules 61-64, an
Adam/SGD optimizer over device buffers, NCCL all-reduce across GPUs and
fp16 loss scaling. None of that is honestly implementable with the current
`std.gpu` / `std.cuda` API on the Rust seed:

- a `<<<>>>` kernel launch is a documented no-op in the interpreter, so a
  training step could never update a device buffer;
- there is no autograd, optimizer, or scheduler in the public stdlib
  (`use std.ml.*` resolves no `Layer`/`Embedding`/optimizer symbols);
- multi-GPU collectives are not exposed (see module 27's honest scope).

What *is* teachable today is the host-side arithmetic every trainer runs, so
that is what this page pins down: an SGD update, gradient accumulation over
micro-batches, a linear-warmup / step-decay learning rate, and the
loss-scaling check used for mixed precision. All of it is plain CPU code and
the doctest below is the executable reference.

## CPU model (doctest)

```sdoctest
>>> fn sgd_step(w: [f64], grad: [f64], lr: f64) -> [f64]:
...     var out: [f64] = []
...     for i in 0..w.len():
...         out.push(w[i] - lr * grad[i])
...     out
>>> fn accumulate(grads: [[f64]]) -> [f64]:
...     var acc: [f64] = []
...     for i in 0..grads[0].len():
...         acc.push(0.0)
...     for g in grads:
...         for i in 0..g.len():
...             acc[i] = acc[i] + g[i] / (grads.len() as f64)
...     acc
>>> fn lr_at(step: i64, base: f64, warmup: i64, decay_every: i64) -> f64:
...     if step < warmup:
...         return base * ((step + 1) as f64) / (warmup as f64)
...     var lr = base
...     var s = warmup
...     while s + decay_every <= step:
...         lr = lr * 0.5
...         s = s + decay_every
...     lr
>>> val g = accumulate([[1.0, 2.0], [3.0, 4.0]])
>>> print "accumulated grad: [{g[0]}, {g[1]}]"
accumulated grad: [2.0, 3.0]
>>> val w = sgd_step([10.0, 10.0], g, 0.5)
>>> print "after step: [{w[0]}, {w[1]}]"
after step: [9.0, 8.5]
>>> print "lr: warmup {lr_at(0, 1.0, 4, 10)} {lr_at(3, 1.0, 4, 10)} decay {lr_at(14, 1.0, 4, 10)} {lr_at(24, 1.0, 4, 10)}"
lr: warmup 0.25 1.0 decay 0.5 0.25
>>> val loss_scale = 1024.0
>>> val scaled_grad = 0.0009765625 * loss_scale
>>> print "fp16 loss scaling: tiny grad {scaled_grad} survives, unscaled {scaled_grad / loss_scale}"
fp16 loss scaling: tiny grad 1.0 survives, unscaled 0.0009765625
>>> assert w[1] == 8.5 and lr_at(24, 1.0, 4, 10) == 0.25 and scaled_grad == 1.0
```

## Original CUDA exercise

The CUDA version pairs every forward kernel with a backward kernel, keeps
fp32 master weights next to fp16 activations, scales the loss before the
backward pass and unscales gradients (skipping the step on inf/nan), and
all-reduces gradients with NCCL before the optimizer runs. Module 27
(Multi-GPU) covers the device-enumeration half that is available here.
