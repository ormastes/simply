import { createHash } from 'node:crypto';

import { deriveAliasProjectionUid } from '../model/graph_node.js';
import {
  assertCanonicalUid,
  canonicalBytes,
  normalizeRevision,
  normalizeSemanticKey,
} from '../model/identity.js';

export const EXACT_IDENTITY_CONTRACT_V1 = 'spipe-exact-identity-v1';
export const MAX_EXACT_QUERY_BYTES_V1 = 4096;
export const MAX_IDENTITY_BINDING_BYTES_V1 = 512;
export const MAX_IDENTITY_ROWS_V1 = 100_000;

const REQUEST_FIELDS = Object.freeze([
  'contractVersion', 'operation', 'query', 'workspaceUid', 'projectUid',
  'worktreeUid', 'revisionId', 'identitySnapshotId', 'identityRoot',
  'authorizationScopeDigest', 'policyHash', 'policyVersion', 'searchReceiptUid',
]);
const BINDING_FIELDS = Object.freeze(REQUEST_FIELDS.filter((field) => field !== 'query'));
const SNAPSHOT_FIELDS = Object.freeze([
  'schema', 'workspaceUid', 'projectUid', 'worktreeUid', 'revisionId',
  'identitySnapshotId', 'identityRoot', 'authorizationScopeDigest', 'policyHash',
  'policyVersion', 'searchReceiptUid', 'registryGeneration',
  'authorizedIdentityDigest', 'uidRows', 'keyRows', 'aliasRows',
]);
const UID_ROW_FIELDS = Object.freeze(['value', 'targetUid']);
const ALIAS_ROW_FIELDS = Object.freeze(['aliasUid', 'value', 'targetUid', 'status']);
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SNAPSHOT_ID = /^spks1-[0-9a-f]{64}$/;
const UINT32_MAX = 0xffff_ffff;

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

function dataRecord(value, fields) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
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

function denseArray(value, maximumLength) {
  if (value === null || typeof value !== 'object') return null;
  try {
    if (!Array.isArray(value)) return null;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (lengthDescriptor === undefined || !Object.hasOwn(lengthDescriptor, 'value')
        || Object.hasOwn(lengthDescriptor, 'get') || Object.hasOwn(lengthDescriptor, 'set')
        || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) return null;
    if (lengthDescriptor.value > maximumLength) return 'limit_exceeded';
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    const length = lengthDescriptor.value;
    if (descriptors.length?.value !== length || keys.length !== length + 1) return null;
    const result = new Array(length);
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')
          || Object.hasOwn(descriptor, 'get') || Object.hasOwn(descriptor, 'set')
          || descriptor.enumerable !== true) return null;
      result[index] = descriptor.value;
    }
    return Object.freeze(result);
  } catch (_error) { return null; }
}

