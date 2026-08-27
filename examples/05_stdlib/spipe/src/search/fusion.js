import { createHash } from 'node:crypto';

import { canonicalJson } from '../storage/canonical.js';

export const RRF_CONTRACT_V1 = 'rrf-fixed-v1';
export const RRF_SCALE_V1 = 1_000_000_000;
export const RRF_DEFAULT_K_V1 = 60;
export const RRF_DEFAULT_SOURCE_K_V1 = 1000;
export const RRF_DEFAULT_LIMIT_V1 = 1000;
export const RRF_MAX_SOURCES_V1 = 3;
export const RRF_MAX_DOC_ID_BYTES_V1 = 512;
export const RRF_POOL_CONTRACT_V2 = 'rrf-complete-pool-v2';
export const RRF_ARITHMETIC_CONTRACT_V2 = RRF_CONTRACT_V1;
export const RRF_MAX_SOURCE_K_V2 = 1000;
export const RRF_MAX_POOL_HITS_V2 = 3000;
export const RRF_MAX_PUBLIC_HITS_V2 = 1000;

const MAX_K = 10_000;
const MAX_SOURCE_K = 1000;
const MAX_LIMIT = 1000;
const SOURCE_ORDER = Object.freeze(['lexical', 'graph', 'semantic']);
const CONTEXT_FIELDS = Object.freeze([
  'workspaceId',
  'snapshotId',
  'authorizationScopeDigest',
  'queryReceipt',
  'analyzerIdentity',
]);
const REQUEST_FIELDS = Object.freeze(['context', 'k', 'sourceK', 'limit', 'sources']);
const SOURCE_FIELDS = Object.freeze(['name', 'sourceIdentity', 'candidates']);
const CANDIDATE_FIELDS = Object.freeze(['documentId']);
const REQUEST_FIELDS_V2 = Object.freeze(['context', 'k', 'sourceK', 'sources']);
const SOURCE_FIELDS_V2 = Object.freeze([
  'name', 'sourceIdentity', 'complete', 'candidateCount', 'candidateDigest', 'candidates',
]);
const SOURCE_POOL_DOMAIN_V2 = 'spipe-rrf-source-pool-v1\0';
const COMPLETE_SOURCE_SET_DOMAIN_V2 = 'spipe-rrf-complete-source-set-v1\0';
const COMPLETE_OUTPUT_DOMAIN_V2 = 'spipe-rrf-complete-output-v1\0';

function failure(code, details) {
  return Object.freeze({
    ok: false,
    error: Object.freeze(details === undefined ? { code } : { code, ...details }),
  });
}

