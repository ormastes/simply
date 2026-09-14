# Project Provenance Showcase Architecture

<!-- codex-design -->

`simply` is an offline evidence aggregator, never a live project runner.

```
project catalog + project_proofs/*.sdn + materialized simulator fixtures
                         │
                         ▼
                project_proof.sh
                    │             │
            nonzero reject   projects.html
```

Each receipt has a canonical GitHub URL, branch, immutable project commit,
optional tag, pinned Simple beta tag+commit, tree cleanliness, test command,
result, `checked_at`, explicit `valid_until`, and follow-up state. The verifier
accepts a `verified` receipt only when every required field is valid, the beta
tag resolves to its recorded commit, and `checked_at <= PROOF_NOW <
valid_until`. Otherwise it renders `unverified`/`failed`; it never upgrades a
missing or malformed receipt. Receipts must be regular files, never symlinks.
The collector/workflow assigns the validity window; the renderer enforces the
recorded deadline and does not infer freshness from receipt age.

`data/projects.sdn` is the full organization catalog. Receipts are independent
files so projects can update their evidence without changing the catalog.
`data/project_observations.sdn` is a maintenance-time snapshot of public branch
heads and deliberately admitted tags. The renderer validates it offline and
labels every such revision “observed, not proof”; private revision metadata is
withheld. `scripts/update_project_observations.sh` compares the live public
repository set to the catalog before refreshing the snapshot.

Renderer status separates proof rejection from page integrity. Status `3`
means the page was produced but at least one receipt was rejected, so the site
generator may publish the explicit failed/unverified state. Status `1` or any
other unexpected renderer failure means catalog, observation, or output
integrity is unsafe and publication stops.
`test/project_provenance_showcase_test.sh` materializes a deterministic
simulator corpus for every accept/reject state. Live checkout collection is a
separate maintenance command, `scripts/collect_project_proof.sh`, and is
prohibited in page generation. The manual `project-proof` workflow resolves
the target from the catalog, checks out the pinned beta toolchain, retains the
test log as an artifact, and never commits a receipt automatically.

The strict root guard rejects all tracked and untracked changes for an evidence
run. Its pre-commit mode permits the staged index (otherwise commits cannot be
made) but rejects unstaged tracked changes and untracked files.
