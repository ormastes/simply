# simple_make_enhanced -- Enhanced Make for SimpleOS

An enhanced make implementation that goes beyond the minimal `simple_make.spl`
in `src/os/port/build_tools/`. Supports conditionals, built-in functions,
parallel builds, VPATH, and colored output.

## Usage

```bash
# Build default target
bin/simple run examples/make/simple_make_enhanced.spl

# Build specific target
bin/simple run examples/make/simple_make_enhanced.spl -- all

# Parallel build
bin/simple run examples/make/simple_make_enhanced.spl -- -j 4

# Use specific Makefile
bin/simple run examples/make/simple_make_enhanced.spl -- -f build.mk

# Dry-run (show commands without executing)
bin/simple run examples/make/simple_make_enhanced.spl -- --dry-run

# Verbose mode
bin/simple run examples/make/simple_make_enhanced.spl -- -v

# Use example project
cd examples/make/example
bin/simple run ../simple_make_enhanced.spl
```

## Features Beyond simple_make

| Feature | simple_make | Enhanced |
|---------|:-----------:|:--------:|
| Variable assignment | Y | Y |
| Pattern rules (%.o: %.c) | Y | Y |
| Automatic variables ($@, $<, $^) | Y | Y |
| `.PHONY` targets | - | Y |
| `include FILE` | - | Y |
| `ifeq`/`ifneq`/`ifdef`/`ifndef` | - | Y |
| `$(shell CMD)` | - | Y |
| `$(wildcard PATTERN)` | - | Y |
| `$(patsubst FROM,TO,TEXT)` | - | Y |
| `$(foreach VAR,LIST,TEXT)` | - | Y |
| `$(filter PATTERN,TEXT)` | - | Y |
| `$(filter-out PATTERN,TEXT)` | - | Y |
| `$(notdir TEXT)` | - | Y |
| `$(basename TEXT)` | - | Y |
| `$(dir TEXT)` | - | Y |
| `$(addsuffix SUFFIX,TEXT)` | - | Y |
| `$(addprefix PREFIX,TEXT)` | - | Y |
| `-j N` parallel builds | - | Y |
| `VPATH` / `vpath` | - | Y |
| `$(MAKE)` recursive make | - | Y |
| Colored progress output | - | Y |
| `--dry-run` mode | - | Y |
| `:=` immediate assignment | - | Y |
| `+=` append assignment | - | Y |
| `?=` conditional assignment | - | Y |

## Files

- `simple_make_enhanced.spl` -- Main entry point and CLI
- `make_parser.spl` -- Enhanced Makefile parser with conditionals and functions
- `make_executor.spl` -- Build execution engine with parallel support
