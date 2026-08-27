import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  RRF_CONTRACT_V1,
  RRF_SCALE_V1,
  RRF_DEFAULT_K_V1,
  RRF_DEFAULT_SOURCE_K_V1,
  RRF_DEFAULT_LIMIT_V1,
  RRF_MAX_SOURCES_V1,
  RRF_MAX_DOC_ID_BYTES_V1,
  RRF_POOL_CONTRACT_V2,
  RRF_ARITHMETIC_CONTRACT_V2,
  RRF_MAX_SOURCE_K_V2,
  RRF_MAX_POOL_HITS_V2,
  RRF_MAX_PUBLIC_HITS_V2,
  unsignedUtf8CompareV1,
  fuseRrfRawV1,
  fuseRrfCompletePoolV2,
} from '../../../src/search/fusion.js';
import { canonicalJson } from '../../../src/storage/canonical.js';

function context(overrides = {}) {
  return {
    workspaceId: 'workspace-a',
    snapshotId: 'snapshot-a',
    authorizationScopeDigest: 'scope-a',
    queryReceipt: 'receipt-a',
    analyzerIdentity: 'analyzer-a',
    ...overrides,
  };
}

function source(name, ids, sourceIdentity = `${name}-v1`) {
  return { name, sourceIdentity, candidates: ids.map((documentId) => ({ documentId })) };
}

function request(overrides = {}) {
  return {
    context: context(),
    k: 60,
    sourceK: 1000,
    limit: 1000,
    sources: [source('lexical', ['a', 'b']), source('graph', ['b', 'a'])],
    ...overrides,
  };
}

function expected(code, details = {}) {
  return { ok: false, error: { code, ...details } };
}

