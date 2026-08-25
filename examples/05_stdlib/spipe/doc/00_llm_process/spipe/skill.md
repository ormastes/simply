# SPipe Test Writing Skill

SPipe is Simple's BDD testing framework (formerly **SPipe**, renamed 2026-04-26).
`describe`, `it`, `expect` are **built-in** -- no import needed.

## Quick Start

```simple
describe "Calculator":
    context "addition":
        it "adds two numbers":
            expect(2 + 2).to_equal(4)
```

Run: `bin/simple test path/to/spec.spl`

## Matchers (built-in only)

| Matcher | Usage |
|---------|-------|
| `.to_equal(expected)` | Equality check |
| `.to_be(expected)` | Identity/equality |
| `.to_be_nil()` | Nil check |
| `.to_contain(item)` | Collection/string contains |
| `.to_start_with(prefix)` | String prefix |
| `.to_end_with(suffix)` | String suffix |
| `.to_be_greater_than(n)` | Numeric comparison |
| `.to_be_less_than(n)` | Numeric comparison |

Use `.to_equal(true)` NOT `.to_be_true()`. Use `.to_equal()` NOT `.to(eq())`.

## Spec File Structure

### 1. Module-Level Docstring (REQUIRED)

```simple
"""
# Feature Name Specification

**Feature IDs:** #100-110
**Category:** Language | Stdlib | Runtime | Testing | Tooling
**Status:** Draft | In Progress | Implemented | Complete
**Requirements:** doc/02_requirements/feature/feature.md (or N/A)

## Overview
What this feature does and why.
"""
```

### 2. Test Groups with Docstrings

```simple
describe "MyFeature":
    """## Basic Usage -- description."""
    context "when condition":
        """### Scenario: specific case."""
        it "does expected behavior":
            expect(actual).to_equal(expected)
```

### 3. Coverage Target (REQUIRED for system tests)

System test files (`test/03_system/**`) MUST include `# @cover` annotations at the top.

### 4. Template: `cp .claude/templates/spipe_template.spl test/my_spec.spl`

## BDD Syntax

### Hooks

```simple
context "with setup":
    before_each:
        setup()
    after_each:
        cleanup()
    it "test":
        expect(true).to_equal(true)
```

## Test Types

| Type | Keyword | Behavior |
|------|---------|----------|
| Regular | `it "..."` | Runs by default |
| Slow | `slow_it "..."` | Run with `--only-slow` |
| Skipped | `skip_it "..."` | Skipped in interpreter, runs compiled |
| Pending | `pending "reason"` | Marked pending |

## Doc Generation

```bash
bin/simple spipe-docgen path/to/spec.spl --output doc/06_spec --no-index
```

## Critical Rules

- NEVER add `#[ignore]` without user approval
- One assertion concept per test
- Clear names: `it "adds two positive numbers":` not `it "works":`
- Use `"""..."""` docstrings (not `#` comments) for generated docs
- Run tests after writing: `bin/simple test test/my_spec.spl`
