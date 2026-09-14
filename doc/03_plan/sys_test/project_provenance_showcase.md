# Project Provenance Showcase Test Plan

| Requirement | Evidence |
|---|---|
| REQ-PPS-001–003 | valid receipt binds project and Simple checkout identity, tracked runtime binary, explicit expiry, immutable links, and beta line |
| REQ-PPS-004 | simulator fixtures cover valid/invalid, expired, boundary, and symlink receipt states |
| REQ-PPS-005 | generator runs offline and fails closed |
| REQ-PPS-006 | isolated Git repos test strict/pre-commit guards and workflow isolation from stale receipts |
| REQ-PPS-007 | generated page labels `v1.0.1-beta.1` as beta |
| Catalog completeness | live public repository set matches one observation per catalog row; private revisions are withheld |

Run the four portable tests named in the generated manual. CI checks out the
exact beta commit and attempts the mirrored SSpec contract over all four.
The tagged Linux binary currently exits 139 before parsing the spec; this is
tracked by `ormastes/simple#497`, and CI labels it blocked rather than proven.
