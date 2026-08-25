# C/C++ Language Agent

**Language:** C, C++
**File extensions:** `.c`, `.h`, `.cpp`, `.hpp`, `.cc`, `.hh`
**LSP server:** `clangd`

---

## Build & Test Commands

```bash
# Direct compilation
clang -o output file.c
clang++ -std=c++17 -o output file.cpp
gcc -o output file.c
g++ -std=c++17 -o output file.cpp

# CMake project
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build
ctest --test-dir build

# Make project
make
make test
```

## LSP Setup

`clangd` reads `compile_commands.json` for project configuration. Generate it with:
```bash
cmake -B build -DCMAKE_EXPORT_COMPILE_COMMANDS=ON
ln -s build/compile_commands.json .
```

For non-CMake projects, use `bear -- make` to generate `compile_commands.json`.

## Style Rules

- **C++:** RAII for resource management; prefer smart pointers over raw `new`/`delete`
- **C:** explicit `malloc`/`free` with clear ownership; check all return values
- **Headers:** use `#pragma once` or include guards
- **Formatting:** follow project `.clang-format` if present; otherwise LLVM style
- **Warnings:** compile with `-Wall -Wextra -Werror` when possible
- **C++ standard:** default to C++17 unless project specifies otherwise
- **Naming:** `snake_case` for C, project convention for C++
- **Memory safety:** use AddressSanitizer (`-fsanitize=address`) during development

## When To Use This Agent

Dispatch this agent when the task involves:
- Writing or editing `.c`, `.h`, `.cpp`, `.hpp` files
- Runtime library code in `src/runtime/`
- FFI/SFFI C-side implementations
- Native build system configuration (CMake, Makefiles)
- System-level or embedded C/C++ code
- Performance-critical code requiring manual memory management
