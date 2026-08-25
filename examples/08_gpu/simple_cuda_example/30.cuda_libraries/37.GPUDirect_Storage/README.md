# GPUDirect Storage

**Tier:** 3 (Skip)
**Status:** Not applicable to Simple

## Why Skipped

GPUDirect Storage (GDS) is an NVIDIA hardware-specific feature that enables direct
data paths between GPU memory and storage devices (NVMe SSDs), bypassing the CPU
and system memory. This requires specific NVIDIA hardware, drivers, and filesystem
support (ext4, XFS on Linux).

This is a hardware-level optimization that cannot be abstracted in Simple's GPU model.

For high-performance data loading in Simple, consider:
- **Async I/O:** Use Simple's async file operations to overlap I/O with computation
- **Memory-mapped files:** Map large datasets directly into address space
- **Streaming buffers:** Pipeline data loading with GPU computation

## Original CUDA Exercise

See the original GPUDirect Storage exercise for the NVIDIA-specific implementation
using `cuFileRead()`, `cuFileBufRegister()`, etc.

**Reference:** [NVIDIA GPUDirect Storage](https://docs.nvidia.com/gpudirect-storage/overview-guide/index.html)

## Simple Equivalent (status 2026-08-25)
**Not available.** There is no cuFile / GDS binding. The honest path is the
ordinary two-hop copy: read the file on the host (`std.fs`) into a `[f32]`,
then `gpu_upload_f32` it (module 19), chunking large files so the host buffer
stays bounded.

## Try it (verified doctest)
Chunk bookkeeping for a staged upload: a 1 GiB file in 64 MiB chunks.

```sdoctest
>>> val file_bytes = 1024 * 1024 * 1024
>>> val chunk_bytes = 64 * 1024 * 1024
>>> val chunks = (file_bytes + chunk_bytes - 1) / chunk_bytes
>>> print "{chunks} chunks of {chunk_bytes / (1024 * 1024)} MiB, last chunk {file_bytes - (chunks - 1) * chunk_bytes} bytes"
16 chunks of 64 MiB, last chunk 67108864 bytes
>>> if chunks != 16: panic("chunk arithmetic drifted")
```
