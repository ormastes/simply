# Project Provenance Showcase — Requirements

<!-- codex-research -->

## Scope

The site shall advertise every `ormastes` project whose name begins with
`simple` and `svllm` through a dedicated Projects page. Initial Simple
compatibility is pinned to the published pre-release `v1.0.1-beta.1`, resolving
to commit `62eada434c050cb688598bef1ab4f5a25b5cb404`.

## Requirements

- **REQ-PPS-001:** A versioned project receipt shall record the canonical GitHub
  repository URL, default branch, a 40-hex project commit, optional project tag,
  exact Simple tag and commit, test command, test result, clean-tree verdict,
  timestamp, and explicit follow-up/TODO state.
- **REQ-PPS-002:** The dedicated generated Projects page shall list every
  in-scope project and show its propagation state as `verified`, `unverified`,
  or `failed`; absence of a receipt shall be `unverified`, never success.
- **REQ-PPS-003:** Each verified or failed result shall link to its exact project
  commit and Simple tag/commit so a reader can reproduce the evidence.
- **REQ-PPS-004:** A deterministic simulator fixture shall exercise verified,
  failed, absent, malformed, dirty, and tag/commit mismatch receipts before any
  live collection is accepted.
- **REQ-PPS-005:** The implementation shall provide a maintenance command that
  validates receipts and regenerates the Projects page without contacting the
  network during page generation.
- **REQ-PPS-006:** The project shall provide a root dirty-tree guard and a
  installable Git pre-commit hook. Both shall reject dirty tracked or untracked
  files beneath the repository root, except explicit ignored build artifacts.
- **REQ-PPS-007:** The site shall state the last known Simple version and label
  it beta until a later stable version is deliberately admitted.

## Acceptance evidence

An SSpec scenario must prove all receipt states and the clean/dirty root guard;
the generator must render a stable Projects page from fixtures and reject an
invalid receipt without publishing a `verified` claim.
