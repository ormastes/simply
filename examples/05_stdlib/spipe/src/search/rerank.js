import { createHash } from 'node:crypto';

import {
  RRF_CONTRACT_V1,
  RRF_POOL_CONTRACT_V2,
  RRF_ARITHMETIC_CONTRACT_V2,
  RRF_MAX_SOURCE_K_V2,
  RRF_MAX_POOL_HITS_V2,
  RRF_MAX_PUBLIC_HITS_V2,
  RRF_SCALE_V1,
  unsignedUtf8CompareV1,
} from './fusion.js';
import { canonicalJson } from '../storage/canonical.js';

// This page-local boundary can prove raw structure and arithmetic, but not the
// completeness of source pages it does not receive. A required external
// authority receipt therefore binds rawFusionDigest and evidenceDigest; only
// the captured verifier may admit that producer-complete page.

export const RERANK_CONTRACT_V1 = 'rrf-bounded-rerank-v1';
export const RERANK_CONTRACT_V2 = 'rrf-bounded-rerank-v2';
export const RERANK_CONTRACT_V3 = 'rrf-bounded-rerank-v3';
export const RERANK_EVIDENCE_CONTRACT_V3 = 'rerank-pair-evidence-v1';
export const RERANK_POLICY_V1 = 'spipe-rerank-policy-v1';
export const MAX_HITS = 1000;
export const MAX_POOL_HITS_V2 = RRF_MAX_POOL_HITS_V2;
export const MAX_OUTPUT_HITS_V2 = RRF_MAX_PUBLIC_HITS_V2;
export const MAX_EVIDENCE_IDS = 16;
export const MAX_ACCEPTED_EDGE_EVIDENCE_V3 = MAX_EVIDENCE_IDS;

const MAX_TEXT_BYTES = 512;
const MAX_EPOCH_DAY = 3_652_058;
export const RERANK_FIXED_POLICY_V1 = Object.freeze({
  contractVersion: RERANK_CONTRACT_V1,
  policyVersion: RERANK_POLICY_V1,
  traceBasisPointsByDistance: Object.freeze([1000, 700, 400]),
  featureBasisPoints: 400,
  componentBasisPoints: 400,
  recencyBasisPointsByAge: Object.freeze([
    Object.freeze({ maxAgeDays: 7, bp: 500 }),
    Object.freeze({ maxAgeDays: 30, bp: 300 }),
    Object.freeze({ maxAgeDays: 90, bp: 100 }),
  ]),
  stalePenaltyBasisPoints: 2500,
  deprecatedPenaltyBasisPoints: 5000,
  totalPositiveCapBasisPoints: 2500,
});
const POLICY = RERANK_FIXED_POLICY_V1;

const REQUEST_FIELDS = ['rawFusion', 'evidencePage', 'policy', 'outputLimit'];
const RAW_FIELDS = ['identity', 'hits'];
const RAW_IDENTITY_FIELDS = ['contractVersion', 'k', 'sourceK', 'orderedSources', 'context'];
const CONTEXT_FIELDS = ['workspaceId', 'snapshotId', 'authorizationScopeDigest', 'queryReceipt', 'analyzerIdentity'];
const SOURCE_FIELDS = ['name', 'sourceIdentity'];
const RAW_HIT_FIELDS = ['documentId', 'fusedRank', 'rawScoreUnits', 'contributions'];
const CONTRIBUTION_FIELDS = ['source', 'sourceIdentity', 'sourceRank', 'contributionUnits'];
const EVIDENCE_FIELDS = ['identity', 'records'];
const EVIDENCE_IDENTITY_FIELDS = [
  'workspaceId', 'snapshotId', 'authorizationScopeDigest', 'queryReceipt',
  'graphSnapshotId', 'graphPolicyVersion', 'recencyEpochDay',
  'authorityReceiptUid', 'rawFusionDigest', 'evidenceDigest',
];
const RECORD_FIELDS = ['documentId', 'acceptedTrace', 'featureMatch', 'componentMatch', 'recency', 'status'];
const TRACE_FIELDS = ['distance', 'evidenceEdgeUids', 'authorityReceiptUids'];
const TRACE_FIELDS_V3 = ['distance', 'acceptedEdgeEvidence'];
const ACCEPTED_EDGE_EVIDENCE_FIELDS_V3 = ['edgeUid', 'authorityReceiptUid'];
const CLASSIFICATION_FIELDS = ['matched', 'queryClassificationUids', 'artifactClassificationUids', 'evidenceEdgeUids'];
const RECENCY_FIELDS = ['documentRevisionEpochDay', 'evidenceUid'];
const STATUS_FIELDS = ['value', 'evidenceUid'];
const RAW_IDENTITY_FIELDS_V2 = [
  'contractVersion', 'arithmeticContractVersion', 'k', 'sourceK', 'orderedSources',
  'context', 'complete', 'uniqueDocumentCount', 'sourcePoolDigest', 'rawFusionDigest',
];
const SOURCE_FIELDS_V2 = [
  'name', 'sourceIdentity', 'complete', 'candidateCount', 'candidateDigest',
];
const SOURCE_POOL_DOMAIN_V2 = 'spipe-rrf-source-pool-v1\0';
const COMPLETE_SOURCE_SET_DOMAIN_V2 = 'spipe-rrf-complete-source-set-v1\0';
const COMPLETE_OUTPUT_DOMAIN_V2 = 'spipe-rrf-complete-output-v1\0';
const RERANK_EVIDENCE_DOMAIN_V3 = 'spipe-rerank-pair-evidence-v1\0';
const EVIDENCE_IDENTITY_FIELDS_V3 = [
  ...EVIDENCE_IDENTITY_FIELDS, 'evidenceContractVersion', 'authorityVerifierDigest',
];

function fail(code) {
  return Object.freeze({ ok: false, error: Object.freeze({ code }) });
}

function recordSnapshot(value, fields) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
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
  } catch (_error) {
    return null;
  }
}

function arraySnapshot(value) {
  if (value === null || typeof value !== 'object') return null;
  try {
    if (!Array.isArray(value)) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== 'string')) return null;
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < 0 || keys.length !== length + 1) return null;
    const result = new Array(length);
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')
          || Object.hasOwn(descriptor, 'get') || Object.hasOwn(descriptor, 'set')
          || descriptor.enumerable !== true) return null;
      result[index] = descriptor.value;
    }
    return Object.freeze(result);
  } catch (_error) {
    return null;
  }
}

