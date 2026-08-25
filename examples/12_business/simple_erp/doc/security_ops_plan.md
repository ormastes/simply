<!-- codex-design -->
# Simple ERP Security and Operations Plan

This plan covers the production slice that hardens the ERP example without
turning it into a platform project. The focus is simple: keep guarded writes
honest, keep secrets out of operator surfaces, expire sessions on time, prove
the audit chain is tamper evident, and expose health checks that match recovery
reality. The release gate lives in [`readiness_gate.md`](readiness_gate.md).

## Goals

- Tenant/session resolution and RBAC must be enforced before any CRM,
  reservation, or sale write.
- Validation, audit event creation, idempotency, and ledger acceptance must be
  enforced before any write is reported as successful.
- Session expiry must be enforced before any write or restore action.
- Secret redaction must apply to logs, audit exports, recovery evidence, and
  operator views.
- Audit and ledger entries must form a tamper-evident chain.
- Health checks must report live, ready, degraded, and unsafe states from the
  same shared facts used by recovery.

## Release Blocking Checks

- Release blocks if any operator view can show unredacted secrets or raw
  internal errors.
- Release blocks if health checks cannot explain restore freshness or chain
  integrity.
- Release blocks if a session, tenant, or RBAC failure can still be bypassed
  by an admin path.
- Release blocks if recovery evidence is missing actor, time, or parity
  details.
- Release blocks if the deployment still relies on the in-memory example store
  rather than a durable production store.

## Operational Checks

1. Verify the active session is not expired and matches the tenant.
2. Verify RBAC and validation pass before the write is allowed to continue.
3. Verify an audit event is created for every accepted write.
4. Verify duplicate idempotency keys do not create duplicate ledger acceptance.
5. Verify sensitive fields are redacted in every operator-visible output.
6. Verify the latest audit and ledger chain heads match the stored history.
7. Verify health checks are green only when restore freshness and chain
   integrity are current.
8. Verify recovery evidence contains no raw secrets and includes the actor,
   time, and parity result.

## Responsibilities

- Identity Team: session expiry and revocation.
- Guarded Write Team: validation, audit event creation, idempotency, and
  ledger acceptance rules.
- Security Ops Team: redaction policy and safe output review.
- Operations Team: health check wiring, dashboards, and incident visibility.
- Recovery Team: restore evidence and parity checks.
- QA Team: release-gate verification for redaction, expiry, and operator
  safety.

## Acceptance Checks

- Expired sessions cannot write.
- Writes without tenant/session context or RBAC approval are denied.
- Accepted writes always have a matching audit event and ledger acceptance.
- Duplicate submits with the same idempotency key do not create duplicate
  accepted results.
- Sensitive values do not appear in logs, exports, or recovery notes.
- A broken chain hash fails the check before release.
- Health checks fail when restore freshness or chain integrity is stale.
- The documented readiness gate is the final release gate for the slice.
