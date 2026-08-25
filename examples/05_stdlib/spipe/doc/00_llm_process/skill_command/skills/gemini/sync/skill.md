<!-- llm-process-gen: managed source=gemini_sync_skill source_sha256=2f9d4bf427a6a875f0e162661da3f31d4647be3f9159da54eec4e0a22e836efc content_sha256=1a3ccd8c61708f2e71ad6dbccba183feacd1828e3e80cfcb43957c5a239b61ff -->
# sync

Source: `.gemini/commands/sync.toml`

Pull, rebase, and push with file-count safety checks. Worktree-aware jj sync.

Sync the repository: fetch, rebase, push with safety guards.

## Rules
1. **NO BRANCHES** — work directly on `main`
2. **NO ORPHAN COMMITS** — never leave detached
3. **LINEAR HISTORY** — rebase, never merge
4. **FILE COUNT GUARD** — check file count before/after rebase; abort if unexpected reduction

## Workflow

```bash
# 0. Pre-check: record baseline
FILE_COUNT_BEFORE=$(git ls-files | wc -l | tr -d ' ')
echo "File count before sync: $FILE_COUNT_BEFORE"

# 1. Commit local changes (if any)
jj commit -m "<type>: <msg>"

# 2. Fetch remote
jj git fetch

# 3. Rebase onto latest remote
jj rebase -d main@origin

# 4. Post-rebase file count check
FILE_COUNT_AFTER=$(git ls-files | wc -l | tr -d ' ')
echo "File count after rebase: $FILE_COUNT_AFTER"
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
"""