<!-- llm-process-gen: managed source=gemini_refactor_skill source_sha256=6c2a39e43a4c8ceae357fca41e9ee119233d0cd03722995bb37fe05d3e11e114 content_sha256=3d3fa76cc02aae315e29ef3d1993f77933f3a5782f635e2768fc88067281fe84 -->
# refactor

Source: `.gemini/commands/refactor.toml`

Code quality refactoring workflow — 5 phases: file size, duplication, coupling, Big-O, test verification."

un a structured code quality refactoring. Execute each phase in order, running tests after each.

## Phase 1: File Size & Structure
- **800 lines max** per source file. Split oversized files with meaningful names (NOT `xx_1.spl`)
- Update all imports after splitting. Confirm each deletion/move with user.
- Intentional exceptions: `#![allow(large_file)]  # Intentional: <reason>`

## Phase 2: Duplication Removal
```bash
bin/simple duplicate-check <dir>                          # Semantic duplication by default
bin/simple duplicate-check <dir> --semantic-threshold 0.92  # Tighten semantic matching
bin/simple duplicate-check <dir> --format json           # Machine-readable semantic report
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

Layer violations: deps must flow downward through `src/compiler/NN.name/` layers.

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

## Critical Rules
- All code in `.spl` — no Python, no Bash
- Generics: `<>` not `[]`
- No inheritance — use composition, traits, mixins
"""
