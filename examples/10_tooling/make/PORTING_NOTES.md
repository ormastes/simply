# simple_make_enhanced -- Porting Notes

## Subset Coverage

### Supported (all features from simple_make plus)
- Variable assignment: `=` (recursive), `:=` (simple), `+=` (append), `?=` (conditional)
- Pattern rules (`%.o: %.c`)
- Automatic variables: `$@`, `$<`, `$^`, `$*`
- `.PHONY` targets
- `include FILE` and `-include FILE` (optional)
- `ifeq(A,B)` / `ifneq(A,B)` / `ifdef VAR` / `ifndef VAR` / `else` / `endif`
- `$(shell CMD)` -- execute shell command
- `$(wildcard PATTERN)` -- glob expansion
- `$(patsubst FROM,TO,TEXT)` -- pattern substitution
- `$(foreach VAR,LIST,TEXT)` -- iteration
- `$(filter PATTERN,TEXT)` / `$(filter-out PATTERN,TEXT)`
- `$(notdir TEXT)`, `$(dir TEXT)`, `$(basename TEXT)`
- `$(addsuffix SUFFIX,TEXT)`, `$(addprefix PREFIX,TEXT)`
- `$(subst FROM,TO,TEXT)`, `$(strip TEXT)`, `$(sort TEXT)`
- `$(word N,TEXT)`, `$(words TEXT)`, `$(firstword TEXT)`, `$(lastword TEXT)`
- `VPATH` and `vpath pattern directories` for source search paths
- `|` order-only prerequisites
- `@` silent prefix and `-` ignore-error prefix
- Line continuations with backslash
- `-j N` parallel builds
- `--dry-run` mode
- Colored progress output
- Automatic Makefile/makefile/GNUmakefile detection
- Command-line `VAR=VALUE` overrides

### Not Supported (needed for real-world projects)
- **Multi-target rules**: `foo.o bar.o: common.c` (where each output uses the same recipe)
- **Double-colon rules**: `target::` for independent recipes on the same target
- **$(eval ...)**: dynamic Makefile content generation
- **$(call NAME,ARGS)**: user-defined function calls
- **$(value VAR)**: unexpanded variable value
- **$(origin VAR)**: where a variable was defined
- **$(error MSG)** / **$(warning MSG)** / **$(info MSG)**: diagnostic functions
- **$(realpath ...)** / **$(abspath ...)**: path canonicalization
- **Implicit rules database**: built-in rules for `.c` -> `.o`, `.cpp` -> `.o`, etc.
  Real make has ~100 built-in implicit rules.
- **Suffix rules**: `.c.o:` old-style implicit rules
- **Archive members**: `libfoo.a(bar.o)` as targets
- **Job server protocol**: `-j` with sub-make coordination via pipe file descriptors
- **Target-specific variables**: `target: VAR = value`
- **Pattern-specific variables**: `%.o: CFLAGS += -fPIC`
- **Secondary expansion**: `.SECONDEXPANSION:` for dependency computation
- **Order-only prerequisites** in pattern rules
- **MAKEFLAGS** / **MAKELEVEL** propagation for recursive make
- **-k (keep going)**: continue building other targets after failure
- **MAKECMDGOALS**: targets specified on command line
- **export / unexport**: control environment variable propagation to sub-makes

## Building Real-World Projects (like Linux kernel)

The Linux kernel Makefile (Kbuild) uses these advanced features extensively:

1. **$(eval)** and **$(call)**: Kbuild defines complex macros for module building.
   Nearly impossible to support without a full Turing-complete evaluator.

2. **Target-specific variables**: per-directory CFLAGS overrides.

3. **Recursive make**: `$(MAKE) -C subdir`. Our `$(MAKE)` expansion is basic;
   proper recursive make needs MAKEFLAGS propagation and job server.

4. **Implicit rules database**: Kbuild overrides default implicit rules.
   Without the built-in database, many implicit behaviors break.

5. **$(shell)** heavy usage: kernel uses shell commands for config detection,
   version stamping, and architecture-specific flags.

6. **include**: Kbuild includes hundreds of `*.mk` fragments.
   Our include is functional but path resolution may differ.

## Cross-Compilation Considerations for SimpleOS

- On SimpleOS, `$(shell ...)` requires a shell binary. If SimpleOS doesn't have
  `/bin/sh`, recipes using `$(shell)` will fail. Consider a built-in subset of
  shell functionality.
- `VPATH` search uses `fs.exists()`. Ensure SimpleOS VFS supports the expected
  path resolution behavior.
- The `wildcard` function shells out to `ls -d`. A native glob implementation
  would be more portable.
- For cross-compiling TO SimpleOS: set `CC=clang --target=<triple>` on the
  command line. The `?=` assignment ensures command-line overrides work.
- Colored output uses ANSI escape codes. SimpleOS console must support them,
  or use `--no-color`.
- Parallel execution (`-j N`) relies on `process.run()` which spawns OS
  processes. On SimpleOS, this requires the scheduler and process subsystem.
- `$(MAKE)` for recursive make currently expands to the literal string `make`.
  On SimpleOS, this should expand to the path of `simple_make_enhanced` itself.
