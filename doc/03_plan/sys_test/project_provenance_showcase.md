# Project Provenance Showcase Test Plan

| Requirement | Evidence |
|---|---|
| REQ-PPS-001–003 | valid receipt produces immutable links and beta line |
| REQ-PPS-004 | simulator fixtures cover all valid/invalid states |
| REQ-PPS-005 | generator runs offline and fails closed |
| REQ-PPS-006 | isolated Git repos test strict and pre-commit guard modes |
| REQ-PPS-007 | generated page labels `v1.0.1-beta.1` as beta |

Run `sh test/project_provenance_showcase_test.sh`; when the beta runtime is
admitted in CI, run the mirrored SSpec contract too.