function utf8Length(value) {
  if (typeof value !== 'string' || value.length === 0) return -1;
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const high = value.charCodeAt(index);
    if (high >= 0xd800 && high <= 0xdbff) {
      if (index + 1 >= value.length) return -1;
      const low = value.charCodeAt(index + 1);
      if (low < 0xdc00 || low > 0xdfff) return -1;
      index += 1;
      bytes += 4;
    } else if (high >= 0xdc00 && high <= 0xdfff) return -1;
    else if (high <= 0x7f) bytes += 1;
    else if (high <= 0x7ff) bytes += 2;
    else bytes += 3;
  }
  return bytes;
}

function validText(value) {
  const bytes = utf8Length(value);
  return bytes > 0 && bytes <= MAX_TEXT_BYTES;
}

function validSha256(value) {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
}

function canonicalDigestV2(domain, value) {
  return `sha256:${createHash('sha256')
    .update(domain, 'utf8')
    .update(canonicalJson(value), 'utf8')
    .digest('hex')}`;
}

function candidateDigestV2(name, sourceIdentity, documentIds) {
  return canonicalDigestV2(SOURCE_POOL_DOMAIN_V2, { name, sourceIdentity, documentIds });
}

function sourcePoolDigestV2(orderedSources) {
  return canonicalDigestV2(COMPLETE_SOURCE_SET_DOMAIN_V2, orderedSources.map((source) => ({
    name: source.name,
    sourceIdentity: source.sourceIdentity,
    complete: source.complete,
    candidateCount: source.candidateCount,
    candidateDigest: source.candidateDigest,
  })));
}

function rawFusionDigestV2(identityWithoutDigest, hits) {
  return canonicalDigestV2(COMPLETE_OUTPUT_DOMAIN_V2, {
    identity: identityWithoutDigest,
    hits,
  });
}

function frozen(value) {
  try { return Object.isFrozen(value); } catch (_error) { return false; }
}

function equalPolicy(value) {
  const root = recordSnapshot(value, Object.keys(POLICY));
  if (root === null) return false;
  if (root.contractVersion !== POLICY.contractVersion || root.policyVersion !== POLICY.policyVersion
      || root.featureBasisPoints !== 400 || root.componentBasisPoints !== 400
      || root.stalePenaltyBasisPoints !== 2500 || root.deprecatedPenaltyBasisPoints !== 5000
      || root.totalPositiveCapBasisPoints !== 2500) return false;
  const trace = arraySnapshot(root.traceBasisPointsByDistance);
  const recency = arraySnapshot(root.recencyBasisPointsByAge);
  if (trace === null || trace.length !== 3 || trace.some((x, i) => x !== POLICY.traceBasisPointsByDistance[i])) return false;
  if (recency === null || recency.length !== 3) return false;
  return recency.every((entry, index) => {
    const item = recordSnapshot(entry, ['maxAgeDays', 'bp']);
    const expected = POLICY.recencyBasisPointsByAge[index];
    return item !== null && item.maxAgeDays === expected.maxAgeDays && item.bp === expected.bp;
  });
}

function sortedUniqueIds(value, allowEmpty) {
  const ids = arraySnapshot(value);
  if (ids === null || ids.length > MAX_EVIDENCE_IDS || (!allowEmpty && ids.length === 0)) return null;
  for (let index = 0; index < ids.length; index += 1) {
    if (!validText(ids[index])) return null;
    if (index > 0 && unsignedUtf8CompareV1(ids[index - 1], ids[index]) >= 0) return null;
  }
  return ids;
}

function normalizeRaw(rawFusion) {
  const raw = recordSnapshot(rawFusion, RAW_FIELDS);
  if (raw === null || !frozen(rawFusion)) return fail('invalid_raw_identity');
  const identity = recordSnapshot(raw.identity, RAW_IDENTITY_FIELDS);
  if (identity === null || !frozen(raw.identity) || identity.contractVersion !== RRF_CONTRACT_V1
      || !Number.isSafeInteger(identity.k) || identity.k < 1 || identity.k > 10000
      || !Number.isSafeInteger(identity.sourceK) || identity.sourceK < 1 || identity.sourceK > 1000) {
    return fail('invalid_raw_identity');
  }
  const context = recordSnapshot(identity.context, CONTEXT_FIELDS);
  const sources = arraySnapshot(identity.orderedSources);
  if (context === null || !frozen(identity.context)
      || CONTEXT_FIELDS.some((field) => !validText(context[field]))
      || sources === null || !frozen(identity.orderedSources)
      || sources.length < 2 || sources.length > 3) return fail('invalid_raw_identity');
  const normalizedSources = [];
  const sourceMap = new Map();
  const expectedNames = ['lexical', 'graph', 'semantic'];
  for (let index = 0; index < sources.length; index += 1) {
    const source = recordSnapshot(sources[index], SOURCE_FIELDS);
    if (source === null || !frozen(sources[index]) || source.name !== expectedNames[index]
        || !validText(source.sourceIdentity)) return fail('invalid_raw_identity');
    normalizedSources.push(Object.freeze({ name: source.name, sourceIdentity: source.sourceIdentity }));
    sourceMap.set(source.name, source.sourceIdentity);
  }
  const hits = arraySnapshot(raw.hits);
  if (hits === null || !frozen(raw.hits) || hits.length > MAX_HITS) return fail('invalid_raw_hit_page');
  const normalizedHits = [];
  const seenDocuments = new Set();
  const claimedRanks = new Set();
  for (let index = 0; index < hits.length; index += 1) {
    const hitRef = hits[index];
    const hit = recordSnapshot(hitRef, RAW_HIT_FIELDS);
    if (hit === null || !frozen(hitRef) || !validText(hit.documentId) || seenDocuments.has(hit.documentId)
        || hit.fusedRank !== index + 1 || !Number.isSafeInteger(hit.rawScoreUnits) || hit.rawScoreUnits < 0) return fail('invalid_raw_hit_page');
    seenDocuments.add(hit.documentId);
    const contributions = arraySnapshot(hit.contributions);
    if (contributions === null || !frozen(hit.contributions)
        || contributions.length < 1 || contributions.length > sources.length) return fail('invalid_raw_hit_page');
    let sum = 0;
    let previousSourceIndex = -1;
    for (const rawContribution of contributions) {
      const contribution = recordSnapshot(rawContribution, CONTRIBUTION_FIELDS);
      if (contribution === null || !frozen(rawContribution) || !sourceMap.has(contribution.source)
          || sourceMap.get(contribution.source) !== contribution.sourceIdentity) return fail('invalid_raw_hit_page');
      const sourceIndex = expectedNames.indexOf(contribution.source);
      if (sourceIndex <= previousSourceIndex || !Number.isSafeInteger(contribution.sourceRank)
          || contribution.sourceRank < 1 || contribution.sourceRank > identity.sourceK) return fail('invalid_raw_hit_page');
      const expected = Math.floor(RRF_SCALE_V1 / (identity.k + contribution.sourceRank));
      if (contribution.contributionUnits !== expected) return fail('invalid_raw_hit_page');
      const rankKey = `${contribution.source}\u0000${contribution.sourceRank}`;
      if (claimedRanks.has(rankKey)) return fail('invalid_raw_hit_page');
      claimedRanks.add(rankKey);
      sum += expected;
      if (!Number.isSafeInteger(sum)) return fail('arithmetic_overflow');
      previousSourceIndex = sourceIndex;
    }
    if (sum !== hit.rawScoreUnits) return fail('invalid_raw_hit_page');
    if (index > 0) {
      const previous = normalizedHits[index - 1];
      if (previous.rawScoreUnits < hit.rawScoreUnits
          || (previous.rawScoreUnits === hit.rawScoreUnits
              && unsignedUtf8CompareV1(previous.documentId, hit.documentId) >= 0)) return fail('invalid_raw_hit_page');
    }
    normalizedHits.push(Object.freeze({ documentId: hit.documentId, rawScoreUnits: hit.rawScoreUnits, rawHit: hitRef }));
  }
  return Object.freeze({ ok: true, value: Object.freeze({ identity: Object.freeze({
    contractVersion: identity.contractVersion, k: identity.k, sourceK: identity.sourceK,
    orderedSources: Object.freeze(normalizedSources), context: Object.freeze({ ...context }),
  }), hits: Object.freeze(normalizedHits) }) });
}

