<!-- llm-process-gen: managed source=pipe_impl_sync_skill source_sha256=8acf4f00e63984821bb9c1932260557a52fc2f864249e26c5a6115f4c75b978d content_sha256=8acf4f00e63984821bb9c1932260557a52fc2f864249e26c5a6115f4c75b978d -->
# Sync Skill - Pull/Rebase/Push with Safety Checks

## Overview

Sync = fetch + rebase + push with **file-count safety checks** at every step.
Handles worktree-aware sync: if on a jj workspace, moves to main, syncs, returns.

## Rules
1. **NO BRANCHES** — work directly on `main`
2. **NO ORPHAN COMMITS** — cherrypick onto main, never leave detached
3. **LINEAR HISTORY** — rebase, never merge
4. **FILE COUNT GUARD** — check file count before/after each rebase; abort if unexpected reduction

---

## Sync Workflow (Main)

```bash
# 0. Pre-check: record baseline file count
FILE_COUNT_BEFORE=$(git ls-files | wc -l | tr -d ' ')
echo "File count before sync: $FILE_COUNT_BEFORE"

# 1. Commit local changes (if any)
jj commit -m "<type>: <msg>"

# 2. Fetch remote
jj git fetch

# 3. Check each incoming commit's file count
# List commits between local and remote
git log --oneline main..origin/main | while read hash msg; do
  count=$(git ls-tree -r --name-only $hash | wc -l | tr -d ' ')
  echo "Commit $hash ($msg): $count files"
done

# 4. Rebase onto latest remote
jj rebase -d main@origin

# 5. Post-rebase file count check
FILE_COUNT_AFTER=$(git ls-files | wc -l | tr -d ' ')
echo "File count after rebase: $FILE_COUNT_AFTER"
if [ "$FILE_COUNT_AFTER" -lt "$FILE_COUNT_BEFORE" ]; then
  echo "WARNING: File count reduced ($FILE_COUNT_BEFORE -> $FILE_COUNT_AFTER)"
  jj diff --stat
  echo "Restore with: jj op restore <op_id>"
  echo "Stopping before bookmark/push. Continue manually only after human review."
  exit 1
fi

# 6. Push
jj bookmark set main -r @-
jj git push --bookmark main
```

---

## Worktree-Aware Sync

If currently on a jj workspace (not default), move to main first:

```bash
# 1. Check current workspace
CURRENT_WS=$(jj workspace list | grep '(current)' | awk '{print $1}')

if [ "$CURRENT_WS" != "default" ]; then
  # 2. Save current workspace name and discover workspace paths
  WS_NAME="$CURRENT_WS"
  jj workspace list

  # 3. Switch to the discovered default workspace directory
  cd "<default workspace path from jj workspace list>"

  # 4. Do sync (full workflow above)
  # ...

  # 5. Return to the discovered original workspace directory
  cd "<original workspace path from jj workspace list>"
  jj workspace update-stale
fi
```

---

## Orphan Commit Prevention

**Never leave commits detached from main.** If you find orphan commits:

```bash
# 1. Identify orphan commits
jj log  # look for commits not on main lineage

# 2. Cherrypick onto main (using jj)
jj new main                          # create new change on main
jj restore --from <orphan_change_id> # copy content from orphan
jj commit -m "<type>: <msg>"         # commit on main

# 3. Abandon the orphan
jj abandon <orphan_change_id>

# 4. Push
jj bookmark set main -r @-
jj git push --bookmark main
```

**Alternative — squash orphan into main lineage:**
```bash
jj rebase -r <orphan_change_id> -d main
jj squash -r <orphan_change_id>
```

---

## File Count Safety Protocol

Run before EVERY rebase:

```bash
# Count tracked files
FILE_COUNT=$(git ls-files | wc -l | tr -d ' ')
echo "Tracked files: $FILE_COUNT"

# After rebase, compare
NEW_COUNT=$(git ls-files | wc -l | tr -d ' ')
DIFF=$((NEW_COUNT - FILE_COUNT))
if [ "$DIFF" -lt 0 ]; then
  echo "ALERT: $((DIFF * -1)) files lost after rebase!"
  jj diff --stat
  echo "Restore with: jj op restore <op_id>"
  echo "Stopping before bookmark/push. Continue manually only after human review."
  exit 1
fi
```

Per-commit file count audit:
```bash
# Check each commit in the rebase range
for commit in $(git log --format=%H main@{1}..main); do
  count=$(git diff --stat $commit~1 $commit | tail -1)
  echo "$commit: $count"
done
```

---

## Quick Reference

| Task | Command |
|------|---------|
| Status | `jj st` |
| Diff | `jj diff` |
| Commit | `jj commit -m "type: message"` |
| Describe | `jj describe -m "message"` |
| Log | `jj log` |
| Show | `jj show <change_id>` |
| Push | `jj bookmark set main -r @- && jj git push --bookmark main` |
| Fetch | `jj git fetch` |
| Rebase | `jj rebase -d main@origin` |
| Squash | `jj squash` |
| Undo | `jj undo` |
| Op log | `jj op log` |
| Restore | `jj op restore <op_id>` |
| File count | `git ls-files \| wc -l` |

## Conflict Resolution

- SDN files: `jj resolve --tool=internal:ours <file.sdn>` (local wins)
- Source files: manual edit → `jj resolve <file.spl>`
- Post-resolve: `bin/simple test && bin/simple bug-gen && bin/simple todo-scan`

## Recovery

```bash
jj op log                    # View operation history
jj op restore <op_id>       # Restore to previous state
```

## Commit Types
`feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `build`

## Git Dependencies
Tags: `git tag -a vX.Y.Z -m "msg" && git push origin vX.Y.Z`
GitHub CLI: `gh pr`, `gh release`, `gh issue`
