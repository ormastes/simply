# Project Provenance Showcase Architecture

<!-- codex-design -->

`simply` is an offline evidence aggregator, never a live project runner.

```
project catalog + project_proofs/*.sdn + simulator fixtures
                         │
                         ▼
             verify_project_proofs.sh
                    │             │
            nonzero reject   projects.html
```

Each receipt has a canonical GitHub URL, branch, immutable project commit,
optional tag, pinned Simple beta tag+commit, tree cleanliness, test command,
result, timestamp, and follow-up state. The verifier accepts a `verified`
receipt only when every required field is valid and the beta tag resolves to
its recorded commit. Otherwise it renders `unverified`/`failed`; it never
upgrades a missing or malformed receipt.

`data/projects.sdn` is the full organization catalog. Receipts are independent
files so projects can update their evidence without changing the catalog.
`data/project_proofs/fixtures` is a deterministic simulator corpus for every
accept/reject state. Live GitHub collection is a separate maintenance command
and is prohibited in page generation.

The strict root guard rejects all tracked and untracked changes for an evidence
run. Its pre-commit mode permits the staged index (otherwise commits cannot be
made) but rejects unstaged tracked changes and untracked files.