function normalizeRawV2(rawFusion) {
  const raw = recordSnapshot(rawFusion, RAW_FIELDS);
  if (raw === null || !frozen(rawFusion)) return fail('invalid_raw_identity');
  const identity = recordSnapshot(raw.identity, RAW_IDENTITY_FIELDS_V2);
  if (identity === null || !frozen(raw.identity)
      || identity.contractVersion !== RRF_POOL_CONTRACT_V2
      || identity.arithmeticContractVersion !== RRF_ARITHMETIC_CONTRACT_V2
      || !Number.isSafeInteger(identity.k) || identity.k < 1 || identity.k > 10000
      || !Number.isSafeInteger(identity.sourceK) || identity.sourceK < 1
      || identity.sourceK > RRF_MAX_SOURCE_K_V2
      || !Number.isSafeInteger(identity.uniqueDocumentCount)
      || identity.uniqueDocumentCount < 0
      || identity.uniqueDocumentCount > MAX_POOL_HITS_V2
      || !validSha256(identity.sourcePoolDigest)
      || !validSha256(identity.rawFusionDigest)) return fail('invalid_raw_identity');
  const context = recordSnapshot(identity.context, CONTEXT_FIELDS);
  const sources = arraySnapshot(identity.orderedSources);
  if (context === null || !frozen(identity.context)
      || CONTEXT_FIELDS.some((field) => !validText(context[field]))
      || sources === null || !frozen(identity.orderedSources)
      || sources.length < 2 || sources.length > 3) return fail('invalid_raw_identity');
  const normalizedSources = [];
  const sourceMap = new Map();
  const expectedNames = ['lexical', 'graph', 'semantic'];
  for (let index = 0; index < sources.length; index += 1) {
    const source = recordSnapshot(sources[index], SOURCE_FIELDS_V2);
    if (source === null || !frozen(sources[index]) || source.name !== expectedNames[index]
        || !validText(source.sourceIdentity)
        || !Number.isSafeInteger(source.candidateCount) || source.candidateCount < 0
        || source.candidateCount > identity.sourceK
        || !validSha256(source.candidateDigest)) return fail('invalid_raw_identity');
    normalizedSources.push(Object.freeze({
      name: source.name,
      sourceIdentity: source.sourceIdentity,
      complete: source.complete,
      candidateCount: source.candidateCount,
      candidateDigest: source.candidateDigest,
    }));
    sourceMap.set(source.name, Object.freeze({
      sourceIdentity: source.sourceIdentity,
      candidateCount: source.candidateCount,
      documentIds: new Array(source.candidateCount),
    }));
  }
  if (identity.complete !== true || normalizedSources.some((source) => source.complete !== true)) {
    return fail('incomplete_raw_pool');
  }
  const hits = arraySnapshot(raw.hits);
  if (hits === null || !frozen(raw.hits) || hits.length > MAX_POOL_HITS_V2) {
    return fail('invalid_raw_hit_page');
  }
  if (identity.uniqueDocumentCount !== hits.length) return fail('raw_pool_count_mismatch');

  const normalizedHits = [];
  const seenDocuments = new Set();
  const claimedRanks = new Set();
  for (let index = 0; index < hits.length; index += 1) {
    const hitRef = hits[index];
    const hit = recordSnapshot(hitRef, RAW_HIT_FIELDS);
    if (hit === null || !frozen(hitRef) || !validText(hit.documentId)
        || seenDocuments.has(hit.documentId) || hit.fusedRank !== index + 1
        || !Number.isSafeInteger(hit.rawScoreUnits) || hit.rawScoreUnits < 0) {
      return fail('invalid_raw_hit_page');
    }
    seenDocuments.add(hit.documentId);
    const contributions = arraySnapshot(hit.contributions);
    if (contributions === null || !frozen(hit.contributions)
        || contributions.length < 1 || contributions.length > sources.length) {
      return fail('invalid_raw_hit_page');
    }
    let sum = 0;
    let previousSourceIndex = -1;
    for (const rawContribution of contributions) {
      const contribution = recordSnapshot(rawContribution, CONTRIBUTION_FIELDS);
      if (contribution === null || !frozen(rawContribution) || !sourceMap.has(contribution.source)) {
        return fail('invalid_raw_hit_page');
      }
      const source = sourceMap.get(contribution.source);
      if (source.sourceIdentity !== contribution.sourceIdentity) return fail('invalid_raw_hit_page');
      const sourceIndex = expectedNames.indexOf(contribution.source);
      if (sourceIndex <= previousSourceIndex || !Number.isSafeInteger(contribution.sourceRank)
          || contribution.sourceRank < 1 || contribution.sourceRank > identity.sourceK
          || contribution.sourceRank > source.candidateCount) return fail('invalid_raw_hit_page');
      const expected = Math.floor(RRF_SCALE_V1 / (identity.k + contribution.sourceRank));
      if (contribution.contributionUnits !== expected) return fail('invalid_raw_hit_page');
      const rankKey = `${contribution.source}\u0000${contribution.sourceRank}`;
      if (claimedRanks.has(rankKey)) return fail('invalid_raw_hit_page');
      claimedRanks.add(rankKey);
      source.documentIds[contribution.sourceRank - 1] = hit.documentId;
      sum += expected;
      if (!Number.isSafeInteger(sum)) return fail('arithmetic_overflow');
      previousSourceIndex = sourceIndex;
    }
    if (sum !== hit.rawScoreUnits) return fail('invalid_raw_hit_page');
    if (index > 0) {
      const previous = normalizedHits[index - 1];
      if (previous.rawScoreUnits < hit.rawScoreUnits
          || (previous.rawScoreUnits === hit.rawScoreUnits
              && unsignedUtf8CompareV1(previous.documentId, hit.documentId) >= 0)) {
        return fail('invalid_raw_hit_page');
      }
    }
    normalizedHits.push(Object.freeze({
      documentId: hit.documentId,
      rawScoreUnits: hit.rawScoreUnits,
      rawHit: hitRef,
    }));
  }

  for (const source of normalizedSources) {
    const rebuilt = sourceMap.get(source.name);
    if (rebuilt.documentIds.some((documentId) => documentId === undefined)
        || claimedRanks.size > normalizedSources.reduce(
          (total, item) => total + item.candidateCount, 0,
        )) return fail('raw_pool_count_mismatch');
    if (candidateDigestV2(source.name, source.sourceIdentity, rebuilt.documentIds)
        !== source.candidateDigest) return fail('raw_fusion_digest_mismatch');
  }
  if (claimedRanks.size !== normalizedSources.reduce(
    (total, source) => total + source.candidateCount, 0,
  )) return fail('raw_pool_count_mismatch');
  if (sourcePoolDigestV2(normalizedSources) !== identity.sourcePoolDigest) {
    return fail('raw_fusion_digest_mismatch');
  }
  const identityWithoutDigest = Object.freeze({
    contractVersion: identity.contractVersion,
    arithmeticContractVersion: identity.arithmeticContractVersion,
    k: identity.k,
    sourceK: identity.sourceK,
    orderedSources: Object.freeze(normalizedSources),
    context: Object.freeze({ ...context }),
    complete: true,
    uniqueDocumentCount: identity.uniqueDocumentCount,
    sourcePoolDigest: identity.sourcePoolDigest,
  });
  if (rawFusionDigestV2(identityWithoutDigest, hits) !== identity.rawFusionDigest) {
    return fail('raw_fusion_digest_mismatch');
  }
  return Object.freeze({ ok: true, value: Object.freeze({
    identity: Object.freeze({ ...identityWithoutDigest, rawFusionDigest: identity.rawFusionDigest }),
    hits: Object.freeze(normalizedHits),
  }) });
}

