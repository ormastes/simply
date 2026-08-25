# simple_cmake -- Porting Notes

## Subset Coverage

This implementation covers a minimal but useful subset of CMake:

### Supported
- `cmake_minimum_required(VERSION X.Y)` -- parsed but not enforced
- `project(NAME)` with `LANGUAGES C CXX`
- `add_executable(name src1.c src2.c ...)`
- `add_library(name STATIC src1.c ...)`
- `target_link_libraries(target lib1 lib2 ...)`
- `target_include_directories(target PUBLIC|PRIVATE dir ...)`
- `set(VAR value)` and `${VAR}` expansion
- `if(VAR)/else()/endif()` -- simple variable truthiness only
- `message(STATUS|WARNING "msg")`
- `option(NAME "desc" DEFAULT)`
- `find_program(VAR name)` -- uses `which`
- `find_library(VAR name)` -- heuristic search in /usr/lib etc.
- Output generators: Makefile and build.ninja

### Not Supported (needed for real-world projects)
- Generator expressions: `$<TARGET_FILE:tgt>`, `$<BOOL:...>`
- `add_subdirectory()` and nested CMakeLists.txt
- `ExternalProject_Add` and FetchContent
- `install()` targets and DESTDIR
- `target_compile_definitions()`, `target_compile_options()`
- `configure_file()` template substitution
- `find_package()` and Find*.cmake modules
- CMake cache persistence (`CMakeCache.txt`)
- Toolchain files (`-DCMAKE_TOOLCHAIN_FILE=...`)
- `IMPORTED` targets and `ALIAS` targets
- `add_custom_command()` / `add_custom_target()`
- `enable_testing()` / `add_test()`
- `list()` operations and `foreach()/endforeach()`
- Complex `if()` expressions: `AND`, `OR`, `NOT`, `STREQUAL`, `VERSION_LESS`
- `file(GLOB ...)`, `file(COPY ...)`, `file(WRITE ...)`
- Properties: `set_target_properties()`, `get_target_property()`

## Building Real-World Projects (like LLVM)

To compile LLVM with simple_cmake, these additional features would be needed:

1. **add_subdirectory** -- LLVM has ~200 CMakeLists.txt files in a tree hierarchy.
   Each subdirectory inherits parent scope variables.

2. **find_package** -- LLVM's CMakeLists.txt calls `find_package(Python3)`,
   `find_package(ZLIB)`, etc. Would need a module-finding system.

3. **Generator expressions** -- heavily used for per-config flags, install paths,
   and target properties. Would need a full expression evaluator.

4. **Toolchain files** -- cross-compilation for SimpleOS targets requires
   `CMAKE_TOOLCHAIN_FILE` with sysroot, compiler, and linker specifications.

5. **configure_file** -- LLVM generates `config.h` and `version.h` from templates.

6. **install()** -- LLVM's build system installs headers, libraries, and binaries
   to a prefix directory.

7. **add_custom_command** -- code generation steps (TableGen, etc.) use custom commands.

## Cross-Compilation Considerations for SimpleOS

- SimpleOS does not have `/usr/lib` or `/usr/local/lib`. `find_library` needs
  sysroot-relative paths via `CMAKE_FIND_ROOT_PATH`.
- SimpleOS cross-compilation should set `CMAKE_SYSTEM_NAME=SimpleOS` and
  `CMAKE_C_COMPILER=clang --target=<triple>`.
- The generated Makefile/Ninja files assume host tools (`ar`, `cc`).
  For cross builds, these must point to cross-toolchain binaries.
- SimpleOS currently uses Cranelift for native compilation. If targeting SimpleOS
  from SimpleOS, the build tools should call `bin/simple native-build` rather
  than `cc`/`clang`.
