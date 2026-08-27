import { createHash } from 'node:crypto';

import { createEdgeRecord } from '../model/edge.js';
import { createGraphNode } from '../model/graph_node.js';
import { canonicalJson } from '../storage/canonical.js';
import { unsignedUtf8CompareV1 } from './fusion.js';

export const GRAPH_CANDIDATE_CONTRACT_V1 = 'spipe-accepted-graph-candidates-v1';
export const GRAPH_CANDIDATE_MAX_DEPTH_V1 = 3;
export const GRAPH_CANDIDATE_MAX_SOURCE_K_V1 = 1000;
export const GRAPH_CANDIDATE_MAX_PAGE_WORK_V1 = 50_000;
export const GRAPH_CANDIDATE_MAX_TOTAL_WORK_V1 = 500_000;
export const GRAPH_CANDIDATE_MAX_NODES_V1 = 20_000;
export const GRAPH_CANDIDATE_MAX_EDGES_V1 = 50_000;
export const GRAPH_CANDIDATE_MAX_ROOTS_V1 = 1001;

const REQUEST_FIELDS = [
  'contractVersion', 'operation', 'context', 'pin', 'pinnedArtifactUid',
  'lexicalSeeds', 'sourceK', 'maxWorkUnits', 'maxTotalWorkUnits', 'cursor',
];
const CONTEXT_FIELDS = [
  'workspaceId', 'snapshotId', 'authorizationScopeDigest', 'queryReceipt',
  'analyzerIdentity',
];
const PIN_FIELDS = [
  'workspaceUid', 'projectUid', 'worktreeUid', 'revisionId', 'graphSnapshotId',
  'graphRoot', 'authorizationScopeDigest', 'policyHash', 'policyVersion',
  'searchReceiptUid',
];
const SEED_FIELDS = ['documentId', 'sourceRank'];
const SNAPSHOT_FIELDS = [
  'schema', 'workspaceUid', 'projectUid', 'worktreeUid', 'revisionId',
  'graphSnapshotId', 'graphRoot', 'authorizationScopeDigest', 'policyHash',
  'policyVersion', 'searchReceiptUid', 'authorizedNodeCount',
  'authorizedEdgeCount', 'authorizedGraphDigest', 'nodes', 'edges',
];
const NODE_FIELDS = [
  'uid', 'node_kind', 'project_uid', 'revision_id', 'record_type', 'record_hash',
  'visibility', 'trust_scope', 'status',
];
const EDGE_V2_FIELDS = [
  'schema_version', 'type', 'uid', 'edge_type', 'from_uid', 'to_uid', 'origin',
  'status', 'confidence_milli', 'created_by', 'created_at_revision',
  'evidence_uids', 'generator', 'provenance', 'authority',
];
const PROVENANCE_FIELDS = [
  'project_uid', 'worktree_uid', 'revision_id', 'input_snapshot_uid',
  'source_uid', 'source_location', 'decision_uid',
];
const AUTHORITY_FIELDS = ['kind', 'receipt_uid', 'policy_hash', 'policy_version'];
const GENERATOR_FIELDS = ['generator_id', 'version', 'rule', 'input_snapshot_uid'];
const LOCATION_FIELDS = ['source_artifact_uid', 'source_hash', 'span'];
const SPAN_FIELDS = ['start_byte', 'end_byte'];
const AUTH_REQUEST_FIELDS = ['pin', 'nodeUid', 'nodeKind'];
const AUTH_RESPONSE_FIELDS = [
  'pin', 'nodeUid', 'nodeKind', 'decision', 'authorizationScopeDigest',
  'policyHash', 'policyVersion', 'searchReceiptUid',
];
const VERIFY_REQUEST_FIELDS = [
  'pin', 'edgeUid', 'edgeType', 'fromUid', 'toUid', 'origin', 'receiptUid',
  'authorityKind', 'policyHash', 'policyVersion',
];
const VERIFY_RESPONSE_FIELDS = [...VERIFY_REQUEST_FIELDS, 'decision'];
const SOURCE_POOL_DOMAIN = 'spipe-rrf-source-pool-v1\0';
const SNAPSHOT_DOMAIN = 'spipe-authorized-graph-search-v1\0';
const EDGE_SET_DOMAIN = 'spipe-accepted-edge-set-v1\0';
const EVIDENCE_DOMAIN = 'spipe-graph-candidate-evidence-v1\0';
const SOURCE_IDENTITY_DOMAIN = 'spipe-graph-source-identity-v1\0';
const UID_PAYLOAD = '(?:[0-9A-F]{32}|[0-9A-HJKMNP-TV-Z]{26})';
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SNAPSHOT_PATTERN = /^spks1-[0-9a-f]{64}$/;
const REVISION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+\-/]{0,255}$/;

