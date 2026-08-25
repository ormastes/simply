# cuDNN

**Tier:** 3 (Skip)
**Status:** Not applicable to Simple

## Why Skipped

cuDNN is an NVIDIA proprietary deep neural network library providing GPU-accelerated
primitives for convolution, pooling, normalization, and activation. It is a
closed-source, hardware-specific library that cannot be meaningfully translated to
Simple's GPU abstraction.

In Simple, equivalent functionality is provided by:
- **`std.ml` module:** Built-in layer types (Linear, LayerNorm, GELU, etc.)
- **`~>` pipeline:** Composable neural network layers
- **Custom kernels:** `@gpu_kernel` for specialized operations
- See exercises 62-64 (Attention, Transformer Blocks, GPT Architecture) for implementations

## Original CUDA Exercise

See the original cuDNN exercise for the NVIDIA-specific implementation using
`cudnnConvolutionForward()`, `cudnnBatchNormalizationForward()`, etc.

**Reference:** [NVIDIA cuDNN Documentation](https://docs.nvidia.com/deeplearning/cudnn/index.html)

## Simple Equivalent (status 2026-08-25)
**Partial, not in `std.gpu`.** Convolution / pooling / normalisation layers
exist as `Conv2d`, `MaxPool2d`, `BatchNorm2d` in the torch surface
(`std.torch`, SFFI to libtorch - gated on a torch build) and as pure-Simple
CPU layers in `src/lib/gc_async_mut/pure/nn.spl`. Nothing in `std.gpu`
launches a cuDNN primitive.

## Try it (verified doctest)
The output-size rule every cuDNN descriptor encodes:
`out = (in - kernel + 2 * pad) / stride + 1`.

```sdoctest
>>> fn conv_out(size: i64, kernel: i64, pad: i64, stride: i64) -> i64:
...     (size - kernel + 2 * pad) / stride + 1
>>> print "28x28, k=3, pad=1, stride=1 -> {conv_out(28, 3, 1, 1)}"
28x28, k=3, pad=1, stride=1 -> 28
>>> print "28x28, k=2 pool, stride=2 -> {conv_out(28, 2, 0, 2)}"
28x28, k=2 pool, stride=2 -> 14
>>> if conv_out(28, 3, 1, 1) != 28 or conv_out(28, 2, 0, 2) != 14: panic("conv arithmetic drifted")
```
