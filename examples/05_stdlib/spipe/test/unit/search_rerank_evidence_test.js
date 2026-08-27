import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  MAX_RERANK_CLASSIFICATION_REFS_V1,
  MAX_RERANK_EVIDENCE_CANONICAL_BYTES_V1,
  MAX_RERANK_EVIDENCE_POOL_HITS_V1,
  MAX_RERANK_EVIDENCE_SOURCE_HITS_V1,
  MAX_RERANK_EVIDENCE_TEXT_BYTES_V1,
  MAX_RERANK_TRACE_EDGES_V1,
  RERANK_EVIDENCE_BUILDER_CONTRACT_V1,
  RERANK_EVIDENCE_PAGE_AUTHORITY_V1,
  createAuthorityBoundRerankEvidenceBuilderV1,
} from '../../src/search/rerank_evidence.js';
import { GRAPH_CANDIDATE_CONTRACT_V1 } from '../../src/search/graph_candidates.js';
import { LEXICAL_SOURCE_CONTRACT_V1 } from '../../src/search/lexical_source.js';
import { fuseRrfCompletePoolV2 } from '../../src/search/fusion.js';
import {
  RERANK_FIXED_POLICY_V1,
  createRrfBoundedRerankerV3,
} from '../../src/search/rerank.js';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const VERIFIER_DIGEST = `sha256:${'9'.repeat(64)}`;
const H = (character) => `sha256:${character.repeat(64)}`;
const SNAP = (character) => `spks1-${character.repeat(64)}`;

function deepFreeze(value, seen = new Set()) {
  if (value !== null && typeof value === 'object' && !seen.has(value)) {
    seen.add(value); for (const child of Object.values(value)) deepFreeze(child, seen); Object.freeze(value);
  }
  return value;
}

function oracleCanonical(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value.normalize('NFC'));
  if (typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(oracleCanonical).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key.normalize('NFC'))}:${oracleCanonical(value[key])}`).join(',')}}`;
}

function oracleDigest(domain, value) {
  return `sha256:${createHash('sha256').update(Buffer.from(domain, 'utf8'))
    .update(Buffer.from(oracleCanonical(value), 'utf8')).digest('hex')}`;
}

function oracleReceiptUid(preimage) {
  const bytes = createHash('sha256').update(Buffer.from('spipe-rerank-evidence-page-receipt-uid-v1\0', 'utf8'))
    .update(Buffer.from(oracleCanonical(preimage), 'utf8')).digest();
  let bits = 0n;
  for (let index = 0; index < 16; index += 1) bits = (bits << 8n) | BigInt(bytes[index]);
  bits = (bits << 2n) | BigInt(bytes[16] >> 6);
  let encoded = '';
  for (let shift = 125n; shift >= 0n; shift -= 5n) encoded += ALPHABET[Number((bits >> shift) & 31n)];
  return `D-${encoded}`;
}

function uid(prefix, number) {
  let value = BigInt(number), payload = '';
  for (let index = 0; index < 26; index += 1) { payload = ALPHABET[Number(value & 31n)] + payload; value >>= 5n; }
  return `${prefix}-${payload}`;
}

function wideUid(prefix, number) {
  return `${prefix}-${BigInt(number).toString(16).toUpperCase().padStart(32, '0')}`;
}

function candidateDigest(name, sourceIdentity, documentIds) {
  return oracleDigest('spipe-rrf-source-pool-v1\0', { name, sourceIdentity, documentIds });
}

function source(name, sourceIdentity, documentIds) {
  return {
    name, sourceIdentity, complete: true, candidateCount: documentIds.length,
    candidateDigest: candidateDigest(name, sourceIdentity, documentIds),
    candidates: documentIds.map((documentId) => ({ documentId })),
  };
}

function basePin(recencyEpochDay = 1000) {
  return {
    workspaceUid: uid('WS', 1), projectUid: uid('P', 2), worktreeUid: uid('WT', 3),
    revisionId: 'revision-1', snapshotId: SNAP('1'), lexicalRoot: H('2'),
    graphSnapshotId: SNAP('3'), graphRoot: H('4'), metadataSnapshotId: SNAP('5'),
    metadataRoot: H('6'), authorizationScopeDigest: H('7'), policyHash: H('8'),
    policyVersion: 7, searchReceiptUid: uid('D', 9), analyzerIdentity: 'spipe-unicode-lex-v1',
    queryDigest: H('a'), recencyEpochDay,
  };
}

function graphRecord(documentId, rootArtifactUid, number, distance = 1) {
  const shared = uid('D', 100_000 + number);
  const acceptedEdgeEvidence = Array.from({ length: distance }, (_, index) => ({
    edgeUid: uid('E', 200_000 + number * 4 + index), authorityReceiptUid: shared,
  }));
  return {
    documentId, distance, rootArtifactUid, acceptedEdgeEvidence,
    evidenceEdgeUids: acceptedEdgeEvidence.map((item) => item.edgeUid).sort(),
    authorityReceiptUids: [shared],
  };
}