function dataRecordSnapshot(value, allowedFields) {
  if (value === null || typeof value !== 'object') return null;
  let prototype;
  let descriptors;
  try {
    if (Array.isArray(value)) return null;
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch (_error) {
    return null;
  }
  if (prototype !== Object.prototype && prototype !== null) return null;
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== 'string')) return null;
  const names = keys;
  if (names.some((name) => !allowedFields.includes(name))) return null;

  const snapshot = Object.create(null);
  for (const name of names) {
    const descriptor = descriptors[name];
    if (
      !Object.hasOwn(descriptor, 'value')
      || Object.hasOwn(descriptor, 'get')
      || Object.hasOwn(descriptor, 'set')
      || descriptor.enumerable !== true
    ) return null;
    snapshot[name] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

function denseArraySnapshot(value) {
  if (value === null || typeof value !== 'object') return null;
  let descriptors;
  try {
    if (!Array.isArray(value)) return null;
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch (_error) {
    return null;
  }
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== 'string')) return null;
  const lengthDescriptor = descriptors.length;
  if (
    lengthDescriptor === undefined
    || !Object.hasOwn(lengthDescriptor, 'value')
    || Object.hasOwn(lengthDescriptor, 'get')
    || Object.hasOwn(lengthDescriptor, 'set')
    || !Number.isSafeInteger(lengthDescriptor.value)
    || lengthDescriptor.value < 0
  ) return null;

  const length = lengthDescriptor.value;
  const snapshot = new Array(length);
  const names = keys;
  if (names.length !== length + 1) return null;
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (
      descriptor === undefined
      || !Object.hasOwn(descriptor, 'value')
      || Object.hasOwn(descriptor, 'get')
      || Object.hasOwn(descriptor, 'set')
      || descriptor.enumerable !== true
    ) return null;
    snapshot[index] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

function utf8BytesV1(value) {
  if (typeof value !== 'string') return null;
  const bytes = [];
  for (let index = 0; index < value.length; index += 1) {
    let scalar = value.charCodeAt(index);
    if (scalar >= 0xd800 && scalar <= 0xdbff) {
      if (index + 1 >= value.length) return null;
      const low = value.charCodeAt(index + 1);
      if (low < 0xdc00 || low > 0xdfff) return null;
      scalar = 0x10000 + ((scalar - 0xd800) << 10) + (low - 0xdc00);
      index += 1;
    } else if (scalar >= 0xdc00 && scalar <= 0xdfff) {
      return null;
    }

    if (scalar <= 0x7f) bytes.push(scalar);
    else if (scalar <= 0x7ff) bytes.push(0xc0 | (scalar >> 6), 0x80 | (scalar & 0x3f));
    else if (scalar <= 0xffff) {
      bytes.push(
        0xe0 | (scalar >> 12),
        0x80 | ((scalar >> 6) & 0x3f),
        0x80 | (scalar & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (scalar >> 18),
        0x80 | ((scalar >> 12) & 0x3f),
        0x80 | ((scalar >> 6) & 0x3f),
        0x80 | (scalar & 0x3f),
      );
    }
  }
  return bytes;
}

export function unsignedUtf8CompareV1(left, right) {
  const leftBytes = utf8BytesV1(left);
  const rightBytes = utf8BytesV1(right);
  if (leftBytes === null || rightBytes === null) throw new TypeError('invalid_utf8_string');
  const shared = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < shared; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return leftBytes[index] - rightBytes[index];
  }
  return leftBytes.length - rightBytes.length;
}

function validBoundedString(value, maximumBytes) {
  if (typeof value !== 'string' || value.length === 0) return false;
  const bytes = utf8BytesV1(value);
  return bytes !== null && bytes.length <= maximumBytes;
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

function normalizeRequest(request) {
  const root = dataRecordSnapshot(request, REQUEST_FIELDS);
  if (root === null) return failure('invalid_request');

  const context = dataRecordSnapshot(root.context, CONTEXT_FIELDS);
  if (context === null) return failure('invalid_context', { field: CONTEXT_FIELDS[0] });
  const normalizedContext = {};
  for (const field of CONTEXT_FIELDS) {
    if (!validBoundedString(context[field], RRF_MAX_DOC_ID_BYTES_V1)) {
      return failure('invalid_context', { field });
    }
    normalizedContext[field] = context[field];
  }

  const k = root.k === undefined ? RRF_DEFAULT_K_V1 : root.k;
  if (!Number.isSafeInteger(k) || k < 1 || k > MAX_K) return failure('invalid_k');
  const sourceK = root.sourceK === undefined ? RRF_DEFAULT_SOURCE_K_V1 : root.sourceK;
  if (!Number.isSafeInteger(sourceK) || sourceK < 1 || sourceK > MAX_SOURCE_K) {
    return failure('invalid_source_k');
  }
  const limit = root.limit === undefined ? RRF_DEFAULT_LIMIT_V1 : root.limit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return failure('invalid_limit');
  }

  const sources = denseArraySnapshot(root.sources);
  if (sources === null || sources.length < 2 || sources.length > RRF_MAX_SOURCES_V1) {
    return failure('invalid_sources');
  }

  const normalizedSources = [];
  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
    const source = dataRecordSnapshot(sources[sourceIndex], SOURCE_FIELDS);
    if (source === null) return failure('invalid_source_identity', { source: undefined });
    if (typeof source.name !== 'string') {
      return failure('invalid_source_identity', { source: undefined });
    }
    normalizedSources.push(Object.freeze({
      name: source.name,
      sourceIdentity: source.sourceIdentity,
      candidates: source.candidates,
    }));
  }

  const names = normalizedSources.map((source) => source.name);
  if (!names.includes('lexical')) return failure('missing_required_source', { source: 'lexical' });
  if (!names.includes('graph')) return failure('missing_required_source', { source: 'graph' });

  let previousOrdinal = -1;
  for (const name of names) {
    const ordinal = SOURCE_ORDER.indexOf(name);
    if (ordinal < 0 || ordinal < previousOrdinal) {
      return failure('invalid_source_order', { source: name });
    }
    previousOrdinal = ordinal;
  }
  if (new Set(names).size !== names.length) return failure('duplicate_source');

  const completeSources = [];
  for (const source of normalizedSources) {
    if (!validBoundedString(source.sourceIdentity, RRF_MAX_DOC_ID_BYTES_V1)) {
      return failure('invalid_source_identity', { source: source.name });
    }
    const candidates = denseArraySnapshot(source.candidates);
    if (candidates === null) return failure('invalid_candidate_page', { source: source.name });
    if (candidates.length > MAX_SOURCE_K) {
      return failure('too_many_candidates', { source: source.name });
    }

    const normalizedCandidates = [];
    const seen = new Set();
    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
      const candidate = dataRecordSnapshot(candidates[candidateIndex], CANDIDATE_FIELDS);
      if (candidate === null) {
        return failure('invalid_candidate', { source: source.name, candidateIndex });
      }
      if (typeof candidate.documentId !== 'string' || candidate.documentId.length === 0) {
        return failure('invalid_document_id', { source: source.name, candidateIndex });
      }
      const bytes = utf8BytesV1(candidate.documentId);
      if (bytes === null) {
        return failure('invalid_document_id', { source: source.name, candidateIndex });
      }
      if (bytes.length > RRF_MAX_DOC_ID_BYTES_V1) {
        return failure('document_id_too_large', { source: source.name, candidateIndex });
      }
      if (seen.has(candidate.documentId)) {
        return failure('duplicate_document_id', { source: source.name, candidateIndex });
      }
      seen.add(candidate.documentId);
      normalizedCandidates.push(Object.freeze({ documentId: candidate.documentId }));
    }
    completeSources.push(Object.freeze({
      name: source.name,
      sourceIdentity: source.sourceIdentity,
      candidates: Object.freeze(normalizedCandidates),
    }));
  }

  return Object.freeze({
    ok: true,
    value: Object.freeze({
      context: Object.freeze(normalizedContext),
      k,
      sourceK,
      limit,
      sources: Object.freeze(completeSources),
    }),
  });
}

