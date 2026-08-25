# SPipe Lint Rules - Design Document

**Status:** Design Phase
**Priority:** High
**Estimated Effort:** 2-3 days
**Target:** Prevent print-based anti-patterns and enforce intensive docstring usage

---

## Overview

This document specifies lint rules for enforcing SPipe test quality standards. These rules will prevent the anti-patterns identified in the audit (67 print-based test files) and ensure all new tests follow intensive docstring best practices.

---

## Rule Definitions

### 1. `spipe_no_print_based_tests` (Error Level)

**What it checks:**
Detects `print()` statements that simulate BDD structure in SPipe test files.

**Patterns detected:**
- `print('describe...')`
- `print("describe...")`
- `print('  context...')`
- `print('    it...')`
- `print('[PASS]')` / `print('[FAIL]')`

**Example violation:**
```simple
# Bad
print('describe User authentication:')
print('  context when credentials are valid:')
print('    it should grant access:')
```

**Correct code:**
```simple
# Good
describe "User authentication":
    """
    Test user authentication flows
    """
    context "when credentials are valid":
        """
        Valid credentials should grant access
        """
        it "should grant access":
            """
            Given valid credentials
            When user attempts to log in
            Then access is granted
            """
            expect(result).to(be_success())
```

**Error message:**
```
error[E001]: print-based SPipe test detected
  --> tests/auth_spec.spl:5:1
   |
 5 | print('describe User authentication:')
   | ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ use `describe "User authentication":` with docstrings
   |
   = note: Print-based tests generate NO documentation
   = help: Run `simple migrate --fix-spipe-docstrings tests/auth_spec.spl` to auto-convert
   = help: See doc/examples/spipe_conversion_example.md for guidance
```

**Implementation:**
```rust
// In src/compiler/src/lint/spipe/mod.rs
fn check_print_based_test(stmt: &Statement) -> Option<LintDiagnostic> {
    if let Statement::Expr(Expr::Call(call)) = stmt {
        if call.func.name() == "print" {
            if let Some(arg) = call.args.first() {
                if let Expr::Literal(Literal::String(s)) = arg {
                    if s.contains("describe") || s.contains("context") || s.contains("it ") {
                        return Some(LintDiagnostic {
                            lint: LintName::SPipeNoPrintBasedTests,
                            level: LintLevel::Deny,
                            message: "print-based SPipe test detected".to_string(),
                            help: Some("use proper SPipe syntax with docstrings".to_string()),
                            span: stmt.span(),
                        });
                    }
                }
            }
        }
    }
    None
}
```

---

### 2. `spipe_missing_docstrings` (Warning Level)

**What it checks:**
Ensures all `describe`, `context`, and `it` blocks have docstrings.

**Example violation:**
```simple
# Bad
describe "Feature test":
    context "scenario":
        it "should work":
            expect(true).to(eq(true))
```

**Correct code:**
```simple
# Good
describe "Feature test":
    """
    # Feature Test

    Tests the feature functionality
    """
    context "scenario":
        """
        ## Scenario

        Specific test scenario
        """
        it "should work":
            """
            Given a condition
            When an action occurs
            Then result is verified
            """
            expect(true).to(eq(true))
```

**Warning message:**
```
warning: SPipe block missing docstring
  --> tests/feature_spec.spl:3:1
   |
 3 | describe "Feature test":
   | ^^^^^^^^ add docstring for documentation generation
   |
   = note: Docstrings enable auto-generated feature documentation
   = help: Add """ docstring """ after the colon
   = help: See doc/examples/spipe_conversion_example.md for examples
```

**Implementation:**
```rust
fn check_missing_docstring(block: &Block, keyword: &str) -> Option<LintDiagnostic> {
    // Check if first statement in block is a docstring
    if let Some(first_stmt) = block.statements.first() {
        if !is_docstring(first_stmt) {
            return Some(LintDiagnostic {
                lint: LintName::SPipeMissingDocstrings,
                level: LintLevel::Warn,
                message: format!("{} block missing docstring", keyword),
                help: Some("add \"\"\" docstring \"\"\" after the colon".to_string()),
                span: block.span(),
            });
        }
    }
    None
}
```

---

### 3. `spipe_minimal_docstrings` (Info Level)

**What it checks:**
Files with fewer than 2 docstrings in SPipe tests.

**Rationale:**
Files should have at least:
1. Top-level feature docstring
2. Per-test-case docstrings

**Example violation:**
```simple
# Bad - only 1 docstring
"""
# Feature
"""

describe "Test":
    it "works":
        expect(true)
```

