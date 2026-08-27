import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { createExactIdentityResolverV1, EXACT_IDENTITY_CONTRACT_V1 } from '../../src/index/exact_identity.js';
import { deriveAliasProjectionUid } from '../../src/model/graph_node.js';
import { canonicalBytes } from '../../src/model/identity.js';

const ID = Object.freeze({
  workspaceUid: 'WS-01K3R8G3N70ZMT43W6QJ7YHX4P', projectUid: 'P-01K3R8G3N70ZMT43W6QJ7YHX4P',
  worktreeUid: 'WT-01K3R8G3N70ZMT43W6QJ7YHX4P', revisionId: 'commit-abc123',
  identitySnapshotId: `spks1-${'1'.repeat(64)}`, identityRoot: `sha256:${'2'.repeat(64)}`,
  authorizationScopeDigest: `sha256:${'3'.repeat(64)}`, policyHash: `sha256:${'4'.repeat(64)}`,
  policyVersion: 7, searchReceiptUid: 'D-01K3R8G3N70ZMT43W6QJ7YHX4P',
});
const A1 = 'A-01K3R8G3N70ZMT43W6QJ7YHX4P';
const A2 = 'A-01K3R8G3N70ZMT43W6QJ7YHX4Q';

function freeze(value) { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }
function request(query, overrides = {}) { return { contractVersion: EXACT_IDENTITY_CONTRACT_V1, operation: 'resolve', query, ...ID, ...overrides }; }
function snapshot(overrides = {}) {
  const aliasValue = 'Old Search';
  const aliasUid = deriveAliasProjectionUid({ workspace_uid: ID.workspaceUid, project_uid: ID.projectUid, kind: 'artifact_key', alias: aliasValue, canonical_target_uid: A1 });
  const base = {
    schema: 'spipe-authorized-identity-lookup-v1', ...ID, registryGeneration: 4,
    uidRows: [{ value: A1, targetUid: A1 }],
    keyRows: [{ value: 'design.search', targetUid: A1 }],
    aliasRows: [{ aliasUid, value: aliasValue, targetUid: A1, status: 'active' }],
    ...overrides,
  };
  const { authorizedIdentityDigest: _ignored, ...preimage } = base;
  return freeze({ ...base, authorizedIdentityDigest: `sha256:${createHash('sha256').update(canonicalBytes(preimage)).digest('hex')}` });
}
function harness(snapshotValue = snapshot()) {
  let verified = 0; let read = 0; let receiptPassed;
  const resolver = createExactIdentityResolverV1({
    verifySearchReceipt(binding) { verified += 1; return freeze({ ...binding }); },
    readIdentitySnapshot(receipt) { read += 1; receiptPassed = receipt; return snapshotValue; },
  });
  return { resolver, calls: () => ({ verified, read, receiptPassed }) };
}

test('factory and resolver expose only the frozen two-port contract', () => {
  assert.throws(() => createExactIdentityResolverV1(), TypeError);
  const resolver = harness().resolver;
  assert.deepEqual(Object.keys(resolver), ['resolveExactV1']);
  assert.equal(Object.isFrozen(resolver), true);
});

test('pins byte-exact canonical UID without key or alias fallthrough', () => {
  const h = harness();
  const result = h.resolver.resolveExactV1(request(A1));
  assert.equal(result.ok, true);
  assert.equal(result.value.resolvedUid, A1);
  assert.deepEqual(result.value.explanation, {
    contractVersion: EXACT_IDENTITY_CONTRACT_V1, resolvedUid: A1, matchedBy: 'uid', matchedValue: A1,
    aliasUid: null, aliasStatus: null, registryGeneration: 4, identitySnapshotId: ID.identitySnapshotId,
    identityRoot: ID.identityRoot, authorizationScopeDigest: ID.authorizationScopeDigest,
    searchReceiptUid: ID.searchReceiptUid, visibilityDecision: 'allowed', pinnedRank: 1,
  });
  assert.deepEqual(h.calls().verified, 1); assert.deepEqual(h.calls().read, 1);
  assert.equal(Object.isFrozen(result.value.explanation), true);
  assert.equal(h.resolver.resolveExactV1(request(A2)).value.status, 'not_found');
  const uidAlias = deriveAliasProjectionUid({ workspace_uid: ID.workspaceUid, project_uid: ID.projectUid, kind: 'artifact_key', alias: A1, canonical_target_uid: A2 });
  const fallbackTrap = snapshot({ aliasRows: [{ aliasUid: uidAlias, value: A1, targetUid: A2, status: 'active' }] });
  assert.equal(harness(fallbackTrap).resolver.resolveExactV1(request(` ${A1} `)).value.status, 'not_found');
});

