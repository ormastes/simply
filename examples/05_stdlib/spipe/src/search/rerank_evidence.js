import { createHash } from 'node:crypto';

import { assertCanonicalUid, normalizeRevision } from '../model/identity.js';
import { GRAPH_CANDIDATE_CONTRACT_V1 } from './graph_candidates.js';
import { LEXICAL_SOURCE_CONTRACT_V1 } from './lexical_source.js';
import {
  RRF_ARITHMETIC_CONTRACT_V2,
  RRF_MAX_POOL_HITS_V2,
  RRF_MAX_SOURCE_K_V2,
  RRF_POOL_CONTRACT_V2,
  RRF_SCALE_V1,
  unsignedUtf8CompareV1,
} from './fusion.js';

export const RERANK_EVIDENCE_BUILDER_CONTRACT_V1 = 'spipe-authorized-rerank-evidence-builder-v1';
export const RERANK_EVIDENCE_PAGE_AUTHORITY_V1 = 'spipe-rerank-evidence-page-authority-v1';
export const MAX_RERANK_EVIDENCE_POOL_HITS_V1 = 3000;
export const MAX_RERANK_EVIDENCE_SOURCE_HITS_V1 = 1000;
export const MAX_RERANK_CLASSIFICATION_REFS_V1 = 16;
export const MAX_RERANK_TRACE_EDGES_V1 = 3;
export const MAX_RERANK_EVIDENCE_TEXT_BYTES_V1 = 512;
export const MAX_RERANK_EVIDENCE_CANONICAL_BYTES_V1 = 16_777_216;

const RERANK_EVIDENCE_CONTRACT = 'rerank-pair-evidence-v1';
const SEMANTIC_SOURCE_CONTRACT = 'semantic-source-v1';
const METADATA_SCHEMA = 'spipe-authorized-rerank-metadata-v1';
const BINDING_DOMAIN = 'spipe-rerank-evidence-binding-v1\0';
const METADATA_DOMAIN = 'spipe-authorized-rerank-metadata-v1\0';
const SOURCE_EVIDENCE_DOMAIN = 'spipe-rerank-source-evidence-v1\0';
const RECORD_SET_DOMAIN = 'spipe-rerank-evidence-record-set-v1\0';
const PAGE_RECEIPT_UID_DOMAIN = 'spipe-rerank-evidence-page-receipt-uid-v1\0';
const RERANK_EVIDENCE_DOMAIN = 'spipe-rerank-pair-evidence-v1\0';
const SOURCE_POOL_DOMAIN = 'spipe-rrf-source-pool-v1\0';
const COMPLETE_SOURCE_SET_DOMAIN = 'spipe-rrf-complete-source-set-v1\0';
const COMPLETE_OUTPUT_DOMAIN = 'spipe-rrf-complete-output-v1\0';
const LEXICAL_BINDING_DOMAIN = 'spipe-authorized-lexical-binding-v1\0';
const LEXICAL_SOURCE_DOMAIN = 'spipe-authorized-lexical-source-v1\0';
const GRAPH_EVIDENCE_DOMAIN = 'spipe-graph-candidate-evidence-v1\0';
const GRAPH_SOURCE_DOMAIN = 'spipe-graph-source-identity-v1\0';
const HASH = /^sha256:[0-9a-f]{64}$/;
const SNAPSHOT = /^spks1-[0-9a-f]{64}$/;
const UINT32_MAX = 0xffff_ffff;
const MAX_EPOCH_DAY = 3_652_058;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const CONFIG_FIELDS = ['verifySearchReceipt', 'readAuthorizedRerankMetadata', 'verifyRerankEvidencePage', 'authorityVerifierDigest'];
const REQUEST_FIELDS = ['contractVersion', 'operation', 'context', 'pin', 'pinnedArtifactUid', 'rawFusion', 'lexicalEvidenceIdentity', 'graphEvidenceIdentity', 'graphEvidenceRecords', 'semanticEvidenceIdentity'];
const CONTEXT_FIELDS = ['workspaceId', 'snapshotId', 'authorizationScopeDigest', 'queryReceipt', 'analyzerIdentity'];
const PIN_FIELDS = ['workspaceUid', 'projectUid', 'worktreeUid', 'revisionId', 'snapshotId', 'lexicalRoot', 'graphSnapshotId', 'graphRoot', 'metadataSnapshotId', 'metadataRoot', 'authorizationScopeDigest', 'policyHash', 'policyVersion', 'searchReceiptUid', 'analyzerIdentity', 'queryDigest', 'recencyEpochDay'];
const RAW_FIELDS = ['identity', 'hits'];
const RAW_IDENTITY_FIELDS = ['contractVersion', 'arithmeticContractVersion', 'k', 'sourceK', 'orderedSources', 'context', 'complete', 'uniqueDocumentCount', 'sourcePoolDigest', 'rawFusionDigest'];
const SOURCE_FIELDS = ['name', 'sourceIdentity', 'complete', 'candidateCount', 'candidateDigest'];
const HIT_FIELDS = ['documentId', 'fusedRank', 'rawScoreUnits', 'contributions'];
const CONTRIBUTION_FIELDS = ['source', 'sourceIdentity', 'sourceRank', 'contributionUnits'];
const LEXICAL_FIELDS = ['lexicalSourceContractVersion', 'workspaceUid', 'projectUid', 'worktreeUid', 'revisionId', 'snapshotId', 'lexicalRoot', 'authorizationScopeDigest', 'policyHash', 'policyVersion', 'searchReceiptUid', 'analyzerIdentity', 'scoreContractVersion', 'providerContractVersion', 'providerImplementationDigest', 'queryDigest', 'bindingDigest', 'sourceK', 'excludedDocumentUid', 'exclusionApplied', 'providerPageCount', 'providerCandidateCount', 'authorityReceiptUid', 'pageSetDigest', 'rankEvidenceDigest', 'sourceIdentity', 'candidateDigest'];
const GRAPH_IDENTITY_FIELDS = ['graphCandidateContractVersion', 'graphSnapshotId', 'graphRoot', 'authorizationScopeDigest', 'policyHash', 'policyVersion', 'searchReceiptUid', 'authorizedGraphDigest', 'acceptedEdgeSetDigest', 'evidenceDigest'];
const GRAPH_RECORD_FIELDS = ['documentId', 'distance', 'rootArtifactUid', 'acceptedEdgeEvidence', 'evidenceEdgeUids', 'authorityReceiptUids'];
const EDGE_PAIR_FIELDS = ['edgeUid', 'authorityReceiptUid'];
const SEMANTIC_FIELDS = ['semanticSourceContractVersion', 'sourceIdentity', 'candidateDigest', 'evidenceDigest', 'authorityReceiptUid'];
const METADATA_FIELDS = ['schema', 'workspaceUid', 'projectUid', 'worktreeUid', 'revisionId', 'snapshotId', 'metadataSnapshotId', 'metadataRoot', 'authorizationScopeDigest', 'policyHash', 'policyVersion', 'searchReceiptUid', 'analyzerIdentity', 'queryDigest', 'recencyEpochDay', 'queryFeatureUids', 'queryComponentUids', 'records', 'authorizedMetadataDigest'];
const METADATA_RECORD_FIELDS = ['documentId', 'features', 'components', 'documentRevisionEpochDay', 'recencyAuthorityReceiptUid', 'status', 'statusAuthorityReceiptUid'];
const CLASSIFICATION_REF_FIELDS = ['classificationUid', 'edgeUid', 'authorityReceiptUid'];

