# Bug Report: Obsidian Search MCP — Interpreter Limitations & Workarounds

**Date:** 2026-03-16
**Component:** Obsidian Search MCP Server
**Severity:** Workaround-required — all issues have applied mitigations

---

## L-1: SQLite SFFI Not Available in Interpreter Runtime

**Impact:** Cannot use SQLite FTS5 for full-text search or structured storage.
**Root Cause:** The `sqlite_ffi` SFFI module is not resolvable from standalone projects running under the interpreter. The module path `std.nogc_sync_mut.ffi.sqlite` fails to resolve at runtime.
**Workaround:** Replaced SQLite storage with in-memory module-level arrays (`DB_NOTES`, `DB_CHUNKS`, `DB_LINKS`, `DB_TASKS`) using manual counters. All CRUD operations rewritten as linear scans.
**Affected files:** `src/core/indexer.spl`

## L-2: Class Params Pass-by-Value

**Impact:** Cannot mutate class instances passed as function arguments; changes are lost on return.
**Root Cause:** The interpreter copies struct values on function call rather than passing references.
**Workaround:** Use module-level global arrays instead of mutable class fields. The `IndexDb` struct is kept as a dummy handle for API compatibility, but all actual state lives in module globals.
**Affected files:** `src/core/indexer.spl`

## L-3: `.push()` Unsupported on Module-Level Globals

**Impact:** `DB_NOTES.push(record)` silently fails or errors when `DB_NOTES` is a module-level variable.
**Root Cause:** The interpreter's `.push()` method does not work correctly on module-level array variables.
**Workaround:** Use concat pattern: `DB_NOTES = DB_NOTES + [record]` instead of `DB_NOTES.push(record)`. Applied consistently across all module-level array mutations in indexer.spl.
**Affected files:** `src/core/indexer.spl`

## L-4: `.lower()` Is Destructive

**Impact:** Calling `str.lower()` mutates the original variable in-place and returns it, so subsequent uses of the original see the lowered value.
**Root Cause:** Interpreter string method `.lower()` modifies the receiver rather than returning a new string.
**Workaround:** Copy-before-lower pattern: `val lower_text = ("" + original).lower()`. The concatenation with `""` creates a fresh string that can be safely lowered without mutating the original.
**Affected files:** `src/core/search_engine.spl`, `src/core/graph.spl`

## L-5: `int("")` Crashes the Interpreter

**Impact:** Parsing an empty string as integer causes a runtime panic.
**Root Cause:** The `int()` builtin does not guard against empty string input.
**Workaround:** Guard with empty check before conversion: `if str != "": val n = int(str)`.
**Affected files:** `src/util/json_helpers.spl`

## L-6: `rt_list_dir_recursive` Unavailable

**Impact:** The originally planned recursive directory listing function does not exist in the runtime.
**Root Cause:** The function name from the stdlib docs was incorrect or removed.
**Workaround:** Use `rt_dir_walk(path)` with null coalescing (`?? []`) and filter results for `.md` extension.
**Affected files:** `src/core/vault_scanner.spl`

## L-7: No File Modification Time Available

**Impact:** Cannot track file mtime for incremental indexing staleness checks.
**Root Cause:** The interpreter runtime does not expose `rt_file_mtime()` or equivalent.
**Workaround:** Use `rt_file_size(path)` as a staleness proxy. Changed files usually change size; this misses same-size edits but covers most cases.
**Affected files:** `src/core/indexer.spl`

## L-8: `nogc_sync_mut` Stdlib Imports Not Resolvable

**Impact:** Cannot import stdlib modules like `std.nogc_sync_mut.ffi.io` from standalone projects.
**Root Cause:** The interpreter's module resolution does not search the compiler's stdlib path when running code outside the compiler source tree.
**Workaround:** Use `extern fn` declarations for needed runtime functions (`rt_dir_walk`, `rt_file_exists`, `rt_file_read_text`, `rt_file_size`, `rt_time_now_unix_micros`) instead of importing from stdlib.
**Affected files:** `src/core/vault_scanner.spl`, `src/core/indexer.spl`, `src/mcp/server.spl`

## L-9: FTS5/BM25 Not Available — Simple Text-Matching Scoring

**Impact:** No BM25 ranking; search quality is lower than planned.
**Root Cause:** Consequence of L-1 (no SQLite access). FTS5 virtual tables cannot be created.
**Workaround:** Implemented simple term-frequency text matching: tokenize query, count occurrences in content, normalize by document length. Combined with a 6-stage ranking pipeline (text match → operator filter → graph rerank → authority → recency → semantic placeholder) to approximate quality.
**Affected files:** `src/core/search_engine.spl`, `src/core/ranker.spl`

## L-10: `substring()` Is Destructive

**Impact:** Calling `str.substring(start, end)` mutates the original string variable.
**Root Cause:** Same class of bug as L-4; interpreter string methods modify the receiver.
**Workaround:** `safe_substr` helper in `json_helpers.spl` that iterates characters and builds a new string via concatenation, avoiding the built-in `substring()` for most use cases. Used throughout the codebase.
**Affected files:** `src/util/json_helpers.spl` (defines helper), all other files (use helper)

---

## Summary

| ID | Issue | Workaround | Files |
|----|-------|-----------|-------|
| L-1 | No SQLite SFFI | In-memory arrays | indexer |
| L-2 | Pass-by-value classes | Module globals | indexer |
| L-3 | `.push()` on globals | Concat pattern | indexer |
| L-4 | Destructive `.lower()` | Copy-before-lower | search_engine, graph |
| L-5 | `int("")` crash | Empty guard | json_helpers |
| L-6 | No `rt_list_dir_recursive` | `rt_dir_walk` + filter | vault_scanner |
| L-7 | No file mtime | `rt_file_size` proxy | indexer |
| L-8 | Stdlib import failure | `extern fn` declarations | vault_scanner, indexer, server |
| L-9 | No FTS5/BM25 | Text-frequency scoring | search_engine, ranker |
| L-10 | Destructive `substring()` | `safe_substr` helper | json_helpers + all |
