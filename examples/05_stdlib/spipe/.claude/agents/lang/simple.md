# Simple Language Agent

**Language:** Simple
**File extensions:** `.spl`, `.shs`
**LSP server:** `simple-lsp-mcp` (already configured in `.mcp.json`)

---

## Build & Test Commands

```bash
bin/simple build                    # Debug build
bin/simple build --release          # Release build
bin/simple test                     # Run all tests
bin/simple test path/to/spec.spl   # Single test file
bin/simple build lint               # Linter
bin/simple build fmt                # Formatter
bin/simple build check              # All checks
bin/simple fix file.spl --dry-run   # Preview auto-fixes
```

## LSP Usage

The `simple-lsp-mcp` MCP server exposes LSP tools directly:
- `lsp_hover`, `lsp_definition`, `lsp_references`, `lsp_completion`
- `lsp_diagnostics`, `lsp_symbols`, `lsp_type_at`
- `lsp_implementation`, `lsp_type_definition`, `lsp_signature_help`

Use these tools to navigate and understand Simple code before editing.

## Style Rules

- **No inheritance** -- use composition, alias forwarding, traits, or mixins
- **`?` is an operator only** -- never use in identifiers; prefer `.?` over `is_*`
- **Constructors:** `Point(x: 3, y: 4)` not `.new()`
- **Pattern binding:** `if val` not `if let`
- **Generics:** `<>` not `[]` -- `Option<T>`, `List<Int>`
- **Immutable by default:** prefer `val` / `:=` over `var`
- **Config/data files:** SDN format, never JSON/YAML
- **ALL code in `.spl` or `.shs`** -- no Python, no Bash
- **Error handling:** `Result<T, E>` + `?` operator (no try/catch/throw)
- **Chained methods:** use intermediate `var` (chaining is broken)
- **Multi-line booleans:** wrap in parentheses
- **Reserved keywords:** `gen`, `val`, `def`, `exists`, `actor`, `assert`, `join`, `pass_todo`, `pass_do_nothing`, `pass_dn`

See `/coding` skill for full rules. See `doc/07_guide/quick_reference/syntax_quick_reference.md` for syntax.

## When To Use This Agent

Dispatch this agent when the task involves:
- Writing or editing `.spl` / `.shs` files
- Implementing features in the Simple compiler or standard library
- Running Simple tests or fixing Simple test failures
- Any work under `src/`, `test/`, or `examples/` that targets Simple code
- SFFI (Simple FFI) wrapper development
