import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { canonicalJson, freezeDeep } from "../storage/canonical.js";
import { validateEdgeEndpointKinds } from "../model/edge.js";
import { canonicalGraphRecord, compareEdges, graphRecordHash, graphRoot } from "./canonical.js";
import { createGraphDelta, hashGraphDelta } from "./delta.js";

export const GRAPH_LIMITS = freezeDeep({
  depth: { default: 8, hard: 32 },
  visited_nodes: { default: 2_000, hard: 20_000 },
  returned_edges: { default: 10_000, hard: 50_000 },
  work_units: { default: 50_000, hard: 500_000 },
  edge_page: { default: 100, hard: 1_000 },
  trace_rows: { default: 100, hard: 1_000 }
});


const PIN_BRAND = new WeakSet();
const PIN_STATE = new WeakMap();

function error(code, message) {
  const value = new Error(message);
  value.code = code;
  return value;
}

function bounded(value, key) {
  const limit = GRAPH_LIMITS[key];
  const selected = value ?? limit.default;
  if (!Number.isInteger(selected) || selected < 0 || selected > limit.hard) {
    throw new RangeError(`${key} must be an integer between 0 and ${limit.hard}`);
  }
  return selected;
}

function mapRecords(values, kind) {
  const records = new Map();
  for (const value of values ?? []) {
    const record = canonicalGraphRecord(value, kind);
    if (records.has(record.uid)) throw error("SPK001", `duplicate ${kind} UID: ${record.uid}`);
    records.set(record.uid, record);
  }
  return records;
}

function immutableState(snapshotUid, nodes, edges) {
  const orderedNodes = [...nodes.values()].sort((a, b) => a.uid.localeCompare(b.uid));
  const orderedEdges = [...edges.values()].sort(compareEdges);
  return freezeDeep({
    snapshot_uid: snapshotUid,
    graph_root: graphRoot(orderedNodes, orderedEdges),
    nodes: orderedNodes,
    edges: orderedEdges
  });
}

export class GraphStore {
  #states = new Map();
  #replays = new Map();
  #baseApplications = new Map();
  #secret = randomBytes(32);
  #storeId = randomBytes(16).toString("hex");
  #liveness = 1;

  build({ snapshot_uid, nodes = [], edges = [] }) {
    if (typeof snapshot_uid !== "string" || snapshot_uid.length === 0) throw new TypeError("snapshot_uid is required");
    const nodeMap = mapRecords(nodes, "node");
    const edgeMap = mapRecords(edges, "edge");
    this.#validateEndpoints(nodeMap, edgeMap);
    const state = immutableState(snapshot_uid, nodeMap, edgeMap);
    const existing = this.#states.get(snapshot_uid);
    if (existing && canonicalJson(existing) !== canonicalJson(state)) throw error("SPK001", `snapshot graph collision: ${snapshot_uid}`);
    this.#states.set(snapshot_uid, state);
    return state;
  }

