# Exercise 19: Memory API

## GPU Memory Management in Simple

Simple provides a safe, typed API for GPU memory management that wraps
CUDA's `cudaMalloc`, `cudaMemcpy`, `cudaFree`, and `cudaMemset`.

### API Overview

| Simple | CUDA | Description |
|--------|------|-------------|
| `gpu_alloc(bytes)` | `cudaMalloc` | Allocate `bytes` on the device -> `GpuPtr` |
| `gpu_upload_f32(ptr, data)` | `cudaMemcpy(H2D)` | Copy a host `[f32]` to the device |
| `gpu_download_f32(ptr, n)` | `cudaMemcpy(D2H)` | Copy `n` f32 back to a host `[f32]` |
| `gpu_free(ptr)` | `cudaFree` | Free device buffer (null pointer is a no-op) |
| `gpu_memset(ptr, byte, bytes)` | `cudaMemset` | Set device memory to a byte value |
| `gpu_copy_f32(dst, src, n)` | `cudaMemcpy(D2D)` | Device-to-device copy of `n` f32 |

### Memory Lifecycle

```
1. Allocate:  val buf = gpu_alloc(1024 * 4)?
2. Upload:    gpu_upload_f32(buf, host_data)?
3. Compute:   kernel<<<grid: (4, 1, 1), block: (256, 1, 1)>>>(buf, ...)
4. Download:  val result = gpu_download_f32(buf, 1024)?
5. Free:      gpu_free(buf)?
```

### Error Handling

All memory operations return `Result<T, GpuError>`. Use `?` for propagation:

```simple
fn process() -> Result<[f32], GpuError>:
    val buf = gpu_alloc(1024 * 4)?      # Propagates allocation failure
    gpu_upload_f32(buf, data)?          # Propagates transfer failure
    val result = gpu_download_f32(buf, 1024)?
    gpu_free(buf)?
    Ok(result)
```

### Key Differences from CUDA C

1. **Untyped handles, typed transfers:** a `GpuPtr` is bytes (`device_ptr`,
   `size`, `is_valid`); `gpu_upload_f32` / `gpu_download_f32` carry the type.
2. **No raw pointers:** Cannot accidentally dereference device memory on host.
3. **Result-based errors:** No unchecked error codes; the compiler enforces
   handling via `Result<T, GpuError>`.
4. **Size tracking:** `GpuPtr.size` records the allocation size in bytes.

## Files

- `main.spl` - Full memory lifecycle demonstration
- `spec.spl` - Tests for each memory operation

## Learning Goals

- Allocate and free GPU memory safely
- Transfer data between host and device
- Use `gpu_memset` for initialization
- Handle errors with `Result` and `?`
- Understand the host/device memory separation

## Run
```bash
bin/simple run examples/08_gpu/simple_cuda_example/10.cuda_basic/19.Memory_API/main.spl
bin/simple test examples/08_gpu/simple_cuda_example/10.cuda_basic/19.Memory_API/spec.spl
```

## Try it (verified doctest)
Sizes are bytes, and the handle type is inspectable without a device:

```sdoctest
>>> use std.gpu.*
>>> val n = 1024
>>> print "{n} f32 = {n * 4} bytes"
1024 f32 = 4096 bytes
>>> val p = GpuPtr.null()
>>> print "null: valid={p.is_valid} size={p.size} free_ok={gpu_free(p).is_ok()}"
null: valid=false size=0 free_ok=true
>>> if n * 4 != 4096 or p.is_valid or not gpu_free(p).is_ok(): panic("GpuPtr semantics drifted")
```
