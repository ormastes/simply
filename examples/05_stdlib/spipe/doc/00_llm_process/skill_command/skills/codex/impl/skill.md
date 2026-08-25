<!-- llm-process-gen: managed source=codex_impl_skill source_sha256=5757449e22b9228ae8fd121e58082955fc604d7d6760eccc91de8dc3726fcb35 content_sha256=8abd6affa37b31ccd779fd3ce119dc90377d387e5863fd92ec114ec5a8092fb0 -->
---
name: impl
description: "Codex implementation skill. 15-phase workflow from research through verification. Self-sufficient — if research, requirements, or design missing, creates them first. Code in .spl only, 80%+ branch coverage, stub prevention gate."
---

# Impl — Codex Self-Sufficient 15-Phase Workflow

**Cooperative Phase:** Implementation (any step — self-sufficient)
**Self-sufficient.** If research, requirements, or design missing, does them first (phases 1-5).

## Tools

- **Simple MCP** — query codebase structure, module graph
- **Simple LSP MCP** — symbol lookup, type checking, go-to-definition
- **Context7 MCP** — external library documentation

## Prerequisites Check

| Artifact | Path | If exists, skip to |
|----------|------|--------------------|
| Research | `doc/01_research/local/<feature>.md` | Phase 4 |
| Requirements | `doc/02_requirements/feature/<feature>.md` | Phase 4 |
| Architecture | `doc/04_architecture/<feature>.md` | Phase 6 |
| Design | `doc/05_design/<feature>.md` | Phase 6 |
| System tests | `test/03_system/app/<app_name>/feature/<feature>_spec.spl` | Phase 8 |

**If ALL exist**, skip to Phase 8 (Implementation).

## Phases

### Phases 1-3: Research + Requirements
Skip if exist, otherwise do inline. See `research` skill for details.

### Phases 4-5: Plan + Design + Architecture
Skip if exist. See `design` skill for details.

### Phases 6-7: System Test + Doc Consistency
- Write SPipe BDD tests from design
- Verify doc cross-references are intact
- Built-in matchers only (see `design` skill for list)

### Phase 8: Implementation
- Implement in `src/**/<feature>.spl`
- Follow `/coding` rules strictly
- Reference: `doc/07_guide/quick_reference/syntax_quick_reference.md`

### Phases 9-10: Unit + Integration Tests
- 80%+ branch coverage target
- Write unit tests alongside implementation
- Write integration tests for cross-module interactions
- Add doctests for public API functions

### Phases 11-13: Bug Reports + Duplication Check + Refactoring
- Run `bin/simple bug-add` for any discovered bugs
- Check for code duplication across `src/`
- Refactor: files > 800 lines must be split

### Phase 14: Full Test Suite
```bash
bin/simple test test --whole --mode=interpreter
bin/simple lint <changed .spl files>
bin/simple duplicate-check <owned-dir> --mode token --min-lines 5
```

### Phase 15: Verify + VCS Sync
- Run `verify` skill — must show STATUS: PASS
- If `src/compiler/**`, `src/lib/**`, `src/app/mcp/**`, `src/app/simple_lsp_mcp/**`, or MCP packaging files changed, run:
  - `<runtime> check src/compiler`
  - `<runtime> check src/lib`
  - `<runtime> check src/app/mcp`
  - `<runtime> check src/app/simple_lsp_mcp`
  - `SIMPLE_LIB=src <runtime> test test/02_integration/app/mcp_stdio_integration_spec.spl --mode=interpreter`
  - If publish/package flow changed:
  - `<runtime> native-build --source src/compiler --source src/app --source src/lib --entry-closure --entry src/app/mcp/main.spl --strip --output build/bootstrap/mcp-package/simple_mcp_server`
  - `<runtime> native-build --source src/compiler --source src/app --source src/lib --entry-closure --entry src/app/simple_lsp_mcp/main.spl --strip --output build/bootstrap/mcp-package/simple_lsp_mcp_server`
- VCS sync: `jj commit -m "feat: <feature description>"`

## Stub Prevention Gate

**STUB001 = HARD FAIL.** No `pass_todo` in final code.

Before declaring implementation complete, verify:
- No `pass_todo` anywhere in new/modified files
- No `pass_do_nothing("why no-op is correct")` / `pass_dn("why no-op is correct")` unless intentional
- Use `todo("what remains", "hint or issue")` only for explicit, tracked deferrals
- No hardcoded returns without logic
- No commented-out code blocks
- No empty function bodies

## Artifacts Produced

| Artifact | Path |
|----------|------|
| Implementation | `src/**/<feature>.spl` |
| Unit tests | `test/**/<feature>_spec.spl` |
| Integration tests | `test/**/<feature>_it_spec.spl` |
| Bug reports (if any) | Via `bin/simple bug-add` |

## Multi-LLM Collaboration

- If other LLMs produced research/design/tests, build on them
- Never overwrite existing artifacts — extend or improve
- Tag Codex-produced code with `# codex-impl` comment on module header if needed

## Rules

- All code in `.spl` — no Python, no Bash
- Generics use `<>` not `[]` — `Option<T>`, `List<Int>`
- Pattern binding: `if val` not `if let`
- Constructors: `Point(x: 3, y: 4)` not `.new()`
- `?` is operator only — never in names; use `.?` over `is_*` predicates
- NO inheritance — use composition, alias forwarding, traits, or mixins
- Use `Result<T, E>` + `?` for error handling (no try/catch/throw)
- Reserved keywords: `gen`, `val`, `def`, `exists`, `actor`, `assert`, `join`, `pass_todo`, `pass_do_nothing`, `pass_dn`
- NEVER over-engineer — only make requested changes
- NEVER add unused code — delete completely
- NEVER convert TODO/FIXME to NOTE — implement or delete
- Production MCP or LSP wrappers must execute cached compiled artifacts, not raw source entrypoints
- Do not place full-tree scans or repeated file rereads in request handlers when a cache or index is viable
- When cached or indexed data depends on writable files, implement explicit invalidation on create, edit, move, delete, rename, template application, and bulk replace flows
- Add perf smoke coverage for startup and representative hot requests when changing performance-sensitive tooling
- After compiler/core/lib changes, verify MCP/LSP source-native startup before finishing the task; after packaging/release changes, verify isolated npm install startup too
