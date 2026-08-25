# External Compression Library Example

Canonical optional native-library integration example for Simple.

This example keeps the external dependency out of the compiler/runtime default
link set. The external library is built as a small C bridge and loaded
explicitly at runtime from a compiled Simple binary.

## What It Shows

- Build an external dependency with CMake in a generated build directory
- Link that bridge explicitly against zlib
- Discover the bridge from Simple via `SIMPLE_ZLIB_BRIDGE_PATH` or common build paths
- Call exported functions through `spl_dlopen`, `spl_dlsym`, and `spl_wffi_call_i64`
- Fail with an explicit message when the bridge is absent

## Files

- `CMakeLists.txt` - bridge build using system zlib or `FetchContent`
- `src/simple_zlib_bridge.c` - thin C ABI around zlib compress/decompress
- `demo.spl` - compiled Simple client that loads the bridge and runs its roundtrip self-test

The bridge exports two layers:

- lower-level `(ptr, len)` compression entrypoints for real integrations
- a zero-argument `simple_zlib_roundtrip_selftest()` used by the runnable demo
  to verify the bridge on hosts where raw pointer marshalling is still under
  active WFFI hardening

## Build The Bridge

Use a generated build directory, matching the `examples/cmake` workflow:

```bash
cmake -S examples/10_tooling/libraries/external_compression \
  -B build/examples/external_compression \
  -DSIMPLE_ZLIB_FETCH=ON

cmake --build build/examples/external_compression
```

Notes:

- `SIMPLE_ZLIB_FETCH=ON` checks out zlib during configure under CMake's `_deps/`
  build area.
- `SIMPLE_ZLIB_FETCH=OFF` requires a host zlib package discoverable by
  `find_package(ZLIB REQUIRED)`.
- The bridge itself is the only target that links zlib:
  `target_link_libraries(simple_zlib_bridge PRIVATE ...)`.

## Build And Run The Simple Side

```bash
bin/simple compile \
  examples/10_tooling/libraries/external_compression/demo.spl \
  --native \
  -o build/examples/external_compression/demo

SIMPLE_ZLIB_BRIDGE_PATH=$PWD/build/examples/external_compression/libsimple_zlib_bridge.so \
  build/examples/external_compression/demo
```

On macOS, use `libsimple_zlib_bridge.dylib`. On Windows, use
`simple_zlib_bridge.dll`.

## Failure Behavior

If the bridge is missing, the demo exits with:

```text
missing external compression bridge
set SIMPLE_ZLIB_BRIDGE_PATH or build examples/10_tooling/libraries/external_compression
```

If the bridge loads but a symbol or compression call fails, the demo prints the
bridge self-test failure and exits non-zero.

## Why This Is Canonical

- Core compiler/runtime native binaries do not gain a mandatory `zlib` or
  `lzma` dependency.
- External libraries remain explicit, local, and optional.
- The C bridge owns the host linker configuration and package discovery.
- The Simple binary only depends on the stable runtime loading primitives.

See also: `doc/07_guide/ffi/external_native_libraries.md`