function normalizeTrace(value) {
  const trace = recordSnapshot(value, TRACE_FIELDS);
  if (trace === null || !(trace.distance === null || [1, 2, 3].includes(trace.distance))) return null;
  const edges = sortedUniqueIds(trace.evidenceEdgeUids, trace.distance === null);
  const receipts = sortedUniqueIds(trace.authorityReceiptUids, trace.distance === null);
  if (edges === null || receipts === null || edges.length !== receipts.length
      || (trace.distance === null && edges.length !== 0)) return null;
  return Object.freeze({ distance: trace.distance, evidenceEdgeUids: edges, authorityReceiptUids: receipts });
}

function normalizeTraceV3(value) {
  const trace = recordSnapshot(value, TRACE_FIELDS_V3);
  if (trace === null) return null;
  const evidenceRefs = arraySnapshot(trace.acceptedEdgeEvidence);
  // The allocation cap is checked before semantic distance/cardinality rules.
  if (evidenceRefs === null || evidenceRefs.length > MAX_ACCEPTED_EDGE_EVIDENCE_V3) return null;
  if (!(trace.distance === null || [1, 2, 3].includes(trace.distance))
      || evidenceRefs.length !== (trace.distance === null ? 0 : trace.distance)) return null;
  const acceptedEdgeEvidence = [];
  const seenEdges = new Set();
  const receiptSet = new Set();
  for (const evidenceRef of evidenceRefs) {
    const evidence = recordSnapshot(evidenceRef, ACCEPTED_EDGE_EVIDENCE_FIELDS_V3);
    if (evidence === null || !validText(evidence.edgeUid)
        || !validText(evidence.authorityReceiptUid) || seenEdges.has(evidence.edgeUid)) return null;
    seenEdges.add(evidence.edgeUid);
    receiptSet.add(evidence.authorityReceiptUid);
    acceptedEdgeEvidence.push(Object.freeze({
      edgeUid: evidence.edgeUid,
      authorityReceiptUid: evidence.authorityReceiptUid,
    }));
  }
  const evidenceEdgeUids = [...seenEdges].sort(unsignedUtf8CompareV1);
  const authorityReceiptUids = [...receiptSet].sort(unsignedUtf8CompareV1);
  return Object.freeze({
    distance: trace.distance,
    acceptedEdgeEvidence: Object.freeze(acceptedEdgeEvidence),
    evidenceEdgeUids: Object.freeze(evidenceEdgeUids),
    authorityReceiptUids: Object.freeze(authorityReceiptUids),
  });
}

function traceForEvidenceDigestV3(trace) {
  return Object.freeze({
    distance: trace.distance,
    acceptedEdgeEvidence: trace.acceptedEdgeEvidence,
  });
}

function evidenceDigestV3(identity, records) {
  const identityWithoutDigest = Object.freeze(Object.fromEntries(
    Object.entries(identity).filter(([key]) => key !== 'evidenceDigest'),
  ));
  const digestRecords = records.map((record) => Object.freeze({
    documentId: record.documentId,
    acceptedTrace: traceForEvidenceDigestV3(record.acceptedTrace),
    featureMatch: record.featureMatch,
    componentMatch: record.componentMatch,
    recency: record.recency,
    status: record.status,
  }));
  return canonicalDigestV2(RERANK_EVIDENCE_DOMAIN_V3, Object.freeze({
    identity: identityWithoutDigest,
    records: Object.freeze(digestRecords),
  }));
}

