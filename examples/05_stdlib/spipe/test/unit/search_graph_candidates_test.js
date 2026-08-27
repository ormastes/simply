import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  GRAPH_CANDIDATE_CONTRACT_V1,
  createAcceptedGraphCandidateGeneratorV1,
} from '../../src/search/graph_candidates.js';

const PAYLOADS = [
  '01K3R8G3N70ZMT43W6QJ7YHX4P', '01K3R8G3N70ZMT43W6QJ7YHX4Q',
  '01K3R8G3N70ZMT43W6QJ7YHX4R', '01K3R8G3N70ZMT43W6QJ7YHX4S',
  '01K3R8G3N70ZMT43W6QJ7YHX4T', '01K3R8G3N70ZMT43W6QJ7YHX4V',
];
const [ROOT, A1, A2, A3] = PAYLOADS.slice(0, 4).map((value) => `A-${value}`);
const SECTION = `S-${PAYLOADS[4]}`;
const WS = `WS-${PAYLOADS[0]}`;
const P = `P-${PAYLOADS[0]}`;
const WT = `WT-${PAYLOADS[0]}`;
const D = `D-${PAYLOADS[0]}`;
const SNAP = `spks1-${'a'.repeat(64)}`;
const HASH = `sha256:${'b'.repeat(64)}`;
const GRAPH_ROOT = `sha256:${'c'.repeat(64)}`;
const REV = 'abc123';
const OUTPUT_DIGEST_GOLDENS = Object.freeze({
  acceptedEdgeSetDigest: 'sha256:bdc871799e15af3f900bd7d82a946304defb232b7d5330185637377fc095e875',
  evidenceDigest: 'sha256:e2b77db786c7b9e5d512c1cc75c85de91880e25e15c2eede410bc1b525e9639b',
  sourceIdentity: 'sha256:a5e742892c7cf5580dd831bae4df6464ac957e05cd1225652098e0590f3773a9',
  candidateDigest: 'sha256:e22740d8c0dc4c22a9d367291dde2eb9684e897977d4e7ef28c5bd0b79a3c99d',
});

function oracleDigest(domain, value) {
  return `sha256:${createHash('sha256').update(domain, 'utf8').update(oracleCanonicalJson(value), 'utf8').digest('hex')}`;
}

