# Debug Analyst Agent - Interactive DAP+LSP Session Analysis

**Use when:** Actively debugging a running session with breakpoints and LSP-enriched inspection. For log-based debugging (env vars, IR export, bug database), use the `debug` agent instead.
**Skills:** `/debug-lsp`, `/debug`

## Session Lifecycle

| Phase | Tools | When |
|-------|-------|------|
| **Create** | `debug_create_session(program, target_type)` | Start of investigation |
| **Instrument** | `debug_set_breakpoint(file, line)` | Before running |
| | `debug_set_function_breakpoint(function_name)` | When you know the function but not the line |
| | `debug_set_data_breakpoint(name, access_type)` | Watch variable changes |
| **Run** | `debug_continue` | Resume execution |
| **Inspect** | `debug_stack_trace` → `debug_get_variables` | At every stop |
| **Enrich** | `simple_hover` + `simple_call_hierarchy` + `simple_workspace_symbols` | After every stop |
| **Navigate** | `debug_step(mode=over/in/out)` | Controlled execution |
| **Evaluate** | `debug_evaluate(expression)` | Test hypotheses |
| **Cleanup** | `debug_terminate` → `debug_close_session` | When done |

## LSP Enrichment Rules

After any debug stop (breakpoint hit, step complete):

1. **Always** call `simple_hover` at the paused file+line — understand what's on this line
2. **If unfamiliar function:** `simple_call_hierarchy(direction="incoming")` — who called us?
3. **If unfamiliar type in variables:** `simple_workspace_symbols(query=type_name)` — find definition
4. **Before stepping in:** `debug_get_source(start_line=N, count=15)` + `simple_inlay_hints` — preview upcoming code with type annotations

## Deep Inspect Workflow

1. `debug_get_variables` → list all locals
2. Pick variable of interest → note its `type` field
3. `simple_workspace_symbols(query=type, kind="struct")` → find where type is defined
4. `simple_hover(file, line)` at definition → read fields and docs
5. `debug_evaluate(expression="var.field")` → check specific field values

## Analysis Rules

- **Read source first:** Always call `debug_get_source` before forming theories about what the code does
- **Chain limit:** At most 3 LSP calls per debug stop, then form a hypothesis
- **Type normalization:** Capital letter + no spaces = user-defined type, search with `simple_workspace_symbols`. Lowercase primitives (i64, text, bool, f64) need no lookup
- **Frame walk:** Process stack frames top-down (most recent first). Stop when the call path makes sense
- **Stub awareness:** Current MCP debug server is lightweight — variables may be empty, frames synthetic. Focus on LSP enrichment of known file positions

## Reporting Format

After each analysis cycle, report:

```
**Paused at:** `file.spl:42` in `function_name`
**Variables:** name=value (type), ...
**Type definitions found:** TypeName at file:line — fields: ...
**Call path:** caller → caller → current_function
**Hypothesis:** What likely caused this state
**Suggested action:** Step into X / Set breakpoint at Y / Inspect variable Z
```

## See Also

- `/debug-lsp` — Full DAP+LSP chaining patterns (5 patterns, 3 workflows)
- `/debug` — Log-based debugging, environment variables, IR export
- `src/app/mcp/main_lazy_debug_tools.spl` — DAP tool implementation
- `src/app/mcp/main_lazy_query_tools.spl` — LSP tool implementation
