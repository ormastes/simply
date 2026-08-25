<!-- codex-design -->
# Simple ERP Submodule Design

The production readiness slice is defined by
[`readiness_gate.md`](readiness_gate.md). This document explains the shape of
the data and workflows that must satisfy that gate.

## Slice Records

- `WriteRequest`: tenant id, session id, actor id, domain target, idempotency key,
  and payload.
- `WriteDecision`: allowed or denied, validation result, RBAC result, and
  rejection reason.
- `WriteReceipt`: request id, audit event id, ledger acceptance id, and result
  status.
- `ReadinessGate`: gate name and pass/fail state for release handoff.
- `ErpFeature`: lane id and easy/pro descriptions.
- `CrmLead`: account, contact, stage, value, and next action.
- `CrmQuote`: lead id, amount, and approval state.
- `Reservation`: resource kind, capacity, booked seats, status, and deposit.
- `Sale`: channel, subtotal, tax, paid state, status, and audit note.
- `ErpUser`: user id, display name, and role.
- `AuditEvent`: user, action, target, authorization result, and redaction note.
- `InventoryItem`: SKU, display name, on-hand count, and reserved count.
- `StoreOrder`: order id, SKU, quantity, and paid state.
- `TenantContext`: tenant id and display name.
- `ErpSession`: token, user id, tenant id, issue time, expiry time, and active
  state.
- `LedgerEntry`: idempotency key, tenant id, debit account, credit account,
  amount, previous hash, and entry hash.
- `AuditChainEntry`: sequence, payload, previous hash, and deterministic hash
  for example-level tamper evidence.
- `SecretRedaction`: secret class, redaction rule, and output scope.
- `HealthCheck`: name, status, observed time, and freshness window.
- `RepositorySnapshot`: schema version, tenant id, domain counts, ledger count,
  and chain head.
- `MigrationStep`: schema version, migration name, and applied state.
- `RecoveryCheck`: named backup/restore/replay/parity check and pass/fail
  state.

## Production Slice

The production guarded-write slice keeps a narrow shape:

- tenant-aware sessions decide who can write, and expired sessions fail closed;
- RBAC gates every CRM, reservation, and sale write before domain mutation;
- validation runs before audit or ledger work so bad input never creates a
  durable record;
- every accepted write creates an audit event before the ledger accepts the
  domain change;
- idempotency keys prevent duplicate submits from double counting;
- ledger acceptance is explicit and returns a result the caller can report;
- ledger and audit entries are chained so tampering breaks the hash trail;
- secret redaction happens before logs, exports, and restore evidence;
- balance checks derive from ledger history rather than mutable counters;
- backup and restore drills must prove the restored store matches expected
  balances, chain heads, and acceptance history;
- health checks must expose live, ready, degraded, and unsafe states.

## Readiness Gate

- The gate is passed only when the shared write path, redaction path, recovery
  checks, and operator health views all agree.
- Release is blocked if any lane invents its own permission, audit, or result
  shape.
- Release is blocked if restore parity, chain integrity, or backup freshness
  cannot be demonstrated.
- Release is blocked if the deployment still depends on the in-memory example
  store instead of a durable production store.

## Slice Workflows

- CRM writes require tenant/session context, RBAC, validation, audit event
  creation, idempotency, ledger acceptance, and a reported result.
- Reservation writes require the same guard before booking, hold, cancel, or
  no-show state changes are accepted.
- Sale writes require the same guard before payment, adjustment, or status
  changes are accepted.
- Audit events record the actor, tenant, target, decision, and redaction
  markers.
- Result reporting returns accepted, denied, validation-failed, or duplicate
  outcomes without guessing.
- Ledger acceptance rejects duplicate idempotency keys and derives accepted
  totals from append-only entries.
- Ledger chain checks fail when the previous hash does not match the current
  trail.
- Recovery readiness requires every backup/restore/replay/parity check to pass.
- Health checks stay read-only and report restore freshness and chain integrity.
- Repository snapshots expose the current schema, tenant, domain counts, ledger
  count, and audit-chain head.
- Migration checks require every step to be applied and the final version to
  match the current schema.
- Readiness checks aggregate identity, RBAC, validation, ledger, recovery,
  security, and write-gate status before release handoff.

## Production Roadmap

1. Add tenant/session resolution, RBAC, and validation before any durable
   write path.
2. Put audit event creation, idempotency, and result reporting on every state
   change so duplicate or denied writes are explicit.
3. Introduce append-only ledger acceptance with tamper-evident chain hashes for
   CRM, reservation, and sale changes.
4. Connect CRM, reservation, and sale actions to the shared guarded-write,
   audit, and redaction path.
5. Add backup/restore verification that replays ledger state, checks chain
   heads, and proves expected balances after restore.
6. Add security hardening: least privilege, secret handling, tamper-evident
   audit records, and retention rules.
7. Add operations: health checks, logs, metrics, admin visibility, and
   recovery evidence.
8. Expand tests last, with permission, expiry, recovery, tamper-evidence, and
   invalid-input scenarios for each lane.

## Design Notes

- Keep the shared core small: one identity contract, one validation path, one
  redaction policy, one audit format, one ledger acceptance model, and one
  result-reporting shape.
- Let lane modules own business rules, but not permission policy, audit shape,
  acceptance rules, or secret handling.
- Treat CRM, reservation, and sale state as accepted facts rather than mutable
  ad hoc counters.
- Keep restore verification explicit: a restore is only good if the replayed
  balances, acceptance history, and chain heads match the pre-backup totals.
- Keep health checks read-only and fail closed when chain integrity or restore
  freshness is stale.
- Keep the current in-memory example intact until the production slice needs a
  durable store.
- Use the readiness gate as the release checklist, not as a separate approval
  process per lane.