function success(value) { return freezeDeep({ ok: true, value }); }
function failure(code) { return freezeDeep({ ok: false, error: { code } }); }

function closedRecord(value, fields, frozen = false) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    if (frozen && !Object.isFrozen(value)) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key))) return null;
    const result = Object.create(null);
    for (const field of fields) {
      const descriptor = descriptors[field];
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')
          || Object.hasOwn(descriptor, 'get') || Object.hasOwn(descriptor, 'set')
          || descriptor.enumerable !== true) return null;
      result[field] = descriptor.value;
    }
    return Object.freeze(result);
  } catch (_error) { return null; }
}

function subsetRecord(value, fields, frozen = false) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    if (frozen && !Object.isFrozen(value)) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== 'string' || !fields.includes(key))) return null;
    const result = Object.create(null);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!Object.hasOwn(descriptor, 'value') || Object.hasOwn(descriptor, 'get')
          || Object.hasOwn(descriptor, 'set') || descriptor.enumerable !== true) return null;
      result[key] = descriptor.value;
    }
    return Object.freeze(result);
  } catch (_error) { return null; }
}

function denseArray(value, maximum, frozen = false) {
  if (!Array.isArray(value)) return { kind: 'invalid' };
  try {
    const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, 'length');
    if (lengthDescriptor === undefined || !Object.hasOwn(lengthDescriptor, 'value')
        || Object.hasOwn(lengthDescriptor, 'get') || Object.hasOwn(lengthDescriptor, 'set')
        || lengthDescriptor.enumerable !== false || !Number.isSafeInteger(lengthDescriptor.value)
        || lengthDescriptor.value < 0) return { kind: 'invalid' };
    const length = lengthDescriptor.value;
    if (length > maximum) return { kind: 'limit' };
    if (frozen && !Object.isFrozen(value)) return { kind: 'invalid' };
    const keys = Reflect.ownKeys(value);
    if (keys.length !== length + 1 || keys.some((key) => typeof key !== 'string')) return { kind: 'invalid' };
    const result = new Array(length);
    for (let index = 0; index < length; index += 1) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')
          || Object.hasOwn(descriptor, 'get') || Object.hasOwn(descriptor, 'set')
          || descriptor.enumerable !== true) return { kind: 'invalid' };
      result[index] = descriptor.value;
    }
    return { kind: 'ok', value: Object.freeze(result) };
  } catch (_error) { return { kind: 'invalid' }; }
}

function freezeDeep(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) freezeDeep(child, seen);
  return Object.freeze(value);
}

function deeplyFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== 'object') return true;
  if (seen.has(value)) return true;
  try {
    if (!Object.isFrozen(value)) return false;
    seen.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const descriptor of Object.values(descriptors)) {
      if (Object.hasOwn(descriptor, 'get') || Object.hasOwn(descriptor, 'set')) return false;
      if (Object.hasOwn(descriptor, 'value') && !deeplyFrozen(descriptor.value, seen)) return false;
    }
    return true;
  } catch (_error) { return false; }
}

function scalar(value) {
  if (typeof value !== 'string') return null;
  for (let index = 0; index < value.length; index += 1) {
    const high = value.charCodeAt(index);
    if (high >= 0xd800 && high <= 0xdbff) {
      if (index + 1 >= value.length) return null;
      const low = value.charCodeAt(index + 1);
      if (low < 0xdc00 || low > 0xdfff) return null;
      index += 1;
    } else if (high >= 0xdc00 && high <= 0xdfff) return null;
  }
  return value;
}

function textKind(value, allowNul = false) {
  const valid = scalar(value);
  if (valid === null || valid.length === 0 || (!allowNul && valid.includes('\0'))) return 'invalid';
  return Buffer.byteLength(valid, 'utf8') > MAX_RERANK_EVIDENCE_TEXT_BYTES_V1 ? 'limit' : 'ok';
}

function canonicalUid(value, prefixes) {
  try { return assertCanonicalUid(value, 'uid', prefixes); } catch (_error) { return null; }
}

function validHash(value) { return typeof value === 'string' && HASH.test(value); }

function validRevision(value) {
  try { return normalizeRevision(value, 'revisionId') === value; } catch (_error) { return false; }
}

function canonicalValue(value, seen = new Set()) {
  if (value === null) return 'null';
  if (typeof value === 'string') {
    if (scalar(value) === null) throw new TypeError('invalid Unicode scalar');
    return JSON.stringify(value.normalize('NFC'));
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) throw new TypeError('invalid integer');
    return String(value);
  }
  if (typeof value !== 'object' || seen.has(value) || value === undefined) throw new TypeError('unsupported canonical value');
  seen.add(value);
  try {
    if (Array.isArray(value)) return `[${value.map((item) => canonicalValue(item, seen)).join(',')}]`;
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${canonicalValue(key)}:${canonicalValue(value[key], seen)}`).join(',')}}`;
  } finally { seen.delete(value); }
}

function digest(domain, value) {
  return `sha256:${createHash('sha256').update(domain, 'utf8').update(canonicalValue(value), 'utf8').digest('hex')}`;
}

function canonicalByteSize(value, limit, seen = new Set()) {
  let total = 0;
  const add = (count) => { total += count; if (total > limit) throw new RangeError('canonical limit'); };
  const walk = (item) => {
    if (item === null) { add(4); return; }
    if (typeof item === 'string') { add(Buffer.byteLength(canonicalValue(item), 'utf8')); return; }
    if (typeof item === 'boolean') { add(item ? 4 : 5); return; }
    if (typeof item === 'number') { add(Buffer.byteLength(canonicalValue(item), 'utf8')); return; }
    if (typeof item !== 'object' || seen.has(item)) throw new TypeError('unsupported canonical value');
    seen.add(item);
    if (Array.isArray(item)) {
      add(2); for (let index = 0; index < item.length; index += 1) { if (index > 0) add(1); walk(item[index]); }
    } else {
      add(2); const keys = Object.keys(item).sort();
      for (let index = 0; index < keys.length; index += 1) {
        if (index > 0) add(1); add(Buffer.byteLength(canonicalValue(keys[index]), 'utf8') + 1); walk(item[keys[index]]);
      }
    }
    seen.delete(item);
  };
  walk(value);
  return total;
}

