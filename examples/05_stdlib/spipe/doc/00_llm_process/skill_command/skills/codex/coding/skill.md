<!-- llm-process-gen: managed source=codex_coding_skill source_sha256=992225248d2e51f42a523da7bc987a83ecaef1293d3fe8819e6f7cfb96514e60 content_sha256=992225248d2e51f42a523da7bc987a83ecaef1293d3fe8819e6f7cfb96514e60 -->
---
name: coding
description: "Simple language coding rules for Codex. Key syntax, generics, pattern binding, constructors, runtime limitations, reserved keywords. Reference: doc/07_guide/quick_reference/syntax_quick_reference.md."
---

# Coding — Simple Language Rules for Codex

**Cooperative Phase:** All phases (always active when writing code)
**Self-sufficient.** Reference rules for any code-writing task.

## Reference

Full syntax: `doc/07_guide/quick_reference/syntax_quick_reference.md`

## Core Syntax

### Variables

```simple
val name = "Alice"             # Immutable (preferred)
name := "Alice"                # Walrus operator (:= is val synonym)
var count = 0                  # Mutable
```

### Strings

```simple
print "Hello, {name}!"        # String interpolation (default)
print r"raw: \d+"              # Raw string (no interpolation)
```

### Functions

```simple
fn square(x):
    x * x                      # Implicit return

fn add(a: i64, b: i64) -> i64:
    a + b
```

### Generics

**Use `<>` not `[]`:**
```simple
Option<T>
List<Int>
Map<String, Int>
Result<T, E>
```

### Classes (NO INHERITANCE)

```simple
class Point:
    x: i64
    y: i64
    fn get_x() -> i64: self.x          # Immutable method
    me move(dx: i64):                   # Mutable method ('me' keyword)
        self.x = self.x + dx
    static fn origin() -> Point:        # Static method
        Point(x: 0, y: 0)
```

**`class Child(Parent)` is NOT supported.** Use:
- Composition
- Alias forwarding
- Traits
- Mixins

### Constructors

```simple
Point(x: 3, y: 4)             # Named fields — NOT .new()
```

### Pattern Binding

```simple
if val x = optional_value:     # NOT 'if let'
    process(x)
```

### Error Handling

```simple
# Use Result<T, E> + ? operator (no try/catch/throw)
fn read_file(path: text) -> Result<text, Error>:
    val content = fs.read(path)?
    Ok(content)
```

### Match

```simple
match value:
    Some(x): process(x)
    nil: ()                    # Unit value
```

### Lambdas

```simple
items.map(\x: x * 2)          # Lambda
items.map(_ * 2)               # Placeholder lambda
items.map(_1 * 10)             # Numbered placeholder
words.map(&:len)               # Method reference
```

### Comprehensions

```simple
[for x in 0..10 if x % 2 == 0: x]
```

### Optional Chaining

```simple
user?.name ?? "Anonymous"      # Optional chaining + nil coalescing
```

### Operators

```simple
x |> transform                 # Pipe
f >> g                         # Compose
layer1 ~> layer2               # Layer connect
2 ** 10                        # Power
m{ x^2 + y^2 }                # Math block
```

### Pass Variants

```simple
pass_todo("what remains", "hint or issue")
pass_do_nothing("why no-op is correct")
pass_dn("why no-op is correct")
todo("what remains", "hint or issue")
case _("why catch-all is correct"):
pass                           # Generic no-op
```

### Type Aliases

```simple
type Point2D = Point           # Type alias
alias Optional = Option        # Class alias
```

## Runtime Limitations (CRITICAL)

| Issue | Workaround |
|-------|-----------|
| Multi-line booleans | Wrap in parentheses: `if (a and\n   b):` |
| Nested closure capture | Can READ outer vars, CANNOT MODIFY (module closures work fine) |
| Chained methods broken | Use intermediate `var` |
| `?` in names | Not allowed — `?` is operator only; use `.?` over `is_*` predicates |

## Reserved Keywords

These CANNOT be used as identifiers:

`gen`, `val`, `def`, `exists`, `actor`, `assert`, `join`, `pass_todo`, `pass_do_nothing`, `pass_dn`

## File Organization

- All code in `.spl` files
- Shell scripts in `.shs` files (only for container entrypoints)
- Config/data in SDN format (not JSON/YAML)
- No Python, no Bash scripts (except 3 bootstrap scripts in `scripts/`)
- Files > 800 lines must be split

## Import Conventions

```simple
use std.io                     # Standard library (preferred)
use lib.common.text            # Also works (std -> lib internally)
```

`use std.X` and `use lib.X` both resolve from `src/lib/`. Prefer `use std.X` in new code.

## TODO Rules

- NEVER convert TODO/FIXME to NOTE — that hides work
- Either implement the TODO or delete the code entirely
- If a TODO cannot be implemented yet, leave it as TODO

## Code Quality

- NEVER over-engineer — only make requested changes
- NEVER add unused code — delete completely
- STUB001 = hard fail — no `pass_todo` in production code
