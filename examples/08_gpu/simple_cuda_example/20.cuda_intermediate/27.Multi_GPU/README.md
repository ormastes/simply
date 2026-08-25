# Multi-GPU Programming

**Tier:** 2 (Concept Adaptation)
**Original CUDA Concept:** Multi-GPU with `cudaSetDevice()`, peer-to-peer memory access

## Simple Approach

`std.cuda` exposes the driver API directly, so multi-GPU is one context per
device rather than a device-selection switch:

| CUDA | Simple (`std.cuda` + `../gpu_test_helpers.spl`) |
|------|--------------------------------------------------|
| `cudaSetDevice(i)` | `gpu_setup(i)` creates a context on device `i`; `rt_cuda_ctx_set_current(ctx)` switches back to it |
| `cudaMalloc` / `cudaMemcpy` | `gpu_upload_f32s` / `gpu_download_f32s` in whichever context is current |
| `kernel<<<...>>>` on device `i` | `gpu_run_1d(module, "add_kernel", ...)` with the module loaded in that context |
| `cudaDeviceSynchronize()` | `cuda_sync()` (inside `gpu_run_1d`) |
| `cudaMemcpyPeer` | **not available** -- `copy_between_devices` stages through the host |
| `cudaError_t` checks | `Result<[f32], text>` |

Modules are context-local: the PTX is loaded once per device. When only one
device is present, `main.spl` says so and runs both halves on device 0.

## Concepts Covered

- Enumerating available GPU devices (`cuda_device_count`, `cuda_device_name`)
- One context per device, switching the current context
- Splitting a vector add across two devices and merging the halves
- Moving data between devices without peer access

## Doctest: the split bookkeeping on the CPU

Which half goes to which device, and what the merged result must be, is
plain host arithmetic and runs without a GPU:

```sdoctest
>>> fn split_point(n: i64) -> i64:
...     n / 2
>>> fn add_half(a: [i64], b: [i64], from: i64, to: i64) -> [i64]:
...     var out: [i64] = []
...     for i in from..to:
...         out.push(a[i] + b[i])
...     out
>>> val a = [1, 2, 3, 4, 5, 6, 7]
>>> val b = [10, 20, 30, 40, 50, 60, 70]
>>> val half = split_point(a.len())
>>> print half
3
>>> val dev0 = add_half(a, b, 0, half)
>>> val dev1 = add_half(a, b, half, a.len())
>>> print dev0
[11, 22, 33]
>>> print dev1
[44, 55, 66, 77]
>>> assert half == 3 and dev0.len() + dev1.len() == 7 and dev1[3] == 77
```

(The `assert` keeps the block fail-closed: the seed's md doctest runner only
checks that a block exits 0 and does not compare printed output.)

## Files

- `main.spl` - Vector add split across two devices, plus a host-staged device-to-device copy
- `spec.spl` - Host bookkeeping, one-device add, two-device split and copy (device tests skip without hardware)