export function fuseRrfRawV1(request) {
  const normalized = normalizeRequest(request);
  if (!normalized.ok) return normalized;
  const {
    context, k, sourceK, limit, sources,
  } = normalized.value;

  const accumulated = new Map();
  const orderedSources = [];
  for (const source of sources) {
    orderedSources.push(Object.freeze({
      name: source.name,
      sourceIdentity: source.sourceIdentity,
    }));
    const acceptedCount = Math.min(sourceK, source.candidates.length);
    for (let index = 0; index < acceptedCount; index += 1) {
      const { documentId } = source.candidates[index];
      const sourceRank = index + 1;
      const contributionUnits = Math.floor(RRF_SCALE_V1 / (k + sourceRank));
      let record = accumulated.get(documentId);
      if (record === undefined) {
        record = { documentId, rawScoreUnits: 0, contributions: [] };
        accumulated.set(documentId, record);
      }
      record.rawScoreUnits += contributionUnits;
      record.contributions.push(Object.freeze({
        source: source.name,
        sourceIdentity: source.sourceIdentity,
        sourceRank,
        contributionUnits,
      }));
    }
  }

  const ranked = Array.from(accumulated.values());
  ranked.sort((left, right) => {
    if (left.rawScoreUnits !== right.rawScoreUnits) return right.rawScoreUnits - left.rawScoreUnits;
    return unsignedUtf8CompareV1(left.documentId, right.documentId);
  });
  const hits = ranked.slice(0, limit).map((hit, index) => Object.freeze({
    documentId: hit.documentId,
    fusedRank: index + 1,
    rawScoreUnits: hit.rawScoreUnits,
    contributions: Object.freeze(hit.contributions),
  }));

  return Object.freeze({
    ok: true,
    value: Object.freeze({
      identity: Object.freeze({
        contractVersion: RRF_CONTRACT_V1,
        k,
        sourceK,
        orderedSources: Object.freeze(orderedSources),
        context,
      }),
      hits: Object.freeze(hits),
    }),
  });
}