function fixture(options = {}) {
  const lexicalCount = options.lexicalCount ?? 2;
  const graphCount = options.graphCount ?? 2;
  const semanticCount = options.semanticCount ?? 0;
  const pin = basePin(options.recencyEpochDay === undefined ? 1000 : options.recencyEpochDay);
  const pinnedArtifactUid = options.pinned ? uid('A', 900_000) : null;
  const lexicalIds = Array.from({ length: lexicalCount }, (_, index) => uid('A', index + 1));
  if (options.pinnedInRaw) lexicalIds[0] = pinnedArtifactUid;
  const graphIds = Array.from({ length: graphCount }, (_, index) => uid('A', 20_000 + index));
  const semanticIds = Array.from({ length: semanticCount }, (_, index) => uid('A', 40_000 + index));
  const context = {
    workspaceId: pin.workspaceUid, snapshotId: pin.snapshotId,
    authorizationScopeDigest: pin.authorizationScopeDigest, queryReceipt: pin.searchReceiptUid,
    analyzerIdentity: pin.analyzerIdentity,
  };
  const graphRecords = graphIds.map((documentId, index) => graphRecord(
    documentId, pinnedArtifactUid ?? lexicalIds[index % Math.max(1, lexicalIds.length)], index + 1,
    options.distanceTwo && index === 0 ? 2 : 1,
  ));
  const graphEvidenceDigest = oracleDigest('spipe-graph-candidate-evidence-v1\0', graphRecords.map((record) => ({
    documentId: record.documentId, distance: record.distance, rootArtifactUid: record.rootArtifactUid,
    acceptedEdgeEvidence: record.acceptedEdgeEvidence,
  })));
  const graphEvidenceIdentity = {
    graphCandidateContractVersion: GRAPH_CANDIDATE_CONTRACT_V1,
    graphSnapshotId: pin.graphSnapshotId, graphRoot: pin.graphRoot,
    authorizationScopeDigest: pin.authorizationScopeDigest, policyHash: pin.policyHash,
    policyVersion: pin.policyVersion, searchReceiptUid: pin.searchReceiptUid,
    authorizedGraphDigest: H('b'), acceptedEdgeSetDigest: H('c'), evidenceDigest: graphEvidenceDigest,
  };
  const graphPin = {
    workspaceUid: pin.workspaceUid, projectUid: pin.projectUid, worktreeUid: pin.worktreeUid,
    revisionId: pin.revisionId, graphSnapshotId: pin.graphSnapshotId, graphRoot: pin.graphRoot,
    authorizationScopeDigest: pin.authorizationScopeDigest, policyHash: pin.policyHash,
    policyVersion: pin.policyVersion, searchReceiptUid: pin.searchReceiptUid,
  };
  const roots = [
    ...(pinnedArtifactUid === null ? [] : [{ documentId: pinnedArtifactUid, seedTier: 0, seedRank: 0 }]),
    ...lexicalIds.filter((documentId) => documentId !== pinnedArtifactUid)
      .map((documentId, index) => ({ documentId, seedTier: 1, seedRank: index + 1 })),
  ];
  const graphSourceIdentity = oracleDigest('spipe-graph-source-identity-v1\0', {
    contractVersion: GRAPH_CANDIDATE_CONTRACT_V1, pin: graphPin, roots, sourceK: 1000,
    authorizedGraphDigest: graphEvidenceIdentity.authorizedGraphDigest,
    acceptedEdgeSetDigest: graphEvidenceIdentity.acceptedEdgeSetDigest,
    evidenceDigest: graphEvidenceIdentity.evidenceDigest,
  });
  const lexicalBinding = {
    contractVersion: LEXICAL_SOURCE_CONTRACT_V1, operation: 'lexical_source',
    workspaceUid: pin.workspaceUid, projectUid: pin.projectUid, worktreeUid: pin.worktreeUid,
    revisionId: pin.revisionId, snapshotId: pin.snapshotId, lexicalRoot: pin.lexicalRoot,
    authorizationScopeDigest: pin.authorizationScopeDigest, policyHash: pin.policyHash,
    policyVersion: pin.policyVersion, searchReceiptUid: pin.searchReceiptUid,
    analyzerIdentity: pin.analyzerIdentity, queryDigest: pin.queryDigest, sourceK: 1000,
    excludedDocumentUid: pinnedArtifactUid,
  };
  const bindingDigest = oracleDigest('spipe-authorized-lexical-binding-v1\0', lexicalBinding);
  const providerIdentity = {
    providerContractVersion: 'spipe-search-provider/1.0', providerImplementationDigest: H('d'),
    analyzerIdentity: pin.analyzerIdentity, scoreContractVersion: 'bm25-fixed-v1',
  };
  const rankEvidenceDigest = H('e');
  const lexicalSourceIdentity = oracleDigest('spipe-authorized-lexical-source-v1\0', {
    contractVersion: LEXICAL_SOURCE_CONTRACT_V1, bindingDigest, providerIdentity,
    queryDigest: pin.queryDigest, sourceK: 1000, excludedDocumentUid: pinnedArtifactUid,
    rankEvidenceDigest, documentIds: lexicalIds,
  });
  const lexicalCandidateDigest = candidateDigest('lexical', lexicalSourceIdentity, lexicalIds);
  const lexicalEvidenceIdentity = {
    lexicalSourceContractVersion: LEXICAL_SOURCE_CONTRACT_V1,
    workspaceUid: pin.workspaceUid, projectUid: pin.projectUid, worktreeUid: pin.worktreeUid,
    revisionId: pin.revisionId, snapshotId: pin.snapshotId, lexicalRoot: pin.lexicalRoot,
    authorizationScopeDigest: pin.authorizationScopeDigest, policyHash: pin.policyHash,
    policyVersion: pin.policyVersion, searchReceiptUid: pin.searchReceiptUid,
    analyzerIdentity: pin.analyzerIdentity, scoreContractVersion: providerIdentity.scoreContractVersion,
    providerContractVersion: providerIdentity.providerContractVersion,
    providerImplementationDigest: providerIdentity.providerImplementationDigest,
    queryDigest: pin.queryDigest, bindingDigest, sourceK: 1000,
    excludedDocumentUid: pinnedArtifactUid, exclusionApplied: pinnedArtifactUid !== null,
    providerPageCount: 1, providerCandidateCount: lexicalIds.length,
    authorityReceiptUid: uid('D', 500_000), pageSetDigest: H('f'), rankEvidenceDigest,
    sourceIdentity: lexicalSourceIdentity, candidateDigest: lexicalCandidateDigest,
  };
  const semanticSourceIdentity = semanticCount === 0 ? null : H('1');
  const semanticEvidenceIdentity = semanticCount === 0 ? null : {
    semanticSourceContractVersion: 'semantic-source-v1', sourceIdentity: semanticSourceIdentity,
    candidateDigest: candidateDigest('semantic', semanticSourceIdentity, semanticIds),
    evidenceDigest: H('2'), authorityReceiptUid: uid('D', 500_001),
  };
  const sources = [source('lexical', lexicalSourceIdentity, lexicalIds), source('graph', graphSourceIdentity, graphIds)];
  if (semanticCount > 0) sources.push(source('semantic', semanticSourceIdentity, semanticIds));
  const fused = fuseRrfCompletePoolV2({ context, k: 60, sourceK: 1000, sources });
  assert.equal(fused.ok, true);
  const rawFusion = fused.value, rawIds = rawFusion.hits.map((hit) => hit.documentId);
  const queryFeatureUids = [uid('F', 1)], queryComponentUids = [uid('C', 1)];
  const metadataRecords = [...rawIds].sort().map((documentId, index) => ({
    documentId,
    features: [{ classificationUid: index % 2 === 0 ? queryFeatureUids[0] : uid('F', 2),
      edgeUid: uid('E', 600_000 + index * 2), authorityReceiptUid: uid('D', 700_000 + index * 2) }],
    components: [{ classificationUid: queryComponentUids[0],
      edgeUid: uid('E', 600_001 + index * 2), authorityReceiptUid: uid('D', 700_001 + index * 2) }],
    documentRevisionEpochDay: pin.recencyEpochDay === null ? null : pin.recencyEpochDay - 5,
    recencyAuthorityReceiptUid: pin.recencyEpochDay === null ? null : uid('D', 800_000 + index),
    status: ['active', 'stale', 'deprecated'][index % 3],
    statusAuthorityReceiptUid: uid('D', 850_000 + index),
  }));
  const metadataWithoutDigest = {
    schema: 'spipe-authorized-rerank-metadata-v1', workspaceUid: pin.workspaceUid,
    projectUid: pin.projectUid, worktreeUid: pin.worktreeUid, revisionId: pin.revisionId,
    snapshotId: pin.snapshotId, metadataSnapshotId: pin.metadataSnapshotId,
    metadataRoot: pin.metadataRoot, authorizationScopeDigest: pin.authorizationScopeDigest,
    policyHash: pin.policyHash, policyVersion: pin.policyVersion,
    searchReceiptUid: pin.searchReceiptUid, analyzerIdentity: pin.analyzerIdentity,
    queryDigest: pin.queryDigest, recencyEpochDay: pin.recencyEpochDay,
    queryFeatureUids, queryComponentUids, records: metadataRecords,
  };
  const metadata = { ...metadataWithoutDigest,
    authorizedMetadataDigest: oracleDigest('spipe-authorized-rerank-metadata-v1\0', metadataWithoutDigest) };
  const request = {
    contractVersion: RERANK_EVIDENCE_BUILDER_CONTRACT_V1, operation: 'build_rerank_evidence',
    context, pin, pinnedArtifactUid, rawFusion, lexicalEvidenceIdentity,
    graphEvidenceIdentity, graphEvidenceRecords: graphRecords, semanticEvidenceIdentity,
  };
  return deepFreeze({ request, metadata, rawIds, lexicalIds, graphIds, semanticIds });
}