function sameScalars(actual, expected, fields) {
  return fields.every((field) => actual[field] === expected[field]);
}

function candidateDigest(name, sourceIdentity, documentIds) {
  return digest(SOURCE_POOL_DOMAIN, { name, sourceIdentity, documentIds });
}

function normalizeRaw(rawFusion) {
  const raw = subsetRecord(rawFusion, RAW_FIELDS, true);
  if (raw === null) return failure('invalid_raw_identity');
  const identity = subsetRecord(raw.identity, RAW_IDENTITY_FIELDS, true);
  if (identity === null || identity.contractVersion !== RRF_POOL_CONTRACT_V2
      || identity.arithmeticContractVersion !== RRF_ARITHMETIC_CONTRACT_V2
      || !Number.isSafeInteger(identity.k) || identity.k < 1 || identity.k > 10000
      || !Number.isSafeInteger(identity.sourceK) || identity.sourceK < 1 || identity.sourceK > RRF_MAX_SOURCE_K_V2
      || !Number.isSafeInteger(identity.uniqueDocumentCount) || identity.uniqueDocumentCount < 0
      || identity.uniqueDocumentCount > RRF_MAX_POOL_HITS_V2
      || !validHash(identity.sourcePoolDigest) || !validHash(identity.rawFusionDigest)) return failure('invalid_raw_identity');
  const context = subsetRecord(identity.context, CONTEXT_FIELDS, true);
  const sourcesResult = denseArray(identity.orderedSources, 3, true);
  if (context === null || CONTEXT_FIELDS.some((field) => textKind(context[field], true) !== 'ok')
      || sourcesResult.kind !== 'ok' || sourcesResult.value.length < 2) return failure('invalid_raw_identity');
  const sourceNames = ['lexical', 'graph', 'semantic'];
  const sources = [], sourceMap = new Map();
  for (let index = 0; index < sourcesResult.value.length; index += 1) {
    const source = subsetRecord(sourcesResult.value[index], SOURCE_FIELDS, true);
    if (source === null || source.name !== sourceNames[index] || textKind(source.sourceIdentity, true) !== 'ok'
        || !Number.isSafeInteger(source.candidateCount)
        || source.candidateCount < 0 || source.candidateCount > identity.sourceK
        || !validHash(source.candidateDigest)) return failure('invalid_raw_identity');
    const normalized = freezeDeep({ ...source });
    sources.push(normalized);
    sourceMap.set(source.name, { identity: normalized, documentIds: new Array(source.candidateCount) });
  }
  if (identity.complete !== true || sources.some((source) => source.complete !== true)) {
    return failure('incomplete_raw_pool');
  }
  const hitsResult = denseArray(raw.hits, MAX_RERANK_EVIDENCE_POOL_HITS_V1, true);
  if (hitsResult.kind !== 'ok') return failure('invalid_raw_hit_page');
  if (identity.uniqueDocumentCount !== hitsResult.value.length) return failure('raw_pool_count_mismatch');
  const hits = [], seenDocuments = new Set(), claimedRanks = new Set();
  for (let index = 0; index < hitsResult.value.length; index += 1) {
    const hit = subsetRecord(hitsResult.value[index], HIT_FIELDS, true);
    if (hit === null || textKind(hit.documentId, true) !== 'ok' || seenDocuments.has(hit.documentId)
        || hit.fusedRank !== index + 1 || !Number.isSafeInteger(hit.rawScoreUnits) || hit.rawScoreUnits < 0) {
      return failure('invalid_raw_hit_page');
    }
    seenDocuments.add(hit.documentId);
    const contributionsResult = denseArray(hit.contributions, sources.length, true);
    if (contributionsResult.kind !== 'ok' || contributionsResult.value.length < 1) return failure('invalid_raw_hit_page');
    let sum = 0, previousSourceIndex = -1;
    for (const rawContribution of contributionsResult.value) {
      const contribution = subsetRecord(rawContribution, CONTRIBUTION_FIELDS, true);
      if (contribution === null || !sourceMap.has(contribution.source)) return failure('invalid_raw_hit_page');
      const source = sourceMap.get(contribution.source);
      const sourceIndex = sourceNames.indexOf(contribution.source);
      if (contribution.sourceIdentity !== source.identity.sourceIdentity || sourceIndex <= previousSourceIndex
          || !Number.isSafeInteger(contribution.sourceRank) || contribution.sourceRank < 1
          || contribution.sourceRank > source.identity.candidateCount) return failure('invalid_raw_hit_page');
      const expected = Math.floor(RRF_SCALE_V1 / (identity.k + contribution.sourceRank));
      if (contribution.contributionUnits !== expected) return failure('invalid_raw_hit_page');
      const rankKey = `${contribution.source}\0${contribution.sourceRank}`;
      if (claimedRanks.has(rankKey)) return failure('invalid_raw_hit_page');
      claimedRanks.add(rankKey); source.documentIds[contribution.sourceRank - 1] = hit.documentId;
      sum += expected; if (!Number.isSafeInteger(sum)) return failure('arithmetic_overflow');
      previousSourceIndex = sourceIndex;
    }
    if (sum !== hit.rawScoreUnits) return failure('invalid_raw_hit_page');
    if (hits.length > 0) {
      const prior = hits[hits.length - 1];
      if (prior.rawScoreUnits < hit.rawScoreUnits
          || (prior.rawScoreUnits === hit.rawScoreUnits && unsignedUtf8CompareV1(prior.documentId, hit.documentId) >= 0)) {
        return failure('invalid_raw_hit_page');
      }
    }
    hits.push(freezeDeep({ documentId: hit.documentId, rawScoreUnits: hit.rawScoreUnits }));
  }
  const candidateTotal = sources.reduce((total, source) => total + source.candidateCount, 0);
  if (claimedRanks.size !== candidateTotal) return failure('raw_pool_count_mismatch');
  for (const source of sources) {
    const state = sourceMap.get(source.name);
    if (state.documentIds.some((documentId) => documentId === undefined)) return failure('raw_pool_count_mismatch');
    if (candidateDigest(source.name, source.sourceIdentity, state.documentIds) !== source.candidateDigest) {
      return failure('raw_fusion_digest_mismatch');
    }
    state.documentIds = Object.freeze(state.documentIds);
  }
  const orderedSources = Object.freeze(sources);
  if (digest(COMPLETE_SOURCE_SET_DOMAIN, orderedSources) !== identity.sourcePoolDigest) {
    return failure('raw_fusion_digest_mismatch');
  }
  const identityWithoutDigest = freezeDeep({
    contractVersion: identity.contractVersion, arithmeticContractVersion: identity.arithmeticContractVersion,
    k: identity.k, sourceK: identity.sourceK, orderedSources, context: { ...context }, complete: true,
    uniqueDocumentCount: identity.uniqueDocumentCount, sourcePoolDigest: identity.sourcePoolDigest,
  });
  if (digest(COMPLETE_OUTPUT_DOMAIN, { identity: identityWithoutDigest, hits: raw.hits }) !== identity.rawFusionDigest) {
    return failure('raw_fusion_digest_mismatch');
  }
  return success({ identity: { ...identityWithoutDigest, rawFusionDigest: identity.rawFusionDigest }, hits, sourceMap });
}

