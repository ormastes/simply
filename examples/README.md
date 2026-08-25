# Simple Language Examples

**209 examples** organized by topic and difficulty.

## 📚 Learning Path (Categories 01-11)

### 01. [Getting Started](01_getting_started/)
First programs for new Simple users
- Hello world examples
- Basic compilation and execution

### 02. [Language Features](02_language_features/)
Syntax and language capabilities
- Custom blocks
- Static polymorphism
- Aspect-oriented programming (AOP)
- Execution contexts

### 03. [Concurrency](03_concurrency/)
Parallel execution patterns
- Async/await basics
- Actor model
- Concurrency modes (threads, async, actors)

### 04. [Data Formats](04_data_formats/)
Serialization and encoding
- SDN (Simple Data Notation) parsing
- CBOR encoding

### 05. [Standard Library](05_stdlib/)
Stdlib features and utilities
- Platform abstraction layer
- Cross-platform code
- String, array, math operations

### 06. [I/O Operations](06_io/)
File, network, graphics, and multimedia
- Memory-mapped file staging
- HTTP client
- 2D graphics and window creation
- Audio playback, gamepad input

### 07. [Machine Learning](07_ml/)
Neural networks in Pure Simple
- **Pure NN** - 100% Pure Simple implementation
  - Basics: autograd, regression, XOR
  - Layers: network architecture
  - Training: complete pipelines
  - Runtime-compatible versions (no generics)
- **Torch** - PyTorch-like API

### 08. [GPU Computing](08_gpu/)
CUDA, GPU patterns, and pipelines
- CUDA kernels (basic, vectorized)
- GPU design patterns
- Async compute pipelines

### 09. [Embedded Systems](09_embedded/)
Baremetal, QEMU, and VHDL
- Baremetal for x86_64, ARM, ARM64, RISC-V
- QEMU unified runner
- VHDL hardware description

### 10. [Development Tooling](10_tooling/)
Debugging, testing, and backends
- Debugger demonstrations
- Test attributes
- Backend switching (interpreter, JIT, native)
- SMF library management

Additional tooling examples:
- `mcpgdb/` - merged C/C++ debugger + clangd MCP example

### 11. [Advanced Topics](11_advanced/)
Compiler internals and optimization
- Optimization examples
- MIR (Middle IR) serialization
- Type inference demonstrations

## 🔬 Experiments

**[experiments/](experiments/)** - Work-in-progress and research prototypes

⚠️ These examples may be incomplete or broken. Categories `01-11` are the intended learning path, but current status should be checked with `bin/simple examples-check`.

## 🚀 Full-Scale Projects

**[projects/](projects/)** - Complete applications
- **MedGemma Korean** - Korean medical language model

## 📖 Usage

### Running Examples

```bash
# Validate a folder or file with safe classification
bin/simple examples-check examples/03_concurrency --run --timeout 5

# Interpreted mode (fast startup)
bin/simple run examples/01_getting_started/hello_native.spl

# Native mode (fast execution)
bin/simple native-build --entry examples/01_getting_started/hello_native.spl -o hello --entry-closure --runtime-bundle auto
./hello

# JIT mode (balanced)
bin/simple run --jit examples/07_ml/pure_nn/01_basics/autograd.spl
```

### Example File Formats

- **`.spl`** - Standard Simple source files
- **`.smf`** - Simple Module Format (compiled modules)
- **`.shs`** - Simple shell scripts

## 🗂️ Organization

Examples are organized by:
1. **Topic** - Clear categorization (ML, GPU, I/O, etc.)
2. **Difficulty** - 01-11 numbered progression
3. **Use Case** - Learning vs Research vs Production

Each category has its own README.md with detailed information.

## ✅ Validation

Use the built-in validator instead of assuming every example in `01-11` currently passes:

```bash
bin/simple examples-check examples
bin/simple examples-check examples/02_language_features --compile --timeout 5
bin/simple examples-check examples/03_concurrency --run --timeout 5
```

The validator classifies results as normal errors, timeouts, or crashes with per-file isolation.

For ordinary native app examples, `native-build --runtime-bundle auto` now
prefers the `simple-core` lane and falls back to `core-c-bootstrap`. Use
`--runtime-bundle rust-hosted` only for examples that still depend on hosted-only
runtime services.

## 📊 Statistics

- **Total files:** 209
- **Learning examples:** ~180 (categories 01-11)
- **Experiments:** ~20
- **Full projects:** 1 (MedGemma Korean)

## 🤝 Contributing

When adding new examples:
1. Choose the appropriate category (01-11 for learning, experiments for WIP)
2. Add README.md if creating a new subcategory
3. Use descriptive filenames (action + context, e.g., `http_client.spl`)
4. Include comments explaining key concepts
5. Test in both interpreted and compiled modes

## 📝 License

Same as Simple language project license.