function utf8Length(value) {
  if (typeof value !== 'string') return -1;
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

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function canonicalUid(value, prefixes) {
  try { return assertCanonicalUid(value, 'uid', prefixes); } catch (_error) { return null; }
}

function validBindingText(value) {
  const bytes = utf8Length(value);
  return bytes > 0 && bytes <= MAX_IDENTITY_BINDING_BYTES_V1;
}

function normalizeRequest(input) {
  const request = dataRecord(input, REQUEST_FIELDS);
  if (request === null) return failure('invalid_request');
  if (request.contractVersion !== EXACT_IDENTITY_CONTRACT_V1) return failure('invalid_request', 'contractVersion');
  if (request.operation !== 'resolve' && request.operation !== 'search') return failure('invalid_request', 'operation');
  if (typeof request.query !== 'string' || request.query.includes('\0') || utf8Length(request.query) < 0) return failure('invalid_request', 'query');
  if (request.query.length > MAX_EXACT_QUERY_BYTES_V1 || utf8Length(request.query) > MAX_EXACT_QUERY_BYTES_V1) return failure('limit_exceeded', 'query');
  const query = request.query.normalize('NFC').trim();
  if (query.length === 0) return failure('invalid_request', 'query');
  if (query.length > MAX_EXACT_QUERY_BYTES_V1 || utf8Length(query) > MAX_EXACT_QUERY_BYTES_V1) return failure('limit_exceeded', 'query');

  const stringFields = BINDING_FIELDS.filter((field) => !['policyVersion'].includes(field));
  for (const field of stringFields) {
    if (!validBindingText(request[field])) return utf8Length(request[field]) > MAX_IDENTITY_BINDING_BYTES_V1
      ? failure('limit_exceeded', field) : failure('invalid_request', field);
  }
  if (!canonicalUid(request.workspaceUid, ['WS'])) return failure('invalid_request', 'workspaceUid');
  if (!canonicalUid(request.projectUid, ['P'])) return failure('invalid_request', 'projectUid');
  if (!canonicalUid(request.worktreeUid, ['W', 'WT'])) return failure('invalid_request', 'worktreeUid');
  try {
    if (normalizeRevision(request.revisionId, 'revisionId') !== request.revisionId) return failure('invalid_request', 'revisionId');
  } catch (_error) { return failure('invalid_request', 'revisionId'); }
  if (!SNAPSHOT_ID.test(request.identitySnapshotId)) return failure('invalid_request', 'identitySnapshotId');
  for (const field of ['identityRoot', 'authorizationScopeDigest', 'policyHash']) {
    if (!DIGEST.test(request[field])) return failure('invalid_request', field);
  }
  if (!Number.isSafeInteger(request.policyVersion) || request.policyVersion < 0 || request.policyVersion > UINT32_MAX) return failure('invalid_request', 'policyVersion');
  if (!canonicalUid(request.searchReceiptUid, ['D'])) return failure('invalid_request', 'searchReceiptUid');
  const normalized = { ...request, query, rawQuery: request.query };
  const binding = {};
  for (const field of BINDING_FIELDS) binding[field] = normalized[field];
  return success(deepFreeze({ request: normalized, binding }));
}

function exactFrozenReceipt(value, expected) {
  try {
    if (value === null || typeof value !== 'object' || !Object.isFrozen(value)) return null;
    const receipt = dataRecord(value, BINDING_FIELDS);
    if (receipt === null) return null;
    for (const field of BINDING_FIELDS) if (receipt[field] !== expected[field]) return null;
    return value;
  } catch (_error) { return null; }
}

function rowArray(value, fields, normalize, capState) {
  const values = denseArray(value, MAX_IDENTITY_ROWS_V1 - capState.total);
  if (values === 'limit_exceeded') return { error: 'limit_exceeded' };
  if (values === null) return { error: 'snapshot_corrupt' };
  capState.total += values.length;
  const rows = [];
  let previous = null;
  for (const valueRow of values) {
    const row = dataRecord(valueRow, fields);
    if (row === null) return { error: 'snapshot_corrupt' };
    const normalized = normalize(row);
    if (normalized === null) return { error: 'snapshot_corrupt' };
    if (previous !== null && compareTuple(previous, normalized.sortValues) >= 0) return { error: 'snapshot_corrupt' };
    previous = normalized.sortValues;
    rows.push(normalized.row);
  }
  return { rows: Object.freeze(rows) };
}

function compareTuple(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    const order = compareUtf8(left[index], right[index]);
    if (order !== 0) return order;
  }
  return 0;
}

