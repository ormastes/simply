import { canonicalJson, freezeDeep } from "../storage/canonical.js";
import { assertHash, canonicalGraphRecord, graphDeltaHash } from "./canonical.js";

function canonicalAdded(values, kind) {
  if (!Array.isArray(values ?? [])) throw new TypeError(`${kind}.added must be an array`);
  return [...(values ?? [])].map((value) => canonicalGraphRecord(value, kind)).sort((a, b) => a.uid.localeCompare(b.uid));
}

function canonicalUpdated(values, kind) {
  if (!Array.isArray(values ?? [])) throw new TypeError(`${kind}.updated must be an array`);
  return [...(values ?? [])].map((value) => {
    if (!value || typeof value !== "object") throw new TypeError(`${kind}.updated entry must be an object`);
    return freezeDeep({ before_hash: assertHash(value.before_hash, "before_hash"), [kind]: canonicalGraphRecord(value[kind], kind) });
  }).sort((a, b) => a[kind].uid.localeCompare(b[kind].uid));
}

function canonicalRemoved(values, kind) {
  if (!Array.isArray(values ?? [])) throw new TypeError(`${kind}.removed must be an array`);
  return [...(values ?? [])].map((value) => {
    if (!value || typeof value !== "object" || typeof value.uid !== "string") throw new TypeError(`${kind}.removed entry is invalid`);
    return freezeDeep({ uid: value.uid, before_hash: assertHash(value.before_hash, "before_hash") });
  }).sort((a, b) => a.uid.localeCompare(b.uid));
}

function operationSet(input, kind) {
  const set = {
    added: canonicalAdded(input?.added, kind),
    updated: canonicalUpdated(input?.updated, kind),
    removed: canonicalRemoved(input?.removed, kind)
  };
  const seen = new Set();
  for (const value of set.added) claim(seen, value.uid, kind);
  for (const value of set.updated) claim(seen, value[kind].uid, kind);
  for (const value of set.removed) claim(seen, value.uid, kind);
  return freezeDeep(set);
}

function claim(seen, uid, kind) {
  if (seen.has(uid)) throw new TypeError(`${kind} operation sets must be UID-disjoint: ${uid}`);
  seen.add(uid);
}

export function createGraphDelta(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("graph delta must be an object");
  if (typeof input.base_snapshot_uid !== "string" || input.base_snapshot_uid.length === 0) {
    throw new TypeError("base_snapshot_uid must be a non-empty string");
  }
  const delta = {
    type: "graph_delta",
    schema: 1,
    base_snapshot_uid: input.base_snapshot_uid,
    base_graph_root: assertHash(input.base_graph_root, "base_graph_root"),
    nodes: operationSet(input.nodes, "node"),
    edges: operationSet(input.edges, "edge")
  };
  return freezeDeep(JSON.parse(canonicalJson(delta)));
}

export function hashGraphDelta(input) {
  return graphDeltaHash(createGraphDelta(input));
}
