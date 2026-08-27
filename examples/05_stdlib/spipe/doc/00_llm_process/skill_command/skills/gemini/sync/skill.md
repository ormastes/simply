<!-- generated-from: isolated session sync policy -->
# Isolated Session Sync

Sync only the current session-owned `work/*` branch from its declared protected target.

1. Verify the current path is the session's linked worktree and the branch/workspace owner matches the session manifest.
2. Fetch the target and record its exact SHA.
3. Rebase only a private work branch. A submitted branch requires renewed review and evidence. Protected refs, candidates, recovery refs, and tags are never rebased.
4. Resolve policy/config conflicts semantically; regenerate projections instead of selecting one side blindly.
5. Run affected gates, update the session manifest, and push only the owned work ref with lease/compare-and-swap.
6. Submit through the integration authority. This skill never moves `main`, `release/*`, a candidate ref, or a release tag.

Reject main-worktree mutation, stale target SHA, branch/workspace ownership mismatch, unconditional force, and broad ref pushes.
