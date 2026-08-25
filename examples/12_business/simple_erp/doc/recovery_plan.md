<!-- codex-design -->
# Simple ERP Recovery Plan

This plan covers the production recovery and ledger slice for the ERP example.
It is intentionally narrow: verify that the system can survive restarts, reject
duplicate writes, prove ledger balances after restore, and preserve the audit
chain. The release gate lives in [`readiness_gate.md`](readiness_gate.md).

## Goals

- Tenant-aware sessions must be present on every CRM, reservation, and sale
  write and restore action, and expired sessions must not resume work after
  restore.
- Restored writes must still pass RBAC, validation, audit event creation,
  idempotency, ledger acceptance, and result reporting.
- Appends to inventory, sales, payment, and reservation ledgers must be
  idempotent.
- Balance checks must derive from the ledger, not from ad hoc counters.
- A backup is only valid if a restore can replay the ledger, match expected
  balances, and preserve the chain heads.
- Snapshot parity must compare schema version, tenant id, domain counts, ledger
  count, and chain head.
- Secret redaction must survive backup, restore, and evidence review.
- Recovery evidence must be understandable by operators and QA.
- Recovery evidence is a release blocker until it proves restore parity,
  chain integrity, and redaction.

## Recovery Steps

1. Capture a backup of the durable store, ledger state, and chain heads.
2. Restore into a fresh target.
3. Replay ledger entries in order and verify the previous-hash links.
4. Re-run the guarded-write contract on restored CRM, reservation, and sale
   writes before they are accepted again.
5. Check balances for inventory, open sales, paid sales, reservations, and
   other tracked totals.
6. Confirm secrets stay redacted in logs, exports, and operator output.
7. Compare restore results to the pre-backup expected values and health checks.
8. Compare restored snapshots against pre-backup snapshots.
9. Record the restore result and the actor that ran it.

## Responsibilities

- Identity Team: sessions, expiry, tenant context, and write authorization.
- Guarded Write Team: idempotent append-only writes, audit events, result
  reporting, chain acceptance, and balance derivation hooks.
- Security Ops Team: secret redaction, safe output, and operator evidence.
- Recovery Team: backup, restore, replay, parity, and verification.
- QA Team: scenario coverage for retry, restore, duplicate-submit, and redaction
  cases.
- Operations Team: restore freshness signals and readiness status after
  recovery.

## Acceptance Checks

- A repeated write with the same idempotency key does not change totals twice.
- A restored write still requires tenant/session, RBAC, validation, audit, and
  ledger acceptance before it reports success.
- A restored database matches ledger-derived balances and chain heads.
- A restored database keeps redacted secrets out of operator-visible output.
- A backup without restore evidence is not treated as production ready.
- Recovery failures stop release until the ledger parity issue is explained.
- Health checks after restore must pass before the slice is considered ready.
- A restore that cannot be traced back to the documented readiness gate is not
  production ready.
