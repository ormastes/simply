import { createHash } from 'node:crypto';

import { assertCanonicalUid, normalizeRevision } from '../model/identity.js';

export const LEXICAL_SOURCE_CONTRACT_V1 = 'spipe-authorized-lexical-source-v1';

const PROVIDER_PAGE_SCHEMA = 'spipe-authorized-lexical-provider-page-v1';
const PROVIDER_CONTRACT = 'spipe-search-provider/1.0';
const ANALYZER_CONTRACT = 'spipe-unicode-lex-v1';
const SCORE_CONTRACT = 'bm25-fixed-v1';
const QUERY_DOMAIN = 'spipe-authorized-lexical-query-v1\0';
const BINDING_DOMAIN = 'spipe-authorized-lexical-binding-v1\0';
const CURSOR_DOMAIN = 'spipe-authorized-lexical-provider-cursor-v1\0';
const PAGE_DOMAIN = 'spipe-authorized-lexical-provider-page-v1\0';
const PAGE_SET_DOMAIN = 'spipe-authorized-lexical-page-set-v1\0';
const RANK_EVIDENCE_DOMAIN = 'spipe-authorized-lexical-rank-evidence-v1\0';
const SOURCE_IDENTITY_DOMAIN = 'spipe-authorized-lexical-source-v1\0';
const RRF_SOURCE_POOL_DOMAIN = 'spipe-rrf-source-pool-v1\0';

const MAX_QUERY_BYTES = 4096;
const MAX_BINDING_BYTES = 512;
const MAX_DOCUMENT_ID_BYTES = 512;
const MAX_SOURCE_K = 1000;
const MAX_PROVIDER_PAGES = 64;
const MAX_PROVIDER_CANDIDATES = 1000;
const MAX_PROVIDER_CURSOR_BYTES = 8192;
const MAX_PROVIDER_PAGE_BYTES = 524_288;
const MAX_AGGREGATE_EVIDENCE_BYTES = 2_097_152;
const UINT32_MAX = 0xffff_ffff;
const HASH = /^sha256:[0-9a-f]{64}$/;
const SNAPSHOT = /^spks1-[0-9a-f]{64}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

const CONFIG_FIELDS = Object.freeze([
  'verifySearchReceipt', 'readLexicalProviderPage',
  'authorizeArtifactCandidate', 'verifyLexicalEvidence',
]);
const REQUEST_FIELDS = Object.freeze([
  'contractVersion', 'operation', 'query', 'context', 'pin', 'sourceK',
  'excludedDocumentUid',
]);
const CONTEXT_FIELDS = Object.freeze([
  'workspaceId', 'snapshotId', 'authorizationScopeDigest', 'queryReceipt',
  'analyzerIdentity',
]);
const PIN_FIELDS = Object.freeze([
  'workspaceUid', 'projectUid', 'worktreeUid', 'revisionId', 'snapshotId',
  'lexicalRoot', 'authorizationScopeDigest', 'policyHash', 'policyVersion',
  'searchReceiptUid', 'analyzerIdentity',
]);
const BINDING_FIELDS = Object.freeze([
  'contractVersion', 'operation', 'workspaceUid', 'projectUid', 'worktreeUid',
  'revisionId', 'snapshotId', 'lexicalRoot', 'authorizationScopeDigest',
  'policyHash', 'policyVersion', 'searchReceiptUid', 'analyzerIdentity',
  'queryDigest', 'sourceK', 'excludedDocumentUid',
]);
const PAGE_FIELDS = Object.freeze([
  'schema', 'bindingDigest', 'providerIdentity', 'excludedDocumentUid',
  'exclusionApplied', 'providerCursorDigest', 'requestedLimit', 'pageStartRank',
  'candidateCount', 'candidates', 'nextCursor', 'nextCursorDigest', 'exhausted',
  'pageDigest', 'receipt',
]);
const PROVIDER_IDENTITY_FIELDS = Object.freeze([
  'providerContractVersion', 'providerImplementationDigest',
  'analyzerIdentity', 'scoreContractVersion',
]);
const CANDIDATE_FIELDS = Object.freeze([
  'documentId', 'sourceRank', 'sourceScoreMilli',
]);
const PAGE_RECEIPT_FIELDS = Object.freeze([
  'receiptUid', 'kind', 'bindingDigest', 'excludedDocumentUid',
  'exclusionApplied', 'providerCursorDigest', 'requestedLimit',
  'nextCursorDigest', 'pageDigest',
]);
const AUTHORIZATION_FIELDS = Object.freeze([
  'documentId', 'sourceRank', 'authorizationScopeDigest', 'policyHash',
  'policyVersion', 'searchReceiptUid', 'decision',
]);
const EVIDENCE_RESULT_FIELDS = Object.freeze([
  'bindingDigest', 'pageSetDigest', 'rankEvidenceDigest', 'excludedDocumentUid',
  'exclusionApplied', 'authorityReceiptUid', 'decision',
]);

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function success(value) { return deepFreeze({ ok: true, value }); }
function failure(code, field) {
  return deepFreeze({ ok: false, error: field === undefined ? { code } : { code, field } });
}

