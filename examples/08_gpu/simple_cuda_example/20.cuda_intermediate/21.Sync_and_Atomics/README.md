# Exercise 21: Synchronization and Atomics

## Thread Synchronization in Simple vs CUDA

When multiple GPU threads access shared data, synchronization is required to
prevent race conditions. This module runs the same five patterns as the C++
original (`cuda_exercise/20.cuda_intermediate/21.Sync_and_Atomics`) on a real
CUDA device, driven from Simple.

### How the kernels are executed

The Rust seed that is currently deployed as `bin/simple` does **not** execute
`@gpu_kernel` functions launched with `kernel<<<grid: g, block: b>>>(...)`:
under the interpreter (the engine `bin/simple test` uses) a kernel launch is a
documented no-op (`compiler_rust/compiler/src/interpreter/expr/calls.rs:94`).
The only path that runs real kernels is the driver-level `std.cuda` API, so
every kernel in this module is hand-written PTX (`val PTX = """..."""` in
`main.spl`) loaded with `cuda_module_load_data` and launched with
`cuda_launch_kernel`. The thin wrappers live in `lib/gpu_test_helpers.spl`.

| Pattern | CUDA | PTX used here |
|---------|------|---------------|
| Block barrier | `__syncthreads()` | `bar.sync 0` |
| Counter / histogram | `atomicAdd` | `atom.global.add.u32` |
| Min / max reduction | `atomicMin` / `atomicMax` | `atom.global.min.s32` / `atom.global.max.s32` |
| Set-if-greater | `atomicCAS` loop | `atom.global.cas.b32` loop |
| Block reduce + combine | shared memory + `atomicAdd(float)` | `.shared` + `atom.global.add.f32` |

### When to Use Atomics

- **Counters:** many threads incrementing one shared counter
- **Reductions:** min/max/sum across all threads
- **Histograms:** binning elements into shared bins
- **Lock-free updates:** compare-and-swap for custom protocols

### Performance Notes

- Atomics are serialized at the hardware level; reduce within a block first,
  then combine with one atomic per block (pattern 5 does exactly this).
- Shared-memory atomics are cheaper than global-memory atomics.
- `bar.sync` is a barrier, not an atomic: it synchronizes all threads of a block.

## Files

- `main.spl` - Atomic counter, min/max, histogram, CAS, block reduce (PTX kernels + host code)
- `spec.spl` - Device tests checked against CPU references (skips when no CUDA device)

## Running

```bash
SIMPLE_EXECUTION_MODE=interpreter bin/simple run examples/08_gpu/simple_cuda_example/20.cuda_intermediate/21.Sync_and_Atomics/main.spl
bin/simple test examples/08_gpu/simple_cuda_example/20.cuda_intermediate/21.Sync_and_Atomics/spec.spl
```

The interpreter engine is required for `run`: the seed's JIT cannot resolve
the project-relative `use gpu_test_helpers` import.

## Doctest: grid sizing and CPU reference

The launch configuration and the CPU reference histogram are plain Simple and
can be checked without a device:

```sdoctest
>>> val n = 1000
>>> val block = 256
>>> print "{(n + block - 1) / block}"
4
>>> fn histogram(values: [i64]) -> [i64]:
...     var hist = [0, 0, 0]
...     for v in values:
...         hist[((v % 3) + 3) % 3] = hist[((v % 3) + 3) % 3] + 1
...     hist
>>> val hist = histogram([-1, 4, 7, 2])
>>> print hist
[0, 2, 2]
>>> assert hist[0] == 0 and hist[1] == 2 and hist[2] == 2
```

(The `assert` line keeps the block fail-closed: the seed's md doctest runner
only checks that a block exits 0 and does not compare printed output —
`src/lib/nogc_sync_mut/test_runner/doctest_runner.spl:292`.)

## Learning Goals

- Use a block barrier (`bar.sync`) with shared memory
- Apply atomic operations for thread-safe updates
- Build a histogram with `atom.add`
- Implement min/max reductions with atomics
- Understand compare-and-swap loops for custom synchronization
