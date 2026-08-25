# aarch64-apple-darwin — Hosted FS-Exec Lane

This directory contains the **hosted** (native macOS process) fs-exec acceptance
entry for the SimpleOS multiplatform systest suite.

## What "hosted" means

Unlike the other 6 systest lanes (x86_64, x86_32, arm64, arm32, riscv64, riscv32)
which boot freestanding kernels inside QEMU, this lane runs as a **native
aarch64-apple-darwin process directly on an Apple Silicon Mac**. There is no QEMU,
no bare-metal boot, no EL0/EL1 context switch, no UART serial line.

The OS loader (dyld / ld64) handles Mach-O loading. The entry point is `fn main()`.
Output goes to stdout (captured by the systest runner via `rt_process_run_timeout`).

## What it tests

The `fs_exec_entry.spl` program exercises the **hosted fs-exec acceptance flow**:

1. Read a staged app file from the host filesystem (`build/os/darwin-aarch64/hello_world.smf`)
2. Validate its header magic (SMF or ELF)
3. Launch it as a child process (`rt_process_run_timeout`)
4. Capture its exit and print the HOSTED_* marker family

## Honest marker set

| Marker | What it asserts |
|--------|-----------------|
| `HOSTED_FS_READ_OK` | Host-FS open + read succeeded (bytes > 4) |
| `HOSTED_APP_PARSE_OK` | First 4 bytes validate as SMF or ELF magic |
| `HOSTED_PROCESS_LAUNCH_OK` | Child process spawned via rt_process_run_timeout |
| `HOSTED_EXIT_OK` | Child exited (process lifecycle complete) |
| `TEST PASSED` | All acceptance criteria met |

NOT claimed: `ELF_LOAD_OK` (the host loader does Mach-O mapping, not us),
`user-svc-exit:ok` (bare-metal EL0 only), `SMF_WM_GUI_LAUNCH_OK`,
`NATIVE_GUI_PROCESS_RENDER_OK`.

## Missing-media on Linux

The staged app file `build/os/darwin-aarch64/hello_world.smf` does not exist on
a Linux host (no darwin SDK, no cross-compiler). The systest runner checks for the
binary at `build/os/darwin-aarch64/simpleos_aarch64_darwin_fs_exec` — if absent
it returns `missing-media:<path>` immediately, giving an honest RED result.

The test spec never uses `skip()`. On Linux the spec fails with the `missing-media`
classification, which is the correct, honest behavior.

## Building on a Mac

```
# On Apple Silicon Mac with simple compiler + darwin SDK:
bin/simple build --target=aarch64-apple-darwin --entry=examples/09_embedded/simple_os/arch/aarch64_darwin/fs_exec_entry.spl --output=build/os/darwin-aarch64/simpleos_aarch64_darwin_fs_exec
```

No custom linker script is needed — ld64 handles darwin binaries natively.
Link flags: standard darwin userland (no `-nostdlib`, no `-static`, no `-ffreestanding`).

## No bare-metal artifacts

There is no `linker.ld` here. GNU linker scripts are ignored by ld64 and are not
needed for darwin userland binaries.
