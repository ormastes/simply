# ML Agent - Machine Learning and Deep Learning

**Use when:** Working on ML features, training pipelines, neural networks, dimension checking.
**Skills:** `/deeplearning`

## Key Features

- **Config system:** YAML-based experiment configuration
- **Training loops:** Event-driven with validation checkpoints
- **LoRA fine-tuning:** Progressive parameter-efficient adaptation
- **Dimension checking:** Compile-time validation via `~>` operator
- **Pipeline operators:** `|>` (pipe), `~>` (layer connect), `//` (parallel)

## Neural Network Pipeline

```simple
# Layer connection with dimension checking
model = Linear(784, 256) ~> ReLU() ~> Linear(256, 10)
# Type: Layer<[batch, 784], [batch, 10]>

# Compile-time error on mismatch:
bad = Linear(784, 256) ~> Linear(128, 64)
# ERROR[E0502]: output [batch, 256] != input [batch, 128]
```

## Data Processing Pipeline

```simple
result = data |> normalize |> transform |> predict
preprocess = normalize >> augment >> to_tensor
```

## Math Blocks

```simple
# Inside m{}: ^ is power operator
formula = m{ x^2 + 2*x*y + y^2 }

# Outside m{}: use ** for power
result = x ** 2
```

## See Also

- `/deeplearning` - Full ML infrastructure guide
- `doc/05_design/pipeline_operators_design.md`
- `doc/07_guide/deep_learning/tensor_dimensions.md`
