<!-- llm-process-gen: managed source=codex_verify_skill source_sha256=dda10f1d227a06c9cbf49386156494d66c9e381cbfedf1f3ae6081617bf62f38 content_sha256=8232051295f1e6e320e74f318de90beb325871fda7d1fba71c83e1fbee7d3bec -->
---
name: verify
description: "Codex verification skill (primary verifier in cooperative mode). 6-phase production readiness verification: scope, SPipe quality, implementation stubs, requirements tracing, NFR, docs. STATUS: PASS/FAIL/WARN output. Must PASS before release."
---

# Verify — Codex (Primary Verifier)

**Cooperative Phase:** Verification (final gate before release)
**Self-sufficient.** Any LLM can run verify independently. Codex is the primary verifier in cooperative mode.

## Tools

- **Simple MCP** — query codebase structure, find stubs
- **Simple LSP MCP** — symbol lookup, dead code detection

## Usage

- No args: verify current changes
- File path: verify specific feature
- `--all`: full project verification

## 6-Phase Verification

### Phase 1: Scope Analysis

- Identify all files changed/added for the feature
- Map changes to requirements (REQ-NNN)
- Verify no unrelated changes sneaked in

### Phase 2: SPipe Quality

- Every `it` block has real assertions (not `pass_todo`, not `expect(true).to_equal(true)`)
- Edge cases and error paths tested
- Every REQ-NNN has at least one test
- Built-in matchers only: `to_equal`, `to_be`, `to_be_nil`, `to_contain`, `to_start_with`, `to_end_with`, `to_be_greater_than`, `to_be_less_than`
- Do not use `to_be_true()` / `to_be_false()`; assert concrete values, or use
  `to_be(true/false)` only when the boolean itself is the behavior.

### Phase 3: Implementation Stubs

Scan for stub patterns — any match is a **FAIL**:

- `pass_todo` — unimplemented placeholder
- `pass_do_nothing("why no-op is correct")` / `pass_dn("why no-op is correct")` with weak or missing rationale
- `todo("what remains", "hint or issue")` with weak or missing rationale
- Hardcoded returns without logic
- Empty function bodies
- Commented-out code blocks
- `# TODO` / `# FIXME` converted to `# NOTE` — hidden work

**STUB001 = HARD FAIL.** No stubs in production code.

### Phase 4: Requirements Tracing

- Every REQ-NNN in `doc/02_requirements/feature/<feature>.md` traced to source code
- Every BDD scenario in `doc/06_spec/` has matching `it` block in test files
- Generated/manual docs for changed specs exist under `doc/06_spec`, report
  `0 stubs`, and read as manuals for scenario-oriented specs
- Broad lanes completed lower-model sidecar review or recorded `N/A`, and
  normal/highest-capability review accepted generated-manual quality, coverage,
  exclusions, and done marks
- `find doc/06_spec -name '*_spec.spl' | wc -l` returns `0`
- No orphan requirements (REQ without implementation)
- No orphan tests (tests without corresponding REQ)

### Phase 5: NFR Verification

- **Performance:** benchmarks exist for performance-critical paths
- **Security:** input validation present, no hardcoded secrets
- **Reliability:** error handling complete, `Result<T, E>` + `?` used consistently
- **Maintainability:** files under 800 lines, no duplication
- **Core/MCP regression gate:** when compiler/core/lib or MCP/LSP files changed, require passing:
  - `<runtime> check src/compiler`
  - `<runtime> check src/lib`
  - `<runtime> check src/app/mcp`
  - `<runtime> check src/app/simple_lsp_mcp`
  - `SIMPLE_LIB=src <runtime> test test/02_integration/app/mcp_stdio_integration_spec.spl --mode=interpreter`
  - If npm packaging/release flow changed:
  - `<runtime> native-build --source src/compiler --source src/app --source src/lib --entry-closure --entry src/app/mcp/main.spl --strip --output build/bootstrap/mcp-package/simple_mcp_server`
  - `<runtime> native-build --source src/compiler --source src/app --source src/lib --entry-closure --entry src/app/simple_lsp_mcp/main.spl --strip --output build/bootstrap/mcp-package/simple_lsp_mcp_server`

### Phase 6: Documentation Freshness

- `doc/04_architecture/` updated for new modules
- `doc/05_design/` updated for new features
- Workflow/tooling/evidence/spec/verification contract changes updated matching
  `doc/07_guide`, `doc/06_spec`, `.codex/skills`, `.agents/skills`,
  `.claude/skills`, `.claude/agents/spipe`, and `.gemini/commands` docs
- Cross-references between docs intact
- CHANGELOG updated for user-facing changes

## Report Format

```
=== Verification Report: <feature> ===

[PASS] src/lib/feature.spl:42 — REQ-001 implemented with error handling
[PASS] test/lib/feature_spec.spl:15 — REQ-001 has 3 test cases
[FAIL] src/lib/feature.spl:87 — pass_todo found (STUB001)
[FAIL] test/lib/feature_spec.spl:30 — expect(true).to_equal(true) is not a real assertion
[WARN] doc/04_architecture/feature.md — not updated for new module

STATUS: FAIL (2 failures, 1 warning)
```

## Pass Criteria

- **Zero FAIL items** — any FAIL blocks release
- **WARN items reviewed** — warnings must be acknowledged
- **STATUS: PASS** required before release

## Artifacts Produced

| Artifact | Path |
|----------|------|
| Verification report | Printed to stdout / saved to `doc/09_report/verify_<feature>.md` |

## Rules

- NEVER downgrade a FAIL to WARN — fix the issue
- NEVER skip stub detection — STUB001 is non-negotiable
- NEVER mark STATUS: PASS with outstanding FAILs
- NEVER mark STATUS: PASS with stale generated manuals, unreviewed broad
  sidecar output, executable specs under `doc/06_spec`, or stale process docs
- If verification finds issues, report them — do not auto-fix without user approval
- Fail production wrapper verification if an MCP or LSP launcher executes a source entrypoint directly instead of a cached compiled artifact
- Audit hot request paths for repeated full scans, repeated file rereads, and per-request subprocesses; flag uncached patterns as FAIL or WARN based on impact
- Verify cache invalidation exists for write flows that affect cached or indexed data
- Require startup and representative request performance evidence for performance-sensitive tooling changes
- Do not mark STATUS: PASS for compiler/core/lib or MCP/LSP work unless the matching runtime and MCP smoke checks passed
