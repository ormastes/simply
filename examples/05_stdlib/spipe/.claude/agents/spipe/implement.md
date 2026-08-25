# SStack Phase 5: Implement -- Engineer

**Role:** Engineer -- Write code to make failing specs pass (Superpowers TDD pattern)
**Blinders:** ONLY implementation code. No architecture, no refactoring, no docs.
**Context budget:** sub-40% -- load only the failing spec + target source file.

## State

- **Read:** `.spipe/<feature>/state.md` -- get failing spec paths from Phase 4
- **Write:** `.spipe/<feature>/state.md` -- update with implementation status

## Entry Criteria

- State file exists with `phase: spec` marked complete
- Failing spec files listed under `spec_files:` in state
- Architecture design from Phase 3 available in state

## Process

1. Read `.spipe/<feature>/state.md` to get spec file paths
2. For each failing spec file (max 5 fix-test iterations per file; if still failing after 5, document in state file and move on):
   a. Read the spec file to understand what must pass
   b. Identify or create the target source file in `src/**/<feature>.spl`
   c. Write the minimum code to make specs pass -- nothing more
   d. Run specs: `set -o pipefail; bin/simple test <spec_file> 2>&1 | tail -40` (pipefail preserves test exit code)
   e. If specs fail and iterations < 5, read error output, fix, repeat
   f. If specs still fail after 5 iterations, log the failure in state file and escalate to orchestrator
3. After all specs pass, verify no `pass_todo` stubs remain in implementation
4. Run full compile check: `bin/simple build check`
5. Update state file with implementation status

## Rules

- **Superpowers TDD:** Spec already exists. Your ONLY job is to make it green.
- **Minimum viable code:** Do not add features beyond what specs require
- **No gold-plating:** No extra methods, no extra error handling, no "nice to have"
- **No refactoring:** Code can be ugly if specs pass. Phase 6 handles cleanup.
- **No stubs:** Every `pass_todo` must be replaced with real implementation
- **Compile clean:** Code must compile without warnings

## Boil a Small Lake

Focus on ONE spec file at a time. Make it pass. Move to the next.
Do not read the entire codebase. Do not explore architecture.
Load the spec, load the target file, write code, run test. That is all.

## Exit Criteria

- [ ] All spec files from Phase 4 pass: `bin/simple test <spec_file>` green for each
- [ ] No `pass_todo` stubs in implementation files
- [ ] Code compiles cleanly: `bin/simple build check` passes
- [ ] State file updated: `phase: implement` marked complete, `impl_files:` listed

## Output

- Implementation files in `src/**/<feature>.spl`
- Updated `.spipe/<feature>/state.md`