function harness(value, overrides = {}) {
  const calls = { receipt: 0, metadata: 0, page: 0 };
  const seen = {};
  const builder = createAuthorityBoundRerankEvidenceBuilderV1({
    authorityVerifierDigest: overrides.authorityVerifierDigest ?? VERIFIER_DIGEST,
    verifySearchReceipt(binding) {
      calls.receipt += 1; seen.binding = binding;
      if (overrides.searchThrow) throw new Error('search');
      if (overrides.searchFalse) return false;
      return deepFreeze({ ...binding });
    },
    readAuthorizedRerankMetadata(request) {
      calls.metadata += 1; seen.metadataRequest = request;
      if (overrides.metadataThrow) throw new Error('metadata');
      return overrides.metadata ?? value.metadata;
    },
    verifyRerankEvidencePage(request) {
      calls.page += 1; seen.pageRequest = request;
      if (overrides.pageThrow) throw new Error('page');
      if (overrides.pageFalse) return false;
      return deepFreeze({ ...request, decision: 'verified' });
    },
  });
  return { builder, calls, seen };
}

function run(value, overrides) {
  const active = harness(value, overrides);
  return { ...active, result: active.builder.buildRerankEvidencePageV1(value.request) };
}

function replaceRequest(value, changes) {
  return deepFreeze({ ...value.request, ...changes });
}