  apply({ delta: input, output_snapshot_uid }) {
    const delta = createGraphDelta(input);
    const deltaHash = hashGraphDelta(delta);
    const replay = this.#replays.get(deltaHash);
    if (typeof output_snapshot_uid !== "string" || output_snapshot_uid.length === 0) throw new TypeError("output_snapshot_uid is required");
    if (replay) {
      if (replay.output_snapshot_uid !== output_snapshot_uid) throw error("SPK902", "graph delta replay names a different output snapshot");
      return freezeDeep({ status: "already_applied", ...replay });
    }
    const baseKey = `${delta.base_snapshot_uid}\0${delta.base_graph_root}`;
    if (this.#baseApplications.has(baseKey)) throw error("SPK902", "a different graph delta already consumed this base");
    const base = this.#states.get(delta.base_snapshot_uid);
    if (!base || base.graph_root !== delta.base_graph_root) throw error("SPK902", "graph delta has a stale base");

    const nodes = new Map(base.nodes.map((record) => [record.uid, record]));
    const edges = new Map(base.edges.map((record) => [record.uid, record]));
    this.#applySet(nodes, delta.nodes, "node");
    this.#applySet(edges, delta.edges, "edge");
    this.#validateEndpoints(nodes, edges);
    const state = immutableState(output_snapshot_uid, nodes, edges);
    const existing = this.#states.get(output_snapshot_uid);
    if (existing && canonicalJson(existing) !== canonicalJson(state)) throw error("SPK001", `snapshot graph collision: ${output_snapshot_uid}`);
    this.#states.set(output_snapshot_uid, state);
    const receipt = freezeDeep({
      delta_hash: deltaHash,
      base_snapshot_uid: delta.base_snapshot_uid,
      base_graph_root: delta.base_graph_root,
      output_snapshot_uid,
      output_graph_root: state.graph_root
    });
    this.#replays.set(deltaHash, receipt);
    this.#baseApplications.set(baseKey, deltaHash);
    return freezeDeep({ status: "applied", ...receipt });
  }

  pin(snapshotUid, { scope_digest, policy_version, ttl_ms = 300_000 } = {}) {
    const state = this.#states.get(snapshotUid);
    if (!state) throw error("SPK902", `unknown snapshot: ${snapshotUid}`);
    if (typeof scope_digest !== "string" || scope_digest.length === 0) throw new TypeError("scope_digest is required");
    if (!Number.isInteger(policy_version) || policy_version < 0) throw new TypeError("policy_version must be a non-negative integer");
    if (!Number.isInteger(ttl_ms) || ttl_ms <= 0) throw new TypeError("ttl_ms must be a positive integer");
    const now = Date.now();
    const stateRecord = {
      store_id: this.#storeId,
      snapshot_uid: snapshotUid,
      graph_root: state.graph_root,
      scope_digest,
      policy_version,
      issued_at_ms: now,
      expires_at_ms: now + ttl_ms,
      liveness_generation: this.#liveness,
      released: false
    };
    const pin = freezeDeep({
      snapshot_uid: stateRecord.snapshot_uid, graph_root: stateRecord.graph_root,
      scope_digest: stateRecord.scope_digest, policy_version: stateRecord.policy_version,
      issued_at_ms: stateRecord.issued_at_ms, expires_at_ms: stateRecord.expires_at_ms,
      liveness_generation: stateRecord.liveness_generation
    });
    PIN_BRAND.add(pin);
    PIN_STATE.set(pin, stateRecord);
    return pin;
  }

  release(pin) {
    this.#assertPin(pin).released = true;
  }

  node(pin, uid) {
    return this.#state(pin).nodes.find((record) => record.uid === uid) ?? null;
  }

  edge(pin, uid) {
    return this.#state(pin).edges.find((record) => record.uid === uid) ?? null;
  }

  edges(pin, { from_uid = null, to_uid = null, edge_type = null, cursor = null, limit = null, max_work_units = null } = {}) {
    const state = this.#state(pin);
    const pageLimit = bounded(limit, "edge_page");
    const workLimit = bounded(max_work_units, "work_units");
    const filter = { from_uid, to_uid, edge_type, max_work_units: workLimit };
    const start = cursor ? this.#decodeCursor(pin, cursor, "edges", filter, pageLimit) : 0;
    if (!Number.isInteger(start) || start < 0) throw error("SPK704", "edge cursor position is invalid");
    const items = [];
    let index = start;
    let work = 0;
    let reason = null;
    while (index < state.edges.length && items.length < pageLimit) {
      if (work >= workLimit) { reason = "work_units"; break; }
      const edge = state.edges[index];
      index += 1;
      work += 1;
      if ((from_uid == null || edge.from_uid === from_uid) &&
          (to_uid == null || edge.to_uid === to_uid) &&
          (edge_type == null || edge.edge_type === edge_type)) items.push(edge);
    }
    return freezeDeep({
      items,
      exhausted: reason != null,
      reason,
      counters: { returned_edges: items.length, work_units: work },
      cursor: index < state.edges.length ? this.#encodeCursor(pin, "edges", filter, pageLimit, index) : null
    });
  }

  traverse(pin, { start_uids, direction = "out", edge_types = null, max_depth, max_visited_nodes, max_returned_edges, max_work_units, cursor = null } = {}) {
    const state = this.#state(pin);
    if (!Array.isArray(start_uids) || start_uids.length === 0) throw new TypeError("start_uids must be a non-empty array");
    if (!["out", "in", "both"].includes(direction)) throw new TypeError("direction is invalid");
    const limits = {
      depth: bounded(max_depth, "depth"),
      visited: bounded(max_visited_nodes, "visited_nodes"),
      edges: bounded(max_returned_edges, "returned_edges"),
      work: bounded(max_work_units, "work_units")
    };
    const filter = {
      start_uids: [...new Set(start_uids)].sort(), direction,
      edge_types: edge_types == null ? null : [...new Set(edge_types)].sort(),
      max_depth: limits.depth, max_visited_nodes: limits.visited,
      max_returned_edges: limits.edges, max_work_units: limits.work
    };
    const allowed = edge_types == null ? null : new Set(edge_types);
    const prior = cursor ? this.#decodeCursor(pin, cursor, "traverse", filter, limits.edges) : null;
    if (prior != null && (!prior || typeof prior !== "object" || !Array.isArray(prior.queue) || !Array.isArray(prior.visited_uids) || !Array.isArray(prior.emitted_edge_uids))) {
      throw error("SPK704", "traversal cursor position is invalid");
    }
    const visited = new Set(prior?.visited_uids ?? filter.start_uids);
    const emitted = new Set(prior?.emitted_edge_uids ?? []);
    const queue = prior?.queue.map((item) => ({ uid: item.uid, depth: item.depth, edge_index: item.edge_index })) ??
      [...visited].map((uid) => ({ uid, depth: 0, edge_index: 0 }));
    const outputEdges = [];
    let work = 0;
    let pageVisited = prior == null ? visited.size : 0;
    let totalWork = prior?.total_work_units ?? 0;
    let reason = null;
    while (queue.length > 0 && reason == null) {
      const current = queue[0];
      if (current.depth >= limits.depth) { queue.shift(); continue; }
      while (current.edge_index < state.edges.length) {
        if (totalWork >= GRAPH_LIMITS.work_units.hard) { reason = "work_units_hard"; break; }
        if (work >= limits.work) { reason = "work_units"; break; }
        const edge = state.edges[current.edge_index];
        work += 1;
        totalWork += 1;
        current.edge_index += 1;
        if (allowed && !allowed.has(edge.edge_type)) continue;
        const outgoing = direction !== "in" && edge.from_uid === current.uid;
        const incoming = direction !== "out" && edge.to_uid === current.uid;
        if (!outgoing && !incoming) continue;
        if (emitted.has(edge.uid)) continue;
        const neighbor = outgoing ? edge.to_uid : edge.from_uid;
        if (!visited.has(neighbor) && visited.size >= GRAPH_LIMITS.visited_nodes.hard) {
          current.edge_index -= 1;
          work -= 1;
          totalWork -= 1;
          reason = "visited_nodes_hard";
          break;
        }
        if (!visited.has(neighbor) && pageVisited >= limits.visited) {
          current.edge_index -= 1;
          work -= 1;
          reason = "visited_nodes";
          break;
        }
        if (emitted.size >= GRAPH_LIMITS.returned_edges.hard) {
          current.edge_index -= 1;
          work -= 1;
          totalWork -= 1;
          reason = "returned_edges_hard";
          break;
        }
        if (outputEdges.length >= limits.edges) {
          current.edge_index -= 1;
          work -= 1;
          reason = "returned_edges";
          break;
        }
        outputEdges.push(edge);
        emitted.add(edge.uid);
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          pageVisited += 1;
          queue.push({ uid: neighbor, depth: current.depth + 1, edge_index: 0 });
        }
      }
      if (reason == null) queue.shift();
    }
    const hardStop = reason?.endsWith("_hard") === true;
    const nextPosition = reason == null || hardStop ? null : {
      queue: queue.map((item) => ({ uid: item.uid, depth: item.depth, edge_index: item.edge_index })),
      visited_uids: [...visited].sort(), emitted_edge_uids: [...emitted].sort(), total_work_units: totalWork
    };
    const nextCursor = nextPosition == null ? null : this.#encodeCursor(pin, "traverse", filter, limits.edges, nextPosition);
    return freezeDeep({
      node_uids: [...visited], edges: outputEdges, exhausted: reason != null, reason,
      counters: { visited_nodes: visited.size, returned_edges: outputEdges.length, work_units: work }, cursor: nextCursor
    });
  }

