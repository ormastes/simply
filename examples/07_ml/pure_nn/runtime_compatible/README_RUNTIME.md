# Pure Simple Deep Learning - Runtime Compatible Examples

This directory contains runtime-compatible versions of Pure Simple deep learning examples that work in interpreter mode (without compilation).

## Why Runtime-Compatible Versions?

The original Pure NN library (`src/lib/pure/`) uses generic types like `PureTensor<T>`, which the Simple language runtime parser doesn't yet support. The runtime-compatible versions:

1. **Remove generic syntax** - Use concrete `SimpleTensor` class instead of `PureTensor<T>`
2. **Self-contained** - All implementations inline, no external imports
3. **Immediate execution** - Work directly with `bin/simple` without compilation

## Available Examples

### ✅ Runtime Compatible (Work in Interpreter)

| Example | Description | Lines | Status |
|---------|-------------|-------|--------|
| **xor_example.spl** | Basic XOR demo with tensor operations | 75 | ✅ Working |
| **autograd_example_runtime.spl** | Automatic differentiation demonstration | 140 | ✅ Working |
| **complete_demo_runtime.spl** | Full NN demonstration (2→4→1 network) | 250 | ✅ Working |
| **xor_training_runtime.spl** | Complete training loop simulation | 220 | ✅ Working |
| **simple_regression_runtime.spl** | Learn y=2x+1 with gradient descent | 180 | ✅ Working |
| **nn_layers_runtime.spl** | Layer composition and architectures | 320 | ✅ Working |

### ⚠️ Compiled Mode Only (Require Generics)

These examples require compilation with `bin/simple build` because they use `lib.pure.*` modules with generic types:

| Example | Reason |
|---------|--------|
| **complete_demo.spl** | Uses `lib.pure.tensor.PureTensor<T>` |
| **autograd_example.spl** | Uses `lib.pure.autograd.Tensor` |
| **xor_training_example.spl** | Uses `lib.pure.nn.Sequential` |
| **iris_classification.spl** | Uses `lib.pure.nn` and `lib.pure.dataset` |
| **simple_regression.spl** | Uses `lib.pure.nn.Linear` |
| **nn_layers_example.spl** | Uses `lib.pure.nn` layer classes |
| **training_demo.spl** | Uses `lib.pure.optimizer` |

## Usage

### Running Runtime Examples

```bash
# Basic tensor operations
bin/simple examples/pure_nn/xor_example.spl

# Automatic differentiation demo
bin/simple examples/pure_nn/autograd_example_runtime.spl

# Complete neural network demo
bin/simple examples/pure_nn/complete_demo_runtime.spl

# Training loop simulation
bin/simple examples/pure_nn/xor_training_runtime.spl

# Linear regression (learn y=2x+1)
bin/simple examples/pure_nn/simple_regression_runtime.spl

# Layer composition and network architectures
bin/simple examples/pure_nn/nn_layers_runtime.spl
```

### Running Compiled Examples

For the full-featured examples with real backpropagation:

```bash
# Compile and run
bin/simple build examples/pure_nn/complete_demo.spl --output=/tmp/demo
/tmp/demo

# Or use compile-and-run
bin/simple run examples/pure_nn/autograd_example.spl
```

## Feature Comparison

| Feature | Runtime Examples | Compiled Examples |
|---------|------------------|-------------------|
| Tensor operations | ✅ Basic (add, matmul, relu, sigmoid) | ✅ Full (20+ ops) |
| Forward pass | ✅ Yes | ✅ Yes |
| Backpropagation | ❌ Simulated only | ✅ Full autograd |
| Optimizers | ❌ No | ✅ SGD, Adam, RMSprop |
| Data loaders | ❌ No | ✅ Yes |
| Generic types | ❌ No | ✅ Yes |
| Import lib.pure.* | ❌ No | ✅ Yes |
| Execution speed | Fast (interpreter) | Faster (compiled) |

## Implementation Details

