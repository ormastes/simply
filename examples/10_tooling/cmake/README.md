# simple_cmake -- CMake-like Build Configuration Generator

A SimpleOS-native CMake subset that parses `CMakeLists.txt` files and generates
Makefile or Ninja build files. Designed to run ON SimpleOS without requiring
a host CMake installation.

## Usage

```bash
# Generate Makefile (default)
bin/simple run examples/cmake/simple_cmake.spl -- -S path/to/project -B build

# Generate build.ninja
bin/simple run examples/cmake/simple_cmake.spl -- -S path/to/project -B build -G Ninja

# Use example project
bin/simple run examples/cmake/simple_cmake.spl -- -S examples/cmake/example -B /tmp/build
```

## Supported CMake Commands

| Command | Example |
|---------|---------|
| `cmake_minimum_required` | `cmake_minimum_required(VERSION 3.10)` |
| `project` | `project(MyApp LANGUAGES C CXX)` |
| `add_executable` | `add_executable(app main.c util.c)` |
| `add_library` | `add_library(mylib STATIC foo.c bar.c)` |
| `target_link_libraries` | `target_link_libraries(app mylib pthread)` |
| `target_include_directories` | `target_include_directories(app PUBLIC include/)` |
| `set` | `set(CC clang)` |
| `if/else/endif` | `if(USE_LTO) ... else() ... endif()` |
| `message` | `message(STATUS "Building...")` |
| `option` | `option(USE_LTO "Enable LTO" OFF)` |
| `find_program` | `find_program(CLANG_PATH clang)` |
| `find_library` | `find_library(MATH_LIB m)` |

## Generators

- **Make** (default): produces a standard Makefile
- **Ninja**: produces a `build.ninja` file

## Files

- `simple_cmake.spl` -- Main entry point and CLI
- `cmake_parser.spl` -- CMakeLists.txt tokenizer and parser
- `cmake_generator.spl` -- Makefile / Ninja output generator
