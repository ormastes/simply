<!-- codex-design -->
# Simple ERP Production Plan

This plan keeps the submodule practical: ship the next production guarded-write
slice for CRM, reservation, and sale writes. The release gate lives in
[`readiness_gate.md`](readiness_gate.md) and is the source of truth for what is
ready, what blocks release, and what still prevents a real production
deployment.

## Roadmap

| Step | Scope | Exit criteria |
|------|-------|---------------|
| 1. Guarded write core | tenant/session resolution, RBAC, validation | Every write enters the same gate and rejects missing or expired context before domain work starts |
| 2. Audit and idempotency | audit event creation, idempotency keys, replay protection | Duplicate submits do not double apply, and every accepted write emits one audit event |
| 3. Ledger acceptance | append-only acceptance, tamper-evident links, result reporting | Ledger acceptance is explicit, chain links remain intact, and the caller gets a clear success or denial result |
| 4. CRM lane | lead/account/contact writes | CRM writes obey the shared guarded-write rules and return a recorded outcome |
| 5. Reservation lane | booking, hold, cancel, no-show writes | Reservation writes use the same guard, audit, and ledger path as CRM |
| 6. Sale lane | sale, payment, adjustment writes | Sale writes use the same guard, audit, and ledger path as CRM and reservation |
| 7. Recovery parity | backup/restore verification, restore drill, parity checks | A restored copy matches expected balances, audit history, and chain heads and can resume guarded writes safely |
| 8. Operations health | liveness/readiness, restore freshness, ledger integrity, redaction checks | Operators can tell healthy, degraded, and unsafe states from one shared health surface |
| 9. Tests | unit, integration, scenario, permission, recovery, ops | Each lane has repeatable coverage for the release gates and their blocking failures |
| 10. Readiness gate | readiness checklist, release blockers, ownership, production blockers | One shared release gate tells the team when the example is ready and what still blocks deployment |

## Delivery Rules

- Keep one shared policy for tenant/session resolution, RBAC, validation,
  audit, idempotency, ledger acceptance, and result reporting across all lanes.
- Use append-only ledgers for CRM, reservation, and sale write acceptance.
- Every write path that can be retried must be idempotent.
- Result reporting must reflect the actual ledger acceptance outcome, not a
  guessed success.
- Prefer explicit domain writes over hidden side effects.
- Do not add persistence or recovery flows before the guarded-write contract is
  defined.
- Backup and restore checks are part of the production contract, not a later
  ops-only task.
- Treat [`readiness_gate.md`](readiness_gate.md) as the release gate for this
  slice.

## Near-Term Priority

1. Lock tenant/session resolution, RBAC, and validation for every write.
2. Add audit event creation, idempotency, and ledger acceptance to the shared write path.
3. Add clear result reporting for accepted, denied, and duplicate writes.
4. Introduce durable storage with restore parity verification and replay.
5. Add schema/migration and snapshot parity checks before broadening scope.
6. Add operational health checks before broadening scope.
7. Connect CRM, reservation, and sale flows to the same guarded-write rules.
8. Gate release on the readiness checklist instead of ad hoc team sign-off.
