# Simple CUDA Examples

CUDA exercises from [ormastes/cuda_exercise](https://github.com/ormastes/cuda_exercise) translated to the Simple language. Each exercise demonstrates GPU programming concepts using Simple's built-in GPU/CUDA backend, progressing from basic device queries through transformer-level kernels.

## Quick Start

```bash
# Run any example
bin/simple run examples/08_gpu/simple_cuda_example/00.demo/main.spl

# Run tests
bin/simple test examples/08_gpu/simple_cuda_example/test/all_spec.spl

# Run a specific exercise
bin/simple run examples/08_gpu/simple_cuda_example/10.cuda_basic/12.First_Kernel/main.spl
```

GPU hardware is **not required** for interpreter mode -- examples that depend on a real device will print a warning and exit gracefully.

## Project Structure

```
examples/08_gpu/simple_cuda_example/
  lib/                            # Shared helpers
    gpu_test_helpers.spl          # GPU availability checks, alloc/download wrappers
    matrix_helpers.spl            # CPU matrix ops for verification
  test/
    all_spec.spl                  # Master test runner
  00.demo/                        # Hello GPU - device detection, minimal kernel
  10.cuda_basic/                  # Foundations
    11.Foundations/                #   Device properties, driver version
    12.First_Kernel/              #   Launch a kernel, read results back
    15.Unit_Testing/              #   SSpec patterns for GPU code
    16.Error_Handling/            #   Result<T, GpuError> patterns
    17.Memory_Hierarchy/          #   Global, shared, constant memory
    18.Thread_Hierarchy/          #   Grids, blocks, threads, warps
    19.Memory_API/                #   cudaMalloc / cudaMemcpy equivalents
  20.cuda_intermediate/           # Intermediate topics
    21.Sync_and_Atomics/          #   Barriers, atomic add/CAS
    22.Streams_and_Async/         #   Overlapping transfers and compute
    23.Shared_Memory/             #   Tiled algorithms
    24.Memory_Coalescing/         #   Access pattern optimization
    25.Dynamic_Parallelism/       #   Kernels launching kernels
    26.Cooperative_Groups/        #   Flexible synchronization
    27.Multi_GPU/                 #   Peer-to-peer, multi-device dispatch
  30.cuda_libraries/              # Library equivalents
    31.cuBLAS_Equivalent/         #   GEMM, BLAS-level routines
    32.cuFFT/                     #   FFT on GPU
    33.cuRAND/                    #   Random number generation
    34.cuSPARSE/                  #   Sparse matrix ops
    35.Parallel_Iterators/        #   Map, reduce, scan, sort
    36.cuDNN/                     #   Convolution, pooling, activation
    37.GPUDirect_Storage/         #   Direct I/O to GPU memory
    38.Tensor_Cores/              #   Mixed-precision matrix multiply
  60.llm_implementation/          # Building an LLM from scratch
    61.Tokenization_Embeddings/   #   BPE tokenizer, embedding lookup
    62.Attention_Mechanisms/      #   Scaled dot-product, multi-head
    63.Transformer_Blocks/        #   LayerNorm, FFN, residual connections
    64.GPT_Architecture/          #   Full decoder-only model
    65.Training_Infrastructure/   #   Loss, optimizer, gradient accumulation
    66.Model_Loading/             #   Weight deserialization, safetensors
  70.gpu_optimization/            # Performance deep-dives
    71.MatMul_SIMD_vs_GPU/        #   CPU SIMD vs GPU throughput
    72.Backprop/                  #   Backward pass kernel design
    73.Attention/                 #   Flash Attention, memory-efficient variants
  80.transformer/                 # Production transformer kernels
    81.Core_GEMM/                 #   High-performance GEMM
    82.Attention_Kernels/         #   Fused attention kernels
```

## Translation Tiers

Each exercise is assigned a translation tier indicating how closely it maps from C/CUDA to Simple.

| Tier | Label | Meaning |
|------|-------|---------|
| **1** | Direct | Near 1:1 translation. The C/CUDA logic maps directly to Simple GPU APIs. Examples: device queries, basic kernel launch, memory copy. |
| **2** | Adapted | The algorithm is the same but the API surface differs. Simple's higher-level constructs (Result types, iterators, RAII memory) replace raw CUDA calls. Examples: error handling, streams, shared memory tiling. |
| **3** | Reference-only | The C/CUDA version serves as a specification. The Simple implementation uses a fundamentally different approach (e.g., library-level ops instead of hand-written kernels). Examples: cuBLAS equivalents, cuDNN layers, Flash Attention. |

## API Comparison

| C / CUDA | Simple | Notes |
|----------|--------|-------|
| `cudaMalloc(&ptr, size)` | `gpu_alloc[f32](gpu, count)` | Returns `GpuArray[T]`, no raw pointers |
| `cudaMemcpy(dst, src, size, kind)` | `arr.upload(data)` / `arr.download()` | Direction inferred from method |
| `cudaFree(ptr)` | automatic (RAII) | `GpuArray.drop()` called on scope exit |
| `cudaGetDeviceCount(&count)` | `gpu_device_count()` | Returns `i64` |
| `cudaDeviceSynchronize()` | `gpu_sync()?` / `ctx.sync()` | Returns `Result` |
| `__global__ void kern()` | `@gpu_kernel fn kern():` | Attribute-based kernel marker |
| `kern<<<grid, block>>>()` | `kern<<<grid: (gx,gy,gz), block: (bx,by,bz)>>>()` | Named launch parameters |
| `__shared__ float s[]` | `@shared var s: [f32]` | Attribute on variable |
| `atomicAdd(&x, val)` | `atomic_add(x, val)` | Free function |
| `cudaStreamCreate(&s)` | `ctx.create_stream()` | Returns `GpuStream` |
| `cudaError_t` | `Result<T, GpuError>` | Idiomatic error handling |

## Prerequisites

- **Simple compiler** -- `bin/simple` or `bin/release/simple` (see root README for build instructions)
- **NVIDIA GPU** (optional) -- required for actual device execution; interpreter mode runs CPU-side stubs
- **CUDA toolkit** (optional) -- needed only when compiling with `--backend=cuda`

## Links

- [cuda_exercise (C/CUDA originals)](https://github.com/ormastes/cuda_exercise)
- [Simple language](https://github.com/ormastes/simple)
- [/cuda skill documentation](../../.claude/skills/cuda.md)
