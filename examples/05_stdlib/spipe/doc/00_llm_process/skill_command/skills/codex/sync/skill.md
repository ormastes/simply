<!-- llm-process-gen: managed source=codex_sync_skill source_sha256=c7843bc7156c20b4d7e01acc2603b91e6662b1147c2275a6e0841ccfa82253a1 content_sha256=c7843bc7156c20b4d7e01acc2603b91e6662b1147c2275a6e0841ccfa82253a1 -->
---
name: sync
description: "Pull, rebase, and push with file-count safety checks. Worktree-aware jj sync. Use when syncing the repository."
---

# Sync Skill — Pull/Rebase/Push with Safety Checks

## Rules
1. **NO BRANCHES** — work directly on `main`
2. **NO ORPHAN COMMITS** — never leave detached
3. **LINEAR HISTORY** — rebase, never merge
4. **FILE COUNT GUARD** — check file count before/after rebase; abort if unexpected reduction

## Workflow

```bash
# 0. Pre-check: record baseline
FILE_COUNT_BEFORE=$(git ls-files | wc -l | tr -d ' ')

# 1. Commit local changes (if any)
jj commit -m "<type>: <msg>"

# 2. Fetch remote
jj git fetch

# 3. Rebase onto latest remote
jj rebase -d main@origin

# 4. Post-rebase file count check
FILE_COUNT_AFTER=$(git ls-files | wc -l | tr -d ' ')
if [ "$FILE_COUNT_AFTER" -lt "$FILE_COUNT_BEFORE" ]; then
  echo "WARNING: File count reduced ($FILE_COUNT_BEFORE -> $FILE_COUNT_AFTER)"
  jj diff --stat
  echo "Restore with: jj op restore <op_id>"
  echo "Stopping before bookmark/push. Continue manually only after human review."
  exit 1
fi

# 5. Push
jj bookmark set main -r @-
jj git push --bookmark main
```

## Worktree Sync
If on a jj workspace (not default), discover the workspace paths with
`jj workspace list`, move to the default workspace path first, sync there,
then return to the original workspace path and run `jj workspace update-stale`.

## Safety
- If file count drops unexpectedly, show `jj diff --stat`, exit before bookmark/push, and require explicit human continuation outside the script block
- Restore with: `jj op restore <op_id>` if rebase went wrong
