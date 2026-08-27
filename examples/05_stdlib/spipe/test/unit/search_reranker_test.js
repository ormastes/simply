import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  MAX_EVIDENCE_IDS,
  MAX_HITS,
  RERANK_CONTRACT_V1,
  RERANK_FIXED_POLICY_V1,
  RERANK_POLICY_V1,
  RERANK_CONTRACT_V2,
  MAX_POOL_HITS_V2,
  MAX_OUTPUT_HITS_V2,
  createRrfBoundedRerankerV1,
  createRrfBoundedRerankerV2,
} from '../../src/search/rerank.js';
import { fuseRrfCompletePoolV2 } from '../../src/search/fusion.js';
import { canonicalJson } from '../../src/storage/canonical.js';

const RAW_FUSION_DIGEST = `sha256:${'a'.repeat(64)}`;
const EVIDENCE_DIGEST = `sha256:${'b'.repeat(64)}`;

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function rawPage(hits = [
  {
    documentId: 'a', fusedRank: 1, rawScoreUnits: 32_522_474,
    contributions: [
      { source: 'lexical', sourceIdentity: 'lexical-v1', sourceRank: 1, contributionUnits: 16_393_442 },
      { source: 'graph', sourceIdentity: 'graph-v1', sourceRank: 2, contributionUnits: 16_129_032 },
    ],
  },
  {
    documentId: 'b', fusedRank: 2, rawScoreUnits: 32_522_474,
    contributions: [
      { source: 'lexical', sourceIdentity: 'lexical-v1', sourceRank: 2, contributionUnits: 16_129_032 },
      { source: 'graph', sourceIdentity: 'graph-v1', sourceRank: 1, contributionUnits: 16_393_442 },
    ],
  },
]) {
  return deepFreeze({
    identity: {
      contractVersion: 'rrf-fixed-v1', k: 60, sourceK: 1000,
      orderedSources: [
        { name: 'lexical', sourceIdentity: 'lexical-v1' },
        { name: 'graph', sourceIdentity: 'graph-v1' },
      ],
      context: {
        workspaceId: 'workspace-a', snapshotId: 'snapshot-a',
        authorizationScopeDigest: 'scope-a', queryReceipt: 'query-a', analyzerIdentity: 'analyzer-a',
      },
    },
    hits,
  });
}

function noMatch() {
  return { matched: false, queryClassificationUids: [], artifactClassificationUids: [], evidenceEdgeUids: [] };
}

function record(documentId, overrides = {}) {
  return {
    documentId,
    acceptedTrace: { distance: null, evidenceEdgeUids: [], authorityReceiptUids: [] },
    featureMatch: noMatch(), componentMatch: noMatch(), recency: null,
    status: { value: 'active', evidenceUid: `status-${documentId}` },
    ...overrides,
  };
}

function evidence(records, identityOverrides = {}) {
  return {
    identity: {
      workspaceId: 'workspace-a', snapshotId: 'snapshot-a',
      authorizationScopeDigest: 'scope-a', queryReceipt: 'query-a',
      graphSnapshotId: 'graph-a', graphPolicyVersion: 1, recencyEpochDay: 1000,
      authorityReceiptUid: 'authority-a', rawFusionDigest: RAW_FUSION_DIGEST,
      evidenceDigest: EVIDENCE_DIGEST,
      ...identityOverrides,
    },
    records,
  };
}

function request(overrides = {}) {
  return {
    rawFusion: rawPage(), evidencePage: evidence([record('a'), record('b')]),
    policy: RERANK_FIXED_POLICY_V1, outputLimit: 2, ...overrides,
  };
}

function expectedError(code) { return { ok: false, error: { code } }; }