test('normalizes semantic keys, prefers key evidence, and reports alias evidence', () => {
  const key = harness().resolver.resolveExactV1(request(' DESIGN.SEARCH '));
  assert.equal(key.value.explanation.matchedBy, 'key');
  assert.equal(key.value.explanation.matchedValue, 'design.search');
  assert.equal(key.value.explanation.aliasUid, null);
  const alias = harness().resolver.resolveExactV1(request(' Old Search '));
  assert.equal(alias.value.explanation.matchedBy, 'alias');
  assert.equal(alias.value.explanation.matchedValue, 'Old Search');
  assert.match(alias.value.explanation.aliasUid, /^AL-/);
  assert.equal(alias.value.explanation.aliasStatus, 'active');
});

test('deduplicates a same-target key and alias but exposes sorted ambiguity only', () => {
  const sameValue = 'design.search';
  const aliasUid = deriveAliasProjectionUid({ workspace_uid: ID.workspaceUid, project_uid: ID.projectUid, kind: 'artifact_key', alias: sameValue, canonical_target_uid: A1 });
  const same = snapshot({ aliasRows: [{ aliasUid, value: sameValue, targetUid: A1, status: 'active' }] });
  assert.equal(harness(same).resolver.resolveExactV1(request(sameValue)).value.explanation.matchedBy, 'key');
  const aliasUid2 = deriveAliasProjectionUid({ workspace_uid: ID.workspaceUid, project_uid: ID.projectUid, kind: 'artifact_key', alias: sameValue, canonical_target_uid: A2 });
  const ambiguous = snapshot({
    uidRows: [{ value: A1, targetUid: A1 }, { value: A2, targetUid: A2 }],
    aliasRows: [{ aliasUid, value: sameValue, targetUid: A1, status: 'active' }, { aliasUid: aliasUid2, value: sameValue, targetUid: A2, status: 'active' }],
  });
  const result = harness(ambiguous).resolver.resolveExactV1(request(sameValue));
  assert.deepEqual(result.value, { status: 'ambiguous', contractVersion: EXACT_IDENTITY_CONTRACT_V1, code: 'ambiguous_identity', candidateUids: [A1, A2] });
});

test('fails closed before ports for hostile, open, malformed, and oversized requests', () => {
  const h = harness();
  assert.deepEqual(h.resolver.resolveExactV1({ ...request('x'), extra: true }), { ok: false, error: { code: 'invalid_request' } });
  assert.equal(h.resolver.resolveExactV1(request('\ud800')).error.code, 'invalid_request');
  assert.equal(h.resolver.resolveExactV1(request('x'.repeat(4097))).error.code, 'limit_exceeded');
  assert.equal(h.resolver.resolveExactV1(new Proxy({}, { ownKeys() { throw new Error('hostile'); } })).error.code, 'invalid_request');
  assert.deepEqual(h.calls(), { verified: 0, read: 0, receiptPassed: undefined });
});

test('binds one frozen verified receipt and preserves its identity into one read', () => {
  let bindingSeen; let receipt;
  const resolver = createExactIdentityResolverV1({
    verifySearchReceipt(binding) { bindingSeen = binding; receipt = freeze({ ...binding }); return receipt; },
    readIdentitySnapshot(received) { assert.equal(received, receipt); return snapshot(); },
  });
  assert.equal(resolver.resolveExactV1(request('design.search')).ok, true);
  assert.equal(Object.isFrozen(bindingSeen), true);
  assert.equal(Object.hasOwn(bindingSeen, 'query'), false);
  assert.deepEqual(Object.keys(bindingSeen), ['contractVersion', 'operation', 'workspaceUid', 'projectUid', 'worktreeUid', 'revisionId', 'identitySnapshotId', 'identityRoot', 'authorizationScopeDigest', 'policyHash', 'policyVersion', 'searchReceiptUid']);
});

