# Code Agent - Writing Simple Language Code

**Use when:** Writing new code, editing existing code, implementing features, fixing bugs.
**Skills:** `/coding`, `/design`, `/sffi`

## Key Rules

- **100% Pure Simple** - No Rust. All code in `.spl` files.
- **Immutable by default:** `val x = 5` (preferred), `var x = 5` (when mutation needed)
- **Implicit self:** Methods use `fn` (read-only) or `me` (mutable), self is implicit in signature but explicit in body (`self.field`)
- **Static methods:** `static fn name()` - no self access
- **Generics:** Use `<>` not `[]` - `Option<T>`, `List<Int>`
- **No `pub fn`:** Functions are public by default. Use `_prefix` for private.
- **Strings:** Double-quoted = interpolated (`"Hello {name}"`), single-quoted = raw
- **Constructors:** `Point(x: 3, y: 4)` (direct), not `.new()`
- **Pattern binding:** `if val Some(x) = expr:` (not `if let`)
- **Empty body:** Use `()` or `pass`

## Runtime Limitations (CRITICAL)

- **NO exceptions** - no try/catch/throw
- **NO generics in runtime parser** - `<>` syntax fails at runtime
- **NO multi-line boolean expressions** - use intermediate variables
- **Closure variable capture broken** - can READ outer vars, CANNOT MODIFY them
- **Module function closures broken** - imported functions can't access module-level state
- **Chained method calls broken** - use intermediate `var`
- **Reserved keywords:** `gen`, `val`, `def`, `exists`, `actor`, `assert`, `join`
- **`[:var]` parsed as symbol** - always use `s[0:idx]`

## Method Syntax

```simple
class Counter:
    value: i64

impl Counter:
    static fn create() -> Counter:
        Counter(value: 0)
    fn get_value() -> i64:
        self.value
    me increment():
        self.value = self.value + 1
```

## Lambda Shorthand

```simple
# Placeholder lambdas — each _ becomes a parameter
items.map(_ * 2)            # \__p0: __p0 * 2
items.filter(_ > 3)         # \__p0: __p0 > 3
items.reduce(_ + _)         # \__p0, __p1: __p0 + __p1

# Numbered placeholders — 1-indexed, allows reorder
items.reduce(_2 - _1)       # \__p0, __p1: __p1 - __p0

# Method reference — zero-arg methods
items.map(&:len)            # \__p0: __p0.len()

# Curry/partial (from std.common.functions)
val add5 = curry2(\a, b: a + b)(5)
val mul3 = partial1(\a, b: a * b, 3)
```

- **Nested scoping:** call args are independent transform boundaries
- **Don't mix** `_` and `_1`/`_2` in the same expression

## SFFI Pattern (Two-Tier)

```simple
extern fn rt_file_read_text(path: text) -> text  # Tier 1: Runtime binding
fn file_read(path: text) -> text:                 # Tier 2: Simple wrapper
    rt_file_read_text(path)
```

## File Locations

- I/O: `src/app/io/mod.spl`
- CLI: `src/app/cli/main.spl`
- Stdlib + libs: `src/lib/` (use `std.X` imports — resolver maps `std` to `lib`)
- Apps: `src/app/`

## See Also

- `/coding` - Full language rules and common mistakes
- `/design` - Design principles and type system
- `/sffi` - FFI wrapper patterns
- `doc/07_guide/quick_reference/syntax_quick_reference.md` - Complete syntax reference
