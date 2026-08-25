# Debug Skill

## Logging & IR Export

```bash
SIMPLE_LOG=debug bin/simple file.spl                # Debug logging
SIMPLE_LOG=interpreter=trace bin/simple file.spl    # Module-specific
bin/simple --gc-log file.spl                        # GC output
bin/simple --emit-ast=ast.json file.spl             # AST dump
bin/simple --emit-hir=hir.json file.spl             # HIR (type-checked)
bin/simple --emit-mir=mir.json file.spl             # MIR (lowered)
```

## Query Engine Diagnostics

```bash
bin/simple query check <file> --format json          # Type-check + lint
bin/simple query workspace-diagnostics <dir>         # Workspace-wide
bin/simple query hover <file> <line>                 # Type + docs
```

## Fault Detection

| Variable | Purpose |
|----------|---------|
| `SIMPLE_STACK_OVERFLOW_DETECTION` | Recursion depth (default: on in debug) |
| `SIMPLE_MAX_RECURSION_DEPTH` | Max call depth (default: 1000) |
| `SIMPLE_TIMEOUT_SECONDS` | Wall-clock timeout |
| `SIMPLE_EXECUTION_LIMIT` | Instruction count limit |
| `SIMPLE_LEAK_DETECTION` | Heap growth heuristic |

## Common Issues

| Symptom | Action |
|---------|--------|
| Interpreter fallback | `SIMPLE_LOG=debug` |
| Memory issues | `--gc-log` + `SIMPLE_LEAK_DETECTION=1` |
| Type errors | `--emit-hir` for inferred types |
| Pattern failures | `--emit-mir` for PatternTest/PatternBind |

## DAP+LSP Chaining

Chain runtime state (DAP) with static analysis (LSP) via **file + line**.

```
debug_stack_trace → frames[0].source, line
  → bin/simple query hover <file> <line>
  → bin/simple query references <file> <line>
```

### Patterns
- **Variable → Type**: `debug_get_variables` → type name → `query workspace-symbols --query <type>` → `query hover`
- **Frame → Callers**: `debug_stack_trace` → `query call-hierarchy <file> <line> --direction incoming`
- **Next-line**: `debug_get_source(count=20)` → `query hover` + `query inlay-hints` on upcoming code
- **Post-crash**: `stack_trace` → `get_variables` → `query hover` at crash line → `query definition`

### DAP MCP Tools
Session: `debug_create_session`, `debug_terminate`
Control: `debug_continue`, `debug_step`, `debug_set_breakpoint`
Inspect: `debug_stack_trace`, `debug_get_variables`, `debug_evaluate`, `debug_watch`
Logging: `debug_log_enable(pattern)`, `debug_log_query`, `debug_log_tree`

## Bootstrap Debugging

```bash
scripts/capture_bootstrap_debug.sh     # Capture output
scripts/bootstrap.sh --stage=1         # Specific stage
scripts/bootstrap.sh --verify          # Verify determinism
```

Workflow: Capture → check HIR count at phase 3 vs phase 5 → register bug → fix & verify.
