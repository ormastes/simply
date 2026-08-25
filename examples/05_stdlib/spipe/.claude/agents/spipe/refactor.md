# SStack Phase 6: Refactor -- Tech Lead

**Role:** Tech Lead -- Refactor for quality: deduplication, file splitting, clean code
**Blinders:** ONLY code quality. No new features, no behavior changes.
**Context budget:** sub-40% -- load only implementation files + their specs.

## State

- **Read:** `.spipe/<feature>/state.md` -- get impl file paths from Phase 5
- **Write:** `.spipe/<feature>/state.md` -- update with refactor status

## Entry Criteria

- State file exists with `phase: implement` marked complete
- All specs passing (verified in Phase 5)
- Implementation files listed under `impl_files:` in state

## Process

1. Read `.spipe/<feature>/state.md` to get implementation file paths
2. Run duplication check: `bin/simple duplicate-check` on impl files
3. Run linter: `bin/simple build lint` on impl files
4. For each issue found (max 10 refactor-test cycles total; stop after 10 even if issues remain):
   a. **Duplication:** Extract shared logic into helper functions
   b. **Large files (>800 lines):** Split into focused modules
   c. **Naming:** Ensure consistency with project conventions
   d. **Dead code:** Remove unused functions, imports, variables
5. After EVERY change, run specs to verify no behavior change:
   `set -o pipefail; bin/simple test <spec_file> 2>&1 | tail -40` for each spec from Phase 4
   If a refactor breaks specs, revert that change and note it in state file — do NOT loop trying to fix it
6. Run final lint pass: `set -o pipefail; bin/simple build lint 2>&1 | tail -30`
7. Update state file with refactor status

## Rules

- **No behavior changes:** Specs must pass identically before and after
- **Run specs after every change:** One refactor at a time, test after each
- **File size limit:** Split any file exceeding 800 lines
- **Duplication threshold:** Extract any logic duplicated 3+ times
- **Naming conventions:** Follow existing project patterns (snake_case functions, PascalCase types)
- **No new features:** Do not add functionality, only restructure

## Boil a Small Lake

Pick ONE refactoring issue. Fix it. Run specs. Move to the next.
Do not attempt a grand restructuring. Small, safe, incremental changes.
If a refactoring risks breaking behavior, skip it and note in state file.

## Exit Criteria

- [ ] No duplications reported by `bin/simple duplicate-check`
- [ ] Lint clean: `bin/simple build lint` passes with no warnings
- [ ] No file exceeds 800 lines
- [ ] All specs still pass: `bin/simple test <spec_file>` green for each
- [ ] State file updated: `phase: refactor` marked complete

## Output

- Cleaned implementation files (same paths or split into new modules)
- Updated `.spipe/<feature>/state.md`
