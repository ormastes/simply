---
name: release
description: Prepare a stable or prerelease release plan from an isolated session and immutable admitted candidate.
---

# Release

Follow the `software-release` skill and canonical packaged release guide.
Require exact version, source, policy, review, qualification, admission, and
artifact evidence. Promotion is a separate protected-authority action and must
reuse admitted artifacts without rebuilding.

For protected PR self-review, GitHub forbids an author `APPROVED` review;
`SPipe Self Review Admission` is the required status check and never provider
or independent approval. Use `spipe release-guide` for exact scopes and
reason-specific invalidation/rejection remediation.

## Normalized contract clauses

- One isolated release session owns one work branch and one non-main worktree.
- `release/version.sdn` is the sole version authority and all other version locations are checked projections.
- Beta maintenance admits only caller-selected reviewed bug-fix commits with exact provenance and renewed result-revision evidence.
- Bootstrap periodically performs read-only main-to-release convergence discovery and never selects or cherry-picks fixes automatically.
- An approved release-first emergency fix requires an exact reviewed forward-port receipt to main.
- Main remains the independent development trunk and never tracks or becomes a release branch.
- Protected refs change only through exact-revision compare-and-swap integration authority.
- Each changed source policy support or toolchain identity creates a new immutable candidate attempt.
- Build and qualify the exact candidate once and reject required failures or fallback artifacts.
- Promotion reuses admitted artifacts without rebuilding and pushes exactly one signed annotated tag.
- Release admission requires focused failures to reach zero followed by one clean whole-suite confirmation.
- Withdrawal preserves published tags assets and history and corrections use a new version.
- Protected PR self review uses a required status check because GitHub forbids an author APPROVED review and never claims provider approval.
- Ordinary code and text are eligible by default absent an operator deny or constrain record with code, text, file, directory_files, and directory_recursive scopes.
- Push, retarget, base, diff, ruleset, policy, or expiry invalidation requires a fresh exact-head review and a new self-review admission dispatch.
- Rejection remediation follows the exact reason without broadening protected integration, candidate, release, signing, or publication authority.