function normalizeClassification(value) {
  const item = recordSnapshot(value, CLASSIFICATION_FIELDS);
  if (item === null || typeof item.matched !== 'boolean') return null;
  const query = sortedUniqueIds(item.queryClassificationUids, !item.matched);
  const artifact = sortedUniqueIds(item.artifactClassificationUids, !item.matched);
  const edges = sortedUniqueIds(item.evidenceEdgeUids, !item.matched);
  if (query === null || artifact === null || edges === null
      || (!item.matched && (query.length !== 0 || artifact.length !== 0 || edges.length !== 0))) return null;
  return Object.freeze({ matched: item.matched, queryClassificationUids: query, artifactClassificationUids: artifact, evidenceEdgeUids: edges });
}

function checkedDelta(raw, basisPoints) {
  const product = raw * basisPoints;
  if (!Number.isSafeInteger(product)) return null;
  return Math.floor(product / 10000);
}

function calculateRanked(normalizedRecords, evidenceIdentity, rawHits) {
  const ranked = [];
  for (let index = 0; index < normalizedRecords.length; index += 1) {
    const record = normalizedRecords[index];
    const {
      acceptedTrace: trace, featureMatch: feature, componentMatch: component, recency, status,
    } = record;
    const raw = rawHits[index].rawScoreUnits;
    const traceBp = trace.distance === null ? 0 : POLICY.traceBasisPointsByDistance[trace.distance - 1];
    let recencyBp = 0;
    if (recency !== null) {
      const age = evidenceIdentity.recencyEpochDay - recency.documentRevisionEpochDay;
      const tier = POLICY.recencyBasisPointsByAge.find((entry) => age <= entry.maxAgeDays);
      if (tier !== undefined) recencyBp = tier.bp;
    }
    const traceDelta = checkedDelta(raw, traceBp);
    const featureDelta = checkedDelta(raw, feature.matched ? POLICY.featureBasisPoints : 0);
    const componentDelta = checkedDelta(raw, component.matched ? POLICY.componentBasisPoints : 0);
    const recencyDelta = checkedDelta(raw, recencyBp);
    const statusBp = status.value === 'stale' ? POLICY.stalePenaltyBasisPoints
      : status.value === 'deprecated' ? POLICY.deprecatedPenaltyBasisPoints : 0;
    const statusDelta = checkedDelta(raw, statusBp);
    const positiveCap = checkedDelta(raw, POLICY.totalPositiveCapBasisPoints);
    if ([traceDelta, featureDelta, componentDelta, recencyDelta, statusDelta, positiveCap]
      .includes(null)) return fail('arithmetic_overflow');
    const uncappedPositive = traceDelta + featureDelta + componentDelta + recencyDelta;
    if (!Number.isSafeInteger(uncappedPositive)) return fail('arithmetic_overflow');
    const totalPositive = Math.min(uncappedPositive, positiveCap);
    const adjustedScoreUnits = Math.max(0, raw + totalPositive - statusDelta);
    if (!Number.isSafeInteger(adjustedScoreUnits)) return fail('arithmetic_overflow');
    ranked.push({ documentId: record.documentId, rawScoreUnits: raw, adjustedScoreUnits,
      rawHit: rawHits[index].rawHit,
      explanation: Object.freeze({
        acceptedTrace: Object.freeze({ basisPoints: traceBp, deltaUnits: traceDelta, evidence: trace }),
        featureMatch: Object.freeze({ basisPoints: feature.matched ? 400 : 0, deltaUnits: featureDelta, evidence: feature }),
        componentMatch: Object.freeze({ basisPoints: component.matched ? 400 : 0, deltaUnits: componentDelta, evidence: component }),
        recency: Object.freeze({ basisPoints: recencyBp, deltaUnits: recencyDelta, evidence: recency }),
        status: Object.freeze({ basisPoints: statusBp, penaltyUnits: statusDelta, evidence: Object.freeze({ ...status }) }),
        uncappedPositiveUnits: uncappedPositive, positiveCapUnits: positiveCap,
        totalPositiveUnits: totalPositive, totalPenaltyUnits: statusDelta,
        rawScoreUnits: raw, adjustedScoreUnits,
      }) });
  }
  return Object.freeze({ ok: true, value: ranked });
}

function finishCompletePoolRerank(rawResult, evidenceIdentity, normalizedRecords, outputLimit,
  identityAdditions) {
  const rankedResult = calculateRanked(normalizedRecords, evidenceIdentity, rawResult.value.hits);
  if (!rankedResult.ok) return rankedResult;
  const ranked = rankedResult.value;
  ranked.sort((left, right) => left.adjustedScoreUnits !== right.adjustedScoreUnits
    ? right.adjustedScoreUnits - left.adjustedScoreUnits
    : left.rawScoreUnits !== right.rawScoreUnits
      ? right.rawScoreUnits - left.rawScoreUnits
      : unsignedUtf8CompareV1(left.documentId, right.documentId));
  const outputCount = Math.min(outputLimit, ranked.length);
  const hits = ranked.slice(0, outputCount).map((hit, index) => Object.freeze({
    documentId: hit.documentId,
    finalRank: index + 1,
    rawHit: hit.rawHit,
    adjustedScoreUnits: hit.adjustedScoreUnits,
    rerankExplanation: Object.freeze({
      ...hit.explanation,
      tieBreak: Object.freeze({
        adjustedScoreUnits: hit.adjustedScoreUnits,
        rawScoreUnits: hit.rawScoreUnits,
        documentId: hit.documentId,
      }),
    }),
  }));
  return Object.freeze({ ok: true, value: Object.freeze({
    identity: Object.freeze({
      ...rawResult.value.identity,
      ...identityAdditions,
      outputLimit,
    }),
    hits: Object.freeze(hits),
  }) });
}

