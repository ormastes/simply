# cuFFT

**Tier:** 3 (Skip)
**Status:** Not applicable to Simple

## Why Skipped

cuFFT is an NVIDIA proprietary library for computing Fast Fourier Transforms on GPU.
It is a closed-source, hardware-specific library that cannot be meaningfully
translated to Simple's GPU abstraction.

For FFT operations in Simple, consider:
- **CPU FFT:** Implement Cooley-Tukey FFT using standard Simple code
- **GPU FFT kernel:** Write a custom FFT kernel using `@gpu_kernel` (for educational purposes)
- **Vendor FFT:** Use Simple's FFI to call platform-appropriate FFT libraries

## Original CUDA Exercise

See the original cuFFT exercise for the NVIDIA-specific implementation using
`cufftPlan1d()`, `cufftExecC2C()`, etc.

**Reference:** [NVIDIA cuFFT Documentation](https://docs.nvidia.com/cuda/cufft/index.html)

## Simple Equivalent (status 2026-08-25)
**Not available.** There is no FFT in `std.*` (no `fn fft` anywhere under
`src/lib`) and no vendor-FFT SFFI binding. The honest path is a hand-written
CPU Cooley-Tukey, or a custom `@gpu_kernel` butterfly stage per module 12/17.

## Try it (verified doctest)
Radix-2 bookkeeping for a length-8 transform: 3 stages, 4 butterflies each.

```sdoctest
>>> val n = 8
>>> var stages = 0
>>> var width = n
>>> while width > 1:
...     width = width / 2
...     stages = stages + 1
>>> print "{stages} stages x {n / 2} butterflies = {stages * n / 2} butterflies"
3 stages x 4 butterflies = 12 butterflies
>>> if stages != 3: panic("log2(8) is 3")
```
