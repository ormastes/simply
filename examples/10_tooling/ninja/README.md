# simple_ninja -- Ninja-like Fast Build System

A SimpleOS-native Ninja build file executor. Parses `.ninja` files and executes
build rules with dependency tracking and parallel execution.

## Usage

```bash
# Build default target
bin/simple run examples/ninja/simple_ninja.spl

# Build specific target
bin/simple run examples/ninja/simple_ninja.spl -- hello

# Parallel build with 4 jobs
bin/simple run examples/ninja/simple_ninja.spl -- -j 4

# Use specific build file
bin/simple run examples/ninja/simple_ninja.spl -- -f build.ninja

# Dry-run (show commands without executing)
bin/simple run examples/ninja/simple_ninja.spl -- -n

# Verbose (show full commands)
bin/simple run examples/ninja/simple_ninja.spl -- -v

# Use example project
cd examples/ninja/example
bin/simple run ../simple_ninja.spl
```

## Supported Ninja Syntax

| Feature | Example |
|---------|---------|
| Rules | `rule cc` with `command`, `description`, `depfile` |
| Build edges | `build foo.o: cc foo.c` |
| Implicit deps | `build foo.o: cc foo.c \| header.h` |
| Order-only deps | `build foo.o: cc foo.c \|\| generated.h` |
| Variables | `cflags = -O2` and `$cflags` expansion |
| Scoped variables | Per-build variable overrides |
| Pools | `pool heavy_pool` with `depth = N` |
| Default targets | `default hello` |
| Include | `include rules.ninja` |
| Subninja | `subninja sub/build.ninja` |

## Key Feature: Parallel Execution

Like real Ninja, the primary advantage is parallel build execution. Use `-j N`
to control the number of concurrent build processes (defaults to system CPU count).

## Files

- `simple_ninja.spl` -- Main entry point and CLI
- `ninja_parser.spl` -- build.ninja file parser
- `ninja_builder.spl` -- Build execution engine with dependency tracking