export function createRrfBoundedRerankerV1({ verifyEvidencePage } = {}) {
  if (typeof verifyEvidencePage !== 'function') throw new TypeError('verifyEvidencePage must be a function');
  return Object.freeze({
    rerankRrfPageV1(request) {
      const root = recordSnapshot(request, REQUEST_FIELDS);
      if (root === null) return fail('invalid_request');
      const rawResult = normalizeRaw(root.rawFusion);
      if (!rawResult.ok) return rawResult;
      const evidence = recordSnapshot(root.evidencePage, EVIDENCE_FIELDS);
      const evidenceIdentity = evidence === null ? null : recordSnapshot(evidence.identity, EVIDENCE_IDENTITY_FIELDS);
      if (evidenceIdentity === null
          || EVIDENCE_IDENTITY_FIELDS.some((field) => evidenceIdentity[field] === undefined)
          || ['workspaceId', 'snapshotId', 'authorizationScopeDigest', 'queryReceipt', 'graphSnapshotId', 'authorityReceiptUid']
            .some((field) => !validText(evidenceIdentity[field]))
          || !validSha256(evidenceIdentity.rawFusionDigest)
          || !validSha256(evidenceIdentity.evidenceDigest)
          || !Number.isSafeInteger(evidenceIdentity.graphPolicyVersion) || evidenceIdentity.graphPolicyVersion < 0 || evidenceIdentity.graphPolicyVersion > 0xffffffff
          || !(evidenceIdentity.recencyEpochDay === null
            || (Number.isSafeInteger(evidenceIdentity.recencyEpochDay) && evidenceIdentity.recencyEpochDay >= 0 && evidenceIdentity.recencyEpochDay <= MAX_EPOCH_DAY))) {
        return fail('invalid_evidence_identity');
      }
      for (const field of ['workspaceId', 'snapshotId', 'authorizationScopeDigest', 'queryReceipt']) {
        if (evidenceIdentity[field] !== rawResult.value.identity.context[field]) return fail('context_mismatch');
      }
      if (root.policy === undefined || recordSnapshot(root.policy, Object.keys(POLICY)) === null) return fail('invalid_policy');
      if (!equalPolicy(root.policy)) return fail('policy_mismatch');
      const omittedLimit = root.outputLimit === undefined;
      const requestedLimit = omittedLimit ? rawResult.value.hits.length : root.outputLimit;
      const outputLimit = rawResult.value.hits.length === 0 ? 0 : requestedLimit;
      if (!Number.isSafeInteger(requestedLimit)
          || (!omittedLimit && requestedLimit < 1) || requestedLimit > MAX_HITS
          || (rawResult.value.hits.length > 0 && requestedLimit > rawResult.value.hits.length)
          || (rawResult.value.hits.length === 0 && !omittedLimit && requestedLimit !== 1)) return fail('invalid_output_limit');
      const records = arraySnapshot(evidence.records);
      if (records === null || records.length !== rawResult.value.hits.length) return fail('invalid_evidence_page');

      const recordShapes = [];
      for (let index = 0; index < records.length; index += 1) {
        const shape = recordSnapshot(records[index], RECORD_FIELDS);
        if (shape === null) return fail('invalid_evidence_page');
        recordShapes.push(shape);
      }
      for (let index = 0; index < recordShapes.length; index += 1) {
        if (recordShapes[index].documentId !== rawResult.value.hits[index].documentId) {
          return fail('record_identity_mismatch');
        }
      }
      const traces = [];
      for (const shape of recordShapes) {
        const trace = normalizeTrace(shape.acceptedTrace);
        if (trace === null) return fail('invalid_accepted_trace');
        traces.push(trace);
      }
      const features = [];
      const components = [];
      for (const shape of recordShapes) {
        const feature = normalizeClassification(shape.featureMatch);
        const component = normalizeClassification(shape.componentMatch);
        if (feature === null || component === null) return fail('invalid_classification');
        features.push(feature);
        components.push(component);
      }
      const recencies = [];
      for (const shape of recordShapes) {
        if (shape.recency === null) {
          recencies.push(null);
          continue;
        }
        const item = recordSnapshot(shape.recency, RECENCY_FIELDS);
        if (item === null || evidenceIdentity.recencyEpochDay === null
            || !Number.isSafeInteger(item.documentRevisionEpochDay) || item.documentRevisionEpochDay < 0
            || item.documentRevisionEpochDay > evidenceIdentity.recencyEpochDay
            || !validText(item.evidenceUid)) return fail('invalid_recency');
        recencies.push(Object.freeze({ ...item }));
      }
      const statuses = [];
      for (const shape of recordShapes) {
        const status = recordSnapshot(shape.status, STATUS_FIELDS);
        if (status === null || !['active', 'stale', 'deprecated'].includes(status.value)
            || !validText(status.evidenceUid)) return fail('invalid_status');
        statuses.push(Object.freeze({ ...status }));
      }
      const normalizedRecords = recordShapes.map((shape, index) => Object.freeze({
        documentId: shape.documentId,
        acceptedTrace: traces[index],
        featureMatch: features[index],
        componentMatch: components[index],
        recency: recencies[index],
        status: statuses[index],
      }));
      const normalizedEvidencePage = Object.freeze({
        identity: Object.freeze({ ...evidenceIdentity }),
        records: Object.freeze(normalizedRecords),
      });
      try {
        if (verifyEvidencePage(Object.freeze({
          rawFusion: root.rawFusion,
          evidencePage: normalizedEvidencePage,
        })) !== true) return fail('invalid_evidence_authority');
      } catch (_error) {
        return fail('invalid_evidence_authority');
      }

      const rankedResult = calculateRanked(normalizedRecords, evidenceIdentity, rawResult.value.hits);
      if (!rankedResult.ok) return rankedResult;
      const ranked = rankedResult.value;
      ranked.sort((left, right) => left.adjustedScoreUnits !== right.adjustedScoreUnits
        ? right.adjustedScoreUnits - left.adjustedScoreUnits
        : left.rawScoreUnits !== right.rawScoreUnits ? right.rawScoreUnits - left.rawScoreUnits
          : unsignedUtf8CompareV1(left.documentId, right.documentId));
      const hits = ranked.slice(0, outputLimit).map((hit, index) => Object.freeze({
        documentId: hit.documentId, finalRank: index + 1, rawHit: hit.rawHit,
        adjustedScoreUnits: hit.adjustedScoreUnits,
        rerankExplanation: Object.freeze({ ...hit.explanation, tieBreak: Object.freeze({
          adjustedScoreUnits: hit.adjustedScoreUnits, rawScoreUnits: hit.rawScoreUnits, documentId: hit.documentId,
        }) }),
      }));
      return Object.freeze({ ok: true, value: Object.freeze({
        identity: Object.freeze({ ...rawResult.value.identity,
          rerankContractVersion: RERANK_CONTRACT_V1, policyVersion: RERANK_POLICY_V1,
          graphSnapshotId: evidenceIdentity.graphSnapshotId,
          graphPolicyVersion: evidenceIdentity.graphPolicyVersion,
          recencyEpochDay: evidenceIdentity.recencyEpochDay,
          authorityReceiptUid: evidenceIdentity.authorityReceiptUid,
          rawFusionDigest: evidenceIdentity.rawFusionDigest,
          evidenceDigest: evidenceIdentity.evidenceDigest,
          outputLimit: requestedLimit,
        }),
        hits: Object.freeze(hits),
      }) });
    },
  });
}

