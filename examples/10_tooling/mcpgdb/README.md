# mcpgdb

Merged C/C++ debug MCP example for this repo.

The shipped shape is now split between the example tree and the runtime wrapper:
- `examples/mcpgdb/` contains the example source, schemas, and tests
- `src/app/mcpgdb/main.spl` is the real runnable cold frontend
- `src/app/mcpgdb/debug_runner.spl` and `src/app/mcpgdb/clangd_runner.spl` are the heavy subprocess runners
- session and workspace metadata are persisted under `/tmp`

It provides:
- persistent multi-session debugger control for `gdb`, `lldb`, `openocd_gdb`, and `t32_gdb`
- gated raw debugger commands with backend-specific safety rules
- workspace-scoped clangd tools for definition, references, hover, symbols, completion, type definition, and `clangd --check` diagnostics
- `clangd_open` for starting the workspace language server explicitly
- `debug_disconnect` and `debug_restart` alongside the main execution-control tools
- mutable register and memory tools for the current session

## Run

```bash
bin/simple run src/app/mcpgdb/main.spl
```

Optional environment variables:
- `GDB_BINARY`
- `LLDB_BINARY`
- `CLANGD_BINARY`

## Example MCP flow

1. `workspace_open(root: "/path/to/project")`
2. `clangd_open(root: "/path/to/project")`
3. `debug_session_create(backend: "gdb")`
4. `debug_launch(session_id: "dbg_1", program: "/path/to/app")`
5. `breakpoint_set(session_id: "dbg_1", file: "src/main.cpp", line: "42")`
6. `debug_continue(session_id: "dbg_1")`

For OpenOCD or TRACE32 GDB backends, create the session with `openocd_gdb` or `t32_gdb`, then use `debug_connect_remote`.

Runtime note: the canonical runtime path is now `src/app/mcpgdb/main.spl`. That entrypoint successfully serves `initialize`, `tools/list`, and a representative `tools/call` in this workspace. The `examples/mcpgdb/main.spl` path remains the discoverable example source, but it still inherits the example watchdog and is no longer the recommended way to run the server.
Runtime note: the repo-local wrapper now caches compiled `.smf` runner artifacts by default. If runner compilation fails, execution returns a non-zero exit, or a runner returns malformed output, the wrapper still falls back to source execution for that request.