test('maps verifier and read failures without leaking port errors', () => {
  const denied = createExactIdentityResolverV1({ verifySearchReceipt() { throw new Error('secret'); }, readIdentitySnapshot() { throw new Error('unreachable'); } });
  assert.deepEqual(denied.resolveExactV1(request('x')), { ok: false, error: { code: 'unauthorized' } });
  const unavailable = createExactIdentityResolverV1({ verifySearchReceipt(binding) { return freeze({ ...binding }); }, readIdentitySnapshot() { throw new Error('secret path'); } });
  assert.deepEqual(unavailable.resolveExactV1(request('x')), { ok: false, error: { code: 'snapshot_unavailable' } });
  const target = freeze({});
  const revoked = Proxy.revocable(target, {}); revoked.revoke();
  const hostile = createExactIdentityResolverV1({ verifySearchReceipt() { return revoked.proxy; }, readIdentitySnapshot() { throw new Error('unreachable'); } });
  assert.deepEqual(hostile.resolveExactV1(request('x')), { ok: false, error: { code: 'unauthorized' } });
});

test('rejects binding, digest, ordering, derived alias, and cap corruption', () => {
  const binding = snapshot({ projectUid: 'P-01K3R8G3N70ZMT43W6QJ7YHX4Q' });
  assert.equal(harness(binding).resolver.resolveExactV1(request('x')).error.code, 'snapshot_corrupt');
  const digest = snapshot();
  const badDigest = freeze({ ...digest, authorizedIdentityDigest: `sha256:${'f'.repeat(64)}` });
  assert.equal(harness(badDigest).resolver.resolveExactV1(request('x')).error.code, 'snapshot_corrupt');
  const hostileDigest = freeze({ ...digest, authorizedIdentityDigest: Symbol('hostile') });
  assert.deepEqual(harness(hostileDigest).resolver.resolveExactV1(request('x')), { ok: false, error: { code: 'snapshot_corrupt' } });
  const unsorted = snapshot({ uidRows: [{ value: A2, targetUid: A2 }, { value: A1, targetUid: A1 }] });
  assert.equal(harness(unsorted).resolver.resolveExactV1(request('x')).error.code, 'snapshot_corrupt');
  const badAlias = snapshot({ aliasRows: [{ aliasUid: 'AL-01K3R8G3N70ZMT43W6QJ7YHX4P', value: 'Old Search', targetUid: A1, status: 'active' }] });
  assert.equal(harness(badAlias).resolver.resolveExactV1(request('x')).error.code, 'snapshot_corrupt');
  const hugeRows = new Proxy(new Array(100001), { ownKeys() { throw new Error('must not enumerate over-cap rows'); } });
  const overCap = { ...snapshot(), uidRows: [], keyRows: hugeRows, aliasRows: [] };
  assert.equal(harness(overCap).resolver.resolveExactV1(request('x')).error.code, 'limit_exceeded');
  const aggregateCap = { ...snapshot(), uidRows: [{ value: A1, targetUid: A1 }], keyRows: new Array(100000), aliasRows: [] };
  assert.equal(harness(aggregateCap).resolver.resolveExactV1(request('x')).error.code, 'limit_exceeded');
  const nulAlias = snapshot({ aliasRows: [{
    aliasUid: deriveAliasProjectionUid({ workspace_uid: ID.workspaceUid, project_uid: ID.projectUid, kind: 'artifact_key', alias: 'bad\0alias', canonical_target_uid: A1 }),
    value: 'bad\0alias', targetUid: A1, status: 'active',
  }] });
  assert.equal(harness(nulAlias).resolver.resolveExactV1(request('x')).error.code, 'snapshot_corrupt');
  assert.equal(harness().resolver.resolveExactV1(request('x', { revisionId: ' commit-abc123 ' })).error.code, 'invalid_request');
});
