# Project Provenance Showcase — NFR Requirements

<!-- codex-research -->

- **NFR-PPS-001:** Proof acceptance is fail-closed. Missing, malformed, dirty,
  stale, or tag/commit-inconsistent evidence is rendered only as `unverified`
  or `failed`.
- **NFR-PPS-002:** Page generation is deterministic and offline: it consumes
  tracked receipts and simulator fixtures, not live GitHub state.
- **NFR-PPS-003:** Every accepted reference is immutable: canonical repository
  URL plus a 40-hex commit; a tag is display metadata only after it resolves to
  the recorded commit.
- **NFR-PPS-004:** The guard and generator use POSIX shell plus standard
  utilities so GitHub Actions and developers can run them without a Simple
  runtime.
- **NFR-PPS-005:** Project verification must be maintenance-time work only;
  no dashboard request path or static-site render may clone, scan, or execute a
  sibling project.