function requestScalars(request) {
  const context = closedRecord(request.context, CONTEXT_FIELDS, true);
  const pin = closedRecord(request.pin, PIN_FIELDS, true);
  if (context === null || pin === null || !deeplyFrozen(request.context) || !deeplyFrozen(request.pin)
      || request.contractVersion !== RERANK_EVIDENCE_BUILDER_CONTRACT_V1
      || request.operation !== 'build_rerank_evidence') return failure('invalid_request');
  const checks = [
    [pin.workspaceUid, ['WS']], [pin.projectUid, ['P']], [pin.worktreeUid, ['WT', 'W']],
    [pin.searchReceiptUid, ['D']], [request.pinnedArtifactUid, ['A']],
  ];
  let limited = false;
  for (const [value, prefixes] of checks) {
    if (value === null && prefixes[0] === 'A') continue;
    const kind = textKind(value); if (kind === 'limit') limited = true;
    else if (kind !== 'ok' || canonicalUid(value, prefixes) === null) return failure('invalid_request');
  }
  for (const value of [pin.revisionId, pin.snapshotId, pin.lexicalRoot, pin.graphSnapshotId,
    pin.graphRoot, pin.metadataSnapshotId, pin.metadataRoot, pin.authorizationScopeDigest,
    pin.policyHash, pin.analyzerIdentity, pin.queryDigest, ...CONTEXT_FIELDS.map((field) => context[field])]) {
    const kind = textKind(value); if (kind === 'limit') limited = true; else if (kind !== 'ok') return failure('invalid_request');
  }
  if (limited) return failure('limit_exceeded');
  if (!validRevision(pin.revisionId) || !SNAPSHOT.test(pin.snapshotId) || !SNAPSHOT.test(pin.graphSnapshotId)
      || !SNAPSHOT.test(pin.metadataSnapshotId) || ![pin.lexicalRoot, pin.graphRoot, pin.metadataRoot,
        pin.authorizationScopeDigest, pin.policyHash, pin.queryDigest].every(validHash)
      || !Number.isSafeInteger(pin.policyVersion) || pin.policyVersion < 0 || pin.policyVersion > UINT32_MAX
      || !(pin.recencyEpochDay === null || (Number.isSafeInteger(pin.recencyEpochDay)
        && pin.recencyEpochDay >= 0 && pin.recencyEpochDay <= MAX_EPOCH_DAY))) return failure('invalid_request');
  return success({ context: freezeDeep({ ...context }), pin: freezeDeep({ ...pin }) });
}

function normalizeLexical(identityValue, pin, raw, pinnedArtifactUid) {
  const identity = closedRecord(identityValue, LEXICAL_FIELDS, true);
  if (identity === null || !deeplyFrozen(identityValue)) return failure('source_binding_mismatch');
  const lexicalState = raw.sourceMap.get('lexical');
  const expectedScalars = {
    lexicalSourceContractVersion: LEXICAL_SOURCE_CONTRACT_V1,
    workspaceUid: pin.workspaceUid, projectUid: pin.projectUid, worktreeUid: pin.worktreeUid,
    revisionId: pin.revisionId, snapshotId: pin.snapshotId, lexicalRoot: pin.lexicalRoot,
    authorizationScopeDigest: pin.authorizationScopeDigest, policyHash: pin.policyHash,
    policyVersion: pin.policyVersion, searchReceiptUid: pin.searchReceiptUid,
    analyzerIdentity: pin.analyzerIdentity, queryDigest: pin.queryDigest,
    sourceK: raw.identity.sourceK, excludedDocumentUid: pinnedArtifactUid,
    exclusionApplied: pinnedArtifactUid !== null, providerCandidateCount: lexicalState.documentIds.length,
    sourceIdentity: lexicalState.identity.sourceIdentity, candidateDigest: lexicalState.identity.candidateDigest,
  };
  if (!sameScalars(identity, expectedScalars, Object.keys(expectedScalars))
      || identity.scoreContractVersion !== 'bm25-fixed-v1'
      || identity.providerContractVersion !== 'spipe-search-provider/1.0'
      || !validHash(identity.providerImplementationDigest) || !validHash(identity.bindingDigest)
      || !validHash(identity.pageSetDigest) || !validHash(identity.rankEvidenceDigest)
      || !validHash(identity.sourceIdentity) || !validHash(identity.candidateDigest)
      || canonicalUid(identity.authorityReceiptUid, ['D']) === null
      || !Number.isSafeInteger(identity.providerPageCount) || identity.providerPageCount < 1 || identity.providerPageCount > 64
      || !Number.isSafeInteger(identity.providerCandidateCount) || identity.providerCandidateCount < 0
      || identity.providerCandidateCount > MAX_RERANK_EVIDENCE_SOURCE_HITS_V1) return failure('source_binding_mismatch');
  const lexicalBinding = freezeDeep({
    contractVersion: LEXICAL_SOURCE_CONTRACT_V1, operation: 'lexical_source', workspaceUid: pin.workspaceUid,
    projectUid: pin.projectUid, worktreeUid: pin.worktreeUid, revisionId: pin.revisionId,
    snapshotId: pin.snapshotId, lexicalRoot: pin.lexicalRoot, authorizationScopeDigest: pin.authorizationScopeDigest,
    policyHash: pin.policyHash, policyVersion: pin.policyVersion, searchReceiptUid: pin.searchReceiptUid,
    analyzerIdentity: pin.analyzerIdentity, queryDigest: pin.queryDigest, sourceK: raw.identity.sourceK,
    excludedDocumentUid: pinnedArtifactUid,
  });
  if (digest(LEXICAL_BINDING_DOMAIN, lexicalBinding) !== identity.bindingDigest) return failure('source_binding_mismatch');
  const providerIdentity = freezeDeep({
    providerContractVersion: identity.providerContractVersion,
    providerImplementationDigest: identity.providerImplementationDigest,
    analyzerIdentity: identity.analyzerIdentity, scoreContractVersion: identity.scoreContractVersion,
  });
  const expectedSourceIdentity = digest(LEXICAL_SOURCE_DOMAIN, {
    contractVersion: LEXICAL_SOURCE_CONTRACT_V1, bindingDigest: identity.bindingDigest,
    providerIdentity, queryDigest: identity.queryDigest, sourceK: identity.sourceK,
    excludedDocumentUid: identity.excludedDocumentUid, rankEvidenceDigest: identity.rankEvidenceDigest,
    documentIds: lexicalState.documentIds,
  });
  return expectedSourceIdentity === identity.sourceIdentity ? success(freezeDeep({ ...identity })) : failure('source_binding_mismatch');
}

