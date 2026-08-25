<!-- codex-design -->
# Simple ERP Readiness Gate

This slice answers one question: what must be true before the ERP example can
be called production ready, and what still blocks a real deployment.

## Ready For Release

- Every write path enters the shared guarded-write core.
- Tenant, session, actor, and tenant/session expiry checks fail closed.
- RBAC and validation run before any durable write.
- Accepted writes create audit events before ledger acceptance.
- Idempotency keys prevent duplicate submits from double applying.
- Write results are explicit: accepted, denied, validation-failed, or duplicate.
- Health checks expose live, ready, degraded, and unsafe states.
- Recovery evidence proves backup freshness, restore parity, and chain integrity.
- Secret redaction applies to logs, exports, operator views, and recovery notes.
- Durable-store readiness passes before the example is called production ready.

## Release-Blocking Gates

1. Any write bypasses the guarded-write core.
2. Any accepted write skips audit creation or idempotency.
3. Any balance or acceptance check depends on mutable counters instead of ledger history.
4. Any operator surface can leak secrets or raw internal errors.
5. Any restore can pass without parity against schema, chain head, and ledger history.
6. Any team owns a gate but not the evidence that proves it.
7. Durable storage is missing or cannot restore a snapshot from a supported
   storage facade.

## Team Ownership

- Identity Team: tenant/session resolution, expiry, and RBAC entry points.
- Guarded Write Team: validation, audit, idempotency, ledger acceptance, and result reporting.
- Recovery Team: backup, restore, replay, and parity evidence.
- Security Ops Team: redaction policy and safe operator output.
- Operations Team: health checks, freshness signals, and incident visibility.
- QA Team: release-gate coverage and regression checks.
- CRM, Reservation, and Sale teams: lane-specific business rules on top of the shared gate.

## Still Blocks True Production Deployment

- The example is still an in-memory submodule, so it does not yet have a real durable production store.
- Live identity, session, and secret-management backends are still implied rather than integrated.
- Automated backup, restore, and replay execution is documented, not yet a deployed operational service.
- Production monitoring, paging, and change management are not part of this submodule.
- A real deployment still needs environment-specific security review, data migration, and release approval outside the example.
