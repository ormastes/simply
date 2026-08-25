# Machine Learning Examples

Neural networks and deep learning in Pure Simple.

## Pure NN (`pure_nn/`)

100% Pure Simple neural network implementation - zero external dependencies.

### Structure

1. **01_basics/** - Fundamental concepts
   - Autograd (automatic differentiation)
   - Simple regression
   - XOR minimal example

2. **02_layers/** - Network architecture
   - Layer composition
   - Training infrastructure

3. **03_training/** - Complete training pipelines
   - XOR training
   - Iris classification

4. **04_complete/** - Full end-to-end examples
   - Complete pipeline demonstration

5. **runtime_compatible/** - No-generics versions
   - All examples ported to work in interpreter mode
   - See README_RUNTIME.md for differences

## Torch (`torch/`)

PyTorch-like API built on Simple's tensor operations.

- **basics/** - Tensor operations
- **training/** - Training loops
- **inference/** - Model inference
- **data/** - Data loading and preprocessing
- **advanced/** - Advanced techniques