function sortedExact(array, prefix, maximum) {
  const result = denseArray(array, maximum, true);
  if (result.kind !== 'ok') return result;
  let prior = null;
  for (const uid of result.value) {
    const kind = textKind(uid);
    if (kind === 'limit') return { kind: 'limit' };
    if (kind !== 'ok' || canonicalUid(uid, [prefix]) === null
        || (prior !== null && unsignedUtf8CompareV1(prior, uid) >= 0)) return { kind: 'invalid' };
    prior = uid;
  }
  return result;
}

function normalizeGraph(identityValue, recordsValue, pin, raw, pinnedArtifactUid) {
  const identity = closedRecord(identityValue, GRAPH_IDENTITY_FIELDS, true);
  if (identity === null || !deeplyFrozen(identityValue)) return failure('evidence_unverified');
  const expected = {
    graphCandidateContractVersion: GRAPH_CANDIDATE_CONTRACT_V1, graphSnapshotId: pin.graphSnapshotId,
    graphRoot: pin.graphRoot, authorizationScopeDigest: pin.authorizationScopeDigest,
    policyHash: pin.policyHash, policyVersion: pin.policyVersion, searchReceiptUid: pin.searchReceiptUid,
  };
  if (!sameScalars(identity, expected, Object.keys(expected))
      || ![identity.authorizedGraphDigest, identity.acceptedEdgeSetDigest, identity.evidenceDigest].every(validHash)) {
    return failure('source_binding_mismatch');
  }
  const graphState = raw.sourceMap.get('graph');
  const recordsResult = denseArray(recordsValue, MAX_RERANK_EVIDENCE_SOURCE_HITS_V1, true);
  if (recordsResult.kind === 'limit') return failure('limit_exceeded');
  if (recordsResult.kind !== 'ok' || recordsResult.value.length !== graphState.documentIds.length) {
    return failure('evidence_unverified');
  }
  const lexicalIds = raw.sourceMap.get('lexical').documentIds;
  const roots = new Set(lexicalIds); if (pinnedArtifactUid !== null) roots.add(pinnedArtifactUid);
  const normalized = [];
  for (let index = 0; index < recordsResult.value.length; index += 1) {
    const record = closedRecord(recordsResult.value[index], GRAPH_RECORD_FIELDS, true);
    if (record === null) return failure('evidence_unverified');
    const recordTextKinds = [record.documentId, record.rootArtifactUid].map((value) => textKind(value));
    if (recordTextKinds.includes('limit')) return failure('limit_exceeded');
    if (recordTextKinds.includes('invalid') || record.documentId !== graphState.documentIds[index]
        || canonicalUid(record.documentId, ['A']) === null || !roots.has(record.rootArtifactUid)
        || ![1, 2, 3].includes(record.distance)) return failure('evidence_unverified');
    const pairsResult = denseArray(record.acceptedEdgeEvidence, MAX_RERANK_TRACE_EDGES_V1, true);
    if (pairsResult.kind === 'limit') return failure('limit_exceeded');
    if (pairsResult.kind !== 'ok' || pairsResult.value.length !== record.distance) return failure('evidence_unverified');
    const pairs = [], edges = new Set(), receipts = new Set();
    for (const pairValue of pairsResult.value) {
      const pair = closedRecord(pairValue, EDGE_PAIR_FIELDS, true);
      if (pair === null) return failure('evidence_unverified');
      const pairTextKinds = [pair.edgeUid, pair.authorityReceiptUid].map((value) => textKind(value));
      if (pairTextKinds.includes('limit')) return failure('limit_exceeded');
      if (pairTextKinds.includes('invalid') || canonicalUid(pair.edgeUid, ['E']) === null
          || canonicalUid(pair.authorityReceiptUid, ['D']) === null || edges.has(pair.edgeUid)) return failure('evidence_unverified');
      edges.add(pair.edgeUid); receipts.add(pair.authorityReceiptUid); pairs.push(freezeDeep({ ...pair }));
    }
    const evidenceEdgeUids = Object.freeze([...edges].sort(unsignedUtf8CompareV1));
    const authorityReceiptUids = Object.freeze([...receipts].sort(unsignedUtf8CompareV1));
    const rawEdges = sortedExact(record.evidenceEdgeUids, 'E', MAX_RERANK_TRACE_EDGES_V1);
    const rawReceipts = sortedExact(record.authorityReceiptUids, 'D', MAX_RERANK_TRACE_EDGES_V1);
    if (rawEdges.kind === 'limit' || rawReceipts.kind === 'limit') return failure('limit_exceeded');
    if (rawEdges.kind !== 'ok' || rawReceipts.kind !== 'ok'
        || canonicalValue(rawEdges.value) !== canonicalValue(evidenceEdgeUids)
        || canonicalValue(rawReceipts.value) !== canonicalValue(authorityReceiptUids)) return failure('evidence_unverified');
    normalized.push(freezeDeep({
      documentId: record.documentId, distance: record.distance, rootArtifactUid: record.rootArtifactUid,
      acceptedEdgeEvidence: pairs, evidenceEdgeUids, authorityReceiptUids,
    }));
  }
  const evidenceDigest = digest(GRAPH_EVIDENCE_DOMAIN, normalized.map((record) => ({
    documentId: record.documentId, distance: record.distance, rootArtifactUid: record.rootArtifactUid,
    acceptedEdgeEvidence: record.acceptedEdgeEvidence,
  })));
  if (evidenceDigest !== identity.evidenceDigest) return failure('source_binding_mismatch');
  const graphPin = freezeDeep({
    workspaceUid: pin.workspaceUid, projectUid: pin.projectUid, worktreeUid: pin.worktreeUid,
    revisionId: pin.revisionId, graphSnapshotId: pin.graphSnapshotId, graphRoot: pin.graphRoot,
    authorizationScopeDigest: pin.authorizationScopeDigest, policyHash: pin.policyHash,
    policyVersion: pin.policyVersion, searchReceiptUid: pin.searchReceiptUid,
  });
  const rootRecords = [
    ...(pinnedArtifactUid === null ? [] : [{ documentId: pinnedArtifactUid, seedTier: 0, seedRank: 0 }]),
    ...lexicalIds.map((documentId, index) => ({ documentId, seedTier: 1, seedRank: index + 1 })),
  ];
  const expectedSourceIdentity = digest(GRAPH_SOURCE_DOMAIN, {
    contractVersion: GRAPH_CANDIDATE_CONTRACT_V1, pin: graphPin, roots: rootRecords,
    sourceK: raw.identity.sourceK, authorizedGraphDigest: identity.authorizedGraphDigest,
    acceptedEdgeSetDigest: identity.acceptedEdgeSetDigest, evidenceDigest: identity.evidenceDigest,
  });
  if (expectedSourceIdentity !== graphState.identity.sourceIdentity
      || candidateDigest('graph', expectedSourceIdentity, graphState.documentIds) !== graphState.identity.candidateDigest) {
    return failure('source_binding_mismatch');
  }
  return success({ identity: freezeDeep({ ...identity }), records: Object.freeze(normalized) });
}

