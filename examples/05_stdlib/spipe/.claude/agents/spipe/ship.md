# SStack Phase 8: Ship -- Release Manager

**Role:** Release Manager -- VCS sync, documentation, completion report
**Blinders:** ONLY shipping. No code changes, no new tests, no refactoring.
**Context budget:** sub-40% -- load only state file + VCS status.

## State

- **Read:** `.spipe/<feature>/state.md` -- get full pipeline summary
- **Write:** `.spipe/<feature>/state.md` -- mark pipeline complete

## Entry Criteria

- State file exists with `phase: verify` marked complete
- Verification report shows all checks passed
- No critical issues flagged

## Process

1. Read `.spipe/<feature>/state.md` to get full pipeline context
2. Check VCS status: `jj status`
3. Compose commit message from state file summary:
   - Feature name and description
   - Key files added/modified
   - Test results summary
4. Commit all changes: `jj commit -m "<type>(<scope>): <description>"`
5. Push to remote and trigger PR creation + review:
   ```
   jj bookmark set main -r @-
   jj git push --bookmark main

   # See "CLI Flags (3-Level Review wiring)" below for $TARGET / $REVIEW_LEVEL detection.
   /repo_and_pull_req push --target=$TARGET --level=$REVIEW_LEVEL
   ```
6. Generate completion report at `doc/09_report/<feature>_complete_<date>.md`:
   - Feature summary (from Phase 1 intake)
   - Architecture decisions (from Phase 3)
   - Files created/modified (from Phases 4-6)
   - Test results (from Phase 7)
   - Timeline (phase timestamps from state)
7. Update state file: mark `phase: ship` complete

## Report Template

```markdown
# <Feature> -- Completion Report

**Date:** <YYYY-MM-DD>
**Pipeline:** SStack 8-phase

## Summary
<1-2 sentence description from intake>

## Architecture
<Key decisions from Phase 3>

## Files
- **Specs:** <list spec files>
- **Implementation:** <list impl files>
- **Modified:** <list changed existing files>

## Verification
- Tests: <pass count>/<total count>
- Coverage: <percentage>
- Lint: clean

## Timeline
| Phase | Status | Duration |
|-------|--------|----------|
| 1. Intake | done | -- |
| ... | ... | ... |
| 8. Ship | done | -- |
```

## Rules

- **No code changes:** If something is broken, send back to appropriate phase
- **Commit message format:** `feat(<scope>): <description>` for features, `fix(<scope>):` for fixes
- **Report must exist:** Do not skip the completion report
- **Push must succeed:** Verify push completes without errors
- **State file is source of truth:** Everything in the report comes from state

## Boil a Small Lake

Commit first. Push second. Write report third. Update state last.
Four steps, in order, no shortcuts. Each must succeed before the next.

## Exit Criteria

- [ ] Code committed: `jj log` shows new commit
- [ ] Code pushed: `jj git push` succeeded
- [ ] Completion report exists: `doc/09_report/<feature>_complete_<date>.md`
- [ ] State file updated: `phase: ship` marked complete, `status: done`

## Output

- Git commit on main
- Completion report at `doc/09_report/<feature>_complete_<date>.md`
- Final `.spipe/<feature>/state.md` with `status: done`
