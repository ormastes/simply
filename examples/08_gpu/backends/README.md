# Same GPU program, three backends (CUDA / Vulkan / Metal)

`svmg_hello.spl` is one program. Which GPU backend executes it is decided by
the `gpu:` section of the `simple.sdn` in the directory you run it from —
the three subdirectories differ **only** in that file:

```
backends/
  svmg_hello.spl      # the program (never changes)
  backends_spec.spl   # spec: runs every config, live or honest skip
  cuda/simple.sdn     # gpu: backend: cuda
  vulkan/simple.sdn   # gpu: backend: vulkan
  metal/simple.sdn    # gpu: backend: metal
```

```bash
cd examples/08_gpu/backends/cuda   && ../../../../bin/simple run ../svmg_hello.spl
cd examples/08_gpu/backends/vulkan && ../../../../bin/simple run ../svmg_hello.spl
cd examples/08_gpu/backends/metal  && ../../../../bin/simple run ../svmg_hello.spl
bin/simple test examples/08_gpu/backends/backends_spec.spl     # from the repo root
```

The program is an SVM-G kernel (the stack VM every GPU lane runs); it pushes
one RESULT record `(passed=1, value=9)` and exits with code 3. Expected output
on a live backend: `ok records=1 exit=3`. A backend that is not usable on the
host prints the lane's own reason instead of pretending, e.g. on Linux the
Metal directory prints `skip:metal-unavailable-not-macos`.

## The config that does the switching

`gpu:` is a sibling of `project:` in the project manifest the toolchain
already reads (`src/lib/nogc_sync_mut/notebook/gpu_config.spl`):

```
gpu:
  backend: cuda          # auto | cuda | vulkan | metal
  submode: interpreter   # interpreter | jit
  arch: auto             # auto -> sm80 / spv15 / msl2 per backend
```

`backend: auto` probes `cuda -> vulkan -> metal` and takes the first backend
whose lane session does not answer `skip:`. The parser is deterministic and
needs no device, so it is doctested here:

```sdoctest
>>> use std.nogc_sync_mut.notebook.gpu_config.{parse_gpu_config}
>>> val cfg = parse_gpu_config("project:\n  name: x\ngpu:\n  backend: vulkan\n  submode: jit\n")
>>> cfg.backend
"vulkan"
>>> cfg.submode
"jit"
>>> cfg.arch
"auto"
>>> parse_gpu_config("project:\n  name: x\n").backend
"auto"
```

## Measured 2026-08-25 (host: 2x NVIDIA, Vulkan 1.4, Linux, seed binary)

| config | `bin/simple test backends_spec.spl` | `bin/simple run` |
|---|---|---|
| cuda   | live: `ok records=1 exit=3` | live: `ok records=1 exit=3` |
| vulkan | live: `ok records=1 exit=3` | `vulkan-instance-init-failed` — see bug below |
| metal  | `skip:metal-unavailable-not-macos` (honest) | same |

Vulkan initialises under the spec runner but not under `bin/simple run` on
the same host and binary:
`doc/08_tracking/bug/vulkan_instance_init_fails_under_run_but_not_test_2026-08-25.md`.

Related: `doc/07_guide/lib/gpu_3d/gpu_api.md`, `test/03_system/gpu_lane/`.