function digestV2(domain, value) {
  return `sha256:${createHash('sha256').update(domain, 'utf8')
    .update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function sourceV2(name, ids, overrides = {}) {
  const sourceIdentity = overrides.sourceIdentity ?? `${name}-v2`;
  const candidateDigest = digestV2('spipe-rrf-source-pool-v1\0', {
    name, sourceIdentity, documentIds: ids,
  });
  return {
    name,
    sourceIdentity,
    complete: true,
    candidateCount: ids.length,
    candidateDigest,
    candidates: ids.map((documentId) => ({ documentId })),
    ...overrides,
  };
}

function requestV2(overrides = {}) {
  return {
    context: context(),
    k: 60,
    sourceK: 1000,
    sources: [sourceV2('lexical', ['a', 'b']), sourceV2('graph', ['b', 'a'])],
    ...overrides,
  };
}

test('exports the frozen raw-only contract constants and defaults', () => {
  assert.equal(RRF_CONTRACT_V1, 'rrf-fixed-v1');
  assert.equal(RRF_SCALE_V1, 1_000_000_000);
  assert.equal(RRF_DEFAULT_K_V1, 60);
  assert.equal(RRF_DEFAULT_SOURCE_K_V1, 1000);
  assert.equal(RRF_DEFAULT_LIMIT_V1, 1000);
  assert.equal(RRF_MAX_SOURCES_V1, 3);
  assert.equal(RRF_MAX_DOC_ID_BYTES_V1, 512);

  const omitted = request();
  delete omitted.k;
  delete omitted.sourceK;
  delete omitted.limit;
  const result = fuseRrfRawV1(omitted);
  assert.equal(result.ok, true);
  assert.equal(result.value.identity.k, 60);
  assert.equal(result.value.identity.sourceK, 1000);
  assert.equal(result.value.hits.length, 2);

  const lexicalIds = Array.from({ length: 1000 }, (_, index) => `l-${index}`);
  const graphIds = Array.from({ length: 1000 }, (_, index) => `g-${index}`);
  const defaultLimit = request({
    sources: [source('lexical', lexicalIds), source('graph', graphIds)],
  });
  delete defaultLimit.limit;
  assert.equal(fuseRrfRawV1(defaultLimit).value.hits.length, 1000);
});

test('fuses fixed-point ranks with independent totals and complete explanations', () => {
  const result = fuseRrfRawV1(request());
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.identity, {
    contractVersion: 'rrf-fixed-v1',
    k: 60,
    sourceK: 1000,
    orderedSources: [
      { name: 'lexical', sourceIdentity: 'lexical-v1' },
      { name: 'graph', sourceIdentity: 'graph-v1' },
    ],
    context: context(),
  });
  assert.deepEqual(result.value.hits, [
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
  ]);
});

test('semantic is optional and contribution rendering stays canonical', () => {
  const two = fuseRrfRawV1(request());
  assert.equal(two.ok, true);
  const three = fuseRrfRawV1(request({
    sources: [source('lexical', ['a']), source('graph', ['a']), source('semantic', ['a'])],
  }));
  assert.equal(three.ok, true);
  assert.equal(three.value.hits[0].rawScoreUnits, 49_180_326);
  assert.deepEqual(three.value.hits[0].contributions.map((item) => item.source), [
    'lexical', 'graph', 'semantic',
  ]);
});

test('validates the complete page before sourceK and applies limit after merge', () => {
  const duplicated = source('lexical', ['first', 'ignored', 'ignored']);
  assert.deepEqual(fuseRrfRawV1(request({
    sourceK: 1, sources: [duplicated, source('graph', [])],
  })), expected('duplicate_document_id', { source: 'lexical', candidateIndex: 2 }));

  const result = fuseRrfRawV1(request({
    sourceK: 1,
    limit: 1,
    sources: [source('lexical', ['z', 'ignored']), source('graph', ['a', 'ignored-2'])],
  }));
  assert.deepEqual(result.value.hits, [{
    documentId: 'a', fusedRank: 1, rawScoreUnits: 16_393_442,
    contributions: [{
      source: 'graph', sourceIdentity: 'graph-v1', sourceRank: 1, contributionUnits: 16_393_442,
    }],
  }]);
});

test('uses unsigned UTF-8 ordering and rejects invalid comparator operands', () => {
  const result = fuseRrfRawV1(request({
    sources: [source('lexical', ['é', 'z']), source('graph', ['z', 'é'])],
  }));
  assert.deepEqual(result.value.hits.map((hit) => hit.documentId), ['z', 'é']);
  assert.ok(unsignedUtf8CompareV1('z', 'é') < 0);
  assert.ok(unsignedUtf8CompareV1('é', '𐀀') < 0);
  assert.throws(() => unsignedUtf8CompareV1(1, 'a'), /invalid_utf8_string/);
  assert.throws(() => unsignedUtf8CompareV1('a', 1), /invalid_utf8_string/);
  assert.throws(() => unsignedUtf8CompareV1('\ud800', 'a'), /invalid_utf8_string/);
  assert.throws(() => unsignedUtf8CompareV1('a', '\udc00'), /invalid_utf8_string/);
});

test('enforces Unicode scalar and UTF-8 byte limits', () => {
  assert.deepEqual(fuseRrfRawV1(request({
    sources: [source('lexical', ['\ud800']), source('graph', [])],
  })), expected('invalid_document_id', { source: 'lexical', candidateIndex: 0 }));
  const boundary = 'é'.repeat(256);
  assert.equal(fuseRrfRawV1(request({
    sources: [source('lexical', [boundary]), source('graph', [])],
  })).ok, true);
  assert.deepEqual(fuseRrfRawV1(request({
    sources: [source('lexical', [`${boundary}a`]), source('graph', [])],
  })), expected('document_id_too_large', { source: 'lexical', candidateIndex: 0 }));
});

test('normalizes caller data once and returns immutable plain results', () => {
  const input = request();
  const result = fuseRrfRawV1(input);
  input.context.workspaceId = 'mutated';
  input.sources[0].sourceIdentity = 'mutated';
  input.sources[0].candidates[0].documentId = 'mutated';
  assert.equal(result.value.identity.context.workspaceId, 'workspace-a');
  assert.equal(result.value.identity.orderedSources[0].sourceIdentity, 'lexical-v1');
  assert.equal(result.value.hits[0].documentId, 'a');
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.value.identity.context), true);
  assert.equal(Object.isFrozen(result.value.hits[0].contributions), true);
});

test('enforces phase error precedence from root through candidate validation', () => {
  assert.deepEqual(fuseRrfRawV1(null), expected('invalid_request'));
  assert.deepEqual(fuseRrfRawV1({ extra: true }), expected('invalid_request'));
  assert.deepEqual(fuseRrfRawV1({ context: {}, k: 0, sourceK: 0, limit: 0, sources: [] }),
    expected('invalid_context', { field: 'workspaceId' }));
  assert.deepEqual(fuseRrfRawV1(request({ k: 0, sourceK: 0, limit: 0, sources: [] })),
    expected('invalid_k'));
  assert.deepEqual(fuseRrfRawV1(request({ sourceK: 0, limit: 0, sources: [] })),
    expected('invalid_source_k'));
  assert.deepEqual(fuseRrfRawV1(request({ limit: 0, sources: [] })), expected('invalid_limit'));
  assert.deepEqual(fuseRrfRawV1(request({ sources: [] })), expected('invalid_sources'));
  assert.deepEqual(fuseRrfRawV1(request({
    sources: [source('graph', []), source('semantic', [])],
  })), expected('missing_required_source', { source: 'lexical' }));
  assert.deepEqual(fuseRrfRawV1(request({
    sources: [source('lexical', []), source('semantic', [])],
  })), expected('missing_required_source', { source: 'graph' }));
  assert.deepEqual(fuseRrfRawV1(request({
    sources: [source('graph', []), source('lexical', [])],
  })), expected('invalid_source_order', { source: 'lexical' }));
  assert.deepEqual(fuseRrfRawV1(request({
    sources: [source('lexical', []), source('graph', []), source('graph', [])],
  })), expected('duplicate_source'));
});

test('rejects every invalid numeric shape and accepts exact boundaries', () => {
  const invalidNumbers = [
    NaN, Infinity, -Infinity, 1.5, -1.5, Number.MAX_SAFE_INTEGER + 1,
    Number.MIN_SAFE_INTEGER - 1, '60', null,
  ];
  for (const value of invalidNumbers) {
    assert.deepEqual(fuseRrfRawV1(request({ k: value })), expected('invalid_k'));
    assert.deepEqual(fuseRrfRawV1(request({ sourceK: value })), expected('invalid_source_k'));
    assert.deepEqual(fuseRrfRawV1(request({ limit: value })), expected('invalid_limit'));
  }
  for (const value of [0, 10_001]) {
    assert.deepEqual(fuseRrfRawV1(request({ k: value })), expected('invalid_k'));
  }
  for (const [field, value, code] of [
    ['sourceK', 0, 'invalid_source_k'], ['sourceK', 1001, 'invalid_source_k'],
    ['limit', 0, 'invalid_limit'], ['limit', 1001, 'invalid_limit'],
  ]) assert.deepEqual(fuseRrfRawV1(request({ [field]: value })), expected(code));
  assert.equal(fuseRrfRawV1(request({ k: 1, sourceK: 1, limit: 1 })).ok, true);
  assert.equal(fuseRrfRawV1(request({ k: 10_000, sourceK: 1000, limit: 1000 })).ok, true);
});

test('enforces source identity, candidate page, and closed schemas', () => {
  for (const value of ['', undefined, null, 1, '\ud800', 'é'.repeat(257)]) {
    const badIdentity = source('lexical', []);
    badIdentity.sourceIdentity = value;
    assert.deepEqual(fuseRrfRawV1(request({
      sources: [badIdentity, source('graph', [])],
    })), expected('invalid_source_identity', { source: 'lexical' }));
  }
  const exactIdentity = source('lexical', [], 'é'.repeat(256));
  assert.equal(fuseRrfRawV1(request({
    sources: [exactIdentity, source('graph', [])],
  })).ok, true);

  const tooMany = Array.from({ length: 1001 }, (_, index) => `d-${index}`);
  assert.deepEqual(fuseRrfRawV1(request({
    sources: [source('lexical', tooMany), source('graph', [])],
  })), expected('too_many_candidates', { source: 'lexical' }));

  const extra = source('lexical', ['a']);
  extra.candidates[0].score = 1;
  assert.deepEqual(fuseRrfRawV1(request({
    sources: [extra, source('graph', [])],
  })), expected('invalid_candidate', { source: 'lexical', candidateIndex: 0 }));
});

test('rejects accessors, hidden, symbol, sparse, and unknown fields without throwing', () => {
  let getterCalls = 0;
  const accessor = request();
  Object.defineProperty(accessor.context, 'workspaceId', {
    enumerable: true,
    get() { getterCalls += 1; return 'workspace-a'; },
  });
  assert.deepEqual(fuseRrfRawV1(accessor), expected('invalid_context', { field: 'workspaceId' }));
  assert.equal(getterCalls, 0);

  const undefinedAccessor = request();
  Object.defineProperty(undefinedAccessor, 'k', {
    enumerable: true, get: undefined, set: undefined,
  });
  assert.deepEqual(fuseRrfRawV1(undefinedAccessor), expected('invalid_request'));

  const undefinedIndexAccessor = request();
  Object.defineProperty(undefinedIndexAccessor.sources[0].candidates, '0', {
    enumerable: true, get: undefined, set: undefined,
  });
  assert.deepEqual(fuseRrfRawV1(undefinedIndexAccessor),
    expected('invalid_candidate_page', { source: 'lexical' }));

  const hidden = request();
  Object.defineProperty(hidden, 'hidden', { value: true, enumerable: false });
  assert.deepEqual(fuseRrfRawV1(hidden), expected('invalid_request'));
  const symbol = request();
  symbol[Symbol('hidden')] = true;
  assert.deepEqual(fuseRrfRawV1(symbol), expected('invalid_request'));

  const sparse = request();
  sparse.sources[0].candidates = new Array(1);
  assert.deepEqual(fuseRrfRawV1(sparse), expected('invalid_candidate_page', { source: 'lexical' }));
  const unknownSource = request();
  unknownSource.sources[0].unknown = true;
  assert.deepEqual(fuseRrfRawV1(unknownSource), expected('invalid_source_identity', { source: undefined }));
});

test('hostile traps fail closed and stateful descriptors are read only once', () => {
  const root = new Proxy({}, { ownKeys() { throw new Error('hostile'); } });
  assert.doesNotThrow(() => fuseRrfRawV1(root));
  assert.deepEqual(fuseRrfRawV1(root), expected('invalid_request'));

  const candidate = request();
  candidate.sources[0].candidates[0] = new Proxy({ documentId: 'a' }, {
    getOwnPropertyDescriptor() { throw new Error('hostile'); },
  });
  assert.deepEqual(fuseRrfRawV1(candidate),
    expected('invalid_candidate', { source: 'lexical', candidateIndex: 0 }));

  let documentDescriptorReads = 0;
  const stateful = request();
  stateful.sources[0].candidates[0] = new Proxy({ documentId: 'a' }, {
    getOwnPropertyDescriptor(target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
      if (property !== 'documentId') return descriptor;
      documentDescriptorReads += 1;
      return { ...descriptor, value: documentDescriptorReads === 1 ? 'a' : 'changed' };
    },
  });
  const result = fuseRrfRawV1(stateful);
  assert.equal(result.ok, true);
  assert.equal(documentDescriptorReads, 1);
  assert.equal(result.value.hits.some((hit) => hit.documentId === 'a'), true);
  assert.equal(result.value.hits.some((hit) => hit.documentId === 'changed'), false);
});

test('rejects source-identity schema hazards without retaining caller objects in failures', () => {
  const cases = [];
  const accessor = source('lexical', []);
  Object.defineProperty(accessor, 'sourceIdentity', { enumerable: true, get() { return 'x'; } });
  cases.push(accessor);
  const hidden = source('lexical', []);
  Object.defineProperty(hidden, 'hidden', { value: true });
  cases.push(hidden);
  const symbol = source('lexical', []);
  symbol[Symbol('hidden')] = true;
  cases.push(symbol);
  const trapped = new Proxy(source('lexical', []), { ownKeys() { throw new Error('hostile'); } });
  cases.push(trapped);
  for (const lexical of cases) {
    const result = fuseRrfRawV1(request({ sources: [lexical, source('graph', [])] }));
    assert.deepEqual(result, expected('invalid_source_identity', { source: undefined }));
    assert.equal(Object.isFrozen(result.error), true);
  }
  const hostileName = source('lexical', []);
  hostileName.name = { private: true };
  const failure = fuseRrfRawV1(request({ sources: [hostileName, source('graph', [])] }));
  assert.deepEqual(failure, expected('invalid_source_identity', { source: undefined }));
  assert.notEqual(failure.error.source, hostileName.name);
});

test('maps hostile containers to their exact validation phase', () => {
  const hostile = () => new Proxy({}, { ownKeys() { throw new Error('hostile'); } });
  const revoked = () => {
    const pair = Proxy.revocable({}, {});
    pair.revoke();
    return pair.proxy;
  };

  for (const badContext of [hostile(), revoked()]) {
    assert.deepEqual(fuseRrfRawV1(request({ context: badContext })),
      expected('invalid_context', { field: 'workspaceId' }));
  }
  for (const badSources of [hostile(), revoked()]) {
    assert.deepEqual(fuseRrfRawV1(request({ sources: badSources })), expected('invalid_sources'));
  }
  for (const badSource of [hostile(), revoked()]) {
    assert.deepEqual(fuseRrfRawV1(request({ sources: [badSource, source('graph', [])] })),
      expected('invalid_source_identity', { source: undefined }));
  }
  for (const badCandidates of [hostile(), revoked()]) {
    const lexical = source('lexical', []);
    lexical.candidates = badCandidates;
    assert.deepEqual(fuseRrfRawV1(request({ sources: [lexical, source('graph', [])] })),
      expected('invalid_candidate_page', { source: 'lexical' }));
  }
  for (const badCandidate of [hostile(), revoked()]) {
    const lexical = source('lexical', []);
    lexical.candidates = [badCandidate];
    assert.deepEqual(fuseRrfRawV1(request({ sources: [lexical, source('graph', [])] })),
      expected('invalid_candidate', { source: 'lexical', candidateIndex: 0 }));
  }
});

test('preserves complete source-to-candidate error precedence', () => {
  assert.deepEqual(fuseRrfRawV1(request({ sources: [{}, source('semantic', [])] })),
    expected('invalid_source_identity', { source: undefined }));
  assert.deepEqual(fuseRrfRawV1(request({
    sources: [source('graph', []), source('semantic', []), source('lexical', [])],
  })), expected('invalid_source_order', { source: 'lexical' }));

  const badDuplicateIdentity = source('graph', []);
  badDuplicateIdentity.sourceIdentity = '';
  assert.deepEqual(fuseRrfRawV1(request({
    sources: [source('lexical', []), source('graph', []), badDuplicateIdentity],
  })), expected('duplicate_source'));

  const badIdentityAndPage = source('lexical', []);
  badIdentityAndPage.sourceIdentity = '';
  badIdentityAndPage.candidates = {};
  assert.deepEqual(fuseRrfRawV1(request({
    sources: [badIdentityAndPage, source('graph', [])],
  })), expected('invalid_source_identity', { source: 'lexical' }));

  const badPageAndCount = source('lexical', []);
  badPageAndCount.candidates = Array.from({ length: 1001 }, () => ({ documentId: 'x' }));
  badPageAndCount.candidates.extra = true;
  assert.deepEqual(fuseRrfRawV1(request({
    sources: [badPageAndCount, source('graph', [])],
  })), expected('invalid_candidate_page', { source: 'lexical' }));

  const badCountAndCandidate = source('lexical', []);
  badCountAndCandidate.candidates = Array.from({ length: 1001 }, () => ({}));
  assert.deepEqual(fuseRrfRawV1(request({
    sources: [badCountAndCandidate, source('graph', [])],
  })), expected('too_many_candidates', { source: 'lexical' }));

  const badCandidateAndId = source('lexical', ['']);
  badCandidateAndId.candidates[0].extra = true;
  assert.deepEqual(fuseRrfRawV1(request({
    sources: [badCandidateAndId, source('graph', [])],
  })), expected('invalid_candidate', { source: 'lexical', candidateIndex: 0 }));

  const badIdAndLaterSize = source('lexical', ['', 'é'.repeat(257)]);
  assert.deepEqual(fuseRrfRawV1(request({
    sources: [badIdAndLaterSize, source('graph', [])],
  })), expected('invalid_document_id', { source: 'lexical', candidateIndex: 0 }));

  const badSizeAndLaterDuplicate = source('lexical', ['é'.repeat(257), 'x', 'x']);
  assert.deepEqual(fuseRrfRawV1(request({
    sources: [badSizeAndLaterDuplicate, source('graph', [])],
  })), expected('document_id_too_large', { source: 'lexical', candidateIndex: 0 }));
});

test('rank 1000 uses the frozen integer-floor contribution', () => {
  const ids = Array.from({ length: 1000 }, (_, index) => `id-${String(index).padStart(4, '0')}`);
  const result = fuseRrfRawV1(request({
    sources: [source('lexical', ids), source('graph', [])],
  }));
  assert.equal(result.ok, true);
  const last = result.value.hits.find((hit) => hit.documentId === 'id-0999');
  assert.equal(last.rawScoreUnits, 943_396);
  assert.equal(last.contributions[0].sourceRank, 1000);
});

test('exports the additive complete-pool v2 contract and hardcoded digest vector', () => {
  assert.equal(RRF_POOL_CONTRACT_V2, 'rrf-complete-pool-v2');
  assert.equal(RRF_ARITHMETIC_CONTRACT_V2, RRF_CONTRACT_V1);
  assert.equal(RRF_MAX_SOURCE_K_V2, 1000);
  assert.equal(RRF_MAX_POOL_HITS_V2, 3000);
  assert.equal(RRF_MAX_PUBLIC_HITS_V2, 1000);
  assert.deepEqual(fuseRrfCompletePoolV2({ ...requestV2(), limit: 1 }),
    expected('invalid_request'));

  const result = fuseRrfCompletePoolV2(requestV2());
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.hits.map((hit) => hit.documentId), ['a', 'b']);
  assert.equal(result.value.identity.complete, true);
  assert.equal(result.value.identity.uniqueDocumentCount, 2);
  assert.equal(result.value.identity.orderedSources[0].candidateDigest,
    'sha256:f104ad2ba95dbb29d6e7fbccf47ce6a3c9d1a807db73a1aba3449161036dc0ac');
  assert.equal(result.value.identity.sourcePoolDigest,
    'sha256:555425d77a1822bc6f71c1f4fc7690c36d0347000080b6152e18e7dc222b36d5');
  assert.equal(result.value.identity.rawFusionDigest,
    'sha256:98b99df52621b61914291b34c7b0a6f95f94865a40babf43506d97bb19b84838');
});

test('returns the complete unique union through the 3000-hit boundary', () => {
  const lexical = Array.from({ length: 1000 }, (_, index) => `l-${String(index).padStart(4, '0')}`);
  const graph = Array.from({ length: 1000 }, (_, index) => `g-${String(index).padStart(4, '0')}`);
  const semantic = Array.from({ length: 1000 }, (_, index) => `s-${String(index).padStart(4, '0')}`);
  const result = fuseRrfCompletePoolV2(requestV2({
    sources: [sourceV2('lexical', lexical), sourceV2('graph', graph), sourceV2('semantic', semantic)],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.value.hits.length, 3000);
  assert.equal(result.value.identity.uniqueDocumentCount, 3000);
  assert.equal(new Set(result.value.hits.map((hit) => hit.documentId)).size, 3000);
  assert.equal(result.value.hits[0].rawScoreUnits, 16_393_442);
  assert.equal(result.value.hits[2999].rawScoreUnits, 943_396);
});

test('enforces complete source envelopes and frozen v2 error precedence', () => {
  const incomplete = sourceV2('lexical', ['bad'], { complete: false, candidateCount: 'bad' });
  assert.deepEqual(fuseRrfCompletePoolV2(requestV2({
    sources: [incomplete, sourceV2('graph', [])],
  })), expected('incomplete_source_page', { source: 'lexical' }));

  const badCount = sourceV2('lexical', ['bad'], { candidateCount: 2, candidateDigest: 'bad' });
  badCount.candidates[0].documentId = '';
  assert.deepEqual(fuseRrfCompletePoolV2(requestV2({
    sources: [badCount, sourceV2('graph', [])],
  })), expected('invalid_candidate_count', { source: 'lexical' }));

  const tooMany = sourceV2('lexical', ['a', 'b']);
  assert.deepEqual(fuseRrfCompletePoolV2(requestV2({
    sourceK: 1, sources: [tooMany, sourceV2('graph', [])],
  })), expected('too_many_candidates', { source: 'lexical' }));

  const badCandidate = sourceV2('lexical', ['a'], { candidateDigest: 'bad' });
  badCandidate.candidates[0].documentId = '';
  assert.deepEqual(fuseRrfCompletePoolV2(requestV2({
    sources: [badCandidate, sourceV2('graph', [])],
  })), expected('invalid_document_id', { source: 'lexical', candidateIndex: 0 }));

  const badDigest = sourceV2('lexical', ['a'], { candidateDigest: `sha256:${'0'.repeat(64)}` });
  assert.deepEqual(fuseRrfCompletePoolV2(requestV2({
    sources: [badDigest, sourceV2('graph', [])],
  })), expected('candidate_digest_mismatch', { source: 'lexical' }));
});

test('supports a digest-bound empty complete pool without inventing public truncation', () => {
  const result = fuseRrfCompletePoolV2(requestV2({
    sources: [sourceV2('lexical', []), sourceV2('graph', [])],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.value.identity.uniqueDocumentCount, 0);
  assert.deepEqual(result.value.hits, []);
  assert.equal(Object.isFrozen(result.value.identity.orderedSources), true);
  assert.equal(Object.isFrozen(result.value.hits), true);
});