function oracleCanonicalJson(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value.normalize('NFC'));
  if (typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(oracleCanonicalJson).join(',')}]`;
  const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key.normalize('NFC'))}:${oracleCanonicalJson(value[key])}`).join(',')}}`;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const pin = deepFreeze({
  workspaceUid: WS, projectUid: P, worktreeUid: WT, revisionId: REV,
  graphSnapshotId: SNAP, graphRoot: GRAPH_ROOT, authorizationScopeDigest: HASH,
  policyHash: HASH, policyVersion: 1, searchReceiptUid: D,
});
const context = deepFreeze({
  workspaceId: WS, snapshotId: SNAP, authorizationScopeDigest: HASH,
  queryReceipt: D, analyzerIdentity: 'analyzer-v1',
});

function node(uid, node_kind = 'Artifact') {
  const recordTypes = { Artifact: 'artifact', Section: 'section', Requirement: 'requirement' };
  return {
    uid, node_kind, project_uid: P, revision_id: REV,
    record_type: recordTypes[node_kind], record_hash: HASH,
    visibility: 'project', trust_scope: 'reviewed_reference', status: 'accepted',
  };
}

function edge(index, from_uid, to_uid, overrides = {}) {
  const origin = overrides.origin ?? 'explicit';
  const receipt = overrides.receipt ?? `D-${PAYLOADS[index]}`;
  return {
    schema_version: 2, type: 'edge', uid: `E-${PAYLOADS[index]}`,
    edge_type: 'links_to', from_uid, to_uid, origin,
    status: overrides.status ?? 'accepted', confidence_milli: overrides.confidence ?? 900,
    created_by: 'principal:test', created_at_revision: REV, evidence_uids: [],
    generator: origin === 'generated'
      ? { generator_id: 'generator', version: '1', rule: 'trace', input_snapshot_uid: SNAP }
      : null,
    provenance: {
      project_uid: P, worktree_uid: WT, revision_id: REV,
      input_snapshot_uid: SNAP, source_uid: null, source_location: null,
      decision_uid: overrides.status === 'proposed' ? null : receipt,
    },
    authority: overrides.status === 'proposed' ? null : {
      kind: origin === 'generated' ? 'trusted_generator' : 'explicit_review',
      receipt_uid: receipt, policy_hash: HASH, policy_version: 1,
    },
  };
}

function snapshot(nodes, edges) {
  const base = {
    schema: 'spipe-authorized-graph-search-v1', workspaceUid: WS, projectUid: P,
    worktreeUid: WT, revisionId: REV, graphSnapshotId: SNAP, graphRoot: GRAPH_ROOT,
    authorizationScopeDigest: HASH, policyHash: HASH, policyVersion: 1,
    searchReceiptUid: D, authorizedNodeCount: nodes.length,
    authorizedEdgeCount: edges.length, nodes, edges,
  };
  return deepFreeze({ ...base, authorizedGraphDigest: oracleDigest(
    'spipe-authorized-graph-search-v1\0', base,
  ) });
}

function shallowSnapshot(nodes, edges, overrides = {}) {
  return Object.freeze({
    schema: 'spipe-authorized-graph-search-v1', workspaceUid: WS, projectUid: P,
    worktreeUid: WT, revisionId: REV, graphSnapshotId: SNAP, graphRoot: GRAPH_ROOT,
    authorizationScopeDigest: HASH, policyHash: HASH, policyVersion: 1,
    searchReceiptUid: D, authorizedNodeCount: nodes.length,
    authorizedEdgeCount: edges.length, authorizedGraphDigest: `sha256:${'0'.repeat(64)}`,
    nodes: Object.freeze([...nodes]), edges: Object.freeze([...edges]), ...overrides,
  });
}

function hostileFrozenValue(onTraverse) {
  const target = Object.freeze({});
  return new Proxy(target, {
    ownKeys(value) { onTraverse(); return Reflect.ownKeys(value); },
  });
}

function authResponse(request, decision = 'allowed') {
  return deepFreeze({
    ...request, decision, authorizationScopeDigest: HASH, policyHash: HASH,
    policyVersion: 1, searchReceiptUid: D,
  });
}

function verifyResponse(request) { return deepFreeze({ ...request, decision: 'verified' }); }

function fixture({ nodes, edges, authorize = authResponse, verify = verifyResponse } = {}) {
  const graphNodes = nodes ?? [node(ROOT), node(A1), node(A2), node(A3)];
  const graphEdges = edges ?? [edge(1, ROOT, A1), edge(2, A1, A2), edge(3, A2, A3)];
  const calls = { read: 0, authorize: [], verify: [] };
  const snap = snapshot(graphNodes, graphEdges);
  const generator = createAcceptedGraphCandidateGeneratorV1({
    readGraphSnapshot(value) { calls.read += 1; assert.deepEqual(value, pin); return snap; },
    authorizeNode(value) { calls.authorize.push(value); return authorize(value); },
    verifyEdgeReceipt(value) { calls.verify.push(value); return verify(value); },
  });
  return { generator, calls, snap };
}

function reconstructSimplePath(record, graphEdges) {
  let current = record.rootArtifactUid;
  const directions = [];
  const nodeUids = [current];
  for (const evidence of record.acceptedEdgeEvidence) {
    const matching = graphEdges.filter((candidate) => candidate.uid === evidence.edgeUid);
    assert.equal(matching.length, 1);
    const candidate = matching[0];
    assert.equal(candidate.authority.receipt_uid, evidence.authorityReceiptUid);
    if (candidate.from_uid === current) {
      directions.push('out');
      current = candidate.to_uid;
    } else {
      assert.equal(candidate.to_uid, current);
      directions.push('in');
      current = candidate.from_uid;
    }
    assert.equal(nodeUids.includes(current), false);
    nodeUids.push(current);
  }
  assert.equal(current, record.documentId);
  return { directions, nodeUids };
}

function request(overrides = {}) {
  return {
    contractVersion: GRAPH_CANDIDATE_CONTRACT_V1, operation: 'graph_candidates',
    context, pin, pinnedArtifactUid: ROOT, lexicalSeeds: [], sourceK: 1000,
    maxWorkUnits: 50_000, maxTotalWorkUnits: 500_000, cursor: null,
    ...overrides,
  };
}

function error(code, field) {
  return field === undefined ? { ok: false, error: { code } }
    : { ok: false, error: { code, field } };
}

test('exports a frozen exact factory surface and validates the closed request', () => {
  assert.equal(GRAPH_CANDIDATE_CONTRACT_V1, 'spipe-accepted-graph-candidates-v1');
  assert.throws(() => createAcceptedGraphCandidateGeneratorV1(), TypeError);
  assert.throws(() => createAcceptedGraphCandidateGeneratorV1({
    readGraphSnapshot() {}, verifyEdgeReceipt() {}, authorizeNode() {}, extra: true,
  }), TypeError);
  const value = fixture().generator;
  assert.equal(Object.isFrozen(value), true);
  assert.deepEqual(Object.keys(value), ['generateGraphCandidatesV1']);
  assert.deepEqual(value.generateGraphCandidatesV1({}), error('invalid_request'));
  for (const [field, bad, code] of [
    ['sourceK', 0, 'limit_exceeded'], ['sourceK', 1001, 'limit_exceeded'],
    ['maxWorkUnits', 0, 'limit_exceeded'], ['maxWorkUnits', 50001, 'limit_exceeded'],
    ['maxTotalWorkUnits', 0, 'limit_exceeded'], ['maxTotalWorkUnits', 500001, 'limit_exceeded'],
  ]) assert.deepEqual(value.generateGraphCandidatesV1(request({ [field]: bad })), error(code, field));
});

test('completes deterministic both-direction depth-three traversal with lossless authority pairs', () => {
  const { generator, calls, snap } = fixture();
  const result = generator.generateGraphCandidatesV1(request());
  assert.equal(result.ok, true);
  assert.equal(result.value.status, 'complete');
  assert.deepEqual(result.value.source.candidates, [
    { documentId: A1 }, { documentId: A2 }, { documentId: A3 },
  ]);
  assert.deepEqual(result.value.evidenceRecords.map((record) => [record.documentId, record.distance]), [
    [A1, 1], [A2, 2], [A3, 3],
  ]);
  assert.deepEqual(result.value.evidenceRecords[1].acceptedEdgeEvidence, [
    { edgeUid: `E-${PAYLOADS[1]}`, authorityReceiptUid: `D-${PAYLOADS[1]}` },
    { edgeUid: `E-${PAYLOADS[2]}`, authorityReceiptUid: `D-${PAYLOADS[2]}` },
  ]);
  assert.equal(result.value.evidenceIdentity.authorizedGraphDigest, snap.authorizedGraphDigest);
  assert.equal(result.value.evidenceIdentity.acceptedEdgeSetDigest,
    OUTPUT_DIGEST_GOLDENS.acceptedEdgeSetDigest);
  assert.equal(result.value.evidenceIdentity.evidenceDigest, OUTPUT_DIGEST_GOLDENS.evidenceDigest);
  assert.equal(result.value.source.sourceIdentity, OUTPUT_DIGEST_GOLDENS.sourceIdentity);
  assert.equal(result.value.source.candidateDigest, OUTPUT_DIGEST_GOLDENS.candidateDigest);
  assert.deepEqual(result.value.counters, {
    visitedNodes: 4, admittedEdges: 3, workUnits: 5, returnedCandidates: 3,
  });
  assert.equal(calls.read, 1);
  assert.equal(calls.authorize.length, 4);
  assert.equal(calls.verify.length, 3);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.value.evidenceRecords[1].acceptedEdgeEvidence), true);
});

test('applies exact-root precedence, same-distance tuple replacement, and late sourceK', () => {
  const edges = [
    edge(1, A1, A2, { confidence: 999 }),
    edge(2, ROOT, A2, { confidence: 700 }),
    edge(3, ROOT, A3, { origin: 'generated', confidence: 1000 }),
  ];
  const { generator } = fixture({ edges });
  const result = generator.generateGraphCandidatesV1(request({
    lexicalSeeds: [{ documentId: A1, sourceRank: 1 }], sourceK: 2,
  }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.source.candidates, [{ documentId: A2 }, { documentId: A3 }]);
  assert.equal(result.value.evidenceRecords[0].rootArtifactUid, ROOT);
  assert.equal(result.value.evidenceRecords[0].distance, 1);
});

test('orders reachable seed-rank, confidence, edge-sequence, and artifact-path dimensions', () => {
  const seedRankEdges = [edge(1, A2, A3), edge(2, A1, A3)];
  const seedRank = fixture({ edges: seedRankEdges }).generator.generateGraphCandidatesV1(request({
    pinnedArtifactUid: null,
    lexicalSeeds: [{ documentId: A1, sourceRank: 1 }, { documentId: A2, sourceRank: 2 }],
  }));
  assert.equal(seedRank.ok, true);
  const seedRankTarget = seedRank.value.evidenceRecords.find((record) => record.documentId === A3);
  assert.equal(seedRankTarget.rootArtifactUid, A1);

  const tupleNodes = [node(ROOT), node(A1), node(A2), node(A3), node(SECTION, 'Section')]
    .sort((left, right) => Buffer.compare(Buffer.from(left.uid), Buffer.from(right.uid)));
  const confidenceEdges = [
    edge(1, ROOT, A1, { confidence: 500 }),
    edge(2, A1, A3, { confidence: 1000 }),
    edge(3, ROOT, SECTION, { confidence: 1000 }),
    edge(4, SECTION, A3, { confidence: 1000 }),
  ];
  const confidence = fixture({ nodes: tupleNodes, edges: confidenceEdges })
    .generator.generateGraphCandidatesV1(request());
  assert.equal(confidence.ok, true);
  const confidenceTarget = confidence.value.evidenceRecords.find((record) => record.documentId === A3);
  assert.deepEqual(confidenceTarget.evidenceEdgeUids,
    [`E-${PAYLOADS[3]}`, `E-${PAYLOADS[4]}`]);

  const edgeOrderEdges = [edge(1, ROOT, A2), edge(2, ROOT, A1)];
  const edgeOrder = fixture({ edges: edgeOrderEdges }).generator.generateGraphCandidatesV1(request());
  assert.equal(edgeOrder.ok, true);
  assert.deepEqual(edgeOrder.value.source.candidates, [{ documentId: A2 }, { documentId: A1 }]);
  for (const record of edgeOrder.value.evidenceRecords) {
    const reconstructed = reconstructSimplePath(record, edgeOrderEdges);
    assert.equal(reconstructed.directions.length, record.distance);
    assert.equal(reconstructed.nodeUids.length, record.distance + 1);
    assert.equal(reconstructed.nodeUids.at(-1), record.documentId);
  }
});

test('continuation is opaque, single-use, factory-local, and calls no ports again', () => {
  const firstFixture = fixture();
  const first = firstFixture.generator.generateGraphCandidatesV1(request({ maxWorkUnits: 1 }));
  assert.equal(first.ok, true);
  assert.equal(first.value.status, 'partial');
  assert.deepEqual(Object.keys(first.value), ['status', 'contractVersion', 'cursor', 'counters']);
  assert.equal(Object.getPrototypeOf(first.value.cursor), null);
  assert.deepEqual(Object.keys(first.value.cursor), []);
  assert.deepEqual(Reflect.ownKeys(first.value.cursor), []);
  assert.equal(Object.isFrozen(first.value.cursor), true);
  assert.equal(first.value.counters.returnedCandidates, 0);
  const before = structuredClone(firstFixture.calls);
  const second = firstFixture.generator.generateGraphCandidatesV1(request({
    maxWorkUnits: 1, cursor: first.value.cursor,
  }));
  assert.equal(second.ok, true);
  assert.equal(second.value.status, 'partial');
  assert.notEqual(second.value.cursor, first.value.cursor);
  assert.deepEqual(Object.keys(second.value), ['status', 'contractVersion', 'cursor', 'counters']);
  assert.deepEqual(firstFixture.generator.generateGraphCandidatesV1(request({
    cursor: first.value.cursor,
  })), error('invalid_cursor'));
  const third = firstFixture.generator.generateGraphCandidatesV1(request({
    maxWorkUnits: 50_000, cursor: second.value.cursor,
  }));
  assert.equal(third.ok, true);
  assert.equal(third.value.status, 'complete');
  const uninterrupted = fixture().generator.generateGraphCandidatesV1(request());
  assert.deepEqual(third.value, uninterrupted.value);
  assert.equal(firstFixture.calls.read, before.read);
  assert.equal(firstFixture.calls.authorize.length, before.authorize.length);
  assert.equal(firstFixture.calls.verify.length, before.verify.length);
  assert.deepEqual(firstFixture.generator.generateGraphCandidatesV1(request({
    cursor: second.value.cursor,
  })), error('invalid_cursor'));
  assert.deepEqual(fixture().generator.generateGraphCandidatesV1(request({
    cursor: first.value.cursor,
  })), error('invalid_cursor'));
  assert.deepEqual(firstFixture.generator.generateGraphCandidatesV1(request({
    cursor: Object.freeze(Object.create(null)),
  })), error('invalid_cursor'));
  const bindingFixture = fixture();
  const bound = bindingFixture.generator.generateGraphCandidatesV1(request({ maxWorkUnits: 1 }));
  assert.deepEqual(bindingFixture.generator.generateGraphCandidatesV1(request({
    maxWorkUnits: 1, sourceK: 1, cursor: bound.value.cursor,
  })), error('invalid_cursor'));
  assert.deepEqual(bindingFixture.generator.generateGraphCandidatesV1(request({
    maxWorkUnits: 1, cursor: bound.value.cursor,
  })), error('invalid_cursor'));
});

test('destroys continuation on total-work exhaustion without leaking partial candidates', () => {
  const { generator } = fixture();
  const partial = generator.generateGraphCandidatesV1(request({ maxWorkUnits: 1, maxTotalWorkUnits: 2 }));
  assert.equal(partial.value.status, 'partial');
  const failed = generator.generateGraphCandidatesV1(request({
    maxWorkUnits: 2, maxTotalWorkUnits: 2, cursor: partial.value.cursor,
  }));
  assert.deepEqual(failed, error('limit_exceeded'));
  assert.equal(Object.hasOwn(failed, 'value'), false);
  assert.deepEqual(generator.generateGraphCandidatesV1(request({
    maxTotalWorkUnits: 2, cursor: partial.value.cursor,
  })), error('invalid_cursor'));
});

test('total exhaustion wins over page exhaustion and destroys the cursor immediately', () => {
  const { generator } = fixture();
  const partial = generator.generateGraphCandidatesV1(request({ maxWorkUnits: 1, maxTotalWorkUnits: 1 }));
  assert.deepEqual(partial, error('limit_exceeded'));
});

test('authorizes every node in order before failing generically and never verifies an edge', () => {
  const denied = A2;
  const { generator, calls } = fixture({ authorize(value) {
    return authResponse(value, value.nodeUid === denied ? 'denied' : 'allowed');
  } });
  assert.deepEqual(generator.generateGraphCandidatesV1(request()), error('snapshot_unavailable'));
  assert.deepEqual(calls.authorize.map((value) => value.nodeUid), [ROOT, A1, A2, A3]);
  assert.equal(calls.verify.length, 0);
});

test('excludes nonaccepted edges, verifies strict evidence, and fails receipt evidence closed', () => {
  const proposed = edge(2, A1, A2, { status: 'proposed' });
  const accepted = edge(1, ROOT, A1);
  const good = fixture({ edges: [accepted, proposed] });
  const complete = good.generator.generateGraphCandidatesV1(request());
  assert.equal(complete.ok, true);
  assert.deepEqual(complete.value.source.candidates, [{ documentId: A1 }]);
  assert.equal(good.calls.verify.length, 1);
  assert.equal(complete.value.counters.workUnits, 3);
  const bad = fixture({ edges: [accepted], verify() { throw new Error('secret'); } });
  assert.deepEqual(bad.generator.generateGraphCandidatesV1(request()), error('evidence_unverified'));
});

test('rejects corrupt snapshot digest and missing roots without disclosing identity', () => {
  const base = fixture();
  const corrupt = deepFreeze({ ...base.snap, authorizedGraphDigest: `sha256:${'0'.repeat(64)}` });
  const generator = createAcceptedGraphCandidateGeneratorV1({
    readGraphSnapshot: () => corrupt,
    authorizeNode: authResponse,
    verifyEdgeReceipt: verifyResponse,
  });
  assert.deepEqual(generator.generateGraphCandidatesV1(request()), error('snapshot_corrupt'));
  const missing = fixture({ nodes: [node(A1)], edges: [] });
  assert.deepEqual(missing.generator.generateGraphCandidatesV1(request()), error('snapshot_corrupt'));
});

test('defaults all three limits and validates lexical rank, uniqueness, and document bytes', () => {
  const { generator } = fixture();
  const defaulted = generator.generateGraphCandidatesV1({
    ...request(), sourceK: undefined, maxWorkUnits: undefined, maxTotalWorkUnits: undefined,
  });
  assert.equal(defaulted.ok, true);
  for (const lexicalSeeds of [
    [{ documentId: A1, sourceRank: 2 }],
    [{ documentId: A1, sourceRank: 1 }, { documentId: A1, sourceRank: 2 }],
    [{ documentId: `A-${'x'.repeat(513)}`, sourceRank: 1 }],
  ]) assert.deepEqual(generator.generateGraphCandidatesV1(request({ lexicalSeeds })), error('invalid_request'));
});

test('traverses inward, terminates cycles, and preserves shared receipt multiplicity', () => {
  const shared = `D-${PAYLOADS[5]}`;
  const cycleEdges = [
    edge(1, A1, ROOT, { receipt: shared }),
    edge(2, A2, A1, { receipt: shared }),
    edge(3, ROOT, A2),
  ];
  const { generator } = fixture({ edges: cycleEdges });
  const result = generator.generateGraphCandidatesV1(request());
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.source.candidates, [{ documentId: A1 }, { documentId: A2 }]);
  const record = result.value.evidenceRecords.find((entry) => entry.documentId === A2);
  assert.equal(record.distance, 1);
  assert.deepEqual(record.acceptedEdgeEvidence,
    [{ edgeUid: `E-${PAYLOADS[3]}`, authorityReceiptUid: `D-${PAYLOADS[3]}` }]);
  assert.equal(new Set(record.acceptedEdgeEvidence.map((entry) => entry.edgeUid)).size,
    record.acceptedEdgeEvidence.length);
  assert.deepEqual(result.value.evidenceRecords[0].acceptedEdgeEvidence,
    [{ edgeUid: `E-${PAYLOADS[1]}`, authorityReceiptUid: shared }]);
  assert.equal(result.value.counters.workUnits, 10);

  const sharedPathEdges = [
    edge(1, ROOT, A1, { receipt: shared }),
    edge(2, A1, A2, { receipt: shared }),
  ];
  const sharedPath = fixture({ edges: sharedPathEdges })
    .generator.generateGraphCandidatesV1(request());
  assert.equal(sharedPath.ok, true);
  const sharedRecord = sharedPath.value.evidenceRecords.find((entry) => entry.documentId === A2);
  assert.deepEqual(sharedRecord.acceptedEdgeEvidence, [
    { edgeUid: `E-${PAYLOADS[1]}`, authorityReceiptUid: shared },
    { edgeUid: `E-${PAYLOADS[2]}`, authorityReceiptUid: shared },
  ]);
  assert.deepEqual(sharedRecord.authorityReceiptUids, [shared]);
});

test('uses later better same-distance tuple and carries it to descendants', () => {
  const nodes = [node(ROOT), node(A1), node(A2), node(A3), node(SECTION, 'Section')]
    .sort((left, right) => Buffer.compare(Buffer.from(left.uid), Buffer.from(right.uid)));
  const edges = [
    edge(1, ROOT, A1, { origin: 'generated', confidence: 500 }),
    edge(2, ROOT, SECTION, { confidence: 1000 }),
    edge(3, A1, A2, { confidence: 1000 }),
    edge(4, SECTION, A2, { confidence: 1000 }),
    edge(5, A2, A3, { confidence: 1000 }),
  ];
  const result = fixture({ nodes, edges }).generator.generateGraphCandidatesV1(request());
  assert.equal(result.ok, true);
  const target = result.value.evidenceRecords.find((record) => record.documentId === A2);
  const descendant = result.value.evidenceRecords.find((record) => record.documentId === A3);
  assert.equal(target.rootArtifactUid, ROOT);
  assert.deepEqual(target.evidenceEdgeUids, [`E-${PAYLOADS[2]}`, `E-${PAYLOADS[4]}`]);
  assert.deepEqual(descendant.evidenceEdgeUids,
    [`E-${PAYLOADS[2]}`, `E-${PAYLOADS[4]}`, `E-${PAYLOADS[5]}`]);
});

test('closes and caps hostile snapshots and port responses before recursive traversal', () => {
  let responseTraversals = 0;
  const hostileResponseValue = hostileFrozenValue(() => { responseTraversals += 1; });
  const hostilePort = fixture({ authorize(value) {
    return Object.freeze({ ...authResponse(value), extra: hostileResponseValue });
  } });
  assert.deepEqual(hostilePort.generator.generateGraphCandidatesV1(request()),
    error('snapshot_unavailable'));
  assert.equal(hostilePort.calls.authorize.length, 4);
  assert.equal(responseTraversals, 0);

  let nodeTraversals = 0;
  const hostileNodeValue = hostileFrozenValue(() => { nodeTraversals += 1; });
  const hostileNode = Object.freeze({ ...node(ROOT), uid: hostileNodeValue });
  const nodeGenerator = createAcceptedGraphCandidateGeneratorV1({
    readGraphSnapshot: () => shallowSnapshot([hostileNode], []),
    authorizeNode() { throw new Error('must not authorize corrupt nodes'); },
    verifyEdgeReceipt() { throw new Error('must not verify corrupt edges'); },
  });
  assert.deepEqual(nodeGenerator.generateGraphCandidatesV1(request()), error('snapshot_corrupt'));
  assert.equal(nodeTraversals, 0);

  let edgeTraversals = 0;
  const hostileEdgeValue = hostileFrozenValue(() => { edgeTraversals += 1; });
  const validEdge = deepFreeze(edge(1, ROOT, A1));
  const hostileEdge = Object.freeze({
    ...validEdge, evidence_uids: Object.freeze([hostileEdgeValue]),
  });
  const edgeGenerator = createAcceptedGraphCandidateGeneratorV1({
    readGraphSnapshot: () => shallowSnapshot(
      [deepFreeze(node(ROOT)), deepFreeze(node(A1))], [hostileEdge],
    ),
    authorizeNode() { throw new Error('must not authorize corrupt nodes'); },
    verifyEdgeReceipt() { throw new Error('must not verify corrupt edges'); },
  });
  assert.deepEqual(edgeGenerator.generateGraphCandidatesV1(request()), error('snapshot_corrupt'));
  assert.equal(edgeTraversals, 0);

  let nodeArrayEnumerations = 0;
  const oversizedNodes = new Proxy(Object.freeze(new Array(20_001).fill(null)), {
    ownKeys(value) { nodeArrayEnumerations += 1; return Reflect.ownKeys(value); },
  });
  const actualNodeCapGenerator = createAcceptedGraphCandidateGeneratorV1({
    readGraphSnapshot: () => shallowSnapshot([], [], { authorizedNodeCount: 0, nodes: oversizedNodes }),
    authorizeNode() { throw new Error('must not authorize capped nodes'); },
    verifyEdgeReceipt() { throw new Error('must not verify capped edges'); },
  });
  assert.deepEqual(actualNodeCapGenerator.generateGraphCandidatesV1(request()), error('snapshot_corrupt'));
  assert.equal(nodeArrayEnumerations, 0);

  let edgeArrayEnumerations = 0;
  const oversizedEdges = new Proxy(Object.freeze(new Array(50_001).fill(null)), {
    ownKeys(value) { edgeArrayEnumerations += 1; return Reflect.ownKeys(value); },
  });
  const actualEdgeCapGenerator = createAcceptedGraphCandidateGeneratorV1({
    readGraphSnapshot: () => shallowSnapshot([], [], { authorizedEdgeCount: 0, edges: oversizedEdges }),
    authorizeNode() { throw new Error('must not authorize capped edges'); },
    verifyEdgeReceipt() { throw new Error('must not verify capped edges'); },
  });
  assert.deepEqual(actualEdgeCapGenerator.generateGraphCandidatesV1(request()), error('snapshot_corrupt'));
  assert.equal(edgeArrayEnumerations, 0);

  let evidenceArrayEnumerations = 0;
  const oversizedEvidence = new Proxy(Object.freeze(new Array(20_001).fill(null)), {
    ownKeys(value) { evidenceArrayEnumerations += 1; return Reflect.ownKeys(value); },
  });
  const evidenceEdge = Object.freeze({
    ...deepFreeze(edge(1, ROOT, A1)), evidence_uids: oversizedEvidence,
  });
  const actualEvidenceCapGenerator = createAcceptedGraphCandidateGeneratorV1({
    readGraphSnapshot: () => shallowSnapshot(
      [deepFreeze(node(ROOT)), deepFreeze(node(A1))], [evidenceEdge],
    ),
    authorizeNode() { throw new Error('must not authorize capped evidence'); },
    verifyEdgeReceipt() { throw new Error('must not verify capped evidence'); },
  });
  assert.deepEqual(actualEvidenceCapGenerator.generateGraphCandidatesV1(request()),
    error('snapshot_corrupt'));
  assert.equal(evidenceArrayEnumerations, 0);

  let seedArrayEnumerations = 0;
  const oversizedSeeds = new Proxy(Object.freeze(new Array(1001).fill(null)), {
    ownKeys(value) { seedArrayEnumerations += 1; return Reflect.ownKeys(value); },
  });
  assert.deepEqual(fixture().generator.generateGraphCandidatesV1(request({
    lexicalSeeds: oversizedSeeds,
  })), error('invalid_request'));
  assert.equal(seedArrayEnumerations, 0);

  const declaredCapGenerator = createAcceptedGraphCandidateGeneratorV1({
    readGraphSnapshot: () => shallowSnapshot([], [], { authorizedNodeCount: 20_001 }),
    authorizeNode() { throw new Error('must not authorize declared cap'); },
    verifyEdgeReceipt() { throw new Error('must not verify declared cap'); },
  });
  assert.deepEqual(declaredCapGenerator.generateGraphCandidatesV1(request()), error('limit_exceeded'));
});

test('rejects hostile hidden edge fields, sparse nested arrays, forged cursors, and workspace confusion', () => {
  const baseEdge = edge(1, ROOT, A1);
  const hidden = { ...baseEdge };
  Object.defineProperty(hidden, 'secret', { value: 'hidden', enumerable: false });
  deepFreeze(hidden);
  const hiddenFixture = fixture({ edges: [hidden] });
  assert.deepEqual(hiddenFixture.generator.generateGraphCandidatesV1(request()), error('snapshot_corrupt'));

  const sparse = edge(1, ROOT, A1);
  const evidence = [];
  evidence.length = 1;
  sparse.evidence_uids = evidence;
  deepFreeze(sparse);
  assert.deepEqual(fixture({ edges: [sparse] }).generator.generateGraphCandidatesV1(request()),
    error('snapshot_corrupt'));

  const { generator } = fixture();
  const forged = Object.freeze(Object.create(null));
  let seedTraversals = 0;
  const hostileSeeds = new Proxy(Object.freeze([]), {
    ownKeys(value) { seedTraversals += 1; return Reflect.ownKeys(value); },
  });
  assert.deepEqual(generator.generateGraphCandidatesV1(request({
    lexicalSeeds: hostileSeeds, cursor: forged,
  })), error('invalid_cursor'));
  assert.equal(seedTraversals, 0);
  assert.deepEqual(generator.generateGraphCandidatesV1(request({
    context: { ...context, workspaceId: `WS-${PAYLOADS[1]}` },
  })), error('invalid_request'));

  let primitiveCoercions = 0;
  const hostilePrimitive = Object.freeze({
    [Symbol.toPrimitive]() {
      primitiveCoercions += 1;
      throw new Error('must not coerce hostile scalar');
    },
  });
  assert.deepEqual(generator.generateGraphCandidatesV1(request({
    pin: Object.freeze({ ...pin, graphRoot: hostilePrimitive }),
  })), error('invalid_request'));
  const hostileDigestGenerator = createAcceptedGraphCandidateGeneratorV1({
    readGraphSnapshot: () => shallowSnapshot([], [], { authorizedGraphDigest: hostilePrimitive }),
    authorizeNode() { throw new Error('must not authorize hostile digest'); },
    verifyEdgeReceipt() { throw new Error('must not verify hostile digest'); },
  });
  assert.deepEqual(hostileDigestGenerator.generateGraphCandidatesV1(request()),
    error('snapshot_corrupt'));
  assert.equal(primitiveCoercions, 0);
});

test('accepts inclusive limit boundaries without widening output', () => {
  const minimum = fixture().generator.generateGraphCandidatesV1(request({
    sourceK: 1, maxWorkUnits: 1, maxTotalWorkUnits: 500_000,
  }));
  assert.equal(minimum.ok, true);
  assert.equal(minimum.value.status, 'partial');
  const maximum = fixture().generator.generateGraphCandidatesV1(request({
    sourceK: 1000, maxWorkUnits: 50_000, maxTotalWorkUnits: 500_000,
  }));
  assert.equal(maximum.ok, true);
  assert.equal(maximum.value.source.candidateCount, 3);
});
