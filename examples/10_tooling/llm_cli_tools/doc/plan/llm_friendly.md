# LLM-Friendly Development Plan

**Goal:** Make Simple the most LLM-friendly language for code generation, verification, and collaboration.

**Status:** Planning Phase  
**Priority:** High (differentiating feature)

## Overview

This plan implements features from `doc/llm_friendly.md` to make Simple optimized for LLM-assisted development. The features are grouped into phases based on priority and dependencies.

## Phase 1: Language Core - Contract System (HIGH PRIORITY)

### Feature: Contract Blocks (requires/ensures/invariant)

**Importance:** ⭐⭐⭐ Critical for LLM safety and intent specification

**Syntax:**
```simple
fn divide(a: i64, b: i64) -> i64:
    requires:
        b != 0              # Precondition checked at call site
    ensures:
        result * b == a     # Postcondition verified after execution
    
    return a / b

class BankAccount:
    balance: i64
    
    invariant:
        balance >= 0  # Checked after constructor and every public method
    
    fn withdraw(amount: i64):
        requires:
            amount > 0
            amount <= balance
        ensures:
            balance == old(balance) - amount
        
        balance -= amount
```

**Implementation Tasks:**

1. **Parser** (2 hours)
   - Add `requires:`, `ensures:`, `invariant:` keywords
   - Parse contract blocks in function/method/class definitions
   - AST nodes: `RequiresBlock`, `EnsuresBlock`, `InvariantBlock`
   - Support `old(expr)` for before/after comparisons
   - Support `result` for return value in ensures

2. **Type System** (3 hours)
   - Contract expression type checking
   - Ensure all contracts are boolean expressions
   - Resolve `old()` and `result` identifiers
   - Check contract scope (what variables are accessible)

3. **Runtime Checking** (4 hours)
   - Insert contract checks as runtime assertions
   - Requires: Check before function body
   - Ensures: Check after function body (before return)
   - Invariant: Check after constructor and each public method
   - Generate helpful error messages with violated contract

4. **Optional Static Checking** (6 hours - Future)
   - Z3 or similar SMT solver integration
   - Attempt to prove contracts statically
   - Warn on unprovable contracts
   - Skip runtime check if statically proven

5. **Testing** (2 hours)
   - Unit tests for parser
   - Integration tests for runtime checks
   - Examples demonstrating contract violations

**Total Estimate:** 11 hours (17 hours with static checking)

**Benefits for LLM:**
- LLM can read contracts to understand intent
- LLM-generated code violations caught immediately
- Contracts serve as executable specifications
- Reduces need for manual validation

**Files to Create/Modify:**
- `src/parser/src/statements/contract.rs` (new)
- `src/compiler/src/hir/contract.rs` (new)
- `src/compiler/src/mir/contract.rs` (new)
- `doc/spec/contracts.md` (new spec document)
- `test/02_integration/contracts/` (test suite)

## Phase 2: Language Core - Effect System Extension (HIGH PRIORITY)

### Feature: Capability-Based Imports

**Importance:** ⭐⭐⭐ Critical for preventing forbidden effects

**Syntax:**
```simple
# Module declares required capabilities
module app.domain requires[pure]:
    # Only pure functions allowed - no I/O, network, filesystem
    use crate.core.math.*  # OK - pure functions
    use crate.io.fs.*      # ERROR: fs capability not allowed

module app.api requires[io, net]:
    use domain.*           # OK - pure is always allowed
    use crate.io.fs.*      # OK - io capability granted
    use crate.net.http.*   # OK - net capability granted
    
# Functions declare required effects
@io @net
fn fetch_and_save(url: str, path: str) -> Result[(), Error]:
    let data = http.get(url)?  # Requires @net
    fs.write(path, data)?      # Requires @io
    return Ok(())
```

**Capabilities:**
- `pure` - No side effects (always allowed)
- `io` - File system, stdin/stdout/stderr
- `net` - Network operations
- `fs` - File system only (subset of io)
- `unsafe` - Pointer operations, FFI
- `async` - Async/await (already exists)

**Implementation Tasks:**

1. **Parser** (2 hours)
   - Parse `module X requires[cap1, cap2]` syntax
   - Parse `@effect` attributes on functions
   - Add capability keywords to lexer

2. **Module System** (4 hours)
   - Store required capabilities in DirectoryManifest
   - Propagate capabilities through module tree
   - Check imports against module capabilities

3. **Effect Checker** (6 hours)
   - Track effects used by each function
   - Infer effects from function calls
   - Check function effects against declared attributes
   - Check module imports against required capabilities
   - Generate clear error messages

4. **Standard Library Annotation** (4 hours)
   - Add @pure, @io, @net, @fs to all stdlib functions
   - Document effect requirements
   - Test effect propagation

5. **Testing** (2 hours)
   - Test capability violations
   - Test effect inference
   - Test cross-module effect checking

**Total Estimate:** 18 hours