function metadataWith(value, changes) {
  const without = { ...value.metadata, ...changes }; delete without.authorizedMetadataDigest;
  return deepFreeze({ ...without,
    authorizedMetadataDigest: oracleDigest('spipe-authorized-rerank-metadata-v1\0', without) });
}

test('exports the exact frozen one-method factory and bounded constants', () => {
  assert.equal(RERANK_EVIDENCE_BUILDER_CONTRACT_V1, 'spipe-authorized-rerank-evidence-builder-v1');
  assert.equal(RERANK_EVIDENCE_PAGE_AUTHORITY_V1, 'spipe-rerank-evidence-page-authority-v1');
  assert.deepEqual([MAX_RERANK_EVIDENCE_POOL_HITS_V1, MAX_RERANK_EVIDENCE_SOURCE_HITS_V1,
    MAX_RERANK_CLASSIFICATION_REFS_V1, MAX_RERANK_TRACE_EDGES_V1,
    MAX_RERANK_EVIDENCE_TEXT_BYTES_V1, MAX_RERANK_EVIDENCE_CANONICAL_BYTES_V1],
  [3000, 1000, 16, 3, 512, 16_777_216]);
  assert.throws(() => createAuthorityBoundRerankEvidenceBuilderV1({}), TypeError);
  const value = fixture(), active = harness(value);
  assert.equal(Object.isFrozen(active.builder), true);
  assert.deepEqual(Object.keys(active.builder), ['buildRerankEvidencePageV1']);
  assert.deepEqual(active.calls, { receipt: 0, metadata: 0, page: 0 });
});

test('builds every 2,000-hit record in fused order without metadata-order leakage', () => {
  const value = fixture({ lexicalCount: 1000, graphCount: 1000 });
  const { result, calls } = run(value);
  assert.equal(result.ok, true);
  assert.equal(result.value.counters.rawPoolHits, 2000);
  assert.equal(result.value.evidencePage.records.length, 2000);
  assert.deepEqual(result.value.evidencePage.records.map((record) => record.documentId), value.rawIds);
  assert.deepEqual(calls, { receipt: 1, metadata: 1, page: 1 });
});

test('builds the complete 3,000-hit lexical/graph/semantic union', () => {
  const value = fixture({ lexicalCount: 1000, graphCount: 1000, semanticCount: 1000 });
  const { result } = run(value);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.counters, {
    rawPoolHits: 3000, lexicalCandidates: 1000, graphCandidates: 1000,
    semanticCandidates: 1000, metadataRecords: 3000,
  });
  assert.equal(Buffer.byteLength(oracleCanonical(result.value.evidencePage), 'utf8')
    < MAX_RERANK_EVIDENCE_CANONICAL_BYTES_V1, true);
});

test('preserves graph pair order/shared receipt while lexical-only hits have null trace', () => {
  const value = fixture({ distanceTwo: true });
  const { result } = run(value); assert.equal(result.ok, true);
  const lexical = result.value.evidencePage.records.find((record) => record.documentId === value.lexicalIds[0]);
  const graph = result.value.evidencePage.records.find((record) => record.documentId === value.graphIds[0]);
  assert.deepEqual(lexical.acceptedTrace, { distance: null, acceptedEdgeEvidence: [] });
  assert.deepEqual(graph.acceptedTrace.acceptedEdgeEvidence, value.request.graphEvidenceRecords[0].acceptedEdgeEvidence);
  assert.equal(graph.acceptedTrace.acceptedEdgeEvidence[0].authorityReceiptUid,
    graph.acceptedTrace.acceptedEdgeEvidence[1].authorityReceiptUid);
  assert.deepEqual(Object.keys(graph.acceptedTrace), ['distance', 'acceptedEdgeEvidence']);
});