export function createRrfBoundedRerankerV2({ verifyEvidencePage } = {}) {
  if (typeof verifyEvidencePage !== 'function') {
    throw new TypeError('verifyEvidencePage must be a function');
  }
  return Object.freeze({
    rerankRrfCompletePoolV2(request) {
      const root = recordSnapshot(request, REQUEST_FIELDS);
      if (root === null) return fail('invalid_request');
      const rawResult = normalizeRawV2(root.rawFusion);
      if (!rawResult.ok) return rawResult;

      const evidence = recordSnapshot(root.evidencePage, EVIDENCE_FIELDS);
      const evidenceIdentity = evidence === null
        ? null : recordSnapshot(evidence.identity, EVIDENCE_IDENTITY_FIELDS);
      if (evidenceIdentity === null
          || EVIDENCE_IDENTITY_FIELDS.some((field) => evidenceIdentity[field] === undefined)
          || ['workspaceId', 'snapshotId', 'authorizationScopeDigest', 'queryReceipt',
            'graphSnapshotId', 'authorityReceiptUid']
            .some((field) => !validText(evidenceIdentity[field]))
          || !validSha256(evidenceIdentity.rawFusionDigest)
          || !validSha256(evidenceIdentity.evidenceDigest)
          || !Number.isSafeInteger(evidenceIdentity.graphPolicyVersion)
          || evidenceIdentity.graphPolicyVersion < 0
          || evidenceIdentity.graphPolicyVersion > 0xffffffff
          || !(evidenceIdentity.recencyEpochDay === null
            || (Number.isSafeInteger(evidenceIdentity.recencyEpochDay)
              && evidenceIdentity.recencyEpochDay >= 0
              && evidenceIdentity.recencyEpochDay <= MAX_EPOCH_DAY))) {
        return fail('invalid_evidence_identity');
      }
      if (evidenceIdentity.rawFusionDigest !== rawResult.value.identity.rawFusionDigest) {
        return fail('raw_fusion_digest_mismatch');
      }
      for (const field of ['workspaceId', 'snapshotId', 'authorizationScopeDigest', 'queryReceipt']) {
        if (evidenceIdentity[field] !== rawResult.value.identity.context[field]) {
          return fail('context_mismatch');
        }
      }
      if (root.policy === undefined || recordSnapshot(root.policy, Object.keys(POLICY)) === null) {
        return fail('invalid_policy');
      }
      if (!equalPolicy(root.policy)) return fail('policy_mismatch');
      if (!Number.isSafeInteger(root.outputLimit)
          || root.outputLimit < 1 || root.outputLimit > MAX_OUTPUT_HITS_V2) {
        return fail('invalid_output_limit');
      }
      const records = arraySnapshot(evidence.records);
      if (records === null || records.length !== rawResult.value.hits.length) {
        return fail('invalid_evidence_page');
      }
      const recordShapes = [];
      for (let index = 0; index < records.length; index += 1) {
        const shape = recordSnapshot(records[index], RECORD_FIELDS);
        if (shape === null) return fail('invalid_evidence_page');
        recordShapes.push(shape);
      }
      for (let index = 0; index < recordShapes.length; index += 1) {
        if (recordShapes[index].documentId !== rawResult.value.hits[index].documentId) {
          return fail('record_identity_mismatch');
        }
      }
      const traces = [];
      for (const shape of recordShapes) {
        const trace = normalizeTrace(shape.acceptedTrace);
        if (trace === null) return fail('invalid_accepted_trace');
        traces.push(trace);
      }
      const features = [];
      const components = [];
      for (const shape of recordShapes) {
        const feature = normalizeClassification(shape.featureMatch);
        const component = normalizeClassification(shape.componentMatch);
        if (feature === null || component === null) return fail('invalid_classification');
        features.push(feature);
        components.push(component);
      }
      const recencies = [];
      for (const shape of recordShapes) {
        if (shape.recency === null) {
          recencies.push(null);
          continue;
        }
        const item = recordSnapshot(shape.recency, RECENCY_FIELDS);
        if (item === null || evidenceIdentity.recencyEpochDay === null
            || !Number.isSafeInteger(item.documentRevisionEpochDay)
            || item.documentRevisionEpochDay < 0
            || item.documentRevisionEpochDay > evidenceIdentity.recencyEpochDay
            || !validText(item.evidenceUid)) return fail('invalid_recency');
        recencies.push(Object.freeze({ ...item }));
      }
      const statuses = [];
      for (const shape of recordShapes) {
        const status = recordSnapshot(shape.status, STATUS_FIELDS);
        if (status === null || !['active', 'stale', 'deprecated'].includes(status.value)
            || !validText(status.evidenceUid)) return fail('invalid_status');
        statuses.push(Object.freeze({ ...status }));
      }
      const normalizedRecords = recordShapes.map((shape, index) => Object.freeze({
        documentId: shape.documentId,
        acceptedTrace: traces[index],
        featureMatch: features[index],
        componentMatch: components[index],
        recency: recencies[index],
        status: statuses[index],
      }));
      const normalizedEvidencePage = Object.freeze({
        identity: Object.freeze({ ...evidenceIdentity }),
        records: Object.freeze(normalizedRecords),
      });
      try {
        if (verifyEvidencePage(Object.freeze({
          rawFusion: root.rawFusion,
          evidencePage: normalizedEvidencePage,
        })) !== true) return fail('invalid_evidence_authority');
      } catch (_error) {
        return fail('invalid_evidence_authority');
      }

      return finishCompletePoolRerank(
        rawResult, evidenceIdentity, normalizedRecords, root.outputLimit,
        Object.freeze({
          rerankContractVersion: RERANK_CONTRACT_V2,
          policyVersion: RERANK_POLICY_V1,
          internalPoolCount: rawResult.value.hits.length,
          graphSnapshotId: evidenceIdentity.graphSnapshotId,
          graphPolicyVersion: evidenceIdentity.graphPolicyVersion,
          recencyEpochDay: evidenceIdentity.recencyEpochDay,
          authorityReceiptUid: evidenceIdentity.authorityReceiptUid,
          evidenceDigest: evidenceIdentity.evidenceDigest,
        }),
      );
    },
  });
}