function digestV2(domain, value) {
  return `sha256:${createHash('sha256').update(domain, 'utf8')
    .update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function sourceV2(name, ids) {
  const sourceIdentity = `${name}-v2`;
  return {
    name,
    sourceIdentity,
    complete: true,
    candidateCount: ids.length,
    candidateDigest: digestV2('spipe-rrf-source-pool-v1\0', {
      name, sourceIdentity, documentIds: ids,
    }),
    candidates: ids.map((documentId) => ({ documentId })),
  };
}

function rawPoolV2(sources) {
  const result = fuseRrfCompletePoolV2({
    context: {
      workspaceId: 'workspace-a', snapshotId: 'snapshot-a',
      authorizationScopeDigest: 'scope-a', queryReceipt: 'query-a',
      analyzerIdentity: 'analyzer-a',
    },
    k: 60,
    sourceK: 1000,
    sources,
  });
  assert.equal(result.ok, true);
  return result.value;
}

function evidenceV2(rawFusion, records, identityOverrides = {}) {
  return evidence(records, {
    rawFusionDigest: rawFusion.identity.rawFusionDigest,
    ...identityOverrides,
  });
}

test('exports the frozen authority-bound contract and requires a synchronous verifier capability', () => {
  assert.equal(RERANK_CONTRACT_V1, 'rrf-bounded-rerank-v1');
  assert.equal(RERANK_POLICY_V1, 'spipe-rerank-policy-v1');
  assert.equal(MAX_HITS, 1000);
  assert.equal(MAX_EVIDENCE_IDS, 16);
  assert.equal(Object.isFrozen(RERANK_FIXED_POLICY_V1), true);
  assert.deepEqual(RERANK_FIXED_POLICY_V1.recencyBasisPointsByAge, [
    { maxAgeDays: 7, bp: 500 }, { maxAgeDays: 30, bp: 300 }, { maxAgeDays: 90, bp: 100 },
  ]);
  assert.throws(() => createRrfBoundedRerankerV1(), TypeError);
  assert.throws(() => createRrfBoundedRerankerV1({ verifyEvidencePage: true }), TypeError);
});

test('binds and verifies one normalized complete evidence page before reranking', () => {
  let calls = 0;
  let verifierRequest;
  const reranker = createRrfBoundedRerankerV1({ verifyEvidencePage(value) {
    calls += 1;
    verifierRequest = value;
    return true;
  } });
  const input = request();
  const result = reranker.rerankRrfPageV1(input);
  assert.equal(result.ok, true);
  assert.equal(calls, 1);
  assert.notEqual(verifierRequest.evidencePage, input.evidencePage);
  assert.equal(verifierRequest.rawFusion, input.rawFusion);
  assert.deepEqual(verifierRequest.rawFusion, input.rawFusion);
  assert.equal(Object.isFrozen(verifierRequest.evidencePage.records[0].acceptedTrace), true);
  assert.equal(verifierRequest.evidencePage.identity.authorityReceiptUid, 'authority-a');
  assert.equal(verifierRequest.evidencePage.identity.rawFusionDigest, RAW_FUSION_DIGEST);
  assert.equal(verifierRequest.evidencePage.identity.evidenceDigest, EVIDENCE_DIGEST);
  assert.deepEqual(verifierRequest.evidencePage, evidence([record('a'), record('b')]));
  assert.equal(Object.isFrozen(verifierRequest), true);
  assert.equal(Object.isFrozen(verifierRequest.rawFusion), true);
  assert.equal(result.value.hits[0].rawHit, input.rawFusion.hits[0]);
  assert.equal(Object.isFrozen(result.value.hits), true);
  assert.equal(Object.isFrozen(result.value.hits[0]), true);
});

test('uses independent integer deltas, frozen tiers, cap evidence, and lifecycle penalties', () => {
  const boosted = record('a', {
    acceptedTrace: { distance: 1, evidenceEdgeUids: ['edge-a'], authorityReceiptUids: ['receipt-a'] },
    featureMatch: { matched: true, queryClassificationUids: ['fq'], artifactClassificationUids: ['fa'], evidenceEdgeUids: ['fe'] },
    componentMatch: { matched: true, queryClassificationUids: ['cq'], artifactClassificationUids: ['ca'], evidenceEdgeUids: ['ce'] },
    recency: { documentRevisionEpochDay: 993, evidenceUid: 'recent-a' },
  });
  const deprecated = record('b', { status: { value: 'deprecated', evidenceUid: 'deprecated-b' } });
  const result = createRrfBoundedRerankerV1({ verifyEvidencePage: () => true }).rerankRrfPageV1(
    request({ evidencePage: evidence([boosted, deprecated]) }),
  );
  assert.equal(result.ok, true);
  const first = result.value.hits[0];
  assert.equal(first.rerankExplanation.acceptedTrace.deltaUnits, 3_252_247);
  assert.equal(first.rerankExplanation.featureMatch.deltaUnits, 1_300_898);
  assert.equal(first.rerankExplanation.componentMatch.deltaUnits, 1_300_898);
  assert.equal(first.rerankExplanation.recency.deltaUnits, 1_626_123);
  assert.equal(first.rerankExplanation.uncappedPositiveUnits, 7_480_166);
  assert.equal(first.rerankExplanation.positiveCapUnits, 8_130_618);
  assert.equal(first.rerankExplanation.totalPositiveUnits, 7_480_166);
  assert.ok(first.rerankExplanation.totalPositiveUnits <= first.rerankExplanation.positiveCapUnits);
  assert.equal(first.adjustedScoreUnits, 40_002_640);
  assert.equal(result.value.hits[1].rerankExplanation.status.penaltyUnits, 16_261_237);
  assert.equal(result.value.hits[1].adjustedScoreUnits, 16_261_237);
});

test('applies all trace and recency boundaries and rejects future revisions', () => {
  const run = (distance, revision) => {
    const trace = distance === null
      ? { distance: null, evidenceEdgeUids: [], authorityReceiptUids: [] }
      : { distance, evidenceEdgeUids: ['edge'], authorityReceiptUids: ['receipt'] };
    const page = rawPage([deepFreeze({
      documentId: 'a', fusedRank: 1, rawScoreUnits: 16_393_442,
      contributions: [{ source: 'lexical', sourceIdentity: 'lexical-v1', sourceRank: 1, contributionUnits: 16_393_442 }],
    })]);
    return createRrfBoundedRerankerV1({ verifyEvidencePage: () => true }).rerankRrfPageV1({
      rawFusion: page,
      evidencePage: evidence([record('a', { acceptedTrace: trace,
        recency: revision === null ? null : { documentRevisionEpochDay: revision, evidenceUid: 'recent' } })]),
      policy: RERANK_FIXED_POLICY_V1, outputLimit: 1,
    });
  };
  const distance1 = run(1, 993).value.hits[0].rerankExplanation;
  const distance2 = run(2, 970).value.hits[0].rerankExplanation;
  const distance3 = run(3, 910).value.hits[0].rerankExplanation;
  assert.equal(distance1.acceptedTrace.basisPoints, 1000);
  assert.equal(distance1.acceptedTrace.deltaUnits, 1_639_344);
  assert.equal(distance1.recency.basisPoints, 500);
  assert.equal(distance2.acceptedTrace.basisPoints, 700);
  assert.equal(distance2.acceptedTrace.deltaUnits, 1_147_540);
  assert.equal(distance2.recency.basisPoints, 300);
  assert.equal(distance3.acceptedTrace.basisPoints, 400);
  assert.equal(distance3.acceptedTrace.deltaUnits, 655_737);
  assert.equal(distance3.recency.basisPoints, 100);
  assert.equal(run(null, 909).value.hits[0].rerankExplanation.recency.basisPoints, 0);
  assert.deepEqual(run(null, 1001), expectedError('invalid_recency'));
});

test('sorts by adjusted score, then raw score, then unsigned UTF-8 ID', () => {
  const raw = rawPage([
    deepFreeze({ documentId: 'z', fusedRank: 1, rawScoreUnits: 16_393_442,
      contributions: [{ source: 'lexical', sourceIdentity: 'lexical-v1', sourceRank: 1, contributionUnits: 16_393_442 }] }),
    deepFreeze({ documentId: 'é', fusedRank: 2, rawScoreUnits: 16_129_032,
      contributions: [{ source: 'graph', sourceIdentity: 'graph-v1', sourceRank: 2, contributionUnits: 16_129_032 }] }),
  ]);
  const result = createRrfBoundedRerankerV1({ verifyEvidencePage: () => true }).rerankRrfPageV1({
    rawFusion: raw, evidencePage: evidence([record('z'), record('é')]),
    policy: RERANK_FIXED_POLICY_V1, outputLimit: 2,
  });
  assert.deepEqual(result.value.hits.map((hit) => hit.documentId), ['z', 'é']);
  assert.deepEqual(result.value.hits.map((hit) => hit.finalRank), [1, 2]);

  const rawTie = rawPage([
    deepFreeze({ documentId: 'a', fusedRank: 1, rawScoreUnits: 16_393_442,
      contributions: [{ source: 'lexical', sourceIdentity: 'lexical-v1', sourceRank: 1, contributionUnits: 16_393_442 }] }),
    deepFreeze({ documentId: 'b', fusedRank: 2, rawScoreUnits: 16_129_032,
      contributions: [{ source: 'lexical', sourceIdentity: 'lexical-v1', sourceRank: 2, contributionUnits: 16_129_032 }] }),
  ]);
  const rawTieRecords = [
    record('a', {
      acceptedTrace: { distance: 1, evidenceEdgeUids: ['ae'], authorityReceiptUids: ['ar'] },
      recency: { documentRevisionEpochDay: 910, evidenceUid: 'age-a' },
      status: { value: 'deprecated', evidenceUid: 'status-a' },
    }),
    record('b', {
      acceptedTrace: { distance: 3, evidenceEdgeUids: ['be'], authorityReceiptUids: ['br'] },
      featureMatch: { matched: true, queryClassificationUids: ['bfq'], artifactClassificationUids: ['bfa'], evidenceEdgeUids: ['bfe'] },
      componentMatch: { matched: true, queryClassificationUids: ['bcq'], artifactClassificationUids: ['bca'], evidenceEdgeUids: ['bce'] },
      status: { value: 'deprecated', evidenceUid: 'status-b' },
    }),
  ];
  const equalAdjusted = createRrfBoundedRerankerV1({ verifyEvidencePage: () => true }).rerankRrfPageV1({
    rawFusion: rawTie, evidencePage: evidence(rawTieRecords), policy: RERANK_FIXED_POLICY_V1, outputLimit: 2,
  });
  assert.deepEqual(equalAdjusted.value.hits.map((hit) => hit.adjustedScoreUnits), [9_999_999, 9_999_999]);
  assert.deepEqual(equalAdjusted.value.hits.map((hit) => hit.documentId), ['a', 'b']);

  const utf8TieRaw = rawPage([
    deepFreeze({ documentId: 'z', fusedRank: 1, rawScoreUnits: 32_522_474,
      contributions: [
        { source: 'lexical', sourceIdentity: 'lexical-v1', sourceRank: 1, contributionUnits: 16_393_442 },
        { source: 'graph', sourceIdentity: 'graph-v1', sourceRank: 2, contributionUnits: 16_129_032 },
      ] }),
    deepFreeze({ documentId: 'é', fusedRank: 2, rawScoreUnits: 32_522_474,
      contributions: [
        { source: 'lexical', sourceIdentity: 'lexical-v1', sourceRank: 2, contributionUnits: 16_129_032 },
        { source: 'graph', sourceIdentity: 'graph-v1', sourceRank: 1, contributionUnits: 16_393_442 },
      ] }),
  ]);
  const idTie = createRrfBoundedRerankerV1({ verifyEvidencePage: () => true }).rerankRrfPageV1({
    rawFusion: utf8TieRaw, evidencePage: evidence([record('z'), record('é')]),
    policy: RERANK_FIXED_POLICY_V1, outputLimit: 2,
  });
  assert.deepEqual(idTie.value.hits.map((hit) => hit.documentId), ['z', 'é']);
});

test('fails closed on authority false/throw and never calls it for invalid binding or evidence', () => {
  let calls = 0;
  const falseVerifier = createRrfBoundedRerankerV1({ verifyEvidencePage() { calls += 1; return false; } });
  assert.deepEqual(falseVerifier.rerankRrfPageV1(request()), expectedError('invalid_evidence_authority'));
  assert.equal(calls, 1);
  const throwing = createRrfBoundedRerankerV1({ verifyEvidencePage() { throw new Error('no'); } });
  assert.deepEqual(throwing.rerankRrfPageV1(request()), expectedError('invalid_evidence_authority'));
  const never = createRrfBoundedRerankerV1({ verifyEvidencePage() { calls += 1; return true; } });
  assert.deepEqual(never.rerankRrfPageV1(request({
    evidencePage: evidence([record('a'), record('b')], { workspaceId: 'wrong' }),
  })), expectedError('context_mismatch'));
  assert.deepEqual(never.rerankRrfPageV1(request({ evidencePage: evidence([record('b'), record('a')]) })),
    expectedError('record_identity_mismatch'));
  assert.deepEqual(never.rerankRrfPageV1(request({ evidencePage: evidence([record('a'), record('b')], {
    rawFusionDigest: 'not-a-digest',
  }) })), expectedError('invalid_evidence_identity'));
  assert.equal(calls, 1);
});

test('enforces page-wide record error precedence before the authority call', () => {
  let calls = 0;
  const reranker = createRrfBoundedRerankerV1({ verifyEvidencePage() { calls += 1; return true; } });
  assert.deepEqual(reranker.rerankRrfPageV1(request({ evidencePage: evidence([
    record('a', { status: { value: 'bad', evidenceUid: 's' } }), record('wrong'),
  ]) })), expectedError('record_identity_mismatch'));
  assert.deepEqual(reranker.rerankRrfPageV1(request({ evidencePage: evidence([
    record('a', { featureMatch: { matched: true, queryClassificationUids: [], artifactClassificationUids: [], evidenceEdgeUids: [] } }),
    record('b', { acceptedTrace: { distance: 4, evidenceEdgeUids: [], authorityReceiptUids: [] } }),
  ]) })), expectedError('invalid_accepted_trace'));
  assert.deepEqual(reranker.rerankRrfPageV1(request({ evidencePage: evidence([
    record('a', { recency: { documentRevisionEpochDay: 1001, evidenceUid: 'future' } }),
    record('b', { componentMatch: { matched: true, queryClassificationUids: [], artifactClassificationUids: [], evidenceEdgeUids: [] } }),
  ]) })), expectedError('invalid_classification'));
  assert.deepEqual(reranker.rerankRrfPageV1(request({ evidencePage: evidence([
    record('a', { status: { value: 'bad', evidenceUid: 's' } }),
    record('b', { recency: { documentRevisionEpochDay: 1001, evidenceUid: 'future' } }),
  ]) })), expectedError('invalid_recency'));
  assert.equal(calls, 0);
});

test('rejects forged raw pages, including mutable layers, bad arithmetic, order, and reused ranks', () => {
  const mutable = structuredClone(rawPage());
  assert.deepEqual(createRrfBoundedRerankerV1({ verifyEvidencePage: () => true }).rerankRrfPageV1(
    request({ rawFusion: mutable }),
  ), expectedError('invalid_raw_identity'));
  const cases = [];
  const badSum = structuredClone(rawPage()); badSum.hits[0].rawScoreUnits += 1; cases.push(badSum);
  const badContribution = structuredClone(rawPage()); badContribution.hits[0].contributions[0].contributionUnits -= 1; cases.push(badContribution);
  const duplicateRank = structuredClone(rawPage()); duplicateRank.hits[1].contributions[1].sourceRank = 2;
  duplicateRank.hits[1].contributions[1].contributionUnits = 16_129_032;
  duplicateRank.hits[1].rawScoreUnits = 32_258_064; cases.push(duplicateRank);
  for (const forged of cases) {
    deepFreeze(forged);
    assert.deepEqual(createRrfBoundedRerankerV1({ verifyEvidencePage: () => true }).rerankRrfPageV1(
      request({ rawFusion: forged }),
    ), expectedError('invalid_raw_hit_page'));
  }
});

test('admits locally consistent incomplete raw pages only through digest-bound authority', () => {
  const locallyConsistent = rawPage([deepFreeze({
    documentId: 'rank-1000', fusedRank: 1, rawScoreUnits: 943_396,
    contributions: [{ source: 'lexical', sourceIdentity: 'lexical-v1', sourceRank: 1000, contributionUnits: 943_396 }],
  })]);
  const authorityEvidence = evidence([record('rank-1000')]);
  let calls = 0;
  const rejecting = createRrfBoundedRerankerV1({ verifyEvidencePage(value) {
    calls += 1;
    return value.evidencePage.identity.rawFusionDigest === `sha256:${'c'.repeat(64)}`;
  } });
  assert.deepEqual(rejecting.rerankRrfPageV1({ rawFusion: locallyConsistent,
    evidencePage: authorityEvidence, policy: RERANK_FIXED_POLICY_V1, outputLimit: 1 }),
  expectedError('invalid_evidence_authority'));
  assert.equal(calls, 1);
  const trusted = createRrfBoundedRerankerV1({ verifyEvidencePage(value) {
    return value.rawFusion === locallyConsistent
      && value.evidencePage.identity.rawFusionDigest === RAW_FUSION_DIGEST
      && value.evidencePage.identity.authorityReceiptUid === 'authority-a';
  } });
  assert.equal(trusted.rerankRrfPageV1({ rawFusion: locallyConsistent,
    evidencePage: authorityEvidence, policy: RERANK_FIXED_POLICY_V1, outputLimit: 1 }).ok, true);
});

test('enforces policy, classification, trace, status, evidence-ID, and closed-schema errors', () => {
  const reranker = createRrfBoundedRerankerV1({ verifyEvidencePage: () => true });
  assert.deepEqual(reranker.rerankRrfPageV1(request({ policy: { ...RERANK_FIXED_POLICY_V1, featureBasisPoints: 401 } })),
    expectedError('policy_mismatch'));
  assert.deepEqual(reranker.rerankRrfPageV1(request({ policy: { ...RERANK_FIXED_POLICY_V1, extra: 1 } })),
    expectedError('invalid_policy'));
  const tooMany = Array.from({ length: 17 }, (_, index) => `e-${String(index).padStart(2, '0')}`);
  for (const [field, value, code] of [
    ['acceptedTrace', { distance: 1, evidenceEdgeUids: tooMany, authorityReceiptUids: tooMany }, 'invalid_accepted_trace'],
    ['featureMatch', { matched: true, queryClassificationUids: [], artifactClassificationUids: ['a'], evidenceEdgeUids: ['e'] }, 'invalid_classification'],
    ['status', { value: 'unknown', evidenceUid: 's' }, 'invalid_status'],
  ]) {
    const records = [record('a', { [field]: value }), record('b')];
    assert.deepEqual(reranker.rerankRrfPageV1(request({ evidencePage: evidence(records) })), expectedError(code));
  }
  const stale = reranker.rerankRrfPageV1(request({ evidencePage: evidence([
    record('a', { status: { value: 'stale', evidenceUid: 'stale-a' } }), record('b'),
  ]) }));
  const staleHit = stale.value.hits.find((hit) => hit.documentId === 'a');
  assert.equal(staleHit.rerankExplanation.status.basisPoints, 2500);
  assert.equal(staleHit.rerankExplanation.status.penaltyUnits, 8_130_618);
  assert.equal(staleHit.adjustedScoreUnits, 24_391_856);
});

test('supports bounded page-local output, including 1000 and empty pages', () => {
  const hits = [];
  const records = [];
  for (let index = 1; index <= 1000; index += 1) {
    const documentId = `d-${String(index).padStart(4, '0')}`;
    hits.push({ documentId, fusedRank: index,
      rawScoreUnits: Math.floor(1_000_000_000 / (60 + index)),
      contributions: [{ source: 'lexical', sourceIdentity: 'lexical-v1', sourceRank: index,
        contributionUnits: Math.floor(1_000_000_000 / (60 + index)) }] });
    records.push(record(documentId));
  }
  const reranker = createRrfBoundedRerankerV1({ verifyEvidencePage: () => true });
  const full = reranker.rerankRrfPageV1({ rawFusion: rawPage(hits), evidencePage: evidence(records),
    policy: RERANK_FIXED_POLICY_V1, outputLimit: 1000 });
  assert.equal(full.ok, true);
  assert.equal(full.value.hits.length, 1000);
  assert.equal(full.value.hits[999].rawHit.rawScoreUnits, 943_396);
  assert.deepEqual(reranker.rerankRrfPageV1({ rawFusion: rawPage(hits), evidencePage: evidence(records),
    policy: RERANK_FIXED_POLICY_V1, outputLimit: 1001 }), expectedError('invalid_output_limit'));
  const empty = reranker.rerankRrfPageV1({ rawFusion: rawPage([]), evidencePage: evidence([]),
    policy: RERANK_FIXED_POLICY_V1, outputLimit: 1 });
  assert.equal(empty.ok, true);
  assert.deepEqual(empty.value.hits, []);
  assert.equal(empty.value.identity.outputLimit, 1);
  const omittedEmpty = reranker.rerankRrfPageV1({ rawFusion: rawPage([]), evidencePage: evidence([]),
    policy: RERANK_FIXED_POLICY_V1 });
  assert.equal(omittedEmpty.ok, true);
  assert.deepEqual(omittedEmpty.value.hits, []);
  assert.equal(omittedEmpty.value.identity.outputLimit, 0);
});

test('rejects hostile descriptors without invoking getters and preserves rawHit immutability', () => {
  let calls = 0;
  const hostile = request();
  Object.defineProperty(hostile.evidencePage.records[0], 'status', {
    enumerable: true, get() { calls += 1; return { value: 'active', evidenceUid: 'x' }; },
  });
  const reranker = createRrfBoundedRerankerV1({ verifyEvidencePage: () => true });
  assert.deepEqual(reranker.rerankRrfPageV1(hostile), expectedError('invalid_evidence_page'));
  assert.equal(calls, 0);
  const good = request();
  const result = reranker.rerankRrfPageV1(good);
  assert.equal(result.value.hits[0].rawHit, good.rawFusion.hits[0]);
  assert.equal(Object.isFrozen(result.value.hits[0].rawHit), true);
  assert.deepEqual(result.value.identity, {
    ...good.rawFusion.identity,
    rerankContractVersion: 'rrf-bounded-rerank-v1',
    policyVersion: 'spipe-rerank-policy-v1',
    graphSnapshotId: 'graph-a', graphPolicyVersion: 1, recencyEpochDay: 1000,
    authorityReceiptUid: 'authority-a', rawFusionDigest: RAW_FUSION_DIGEST,
    evidenceDigest: EVIDENCE_DIGEST, outputLimit: 2,
  });
  function assertDeepFrozen(value) {
    if (value === null || typeof value !== 'object') return;
    assert.equal(Object.isFrozen(value), true);
    for (const child of Object.values(value)) assertDeepFrozen(child);
  }
  assertDeepFrozen(result);
});

test('rejects independently mutable raw identity, context, source, hit, and contribution layers', () => {
  function freezeExcept(value, excluded) {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
      for (const child of Object.values(value)) freezeExcept(child, excluded);
      if (value !== excluded) Object.freeze(value);
    }
    return value;
  }
  const paths = [
    (raw) => raw.identity,
    (raw) => raw.identity.context,
    (raw) => raw.identity.orderedSources,
    (raw) => raw.identity.orderedSources[0],
    (raw) => raw.hits,
    (raw) => raw.hits[0],
    (raw) => raw.hits[0].contributions,
    (raw) => raw.hits[0].contributions[0],
  ];
  const reranker = createRrfBoundedRerankerV1({ verifyEvidencePage: () => true });
  for (const select of paths) {
    const raw = structuredClone(rawPage());
    freezeExcept(raw, select(raw));
    assert.equal(Object.isFrozen(select(raw)), false);
    const result = reranker.rerankRrfPageV1(request({ rawFusion: raw }));
    assert.equal(result.ok, false);
    assert.ok(['invalid_raw_identity', 'invalid_raw_hit_page'].includes(result.error.code));
  }
});

test('exports the additive complete-pool reranker v2 contract', () => {
  assert.equal(RERANK_CONTRACT_V2, 'rrf-bounded-rerank-v2');
  assert.equal(MAX_POOL_HITS_V2, 3000);
  assert.equal(MAX_OUTPUT_HITS_V2, 1000);
  assert.throws(() => createRrfBoundedRerankerV2(), TypeError);
  assert.throws(() => createRrfBoundedRerankerV2({ verifyEvidencePage: false }), TypeError);
});

test('reranks the full 2000-hit pool before public truncation and admits late promotion', () => {
  const lexicalIds = Array.from(
    { length: 1000 }, (_, index) => `l${String(index + 1).padStart(4, '0')}`,
  );
  const graphIds = Array.from(
    { length: 1000 }, (_, index) => `g${String(index + 1).padStart(4, '0')}`,
  );
  const raw = rawPoolV2([sourceV2('lexical', lexicalIds), sourceV2('graph', graphIds)]);
  assert.equal(raw.hits[1000].documentId, 'g0501');
  assert.equal(raw.hits[1000].fusedRank, 1001);
  assert.equal(raw.hits[1000].rawScoreUnits, 1_782_531);
  const records = raw.hits.map((hit) => hit.documentId === 'g0501'
    ? record(hit.documentId, {
      acceptedTrace: {
        distance: 1, evidenceEdgeUids: ['edge-g0501'], authorityReceiptUids: ['receipt-g0501'],
      },
      featureMatch: {
        matched: true, queryClassificationUids: ['feature-query'],
        artifactClassificationUids: ['feature-artifact'], evidenceEdgeUids: ['feature-edge'],
      },
      componentMatch: {
        matched: true, queryClassificationUids: ['component-query'],
        artifactClassificationUids: ['component-artifact'], evidenceEdgeUids: ['component-edge'],
      },
      recency: { documentRevisionEpochDay: 993, evidenceUid: 'recent-g0501' },
    })
    : record(hit.documentId));
  let authorityCalls = 0;
  const result = createRrfBoundedRerankerV2({ verifyEvidencePage(value) {
    authorityCalls += 1;
    return value.rawFusion === raw
      && value.evidencePage.identity.rawFusionDigest === raw.identity.rawFusionDigest;
  } }).rerankRrfCompletePoolV2({
    rawFusion: raw,
    evidencePage: evidenceV2(raw, records),
    policy: RERANK_FIXED_POLICY_V1,
    outputLimit: 1000,
  });
  assert.equal(result.ok, true);
  assert.equal(authorityCalls, 1);
  assert.equal(result.value.identity.internalPoolCount, 2000);
  assert.equal(result.value.hits.length, 1000);
  const promoted = result.value.hits.find((hit) => hit.documentId === 'g0501');
  assert.equal(promoted.adjustedScoreUnits, 2_192_512);
  assert.equal(promoted.rerankExplanation.acceptedTrace.deltaUnits, 178_253);
  assert.equal(promoted.rerankExplanation.featureMatch.deltaUnits, 71_301);
  assert.equal(promoted.rerankExplanation.componentMatch.deltaUnits, 71_301);
  assert.equal(promoted.rerankExplanation.recency.deltaUnits, 89_126);
  assert.equal(promoted.finalRank, 793);
});

test('accepts 3000 complete raw hits and rejects a 3001-hit structural forgery', () => {
  const lexical = Array.from({ length: 1000 }, (_, index) => `l-${String(index).padStart(4, '0')}`);
  const graph = Array.from({ length: 1000 }, (_, index) => `g-${String(index).padStart(4, '0')}`);
  const semantic = Array.from({ length: 1000 }, (_, index) => `s-${String(index).padStart(4, '0')}`);
  const raw = rawPoolV2([
    sourceV2('lexical', lexical), sourceV2('graph', graph), sourceV2('semantic', semantic),
  ]);
  const records = raw.hits.map((hit) => record(hit.documentId));
  const reranker = createRrfBoundedRerankerV2({ verifyEvidencePage: () => true });
  const accepted = reranker.rerankRrfCompletePoolV2({
    rawFusion: raw,
    evidencePage: evidenceV2(raw, records),
    policy: RERANK_FIXED_POLICY_V1,
    outputLimit: 1,
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.value.identity.internalPoolCount, 3000);

  const forged = structuredClone(raw);
  forged.identity.uniqueDocumentCount = 3001;
  forged.hits.push(structuredClone(forged.hits[forged.hits.length - 1]));
  deepFreeze(forged);
  assert.deepEqual(reranker.rerankRrfCompletePoolV2({
    rawFusion: forged,
    evidencePage: evidenceV2(raw, records),
    policy: RERANK_FIXED_POLICY_V1,
    outputLimit: 1,
  }), expectedError('invalid_raw_identity'));
});

test('fails closed on incomplete, count, source, raw, and evidence digest mismatches', () => {
  const raw = rawPoolV2([sourceV2('lexical', ['a']), sourceV2('graph', ['b'])]);
  const records = raw.hits.map((hit) => record(hit.documentId));
  const reranker = createRrfBoundedRerankerV2({ verifyEvidencePage: () => true });
  const run = (rawFusion, evidencePage = evidenceV2(rawFusion, records)) => reranker
    .rerankRrfCompletePoolV2({
      rawFusion, evidencePage, policy: RERANK_FIXED_POLICY_V1, outputLimit: 1,
    });

  const incomplete = structuredClone(raw);
  incomplete.identity.complete = false;
  deepFreeze(incomplete);
  assert.deepEqual(run(incomplete), expectedError('incomplete_raw_pool'));

  const wrongCount = structuredClone(raw);
  wrongCount.identity.uniqueDocumentCount = 1;
  deepFreeze(wrongCount);
  assert.deepEqual(run(wrongCount), expectedError('raw_pool_count_mismatch'));

  const wrongCandidateDigest = structuredClone(raw);
  wrongCandidateDigest.identity.orderedSources[0].candidateDigest = `sha256:${'0'.repeat(64)}`;
  deepFreeze(wrongCandidateDigest);
  assert.deepEqual(run(wrongCandidateDigest), expectedError('raw_fusion_digest_mismatch'));

  const wrongRawDigest = structuredClone(raw);
  wrongRawDigest.identity.rawFusionDigest = `sha256:${'0'.repeat(64)}`;
  deepFreeze(wrongRawDigest);
  assert.deepEqual(run(wrongRawDigest), expectedError('raw_fusion_digest_mismatch'));

  assert.deepEqual(run(raw, evidenceV2(raw, records, {
    rawFusionDigest: `sha256:${'0'.repeat(64)}`,
  })), expectedError('raw_fusion_digest_mismatch'));
});

test('requires public output limit 1..1000 and treats an empty complete pool as zero output', () => {
  const raw = rawPoolV2([sourceV2('lexical', []), sourceV2('graph', [])]);
  const page = evidenceV2(raw, []);
  const reranker = createRrfBoundedRerankerV2({ verifyEvidencePage: () => true });
  const make = (outputLimit) => ({
    rawFusion: raw, evidencePage: page, policy: RERANK_FIXED_POLICY_V1, outputLimit,
  });
  assert.deepEqual(reranker.rerankRrfCompletePoolV2(make(0)), expectedError('invalid_output_limit'));
  assert.deepEqual(reranker.rerankRrfCompletePoolV2(make(1001)), expectedError('invalid_output_limit'));
  const accepted = reranker.rerankRrfCompletePoolV2(make(1));
  assert.equal(accepted.ok, true);
  assert.equal(accepted.value.identity.internalPoolCount, 0);
  assert.equal(accepted.value.identity.outputLimit, 1);
  assert.deepEqual(accepted.value.hits, []);
});