test('derives intersections, recency, and all three authority-bound statuses', () => {
  const value = fixture({ lexicalCount: 2, graphCount: 2 });
  const { result } = run(value); assert.equal(result.ok, true);
  const records = result.value.evidencePage.records;
  assert.equal(records.some((record) => record.featureMatch.matched), true);
  assert.equal(records.some((record) => !record.featureMatch.matched), true);
  assert.equal(records.every((record) => record.componentMatch.matched), true);
  assert.deepEqual(new Set(records.map((record) => record.status.value)), new Set(['active', 'stale', 'deprecated']));
  assert.equal(records.every((record) => record.recency.documentRevisionEpochDay === 995), true);
  const noEpoch = fixture({ recencyEpochDay: null });
  assert.equal(run(noEpoch).result.value.evidencePage.records.every((record) => record.recency === null), true);
});

test('matches independent binding, metadata, source, record, page, and D-UID oracles', () => {
  const value = fixture({ distanceTwo: true, semanticCount: 1 });
  const { result, seen } = run(value); assert.equal(result.ok, true);
  const pin = value.request.pin;
  const expectedBinding = {
    contractVersion: RERANK_EVIDENCE_BUILDER_CONTRACT_V1, operation: 'build_rerank_evidence',
    workspaceUid: pin.workspaceUid, projectUid: pin.projectUid, worktreeUid: pin.worktreeUid,
    revisionId: pin.revisionId, snapshotId: pin.snapshotId, lexicalRoot: pin.lexicalRoot,
    graphSnapshotId: pin.graphSnapshotId, graphRoot: pin.graphRoot,
    metadataSnapshotId: pin.metadataSnapshotId, metadataRoot: pin.metadataRoot,
    authorizationScopeDigest: pin.authorizationScopeDigest, policyHash: pin.policyHash,
    policyVersion: pin.policyVersion, searchReceiptUid: pin.searchReceiptUid,
    analyzerIdentity: pin.analyzerIdentity, queryDigest: pin.queryDigest,
    recencyEpochDay: pin.recencyEpochDay, pinnedArtifactUid: value.request.pinnedArtifactUid,
    rawFusionDigest: value.request.rawFusion.identity.rawFusionDigest,
    sourcePoolDigest: value.request.rawFusion.identity.sourcePoolDigest,
    lexicalSourceIdentity: value.request.lexicalEvidenceIdentity.sourceIdentity,
    lexicalCandidateDigest: value.request.lexicalEvidenceIdentity.candidateDigest,
    lexicalRankEvidenceDigest: value.request.lexicalEvidenceIdentity.rankEvidenceDigest,
    graphSourceIdentity: value.request.rawFusion.identity.orderedSources[1].sourceIdentity,
    graphCandidateDigest: value.request.rawFusion.identity.orderedSources[1].candidateDigest,
    graphEvidenceDigest: value.request.graphEvidenceIdentity.evidenceDigest,
    semanticSourceIdentity: value.request.semanticEvidenceIdentity.sourceIdentity,
    semanticCandidateDigest: value.request.semanticEvidenceIdentity.candidateDigest,
    semanticEvidenceDigest: value.request.semanticEvidenceIdentity.evidenceDigest,
  };
  assert.deepEqual(seen.binding, expectedBinding);
  const expectedBindingDigest = oracleDigest('spipe-rerank-evidence-binding-v1\0', expectedBinding);
  assert.equal(seen.metadataRequest.bindingDigest, expectedBindingDigest);
  const metadataWithout = { ...value.metadata }; delete metadataWithout.authorizedMetadataDigest;
  assert.equal(value.metadata.authorizedMetadataDigest,
    oracleDigest('spipe-authorized-rerank-metadata-v1\0', metadataWithout));
  const expectedSourceEvidenceDigest = oracleDigest('spipe-rerank-source-evidence-v1\0', {
    orderedSources: value.request.rawFusion.identity.orderedSources,
    lexicalEvidenceIdentity: value.request.lexicalEvidenceIdentity,
    graphEvidenceIdentity: value.request.graphEvidenceIdentity,
    semanticEvidenceIdentity: value.request.semanticEvidenceIdentity,
  });
  assert.equal(seen.pageRequest.sourceEvidenceDigest, expectedSourceEvidenceDigest);
  const expectedRecordSetDigest = oracleDigest('spipe-rerank-evidence-record-set-v1\0', {
    bindingDigest: expectedBindingDigest,
    rawFusionDigest: value.request.rawFusion.identity.rawFusionDigest,
    records: result.value.evidencePage.records,
  });
  assert.equal(seen.pageRequest.recordSetDigest, expectedRecordSetDigest);
  const expectedAuthorityPreimage = {
    contractVersion: RERANK_EVIDENCE_PAGE_AUTHORITY_V1, operation: 'verify_rerank_evidence_page',
    bindingDigest: expectedBindingDigest, workspaceUid: pin.workspaceUid, projectUid: pin.projectUid,
    worktreeUid: pin.worktreeUid, revisionId: pin.revisionId, snapshotId: pin.snapshotId,
    graphSnapshotId: pin.graphSnapshotId, graphRoot: pin.graphRoot,
    metadataSnapshotId: pin.metadataSnapshotId, metadataRoot: pin.metadataRoot,
    authorizationScopeDigest: pin.authorizationScopeDigest, policyHash: pin.policyHash,
    policyVersion: pin.policyVersion, searchReceiptUid: pin.searchReceiptUid,
    analyzerIdentity: pin.analyzerIdentity, queryDigest: pin.queryDigest,
    recencyEpochDay: pin.recencyEpochDay, pinnedArtifactUid: value.request.pinnedArtifactUid,
    rawFusionDigest: value.request.rawFusion.identity.rawFusionDigest,
    sourcePoolDigest: value.request.rawFusion.identity.sourcePoolDigest,
    sourceEvidenceDigest: expectedSourceEvidenceDigest,
    authorizedMetadataDigest: value.metadata.authorizedMetadataDigest,
    recordSetDigest: expectedRecordSetDigest, recordCount: result.value.evidencePage.records.length,
    authorityVerifierDigest: VERIFIER_DIGEST,
  };
  const actualAuthorityPreimage = { ...seen.pageRequest };
  delete actualAuthorityPreimage.authorityReceiptUid; delete actualAuthorityPreimage.evidenceDigest;
  assert.deepEqual(actualAuthorityPreimage, expectedAuthorityPreimage);
  assert.equal(seen.pageRequest.authorityReceiptUid, oracleReceiptUid(expectedAuthorityPreimage));
  const identityWithout = { ...result.value.evidencePage.identity }; delete identityWithout.evidenceDigest;
  assert.equal(result.value.evidencePage.identity.evidenceDigest,
    oracleDigest('spipe-rerank-pair-evidence-v1\0', { identity: identityWithout, records: result.value.evidencePage.records }));
});

