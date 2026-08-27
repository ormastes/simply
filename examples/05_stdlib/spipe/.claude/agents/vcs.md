# VCS Agent - Version Control (JJ / Git)

**Use when:** Committing, pushing, syncing, viewing history, managing changes.
**Skills:** `/sync`

## Quick Reference

| Task | JJ Command | Git Equivalent |
|------|-----------|----------------|
| Check status | `jj st` | `git status` |
| View changes | `jj diff` | `git diff` |
| Commit (snapshot) | `jj commit -m "message"` | `git add -A && git commit -m "message"` |
| Describe working copy | `jj describe -m "message"` | `git commit --amend -m "message"` (before push) |
| View history | `jj log` | `git log --oneline -20` |
| Push owned branch | `jj git push --bookmark <work-branch>` | `git push --force-with-lease origin <work-branch>` |
| Fetch from remote | `jj git fetch` | `git fetch` |
| Rebase on latest | `jj rebase -d main@origin` | `git rebase origin/main` |
| Show change | `jj show <change_id>` | `git show <commit>` |
| Abandon change | `jj abandon <change_id>` | `git reset` |
| Squash into parent | `jj squash` | `git rebase -i` (squash) |
| Edit past change | `jj edit <change_id>` | `git rebase -i` (edit) |
| File count | `git ls-files \| wc -l` | Check tracked file count |

## Key Concepts

- **Working copy IS a commit** - jj automatically tracks all file changes, no staging needed
- **No staging area** - every save is already tracked; `jj commit` snapshots current state
- **`describe` vs `commit`** - `describe` updates the current change's message; `commit` finalizes it and starts a new empty change
- **Change IDs are stable** - unlike git commit hashes, jj change IDs survive rebases
- **JJ-Change-Id trailer** - automatically appended to commit messages via config

## Standard Workflow

```bash
# 1. Work in the session's unique worktree and work branch

# 2. Check what changed
jj st
jj diff

# 3. Commit
jj commit -m "feat: add new feature"

# 4. Push the owned branch and submit for protected integration
jj git push --bookmark <work-branch>
/repo_and_pull_req push --target=main --level=normal
```

## Sync Workflow (Pull/Rebase/Push with Safety)

See `/sync` skill for full details. Key steps:

```bash
# 1. Record file count
FILE_COUNT=$(git ls-files | wc -l | tr -d ' ')

# 2. Commit, fetch, rebase
jj commit -m "<type>: <msg>"
jj git fetch
jj rebase -d main@origin

# 3. Verify file count not reduced
NEW_COUNT=$(git ls-files | wc -l | tr -d ' ')
echo "Before: $FILE_COUNT, After: $NEW_COUNT"

# 4. Push only the session-owned work branch
jj git push --bookmark <work-branch>
```

## Orphan Prevention

- **NEVER** leave commits detached from their owned work branch
- Recover orphans into a new isolated session branch
- Rebase private work onto `main@origin`; never rebase protected refs

## Worktree Sync

Stay in the isolated session worktree. Fetch, rebase the private branch onto the
exact target, rerun affected checks, and push only that owned branch. The main
worktree is read-only.

## Fixing Past Changes

```bash
# Edit a past change (working copy moves to it)
jj edit <change_id>
# Make fixes, then create new change on top
jj new

# Squash current change into parent
jj squash

# Squash specific change into its parent
jj squash -r <change_id>

# Split a change
jj split -r <change_id>
```

## Rules

- One session has one unique work branch and one unique worktree
- Never author in the main worktree or directly update a protected ref
- LINEAR history - squash if needed
- NO orphan commits - everything belongs to an owned work branch
- FILE COUNT GUARD - check before/after every rebase
- Use jj as primary VCS (git commands available for tags, gh CLI)

## Commit Message Format

```
<type>: <short description>

[optional body]

JJ-Change-Id: <auto-appended>
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`

## See Also

- `/sync` - Full sync workflow with file-count safety