function normalizeSemantic(identityValue, raw) {
  const state = raw.sourceMap.get('semantic');
  if (state === undefined) return identityValue === null ? success(null) : failure('source_binding_mismatch');
  const identity = closedRecord(identityValue, SEMANTIC_FIELDS, true);
  if (identity === null || !deeplyFrozen(identityValue)) return failure('evidence_unverified');
  const contractKind = textKind(identity.semanticSourceContractVersion);
  if (contractKind === 'limit') return failure('limit_exceeded');
  if (contractKind !== 'ok' || identity.semanticSourceContractVersion !== SEMANTIC_SOURCE_CONTRACT
      || !validHash(identity.sourceIdentity) || !validHash(identity.candidateDigest)
      || !validHash(identity.evidenceDigest) || canonicalUid(identity.authorityReceiptUid, ['D']) === null) {
    return failure('evidence_unverified');
  }
  if (identity.sourceIdentity !== state.identity.sourceIdentity
      || identity.candidateDigest !== state.identity.candidateDigest
      || candidateDigest('semantic', identity.sourceIdentity, state.documentIds) !== identity.candidateDigest) {
    return failure('source_binding_mismatch');
  }
  return success(freezeDeep({ ...identity }));
}

function classificationRefs(value, prefix) {
  const refsResult = denseArray(value, MAX_RERANK_CLASSIFICATION_REFS_V1, true);
  if (refsResult.kind !== 'ok') return refsResult;
  const refs = [], edges = new Set(); let prior = null;
  for (const raw of refsResult.value) {
    const ref = closedRecord(raw, CLASSIFICATION_REF_FIELDS, true);
    if (ref === null) return { kind: 'invalid' };
    const kinds = [ref.classificationUid, ref.edgeUid, ref.authorityReceiptUid].map((value) => textKind(value));
    if (kinds.includes('limit')) return { kind: 'limit' };
    if (kinds.includes('invalid') || canonicalUid(ref.classificationUid, [prefix]) === null
        || canonicalUid(ref.edgeUid, ['E']) === null || canonicalUid(ref.authorityReceiptUid, ['D']) === null
        || edges.has(ref.edgeUid)) return { kind: 'invalid' };
    const tuple = [ref.classificationUid, ref.edgeUid, ref.authorityReceiptUid];
    if (prior !== null && tupleCompare(prior, tuple) >= 0) return { kind: 'invalid' };
    prior = tuple; edges.add(ref.edgeUid); refs.push(freezeDeep({ ...ref }));
  }
  return { kind: 'ok', value: Object.freeze(refs) };
}

function tupleCompare(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    const compared = unsignedUtf8CompareV1(left[index], right[index]); if (compared !== 0) return compared;
  }
  return 0;
}

function normalizeMetadata(snapshotValue, pin, rawDocumentIds) {
  const snapshot = closedRecord(snapshotValue, METADATA_FIELDS, true);
  if (snapshot === null) return failure('snapshot_corrupt');
  const expected = {
    schema: METADATA_SCHEMA, workspaceUid: pin.workspaceUid, projectUid: pin.projectUid,
    worktreeUid: pin.worktreeUid, revisionId: pin.revisionId, snapshotId: pin.snapshotId,
    metadataSnapshotId: pin.metadataSnapshotId, metadataRoot: pin.metadataRoot,
    authorizationScopeDigest: pin.authorizationScopeDigest, policyHash: pin.policyHash,
    policyVersion: pin.policyVersion, searchReceiptUid: pin.searchReceiptUid,
    analyzerIdentity: pin.analyzerIdentity, queryDigest: pin.queryDigest, recencyEpochDay: pin.recencyEpochDay,
  };
  if (!sameScalars(snapshot, expected, Object.keys(expected)) || !validHash(snapshot.authorizedMetadataDigest)) {
    return failure('snapshot_corrupt');
  }
  const queryFeatures = sortedExact(snapshot.queryFeatureUids, 'F', MAX_RERANK_CLASSIFICATION_REFS_V1);
  const queryComponents = sortedExact(snapshot.queryComponentUids, 'C', MAX_RERANK_CLASSIFICATION_REFS_V1);
  const recordsResult = denseArray(snapshot.records, MAX_RERANK_EVIDENCE_POOL_HITS_V1, true);
  if (queryFeatures.kind === 'limit' || queryComponents.kind === 'limit' || recordsResult.kind === 'limit') return failure('limit_exceeded');
  if (queryFeatures.kind !== 'ok' || queryComponents.kind !== 'ok' || recordsResult.kind !== 'ok'
      || recordsResult.value.length !== rawDocumentIds.length) return failure('snapshot_corrupt');
  const expectedIds = [...rawDocumentIds].sort(unsignedUtf8CompareV1), records = [], byDocument = new Map();
  for (let index = 0; index < recordsResult.value.length; index += 1) {
    const record = closedRecord(recordsResult.value[index], METADATA_RECORD_FIELDS, true);
    if (record === null) return failure('snapshot_corrupt');
    const metadataTextKinds = [record.documentId, record.status, record.statusAuthorityReceiptUid,
      ...(record.recencyAuthorityReceiptUid === null ? [] : [record.recencyAuthorityReceiptUid])]
      .map((value) => textKind(value));
    if (metadataTextKinds.includes('limit')) return failure('limit_exceeded');
    if (metadataTextKinds.includes('invalid') || canonicalUid(record.documentId, ['A']) === null
        || record.documentId !== expectedIds[index]) {
      return failure('snapshot_corrupt');
    }
    const features = classificationRefs(record.features, 'F'), components = classificationRefs(record.components, 'C');
    if (features.kind === 'limit' || components.kind === 'limit') return failure('limit_exceeded');
    if (features.kind !== 'ok' || components.kind !== 'ok') return failure('snapshot_corrupt');
    const allEdges = [...features.value, ...components.value].map((ref) => ref.edgeUid);
    if (new Set(allEdges).size !== allEdges.length
        || !(record.status === 'active' || record.status === 'stale' || record.status === 'deprecated')
        || canonicalUid(record.statusAuthorityReceiptUid, ['D']) === null) return failure('snapshot_corrupt');
    const dayAbsent = record.documentRevisionEpochDay === null && record.recencyAuthorityReceiptUid === null;
    const dayPresent = Number.isSafeInteger(record.documentRevisionEpochDay)
      && record.documentRevisionEpochDay >= 0 && pin.recencyEpochDay !== null
      && record.documentRevisionEpochDay <= pin.recencyEpochDay
      && canonicalUid(record.recencyAuthorityReceiptUid, ['D']) !== null;
    if (!dayAbsent && !dayPresent) return failure('snapshot_corrupt');
    const normalized = freezeDeep({ ...record, features: features.value, components: components.value });
    records.push(normalized); byDocument.set(normalized.documentId, normalized);
  }
  const normalizedSnapshot = freezeDeep({ ...expected, queryFeatureUids: queryFeatures.value,
    queryComponentUids: queryComponents.value, records, authorizedMetadataDigest: snapshot.authorizedMetadataDigest });
  const withoutDigest = freezeDeep(Object.fromEntries(Object.entries(normalizedSnapshot)
    .filter(([key]) => key !== 'authorizedMetadataDigest')));
  try { canonicalByteSize(withoutDigest, MAX_RERANK_EVIDENCE_CANONICAL_BYTES_V1); }
  catch (error) { return error instanceof RangeError ? failure('limit_exceeded') : failure('snapshot_corrupt'); }
  if (digest(METADATA_DOMAIN, withoutDigest) !== snapshot.authorizedMetadataDigest) return failure('snapshot_corrupt');
  return success({ snapshot: normalizedSnapshot, byDocument });
}