test('keeps the structurally maximal valid V3 page below the defensive canonical-byte cap', () => {
  const featureUids = Array.from({ length: 16 }, (_, index) => wideUid('F', index + 1));
  const componentUids = Array.from({ length: 16 }, (_, index) => wideUid('C', index + 1));
  const records = Array.from({ length: 3000 }, (_, recordIndex) => ({
    documentId: wideUid('A', recordIndex + 1),
    acceptedTrace: { distance: 3, acceptedEdgeEvidence: Array.from({ length: 3 }, (_, index) => ({
      edgeUid: wideUid('E', 1_000_000 + recordIndex * 3 + index),
      authorityReceiptUid: wideUid('D', 2_000_000 + recordIndex * 3 + index),
    })) },
    featureMatch: { matched: true, queryClassificationUids: featureUids,
      artifactClassificationUids: featureUids,
      evidenceEdgeUids: Array.from({ length: 16 }, (_, index) => wideUid('E', 3_000_000 + recordIndex * 16 + index)) },
    componentMatch: { matched: true, queryClassificationUids: componentUids,
      artifactClassificationUids: componentUids,
      evidenceEdgeUids: Array.from({ length: 16 }, (_, index) => wideUid('E', 4_000_000 + recordIndex * 16 + index)) },
    recency: { documentRevisionEpochDay: 3_652_058, evidenceUid: wideUid('D', 5_000_000 + recordIndex) },
    status: { value: 'deprecated', evidenceUid: wideUid('D', 6_000_000 + recordIndex) },
  }));
  const identity = {
    workspaceId: wideUid('WS', 1), snapshotId: SNAP('f'), authorizationScopeDigest: H('f'),
    queryReceipt: wideUid('D', 1), graphSnapshotId: SNAP('e'), graphPolicyVersion: 0xffff_ffff,
    recencyEpochDay: 3_652_058, authorityReceiptUid: wideUid('D', 2), rawFusionDigest: H('d'),
    evidenceContractVersion: 'rerank-pair-evidence-v1', authorityVerifierDigest: H('c'), evidenceDigest: H('b'),
  };
  const bytes = Buffer.byteLength(oracleCanonical({ identity, records }), 'utf8');
  assert.equal(bytes < MAX_RERANK_EVIDENCE_CANONICAL_BYTES_V1, true);
  assert.equal(bytes > 10_000_000, true);
});

test('feeds reranker V3 through a strict one-use receipt adapter', () => {
  const value = fixture({ distanceTwo: true });
  const built = run(value); assert.equal(built.result.ok, true);
  let verifierCalls = 0;
  const receipt = built.result.value.pageAuthorityReceipt;
  const reranker = createRrfBoundedRerankerV3({
    authorityVerifierDigest: VERIFIER_DIGEST,
    verifyEvidencePage({ rawFusion, evidencePage }) {
      verifierCalls += 1;
      return receipt.decision === 'verified'
        && receipt.authorityReceiptUid === evidencePage.identity.authorityReceiptUid
        && receipt.authorityVerifierDigest === evidencePage.identity.authorityVerifierDigest
        && receipt.rawFusionDigest === rawFusion.identity.rawFusionDigest
        && receipt.evidenceDigest === evidencePage.identity.evidenceDigest;
    },
  });
  const ranked = reranker.rerankRrfCompletePoolV3({
    rawFusion: value.request.rawFusion, evidencePage: built.result.value.evidencePage,
    policy: RERANK_FIXED_POLICY_V1, outputLimit: 4,
  });
  assert.equal(ranked.ok, true); assert.equal(verifierCalls, 1);
});

