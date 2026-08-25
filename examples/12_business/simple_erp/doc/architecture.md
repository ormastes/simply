<!-- codex-architecture -->
# Simple ERP Submodule Architecture

This submodule starts as a small in-memory ERP example, but the production plan
is to grow it into a shared-core ERP with three business lanes and one guarded
write path. The release gate lives in [`readiness_gate.md`](readiness_gate.md).

- CRM: lead/account/contact writes, quote approval, stage movement, and next
  action.
- Reservation: meeting room, hotel room, restaurant table, capacity, hold,
  deposit, cancel, and no-show writes.
- Sale: online shop, unmanned shop, restaurant coffee/meal/bakery, auction,
  retail shop, payment state, tax, and audit note writes.
- Recovery: backup/restore verification, ledger replay, post-restore balance
  checks, and parity evidence.
- Security/Ops: session expiry, secret redaction, tamper-evident audit/ledger
  chains, guarded-write reporting, and health checks.

## Readiness Boundary

- The shared core is ready for release only when one guarded write path covers
  all lanes and no lane has an alternate acceptance rule.
- The architecture is not production deployed while it still depends on the
  in-memory example store.
- Recovery and health are part of the release boundary, not separate after-the-fact concerns.
- The documented gate, not team memory, decides whether the slice is releasable.

## Layers

- `src/catalog.spl`: seed records, workflow helpers, and CLI interface
  selection.
- Shared guarded-write core: tenant/session resolution, RBAC, validation,
  audit event creation, idempotency, ledger acceptance, result reporting,
  redaction, persistence, tamper-evident chains, schema migrations, repository
  snapshots, health probes, and balance checks.
- Domain lanes: CRM, sale, and reservation rules built on the shared core.
- Easy interface: one operator summary for open leads, open slots, and unpaid
  work.
- Pro interface: numeric control view for pipeline, approved quotes, reservation
  slots, unpaid sales, sale channels, inventory movement, and payment audits.
- Recovery plan: backup freshness, restore parity, chain integrity, ledger
  replay, and evidence for operators and QA.
- Security ops plan: secret handling rules, safe operator output, and health
  check expectations.

## Constraints

- Stay dependency-free and in-memory until the production plan explicitly
  introduces persistence.
- Treat tenant context, session identity, session expiry, and RBAC as mandatory
  inputs to every write.
- Use one validation, audit, idempotency, and result-reporting policy across all
  lanes instead of per-feature rules.
- Reuse ledger history and chain heads for balance checks instead of inventing
  separate reconciliation counters.
- Keep secret redaction and safe output in the shared core so logs, exports, and
  restore evidence cannot drift.
- Keep health checks read-only and driven by the same shared facts as recovery
  checks.
- Keep backup and restore verification in the submodule docs so the recovery
  lane stays aligned with the ledger lane.
- Reuse the parent repo restaurant/payment/database examples when the store,
  ledger, or durable storage slice grows beyond the example seed.
- Stop at the documented readiness gate before calling the example production
  deployed.
