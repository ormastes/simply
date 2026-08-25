<!-- llm-process-gen: managed source=codex_design_skill source_sha256=afdc7a9b578cf6054efdecd94448ad67b8cf879d88d9ebd69f44167a547f4aa3 content_sha256=214b564410730f377e7cc59c0e43944ed328f91d588d5e846bcb5cae18d41ba2 -->
---
name: design
description: "Codex design skill (Step 4 in cooperative pipeline). Architecture evaluation, pattern selection, MDSOC application, system test design with SPipe BDD. Self-sufficient — does UI design if Gemini step was skipped, does research if missing."
---

# Design — Codex (Cooperative Step 4)

**Cooperative Phase:** Step 4 — Architecture + System Test Design
**Self-sufficient.** If research/requirements missing, does them first. If Gemini (Step 3) UI design was skipped, does UI design inline.

## Tools

- **Simple MCP** — query codebase structure, module graph
- **Simple LSP MCP** — symbol lookup, type checking, references
- **Context7 MCP** — external library documentation
- **Playwright CLI** — reference architecture research

## Prerequisites Check

| Artifact | Path | If missing |
|----------|------|-----------|
| Requirements | `doc/02_requirements/feature/<feature>.md` | Run research first |
| NFR | `doc/02_requirements/nfr/<feature>.md` | Run research first |
| UI Design (optional) | `doc/05_design/<feature>_tui.md` | Do inline (Gemini Step 3 skipped) |

## Phase 1: UI Design (if applicable and Gemini Step 3 skipped)

- TUI layout: `doc/05_design/<feature>_tui.md`
- GUI layout: `doc/05_design/<feature>_gui.md`
- Skip if feature has no UI component

## Phase 2: Architecture Evaluation

- Evaluate candidate patterns for the feature
- Apply MDSOC (virtual capsules, feature transforms) where appropriate
- Check alignment with existing `doc/04_architecture/` ADRs
- Identify cross-cutting concerns for MDSOC weaving

Output: `doc/04_architecture/<feature>.md`

### MDSOC Application Checklist

- Does the feature cross module boundaries? -> Virtual capsule candidate
- Does the feature add cross-cutting behavior? -> Feature transform candidate
- Does the feature need runtime composition? -> Adapter pattern candidate
- See `src/compiler/85.mdsoc/` for existing MDSOC infrastructure

## Phase 3: System Test Design

- SPipe BDD tests with **built-in matchers only**
- Every REQ-NNN must have at least one test
- Include edge cases and error paths

Output:
- Test specs: `test/03_system/app/<app_name>/feature/<feature>_spec.spl`
- Test plan: `doc/03_plan/sys_test/<feature>.md`

### Built-in Matchers (ONLY these are allowed)

```
to_equal(expected)        # Exact equality
to_be(expected)           # Identity/reference equality
to_be_nil()               # Nil check
to_contain(item)          # Collection/string contains
to_start_with(prefix)     # String prefix
to_end_with(suffix)       # String suffix
to_be_greater_than(val)   # Numeric comparison
to_be_less_than(val)      # Numeric comparison
```

- Do not use `to_be_true()` / `to_be_false()`; assert concrete values, or use
  `to_be(true/false)` only when the boolean itself is the behavior.

### SPipe Test Template

```simple
use std.spec.SPipe

describe "<Feature>":
    describe "REQ-001: <requirement name>":
        it "should <expected behavior>":
            val result = <invoke feature>
            expect(result).to_equal(<expected>)

        it "should handle edge case: <description>":
            val result = <invoke with edge input>
            expect(result).to_equal(<expected>)

        it "should return error for invalid input":
            val result = <invoke with bad input>
            expect(result.error?).to_equal(true)
```

## Phase 4: Detail Design

- Data structures, algorithms, module interactions, error handling
- Output: `doc/05_design/<feature>.md`
- Agent tasks: `doc/03_plan/agent_tasks/<feature>.md`
- For broad lanes, agent tasks must list lower-model sidecars such as Codex
  Spark, Claude Haiku, or Claude Sonnet, or mark `N/A`, plus merge owner and
  final normal/highest-capability reviewer.
- Before sidecars fan out, the best available model defines shared interface
  names, manual `step("...")` flow helper names, setup/checker helper names, and
  fail-fast placeholders using `assert(false)` or `fail(...)`.

## Phase 5: Quality Check

- Verify every REQ-NNN has test coverage
- Check SPipe quality: real assertions, edge cases, error paths
- Check generated-manual quality for scenario-oriented specs and require
  normal/highest-capability review to accept merged sidecar output before
  handoff
- Verify architecture alignment with MDSOC rules
- Ask user if architecture/design needs changes

## Artifacts Produced

| Artifact | Path |
|----------|------|
| Architecture | `doc/04_architecture/<feature>.md` |
| System test specs | `test/03_system/app/<app_name>/feature/<feature>_spec.spl` |
| Test plan | `doc/03_plan/sys_test/<feature>.md` |
| Detail design | `doc/05_design/<feature>.md` |
| Agent tasks | `doc/03_plan/agent_tasks/<feature>.md` |
| UI design (if applicable) | `doc/05_design/<feature>_tui.md` |

## Multi-LLM Collaboration

- If Claude (Step 1) or Codex (Step 2) produced research, build on it
- If Gemini (Step 3) produced UI design, incorporate it — do not overwrite
- Tag Codex-produced artifacts with `<!-- codex-design -->` comment

## Rules

- If requirements missing, do research first — never design without requirements
- If another LLM already created artifacts, review and extend — never overwrite
- Every REQ-NNN must have test coverage
- All code in `.spl` — no Python, no Bash
- Generics use `<>` not `[]`
- NO inheritance — use composition, traits, mixins
- Use `Result<T, E>` + `?` for error handling
- For MCP, LSP, and tool servers, explicitly review startup path, hot request paths, cache or index strategy, and invalidation strategy
- Call out full-tree scans, repeated file reads, and per-request subprocesses as design risks unless the operation is explicitly maintenance or reindex work
- Define startup and representative request-latency budgets for performance-sensitive features
- Require an observability plan for perf-sensitive paths: timings, counters, or debug diagnostics