test('rejects pinned inclusion and graph set/order defects before every port', () => {
  const pinned = fixture({ pinned: true, pinnedInRaw: true });
  const first = run(pinned); assert.deepEqual(first.result, { ok: false, error: { code: 'source_binding_mismatch' } });
  assert.deepEqual(first.calls, { receipt: 0, metadata: 0, page: 0 });
  const value = fixture();
  for (const graphEvidenceRecords of [value.request.graphEvidenceRecords.slice(1),
    [...value.request.graphEvidenceRecords].reverse()]) {
    const active = harness(value), result = active.builder.buildRerankEvidencePageV1(
      replaceRequest(value, { graphEvidenceRecords: deepFreeze(graphEvidenceRecords) }),
    );
    assert.deepEqual(result, { ok: false, error: { code: 'evidence_unverified' } });
    assert.deepEqual(active.calls, { receipt: 0, metadata: 0, page: 0 });
  }
});

test('preserves graph-derived limit precedence before semantic evidence or ports', () => {
  for (const field of ['evidenceEdgeUids', 'authorityReceiptUids']) {
    const prefix = field === 'evidenceEdgeUids' ? 'E' : 'D';
    for (const oversized of [
      Array.from({ length: MAX_RERANK_TRACE_EDGES_V1 + 1 }, (_, index) => uid(prefix, 9_000_000 + index)),
      [`${prefix}-${'A'.repeat(MAX_RERANK_EVIDENCE_TEXT_BYTES_V1 - 1)}`],
    ]) {
      const value = fixture({ semanticCount: 1 });
      const record = value.request.graphEvidenceRecords[0];
      const graphEvidenceRecords = deepFreeze([
        { ...record, [field]: oversized },
        ...value.request.graphEvidenceRecords.slice(1),
      ]);
      const semanticEvidenceIdentity = deepFreeze({
        ...value.request.semanticEvidenceIdentity,
        semanticSourceContractVersion: 'wrong-semantic-source',
      });
      const active = harness(value, { searchThrow: true, metadataThrow: true, pageThrow: true });
      const result = active.builder.buildRerankEvidencePageV1(replaceRequest(value, {
        graphEvidenceRecords,
        semanticEvidenceIdentity,
      }));
      assert.deepEqual(result, { ok: false, error: { code: 'limit_exceeded' } });
      assert.deepEqual(active.calls, { receipt: 0, metadata: 0, page: 0 });
    }
  }
});

test('caps and exactly binds the semantic source contract before every port', () => {
  for (const [semanticSourceContractVersion, code] of [
    ['x'.repeat(MAX_RERANK_EVIDENCE_TEXT_BYTES_V1 + 1), 'limit_exceeded'],
    ['wrong-semantic-source', 'evidence_unverified'],
  ]) {
    const value = fixture({ semanticCount: 1 });
    const semanticEvidenceIdentity = deepFreeze({
      ...value.request.semanticEvidenceIdentity,
      semanticSourceContractVersion,
    });
    const active = harness(value, { searchThrow: true, metadataThrow: true, pageThrow: true });
    const result = active.builder.buildRerankEvidencePageV1(replaceRequest(value, {
      semanticEvidenceIdentity,
    }));
    assert.deepEqual(result, { ok: false, error: { code } });
    assert.deepEqual(active.calls, { receipt: 0, metadata: 0, page: 0 });
  }
});

test('preserves V3 incomplete-source precedence for every non-true complete value', () => {
  const value = fixture();
  for (const complete of [false, null, 'true', undefined]) {
    const first = value.request.rawFusion.identity.orderedSources[0];
    let changed;
    if (complete === undefined) {
      const { complete: _removed, ...withoutComplete } = first;
      changed = withoutComplete;
    } else changed = { ...first, complete };
    const orderedSources = deepFreeze([changed, ...value.request.rawFusion.identity.orderedSources.slice(1)]);
    const rawFusion = deepFreeze({
      identity: { ...value.request.rawFusion.identity, orderedSources }, hits: value.request.rawFusion.hits,
    });
    const active = harness(value);
    const result = active.builder.buildRerankEvidencePageV1(replaceRequest(value, { rawFusion }));
    assert.deepEqual(result, { ok: false, error: { code: 'incomplete_raw_pool' } });
    assert.deepEqual(active.calls, { receipt: 0, metadata: 0, page: 0 });
  }
});

test('rejects every binding family before authority', () => {
  const value = fixture();
  const mutations = [
    { context: deepFreeze({ ...value.request.context, snapshotId: SNAP('f') }) },
    { pin: deepFreeze({ ...value.request.pin, graphRoot: H('f') }) },
    { pin: deepFreeze({ ...value.request.pin, queryDigest: H('f') }) },
    { lexicalEvidenceIdentity: deepFreeze({ ...value.request.lexicalEvidenceIdentity, rankEvidenceDigest: H('0') }) },
    { graphEvidenceIdentity: deepFreeze({ ...value.request.graphEvidenceIdentity, evidenceDigest: H('0') }) },
  ];
  for (const mutation of mutations) {
    const active = harness(value), result = active.builder.buildRerankEvidencePageV1(replaceRequest(value, mutation));
    assert.deepEqual(result, { ok: false, error: { code: 'source_binding_mismatch' } });
    assert.deepEqual(active.calls, { receipt: 0, metadata: 0, page: 0 });
  }
});