function classificationMatch(queryUids, refs) {
  const artifact = new Set(refs.map((ref) => ref.classificationUid));
  const intersection = queryUids.filter((uid) => artifact.has(uid));
  if (intersection.length === 0) return freezeDeep({ matched: false, queryClassificationUids: [], artifactClassificationUids: [], evidenceEdgeUids: [] });
  const matched = new Set(intersection);
  const evidenceEdgeUids = [...new Set(refs.filter((ref) => matched.has(ref.classificationUid)).map((ref) => ref.edgeUid))]
    .sort(unsignedUtf8CompareV1);
  return freezeDeep({ matched: true, queryClassificationUids: intersection,
    artifactClassificationUids: intersection, evidenceEdgeUids });
}

function receiptUid(preimage) {
  const bytes = createHash('sha256').update(PAGE_RECEIPT_UID_DOMAIN, 'utf8')
    .update(canonicalValue(preimage), 'utf8').digest();
  let bits = 0n;
  for (let index = 0; index < 16; index += 1) bits = (bits << 8n) | BigInt(bytes[index]);
  bits = (bits << 2n) | BigInt(bytes[16] >> 6);
  let encoded = '';
  for (let shift = 125n; shift >= 0n; shift -= 5n) encoded += CROCKFORD[Number((bits >> shift) & 31n)];
  return `D-${encoded}`;
}

function exactReceipt(value, expected, fields) {
  const receipt = closedRecord(value, fields, true);
  return receipt !== null && deeplyFrozen(value) && sameScalars(receipt, expected, fields) ? value : null;
}