function resultOk(value) {
  return Object.freeze({ ok: true, value });
}

function resultError(code, field = null) {
  const error = field === null ? { code } : { code, field };
  return Object.freeze({ ok: false, error: Object.freeze(error) });
}

function ownDataRecord(value, fields) {
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
  } catch (_error) {
    return null;
  }
}

function ownDenseArray(value, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Array.isArray(value)) return null;
  try {
    const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, 'length');
    if (lengthDescriptor === undefined || !Object.hasOwn(lengthDescriptor, 'value')
        || Object.hasOwn(lengthDescriptor, 'get') || Object.hasOwn(lengthDescriptor, 'set')
        || lengthDescriptor.enumerable !== false) return null;
    const length = lengthDescriptor.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > maximum) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== length + 1) return null;
    const result = new Array(length);
    for (let index = 0; index < length; index += 1) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
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
  } catch (_error) {
    return false;
  }
}

function freezeDeep(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) freezeDeep(child, seen);
  return Object.freeze(value);
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
  return bytes > 0 && bytes <= 512;
}

function validUid(value, prefix = null) {
  if (!validText(value)) return false;
  const expression = prefix === null
    ? new RegExp(`^[A-Z][A-Z0-9]*-${UID_PAYLOAD}$`)
    : new RegExp(`^${prefix}-${UID_PAYLOAD}$`);
  return expression.test(value);
}

function sameRecord(left, right) {
  try { return canonicalJson(left) === canonicalJson(right); } catch (_error) { return false; }
}