export function createRrfBoundedRerankerV3(options = {}) {
  const config = recordSnapshot(options, ['verifyEvidencePage', 'authorityVerifierDigest']);
  if (config === null || Reflect.ownKeys(config).length !== 2
      || typeof config.verifyEvidencePage !== 'function'
      || !validSha256(config.authorityVerifierDigest)) {
    throw new TypeError('V3 reranker requires verifyEvidencePage and authorityVerifierDigest');
  }
  const { verifyEvidencePage, authorityVerifierDigest } = config;
  return Object.freeze({
    rerankRrfCompletePoolV3(request) {
      const root = recordSnapshot(request, REQUEST_FIELDS);
      if (root === null) return fail('invalid_request');
      const rawResult = normalizeRawV2(root.rawFusion);
      if (!rawResult.ok) return rawResult;

      const evidence = recordSnapshot(root.evidencePage, EVIDENCE_FIELDS);
      const evidenceIdentity = evidence === null
        ? null : recordSnapshot(evidence.identity, EVIDENCE_IDENTITY_FIELDS_V3);
      if (evidenceIdentity === null
          || EVIDENCE_IDENTITY_FIELDS_V3.some((field) => evidenceIdentity[field] === undefined)
          || ['workspaceId', 'snapshotId', 'authorizationScopeDigest', 'queryReceipt',
            'graphSnapshotId', 'authorityReceiptUid']
            .some((field) => !validText(evidenceIdentity[field]))
          || !validSha256(evidenceIdentity.rawFusionDigest)
          || !validSha256(evidenceIdentity.evidenceDigest)
          || evidenceIdentity.evidenceContractVersion !== RERANK_EVIDENCE_CONTRACT_V3
          || !validSha256(evidenceIdentity.authorityVerifierDigest)
          || !Number.isSafeInteger(evidenceIdentity.graphPolicyVersion)
          || evidenceIdentity.graphPolicyVersion < 0
          || evidenceIdentity.graphPolicyVersion > 0xffffffff
          || !(evidenceIdentity.recencyEpochDay === null
            || (Number.isSafeInteger(evidenceIdentity.recencyEpochDay)
              && evidenceIdentity.recencyEpochDay >= 0
              && evidenceIdentity.recencyEpochDay <= MAX_EPOCH_DAY))) {
        return fail('invalid_evidence_identity');
      }
      if (evidenceIdentity.authorityVerifierDigest !== authorityVerifierDigest) {
        return fail('authority_verifier_mismatch');
      }
      if (evidenceIdentity.rawFusionDigest !== rawResult.value.identity.rawFusionDigest) {
        return fail('raw_fusion_digest_mismatch');
      }
      for (const field of ['workspaceId', 'snapshotId', 'authorizationScopeDigest', 'queryReceipt']) {
        if (evidenceIdentity[field] !== rawResult.value.identity.context[field]) {
          return fail('context_mismatch');
        }
      }
      if (root.policy === undefined || recordSnapshot(root.policy, Object.keys(POLICY)) === null) {
        return fail('invalid_policy');
      }
      if (!equalPolicy(root.policy)) return fail('policy_mismatch');
      if (!Number.isSafeInteger(root.outputLimit)
          || root.outputLimit < 1 || root.outputLimit > MAX_OUTPUT_HITS_V2) {
        return fail('invalid_output_limit');
      }
      const records = arraySnapshot(evidence.records);
      if (records === null || records.length !== rawResult.value.hits.length) {
        return fail('invalid_evidence_page');
      }
      const recordShapes = [];
      for (const record of records) {
        const shape = recordSnapshot(record, RECORD_FIELDS);
        if (shape === null) return fail('invalid_evidence_page');
        recordShapes.push(shape);
      }
      for (let index = 0; index < recordShapes.length; index += 1) {
        if (recordShapes[index].documentId !== rawResult.value.hits[index].documentId) {
          return fail('record_identity_mismatch');
        }
      }
      const traces = [];
      for (const shape of recordShapes) {
        const trace = normalizeTraceV3(shape.acceptedTrace);
        if (trace === null) return fail('invalid_accepted_trace');
        traces.push(trace);
      }
      const features = [];
      const components = [];
      for (const shape of recordShapes) {
        const feature = normalizeClassification(shape.featureMatch);
        const component = normalizeClassification(shape.componentMatch);
        if (feature === null || component === null) return fail('invalid_classification');
        features.push(feature);
        components.push(component);
      }
      const recencies = [];
      for (const shape of recordShapes) {
        if (shape.recency === null) {
          recencies.push(null);
          continue;
        }
        const item = recordSnapshot(shape.recency, RECENCY_FIELDS);
        if (item === null || evidenceIdentity.recencyEpochDay === null
            || !Number.isSafeInteger(item.documentRevisionEpochDay)
            || item.documentRevisionEpochDay < 0
            || item.documentRevisionEpochDay > evidenceIdentity.recencyEpochDay
            || !validText(item.evidenceUid)) return fail('invalid_recency');
        recencies.push(Object.freeze({ ...item }));
      }
      const statuses = [];
      for (const shape of recordShapes) {
        const status = recordSnapshot(shape.status, STATUS_FIELDS);
        if (status === null || !['active', 'stale', 'deprecated'].includes(status.value)
            || !validText(status.evidenceUid)) return fail('invalid_status');
        statuses.push(Object.freeze({ ...status }));
      }
      const normalizedRecords = recordShapes.map((shape, index) => Object.freeze({
        documentId: shape.documentId,
        acceptedTrace: traces[index],
        featureMatch: features[index],
        componentMatch: components[index],
        recency: recencies[index],
        status: statuses[index],
      }));
      if (evidenceDigestV3(evidenceIdentity, normalizedRecords) !== evidenceIdentity.evidenceDigest) {
        return fail('evidence_digest_mismatch');
      }
      const normalizedEvidencePage = Object.freeze({
        identity: Object.freeze({ ...evidenceIdentity }),
        records: Object.freeze(normalizedRecords),
      });
      try {
        if (verifyEvidencePage(Object.freeze({
          rawFusion: root.rawFusion,
          evidencePage: normalizedEvidencePage,
        })) !== true) return fail('invalid_evidence_authority');
      } catch (_error) {
        return fail('invalid_evidence_authority');
      }
      return finishCompletePoolRerank(
        rawResult, evidenceIdentity, normalizedRecords, root.outputLimit,
        Object.freeze({
          rerankContractVersion: RERANK_CONTRACT_V3,
          evidenceContractVersion: RERANK_EVIDENCE_CONTRACT_V3,
          authorityVerifierDigest,
          policyVersion: RERANK_POLICY_V1,
          internalPoolCount: rawResult.value.hits.length,
          graphSnapshotId: evidenceIdentity.graphSnapshotId,
          graphPolicyVersion: evidenceIdentity.graphPolicyVersion,
          recencyEpochDay: evidenceIdentity.recencyEpochDay,
          authorityReceiptUid: evidenceIdentity.authorityReceiptUid,
          evidenceDigest: evidenceIdentity.evidenceDigest,
        }),
      );
    },
  });
}

export function rerankPolicyV1() {
  return POLICY;
}
