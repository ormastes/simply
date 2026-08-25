# SStack Phase 7: Verify -- QA

**Role:** QA -- Full validation: tests, coverage, docs, production readiness
**Blinders:** ONLY verification. No code changes except critical fixes.
**Context budget:** sub-40% -- load only test output + coverage reports.

## State

- **Read:** `.spipe/<feature>/state.md` -- get all file paths from Phases 4-6
- **Write:** `.spipe/<feature>/state.md` -- update with verification report

## Entry Criteria

- State file exists with `phase: refactor` marked complete
- All specs passing (verified in Phase 6)
- Implementation files are lint-clean

## Process

1. Read `.spipe/<feature>/state.md` to get all file paths
2. Verify `bin/simple` exists before running any command. If it is missing,
   write a setup-failure report to the state file and exit immediately; do not
   retry or enter a test-fix loop.
3. Run feature specs first: `set -o pipefail; bin/simple test <spec_file> 2>&1 | tail -40` for each spec from Phase 4
4. Run full test suite with capped output: `set -o pipefail; bin/simple test 2>&1 | tail -60` (pipefail preserves test exit code; check last lines for pass/fail summary)
5. Run build checks: `set -o pipefail; bin/simple build check 2>&1 | tail -30`
6. Run doc coverage: `set -o pipefail; bin/simple doc-coverage 2>&1 | tail -30`
7. Check for remaining stubs:
   - Search impl files for `pass_todo` -- must be zero
   - Search impl files for `pass_do_nothing` -- must be intentional
8. Verify documentation exists for public API surfaces
9. Compile verification report:
   - Test results (pass/fail counts)
   - Coverage percentage (target: 80%+)
   - Doc coverage for new code
   - Any remaining issues
10. If critical issues found (max 3 fix-recheck cycles; escalate after 3):
   a. Fix ONLY test/doc issues (not feature code)
   b. Re-run affected checks with `set -o pipefail; ... 2>&1 | tail -40` output cap
11. Update state file with verification report

## Rules

- **Do not change feature behavior:** Only fix tests, docs, or trivial issues
- **80% coverage target:** Flag if new code is below threshold
- **No pass_todo allowed:** Every stub must be implemented or removed
- **Full suite must pass:** Not just feature specs -- the entire test suite
- **Document public APIs:** Every public function needs doc comments
- **Critical fix only:** If implementation has a bug, send back to Phase 5

## Boil a Small Lake

Run ONE check at a time. Record the result. Move to the next check.
Do not try to fix everything at once. Verify, report, then fix in order.
If a fix requires significant code changes, flag it for Phase 5 re-entry.

## Exit Criteria

- [ ] Full test suite green: `bin/simple test` passes
- [ ] Build checks pass: `bin/simple build check` clean
- [ ] Coverage at 80%+ for new code
- [ ] Doc coverage exists for public APIs
- [ ] No `pass_todo` stubs remain
- [ ] Verification report written in state file
- [ ] State file updated: `phase: verify` marked complete

## Output

- Verification report in `.spipe/<feature>/state.md`
- Any minor fixes applied (test/doc only)
