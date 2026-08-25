# Development Tooling Examples

Debugging, testing, backends, and library management.

## Debugging (`debugging/`)
- **factorial_debug.spl** - Debugger demonstration with breakpoints

## Testing (`testing/`)
- **test_attributes.spl** - Test attribute system examples

## Backends (`backends/`)
Compiler backend selection and modes:
- **backend_switching.spl** - Switch between backends (interpreter, JIT, native)
- **jit_compiler.spl** - JIT compilation demonstration
- **interpreter_modes.spl** - Different interpreter modes
- **pure_runtime.spl** - Pure runtime execution
- **pure_simple.spl** - Pure Simple execution
- **real_impl.spl** - Real implementation examples
- **unified_execution.spl** - Unified execution model

## Libraries (`libraries/`)
- **create_sample_library.spl** - Create a library
- **external_compression/** - Optional native zlib bridge built with CMake and loaded from compiled Simple code
- **lib_smf/** - Bundle and load SMF libraries
- **link_with_libraries.spl** - Link against libraries
- **load_from_library.spl** - Dynamic library loading
- **test_lib_with_objects.spl** - Library with object files
