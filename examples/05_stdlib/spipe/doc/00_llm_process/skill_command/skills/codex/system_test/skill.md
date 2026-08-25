<!-- llm-process-gen: managed source=codex_system_test_skill source_sha256=a161ad153f36670c5f69aaf3795e64cafdb5aec217ad3c2a692f7b549dbc0157 content_sha256=c2f98a4ea6e8689341272e9ac01ba90edff473a035ecf62a3a811a60e26e7a30 -->
---
name: system_test
description: "Codex system test design skill (Codex-specific strength). SPipe BDD test generation with built-in matchers only. REQ-NNN to test traceability. Test plan creation."
---

# System Test Design — Codex (Codex-Specific Strength)

**Cooperative Phase:** Design support (Step 4) and standalone test design
**Self-sufficient.** Can generate system tests independently given requirements.

Codex excels at systematic test generation with full requirement traceability. Use this skill for test-focused tasks.

## Tools

- **Simple MCP** — query codebase structure, existing tests
- **Simple LSP MCP** — symbol lookup, type signatures for test targets

## Prerequisites

| Artifact | Path | If missing |
|----------|------|-----------|
| Requirements | `doc/02_requirements/feature/<feature>.md` | Need requirements first — run research |
| NFR | `doc/02_requirements/nfr/<feature>.md` | Need NFR first — run research |

## Phase 1: Requirement Extraction

- Parse all REQ-NNN from requirements document
- Identify testable behaviors per requirement
- Map edge cases and error paths

## Phase 2: SPipe BDD Test Generation

Generate test specs using **built-in matchers only**.

### Built-in Matchers (ONLY these are allowed)

| Matcher | Usage |
|---------|-------|
| `to_equal(expected)` | Exact equality |
| `to_be(expected)` | Identity/reference equality |
| `to_be_nil()` | Nil check |
| `to_contain(item)` | Collection/string contains |
| `to_start_with(prefix)` | String starts with |
| `to_end_with(suffix)` | String ends with |
| `to_be_greater_than(val)` | Numeric greater than |
| `to_be_less_than(val)` | Numeric less than |

**Forbidden patterns:**
- `to_be_true()` — use `to_equal(true)` instead
- `to_be_false()` — use `to_equal(false)` instead
- `to_raise()` — not available; test error returns via `Result<T, E>`
- Custom matchers — not supported

### SPipe Template

```simple
use std.spec.SPipe

describe "<Feature Name>":
    describe "REQ-001: <requirement title>":
        it "should <expected behavior in present tense>":
            val result = <invoke feature code>
            expect(result).to_equal(<expected value>)

        it "should handle empty input":
            val result = <invoke with empty>
            expect(result).to_be_nil()

        it "should reject invalid input":
            val result = <invoke with invalid>
            expect(result.error?).to_equal(true)

    describe "REQ-002: <next requirement>":
        it "should <behavior>":
            val result = <invoke>
            expect(result).to_contain(<expected item>)
```

### Test Quality Criteria (A-Grade)

- Every `it` block has **real assertions** (not `pass_todo`, not `expect(true).to_equal(true)`)
- Each REQ-NNN has **at least 3 tests**: happy path, edge case, error path
- Test descriptions start with "should" and describe behavior, not implementation
- No test depends on external state or other tests
- Error paths use `Result<T, E>` pattern, not exceptions

## Phase 3: Traceability Matrix

Create a traceability matrix linking requirements to tests:

```markdown
| REQ | Description | Test File | Test Cases | Coverage |
|-----|-------------|-----------|------------|----------|
| REQ-001 | <desc> | <path>_spec.spl | 3 | Full |
| REQ-002 | <desc> | <path>_spec.spl | 4 | Full |
| REQ-003 | <desc> | — | 0 | MISSING |
```

Any REQ with 0 test cases is a **FAIL** — must be addressed.

## Phase 4: Test Plan Document

Create test plan with:
- Scope (what is tested, what is excluded)
- Test environment requirements
- Execution order and dependencies
- Pass/fail criteria
- Risk areas needing extra coverage

Output: `doc/03_plan/sys_test/<feature>.md`

## Artifacts Produced

| Artifact | Path |
|----------|------|
| System test specs | `test/03_system/app/<app_name>/feature/<feature>_spec.spl` |
| Test plan | `doc/03_plan/sys_test/<feature>.md` |
| Traceability matrix | Included in test plan |

## Interpreter Mode Limitation

**Important:** The test runner in interpreter mode only verifies file loading, NOT `it` block execution. The `it` block bodies do not execute in interpreter mode. Use compiled mode for actual test execution:

```bash
bin/simple test path/to/spec.spl          # Interpreter mode (loading only)
bin/simple test path/to/spec.spl --native  # Compiled mode (full execution)
```

## Multi-LLM Collaboration

- If other LLMs wrote test specs, review quality and extend — never overwrite
- Codex is the preferred test designer in cooperative mode
- Tag Codex-produced tests with `# codex-system-test` comment

## Rules

- Built-in matchers ONLY — no custom matchers
- Every REQ-NNN must have test coverage — zero is a FAIL
- Do not use `to_be_true()` / `to_be_false()`; assert concrete values, or use
  `to_be(true/false)` only when the boolean itself is the behavior.
- All test code in `.spl` — no Python, no Bash
- Generics use `<>` not `[]`
- NO inheritance in test helpers — use composition
- NEVER skip or ignore failing tests without user approval