**Benefits for LLM:**
- Prevents LLM from adding forbidden I/O to pure logic
- Enforces layered architecture (domain can't call network)
- Compile-time safety for effect usage
- Clear errors when LLM violates capability rules

**Files to Create/Modify:**
- `src/parser/src/statements/module.rs` (extend)
- `src/compiler/src/effects.rs` (extend)
- `src/compiler/src/module_resolver.rs` (extend)
- `doc/spec/effects.md` (new spec)
- All stdlib files (add @effect attributes)

## Phase 3: Tooling - AST/IR Export (MEDIUM PRIORITY)

### Feature: Machine-Readable Output Formats

**Importance:** ⭐⭐ Important for verification tooling

**CLI Flags:**
```bash
simple compile app.spl --emit-ast          # AST as JSON
simple compile app.spl --emit-hir          # HIR as JSON
simple compile app.spl --emit-mir          # MIR as JSON
simple compile app.spl --emit-all          # All representations
simple compile app.spl --error-format=json # Errors as JSON
```

**Output Format:**
```json
{
  "ast": {
    "nodes": [...],
    "source_map": {...}
  },
  "hir": {
    "items": [...],
    "types": {...}
  },
  "mir": {
    "functions": [...],
    "blocks": [...]
  },
  "diagnostics": {
    "errors": [
      {
        "code": "E2001",
        "message": "Type mismatch",
        "location": {...},
        "suggestions": [...]
      }
    ]
  }
}
```

**Implementation Tasks:**

1. **AST Serialization** (3 hours)
   - Add serde derives to AST nodes
   - Implement JSON export
   - Include source locations

2. **HIR/MIR Serialization** (4 hours)
   - Add serde to HIR/MIR types
   - Handle complex types (closures, etc.)
   - Include type information

3. **Error JSON Format** (2 hours)
   - Structured diagnostic output
   - Error codes, locations, suggestions
   - Compatible with LSP format

4. **CLI Integration** (2 hours)
   - Add --emit-* flags
   - Add --error-format flag
   - Output to files or stdout

5. **Testing** (2 hours)
   - Test JSON schema
   - Test round-trip (if applicable)
   - Test error format

**Total Estimate:** 13 hours

**Benefits for LLM:**
- External tools can verify LLM output
- Semantic diff instead of text diff
- Machine-checkable properties
- Integration with verification tools

**Files to Create/Modify:**
- `src/compiler/src/emit/ast_json.rs` (new)
- `src/compiler/src/emit/mir_json.rs` (new)
- `src/compiler/src/error_json.rs` (new)
- `src/driver/src/main.rs` (add flags)

## Phase 4: Tooling - Context Pack Generator (MEDIUM PRIORITY)

### Feature: Minimal Context Extraction

**Importance:** ⭐⭐ Reduces LLM token usage dramatically

**Goal:** Extract only the symbols/types/docs needed for a specific module, reducing context from megabytes to kilobytes.

**CLI:**
```bash
simple context app.service --format=markdown > context.md
simple context app.service --format=json > context.json
```

**Output Example (Markdown):**
```markdown
# Context for app.service

## Dependencies

### crate.core.Result[T, E]
Result type for error handling.

**Definition:**
```simple
enum Result[T, E]:
    Ok(value: T)
    Err(error: E)
```

### crate.net.http.HttpClient
HTTP client interface.

**Methods:**
- get(url: str) -> Result[Response, Error]
- post(url: str, body: str) -> Result[Response, Error]

## Current Module Interface

**Exports:**
- fetch_user(id: i64) -> Result[User, Error]
...
```

**Implementation Tasks:**

1. **Dependency Analysis** (4 hours)
   - Walk import graph from target module
   - Collect all referenced symbols
   - Include only public APIs of dependencies

2. **Documentation Extraction** (3 hours)
   - Extract docstrings
   - Extract type signatures
   - Extract contracts (if Phase 1 complete)

3. **Formatter** (3 hours)
   - Markdown formatter for LLM context
   - JSON formatter for tooling
   - Minimal but complete information

4. **CLI Integration** (2 hours)
   - Add `simple context` command
   - Format options
   - Output options

5. **Testing** (2 hours)
   - Test on stdlib modules
   - Verify completeness
   - Check size reduction

**Total Estimate:** 14 hours

**Benefits for LLM:**
- Dramatically reduced token count
- Only relevant information included
- Faster LLM processing
- More focused code generation

**Files to Create/Modify:**
- `src/driver/src/context_pack.rs` (new)
- `src/compiler/src/dependency_graph.rs` (extend)
- `src/driver/src/main.rs` (add context command)

## Phase 5: Testing Infrastructure (MEDIUM PRIORITY)

### Feature: Property-Based Testing + Golden Tests

**Importance:** ⭐⭐ Catches edge cases LLMs miss

**Property-Based Testing:**
```simple
use std.testing.property.*

@property_test
fn test_sort_idempotent(input: List[i64]):
    # Property: sorting twice gives same result as sorting once
    expect(sort(sort(input))).to eq(sort(input))

@property_test(iterations: 1000)
fn test_reverse_reverse(input: List[i64]):
    # Property: reversing twice gives original
    expect(reverse(reverse(input))).to eq(input)
```

**Golden/Snapshot Tests:**
```simple
use std.testing.snapshot.*

@snapshot_test
fn test_render_user_json():
    user = User(id: 42, name: "Alice")
    json = render_json(user)
    
    # First run: creates snapshots/test_render_user_json.json
    # Subsequent runs: compares output to snapshot
    expect_snapshot(json, format: "json")
```

**Implementation Tasks:**

1. **Property Testing Framework** (6 hours)
   - Random input generation
   - Configurable iterations
   - Shrinking on failure
   - Integration with BDD framework

2. **Snapshot Testing** (4 hours)
   - Snapshot storage/comparison
   - Update mode for intentional changes
   - Multiple formats (JSON, text, binary)

3. **Standard Generators** (4 hours)
   - Generators for all primitive types
   - Generators for collections
   - Custom generator combinators

4. **Integration** (2 hours)
   - CLI: `simple test --snapshot-update`
   - Reporting in test output

**Total Estimate:** 16 hours

**Benefits for LLM:**
- Catches edge cases automatically
- Validates invariants across inputs
- Makes regressions obvious
- Complements unit tests

**Files to Create/Modify:**
- `lib/std/testing/property/` (new)
- `lib/std/testing/snapshot/` (new)
- Integrate with BDD framework

## Phase 6: Linting - Forbidden Patterns (LOW PRIORITY)

### Feature: Configurable Lint Rules

**Importance:** ⭐ Nice to have for code quality

**Configuration (`simple.toml`):**
```toml
[lint]
# Error levels: allow, warn, deny
unchecked_indexing = "deny"
global_mutable_state = "deny"
ad_hoc_parsing = "warn"
magic_numbers = "warn"
deep_nesting = "warn"

[lint.rules]
max_function_length = 50
max_nesting_depth = 4
```

**Implementation Tasks:**

1. **Lint Framework** (4 hours)
   - Lint rule trait
   - Rule registry
   - Configuration parsing

2. **Built-in Rules** (6 hours)
   - Unchecked indexing detector
   - Global state detector
   - Magic number detector
   - Complexity metrics

3. **Auto-fix** (4 hours)
   - Suggest fixes for violations
   - Apply fixes automatically

4. **Integration** (2 hours)
   - CLI: `simple lint --fix`
   - CI integration

**Total Estimate:** 16 hours

## Phase 7: Documentation

### Feature: Comprehensive LLM-Friendly Docs

**Tasks:**

1. **LLM Usage Guide** (4 hours)
   - Best practices for LLM code generation
   - Contract writing guide
   - Effect system explanation
   - Testing strategies

2. **Examples** (4 hours)
   - Annotate stdlib with contracts
   - Add property tests to examples
   - Golden tests for public APIs

3. **Tool Documentation** (2 hours)
   - Context pack usage
   - AST/IR export tools
   - Verification workflows

**Total Estimate:** 10 hours

## Implementation Priority

### Sprint 1: Contracts (2 weeks)
- **Week 1:** Parser + Type System (5 hours)
- **Week 2:** Runtime checking + Tests (6 hours)
- **Deliverable:** Working contract blocks with runtime verification

### Sprint 2: Effects (2 weeks)
- **Week 1:** Parser + Module System (6 hours)
- **Week 2:** Effect Checker + Stdlib Annotation (12 hours)
- **Deliverable:** Capability-based imports working

### Sprint 3: Tooling (2 weeks)
- **Week 1:** AST/IR Export (13 hours)
- **Week 2:** Context Pack Generator (14 hours)
- **Deliverable:** External verification support

### Sprint 4: Testing (2 weeks)
- Property-based testing framework (16 hours)
- **Deliverable:** Comprehensive testing infrastructure

### Sprint 5: Polish (1 week)
- Linting rules (16 hours)
- Documentation (10 hours)
- **Deliverable:** Production-ready LLM-friendly language

## Total Effort Estimate

- Phase 1 (Contracts): 11 hours
- Phase 2 (Effects): 18 hours
- Phase 3 (AST Export): 13 hours
- Phase 4 (Context Pack): 14 hours
- Phase 5 (Property Testing): 16 hours
- Phase 6 (Linting): 16 hours
- Phase 7 (Docs): 10 hours

**Total: ~98 hours (~12 working days)**

## Success Metrics

1. **LLM Error Rate:** <5% of LLM-generated code has contract violations
2. **Effect Violations:** 0% of effect violations in production code
3. **Context Size:** 90% reduction in context needed for LLM
4. **Test Coverage:** Property tests catch 80%+ of edge cases
5. **Developer Satisfaction:** 90%+ positive feedback on LLM workflow

## Dependencies

- BDD Spec Framework (for property test integration)
- Module System (complete for capability-based imports)
- Effect System (extend existing @async)

## Notes

- Start with Phase 1 (Contracts) as it has highest impact
- Phase 2 (Effects) builds on existing effect system
- Phases 3-4 are independent and can be parallelized
- Doctest system (already implemented) is a huge win!