export function fuseRrfCompletePoolV2(request) {
  const root = dataRecordSnapshot(request, REQUEST_FIELDS_V2);
  if (root === null) return failure('invalid_request');

  const context = dataRecordSnapshot(root.context, CONTEXT_FIELDS);
  if (context === null) return failure('invalid_context', { field: CONTEXT_FIELDS[0] });
  const normalizedContext = {};
  for (const field of CONTEXT_FIELDS) {
    if (!validBoundedString(context[field], RRF_MAX_DOC_ID_BYTES_V1)) {
      return failure('invalid_context', { field });
    }
    normalizedContext[field] = context[field];
  }

  const k = root.k === undefined ? RRF_DEFAULT_K_V1 : root.k;
  if (!Number.isSafeInteger(k) || k < 1 || k > MAX_K) return failure('invalid_k');
  const sourceK = root.sourceK === undefined ? RRF_DEFAULT_SOURCE_K_V1 : root.sourceK;
  if (!Number.isSafeInteger(sourceK) || sourceK < 1 || sourceK > RRF_MAX_SOURCE_K_V2) {
    return failure('invalid_source_k');
  }

  const sources = denseArraySnapshot(root.sources);
  if (sources === null || sources.length < 2 || sources.length > RRF_MAX_SOURCES_V1) {
    return failure('invalid_sources');
  }
  const sourceShapes = [];
  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
    const source = dataRecordSnapshot(sources[sourceIndex], SOURCE_FIELDS_V2);
    if (source === null || typeof source.name !== 'string') {
      return failure('invalid_source_identity', { source: undefined });
    }
    if (!validBoundedString(source.sourceIdentity, RRF_MAX_DOC_ID_BYTES_V1)) {
      return failure('invalid_source_identity', { source: source.name });
    }
    sourceShapes.push(source);
  }

  const names = sourceShapes.map((source) => source.name);
  if (!names.includes('lexical')) return failure('missing_required_source', { source: 'lexical' });
  if (!names.includes('graph')) return failure('missing_required_source', { source: 'graph' });
  let previousOrdinal = -1;
  for (const name of names) {
    const ordinal = SOURCE_ORDER.indexOf(name);
    if (ordinal < 0 || ordinal < previousOrdinal) {
      return failure('invalid_source_order', { source: name });
    }
    previousOrdinal = ordinal;
  }
  if (new Set(names).size !== names.length) return failure('duplicate_source');

  const normalizedSources = [];
  for (const source of sourceShapes) {
    if (source.complete !== true) return failure('incomplete_source_page', { source: source.name });
    if (!Number.isSafeInteger(source.candidateCount) || source.candidateCount < 0) {
      return failure('invalid_candidate_count', { source: source.name });
    }
    const candidates = denseArraySnapshot(source.candidates);
    if (candidates === null) return failure('invalid_candidate_page', { source: source.name });
    if (source.candidateCount !== candidates.length) {
      return failure('invalid_candidate_count', { source: source.name });
    }
    if (source.candidateCount > sourceK || source.candidateCount > RRF_MAX_SOURCE_K_V2) {
      return failure('too_many_candidates', { source: source.name });
    }

    const normalizedCandidates = [];
    const documentIds = [];
    const seen = new Set();
    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
      const candidate = dataRecordSnapshot(candidates[candidateIndex], CANDIDATE_FIELDS);
      if (candidate === null) {
        return failure('invalid_candidate', { source: source.name, candidateIndex });
      }
      if (typeof candidate.documentId !== 'string' || candidate.documentId.length === 0) {
        return failure('invalid_document_id', { source: source.name, candidateIndex });
      }
      const bytes = utf8BytesV1(candidate.documentId);
      if (bytes === null) {
        return failure('invalid_document_id', { source: source.name, candidateIndex });
      }
      if (bytes.length > RRF_MAX_DOC_ID_BYTES_V1) {
        return failure('document_id_too_large', { source: source.name, candidateIndex });
      }
      if (seen.has(candidate.documentId)) {
        return failure('duplicate_document_id', { source: source.name, candidateIndex });
      }
      seen.add(candidate.documentId);
      documentIds.push(candidate.documentId);
      normalizedCandidates.push(Object.freeze({ documentId: candidate.documentId }));
    }
    const expectedCandidateDigest = candidateDigestV2(
      source.name, source.sourceIdentity, documentIds,
    );
    if (source.candidateDigest !== expectedCandidateDigest) {
      return failure('candidate_digest_mismatch', { source: source.name });
    }
    normalizedSources.push(Object.freeze({
      name: source.name,
      sourceIdentity: source.sourceIdentity,
      complete: true,
      candidateCount: source.candidateCount,
      candidateDigest: expectedCandidateDigest,
      candidates: Object.freeze(normalizedCandidates),
    }));
  }

  const accumulated = new Map();
  for (const source of normalizedSources) {
    for (let index = 0; index < source.candidates.length; index += 1) {
      const { documentId } = source.candidates[index];
      const sourceRank = index + 1;
      const contributionUnits = Math.floor(RRF_SCALE_V1 / (k + sourceRank));
      let record = accumulated.get(documentId);
      if (record === undefined) {
        if (accumulated.size >= RRF_MAX_POOL_HITS_V2) return failure('pool_too_large');
        record = { documentId, rawScoreUnits: 0, contributions: [] };
        accumulated.set(documentId, record);
      }
      const rawScoreUnits = record.rawScoreUnits + contributionUnits;
      if (!Number.isSafeInteger(contributionUnits) || !Number.isSafeInteger(rawScoreUnits)) {
        return failure('arithmetic_overflow');
      }
      record.rawScoreUnits = rawScoreUnits;
      record.contributions.push(Object.freeze({
        source: source.name,
        sourceIdentity: source.sourceIdentity,
        sourceRank,
        contributionUnits,
      }));
    }
  }

  const ranked = Array.from(accumulated.values());
  ranked.sort((left, right) => {
    if (left.rawScoreUnits !== right.rawScoreUnits) return right.rawScoreUnits - left.rawScoreUnits;
    return unsignedUtf8CompareV1(left.documentId, right.documentId);
  });
  const hits = Object.freeze(ranked.map((hit, index) => Object.freeze({
    documentId: hit.documentId,
    fusedRank: index + 1,
    rawScoreUnits: hit.rawScoreUnits,
    contributions: Object.freeze(hit.contributions),
  })));
  const orderedSources = Object.freeze(normalizedSources.map((source) => Object.freeze({
    name: source.name,
    sourceIdentity: source.sourceIdentity,
    complete: source.complete,
    candidateCount: source.candidateCount,
    candidateDigest: source.candidateDigest,
  })));
  const identityWithoutDigest = Object.freeze({
    contractVersion: RRF_POOL_CONTRACT_V2,
    arithmeticContractVersion: RRF_ARITHMETIC_CONTRACT_V2,
    k,
    sourceK,
    orderedSources,
    context: Object.freeze(normalizedContext),
    complete: true,
    uniqueDocumentCount: hits.length,
    sourcePoolDigest: sourcePoolDigestV2(orderedSources),
  });
  const rawFusionDigest = rawFusionDigestV2(identityWithoutDigest, hits);
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      identity: Object.freeze({ ...identityWithoutDigest, rawFusionDigest }),
      hits,
    }),
  });
}