test('enforces receipt, metadata, and page authority order and redacted failures', () => {
  const value = fixture();
  for (const [overrides, code, calls] of [
    [{ searchFalse: true }, 'unauthorized', { receipt: 1, metadata: 0, page: 0 }],
    [{ metadataThrow: true }, 'snapshot_unavailable', { receipt: 1, metadata: 1, page: 0 }],
    [{ pageFalse: true }, 'evidence_unverified', { receipt: 1, metadata: 1, page: 1 }],
  ]) {
    const active = run(value, overrides);
    assert.deepEqual(active.result, { ok: false, error: { code } });
    assert.deepEqual(active.calls, calls);
    assert.deepEqual(Object.keys(active.result.error), ['code']);
  }
});

test('rejects metadata set/order/digest defects and classification caps', () => {
  const value = fixture();
  const reversed = metadataWith(value, { records: deepFreeze([...value.metadata.records].reverse()) });
  assert.deepEqual(run(value, { metadata: reversed }).result, { ok: false, error: { code: 'snapshot_corrupt' } });
  const badDigest = deepFreeze({ ...value.metadata, authorizedMetadataDigest: H('0') });
  assert.deepEqual(run(value, { metadata: badDigest }).result, { ok: false, error: { code: 'snapshot_corrupt' } });
  const tooMany = Array.from({ length: 17 }, (_, index) => uid('F', index + 1));
  const capped = metadataWith(value, { queryFeatureUids: deepFreeze(tooMany) });
  assert.deepEqual(run(value, { metadata: capped }).result, { ok: false, error: { code: 'limit_exceeded' } });
});

test('caps oversized metadata arrays before enumeration or page authority', () => {
  const value = fixture();
  const target = new Array(3001); Object.freeze(target);
  let ownKeysCalls = 0;
  const oversizedRecords = new Proxy(target, {
    ownKeys() { ownKeysCalls += 1; throw new Error('must not enumerate'); },
  });
  const metadata = Object.freeze({
    ...value.metadata, records: oversizedRecords, authorizedMetadataDigest: H('0'),
  });
  const active = run(value, { metadata });
  assert.deepEqual(active.result, { ok: false, error: { code: 'limit_exceeded' } });
  assert.deepEqual(active.calls, { receipt: 1, metadata: 1, page: 0 });
  assert.equal(ownKeysCalls, 0);
});

test('fails closed on accessors, symbols, proxies, sparse arrays, Unicode, NUL, and oversize text', () => {
  const value = fixture();
  let getterCalls = 0;
  const accessor = { ...value.request };
  Object.defineProperty(accessor, 'context', { enumerable: true, get() { getterCalls += 1; return value.request.context; } });
  assert.deepEqual(harness(value).builder.buildRerankEvidencePageV1(accessor), { ok: false, error: { code: 'invalid_request' } });
  assert.equal(getterCalls, 0);
  const symbol = { ...value.request, [Symbol('hidden')]: true };
  assert.deepEqual(harness(value).builder.buildRerankEvidencePageV1(symbol), { ok: false, error: { code: 'invalid_request' } });
  const proxy = new Proxy(value.request, { ownKeys() { throw new Error('hostile'); } });
  assert.deepEqual(harness(value).builder.buildRerankEvidencePageV1(proxy), { ok: false, error: { code: 'invalid_request' } });
  const sparse = new Array(2); sparse[0] = value.request.graphEvidenceRecords[0]; Object.freeze(sparse);
  const sparseResult = harness(value).builder.buildRerankEvidencePageV1(replaceRequest(value, { graphEvidenceRecords: sparse }));
  assert.equal(sparseResult.error.code, 'evidence_unverified');
  for (const analyzerIdentity of ['bad\ud800', 'bad\0value', 'x'.repeat(513)]) {
    const context = deepFreeze({ ...value.request.context, analyzerIdentity });
    const pin = deepFreeze({ ...value.request.pin, analyzerIdentity });
    const result = harness(value).builder.buildRerankEvidencePageV1(replaceRequest(value, { context, pin }));
    assert.equal(result.error.code, analyzerIdentity.length > 512 ? 'limit_exceeded' : 'invalid_request');
  }
});

test('returns deterministic deeply frozen output without mutating upstream inputs', () => {
  const value = fixture({ distanceTwo: true });
  const before = oracleCanonical(value.request);
  const one = run(value).result, two = run(value).result;
  assert.equal(one.ok, true); assert.deepEqual(one, two);
  assert.equal(oracleCanonical(value.request), before);
  assert.equal(Object.isFrozen(one), true);
  assert.equal(Object.isFrozen(one.value.evidencePage.records[0].status), true);
  assert.throws(() => { one.value.counters.rawPoolHits = 0; }, TypeError);
});