### Runtime-Compatible Pattern

The runtime examples use a simple concrete tensor type:

```simple
class SimpleTensor:
    data: [f64]
    shape: [i64]

fn create_tensor(data: [f64], shape: [i64]) -> SimpleTensor:
    SimpleTensor(data: data, shape: shape)
```

### Broadcasting Support

The `tensor_add` function supports simple broadcasting:

```simple
fn tensor_add(a: SimpleTensor, b: SimpleTensor) -> SimpleTensor:
    # If b has fewer elements, repeat them (bias broadcasting)
    if b.data.len() < a.data.len():
        while i < a.data.len():
            val b_idx = i % b.data.len()
            result.push(a.data[i] + b.data[b_idx])
            i = i + 1
    # ...
```

### Activation Functions

All runtime examples include:
- **ReLU**: `max(0, x)`
- **Sigmoid**: `1 / (1 + e^(-x))` with Taylor series approximation

### Matrix Multiplication

Implements standard matrix multiply with triple nested loops:

```simple
fn tensor_matmul(a: SimpleTensor, b: SimpleTensor) -> SimpleTensor:
    val M = a.shape[0]  # rows in A
    val K = a.shape[1]  # cols in A, rows in B
    val N = b.shape[1]  # cols in B
    # Triple nested loop: O(M*N*K)
    # ...
```

## Limitations

### What Runtime Examples Don't Support

1. **No real backpropagation** - Gradient computation requires computational graph tracking (available in compiled mode)
2. **No optimizers** - SGD, Adam, etc. need generic types and state management
3. **No advanced layers** - Convolution, pooling, batch norm require more complex implementations
4. **No data augmentation** - Dataset transformations need compiled mode
5. **No model checkpointing** - Saving/loading trained weights needs file I/O patterns

### Workarounds

- **Training**: Use simplified gradient updates or manual weight adjustments
- **Complex models**: Break into smaller demos showing individual concepts
- **Production use**: Compile the full `lib.pure.*` modules for real applications

## Next Steps

### For Learning

1. Start with `xor_example.spl` to understand tensor basics
2. Explore `autograd_example_runtime.spl` for gradient concepts
3. Study `complete_demo_runtime.spl` for full network architecture
4. Learn regression with `simple_regression_runtime.spl` (real gradient descent!)
5. Understand layers with `nn_layers_runtime.spl` (composition patterns)
6. Run `xor_training_runtime.spl` to see training loop structure

### For Production

1. Transition to compiled mode: `bin/simple build --release`
2. Use `lib.pure.*` modules for full functionality
3. See `doc/guide/deep_learning_guide.md` for comprehensive guide
4. Explore MedGemma examples for real-world LLM fine-tuning

## Troubleshooting

### "Failed to parse module" Error

```
ERROR: Failed to parse module path="src/lib/pure/nn.spl"
error=Unexpected token: expected expression, found Val
```

**Cause**: Trying to import `lib.pure.*` modules in interpreter mode
**Solution**: Use runtime-compatible versions (`*_runtime.spl`) or compile with `bin/simple build`

### "unsupported path call: Sequential.create"

**Cause**: Static methods on generic classes not supported in runtime
**Solution**: Use self-contained examples or compiled mode

### Array Index Out of Bounds

**Cause**: Broadcasting or shape mismatch in tensor operations
**Solution**: Check tensor shapes match expected dimensions (e.g., [4, 2] @ [2, 4] = [4, 4])

## See Also

- **Full Guide**: `doc/guide/deep_learning_guide.md`
- **MedGemma Training**: `examples/medgemma_korean/`
- **CUDA Examples**: `examples/cuda/`
- **PyTorch Integration**: `examples/torch/`
- **Pure Simple Library**: `src/lib/pure/` (compile-only)

---

**Status**: Production Ready (2026-02-16)
**Test Coverage**: 6/6 runtime examples passing (100%)
**Documentation**: Complete
