<!-- codex-design -->
# Simple ERP Agent Teams

This submodule is small enough to keep ownership obvious. The point is not to
create a committee; the point is to keep the guarded-write slice stable while
the CRM, reservation, and sale lanes grow. The release gate lives in
[`readiness_gate.md`](readiness_gate.md).

## Team Map

| Team | Owns | Main outputs | Review focus |
|------|------|--------------|--------------|
| Identity Team | tenant/session resolution, expiry, RBAC | login flow, session validation, permission checks, session revocation | privilege boundaries, actor resolution, session invalidation |
| Guarded Write Team | validation, audit event creation, idempotency, ledger acceptance, result reporting | shared write gate, audit records, ledger-accepted responses | write ordering, duplicate suppression, acceptance reporting |
| CRM Team | leads, accounts, contacts, tasks, quotes | customer records, pipeline state, follow-up actions | field validation, stage transitions, ownership rules |
| Reservation Team | rooms, tables, holds, deposits, no-show | booking lifecycle, capacity checks, cancellation rules | overbooking guards, hold expiry, refund/deposit handling |
| Sale Team | store orders, payments, pricing, tax, adjustments | sale writes, payment writes, sale status, invoice state | amount correctness, payment state, duplicate submit handling |
| Recovery Team | backups, restore checks, ledger replay, parity verification | recovery drills, restore evidence, recovery runbooks | backup freshness, restore parity, ledger completeness |
| Security Ops Team | secret redaction, safe error output, operator-facing health policy | redaction rules, audit-safe logs, safe exports | secret leakage, unsafe diagnostics, operator exposure |
| Operations Team | metrics, logs, admin UX, health checks | health checks, dashboards, incident notes | observability, rollback, failure visibility, stale restore signals |
| QA Team | tests and scenario coverage | unit, integration, permission, recovery scenarios | missing cases, regression risk, release-gate coverage |

## Ownership Rules

- Each write path has one primary owner and one reviewer.
- Shared concerns, especially tenant/session resolution, RBAC, validation,
  audit event creation, idempotency, ledger acceptance, and result reporting,
  belong to the Identity Team and Guarded Write Team and are consumed by the
  lane teams.
- Lane teams may extend their own domain records, but they do not redefine
  permission policy, audit shape, acceptance rules, or result reporting.
- The release gate is owned collectively, but each team must produce evidence
  for the gate items it controls.
- The Recovery Team owns backup/restore verification and ledger replay checks.
- The Operations Team owns health reporting and incident visibility once the
  first durable store lands.
- The Security Ops Team owns secret-safe output and redaction policy review.
- QA owns the final release-gate check that proves the documented blockers are
  absent.

## Handoff Order

1. Identity Team defines the user, session expiry, and tenant contract.
2. Guarded Write Team defines validation, audit, idempotent writes, acceptance,
   and result reporting.
3. Security Ops Team defines redaction and safe operator output.
4. Lane teams implement their CRM, reservation, and sale flows on top of those shared rules.
5. Recovery Team proves backup and restore parity against ledger balances.
6. Operations Team adds observability and incident reporting.
7. QA Team closes the loop with scenario coverage across all lanes and the
   readiness gate.
