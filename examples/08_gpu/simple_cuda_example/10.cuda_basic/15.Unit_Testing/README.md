# 15. Unit Testing - GPU Kernel Testing with SSpec

## Concept

Simple uses SSpec (the built-in BDD test framework) for all testing, including
GPU kernels. There is no separate GPU test runner -- `describe`/`it`/`expect`
work identically for host and device code.

### Testing Strategy

1. **CPU reference implementation** -- Write a plain Simple function that
   computes the expected result on the host.
2. **GPU kernel** -- The `@gpu_kernel` function under test.
3. **Comparison** -- Download the GPU result and compare with the CPU
   reference using `expect(...).to_equal(...)` or a tolerance check.

### SSpec Matchers (built-in)

| Matcher                  | Usage                                   |
|--------------------------|-----------------------------------------|
| `to_equal(expected)`     | Exact equality                          |
| `to_be(expected)`        | Identity (same object)                  |
| `to_be_nil`              | Value is nil                            |
| `to_contain(item)`       | Array / string contains item            |
| `to_start_with(prefix)`  | String starts with prefix               |
| `to_end_with(suffix)`    | String ends with suffix                 |
| `to_be_greater_than(n)`  | Numeric greater-than                    |
| `to_be_less_than(n)`     | Numeric less-than                       |

### GPU-specific patterns

```simple
# Pattern: tolerance comparison for floating-point results
fn close_enough(actual: f32, expected: f32, tol: f32) -> bool:
    val diff = actual - expected
    val abs_diff = if diff < 0.0: 0.0 - diff else: diff
    abs_diff <= tol

it "kernel produces correct results":
    # ... launch kernel, download result ...
    expect(close_enough(result, 42.0, 0.001)).to_equal(true)
```

## Run
```bash
bin/simple test examples/08_gpu/simple_cuda_example/10.cuda_basic/15.Unit_Testing/spec.spl
```

## Try it (verified doctest)
The CPU reference used by the spec, plus the tolerance helper, run without a
device (sum of 1..8 is 36; a block of 256 reduces 1000 elements in 4 blocks):

```sdoctest
>>> val data = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0]
>>> var total = 0.0
>>> for x in data: total = total + x
>>> print "sum = {total}"
sum = 36.0
>>> val blocks = (1000 + 255) / 256
>>> print "{blocks} partial sums"
4 partial sums
```