  trace_matrix(pin, { row_uids = null, edge_types = null, cursor = null, limit = null, max_work_units = null, max_returned_edges = null } = {}) {
    const state = this.#state(pin);
    const pageLimit = bounded(limit, "trace_rows");
    const workLimit = bounded(max_work_units, "work_units");
    const edgeLimit = bounded(max_returned_edges, "returned_edges");
    const filter = {
      row_uids: row_uids == null ? null : [...row_uids].sort(),
      edge_types: edge_types == null ? null : [...edge_types].sort(),
      max_work_units: workLimit, max_returned_edges: edgeLimit
    };
    const start = cursor ? this.#decodeCursor(pin, cursor, "trace_matrix", filter, pageLimit) : 0;
    if (!Number.isInteger(start) || start < 0) throw error("SPK704", "trace cursor position is invalid");
    const allowedRows = row_uids == null ? null : new Set(row_uids);
    const allowedTypes = edge_types == null ? null : new Set(edge_types);
    const grouped = new Map();
    let index = start;
    let work = 0;
    let returnedEdges = 0;
    let reason = null;
    while (index < state.edges.length) {
      if (work >= workLimit) { reason = "work_units"; break; }
      const edge = state.edges[index];
      index += 1;
      work += 1;
      if (allowedRows && !allowedRows.has(edge.from_uid)) continue;
      if (allowedTypes && !allowedTypes.has(edge.edge_type)) continue;
      if (returnedEdges >= edgeLimit) {
        index -= 1;
        work -= 1;
        reason = "returned_edges";
        break;
      }
      if (!grouped.has(edge.from_uid) && grouped.size >= pageLimit) {
        index -= 1;
        work -= 1;
        break;
      }
      if (!grouped.has(edge.from_uid)) grouped.set(edge.from_uid, []);
      grouped.get(edge.from_uid).push(edge);
      returnedEdges += 1;
    }
    const rows = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([uid, edges]) => freezeDeep({ uid, edges: [...edges].sort(compareEdges) }));
    return freezeDeep({
      rows, exhausted: reason != null, reason,
      counters: { rows: rows.length, returned_edges: returnedEdges, work_units: work },
      cursor: index < state.edges.length ? this.#encodeCursor(pin, "trace_matrix", filter, pageLimit, index) : null
    });
  }

  #applySet(records, operations, kind) {
    for (const record of operations.added) {
      if (records.has(record.uid)) throw error("SPK001", `${kind} already exists: ${record.uid}`);
      records.set(record.uid, record);
    }
    for (const update of operations.updated) {
      const record = update[kind];
      const current = records.get(record.uid);
      if (!current || graphRecordHash(current) !== update.before_hash) throw error("SPK902", `${kind} before_hash mismatch: ${record.uid}`);
      if (kind === "edge") {
        for (const field of ["from_uid", "to_uid", "edge_type", "origin", "provenance"]) {
          if (canonicalJson(current[field] ?? null) !== canonicalJson(record[field] ?? null)) {
            throw error("SPK006", `edge ${field} changes require remove-plus-add with a new UID`);
          }
        }
      }
      records.set(record.uid, record);
    }
    for (const removal of operations.removed) {
      const current = records.get(removal.uid);
      if (!current || graphRecordHash(current) !== removal.before_hash) throw error("SPK902", `${kind} before_hash mismatch: ${removal.uid}`);
      records.delete(removal.uid);
    }
  }

  #validateEndpoints(nodes, edges) {
    for (const edge of edges.values()) {
      if (!nodes.has(edge.from_uid) || !nodes.has(edge.to_uid)) throw error("SPK104", `edge has a missing endpoint: ${edge.uid}`);
      const from = nodes.get(edge.from_uid).node_kind;
      const to = nodes.get(edge.to_uid).node_kind;
      try { validateEdgeEndpointKinds(edge.edge_type, from, to); }
      catch { throw error("SPK006", `edge endpoint kinds are not admitted: ${edge.edge_type} ${from}->${to}`); }
    }
  }

  #assertPin(pin) {
    const state = pin && PIN_BRAND.has(pin) ? PIN_STATE.get(pin) : null;
    if (!state || state.store_id !== this.#storeId) throw error("SPK704", "snapshot pin was not issued by this store");
    if (state.released || state.liveness_generation !== this.#liveness || state.expires_at_ms <= Date.now()) throw error("SPK704", "snapshot pin is no longer live");
    return state;
  }

  #state(pin) {
    const binding = this.#assertPin(pin);
    const state = this.#states.get(binding.snapshot_uid);
    if (!state || state.graph_root !== binding.graph_root) throw error("SPK902", "snapshot pin graph binding is stale");
    return state;
  }

  #encodeCursor(pin, operation, filter, limit, position) {
    const binding = this.#assertPin(pin);
    const payload = Buffer.from(canonicalJson({
      store_id: this.#storeId, snapshot_uid: binding.snapshot_uid, graph_root: binding.graph_root,
      scope_digest: binding.scope_digest, policy_version: binding.policy_version,
      operation, filter, limit, position, expires_at_ms: binding.expires_at_ms
    }), "utf8").toString("base64url");
    const signature = createHmac("sha256", this.#secret).update(payload).digest("base64url");
    return `${payload}.${signature}`;
  }

  #decodeCursor(pin, cursor, operation, filter, limit) {
    const pinState = this.#assertPin(pin);
    if (typeof cursor !== "string" || !cursor.includes(".")) throw error("SPK704", "cursor is invalid");
    const [payload, signature, ...extra] = cursor.split(".");
    if (extra.length !== 0) throw error("SPK704", "cursor is invalid");
    const expected = createHmac("sha256", this.#secret).update(payload).digest();
    let provided;
    try { provided = Buffer.from(signature, "base64url"); } catch { throw error("SPK704", "cursor is invalid"); }
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) throw error("SPK704", "cursor authentication failed");
    let record;
    try { record = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { throw error("SPK704", "cursor payload is invalid"); }
    const binding = { store_id: this.#storeId, snapshot_uid: pinState.snapshot_uid, graph_root: pinState.graph_root, scope_digest: pinState.scope_digest, policy_version: pinState.policy_version, operation, filter, limit };
    for (const [key, value] of Object.entries(binding)) {
      if (canonicalJson(record[key]) !== canonicalJson(value)) throw error("SPK704", `cursor ${key} binding mismatch`);
    }
    if (!("position" in record) || record.expires_at_ms <= Date.now()) throw error("SPK704", "cursor is expired or malformed");
    return record.position;
  }
}
