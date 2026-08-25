# hello_rs — SimpleOS Cargo smoke fixture

`#![no_std]` Rust binary that targets `x86_64-unknown-simpleos`. Serves as the
minimum viable fixture for the Rust cross-compile smoke (see
`test/02_integration/os/port/rust/smoke_rustc_spec.spl`).

## Build

    cd examples/simpleos_hello_rs
    ../../scripts/cargo_simpleos.shs build --release

Produces `target/x86_64-unknown-simpleos/release/hello_rs` (a tiny `_start`-entry ELF).

## Interface contracts used

- IF-04 (Rust libstd PAL) — at `#![no_std]` level, no libstd surface touched.
- IF-05 (LLVM sysroot) — consumed via `scripts/cargo_simpleos.shs` linker env.
- IF-10 (Cargo vendored registry) — `.cargo/config.toml` pins offline mode.

## Expected output size

Under 50 KB release build (LTO + strip). Panic handler is the only non-trivial code.
