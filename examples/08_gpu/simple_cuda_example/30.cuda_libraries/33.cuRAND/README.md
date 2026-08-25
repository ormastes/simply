# cuRAND

**Tier:** 3 (Skip)
**Status:** Not applicable to Simple

## Why Skipped

cuRAND is an NVIDIA proprietary library for generating random numbers on GPU. It is
a closed-source, hardware-specific library that cannot be meaningfully translated to
Simple's GPU abstraction.

For GPU random number generation in Simple, consider:
- **GPU RNG kernel:** Implement a simple PRNG (e.g., xorshift) as a `@gpu_kernel`
- **Host-side generation:** Generate random data on CPU and transfer to GPU
- **`Tensor.randn()`:** Use Simple's built-in tensor random initialization

## Original CUDA Exercise

See the original cuRAND exercise for the NVIDIA-specific implementation using
`curandCreateGenerator()`, `curandGenerateUniform()`, etc.

**Reference:** [NVIDIA cuRAND Documentation](https://docs.nvidia.com/cuda/curand/index.html)

## Simple Equivalent (status 2026-08-25)
**Host-side only.** `std.common.random_pure` provides a seeded LCG
(`lcg_rng(seed)`, `lcg_advance`, `lcg_value`, plus `seed`/`randint`/`random`)
that runs on the CPU; generate on the host and `gpu_upload_f32` the buffer.
There is no device-side generator; `Tensor.randn()` mentioned above lives in
the torch-gated `std.torch` surface, not in `std.gpu`.

## Try it (verified doctest)
The LCG is deterministic, so a seeded stream is reproducible - the property
cuRAND's `curandSetPseudoRandomGeneratorSeed` gives you:

```sdoctest
>>> use std.common.random_pure.{lcg_rng, lcg_advance, lcg_value}
>>> val r1 = lcg_advance(lcg_rng(42))
>>> print "{lcg_value(r1)}"
1083814273
>>> val r2 = lcg_advance(lcg_rng(42))
>>> print "same seed, same value: {lcg_value(r1) == lcg_value(r2)}"
same seed, same value: true
>>> if lcg_value(r1) != 1083814273: panic("LCG stream changed")
```
