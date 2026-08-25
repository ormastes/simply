# Debug Agent - Debugging and Troubleshooting

**Use when:** Investigating bugs, analyzing errors, profiling, debugging runtime behavior.
**Skills:** `/debug`, `/mcp-failure-analysis`

## Quick Debugging

```bash
# Run with logging
SIMPLE_LOG=debug bin/simple file.spl

# Run with verbose output
bin/simple --verbose file.spl

# Run with timeout (prevent infinite loops)
SIMPLE_TIMEOUT_SECONDS=30 bin/simple file.spl
```

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `SIMPLE_LOG` | warn | Log level (trace/debug/info/warn/error) |
| `SIMPLE_TIMEOUT_SECONDS` | 0 (off) | Wall-clock timeout |
| `SIMPLE_EXECUTION_LIMIT` | 10000000 | Instruction count limit |
| `SIMPLE_MAX_RECURSION_DEPTH` | 1000 | Max call depth |
| `SIMPLE_STACK_OVERFLOW_DETECTION` | debug=on | Recursion depth check |
| `SIMPLE_LEAK_DETECTION` | false | Heap growth heuristic |
| `SIMPLE_GC_LOG` | off | GC diagnostics |

## IR Export

```bash
bin/simple --emit-ast=ast.json file.spl   # AST
bin/simple --emit-hir=hir.json file.spl   # Type-checked IR
bin/simple --emit-mir=mir.json file.spl   # Mid-level IR
```

## Common Runtime Errors

| Error | Cause | Fix |
|-------|-------|-----|
| "cannot iterate over this type" | Iterating over nil | Add nil guard before loop |
| "expected expression, found Indent" | try/catch used | Remove exceptions, use Option pattern |
| "expected identifier, found Lt" | Generics `<>` in runtime | Generics are compiled-only |
| "expected expression, found Newline" | Multi-line boolean | Use intermediate variables |
| "join target must be an actor" | `join` as function name | Rename to `path_join` etc. |
| "function not found" | Imported class constructor | Use local helper function |

## MCP-Based Debugging

```bash
# Start MCP server for interactive analysis
bin/simple src/app/mcp/main.spl server --debug

# Read/analyze files
bin/simple src/app/mcp/main.spl read src/compiler/driver.spl
bin/simple src/app/mcp/main.spl search "pattern"
```

## Bug Database

```bash
# View bugs
cat doc/08_tracking/bug/bug_db.sdn

# Add bug
bin/simple bug-add --id=bug_042 --reproducible-by=test_name

# Generate report
bin/simple bug-gen
```

## Debugging Workflow

1. **Reproduce:** Create minimal test case
2. **Isolate:** Use SIMPLE_LOG to trace execution
3. **Identify:** Check common runtime limitations (see code agent)
4. **Fix:** Apply workaround or fix root cause
5. **Verify:** Run test to confirm fix

## Active Session Debugging (DAP+LSP)

For interactive debugging with breakpoints and LSP-enriched inspection,
use the `debug-analyst` agent or read the `/debug-lsp` skill.

Quick-start: `debug_create_session` → `debug_set_breakpoint` → `debug_continue` →
`debug_stack_trace` + `debug_get_variables` → enrich with `simple_hover` / `simple_workspace_symbols`.
See `/debug-lsp` for full chain patterns.

## See Also

- `/debug` - Full debugging guide with all techniques
- `/debug-lsp` - DAP+LSP chaining patterns for active session analysis
- `/mcp-failure-analysis` - MCP tools for failure analysis
- Use `debug-analyst` agent for interactive session debugging with LSP enrichment
- `doc/08_tracking/bug/bug_db.sdn` - Bug tracking database