function digest(domain, value) {
  return `sha256:${createHash('sha256').update(domain, 'utf8').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function compareArray(left, right, compareItem) {
  const count = Math.min(left.length, right.length);
  for (let index = 0; index < count; index += 1) {
    const compared = compareItem(left[index], right[index]);
    if (compared !== 0) return compared;
  }
  return left.length - right.length;
}

function compareNumber(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
function compareDirection(left, right) { return left === right ? 0 : left === 'out' ? -1 : 1; }

function pathTupleCompare(left, right) {
  for (const compared of [
    compareNumber(left.distance, right.distance),
    compareNumber(left.seedTier, right.seedTier),
    compareNumber(left.seedRank, right.seedRank),
    compareNumber(left.generatedEdgeCount, right.generatedEdgeCount),
    compareNumber(-left.bottleneckConfidenceMilli, -right.bottleneckConfidenceMilli),
    compareArray(left.edgeUidSequence, right.edgeUidSequence, unsignedUtf8CompareV1),
    compareArray(left.directionSequence, right.directionSequence, compareDirection),
    compareArray(left.nodeUidSequence, right.nodeUidSequence, unsignedUtf8CompareV1),
  ]) if (compared !== 0) return compared;
  return 0;
}

function normalizeContext(value) {
  const context = ownDataRecord(value, CONTEXT_FIELDS);
  if (context === null || CONTEXT_FIELDS.some((field) => !validText(context[field]))) return null;
  return Object.freeze({ ...context });
}

function normalizePin(value) {
  const pin = ownDataRecord(value, PIN_FIELDS);
  if (pin === null || !validUid(pin.workspaceUid, 'WS') || !validUid(pin.projectUid, 'P')
      || !validUid(pin.worktreeUid, 'WT') || typeof pin.revisionId !== 'string'
      || !REVISION_PATTERN.test(pin.revisionId) || typeof pin.graphSnapshotId !== 'string'
      || !SNAPSHOT_PATTERN.test(pin.graphSnapshotId) || typeof pin.graphRoot !== 'string'
      || !HASH_PATTERN.test(pin.graphRoot) || typeof pin.authorizationScopeDigest !== 'string'
      || !HASH_PATTERN.test(pin.authorizationScopeDigest) || typeof pin.policyHash !== 'string'
      || !HASH_PATTERN.test(pin.policyHash) || !Number.isSafeInteger(pin.policyVersion)
      || pin.policyVersion < 0 || pin.policyVersion > 0xffff_ffff
      || !validUid(pin.searchReceiptUid, 'D')) return null;
  return freezeDeep({ ...pin });
}

function normalizedRequestRecord(request) {
  if (request.contractVersion !== GRAPH_CANDIDATE_CONTRACT_V1
      || request.operation !== 'graph_candidates') return { error: resultError('invalid_request') };
  const context = normalizeContext(request.context);
  const pin = normalizePin(request.pin);
  if (context === null || pin === null || context.snapshotId !== pin.graphSnapshotId
      || context.workspaceId !== pin.workspaceUid
      || context.authorizationScopeDigest !== pin.authorizationScopeDigest
      || context.queryReceipt !== pin.searchReceiptUid
      || !(request.pinnedArtifactUid === null || validUid(request.pinnedArtifactUid, 'A'))) {
    return { error: resultError('invalid_request') };
  }
  const seeds = ownDenseArray(request.lexicalSeeds, 1000);
  if (seeds === null) return { error: resultError('invalid_request') };
  const lexicalSeeds = [];
  const seen = new Set();
  for (let index = 0; index < seeds.length; index += 1) {
    const seed = ownDataRecord(seeds[index], SEED_FIELDS);
    if (seed === null || !validUid(seed.documentId, 'A') || seed.sourceRank !== index + 1
        || seen.has(seed.documentId)) return { error: resultError('invalid_request') };
    seen.add(seed.documentId);
    lexicalSeeds.push(Object.freeze({ documentId: seed.documentId, sourceRank: seed.sourceRank }));
  }
  for (const [field, value, minimum, maximum, defaultValue] of [
    ['sourceK', request.sourceK, 1, 1000, 1000],
    ['maxWorkUnits', request.maxWorkUnits, 1, 50_000, 50_000],
    ['maxTotalWorkUnits', request.maxTotalWorkUnits, 1, 500_000, 500_000],
  ]) {
    if (value !== undefined && !Number.isSafeInteger(value)) return { error: resultError('invalid_request') };
    const effective = value === undefined ? defaultValue : value;
    if (effective < minimum || effective > maximum) return { error: resultError('limit_exceeded', field) };
  }
  const sourceK = request.sourceK ?? 1000;
  const maxWorkUnits = request.maxWorkUnits ?? 50_000;
  const maxTotalWorkUnits = request.maxTotalWorkUnits ?? 500_000;
  const roots = (request.pinnedArtifactUid === null ? 0 : 1) + lexicalSeeds.length;
  if (roots > GRAPH_CANDIDATE_MAX_ROOTS_V1) return { error: resultError('limit_exceeded', 'roots') };
  return { value: Object.freeze({
    contractVersion: request.contractVersion,
    operation: request.operation,
    context,
    pin,
    pinnedArtifactUid: request.pinnedArtifactUid,
    lexicalSeeds: Object.freeze(lexicalSeeds),
    sourceK,
    maxWorkUnits,
    maxTotalWorkUnits,
    cursor: request.cursor,
  }) };
}

function normalizedRequest(value) {
  const request = ownDataRecord(value, REQUEST_FIELDS);
  if (request === null) return { error: resultError('invalid_request') };
  return normalizedRequestRecord(request);
}

function bindingOf(request) {
  return freezeDeep({
    contractVersion: request.contractVersion,
    operation: request.operation,
    context: request.context,
    pin: request.pin,
    pinnedArtifactUid: request.pinnedArtifactUid,
    lexicalSeeds: request.lexicalSeeds,
    sourceK: request.sourceK,
    maxTotalWorkUnits: request.maxTotalWorkUnits,
  });
}

function normalizeSnapshot(raw, request) {
  try { if (!Object.isFrozen(raw)) return { error: 'snapshot_unavailable' }; }
  catch (_error) { return { error: 'snapshot_unavailable' }; }
  const snapshot = ownDataRecord(raw, SNAPSHOT_FIELDS);
  if (snapshot === null) return { error: 'snapshot_unavailable' };
  if (!Number.isSafeInteger(snapshot.authorizedNodeCount) || snapshot.authorizedNodeCount < 0
      || !Number.isSafeInteger(snapshot.authorizedEdgeCount) || snapshot.authorizedEdgeCount < 0) {
    return { error: 'snapshot_corrupt' };
  }
  if (snapshot.authorizedNodeCount > GRAPH_CANDIDATE_MAX_NODES_V1
      || snapshot.authorizedEdgeCount > GRAPH_CANDIDATE_MAX_EDGES_V1) return { error: 'limit_exceeded' };
  const nodesRaw = ownDenseArray(snapshot.nodes, GRAPH_CANDIDATE_MAX_NODES_V1);
  const edgesRaw = ownDenseArray(snapshot.edges, GRAPH_CANDIDATE_MAX_EDGES_V1);
  if (nodesRaw === null || edgesRaw === null || !Object.isFrozen(snapshot.nodes)
      || !Object.isFrozen(snapshot.edges)
      || nodesRaw.length !== snapshot.authorizedNodeCount
      || edgesRaw.length !== snapshot.authorizedEdgeCount) return { error: 'snapshot_corrupt' };
  const pin = request.pin;
  for (const field of ['workspaceUid', 'projectUid', 'worktreeUid', 'revisionId', 'graphSnapshotId',
    'graphRoot', 'authorizationScopeDigest', 'policyHash', 'policyVersion', 'searchReceiptUid']) {
    if (snapshot[field] !== pin[field]) return { error: 'snapshot_corrupt' };
  }
  if (snapshot.schema !== 'spipe-authorized-graph-search-v1'
      || typeof snapshot.authorizedGraphDigest !== 'string'
      || !HASH_PATTERN.test(snapshot.authorizedGraphDigest)) {
    return { error: 'snapshot_corrupt' };
  }
  const nodes = [];
  const nodeMap = new Map();
  for (const rawNode of nodesRaw) {
    const record = ownDataRecord(rawNode, NODE_FIELDS);
    if (record === null) return { error: 'snapshot_corrupt' };
    let node;
    try { node = createGraphNode(record); } catch (_error) { return { error: 'snapshot_corrupt' }; }
    if (!deeplyFrozen(rawNode)) return { error: 'snapshot_corrupt' };
    if (nodeMap.has(node.uid) || (nodes.length > 0
        && unsignedUtf8CompareV1(nodes.at(-1).uid, node.uid) >= 0)) return { error: 'snapshot_corrupt' };
    nodes.push(node);
    nodeMap.set(node.uid, node);
  }
  const edges = [];
  const edgeIds = new Set();
  for (const rawEdge of edgesRaw) {
    const edge = normalizeEdge(rawEdge);
    if (edge === null) return { error: 'snapshot_corrupt' };
    if (edgeIds.has(edge.uid) || (edges.length > 0
        && unsignedUtf8CompareV1(edges.at(-1).uid, edge.uid) >= 0)) return { error: 'snapshot_corrupt' };
    edges.push(edge);
    edgeIds.add(edge.uid);
  }
  const digestValue = {
    schema: snapshot.schema,
    workspaceUid: snapshot.workspaceUid,
    projectUid: snapshot.projectUid,
    worktreeUid: snapshot.worktreeUid,
    revisionId: snapshot.revisionId,
    graphSnapshotId: snapshot.graphSnapshotId,
    graphRoot: snapshot.graphRoot,
    authorizationScopeDigest: snapshot.authorizationScopeDigest,
    policyHash: snapshot.policyHash,
    policyVersion: snapshot.policyVersion,
    searchReceiptUid: snapshot.searchReceiptUid,
    authorizedNodeCount: snapshot.authorizedNodeCount,
    authorizedEdgeCount: snapshot.authorizedEdgeCount,
    nodes,
    edges,
  };
  if (digest(SNAPSHOT_DOMAIN, digestValue) !== snapshot.authorizedGraphDigest) return { error: 'snapshot_corrupt' };
  return { value: freezeDeep({ snapshot, nodes, edges, nodeMap }) };
}

function normalizeEdge(rawEdge) {
  const edge = ownDataRecord(rawEdge, EDGE_V2_FIELDS);
  if (edge === null || !Object.isFrozen(rawEdge)) return null;
  const evidence = ownDenseArray(edge.evidence_uids, GRAPH_CANDIDATE_MAX_NODES_V1);
  const provenance = ownDataRecord(edge.provenance, PROVENANCE_FIELDS);
  if (evidence === null || provenance === null || !Object.isFrozen(edge.evidence_uids)
      || !Object.isFrozen(edge.provenance)) return null;
  let authority = null;
  if (edge.authority !== null) {
    authority = ownDataRecord(edge.authority, AUTHORITY_FIELDS);
    if (authority === null || !Object.isFrozen(edge.authority)) return null;
  }
  let generator = null;
  if (edge.generator !== null) {
    generator = ownDataRecord(edge.generator, GENERATOR_FIELDS);
    if (generator === null || !Object.isFrozen(edge.generator)) return null;
  }
  let sourceLocation = null;
  if (provenance.source_location !== null) {
    sourceLocation = ownDataRecord(provenance.source_location, LOCATION_FIELDS);
    if (sourceLocation === null || !Object.isFrozen(provenance.source_location)) return null;
    const span = ownDataRecord(sourceLocation.span, SPAN_FIELDS);
    if (span === null || !Object.isFrozen(sourceLocation.span)) return null;
    sourceLocation = Object.freeze({
      source_artifact_uid: sourceLocation.source_artifact_uid,
      source_hash: sourceLocation.source_hash,
      span: Object.freeze({ start_byte: span.start_byte, end_byte: span.end_byte }),
    });
  }
  const normalized = {
    ...edge,
    evidence_uids: [...evidence],
    generator: generator === null ? null : { ...generator },
    provenance: { ...provenance, source_location: sourceLocation },
    authority: authority === null ? null : { ...authority },
  };
  let record;
  try { record = createEdgeRecord(normalized); } catch (_error) { return null; }
  if (!deeplyFrozen(rawEdge)) return null;
  return record;
}

function strictEdge(edge, pin, nodeMap) {
  if (edge.schema_version !== 2 || edge.status !== 'accepted'
      || !['explicit', 'generated'].includes(edge.origin)) return false;
  if (edge.authority === null || edge.provenance.decision_uid !== edge.authority.receipt_uid
      || edge.authority.kind !== (edge.origin === 'explicit' ? 'explicit_review' : 'trusted_generator')
      || edge.authority.policy_hash !== pin.policyHash || edge.authority.policy_version !== pin.policyVersion
      || edge.provenance.project_uid !== pin.projectUid || edge.provenance.worktree_uid !== pin.worktreeUid
      || edge.provenance.revision_id !== pin.revisionId
      || edge.provenance.input_snapshot_uid !== pin.graphSnapshotId
      || !nodeMap.has(edge.from_uid) || !nodeMap.has(edge.to_uid)) return null;
  return true;
}

function exactResponse(value, fields, expected) {
  const response = ownDataRecord(value, fields);
  if (response === null || !Object.isFrozen(value)) return false;
  const responsePin = normalizePin(response.pin);
  if (responsePin === null || !Object.isFrozen(response.pin)) return false;
  for (const field of fields) {
    if (field === 'pin') {
      if (!PIN_FIELDS.every((pinField) => Object.is(responsePin[pinField], expected.pin[pinField]))) return false;
    } else if (!Object.is(response[field], expected[field])) return false;
  }
  return true;
}

function makeRootPath(documentId, seedTier, seedRank) {
  return freezeDeep({
    nodeUid: documentId,
    distance: 0,
    seedTier,
    seedRank,
    generatedEdgeCount: 0,
    bottleneckConfidenceMilli: 1000,
    edgeUidSequence: [],
    directionSequence: [],
    nodeUidSequence: [documentId],
    edgeEvidence: [],
    rootArtifactUid: documentId,
  });
}

function createTraversal(request, snapshotState, admittedEdges) {
  const roots = [];
  const seen = new Set();
  if (request.pinnedArtifactUid !== null) {
    roots.push(makeRootPath(request.pinnedArtifactUid, 0, 0));
    seen.add(request.pinnedArtifactUid);
  }
  for (const seed of request.lexicalSeeds) {
    if (!seen.has(seed.documentId)) roots.push(makeRootPath(seed.documentId, 1, seed.sourceRank));
    seen.add(seed.documentId);
  }
  for (const root of roots) {
    const node = snapshotState.nodeMap.get(root.nodeUid);
    if (node === undefined || node.node_kind !== 'Artifact') return { error: 'snapshot_corrupt' };
  }
  const adjacency = new Map(snapshotState.nodes.map((node) => [node.uid, []]));
  const admittedEdgeIds = new Set(admittedEdges.map((edge) => edge.uid));
  for (const edge of snapshotState.edges) {
    adjacency.get(edge.from_uid)?.push(Object.freeze({
      edge, direction: 'out', nextUid: edge.to_uid, admitted: admittedEdgeIds.has(edge.uid),
    }));
    adjacency.get(edge.to_uid)?.push(Object.freeze({
      edge, direction: 'in', nextUid: edge.from_uid, admitted: admittedEdgeIds.has(edge.uid),
    }));
  }
  for (const entries of adjacency.values()) entries.sort((left, right) => {
    const byEdge = unsignedUtf8CompareV1(left.edge.uid, right.edge.uid);
    return byEdge !== 0 ? byEdge : compareDirection(left.direction, right.direction);
  });
  const best = new Map();
  const frontier = [];
  const visited = new Set();
  for (const root of roots) {
    const key = `${root.nodeUid}\0${root.distance}`;
    const prior = best.get(key);
    if (prior === undefined || pathTupleCompare(root, prior) < 0) {
      best.set(key, root);
      frontier.push({ path: root, edgeIndex: 0 });
    }
    visited.add(root.nodeUid);
  }
  return { value: {
    requestBinding: bindingOf(request),
    snapshot: snapshotState.snapshot,
    nodeMap: snapshotState.nodeMap,
    adjacency,
    admittedEdges,
    roots: new Set(roots.map((root) => root.nodeUid)),
    frontier,
    frontierIndex: 0,
    best,
    visited,
    workUnits: 0,
    consumed: false,
  } };
}

function extendPath(path, incident) {
  return freezeDeep({
    nodeUid: incident.nextUid,
    distance: path.distance + 1,
    seedTier: path.seedTier,
    seedRank: path.seedRank,
    generatedEdgeCount: path.generatedEdgeCount + (incident.edge.origin === 'generated' ? 1 : 0),
    bottleneckConfidenceMilli: Math.min(path.bottleneckConfidenceMilli, incident.edge.confidence_milli),
    edgeUidSequence: [...path.edgeUidSequence, incident.edge.uid],
    directionSequence: [...path.directionSequence, incident.direction],
    nodeUidSequence: [...path.nodeUidSequence, incident.nextUid],
    edgeEvidence: [...path.edgeEvidence, Object.freeze({
      edgeUid: incident.edge.uid,
      authorityReceiptUid: incident.edge.authority.receipt_uid,
    })],
    rootArtifactUid: path.rootArtifactUid,
  });
}

function counters(state, returnedCandidates) {
  return Object.freeze({
    visitedNodes: state.visited.size,
    admittedEdges: state.admittedEdges.length,
    workUnits: state.workUnits,
    returnedCandidates,
  });
}

function completeValue(state) {
  const candidates = [];
  for (const path of state.best.values()) {
    if (path.distance === 0 || state.roots.has(path.nodeUid)
        || state.nodeMap.get(path.nodeUid)?.node_kind !== 'Artifact') continue;
    const prior = candidates.find((item) => item.documentId === path.nodeUid);
    if (prior === undefined) candidates.push({ documentId: path.nodeUid, path });
    else if (pathTupleCompare(path, prior.path) < 0) prior.path = path;
  }
  candidates.sort((left, right) => {
    const compared = pathTupleCompare(left.path, right.path);
    return compared !== 0 ? compared : unsignedUtf8CompareV1(left.documentId, right.documentId);
  });
  const selected = candidates.slice(0, state.requestBinding.sourceK);
  const evidenceRecords = selected.map(({ documentId, path }) => {
    const evidenceEdgeUids = [...new Set(path.edgeEvidence.map((entry) => entry.edgeUid))]
      .sort(unsignedUtf8CompareV1);
    const authorityReceiptUids = [...new Set(path.edgeEvidence.map((entry) => entry.authorityReceiptUid))]
      .sort(unsignedUtf8CompareV1);
    return freezeDeep({
      documentId,
      distance: path.distance,
      rootArtifactUid: path.rootArtifactUid,
      acceptedEdgeEvidence: path.edgeEvidence,
      evidenceEdgeUids,
      authorityReceiptUids,
    });
  });
  const edgeSet = state.admittedEdges.map((edge) => ({
    edgeUid: edge.uid,
    authorityReceiptUid: edge.authority.receipt_uid,
  }));
  const acceptedEdgeSetDigest = digest(EDGE_SET_DOMAIN, edgeSet);
  const evidenceDigest = digest(EVIDENCE_DOMAIN, evidenceRecords.map((record) => ({
    documentId: record.documentId,
    distance: record.distance,
    rootArtifactUid: record.rootArtifactUid,
    acceptedEdgeEvidence: record.acceptedEdgeEvidence,
  })));
  const sourceIdentity = digest(SOURCE_IDENTITY_DOMAIN, {
    contractVersion: GRAPH_CANDIDATE_CONTRACT_V1,
    pin: state.requestBinding.pin,
    roots: [
      ...(state.requestBinding.pinnedArtifactUid === null ? [] : [{
        documentId: state.requestBinding.pinnedArtifactUid, seedTier: 0, seedRank: 0,
      }]),
      ...state.requestBinding.lexicalSeeds
        .filter((seed) => seed.documentId !== state.requestBinding.pinnedArtifactUid)
        .map((seed) => ({ documentId: seed.documentId, seedTier: 1, seedRank: seed.sourceRank })),
    ],
    sourceK: state.requestBinding.sourceK,
    authorizedGraphDigest: state.snapshot.authorizedGraphDigest,
    acceptedEdgeSetDigest,
    evidenceDigest,
  });
  const documentIds = selected.map((candidate) => candidate.documentId);
  const candidateDigest = digest(SOURCE_POOL_DOMAIN, {
    name: 'graph', sourceIdentity, documentIds,
  });
  const source = freezeDeep({
    name: 'graph', sourceIdentity, complete: true,
    candidateCount: documentIds.length, candidateDigest,
    candidates: documentIds.map((documentId) => Object.freeze({ documentId })),
  });
  const evidenceIdentity = freezeDeep({
    graphCandidateContractVersion: GRAPH_CANDIDATE_CONTRACT_V1,
    graphSnapshotId: state.snapshot.graphSnapshotId,
    graphRoot: state.snapshot.graphRoot,
    authorizationScopeDigest: state.snapshot.authorizationScopeDigest,
    policyHash: state.snapshot.policyHash,
    policyVersion: state.snapshot.policyVersion,
    searchReceiptUid: state.snapshot.searchReceiptUid,
    authorizedGraphDigest: state.snapshot.authorizedGraphDigest,
    acceptedEdgeSetDigest,
    evidenceDigest,
  });
  return freezeDeep({
    status: 'complete', contractVersion: GRAPH_CANDIDATE_CONTRACT_V1,
    source, evidenceIdentity, evidenceRecords: Object.freeze(evidenceRecords),
    counters: counters(state, documentIds.length),
  });
}

export function createAcceptedGraphCandidateGeneratorV1(factoryInput) {
  const factory = ownDataRecord(factoryInput, ['readGraphSnapshot', 'verifyEdgeReceipt', 'authorizeNode']);
  if (factory === null || typeof factory.readGraphSnapshot !== 'function'
      || typeof factory.verifyEdgeReceipt !== 'function' || typeof factory.authorizeNode !== 'function') {
    throw new TypeError('graph candidate factory requires exactly three function ports');
  }
  // The WeakMap is the sole cursor registry: state never references a cursor.
  // A continuation consumes/deletes its handle before validation, and a partial
  // page installs exactly one fresh replacement, leaving no strong registry root.
  const states = new WeakMap();

  function cursorFor(state) {
    const cursor = Object.freeze(Object.create(null));
    states.set(cursor, state);
    return cursor;
  }

  function runPage(state, maxWorkUnits) {
    let pageWork = 0;
    while (state.frontierIndex < state.frontier.length) {
      const item = state.frontier[state.frontierIndex];
      const current = state.best.get(`${item.path.nodeUid}\0${item.path.distance}`);
      if (current !== item.path) {
        state.frontierIndex += 1;
        continue;
      }
      if (item.path.distance >= GRAPH_CANDIDATE_MAX_DEPTH_V1) {
        state.frontierIndex += 1;
        continue;
      }
      const incident = state.adjacency.get(item.path.nodeUid);
      if (item.edgeIndex >= incident.length) {
        state.frontierIndex += 1;
        continue;
      }
      if (state.workUnits >= state.requestBinding.maxTotalWorkUnits) return { error: 'limit_exceeded' };
      if (pageWork >= maxWorkUnits) return { partial: true };
      const next = incident[item.edgeIndex];
      item.edgeIndex += 1;
      pageWork += 1;
      state.workUnits += 1;
      if (!next.admitted) continue;
      if (item.path.edgeUidSequence.includes(next.edge.uid)
          || item.path.nodeUidSequence.includes(next.nextUid)) continue;
      const candidate = extendPath(item.path, next);
      const key = `${candidate.nodeUid}\0${candidate.distance}`;
      const prior = state.best.get(key);
      if (prior !== undefined && pathTupleCompare(candidate, prior) >= 0) continue;
      if (!state.visited.has(candidate.nodeUid)) {
        if (state.visited.size >= GRAPH_CANDIDATE_MAX_NODES_V1) return { error: 'limit_exceeded' };
        state.visited.add(candidate.nodeUid);
      }
      state.best.set(key, candidate);
      state.frontier.push({ path: candidate, edgeIndex: 0 });
    }
    return { complete: true };
  }

  function generateGraphCandidatesV1(rawRequest) {
    try {
      const requestEnvelope = ownDataRecord(rawRequest, REQUEST_FIELDS);
      if (requestEnvelope === null || requestEnvelope.contractVersion !== GRAPH_CANDIDATE_CONTRACT_V1
          || requestEnvelope.operation !== 'graph_candidates') return resultError('invalid_request');
      let state;
      const isContinuation = requestEnvelope.cursor !== null;
      if (isContinuation) {
        if (typeof requestEnvelope.cursor !== 'object') return resultError('invalid_cursor');
        state = states.get(requestEnvelope.cursor);
        if (state === undefined || state.consumed) return resultError('invalid_cursor');
        state.consumed = true;
        states.delete(requestEnvelope.cursor);
      }
      const normalized = normalizedRequest(requestEnvelope);
      if (normalized.error !== undefined) return normalized.error;
      const request = normalized.value;
      if (isContinuation) {
        if (!sameRecord(bindingOf(request), state.requestBinding)) return resultError('invalid_cursor');
      } else {
        let rawSnapshot;
        try { rawSnapshot = factory.readGraphSnapshot(request.pin); }
        catch (_error) { return resultError('snapshot_unavailable'); }
        const normalizedSnapshot = normalizeSnapshot(rawSnapshot, request);
        if (normalizedSnapshot.error !== undefined) return resultError(normalizedSnapshot.error);
        const snapshotState = normalizedSnapshot.value;
        let authorizationFailed = false;
        for (const node of snapshotState.nodes) {
          const authRequest = freezeDeep({ pin: request.pin, nodeUid: node.uid, nodeKind: node.node_kind });
          try {
            const expected = freezeDeep({
              ...authRequest, decision: 'allowed',
              authorizationScopeDigest: request.pin.authorizationScopeDigest,
              policyHash: request.pin.policyHash,
              policyVersion: request.pin.policyVersion,
              searchReceiptUid: request.pin.searchReceiptUid,
            });
            if (!exactResponse(factory.authorizeNode(authRequest), AUTH_RESPONSE_FIELDS, expected)) authorizationFailed = true;
          } catch (_error) { authorizationFailed = true; }
        }
        if (authorizationFailed) return resultError('snapshot_unavailable');
        const admittedEdges = [];
        for (const edge of snapshotState.edges) {
          const strict = strictEdge(edge, request.pin, snapshotState.nodeMap);
          if (strict === false) continue;
          if (strict === null) return resultError('snapshot_corrupt');
          const verifyRequest = freezeDeep({
            pin: request.pin,
            edgeUid: edge.uid,
            edgeType: edge.edge_type,
            fromUid: edge.from_uid,
            toUid: edge.to_uid,
            origin: edge.origin,
            receiptUid: edge.authority.receipt_uid,
            authorityKind: edge.authority.kind,
            policyHash: edge.authority.policy_hash,
            policyVersion: edge.authority.policy_version,
          });
          let verified = false;
          try {
            verified = exactResponse(factory.verifyEdgeReceipt(verifyRequest), VERIFY_RESPONSE_FIELDS,
              freezeDeep({ ...verifyRequest, decision: 'verified' }));
          } catch (_error) { verified = false; }
          if (!verified) return resultError('evidence_unverified');
          admittedEdges.push(edge);
        }
        const traversal = createTraversal(request, snapshotState, admittedEdges);
        if (traversal.error !== undefined) return resultError(traversal.error);
        state = traversal.value;
      }
      const progress = runPage(state, request.maxWorkUnits);
      if (progress.error !== undefined) {
        state.consumed = true;
        return resultError(progress.error);
      }
      if (progress.partial) {
        state.consumed = false;
        const cursor = cursorFor(state);
        return resultOk(freezeDeep({
          status: 'partial', contractVersion: GRAPH_CANDIDATE_CONTRACT_V1,
          cursor, counters: counters(state, 0),
        }));
      }
      state.consumed = true;
      return resultOk(completeValue(state));
    } catch (_error) {
      return resultError('internal_error');
    }
  }

  return Object.freeze({ generateGraphCandidatesV1 });
}
