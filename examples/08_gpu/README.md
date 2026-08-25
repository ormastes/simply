# GPU Examples

CUDA kernels, GPU patterns, and compute pipelines.

## CUDA (`cuda/`)
- **basic.spl** - Basic CUDA kernel
- **vectorized.spl** - Vectorized operations
- **simple_demo.spl** - Simple demonstration

## Patterns (`patterns/`)
Design patterns for GPU programming:
- **device_enum.spl** - Device selection via enums
- **enum_as_index.spl** - Using enums as indices
- **type_inference.spl** - GPU type inference
- **user_gpu_enum.spl** - User-defined GPU enums

## Pipelines (`pipelines/`)
Complete GPU compute pipelines:
- **async_pipeline.spl** - Asynchronous GPU pipeline
- **training_pipeline.spl** - ML training pipeline
- **context_basic.spl** - Basic GPU context management
- **runtime_example.spl** - Runtime example
- **test_simple.spl** - Simple test

## Backends (`backends/`)
One SVM-G program, three `simple.sdn` configs — `gpu: backend: cuda | vulkan | metal`.
Only the manifest changes between directories. `backends/README.md` has the
runnable sdoctest and the measured per-backend status.

## CUDA tutorial in Simple (`simple_cuda_example/`)
Git submodule `ormastes/simple_cuda_example`: the
[`ormastes/cuda_exercise`](https://github.com/ormastes/cuda_exercise) workbook
re-implemented module by module in Simple (`10.cuda_basic` … `60.llm_implementation`),
each module with `main.spl`, `spec.spl` and a README carrying an sdoctest.
Checkout: `git submodule update --init examples/08_gpu/simple_cuda_example`.
Modules that are CUDA-locked (dynamic parallelism, cooperative groups, vendor
libraries) are README-only and say so.

Status: `cuda/basic.spl` and `patterns/device_enum.spl` were broken against the
current `std.cuda` surface and are being repaired in the same change as this note
(2026-08-25); `pipelines/*` are PyTorch-backed concept demos.