export function createAuthorityBoundRerankEvidenceBuilderV1(configValue) {
  const config = closedRecord(configValue, CONFIG_FIELDS);
  if (config === null || typeof config.verifySearchReceipt !== 'function'
      || typeof config.readAuthorizedRerankMetadata !== 'function'
      || typeof config.verifyRerankEvidencePage !== 'function' || !validHash(config.authorityVerifierDigest)) {
    throw new TypeError('rerank evidence builder requires exactly three ports and authorityVerifierDigest');
  }
  const { verifySearchReceipt, readAuthorizedRerankMetadata, verifyRerankEvidencePage, authorityVerifierDigest } = config;

  function buildRerankEvidencePageV1(requestValue) {
    try {
      const request = closedRecord(requestValue, REQUEST_FIELDS);
      if (request === null) return failure('invalid_request');
      const scalars = requestScalars(request); if (!scalars.ok) return scalars;
      const { context, pin } = scalars.value;
      const rawResult = normalizeRaw(request.rawFusion); if (!rawResult.ok) return rawResult;
      const raw = rawResult.value;
      if (!deeplyFrozen(request.rawFusion)) return failure('invalid_raw_identity');
      if (!sameScalars(context, raw.identity.context, CONTEXT_FIELDS)
          || context.workspaceId !== pin.workspaceUid || context.snapshotId !== pin.snapshotId
          || context.authorizationScopeDigest !== pin.authorizationScopeDigest
          || context.queryReceipt !== pin.searchReceiptUid || context.analyzerIdentity !== pin.analyzerIdentity) {
        return failure('source_binding_mismatch');
      }
      const rawDocumentIds = Object.freeze(raw.hits.map((hit) => hit.documentId));
      if (request.pinnedArtifactUid !== null && rawDocumentIds.includes(request.pinnedArtifactUid)) {
        return failure('source_binding_mismatch');
      }
      const lexical = normalizeLexical(request.lexicalEvidenceIdentity, pin, raw, request.pinnedArtifactUid);
      if (!lexical.ok) return lexical;
      const graph = normalizeGraph(request.graphEvidenceIdentity, request.graphEvidenceRecords,
        pin, raw, request.pinnedArtifactUid);
      if (!graph.ok) return graph;
      const semantic = normalizeSemantic(request.semanticEvidenceIdentity, raw);
      if (!semantic.ok) return semantic;
      const lexicalState = raw.sourceMap.get('lexical'), graphState = raw.sourceMap.get('graph');
      const semanticState = raw.sourceMap.get('semantic');
      const binding = freezeDeep({
        contractVersion: RERANK_EVIDENCE_BUILDER_CONTRACT_V1, operation: 'build_rerank_evidence',
        workspaceUid: pin.workspaceUid, projectUid: pin.projectUid, worktreeUid: pin.worktreeUid,
        revisionId: pin.revisionId, snapshotId: pin.snapshotId, lexicalRoot: pin.lexicalRoot,
        graphSnapshotId: pin.graphSnapshotId, graphRoot: pin.graphRoot,
        metadataSnapshotId: pin.metadataSnapshotId, metadataRoot: pin.metadataRoot,
        authorizationScopeDigest: pin.authorizationScopeDigest, policyHash: pin.policyHash,
        policyVersion: pin.policyVersion, searchReceiptUid: pin.searchReceiptUid,
        analyzerIdentity: pin.analyzerIdentity, queryDigest: pin.queryDigest,
        recencyEpochDay: pin.recencyEpochDay, pinnedArtifactUid: request.pinnedArtifactUid,
        rawFusionDigest: raw.identity.rawFusionDigest, sourcePoolDigest: raw.identity.sourcePoolDigest,
        lexicalSourceIdentity: lexicalState.identity.sourceIdentity,
        lexicalCandidateDigest: lexicalState.identity.candidateDigest,
        lexicalRankEvidenceDigest: lexical.value.rankEvidenceDigest,
        graphSourceIdentity: graphState.identity.sourceIdentity,
        graphCandidateDigest: graphState.identity.candidateDigest,
        graphEvidenceDigest: graph.value.identity.evidenceDigest,
        semanticSourceIdentity: semanticState?.identity.sourceIdentity ?? null,
        semanticCandidateDigest: semanticState?.identity.candidateDigest ?? null,
        semanticEvidenceDigest: semantic.value?.evidenceDigest ?? null,
      });
      const bindingDigest = digest(BINDING_DOMAIN, binding);
      let searchReceipt;
      try { searchReceipt = verifySearchReceipt(binding); } catch (_error) { return failure('unauthorized'); }
      searchReceipt = exactReceipt(searchReceipt, binding, Object.keys(binding));
      if (searchReceipt === null) return failure('unauthorized');
      const metadataRequest = freezeDeep({ receipt: searchReceipt, binding, bindingDigest, rawDocumentIds });
      let rawMetadata;
      try { rawMetadata = readAuthorizedRerankMetadata(metadataRequest); }
      catch (_error) { return failure('snapshot_unavailable'); }
      const metadata = normalizeMetadata(rawMetadata, pin, rawDocumentIds); if (!metadata.ok) return metadata;
      const graphByDocument = new Map(graph.value.records.map((record) => [record.documentId, record]));
      const records = Object.freeze(rawDocumentIds.map((documentId) => {
        const item = metadata.value.byDocument.get(documentId), graphRecord = graphByDocument.get(documentId);
        const acceptedTrace = graphRecord === undefined
          ? freezeDeep({ distance: null, acceptedEdgeEvidence: [] })
          : freezeDeep({ distance: graphRecord.distance, acceptedEdgeEvidence: graphRecord.acceptedEdgeEvidence });
        return freezeDeep({
          documentId, acceptedTrace,
          featureMatch: classificationMatch(metadata.value.snapshot.queryFeatureUids, item.features),
          componentMatch: classificationMatch(metadata.value.snapshot.queryComponentUids, item.components),
          recency: item.documentRevisionEpochDay === null ? null : freezeDeep({
            documentRevisionEpochDay: item.documentRevisionEpochDay, evidenceUid: item.recencyAuthorityReceiptUid,
          }),
          status: freezeDeep({ value: item.status, evidenceUid: item.statusAuthorityReceiptUid }),
        });
      }));
      try { canonicalByteSize(records, MAX_RERANK_EVIDENCE_CANONICAL_BYTES_V1); }
      catch (error) { return error instanceof RangeError ? failure('limit_exceeded') : failure('internal_error'); }
      const sourceEvidenceDigest = digest(SOURCE_EVIDENCE_DOMAIN, {
        orderedSources: raw.identity.orderedSources, lexicalEvidenceIdentity: lexical.value,
        graphEvidenceIdentity: graph.value.identity, semanticEvidenceIdentity: semantic.value,
      });
      const recordSetDigest = digest(RECORD_SET_DOMAIN, {
        bindingDigest, rawFusionDigest: raw.identity.rawFusionDigest, records,
      });
      const pageAuthorityPreimage = freezeDeep({
        contractVersion: RERANK_EVIDENCE_PAGE_AUTHORITY_V1, operation: 'verify_rerank_evidence_page',
        bindingDigest, workspaceUid: pin.workspaceUid, projectUid: pin.projectUid,
        worktreeUid: pin.worktreeUid, revisionId: pin.revisionId, snapshotId: pin.snapshotId,
        graphSnapshotId: pin.graphSnapshotId, graphRoot: pin.graphRoot,
        metadataSnapshotId: pin.metadataSnapshotId, metadataRoot: pin.metadataRoot,
        authorizationScopeDigest: pin.authorizationScopeDigest, policyHash: pin.policyHash,
        policyVersion: pin.policyVersion, searchReceiptUid: pin.searchReceiptUid,
        analyzerIdentity: pin.analyzerIdentity, queryDigest: pin.queryDigest,
        recencyEpochDay: pin.recencyEpochDay, pinnedArtifactUid: request.pinnedArtifactUid,
        rawFusionDigest: raw.identity.rawFusionDigest, sourcePoolDigest: raw.identity.sourcePoolDigest,
        sourceEvidenceDigest, authorizedMetadataDigest: metadata.value.snapshot.authorizedMetadataDigest,
        recordSetDigest, recordCount: records.length, authorityVerifierDigest,
      });
      const authorityReceiptUid = receiptUid(pageAuthorityPreimage);
      const identityWithoutDigest = freezeDeep({
        workspaceId: context.workspaceId, snapshotId: context.snapshotId,
        authorizationScopeDigest: context.authorizationScopeDigest, queryReceipt: context.queryReceipt,
        graphSnapshotId: pin.graphSnapshotId, graphPolicyVersion: pin.policyVersion,
        recencyEpochDay: pin.recencyEpochDay, authorityReceiptUid,
        rawFusionDigest: raw.identity.rawFusionDigest, evidenceContractVersion: RERANK_EVIDENCE_CONTRACT,
        authorityVerifierDigest,
      });
      const evidenceDigest = digest(RERANK_EVIDENCE_DOMAIN, { identity: identityWithoutDigest, records });
      const evidencePage = freezeDeep({ identity: { ...identityWithoutDigest, evidenceDigest }, records });
      try { canonicalByteSize(evidencePage, MAX_RERANK_EVIDENCE_CANONICAL_BYTES_V1); }
      catch (error) { return error instanceof RangeError ? failure('limit_exceeded') : failure('internal_error'); }
      const pageRequest = freezeDeep({ ...pageAuthorityPreimage, authorityReceiptUid, evidenceDigest });
      let pageReceipt;
      try { pageReceipt = verifyRerankEvidencePage(pageRequest); }
      catch (_error) { return failure('evidence_unverified'); }
      pageReceipt = exactReceipt(pageReceipt, { ...pageRequest, decision: 'verified' }, [...Object.keys(pageRequest), 'decision']);
      if (pageReceipt === null) return failure('evidence_unverified');
      return success({
        status: 'complete', contractVersion: RERANK_EVIDENCE_BUILDER_CONTRACT_V1,
        evidencePage, pageAuthorityReceipt: pageReceipt,
        counters: {
          rawPoolHits: raw.hits.length, lexicalCandidates: lexicalState.documentIds.length,
          graphCandidates: graphState.documentIds.length,
          semanticCandidates: semanticState?.documentIds.length ?? 0,
          metadataRecords: metadata.value.snapshot.records.length,
        },
      });
    } catch (_error) { return failure('internal_error'); }
  }

  return Object.freeze({ buildRerankEvidencePageV1 });
}
