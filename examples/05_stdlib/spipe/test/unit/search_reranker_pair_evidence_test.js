import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  MAX_ACCEPTED_EDGE_EVIDENCE_V3,
  RERANK_CONTRACT_V3,
  RERANK_EVIDENCE_CONTRACT_V3,
  RERANK_FIXED_POLICY_V1,
  createRrfBoundedRerankerV3,
} from '../../src/search/rerank.js';
import { fuseRrfCompletePoolV2 } from '../../src/search/fusion.js';

const VERIFIER_DIGEST = `sha256:${'9'.repeat(64)}`;
const EVIDENCE_DOMAIN = 'spipe-rerank-pair-evidence-v1\0';

function oracleCanonicalJson(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value.normalize('NFC'));
  if (typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(oracleCanonicalJson).join(',')}]`;
  const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key.normalize('NFC'))}:${oracleCanonicalJson(value[key])}`).join(',')}}`;
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function independentDigest(value) {
  const hash = createHash('sha256');
  hash.update(Buffer.from(EVIDENCE_DOMAIN, 'utf8'));
  hash.update(Buffer.from(oracleCanonicalJson(value), 'utf8'));
  return `sha256:${hash.digest('hex')}`;
}

function source(name, ids) {
  const sourceIdentity = `${name}-v2`;
  const candidateDigest = independentDomainDigest('spipe-rrf-source-pool-v1\0', {
    name, sourceIdentity, documentIds: ids,
  });
  return {
    name, sourceIdentity, complete: true, candidateCount: ids.length, candidateDigest,
    candidates: ids.map((documentId) => ({ documentId })),
  };
}

function independentDomainDigest(domain, value) {
  const hash = createHash('sha256');
  hash.update(Buffer.from(domain, 'utf8'));
  hash.update(Buffer.from(oracleCanonicalJson(value), 'utf8'));
  return `sha256:${hash.digest('hex')}`;
}

function rawPool(sources = [source('lexical', ['a']), source('graph', ['b'])]) {
  const result = fuseRrfCompletePoolV2({
    context: {
      workspaceId: 'workspace-a', snapshotId: 'snapshot-a',
      authorizationScopeDigest: 'scope-a', queryReceipt: 'query-a',
      analyzerIdentity: 'analyzer-a',
    },
    k: 60, sourceK: 1000, sources,
  });
  assert.equal(result.ok, true);
  return result.value;
}

function noMatch() {
  return {
    matched: false, queryClassificationUids: [], artifactClassificationUids: [],
    evidenceEdgeUids: [],
  };
}

function pair(edgeUid, authorityReceiptUid) { return { edgeUid, authorityReceiptUid }; }

function record(documentId, overrides = {}) {
  return {
    documentId,
    acceptedTrace: { distance: null, acceptedEdgeEvidence: [] },
    featureMatch: noMatch(), componentMatch: noMatch(), recency: null,
    status: { value: 'active', evidenceUid: `status-${documentId}` },
    ...overrides,
  };
}

function normalizedDigestRecord(value) {
  return {
    documentId: value.documentId,
    acceptedTrace: {
      distance: value.acceptedTrace.distance,
      acceptedEdgeEvidence: value.acceptedTrace.acceptedEdgeEvidence,
    },
    featureMatch: value.featureMatch,
    componentMatch: value.componentMatch,
    recency: value.recency,
    status: value.status,
  };
}

function page(raw, records, overrides = {}) {
  const identityWithoutDigest = {
    workspaceId: 'workspace-a', snapshotId: 'snapshot-a',
    authorizationScopeDigest: 'scope-a', queryReceipt: 'query-a',
    graphSnapshotId: 'graph-a', graphPolicyVersion: 1, recencyEpochDay: 1000,
    authorityReceiptUid: 'page-authority', rawFusionDigest: raw.identity.rawFusionDigest,
    evidenceContractVersion: RERANK_EVIDENCE_CONTRACT_V3,
    authorityVerifierDigest: VERIFIER_DIGEST,
    ...overrides,
  };
  delete identityWithoutDigest.evidenceDigest;
  const evidenceDigest = independentDigest({
    identity: identityWithoutDigest,
    records: records.map(normalizedDigestRecord),
  });
  return {
    identity: { ...identityWithoutDigest, evidenceDigest: overrides.evidenceDigest ?? evidenceDigest },
    records,
  };
}

function request(raw, records, pageOverrides = {}, requestOverrides = {}) {
  return {
    rawFusion: raw, evidencePage: page(raw, records, pageOverrides),
    policy: RERANK_FIXED_POLICY_V1, outputLimit: 2, ...requestOverrides,
  };
}

function error(code) { return { ok: false, error: { code } }; }

function reranker(verifier = () => true, digest = VERIFIER_DIGEST) {
  return createRrfBoundedRerankerV3({ verifyEvidencePage: verifier, authorityVerifierDigest: digest });
}

test('exports a frozen exact-two-field V3 factory contract', () => {
  assert.equal(RERANK_CONTRACT_V3, 'rrf-bounded-rerank-v3');
  assert.equal(RERANK_EVIDENCE_CONTRACT_V3, 'rerank-pair-evidence-v1');
  assert.equal(MAX_ACCEPTED_EDGE_EVIDENCE_V3, 16);
  assert.throws(() => createRrfBoundedRerankerV3(), TypeError);
  assert.throws(() => createRrfBoundedRerankerV3({
    verifyEvidencePage: () => true, authorityVerifierDigest: VERIFIER_DIGEST, extra: true,
  }), TypeError);
  const value = reranker();
  assert.equal(Object.isFrozen(value), true);
  assert.deepEqual(Object.keys(value), ['rerankRrfCompletePoolV3']);
});

test('preserves ordered pair evidence, permits a shared receipt, and derives sorted display views', () => {
  const raw = rawPool();
  const records = raw.hits.map((hit) => hit.documentId === 'a'
    ? record('a', { acceptedTrace: { distance: 2, acceptedEdgeEvidence: [
      pair('edge-z', 'receipt-shared'), pair('edge-a', 'receipt-shared'),
    ] } }) : record(hit.documentId));
  let calls = 0;
  let verified;
  const result = reranker((value) => { calls += 1; verified = value; return true; })
    .rerankRrfCompletePoolV3(request(raw, records));
  assert.equal(result.ok, true);
  assert.equal(calls, 1);
  const trace = verified.evidencePage.records[0].acceptedTrace;
  assert.deepEqual(trace.acceptedEdgeEvidence, [
    { edgeUid: 'edge-z', authorityReceiptUid: 'receipt-shared' },
    { edgeUid: 'edge-a', authorityReceiptUid: 'receipt-shared' },
  ]);
  assert.deepEqual(trace.evidenceEdgeUids, ['edge-a', 'edge-z']);
  assert.deepEqual(trace.authorityReceiptUids, ['receipt-shared']);
  assert.deepEqual(result.value.hits.find((hit) => hit.documentId === 'a')
    .rerankExplanation.acceptedTrace.evidence, trace);
  assert.equal(result.value.identity.rerankContractVersion, RERANK_CONTRACT_V3);
  assert.equal(result.value.identity.evidenceContractVersion, RERANK_EVIDENCE_CONTRACT_V3);
  assert.equal(result.value.identity.authorityVerifierDigest, VERIFIER_DIGEST);
});

test('binds pair order and every pair field with an independent digest oracle', () => {
  const raw = rawPool();
  const trace = { distance: 2, acceptedEdgeEvidence: [pair('e1', 'r'), pair('e2', 'r')] };
  const records = raw.hits.map((hit) => hit.documentId === 'a'
    ? record('a', { acceptedTrace: trace }) : record(hit.documentId));
  const good = request(raw, records);
  assert.equal(reranker().rerankRrfCompletePoolV3(good).ok, true);
  for (const mutate of [
    (copy) => copy.evidencePage.records[0].acceptedTrace.acceptedEdgeEvidence.reverse(),
    (copy) => { copy.evidencePage.records[0].acceptedTrace.acceptedEdgeEvidence[0].edgeUid = 'changed'; },
    (copy) => { copy.evidencePage.records[0].acceptedTrace.acceptedEdgeEvidence[0].authorityReceiptUid = 'changed'; },
  ]) {
    const forged = structuredClone(good); mutate(forged); deepFreeze(forged.rawFusion);
    assert.deepEqual(reranker().rerankRrfCompletePoolV3(forged), error('evidence_digest_mismatch'));
  }
});

test('enforces pair cap, distance cardinality, unique edges, and exact pair schemas', () => {
  const raw = rawPool();
  const runTrace = (acceptedTrace) => reranker().rerankRrfCompletePoolV3(request(raw,
    raw.hits.map((hit) => hit.documentId === 'a' ? record('a', { acceptedTrace }) : record(hit.documentId))));
  const tooMany = Array.from({ length: 17 }, (_, index) => pair(`e${index}`, 'shared'));
  for (const trace of [
    { distance: 3, acceptedEdgeEvidence: tooMany },
    { distance: 1, acceptedEdgeEvidence: [] },
    { distance: 2, acceptedEdgeEvidence: [pair('same', 'r1'), pair('same', 'r2')] },
    { distance: 1, acceptedEdgeEvidence: [{ edgeUid: 'e', authorityReceiptUid: 'r', extra: 1 }] },
    { distance: null, acceptedEdgeEvidence: [pair('e', 'r')] },
  ]) assert.deepEqual(runTrace(trace), error('invalid_accepted_trace'));
});

test('validates local identity and digest before invoking authority exactly once', () => {
  const raw = rawPool();
  const records = raw.hits.map((hit) => record(hit.documentId));
  let calls = 0;
  const checked = reranker(() => { calls += 1; return true; });
  assert.deepEqual(checked.rerankRrfCompletePoolV3(request(raw, records, {
    authorityVerifierDigest: `sha256:${'8'.repeat(64)}`,
  })), error('authority_verifier_mismatch'));
  assert.deepEqual(checked.rerankRrfCompletePoolV3(request(raw, records, {
    evidenceDigest: `sha256:${'7'.repeat(64)}`,
  })), error('evidence_digest_mismatch'));
  assert.equal(calls, 0);
  assert.equal(checked.rerankRrfCompletePoolV3(request(raw, records)).ok, true);
  assert.equal(calls, 1);
  assert.deepEqual(reranker(() => false).rerankRrfCompletePoolV3(request(raw, records)),
    error('invalid_evidence_authority'));
  assert.deepEqual(reranker(() => { throw new Error('deny'); })
    .rerankRrfCompletePoolV3(request(raw, records)), error('invalid_evidence_authority'));
});

test('preserves whole-page error precedence and rejects hostile descriptors without getters', () => {
  const raw = rawPool();
  let calls = 0;
  const checked = reranker(() => { calls += 1; return true; });
  const bad = [
    record('wrong', { status: { value: 'bad', evidenceUid: 's' } }),
    record(raw.hits[1].documentId, { acceptedTrace: { distance: 4, acceptedEdgeEvidence: [] } }),
  ];
  assert.deepEqual(checked.rerankRrfCompletePoolV3(request(raw, bad)),
    error('record_identity_mismatch'));
  const second = raw.hits.map((hit, index) => index === 0
    ? record(hit.documentId, { featureMatch: { ...noMatch(), matched: true } })
    : record(hit.documentId, { acceptedTrace: { distance: 4, acceptedEdgeEvidence: [] } }));
  assert.deepEqual(checked.rerankRrfCompletePoolV3(request(raw, second)),
    error('invalid_accepted_trace'));
  const hostile = request(raw, raw.hits.map((hit) => record(hit.documentId)));
  Object.defineProperty(hostile.evidencePage.records[0].acceptedTrace.acceptedEdgeEvidence, '0', {
    enumerable: true, get() { calls += 100; return pair('e', 'r'); },
  });
  hostile.evidencePage.records[0].acceptedTrace.acceptedEdgeEvidence.length = 1;
  assert.deepEqual(checked.rerankRrfCompletePoolV3(hostile), error('invalid_accepted_trace'));
  assert.equal(calls, 0);
});

test('reranks a complete 2000-hit pool before truncation and promotes a late pair-backed hit', () => {
  const lexical = Array.from({ length: 1000 }, (_, index) => `l${String(index + 1).padStart(4, '0')}`);
  const graph = Array.from({ length: 1000 }, (_, index) => `g${String(index + 1).padStart(4, '0')}`);
  const raw = rawPool([source('lexical', lexical), source('graph', graph)]);
  assert.equal(raw.hits[1000].documentId, 'g0501');
  const records = raw.hits.map((hit) => hit.documentId === 'g0501'
    ? record(hit.documentId, {
      acceptedTrace: { distance: 1, acceptedEdgeEvidence: [pair('edge-g0501', 'receipt')] },
      featureMatch: { matched: true, queryClassificationUids: ['fq'], artifactClassificationUids: ['fa'], evidenceEdgeUids: ['fe'] },
      componentMatch: { matched: true, queryClassificationUids: ['cq'], artifactClassificationUids: ['ca'], evidenceEdgeUids: ['ce'] },
      recency: { documentRevisionEpochDay: 993, evidenceUid: 'recent' },
    }) : record(hit.documentId));
  const result = reranker().rerankRrfCompletePoolV3({
    ...request(raw, records), outputLimit: 1000,
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.identity.internalPoolCount, 2000);
  const promoted = result.value.hits.find((hit) => hit.documentId === 'g0501');
  assert.equal(promoted.adjustedScoreUnits, 2_192_512);
  assert.equal(promoted.finalRank, 793);
});

test('returns deeply frozen results and does not mutate input evidence', () => {
  const raw = rawPool();
  const records = raw.hits.map((hit) => hit.documentId === 'a'
    ? record('a', { acceptedTrace: { distance: 1, acceptedEdgeEvidence: [pair('e', 'r')] } })
    : record(hit.documentId));
  const input = request(raw, records);
  const before = structuredClone(input.evidencePage);
  const result = reranker().rerankRrfCompletePoolV3(input);
  assert.deepEqual(input.evidencePage, before);
  function assertDeepFrozen(value) {
    if (value === null || typeof value !== 'object') return;
    assert.equal(Object.isFrozen(value), true);
    for (const child of Object.values(value)) assertDeepFrozen(child);
  }
  assertDeepFrozen(result);
  assert.equal(result.value.hits[0].rawHit, raw.hits[0]);
});