**Correct code:**
```simple
# Good - multiple docstrings
"""
# Feature

Complete feature documentation
"""

describe "Test":
    """
    Test documentation
    """
    it "works":
        """
        Specific test documentation
        """
        expect(true)
```

**Info message:**
```
info: minimal SPipe docstring usage
  --> tests/feature_spec.spl:1:1
   |
   | File has only 1 docstring (minimum recommended: 2)
   |
   = note: Intensive docstring usage improves documentation quality
   = help: Add docstrings to describe/context/it blocks
```

---

### 4. `spipe_manual_assertions` (Warning Level)

**What it checks:**
Manual pass/fail tracking instead of `expect()` assertions.

**Patterns detected:**
- `var passed = 0` / `var failed = 0`
- `passed = passed + 1` / `failed = failed + 1`
- `if condition: print('[PASS]')`

**Example violation:**
```simple
# Bad
var passed = 0
var failed = 0

if result == expected:
    print('[PASS] test passed')
    passed = passed + 1
else:
    print('[FAIL] test failed')
    failed = failed + 1
```

**Correct code:**
```simple
# Good
expect(result).to(eq(expected))
```

**Warning message:**
```
warning: manual assertion tracking detected
  --> tests/feature_spec.spl:10:5
   |
10 | passed = passed + 1
   | ^^^^^^^^^^^^^^^^^^^ use `expect()` assertions instead
   |
   = note: Manual tracking is error-prone and verbose
   = help: Replace with: expect(condition).to(eq(true))
   = help: See SPipe documentation for expect() matchers
```

---

## Lint Configuration

### File: `.simple-lint.toml`

```toml
[spipe]
# Error on print-based tests (prevents new anti-patterns)
no_print_based_tests = "deny"

# Warn on missing docstrings
missing_docstrings = "warn"

# Info level for minimal docstrings
minimal_docstrings = "info"

# Warn on manual assertions
manual_assertions = "warn"

# Minimum docstrings per file
min_docstrings_per_file = 2

# Apply only to *_spec.spl files
file_pattern = "*_spec.spl"
```

### Per-file Configuration

```simple
# At top of test file
#[allow(spipe_missing_docstrings)]  # Temporarily disable

# Or for specific blocks
#[allow(spipe_missing_docstrings)]
describe "Legacy test":
    # Old test without docstrings
    pass
```

---

## Implementation Plan

### Phase 1: Core Infrastructure (Day 1)

1. **Create SPipe lint module**
   - `src/compiler/src/lint/spipe/mod.rs`
   - `src/compiler/src/lint/spipe/rules.rs`
   - `src/compiler/src/lint/spipe/checker.rs`

2. **Add lint names to types.rs**
   ```rust
   pub enum LintName {
       // Existing...
       PrimitiveApi,
       BareBool,

       // New SPipe lints
       SPipeNoPrintBasedTests,
       SPipeMissingDocstrings,
       SPipeMinimalDocstrings,
       SPipeManualAssertions,
   }
   ```

3. **Integrate with main lint system**
   - Register SPipe checker
   - Add configuration support

### Phase 2: Rule Implementation (Day 2)

1. **Implement `spipe_no_print_based_tests`**
   - AST pattern matching for print statements
   - Check for BDD keywords in strings
   - Emit errors with migration suggestions

2. **Implement `spipe_missing_docstrings`**
   - Detect describe/context/it blocks
   - Check for docstring as first statement
   - Emit warnings with examples

3. **Implement `spipe_minimal_docstrings`**
   - Count docstrings in file
   - Emit info if below threshold
   - Configurable minimum

4. **Implement `spipe_manual_assertions`**
   - Detect passed/failed variables
   - Find assertion patterns
   - Suggest expect() replacements

### Phase 3: Testing & Integration (Day 3)

1. **Unit tests for each rule**
   - Positive cases (should trigger)
   - Negative cases (should not trigger)
   - Edge cases

2. **Integration tests**
   - Real test files
   - Configuration loading
   - Attribute support

3. **CLI integration**
   ```bash
   simple lint tests/
   simple lint --explain spipe_no_print_based_tests
   ```

4. **CI/CD integration**
   - Add to pre-commit hooks
   - Block PRs with errors
   - Report warnings

---

## Testing Strategy

### Unit Tests

```rust
#[test]
fn test_print_based_describe_detected() {
    let code = r#"
print('describe Feature:')
    "#;
    let diagnostics = check_spipe_lints(code);
    assert!(diagnostics.iter().any(|d| d.lint == LintName::SPipeNoPrintBasedTests));
    assert!(diagnostics.iter().all(|d| d.level == LintLevel::Deny));
}

#[test]
fn test_proper_describe_no_warning() {
    let code = r#"
describe "Feature":
    """
    Documentation
    """
    pass
    "#;
    let diagnostics = check_spipe_lints(code);
    assert!(diagnostics.iter().all(|d| d.lint != LintName::SPipeNoPrintBasedTests));
}

#[test]
fn test_missing_docstring_warning() {
    let code = r#"
describe "Feature":
    pass
    "#;
    let diagnostics = check_spipe_lints(code);
    assert!(diagnostics.iter().any(|d| d.lint == LintName::SPipeMissingDocstrings));
}
```

