import { createHash } from "node:crypto";

import { canonicalJson, freezeDeep } from "../storage/canonical.js";
import { createEdgeRecord } from "../model/edge.js";
import { createGraphNode } from "../model/graph_node.js";

const HASH_PATTERN = /^(?:sha256:)?[0-9a-f]{64}$/;

export function graphRecordHash(record) {
  return `sha256:${createHash("sha256").update(canonicalJson(record), "utf8").digest("hex")}`;
}

export function graphDeltaHash(delta) {
  return `sha256:${createHash("sha256")
    .update("spipe-graph-delta-v1\0", "utf8")
    .update(canonicalJson(delta), "utf8")
    .digest("hex")}`;
}

export function graphRoot(nodes, edges) {
  return graphRecordHash(canonicalGraphObject(nodes, edges));
}

/** The sole persisted representation used for both graph roots and CAS bytes. */
export function canonicalGraphObject(nodes, edges) {
  const value = {
    schema: 1,
    nodes: [...nodes].map((node) => canonicalGraphRecord(node, "node"))
      .sort((left, right) => left.uid.localeCompare(right.uid)),
    edges: [...edges].map((edge) => canonicalGraphRecord(edge, "edge")).sort(compareEdges)
  };
  return freezeDeep(value);
}

export function canonicalGraphBytes(nodes, edges) {
  return Buffer.from(canonicalJson(canonicalGraphObject(nodes, edges)), "utf8");
}

export function compareEdges(left, right) {
  return edgeKey(left).localeCompare(edgeKey(right));
}

export function edgeKey(edge) {
  return `${edge.from_uid}\0${edge.edge_type}\0${edge.to_uid}\0${edge.uid}`;
}

export function assertHash(value, name) {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
    throw new TypeError(`${name} must be a lowercase SHA-256 hash`);
  }
  return value.startsWith("sha256:") ? value : `sha256:${value}`;
}

export function canonicalGraphRecord(value, kind) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${kind} must be an object`);
  }
  if (typeof value.uid !== "string" || value.uid.length === 0) {
    throw new TypeError(`${kind}.uid must be a non-empty string`);
  }
  const canonical = kind === "node" ? createGraphNode(value) :
    kind === "edge" ? createEdgeRecord(value) : null;
  if (canonical == null) throw new TypeError("graph record kind must be node or edge");
  return freezeDeep(JSON.parse(canonicalJson(canonical)));
}