function closedRecord(value, fields, requireFrozen = false) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    if (requireFrozen && !Object.isFrozen(value)) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length !== fields.length
        || keys.some((key) => typeof key !== 'string' || !fields.includes(key))) return null;
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

function denseArray(value, maximumLength, requireFrozen = false) {
  if (value === null || typeof value !== 'object') return { kind: 'invalid' };
  try {
    if (!Array.isArray(value)) return { kind: 'invalid' };
    if (requireFrozen && !Object.isFrozen(value)) return { kind: 'invalid' };
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (lengthDescriptor === undefined || !Object.hasOwn(lengthDescriptor, 'value')
        || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) {
      return { kind: 'invalid' };
    }
    if (lengthDescriptor.value > maximumLength) return { kind: 'limit' };
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    const length = lengthDescriptor.value;
    if (keys.length !== length + 1) return { kind: 'invalid' };
    const result = new Array(length);
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')
          || Object.hasOwn(descriptor, 'get') || Object.hasOwn(descriptor, 'set')
          || descriptor.enumerable !== true) return { kind: 'invalid' };
      result[index] = descriptor.value;
    }
    return { kind: 'ok', value: Object.freeze(result) };
  } catch (_error) { return { kind: 'invalid' }; }
}

function scalarText(value) {
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

function byteLength(value) {
  const scalar = scalarText(value);
  return scalar === null ? -1 : Buffer.byteLength(scalar, 'utf8');
}

function canonicalUid(value, prefixes) {
  try { return assertCanonicalUid(value, 'uid', prefixes); } catch (_error) { return null; }
}

function canonicalRevision(value) {
  try {
    const normalized = normalizeRevision(value, 'revisionId');
    return normalized === value ? normalized : null;
  } catch (_error) { return null; }
}

function unsignedUtf8Compare(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function quoteCanonicalString(value) {
  const scalar = scalarText(value);
  if (scalar === null) throw new TypeError('invalid_unicode_scalar');
  const normalized = scalar.normalize('NFC');
  let result = '"';
  for (const character of normalized) {
    const codePoint = character.codePointAt(0);
    if (character === '"') result += '\\"';
    else if (character === '\\') result += '\\\\';
    else if (codePoint <= 0x1f) result += `\\u00${codePoint.toString(16).padStart(2, '0')}`;
    else result += character;
  }
  return `${result}"`;
}

function canonicalLexicalValue(value, seen = new Set()) {
  if (value === null) return 'null';
  if (typeof value === 'string') return quoteCanonicalString(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) throw new TypeError('invalid_integer');
    return String(value);
  }
  if (typeof value !== 'object' || seen.has(value)) throw new TypeError('unsupported_value');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const length = descriptors.length?.value;
      if (!Number.isSafeInteger(length) || length < 0
          || Reflect.ownKeys(descriptors).length !== length + 1) throw new TypeError('invalid_array');
      const items = new Array(length);
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) throw new TypeError('invalid_array');
        items[index] = canonicalLexicalValue(descriptor.value, seen);
      }
      return `[${items.join(',')}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError('invalid_record');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const entries = [];
    const normalizedKeys = new Set();
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== 'string') throw new TypeError('invalid_record');
      const descriptor = descriptors[key];
      if (!Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) throw new TypeError('invalid_record');
      const normalizedKey = scalarText(key)?.normalize('NFC');
      if (normalizedKey === undefined || normalizedKey === null || normalizedKeys.has(normalizedKey)) {
        throw new TypeError('duplicate_key');
      }
      normalizedKeys.add(normalizedKey);
      entries.push([normalizedKey, descriptor.value]);
    }
    entries.sort((left, right) => unsignedUtf8Compare(left[0], right[0]));
    return `{${entries.map(([key, child]) => `${quoteCanonicalString(key)}:${canonicalLexicalValue(child, seen)}`).join(',')}}`;
  } finally { seen.delete(value); }
}

function canonicalBytesLexicalV1(value) {
  return Buffer.from(canonicalLexicalValue(value), 'utf8');
}

function digest(domain, value) {
  return `sha256:${createHash('sha256')
    .update(Buffer.from(domain, 'utf8'))
    .update(canonicalBytesLexicalV1(value))
    .digest('hex')}`;
}

function canonicalCursor(value) {
  if (value === null) return { kind: 'ok', value: null };
  if (typeof value !== 'string') return { kind: 'invalid' };
  if (value.length > MAX_PROVIDER_CURSOR_BYTES) return { kind: 'limit' };
  const bytes = byteLength(value);
  if (bytes < 0) return { kind: 'invalid' };
  if (bytes > MAX_PROVIDER_CURSOR_BYTES) return { kind: 'limit' };
  if (bytes === 0 || !BASE64URL.test(value)) return { kind: 'invalid' };
  try {
    if (Buffer.from(value, 'base64url').toString('base64url') !== value) return { kind: 'invalid' };
  } catch (_error) { return { kind: 'invalid' }; }
  return { kind: 'ok', value };
}

function boundedPageString(value) {
  if (typeof value !== 'string') return { kind: 'invalid' };
  if (value.length > MAX_PROVIDER_PAGE_BYTES) return { kind: 'limit' };
  const scalar = scalarText(value);
  if (scalar === null) return { kind: 'invalid' };
  return byteLength(scalar) > MAX_PROVIDER_PAGE_BYTES ? { kind: 'limit' } : { kind: 'ok' };
}

function cursorDigest(bindingDigest, cursor) {
  return cursor === null ? null : digest(CURSOR_DOMAIN, { bindingDigest, cursor });
}

function normalizeRequest(input) {
  const request = closedRecord(input, REQUEST_FIELDS);
  if (request === null) return failure('invalid_request');
  const context = closedRecord(request.context, CONTEXT_FIELDS);
  if (context === null) return failure('invalid_request', 'context');
  const pin = closedRecord(request.pin, PIN_FIELDS);
  if (pin === null) return failure('invalid_request', 'pin');
  if (request.contractVersion !== LEXICAL_SOURCE_CONTRACT_V1) return failure('invalid_request', 'contractVersion');
  if (request.operation !== 'lexical_source') return failure('invalid_request', 'operation');

  const rawQuery = scalarText(request.query);
  if (rawQuery === null || rawQuery.length === 0 || rawQuery.includes('\0')) return failure('invalid_request', 'query');
  const rawQueryDefinitelyOversized = rawQuery.length > MAX_QUERY_BYTES;
  const query = rawQueryDefinitelyOversized ? rawQuery : rawQuery.normalize('NFC');
  let limitField = rawQueryDefinitelyOversized
    || byteLength(rawQuery) > MAX_QUERY_BYTES || byteLength(query) > MAX_QUERY_BYTES ? 'query' : null;
  const setLimit = (field) => { if (limitField === null) limitField = field; };

  const sourceK = request.sourceK === undefined ? MAX_SOURCE_K : request.sourceK;
  if (!Number.isSafeInteger(sourceK)) return failure('invalid_request', 'sourceK');
  if (sourceK < 1 || sourceK > MAX_SOURCE_K) setLimit('sourceK');
  const excludedDocumentUid = request.excludedDocumentUid;
  if (excludedDocumentUid !== null && canonicalUid(excludedDocumentUid, ['A']) === null) {
    return failure('invalid_request', 'excludedDocumentUid');
  }

  const bindingText = (field, value, predicate) => {
    const bytes = byteLength(value);
    if (bytes < 0 || bytes === 0) return failure('invalid_request', field);
    if (bytes > MAX_BINDING_BYTES) { setLimit(field); return null; }
    return predicate(value) ? null : failure('invalid_request', field);
  };
  let invalid = bindingText('workspaceUid', pin.workspaceUid, (value) => canonicalUid(value, ['WS']) !== null);
  if (invalid !== null) return invalid;
  invalid = bindingText('projectUid', pin.projectUid, (value) => canonicalUid(value, ['P']) !== null);
  if (invalid !== null) return invalid;
  invalid = bindingText('worktreeUid', pin.worktreeUid, (value) => canonicalUid(value, ['WT', 'W']) !== null);
  if (invalid !== null) return invalid;
  invalid = bindingText('revisionId', pin.revisionId, (value) => canonicalRevision(value) !== null);
  if (invalid !== null) return invalid;
  invalid = bindingText('snapshotId', pin.snapshotId, (value) => SNAPSHOT.test(value));
  if (invalid !== null) return invalid;
  invalid = bindingText('lexicalRoot', pin.lexicalRoot, (value) => HASH.test(value));
  if (invalid !== null) return invalid;
  invalid = bindingText('authorizationScopeDigest', pin.authorizationScopeDigest, (value) => HASH.test(value));
  if (invalid !== null) return invalid;
  invalid = bindingText('policyHash', pin.policyHash, (value) => HASH.test(value));
  if (invalid !== null) return invalid;
  if (!Number.isSafeInteger(pin.policyVersion) || pin.policyVersion < 0 || pin.policyVersion > UINT32_MAX) {
    return failure('invalid_request', 'policyVersion');
  }
  invalid = bindingText('searchReceiptUid', pin.searchReceiptUid, (value) => canonicalUid(value, ['D']) !== null);
  if (invalid !== null) return invalid;
  invalid = bindingText('analyzerIdentity', pin.analyzerIdentity, (value) => value === ANALYZER_CONTRACT);
  if (invalid !== null) return invalid;

  if (context.workspaceId !== pin.workspaceUid) return failure('invalid_request', 'workspaceId');
  if (context.snapshotId !== pin.snapshotId) return failure('invalid_request', 'snapshotId');
  if (context.authorizationScopeDigest !== pin.authorizationScopeDigest) {
    return failure('invalid_request', 'authorizationScopeDigest');
  }
  if (context.queryReceipt !== pin.searchReceiptUid) return failure('invalid_request', 'queryReceipt');
  if (context.analyzerIdentity !== pin.analyzerIdentity) return failure('invalid_request', 'analyzerIdentity');
  if (limitField !== null) return failure('limit_exceeded', limitField);

  const normalizedContext = deepFreeze({
    workspaceId: context.workspaceId,
    snapshotId: context.snapshotId,
    authorizationScopeDigest: context.authorizationScopeDigest,
    queryReceipt: context.queryReceipt,
    analyzerIdentity: context.analyzerIdentity,
  });
  const queryDigest = digest(QUERY_DOMAIN, { query, context: normalizedContext });
  const binding = deepFreeze({
    contractVersion: LEXICAL_SOURCE_CONTRACT_V1,
    operation: 'lexical_source',
    workspaceUid: pin.workspaceUid,
    projectUid: pin.projectUid,
    worktreeUid: pin.worktreeUid,
    revisionId: pin.revisionId,
    snapshotId: pin.snapshotId,
    lexicalRoot: pin.lexicalRoot,
    authorizationScopeDigest: pin.authorizationScopeDigest,
    policyHash: pin.policyHash,
    policyVersion: pin.policyVersion,
    searchReceiptUid: pin.searchReceiptUid,
    analyzerIdentity: pin.analyzerIdentity,
    queryDigest,
    sourceK,
    excludedDocumentUid,
  });
  return success({ query, binding, bindingDigest: digest(BINDING_DOMAIN, binding) });
}

function exactFrozenEcho(value, expected, fields) {
  const record = closedRecord(value, fields, true);
  if (record === null) return null;
  for (const field of fields) if (record[field] !== expected[field]) return null;
  return value;
}

function pageCapFailure(rawPage, requestedLimit) {
  const page = closedRecord(rawPage, PAGE_FIELDS, true);
  if (page === null) return { failure: failure('snapshot_corrupt') };
  const nextCursor = canonicalCursor(page.nextCursor);
  if (nextCursor.kind === 'limit') return { failure: failure('limit_exceeded', 'providerCursor') };
  if (nextCursor.kind !== 'ok') return { failure: failure('snapshot_corrupt') };
  if (Number.isSafeInteger(page.candidateCount) && page.candidateCount > MAX_PROVIDER_CANDIDATES) {
    return { failure: failure('limit_exceeded', 'providerPageCandidates') };
  }
  const candidates = denseArray(page.candidates, MAX_PROVIDER_CANDIDATES, true);
  if (candidates.kind === 'limit') return { failure: failure('limit_exceeded', 'providerPageCandidates') };
  if (candidates.kind !== 'ok') return { failure: failure('snapshot_corrupt') };

  const normalizedCandidates = [];
  for (const candidateValue of candidates.value) {
    const candidate = closedRecord(candidateValue, CANDIDATE_FIELDS, true);
    if (candidate === null) return { failure: failure('snapshot_corrupt') };
    if (typeof candidate.documentId === 'string'
        && candidate.documentId.length > MAX_DOCUMENT_ID_BYTES) {
      return { failure: failure('limit_exceeded', 'documentId') };
    }
    const documentBytes = byteLength(candidate.documentId);
    if (documentBytes > MAX_DOCUMENT_ID_BYTES) return { failure: failure('limit_exceeded', 'documentId') };
    if (documentBytes < 0 || canonicalUid(candidate.documentId, ['A']) === null
        || !Number.isSafeInteger(candidate.sourceRank)
        || !Number.isSafeInteger(candidate.sourceScoreMilli)
        || candidate.sourceScoreMilli < 0) return { failure: failure('snapshot_corrupt') };
    normalizedCandidates.push(deepFreeze({
      documentId: candidate.documentId,
      sourceRank: candidate.sourceRank,
      sourceScoreMilli: candidate.sourceScoreMilli,
    }));
  }

  const providerIdentity = closedRecord(page.providerIdentity, PROVIDER_IDENTITY_FIELDS, true);
  const receipt = closedRecord(page.receipt, PAGE_RECEIPT_FIELDS, true);
  if (providerIdentity === null || receipt === null) return { failure: failure('snapshot_corrupt') };
  const pageStrings = [
    page.schema, page.bindingDigest, page.excludedDocumentUid,
    page.providerCursorDigest, page.nextCursorDigest, page.pageDigest,
    ...PROVIDER_IDENTITY_FIELDS.map((field) => providerIdentity[field]),
    receipt.receiptUid, receipt.kind, receipt.bindingDigest,
    receipt.excludedDocumentUid, receipt.providerCursorDigest,
    receipt.nextCursorDigest, receipt.pageDigest,
  ].filter((value) => value !== null);
  let oversizedPageString = false;
  for (const value of pageStrings) {
    const status = boundedPageString(value);
    if (status.kind === 'invalid') return { failure: failure('snapshot_corrupt') };
    if (status.kind === 'limit') oversizedPageString = true;
  }
  if (oversizedPageString) return { failure: failure('limit_exceeded', 'providerPageBytes') };
  if (typeof receipt.exclusionApplied !== 'boolean'
      || !Number.isSafeInteger(receipt.requestedLimit)) return { failure: failure('snapshot_corrupt') };
  if (typeof page.schema !== 'string' || typeof page.bindingDigest !== 'string'
      || typeof page.exclusionApplied !== 'boolean'
      || (page.excludedDocumentUid !== null && typeof page.excludedDocumentUid !== 'string')
      || (page.providerCursorDigest !== null && (typeof page.providerCursorDigest !== 'string' || !HASH.test(page.providerCursorDigest)))
      || !Number.isSafeInteger(page.requestedLimit)
      || !Number.isSafeInteger(page.pageStartRank)
      || !Number.isSafeInteger(page.candidateCount)
      || typeof page.exhausted !== 'boolean'
      || (page.nextCursorDigest !== null && (typeof page.nextCursorDigest !== 'string' || !HASH.test(page.nextCursorDigest)))
      || typeof page.pageDigest !== 'string' || !HASH.test(page.pageDigest)) {
    return { failure: failure('snapshot_corrupt') };
  }
  if (page.candidateCount !== normalizedCandidates.length
      || (page.candidateCount <= MAX_PROVIDER_CANDIDATES && page.candidateCount > requestedLimit)) {
    return { failure: failure('snapshot_corrupt') };
  }
  const normalizedIdentity = deepFreeze({
    providerContractVersion: providerIdentity.providerContractVersion,
    providerImplementationDigest: providerIdentity.providerImplementationDigest,
    analyzerIdentity: providerIdentity.analyzerIdentity,
    scoreContractVersion: providerIdentity.scoreContractVersion,
  });
  const normalizedReceipt = deepFreeze({
    receiptUid: receipt.receiptUid,
    kind: receipt.kind,
    bindingDigest: receipt.bindingDigest,
    excludedDocumentUid: receipt.excludedDocumentUid,
    exclusionApplied: receipt.exclusionApplied,
    providerCursorDigest: receipt.providerCursorDigest,
    requestedLimit: receipt.requestedLimit,
    nextCursorDigest: receipt.nextCursorDigest,
    pageDigest: receipt.pageDigest,
  });
  const normalizedPage = deepFreeze({
    schema: page.schema,
    bindingDigest: page.bindingDigest,
    providerIdentity: normalizedIdentity,
    excludedDocumentUid: page.excludedDocumentUid,
    exclusionApplied: page.exclusionApplied,
    providerCursorDigest: page.providerCursorDigest,
    requestedLimit: page.requestedLimit,
    pageStartRank: page.pageStartRank,
    candidateCount: page.candidateCount,
    candidates: normalizedCandidates,
    nextCursor: nextCursor.value,
    nextCursorDigest: page.nextCursorDigest,
    exhausted: page.exhausted,
    pageDigest: page.pageDigest,
    receipt: normalizedReceipt,
  });
  const pageBytes = canonicalBytesLexicalV1(normalizedPage).length;
  if (pageBytes > MAX_PROVIDER_PAGE_BYTES) {
    return { failure: failure('limit_exceeded', 'providerPageBytes') };
  }
  return { page: normalizedPage, pageBytes };
}

function validatePageSemantics(page, state, request) {
  if (page.schema !== PROVIDER_PAGE_SCHEMA || page.bindingDigest !== request.bindingDigest) {
    return failure('snapshot_corrupt');
  }
  const identity = page.providerIdentity;
  if (identity.providerContractVersion !== PROVIDER_CONTRACT
      || identity.analyzerIdentity !== request.binding.analyzerIdentity
      || identity.scoreContractVersion !== SCORE_CONTRACT
      || typeof identity.providerImplementationDigest !== 'string'
      || !HASH.test(identity.providerImplementationDigest)) return failure('incompatible_contract');
  if (state.providerIdentity !== null) {
    for (const field of PROVIDER_IDENTITY_FIELDS) {
      if (identity[field] !== state.providerIdentity[field]) return failure('incompatible_contract');
    }
  }
  const exclusionApplied = request.binding.excludedDocumentUid !== null;
  if (page.excludedDocumentUid !== request.binding.excludedDocumentUid
      || page.exclusionApplied !== exclusionApplied
      || page.providerCursorDigest !== state.inboundCursorDigest
      || page.requestedLimit !== state.requestedLimit) return failure('snapshot_corrupt');
  const expectedNextDigest = cursorDigest(request.bindingDigest, page.nextCursor);
  if (page.nextCursorDigest !== expectedNextDigest
      || page.exhausted !== (page.nextCursor === null)
      || page.exhausted !== (page.nextCursorDigest === null)) return failure('snapshot_corrupt');
  if (page.nextCursor !== null
      && (state.seenCursors.has(page.nextCursor) || state.seenCursorDigests.has(page.nextCursorDigest))) {
    return failure('snapshot_corrupt');
  }
  if (page.pageStartRank !== state.rawCandidates.length + 1
      || page.pageStartRank < 1 || page.pageStartRank > MAX_PROVIDER_CANDIDATES + 1
      || (page.candidateCount === 0 && !page.exhausted)) return failure('snapshot_corrupt');

  let previous = state.rawCandidates.at(-1) ?? null;
  for (let index = 0; index < page.candidates.length; index += 1) {
    const candidate = page.candidates[index];
    if (candidate.sourceRank !== page.pageStartRank + index
        || candidate.sourceRank < 1 || candidate.sourceRank > MAX_PROVIDER_CANDIDATES
        || candidate.documentId === request.binding.excludedDocumentUid
        || state.seenDocuments.has(candidate.documentId)) return failure('snapshot_corrupt');
    if (previous !== null
        && (candidate.sourceScoreMilli > previous.sourceScoreMilli
          || (candidate.sourceScoreMilli === previous.sourceScoreMilli
            && unsignedUtf8Compare(previous.documentId, candidate.documentId) >= 0))) {
      return failure('snapshot_corrupt');
    }
    previous = candidate;
  }

  const pagePreimage = {
    schema: page.schema,
    bindingDigest: page.bindingDigest,
    providerIdentity: page.providerIdentity,
    excludedDocumentUid: page.excludedDocumentUid,
    exclusionApplied: page.exclusionApplied,
    providerCursorDigest: page.providerCursorDigest,
    requestedLimit: page.requestedLimit,
    pageStartRank: page.pageStartRank,
    candidateCount: page.candidateCount,
    candidates: page.candidates,
    nextCursorDigest: page.nextCursorDigest,
    exhausted: page.exhausted,
  };
  if (page.pageDigest !== digest(PAGE_DOMAIN, pagePreimage)) return failure('snapshot_corrupt');
  const receipt = page.receipt;
  if (canonicalUid(receipt.receiptUid, ['D']) === null || receipt.kind !== 'lexical_page'
      || receipt.bindingDigest !== request.bindingDigest
      || receipt.excludedDocumentUid !== page.excludedDocumentUid
      || receipt.exclusionApplied !== page.exclusionApplied
      || receipt.providerCursorDigest !== page.providerCursorDigest
      || receipt.requestedLimit !== page.requestedLimit
      || receipt.nextCursorDigest !== page.nextCursorDigest
      || receipt.pageDigest !== page.pageDigest
      || state.seenReceipts.has(receipt.receiptUid)) return failure('snapshot_corrupt');
  return success(page);
}

function completeSource(config, normalized) {
  const { binding, bindingDigest, query } = normalized;
  let receipt;
  try { receipt = config.verifySearchReceipt(binding); } catch (_error) { return failure('unauthorized'); }
  receipt = exactFrozenEcho(receipt, binding, BINDING_FIELDS);
  if (receipt === null) return failure('unauthorized');

  const state = {
    providerIdentity: null,
    rawCandidates: [],
    pageEvidence: [],
    seenDocuments: new Set(),
    seenReceipts: new Set(),
    seenCursors: new Set(),
    seenCursorDigests: new Set(),
    providerCursor: null,
    inboundCursorDigest: null,
    requestedLimit: 0,
    aggregateBytes: 0,
  };

  while (state.rawCandidates.length < binding.sourceK) {
    if (state.pageEvidence.length >= MAX_PROVIDER_PAGES) {
      return failure('limit_exceeded', 'providerPages');
    }
    state.requestedLimit = Math.min(MAX_PROVIDER_CANDIDATES, binding.sourceK - state.rawCandidates.length);
    const pageRequest = deepFreeze({
      receipt,
      bindingDigest,
      query,
      queryDigest: binding.queryDigest,
      excludedDocumentUid: binding.excludedDocumentUid,
      requestedLimit: state.requestedLimit,
      providerCursor: state.providerCursor,
    });
    let rawPage;
    try { rawPage = config.readLexicalProviderPage(pageRequest); } catch (_error) {
      return failure('provider_unavailable');
    }
    const capped = pageCapFailure(rawPage, state.requestedLimit);
    if (capped.failure !== undefined) return capped.failure;
    if (state.rawCandidates.length + capped.page.candidateCount > MAX_PROVIDER_CANDIDATES) {
      return failure('limit_exceeded', 'providerCandidates');
    }
    if (state.aggregateBytes + capped.pageBytes > MAX_AGGREGATE_EVIDENCE_BYTES) {
      return failure('limit_exceeded', 'aggregateRawEvidenceBytes');
    }
    const validated = validatePageSemantics(capped.page, state, normalized);
    if (!validated.ok) return validated;
    const page = validated.value;
    if (state.providerIdentity === null) state.providerIdentity = page.providerIdentity;
    state.aggregateBytes += capped.pageBytes;
    for (const candidate of page.candidates) {
      state.seenDocuments.add(candidate.documentId);
      state.rawCandidates.push(candidate);
    }
    state.seenReceipts.add(page.receipt.receiptUid);
    if (page.nextCursor !== null) {
      state.seenCursors.add(page.nextCursor);
      state.seenCursorDigests.add(page.nextCursorDigest);
    }
    state.pageEvidence.push(deepFreeze({
      receiptUid: page.receipt.receiptUid,
      pageDigest: page.pageDigest,
      excludedDocumentUid: page.excludedDocumentUid,
      exclusionApplied: page.exclusionApplied,
      providerCursorDigest: page.providerCursorDigest,
      requestedLimit: page.requestedLimit,
      nextCursorDigest: page.nextCursorDigest,
      pageStartRank: page.pageStartRank,
      candidateCount: page.candidateCount,
      exhausted: page.exhausted,
    }));
    if (page.exhausted) break;
    state.providerCursor = page.nextCursor;
    state.inboundCursorDigest = page.nextCursorDigest;
  }

  let authorizedCandidates = 0;
  let authorizationFailed = false;
  for (const candidate of state.rawCandidates) {
    let decision;
    try {
      decision = config.authorizeArtifactCandidate(Object.freeze({
        receipt,
        documentId: candidate.documentId,
        sourceRank: candidate.sourceRank,
      }));
    } catch (_error) { authorizationFailed = true; continue; }
    const authorization = closedRecord(decision, AUTHORIZATION_FIELDS, true);
    if (authorization === null
        || authorization.documentId !== candidate.documentId
        || authorization.sourceRank !== candidate.sourceRank
        || authorization.authorizationScopeDigest !== binding.authorizationScopeDigest
        || authorization.policyHash !== binding.policyHash
        || authorization.policyVersion !== binding.policyVersion
        || authorization.searchReceiptUid !== binding.searchReceiptUid
        || authorization.decision !== 'allowed') authorizationFailed = true;
    else authorizedCandidates += 1;
  }
  if (authorizationFailed) return failure('snapshot_unavailable');

  const outputDocumentIds = deepFreeze(state.rawCandidates.map((candidate) => candidate.documentId));
  const exclusionApplied = binding.excludedDocumentUid !== null;
  const pageSetDigest = digest(PAGE_SET_DOMAIN, {
    bindingDigest,
    providerIdentity: state.providerIdentity,
    pages: state.pageEvidence,
  });
  const rankEvidenceDigest = digest(RANK_EVIDENCE_DOMAIN, {
    bindingDigest,
    rawCandidates: state.rawCandidates,
    excludedDocumentUid: binding.excludedDocumentUid,
    outputDocumentIds,
  });
  const evidenceRequest = deepFreeze({
    binding,
    bindingDigest,
    providerIdentity: state.providerIdentity,
    pageSetDigest,
    rankEvidenceDigest,
    excludedDocumentUid: binding.excludedDocumentUid,
    exclusionApplied,
    pageReceipts: state.pageEvidence,
    outputDocumentIds,
  });
  let evidenceDecision;
  try { evidenceDecision = config.verifyLexicalEvidence(evidenceRequest); } catch (_error) {
    return failure('evidence_unverified');
  }
  const evidence = closedRecord(evidenceDecision, EVIDENCE_RESULT_FIELDS, true);
  if (evidence === null || evidence.bindingDigest !== bindingDigest
      || evidence.pageSetDigest !== pageSetDigest
      || evidence.rankEvidenceDigest !== rankEvidenceDigest
      || evidence.excludedDocumentUid !== binding.excludedDocumentUid
      || evidence.exclusionApplied !== exclusionApplied
      || canonicalUid(evidence.authorityReceiptUid, ['D']) === null
      || evidence.decision !== 'verified') return failure('evidence_unverified');

  const sourceIdentity = digest(SOURCE_IDENTITY_DOMAIN, {
    contractVersion: LEXICAL_SOURCE_CONTRACT_V1,
    bindingDigest,
    providerIdentity: state.providerIdentity,
    queryDigest: binding.queryDigest,
    sourceK: binding.sourceK,
    excludedDocumentUid: binding.excludedDocumentUid,
    rankEvidenceDigest,
    documentIds: outputDocumentIds,
  });
  const candidateDigest = digest(RRF_SOURCE_POOL_DOMAIN, {
    name: 'lexical', sourceIdentity, documentIds: outputDocumentIds,
  });
  const source = deepFreeze({
    name: 'lexical',
    sourceIdentity,
    complete: true,
    candidateCount: outputDocumentIds.length,
    candidateDigest,
    candidates: outputDocumentIds.map((documentId) => deepFreeze({ documentId })),
  });
  return success({
    status: 'complete',
    contractVersion: LEXICAL_SOURCE_CONTRACT_V1,
    source,
    evidenceIdentity: {
      lexicalSourceContractVersion: LEXICAL_SOURCE_CONTRACT_V1,
      workspaceUid: binding.workspaceUid,
      projectUid: binding.projectUid,
      worktreeUid: binding.worktreeUid,
      revisionId: binding.revisionId,
      snapshotId: binding.snapshotId,
      lexicalRoot: binding.lexicalRoot,
      authorizationScopeDigest: binding.authorizationScopeDigest,
      policyHash: binding.policyHash,
      policyVersion: binding.policyVersion,
      searchReceiptUid: binding.searchReceiptUid,
      analyzerIdentity: binding.analyzerIdentity,
      scoreContractVersion: SCORE_CONTRACT,
      providerContractVersion: state.providerIdentity.providerContractVersion,
      providerImplementationDigest: state.providerIdentity.providerImplementationDigest,
      queryDigest: binding.queryDigest,
      bindingDigest,
      sourceK: binding.sourceK,
      excludedDocumentUid: binding.excludedDocumentUid,
      exclusionApplied,
      providerPageCount: state.pageEvidence.length,
      providerCandidateCount: state.rawCandidates.length,
      authorityReceiptUid: evidence.authorityReceiptUid,
      pageSetDigest,
      rankEvidenceDigest,
      sourceIdentity,
      candidateDigest,
    },
    counters: {
      providerPages: state.pageEvidence.length,
      providerCandidates: state.rawCandidates.length,
      authorizedCandidates,
      returnedCandidates: outputDocumentIds.length,
    },
  });
}

export function createAuthorizedLexicalSourceV1(input) {
  const config = closedRecord(input, CONFIG_FIELDS);
  if (config === null || CONFIG_FIELDS.some((field) => typeof config[field] !== 'function')) {
    throw new TypeError('invalid lexical-source capability configuration');
  }
  const captured = Object.freeze({
    verifySearchReceipt: config.verifySearchReceipt,
    readLexicalProviderPage: config.readLexicalProviderPage,
    authorizeArtifactCandidate: config.authorizeArtifactCandidate,
    verifyLexicalEvidence: config.verifyLexicalEvidence,
  });
  function readLexicalSourceV1(request) {
    try {
      const normalized = normalizeRequest(request);
      if (!normalized.ok) return normalized;
      return completeSource(captured, normalized.value);
    } catch (_error) { return failure('internal_error'); }
  }
  return Object.freeze({ readLexicalSourceV1 });
}
