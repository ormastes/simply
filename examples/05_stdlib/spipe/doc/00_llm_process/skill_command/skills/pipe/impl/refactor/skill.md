<!-- llm-process-gen: managed source=pipe_impl_refactor_skill source_sha256=93a532e9e584b4d5a91c7ec7bf27cd84309a7e37ad3269f3164e9fa3fa1e5471 content_sha256=93a532e9e584b4d5a91c7ec7bf27cd84309a7e37ad3269f3164e9fa3fa1e5471 -->
# Refactor Skill

## Phase 1: File Size & Structure

- **Source files:** 800 lines max. Split oversized files with meaningful names (NOT `xx_1.spl`)
- Update all imports after splitting. Confirm each deletion/move with user.
- Intentional exceptions: `#![allow(large_file)]  # Intentional: <reason>`

## Phase 2: Duplication Removal

```bash
bin/simple duplicate-check <dir>                        # Semantic duplication by default
bin/simple duplicate-check <dir> --semantic-threshold 0.92  # Tighten semantic matching
bin/simple duplicate-check <dir> --format json         # Machine-readable semantic report
```

Fix: extract shared helpers, use parameter objects for repeated param lists (3+).

## Phase 3: Coupling Measurement

| Metric | Target |
|--------|--------|
| CBO (coupled classes) | < 8 |
| Fan-out (dependencies) | < 10 |
| SCC cycles | 0 |
| RFC (methods + called) | < 50 |
| LCOM (cohesion) | Close to 0 |

**Layer violations**: deps must flow downward through `src/compiler/NN.name/` layers.

```bash
bin/simple query workspace-symbols --query <symbol>   # Find symbols
bin/simple query references <file> <line>              # Trace dependencies
```

## Phase 4: Big-O Analysis

For each public function, identify complexity. Flag O(n^2)+:
- Nested loops over same collection -> hash lookup
- String concat in loops -> builder
- `arr + [item]` in loops -> `.push()`
- Re-reading files/recomputing in loops -> cache/hoist

## Phase 5: Test Verification

```bash
bin/simple test <focused-scope>
bin/simple lint <changed .spl files>
bin/simple duplicate-check <owned-dir> --mode token --min-lines 5
```

Run after EACH phase. NEVER skip failing tests. Fix refactoring, not tests.

## Workflow

1. **Scan**: duplication checker, file sizes, coupling metrics
2. **Plan**: list issues, prioritize by impact
3. **Confirm**: show plan to user, get approval
4. **Fix**: one file at a time
5. **Verify**: tests after each change
6. **Report**: before/after metrics
