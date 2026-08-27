import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  LEXICAL_SOURCE_CONTRACT_V1,
  createAuthorizedLexicalSourceV1,
} from '../../src/search/lexical_source.js';
import { fuseRrfCompletePoolV2 } from '../../src/search/fusion.js';

const H0 = `sha256:${'0'.repeat(64)}`;
const H1 = `sha256:${'1'.repeat(64)}`;
const H2 = `sha256:${'2'.repeat(64)}`;
const ID = Object.freeze({
  workspace: `WS-${'A'.repeat(32)}`,
  project: `P-${'B'.repeat(32)}`,
  worktree: `WT-${'C'.repeat(32)}`,
  receipt: `D-${'D'.repeat(32)}`,
  authority: `D-${'E'.repeat(32)}`,
});
const ONE_PAGE_ORACLE = Object.freeze({
  queryDigest: 'sha256:18ed2f9de72ac01195e58482abb0055b65a9ef12238147e12a93a05b839df7cd',
  bindingDigest: 'sha256:5e665ed31cf3609eecab286d41ba1ff07c1ff02cb960654c5143505ec5a6dae5',
  nextCursorDigest: 'sha256:50661c660148b269d26e91288c5fc8836b94ebd7ece75ab65bea4643dcf1fd6f',
  pageDigest: 'sha256:d6434887a692e45783c65a45cc61f7962e40ce4dd680cbd998e9e91bd24c3c0d',
  pageSetDigest: 'sha256:51528c6eba5653222f6f50eb8dfe23c7dc604c5e29f85c146be8148e5dcd8bfb',
  rankEvidenceDigest: 'sha256:b149894894d6f277beed0e70f08d19479a4f05843071dabcf210ca1b52e0c1cc',
  sourceIdentity: 'sha256:7877f1f4c60c867a6ea24fa27418ae7477ee1364e566390c8c298ceafc0e9bd9',
  candidateDigest: 'sha256:956bd7eb58ac416587f3f4effe674640fa103621f5ebf23ae4d64800ed0e47f6',
});

function artifact(index) { return `A-${index.toString(16).toUpperCase().padStart(32, '0')}`; }
function receiptUid(index) { return `D-${(index + 100).toString(16).toUpperCase().padStart(32, '0')}`; }
function freeze(value, seen = new Set()) {
  if (value && typeof value === 'object' && !seen.has(value)) {
    seen.add(value);
    for (const child of Object.values(value)) freeze(child, seen);
    Object.freeze(value);
  }
  return value;
}