function validateSnapshot(input, binding) {
  const snapshot = dataRecord(input, SNAPSHOT_FIELDS);
  if (snapshot === null) return failure('snapshot_corrupt');
  if (snapshot.schema !== 'spipe-authorized-identity-lookup-v1') return failure('snapshot_corrupt', 'schema');
  for (const field of BINDING_FIELDS.filter((field) => field !== 'contractVersion' && field !== 'operation')) {
    if (snapshot[field] !== binding[field]) return failure('snapshot_corrupt', field);
  }
  if (!Number.isSafeInteger(snapshot.registryGeneration) || snapshot.registryGeneration < 0 || snapshot.registryGeneration > UINT32_MAX) return failure('snapshot_corrupt', 'registryGeneration');
  if (typeof snapshot.authorizedIdentityDigest !== 'string'
      || !DIGEST.test(snapshot.authorizedIdentityDigest)) return failure('snapshot_corrupt');
  const capState = { total: 0 };
  const uidRows = rowArray(snapshot.uidRows, UID_ROW_FIELDS, (source) => {
    if (!canonicalUid(source.value, ['A']) || source.targetUid !== source.value) return null;
    return { sortValues: [source.value, source.targetUid], row: deepFreeze({ value: source.value, targetUid: source.targetUid }) };
  }, capState);
  if (uidRows.error) return failure(uidRows.error);
  const keyRows = rowArray(snapshot.keyRows, UID_ROW_FIELDS, (source) => {
    if (!canonicalUid(source.targetUid, ['A']) || utf8Length(source.value) < 0 || utf8Length(source.value) > MAX_EXACT_QUERY_BYTES_V1) return null;
    let value;
    try { value = normalizeSemanticKey(source.value); } catch (_error) { return null; }
    if (value !== source.value) return null;
    return { sortValues: [value, source.targetUid], row: deepFreeze({ value, targetUid: source.targetUid }) };
  }, capState);
  if (keyRows.error) return failure(keyRows.error);
  const aliasRows = rowArray(snapshot.aliasRows, ALIAS_ROW_FIELDS, (source) => {
    if (!canonicalUid(source.targetUid, ['A']) || source.status !== 'active' || typeof source.value !== 'string') return null;
    const bytes = utf8Length(source.value);
    if (bytes < 0 || bytes > MAX_EXACT_QUERY_BYTES_V1 || source.value.includes('\0')) return null;
    const value = source.value.normalize('NFC').trim();
    if (value.length === 0 || value !== source.value) return null;
    let aliasUid;
    try { aliasUid = deriveAliasProjectionUid({ workspace_uid: binding.workspaceUid, project_uid: binding.projectUid, kind: 'artifact_key', alias: value, canonical_target_uid: source.targetUid }); } catch (_error) { return null; }
    if (source.aliasUid !== aliasUid) return null;
    return { sortValues: [value, source.targetUid, aliasUid], row: deepFreeze({ aliasUid, value, targetUid: source.targetUid, status: 'active' }) };
  }, capState);
  if (aliasRows.error) return failure(aliasRows.error);
  const preimage = {
    schema: snapshot.schema,
    workspaceUid: snapshot.workspaceUid,
    projectUid: snapshot.projectUid,
    worktreeUid: snapshot.worktreeUid,
    revisionId: snapshot.revisionId,
    identitySnapshotId: snapshot.identitySnapshotId,
    identityRoot: snapshot.identityRoot,
    authorizationScopeDigest: snapshot.authorizationScopeDigest,
    policyHash: snapshot.policyHash,
    policyVersion: snapshot.policyVersion,
    searchReceiptUid: snapshot.searchReceiptUid,
    registryGeneration: snapshot.registryGeneration,
    uidRows: uidRows.rows,
    keyRows: keyRows.rows,
    aliasRows: aliasRows.rows,
  };
  const digest = `sha256:${createHash('sha256').update(canonicalBytes(preimage)).digest('hex')}`;
  if (digest !== snapshot.authorizedIdentityDigest) return failure('snapshot_corrupt');
  return success(deepFreeze({ ...preimage, authorizedIdentityDigest: digest }));
}