### Integration Tests

```bash
# Test on real files
simple lint simple/std_lib/test/features/codegen/buffer_pool_spec.spl

# Expected output:
# error: print-based SPipe test detected
#   --> simple/std_lib/test/features/codegen/buffer_pool_spec.spl:10:1
#    |
# 10 | print('describe Buffer Pool:')
#    | ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
#    |
#    = help: Run `simple migrate --fix-spipe-docstrings` to auto-convert
```

---

## Error Messages & UX

### Principles

1. **Clear and actionable** - Tell user exactly what's wrong and how to fix it
2. **Context-aware** - Show relevant code snippet
3. **Migration-friendly** - Suggest `simple migrate` command
4. **Documentation links** - Point to examples and guides

### Example Error (Full)

```
error[E001]: print-based SPipe test detected
  --> simple/std_lib/test/features/testing_framework/doctest_spec.spl:53:1
   |
53 | print('describe Docstring parsing:')
   | ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ use `describe "Docstring parsing":` with docstrings
54 | print('  context extracts code blocks:')
   | ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ use `context "extracts code blocks":` with docstrings
55 | print('    it finds code in docstrings:')
   | ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ use `it "finds code in docstrings":` with docstrings
   |
   = note: Print-based tests generate NO documentation
   = note: This file is one of 67 using this anti-pattern
   = help: Automated migration available:
           `simple migrate --fix-spipe-docstrings doctest_spec.spl`
   = help: See conversion guide:
           doc/examples/spipe_conversion_example.md
   = help: To suppress (not recommended):
           #[allow(spipe_no_print_based_tests)]

error: aborting due to 1 previous error

For more information about this error, run:
    simple lint --explain spipe_no_print_based_tests
```

---

## Migration Path

### Step 1: Add Rules with Warnings (Week 1)
```toml
[spipe]
no_print_based_tests = "warn"  # Start with warnings
missing_docstrings = "warn"
```

### Step 2: Fix Existing Violations (Week 2-3)
```bash
# Run migration tool on all print-based tests
simple migrate --fix-spipe-docstrings simple/std_lib/test/

# Manual review and docstring enhancement
# Run tests to verify functionality
```

### Step 3: Escalate to Errors (Week 4)
```toml
[spipe]
no_print_based_tests = "deny"  # Now block new violations
missing_docstrings = "warn"    # Keep as warnings
```

### Step 4: Enforce in CI/CD (Week 5+)
```yaml
# .github/workflows/lint.yml
- name: Run SPipe lints
  run: simple lint --deny-warnings tests/
```

---

## Metrics & Monitoring

### Dashboard Metrics

1. **Lint violation trends**
   - Print-based tests over time
   - Missing docstrings over time
   - Manual assertions over time

2. **Adoption metrics**
   - Files with intensive docstrings
   - Average docstrings per file
   - Percentage of tests with documentation

3. **Quality metrics**
   - Documentation coverage percentage
   - Test files with comprehensive docstrings
   - Feature catalog completeness

### Reporting

```bash
# Generate lint report
simple lint --format json tests/ > lint-report.json

# Generate metrics dashboard
simple lint --stats

# Output:
# SPipe Lint Statistics
# =====================
#
# Print-based tests: 0 files (down from 67)
# Missing docstrings: 45 files (down from 195)
# Intensive adoption: 85% (up from 1%)
#
# Progress: ████████████████░░░░ 85% to 100% goal
```

---

## References

- **Audit Report:** `doc/09_report/spipe_docstring_audit_report.md`
- **Migration Tool:** `src/driver/src/cli/migrate_spipe.rs`
- **Conversion Guide:** `doc/examples/spipe_conversion_example.md`
- **Current Lint System:** `src/compiler/src/lint/`

---

## Appendix: Rule Priority Matrix

| Rule | Priority | Effort | Impact | Status |
|------|----------|--------|--------|--------|
| `no_print_based_tests` | P0 (Critical) | Low | High | Design |
| `missing_docstrings` | P1 (High) | Medium | High | Design |
| `manual_assertions` | P2 (Medium) | Medium | Medium | Design |
| `minimal_docstrings` | P3 (Low) | Low | Low | Design |

---

**End of Design Document**
