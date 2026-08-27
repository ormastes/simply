# Protected Software Release

Release contract: isolated-session; reviewed-beta-backport; immutable-candidate; promote-without-rebuild; protected-ref-guard; non-destructive-release-identity.

This is the semantic source for Simple/Spipe stable, alpha, beta, RC, patch, and hotfix release projections.

## Invariants

1. Start one isolated release session with one `work/release/...` or `work/backport/...` branch and one physical worktree. The main worktree is read-only.
2. Read the product version from `release/version.sdn`; all other version locations are checked projections.
3. Use lowercase numbered prereleases: `X.Y.Z-alpha.N`, `X.Y.Z-beta.N`, or `X.Y.Z-rc.N`.
4. Beta maintenance uses `release/X.Y`. Admit only a caller-selected, reviewed bug-fix commit through `simple release backport-check`; record source SHA, change/work IDs, target line/SHA, adaptation reason, review receipt, result SHA, and renewed evidence.
5. Integrate through the protected CAS authority. Never update `main` or `release/*` directly.
6. Create a new immutable `candidate/vX.Y.Z[-pre.N]/aNNN` for every changed source/policy/support/toolchain input.
7. Build and qualify the exact candidate once. Required failures or fallbacks block admission.
8. Verify with the focused release specs and `bin/simple test test --whole --mode=interpreter`. Release consumes verify evidence and does not repair tests/docs.
9. Promotion verifies the admitted commit and artifact digests, then creates one signed annotated `vX.Y.Z[-pre.N]` tag and pushes exactly that ref. Promotion never rebuilds.
10. Ask before external push/publication. Draft, attach exact admitted assets, verify, then publish immutably.
11. Rollback redeploys an earlier admitted release. Withdrawal preserves tag/assets/history. Corrections receive a new beta, RC, or patch number.

## Beta bug-fix flow

```text
session start at exact release/X.Y
  -> verify one reviewed fix and provenance
  -> apply it only on the private work branch
  -> run focused affected tests on the result revision
  -> submit result through CAS integration
  -> create a new beta candidate attempt
```

Do not automatically discover or cherry-pick “all fixes.” Do not accept feature commits, commit ranges, moving branch names, stale reviews, missing adaptation reasons, or evidence from the pre-backport revision.

## Release commands

Use `simple release version-check`, `beta-prepare`, `backport-check`, `candidate-check`, `promote-check`, and `withdraw-check` to validate each boundary before provider mutation. Use `spipe release-guide` and `spipe release-capabilities` to inspect this plugin’s policy surface.

## Scoped self-review status and remediation

GitHub forbids a PR author from submitting an `APPROVED` review on their own
PR. `SPipe Self Review Admission` is the required status-check alternative; it
does not claim provider or independent approval. Ordinary code/text is eligible
by default only when authenticated external policy has no matching deny or
constrain record. Scope kinds are `code`, `text`, exact `file`, immediate
`directory_files`, and recursive `directory_recursive`.

Read the exact rejection/invalidation reason. Push, retarget, base/diff/ruleset
or policy drift, and expiry require a fresh exact-head high-effort review with
zero P0/P1 and a new dispatch. A deny requires external policy-owner action or
an eligible independent-review route; uncovered scope requires a smaller diff
or new exact constraint; unsafe/secret material must be removed and exposed
credentials rotated. Never attempt author `APPROVED`, reuse a stale status, or
weaken protected integration, candidate, release, signing, or publication
authority.

## External authority

Live ruleset changes, signing, protected pushes, GitHub publication, and registry publication require explicit authority. A local plan PASS is not a live release PASS.

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