function explanation(snapshot, resolvedUid, matchedBy, matchedValue, aliasUid = null) {
  return deepFreeze({
    contractVersion: EXACT_IDENTITY_CONTRACT_V1,
    resolvedUid,
    matchedBy,
    matchedValue,
    aliasUid,
    aliasStatus: aliasUid === null ? null : 'active',
    registryGeneration: snapshot.registryGeneration,
    identitySnapshotId: snapshot.identitySnapshotId,
    identityRoot: snapshot.identityRoot,
    authorizationScopeDigest: snapshot.authorizationScopeDigest,
    searchReceiptUid: snapshot.searchReceiptUid,
    visibilityDecision: 'allowed',
    pinnedRank: 1,
  });
}

function resolveSnapshot(rawQuery, query, snapshot) {
  if (canonicalUid(rawQuery, ['A'])) {
    const row = snapshot.uidRows.find((candidate) => candidate.value === rawQuery);
    if (row === undefined) return success({ status: 'not_found', contractVersion: EXACT_IDENTITY_CONTRACT_V1 });
    return success({ status: 'resolved', resolvedUid: row.targetUid, explanation: explanation(snapshot, row.targetUid, 'uid', rawQuery) });
  }
  // A normalized UID spelling is still UID-shaped, but it was not byte-exact.
  // It must never fall through and acquire meaning as a key or alias.
  if (canonicalUid(query, ['A'])) return success({ status: 'not_found', contractVersion: EXACT_IDENTITY_CONTRACT_V1 });
  let semanticKey = null;
  try { semanticKey = normalizeSemanticKey(query); } catch (_error) { /* Alias lookup remains valid. */ }
  const keyMatches = semanticKey === null ? [] : snapshot.keyRows.filter((row) => row.value === semanticKey);
  const aliasMatches = snapshot.aliasRows.filter((row) => row.value === query);
  const candidates = [...new Set([...keyMatches, ...aliasMatches].map((row) => row.targetUid))].sort(compareUtf8);
  if (candidates.length === 0) return success({ status: 'not_found', contractVersion: EXACT_IDENTITY_CONTRACT_V1 });
  if (candidates.length > 1) return success({ status: 'ambiguous', contractVersion: EXACT_IDENTITY_CONTRACT_V1, code: 'ambiguous_identity', candidateUids: candidates });
  const resolvedUid = candidates[0];
  if (keyMatches.some((row) => row.targetUid === resolvedUid)) {
    return success({ status: 'resolved', resolvedUid, explanation: explanation(snapshot, resolvedUid, 'key', semanticKey) });
  }
  const alias = aliasMatches.filter((row) => row.targetUid === resolvedUid).sort((left, right) => compareUtf8(left.aliasUid, right.aliasUid))[0];
  return success({ status: 'resolved', resolvedUid, explanation: explanation(snapshot, resolvedUid, 'alias', query, alias.aliasUid) });
}

export function createExactIdentityResolverV1(input) {
  const ports = dataRecord(input, ['verifySearchReceipt', 'readIdentitySnapshot']);
  if (ports === null || typeof ports.verifySearchReceipt !== 'function' || typeof ports.readIdentitySnapshot !== 'function') throw new TypeError('exact identity resolver requires verifySearchReceipt and readIdentitySnapshot ports');
  const verifySearchReceipt = ports.verifySearchReceipt;
  const readIdentitySnapshot = ports.readIdentitySnapshot;
  return deepFreeze({
    resolveExactV1(request) {
      const normalized = normalizeRequest(request);
      if (!normalized.ok) return normalized;
      const binding = deepFreeze({ ...normalized.value.binding });
      let candidateReceipt;
      try { candidateReceipt = verifySearchReceipt(binding); } catch (_error) { return failure('unauthorized'); }
      const receipt = exactFrozenReceipt(candidateReceipt, binding);
      if (receipt === null) return failure('unauthorized');
      let candidateSnapshot;
      try { candidateSnapshot = readIdentitySnapshot(receipt); } catch (_error) { return failure('snapshot_unavailable'); }
      const snapshot = validateSnapshot(candidateSnapshot, binding);
      if (!snapshot.ok) return snapshot;
      return resolveSnapshot(normalized.value.request.rawQuery, normalized.value.request.query, snapshot.value);
    },
  });
}
