# Infra Agent - MCP, Database, Stdlib Infrastructure

**Use when:** Working on MCP servers, database library, stdlib modules, SFFI wrappers.
**Skills:** `/mcp`, `/database`, `/stdlib`, `/sffi`

## MCP Servers

### simple-mcp (Code Analysis)
- **Location:** `src/app/mcp/main.spl`
- **Binary:** `bin/simple_mcp_server`
- **Tools:** read_code, list_files, search_code, file_info, bugdb_*
- **Resources:** File, symbol, type, documentation, directory tree
- **Config:** `.mcp.json`

### git-mcp (Version Control)
- **Location:** `src/app/mcp_jj/main.spl`
- **Binary:** `bin/release/simple src/app/mcp_jj/main.spl server`
- **Tools:** git_* tools for version control operations
- **Resources:** git://status, git://log, git://branches
- **Env:** `GIT_MCP_REPO_PATH` must point to git repo directory

### MCP Protocol Notes
- JSON-RPC 2.0 over stdio with Content-Length framing
- Notifications (no `id`) must be silently handled
- `notifications/initialized` must not return error
- `env_get()` returns `nil` (not `""`) for missing env vars

## Database Library

**Location:** `src/lib/database/`

### Core Components
- `StringInterner` - O(1) string deduplication
- `SdnTable` - Columnar row storage with schema
- `SdnDatabase` - Multi-table persistence (SDN format)
- `QueryBuilder` - Fluent API (filter, sort, limit)
- `FileLock` - Atomic operations with 2-hour stale detection

### Domain Databases
- `BugDatabase` - Bug tracking (P0-P3 severity)
- `TestDatabase` - Test results and timing
- `FeatureDatabase` - Feature tracking

### Usage Pattern
```simple
use lib.database.mod.{SdnDatabase, SdnTable, SdnRow}

var db = SdnDatabase.new("/path/to/db.sdn")
var table = SdnTable.new("users", ["id", "name"])
# Add rows, query, save...
db.save()
```

## Stdlib Modules

| Module | Location | Functions |
|--------|----------|-----------|
| String | `src/lib/text.spl` | String utilities |
| Math | `src/lib/math.spl` | Math functions |
| Path | `src/lib/path.spl` | Path utilities (13 functions) |
| Array | `src/lib/array.spl` | Collection methods |
| Platform | `src/lib/platform/mod.spl` | Cross-platform support |
| Spec | `src/lib/spec.spl` | SPipe test framework |

## SFFI Patterns

### Two-Tier (Runtime)
```simple
extern fn rt_file_read_text(path: text) -> text
fn file_read(path: text) -> text:
    rt_file_read_text(path)
```

### Three-Tier (External libs)
Tier 1 (C++/Rust) -> Tier 2 (`extern fn`) -> Tier 3 (Simple API)

**Main SFFI module:** `src/app/io/mod.spl` (File, Dir, Env, Process, Time, System)

## See Also

- `/mcp` - Full MCP server guide
- `/database` - Database library guide
- `/stdlib` - Stdlib development guide
- `/sffi` - FFI wrapper patterns