// Independent restricted spipe-canonical-json-v1 oracle; it does not import production encoding.
function quote(value) {
  let output = '"';
  for (const character of value.normalize('NFC')) {
    const code = character.codePointAt(0);
    if (character === '"') output += '\\"';
    else if (character === '\\') output += '\\\\';
    else if (code <= 0x1f) output += `\\u00${code.toString(16).padStart(2, '0')}`;
    else output += character;
  }
  return `${output}"`;
}
function canonical(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return quote(value);
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
    .map((key) => `${quote(key)}:${canonical(value[key])}`).join(',')}}`;
}
function hash(domain, value) {
  return `sha256:${createHash('sha256').update(domain).update(canonical(value)).digest('hex')}`;
}
function cursorDigest(bindingDigest, cursor) {
  return cursor === null ? null : hash('spipe-authorized-lexical-provider-cursor-v1\0', { bindingDigest, cursor });
}

function request(overrides = {}) {
  const context = {
    workspaceId: ID.workspace,
    snapshotId: `spks1-${'3'.repeat(64)}`,
    authorizationScopeDigest: H0,
    queryReceipt: ID.receipt,
    analyzerIdentity: 'spipe-unicode-lex-v1',
    ...(overrides.context ?? {}),
  };
  const pin = {
    workspaceUid: ID.workspace,
    projectUid: ID.project,
    worktreeUid: ID.worktree,
    revisionId: 'rev-1',
    snapshotId: `spks1-${'3'.repeat(64)}`,
    lexicalRoot: H1,
    authorizationScopeDigest: H0,
    policyHash: H2,
    policyVersion: 7,
    searchReceiptUid: ID.receipt,
    analyzerIdentity: 'spipe-unicode-lex-v1',
    ...(overrides.pin ?? {}),
  };
  return {
    contractVersion: LEXICAL_SOURCE_CONTRACT_V1,
    operation: 'lexical_source',
    query: 'knowledge compiler',
    context,
    pin,
    sourceK: 1000,
    excludedDocumentUid: null,
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => !['context', 'pin'].includes(key))),
  };
}

function sourcePoolDigest(name, sourceIdentity, documentIds) {
  return hash('spipe-rrf-source-pool-v1\0', { name, sourceIdentity, documentIds });
}

function harness(documents, options = {}) {
  const calls = {
    verify: 0, pages: [], returnedPages: [], authorize: [], evidence: 0,
    evidenceInputs: [], receipt: null,
  };
  const implementation = options.providerImplementationDigest ?? `sha256:${'4'.repeat(64)}`;
  const pageSize = options.pageSize ?? 1000;
  const config = {
    verifySearchReceipt(binding) {
      calls.verify += 1;
      if (options.verifyThrows) throw new Error('private receipt detail');
      if (options.verifyResult) return options.verifyResult(binding);
      calls.receipt = binding;
      return binding;
    },
    readLexicalProviderPage(input) {
      calls.pages.push(input);
      if (options.readThrows) throw new Error('private provider path');
      const offset = input.providerCursor === null
        ? 0 : Number(Buffer.from(input.providerCursor, 'base64url').toString('utf8'));
      const filtered = documents.filter((entry) => entry.documentId !== input.excludedDocumentUid);
      const count = Math.min(input.requestedLimit, pageSize, filtered.length - offset);
      const candidates = filtered.slice(offset, offset + count).map((entry, index) => freeze({
        documentId: entry.documentId,
        sourceRank: offset + index + 1,
        sourceScoreMilli: entry.sourceScoreMilli,
      }));
      const nextOffset = offset + candidates.length;
      const exhausted = nextOffset >= filtered.length;
      const nextCursor = exhausted ? null : Buffer.from(String(nextOffset)).toString('base64url');
      const providerIdentity = freeze({
        providerContractVersion: options.providerContractVersion ?? 'spipe-search-provider/1.0',
        providerImplementationDigest: implementation,
        analyzerIdentity: 'spipe-unicode-lex-v1',
        scoreContractVersion: 'bm25-fixed-v1',
      });
      const excludedDocumentUid = input.excludedDocumentUid;
      const exclusionApplied = excludedDocumentUid !== null;
      const providerCursorDigest = cursorDigest(input.bindingDigest, input.providerCursor);
      const nextCursorDigest = cursorDigest(input.bindingDigest, nextCursor);
      const preimage = {
        schema: 'spipe-authorized-lexical-provider-page-v1',
        bindingDigest: input.bindingDigest,
        providerIdentity,
        excludedDocumentUid,
        exclusionApplied,
        providerCursorDigest,
        requestedLimit: input.requestedLimit,
        pageStartRank: offset + 1,
        candidateCount: candidates.length,
        candidates,
        nextCursorDigest,
        exhausted,
      };
      const pageDigest = hash('spipe-authorized-lexical-provider-page-v1\0', preimage);
      const receipt = freeze({
        receiptUid: receiptUid(calls.pages.length),
        kind: 'lexical_page',
        bindingDigest: input.bindingDigest,
        excludedDocumentUid,
        exclusionApplied,
        providerCursorDigest,
        requestedLimit: input.requestedLimit,
        nextCursorDigest,
        pageDigest,
      });
      let page = freeze({ ...preimage, nextCursor, pageDigest, receipt });
      if (options.transformPage) page = options.transformPage(page, calls.pages.length, input);
      calls.returnedPages.push(page);
      return page;
    },
    authorizeArtifactCandidate(input) {
      calls.authorize.push(input);
      if (options.authorize) return options.authorize(input, calls.authorize.length);
      return freeze({
        documentId: input.documentId,
        sourceRank: input.sourceRank,
        authorizationScopeDigest: H0,
        policyHash: H2,
        policyVersion: 7,
        searchReceiptUid: ID.receipt,
        decision: 'allowed',
      });
    },
    verifyLexicalEvidence(input) {
      calls.evidence += 1;
      calls.evidenceInputs.push(input);
      if (options.evidenceThrows) throw new Error('private evidence detail');
      if (options.evidence) return options.evidence(input);
      return freeze({
        bindingDigest: input.bindingDigest,
        pageSetDigest: input.pageSetDigest,
        rankEvidenceDigest: input.rankEvidenceDigest,
        excludedDocumentUid: input.excludedDocumentUid,
        exclusionApplied: input.exclusionApplied,
        authorityReceiptUid: ID.authority,
        decision: 'verified',
      });
    },
  };
  return { producer: createAuthorizedLexicalSourceV1(config), calls };
}

function scored(count, start = 1) {
  return Array.from({ length: count }, (_value, index) => ({
    documentId: artifact(start + index),
    sourceScoreMilli: (count - index) * 100,
  }));
}

test('factory captures an exact capability set and exposes one frozen method', () => {
  assert.throws(() => createAuthorizedLexicalSourceV1(), TypeError);
  assert.throws(() => createAuthorizedLexicalSourceV1({}), TypeError);
  let touched = 0;
  const hostile = {};
  Object.defineProperty(hostile, 'verifySearchReceipt', { enumerable: true, get() { touched += 1; return () => {}; } });
  for (const field of ['readLexicalProviderPage', 'authorizeArtifactCandidate', 'verifyLexicalEvidence']) hostile[field] = () => {};
  assert.throws(() => createAuthorizedLexicalSourceV1(hostile), TypeError);
  assert.equal(touched, 0);
  const h = harness(scored(1));
  assert.deepEqual(Object.keys(h.producer), ['readLexicalSourceV1']);
  assert.equal(Object.isFrozen(h.producer), true);
});

test('one complete authorized page emits the exact RRF-v2 lexical source', () => {
  const h = harness(scored(3));
  const input = request({ sourceK: 2 });
  const result = h.producer.readLexicalSourceV1(input);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.source.candidates, [{ documentId: artifact(1) }, { documentId: artifact(2) }]);
  assert.equal(result.value.source.complete, true);
  assert.equal(result.value.source.candidateCount, 2);
  assert.equal(result.value.source.candidateDigest, sourcePoolDigest(
    'lexical', result.value.source.sourceIdentity, [artifact(1), artifact(2)],
  ));
  assert.deepEqual(result.value.counters, {
    providerPages: 1, providerCandidates: 2, authorizedCandidates: 2, returnedCandidates: 2,
  });
  assert.equal(h.calls.verify, 1);
  assert.equal(h.calls.evidence, 1);
  assert.equal(h.calls.pages[0].receipt, h.calls.receipt);
  assert.equal(h.calls.authorize.every((entry) => entry.receipt === h.calls.receipt), true);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.value.source.candidates[0]), true);

  const returnedPage = h.calls.returnedPages[0];
  assert.equal(returnedPage.nextCursorDigest, ONE_PAGE_ORACLE.nextCursorDigest);
  assert.equal(returnedPage.pageDigest, ONE_PAGE_ORACLE.pageDigest);
  const expectedPageReceipt = {
    receiptUid: `D-${'0'.repeat(30)}65`,
    pageDigest: ONE_PAGE_ORACLE.pageDigest,
    excludedDocumentUid: null,
    exclusionApplied: false,
    providerCursorDigest: null,
    requestedLimit: 2,
    nextCursorDigest: ONE_PAGE_ORACLE.nextCursorDigest,
    pageStartRank: 1,
    candidateCount: 2,
    exhausted: false,
  };
  const evidenceInput = h.calls.evidenceInputs[0];
  assert.deepEqual(evidenceInput.pageReceipts, [expectedPageReceipt]);
  assert.deepEqual(Object.keys(evidenceInput.pageReceipts[0]), Object.keys(expectedPageReceipt));
  const expectedQueryDigest = hash('spipe-authorized-lexical-query-v1\0', {
    query: input.query.normalize('NFC'), context: input.context,
  });
  assert.equal(expectedQueryDigest, ONE_PAGE_ORACLE.queryDigest);
  const expectedBinding = {
    contractVersion: LEXICAL_SOURCE_CONTRACT_V1,
    operation: 'lexical_source',
    workspaceUid: input.pin.workspaceUid,
    projectUid: input.pin.projectUid,
    worktreeUid: input.pin.worktreeUid,
    revisionId: input.pin.revisionId,
    snapshotId: input.pin.snapshotId,
    lexicalRoot: input.pin.lexicalRoot,
    authorizationScopeDigest: input.pin.authorizationScopeDigest,
    policyHash: input.pin.policyHash,
    policyVersion: input.pin.policyVersion,
    searchReceiptUid: input.pin.searchReceiptUid,
    analyzerIdentity: input.pin.analyzerIdentity,
    queryDigest: expectedQueryDigest,
    sourceK: 2,
    excludedDocumentUid: null,
  };
  assert.deepEqual(h.calls.receipt, expectedBinding);
  const expectedBindingDigest = hash('spipe-authorized-lexical-binding-v1\0', expectedBinding);
  assert.equal(expectedBindingDigest, ONE_PAGE_ORACLE.bindingDigest);
  assert.equal(result.value.evidenceIdentity.bindingDigest, expectedBindingDigest);
  const expectedPageSetDigest = hash('spipe-authorized-lexical-page-set-v1\0', {
    bindingDigest: expectedBindingDigest,
    providerIdentity: returnedPage.providerIdentity,
    pages: [expectedPageReceipt],
  });
  assert.equal(result.value.evidenceIdentity.pageSetDigest, expectedPageSetDigest);
  assert.equal(expectedPageSetDigest, ONE_PAGE_ORACLE.pageSetDigest);
  const rawCandidates = returnedPage.candidates.map((entry) => ({
    documentId: entry.documentId,
    sourceRank: entry.sourceRank,
    sourceScoreMilli: entry.sourceScoreMilli,
  }));
  const documentIds = [artifact(1), artifact(2)];
  const expectedRankDigest = hash('spipe-authorized-lexical-rank-evidence-v1\0', {
    bindingDigest: expectedBindingDigest,
    rawCandidates,
    excludedDocumentUid: null,
    outputDocumentIds: documentIds,
  });
  assert.equal(result.value.evidenceIdentity.rankEvidenceDigest, expectedRankDigest);
  assert.equal(expectedRankDigest, ONE_PAGE_ORACLE.rankEvidenceDigest);
  const expectedSourceIdentity = hash('spipe-authorized-lexical-source-v1\0', {
    contractVersion: LEXICAL_SOURCE_CONTRACT_V1,
    bindingDigest: expectedBindingDigest,
    providerIdentity: returnedPage.providerIdentity,
    queryDigest: expectedQueryDigest,
    sourceK: 2,
    excludedDocumentUid: null,
    rankEvidenceDigest: expectedRankDigest,
    documentIds,
  });
  assert.equal(result.value.source.sourceIdentity, expectedSourceIdentity);
  assert.equal(expectedSourceIdentity, ONE_PAGE_ORACLE.sourceIdentity);
  const expectedCandidateDigest = hash('spipe-rrf-source-pool-v1\0', {
    name: 'lexical', sourceIdentity: expectedSourceIdentity, documentIds,
  });
  assert.equal(result.value.source.candidateDigest, expectedCandidateDigest);
  assert.equal(expectedCandidateDigest, ONE_PAGE_ORACLE.candidateDigest);

  const graphIdentity = H0;
  const graphIds = [artifact(2), artifact(3)];
  const fused = fuseRrfCompletePoolV2({
    context: request().context,
    k: 60,
    sourceK: 2,
    sources: [
      result.value.source,
      { name: 'graph', sourceIdentity: graphIdentity, complete: true,
        candidateCount: 2, candidateDigest: sourcePoolDigest('graph', graphIdentity, graphIds),
        candidates: graphIds.map((documentId) => ({ documentId })) },
    ],
  });
  assert.equal(fused.ok, true);
});

test('valid short-page fragmentation preserves semantic identities and control-string bytes', () => {
  const docs = scored(5);
  const one = harness(docs, { pageSize: 1 }).producer.readLexicalSourceV1(request({ query: 'a\tb\nc', sourceK: 5 }));
  const three = harness(docs, { pageSize: 3 }).producer.readLexicalSourceV1(request({ query: 'a\tb\nc', sourceK: 5 }));
  assert.equal(one.ok, true);
  assert.equal(three.ok, true);
  assert.equal(one.value.source.sourceIdentity, three.value.source.sourceIdentity);
  assert.equal(one.value.source.candidateDigest, three.value.source.candidateDigest);
  assert.equal(one.value.evidenceIdentity.rankEvidenceDigest, three.value.evidenceIdentity.rankEvidenceDigest);
  assert.notEqual(one.value.evidenceIdentity.pageSetDigest, three.value.evidenceIdentity.pageSetDigest);
  const expectedQueryDigest = hash('spipe-authorized-lexical-query-v1\0', {
    query: 'a\tb\nc', context: request().context,
  });
  assert.equal(one.value.evidenceIdentity.queryDigest, expectedQueryDigest);
  assert.equal(canonical({ query: 'a\tb\nc' }), '{"query":"a\\u0009b\\u000ac"}');
});

test('provider-owned exclusion ranks before pagination and supports sourceK 1000', () => {
  const docs = scored(1001);
  const h = harness(docs, { pageSize: 333 });
  const result = h.producer.readLexicalSourceV1(request({
    sourceK: 1000, excludedDocumentUid: artifact(1),
  }));
  assert.equal(result.ok, true);
  assert.equal(result.value.source.candidateCount, 1000);
  assert.equal(result.value.source.candidates[0].documentId, artifact(2));
  assert.equal(result.value.source.candidates.at(-1).documentId, artifact(1001));
  assert.equal(Math.max(...h.calls.authorize.map((entry) => entry.sourceRank)), 1000);
  assert.equal(h.calls.pages.every((entry) => entry.excludedDocumentUid === artifact(1)), true);
  assert.equal(result.value.evidenceIdentity.exclusionApplied, true);
});

test('provider-owned exclusion is deterministic when absent or in the middle', () => {
  const docs = scored(6);
  const middle = harness(docs, { pageSize: 2 }).producer.readLexicalSourceV1(request({
    sourceK: 4, excludedDocumentUid: artifact(3),
  }));
  const absent = harness(docs, { pageSize: 3 }).producer.readLexicalSourceV1(request({
    sourceK: 4, excludedDocumentUid: artifact(99),
  }));
  assert.equal(middle.ok, true);
  assert.deepEqual(middle.value.source.candidates.map((entry) => entry.documentId), [
    artifact(1), artifact(2), artifact(4), artifact(5),
  ]);
  assert.equal(absent.ok, true);
  assert.deepEqual(absent.value.source.candidates.map((entry) => entry.documentId), [
    artifact(1), artifact(2), artifact(3), artifact(4),
  ]);
});

test('equal scores use unsigned UTF-8 artifact UID order across page boundaries', () => {
  const docs = [
    { documentId: artifact(1), sourceScoreMilli: 100 },
    { documentId: artifact(2), sourceScoreMilli: 100 },
    { documentId: artifact(3), sourceScoreMilli: 90 },
  ];
  const valid = harness(docs, { pageSize: 1 });
  assert.equal(valid.producer.readLexicalSourceV1(request({ sourceK: 3 })).ok, true);
  const invalid = harness([docs[1], docs[0], docs[2]], { pageSize: 1 });
  assert.equal(invalid.producer.readLexicalSourceV1(request({ sourceK: 3 })).error.code, 'snapshot_corrupt');
});

test('request validation is closed, bound, accessor-safe, and precedes every port', () => {
  const h = harness(scored(1));
  const getterRequest = request();
  Object.defineProperty(getterRequest, 'query', { enumerable: true, get() { throw new Error('secret'); } });
  assert.deepEqual(h.producer.readLexicalSourceV1(getterRequest), { ok: false, error: { code: 'invalid_request' } });
  const mismatches = [
    { context: { workspaceId: `WS-${'F'.repeat(32)}` } },
    { context: { snapshotId: `spks1-${'5'.repeat(64)}` } },
    { context: { authorizationScopeDigest: H1 } },
    { context: { queryReceipt: `D-${'F'.repeat(32)}` } },
    { context: { analyzerIdentity: 'wrong' } },
  ];
  for (const change of mismatches) {
    assert.equal(h.producer.readLexicalSourceV1(request(change)).error.code, 'invalid_request');
  }
  assert.equal(h.producer.readLexicalSourceV1(request({ sourceK: 0 })).error.code, 'limit_exceeded');
  assert.equal(h.producer.readLexicalSourceV1(request({ sourceK: 1001 })).error.field, 'sourceK');
  assert.equal(h.producer.readLexicalSourceV1(request({ sourceK: 1.5 })).error.code, 'invalid_request');
  assert.equal(h.producer.readLexicalSourceV1(request({ query: 'x'.repeat(4097) })).error.field, 'query');
  const longRevision = request({ pin: { revisionId: 'r'.repeat(513) } });
  assert.deepEqual(h.producer.readLexicalSourceV1(longRevision), {
    ok: false, error: { code: 'limit_exceeded', field: 'revisionId' },
  });
  const compound = request({ query: 'x'.repeat(4097), pin: { policyHash: 'bad' } });
  assert.equal(h.producer.readLexicalSourceV1(compound).error.code, 'invalid_request');
  assert.equal(h.calls.verify, 0);
  assert.equal(h.calls.pages.length, 0);
});

test('unauthorized receipts fail closed before provider access and preserve no cause', () => {
  const thrown = harness(scored(1), { verifyThrows: true });
  assert.deepEqual(thrown.producer.readLexicalSourceV1(request({ sourceK: 1 })), {
    ok: false, error: { code: 'unauthorized' },
  });
  assert.equal(thrown.calls.pages.length, 0);
  const mutable = harness(scored(1), { verifyResult: (binding) => ({ ...binding }) });
  assert.equal(mutable.producer.readLexicalSourceV1(request({ sourceK: 1 })).error.code, 'unauthorized');
});

test('provider exceptions are redacted and incompatible identities are distinct', () => {
  const unavailable = harness(scored(1), { readThrows: true });
  assert.deepEqual(unavailable.producer.readLexicalSourceV1(request({ sourceK: 1 })), {
    ok: false, error: { code: 'provider_unavailable' },
  });
  const incompatible = harness(scored(1), { providerContractVersion: 'other/9' });
  assert.deepEqual(incompatible.producer.readLexicalSourceV1(request({ sourceK: 1 })), {
    ok: false, error: { code: 'incompatible_contract' },
  });
});

test('page digest, cursor chain, rank, tie, exclusion, and receipt corruption fail locally', () => {
  const corruptions = [
    (page) => freeze({ ...page, pageDigest: H0 }),
    (page) => freeze({ ...page, providerCursorDigest: H0 }),
    (page) => freeze({ ...page, requestedLimit: page.requestedLimit - 1 }),
    (page) => freeze({ ...page, excludedDocumentUid: artifact(99) }),
    (page) => freeze({ ...page, exclusionApplied: !page.exclusionApplied }),
    (page) => freeze({ ...page, pageStartRank: page.pageStartRank + 1 }),
    (page) => freeze({ ...page, receipt: freeze({ ...page.receipt, receiptUid: 'bad' }) }),
    (page) => freeze({ ...page, candidates: freeze(page.candidates.map((entry, index) => freeze({
      ...entry, sourceRank: index === 0 ? entry.sourceRank + 1 : entry.sourceRank,
    }))) }),
  ];
  for (const transformPage of corruptions) {
    const h = harness(scored(2), { transformPage });
    assert.equal(h.producer.readLexicalSourceV1(request({ sourceK: 1 })).error.code, 'snapshot_corrupt');
    assert.equal(h.calls.authorize.length, 0);
    assert.equal(h.calls.evidence, 0);
  }
  const returnedPin = harness(scored(2), {
    transformPage(page, _number, input) {
      const candidate = freeze({ ...page.candidates[0], documentId: input.excludedDocumentUid });
      return freeze({ ...page, candidates: freeze([candidate]) });
    },
  });
  assert.equal(returnedPin.producer.readLexicalSourceV1(request({
    sourceK: 1, excludedDocumentUid: artifact(1),
  })).error.code, 'snapshot_corrupt');
});

test('duplicates and repeated cursors or receipts are rejected across short pages', () => {
  const duplicate = harness(scored(3), { pageSize: 1, transformPage(page, number) {
    if (number !== 2) return page;
    const candidates = freeze([freeze({ ...page.candidates[0], documentId: artifact(1) })]);
    return freeze({ ...page, candidates });
  } });
  assert.equal(duplicate.producer.readLexicalSourceV1(request({ sourceK: 3 })).error.code, 'snapshot_corrupt');
  const repeatedReceipt = harness(scored(3), { pageSize: 1, transformPage(page, number) {
    return number === 2 ? freeze({ ...page, receipt: freeze({ ...page.receipt, receiptUid: receiptUid(1) }) }) : page;
  } });
  assert.equal(repeatedReceipt.producer.readLexicalSourceV1(request({ sourceK: 3 })).error.code, 'snapshot_corrupt');
  const repeatedCursor = harness(scored(4), { pageSize: 1, transformPage(page, number) {
    if (number !== 2) return page;
    const nextCursor = Buffer.from('1').toString('base64url');
    return freeze({ ...page, nextCursor, nextCursorDigest: cursorDigest(page.bindingDigest, nextCursor) });
  } });
  assert.equal(repeatedCursor.producer.readLexicalSourceV1(request({ sourceK: 4 })).error.code, 'snapshot_corrupt');
});

test('candidate authorization checks every collected candidate exactly once without early exit', () => {
  const h = harness(scored(4), { authorize(input, number) {
    if (number === 2) throw new Error('private policy failure');
    return freeze({
      documentId: input.documentId,
      sourceRank: input.sourceRank,
      authorizationScopeDigest: H0,
      policyHash: H2,
      policyVersion: 7,
      searchReceiptUid: ID.receipt,
      decision: number === 3 ? 'denied' : 'allowed',
    });
  } });
  const result = h.producer.readLexicalSourceV1(request({ sourceK: 4 }));
  assert.deepEqual(result, { ok: false, error: { code: 'snapshot_unavailable' } });
  assert.equal(h.calls.authorize.length, 4);
  assert.equal(h.calls.evidence, 0);
});

test('aggregate evidence is verified exactly once after all local authority checks', () => {
  const denied = harness(scored(2), { evidence(input) {
    return freeze({
      bindingDigest: input.bindingDigest,
      pageSetDigest: input.pageSetDigest,
      rankEvidenceDigest: input.rankEvidenceDigest,
      excludedDocumentUid: input.excludedDocumentUid,
      exclusionApplied: input.exclusionApplied,
      authorityReceiptUid: ID.authority,
      decision: 'denied',
    });
  } });
  assert.equal(denied.producer.readLexicalSourceV1(request({ sourceK: 2 })).error.code, 'evidence_unverified');
  assert.equal(denied.calls.evidence, 1);
  const thrown = harness(scored(2), { evidenceThrows: true });
  assert.deepEqual(thrown.producer.readLexicalSourceV1(request({ sourceK: 2 })), {
    ok: false, error: { code: 'evidence_unverified' },
  });
});

test('provider page and cursor caps report only frozen public cap fields', () => {
  const cursorCap = harness(scored(2), { transformPage(page) {
    return freeze({ ...page, nextCursor: 'A'.repeat(8193) });
  } });
  assert.deepEqual(cursorCap.producer.readLexicalSourceV1(request({ sourceK: 1 })), {
    ok: false, error: { code: 'limit_exceeded', field: 'providerCursor' },
  });
  const manyPages = harness(scored(65), { pageSize: 1 });
  assert.deepEqual(manyPages.producer.readLexicalSourceV1(request({ sourceK: 65 })), {
    ok: false, error: { code: 'limit_exceeded', field: 'providerPages' },
  });
  assert.equal(manyPages.calls.pages.length, 64);
  const pageCandidateCap = harness(scored(1), { transformPage(page) {
    const candidates = freeze(Array.from({ length: 1001 }, (_value, index) => freeze({
      documentId: artifact(index + 1), sourceRank: index + 1, sourceScoreMilli: 1001 - index,
    })));
    return freeze({ ...page, candidateCount: 1001, candidates });
  } });
  assert.deepEqual(pageCandidateCap.producer.readLexicalSourceV1(request({ sourceK: 1 })), {
    ok: false, error: { code: 'limit_exceeded', field: 'providerPageCandidates' },
  });
  const documentCap = harness(scored(1), { transformPage(page) {
    const candidates = freeze([freeze({
      ...page.candidates[0], documentId: `A-${'A'.repeat(513)}`,
    })]);
    return freeze({ ...page, candidates });
  } });
  assert.deepEqual(documentCap.producer.readLexicalSourceV1(request({ sourceK: 1 })), {
    ok: false, error: { code: 'limit_exceeded', field: 'documentId' },
  });
  const pageByteCap = harness(scored(1), { transformPage(page) {
    return freeze({
      ...page,
      providerIdentity: freeze({
        ...page.providerIdentity, providerContractVersion: 'x'.repeat(525_000),
      }),
    });
  } });
  assert.deepEqual(pageByteCap.producer.readLexicalSourceV1(request({ sourceK: 1 })), {
    ok: false, error: { code: 'limit_exceeded', field: 'providerPageBytes' },
  });
});

test('malformed provider Unicode is corruption and never escapes as an internal error', () => {
  const values = [
    (page) => freeze({ ...page, schema: '\ud800' }),
    (page) => freeze({
      ...page,
      providerIdentity: freeze({ ...page.providerIdentity, providerContractVersion: '\ud800' }),
    }),
    (page) => freeze({ ...page, receipt: freeze({ ...page.receipt, kind: '\ud800' }) }),
  ];
  for (const transformPage of values) {
    const h = harness(scored(1), { transformPage });
    assert.deepEqual(h.producer.readLexicalSourceV1(request({ sourceK: 1 })), {
      ok: false, error: { code: 'snapshot_corrupt' },
    });
    assert.equal(h.calls.authorize.length, 0);
    assert.equal(h.calls.evidence, 0);
  }
});

test('caller mutation cannot alter captured bindings or completed output', () => {
  const h = harness(scored(2));
  const input = request({ sourceK: 2 });
  const result = h.producer.readLexicalSourceV1(input);
  input.context.snapshotId = `spks1-${'9'.repeat(64)}`;
  input.pin.policyVersion = 99;
  assert.equal(result.value.evidenceIdentity.snapshotId, `spks1-${'3'.repeat(64)}`);
  assert.equal(result.value.evidenceIdentity.policyVersion, 7);
  assert.throws(() => { result.value.source.candidates[0].documentId = artifact(99); }, TypeError);
});
