import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  canonicalGraphBytes, createGraphDelta, GraphStore, graphRecordHash, graphRoot, hashGraphDelta
} from "../../src/graph/index.js";
import { GraphSnapshotStore } from "../../src/storage/graph_snapshot_store.js";
import { createSnapshotMetadata } from "../../src/storage/snapshot_store.js";

const SNAPSHOT_1 = `spks1-${"1".repeat(64)}`;
const SNAPSHOT_2 = `spks1-${"2".repeat(64)}`;
const SNAPSHOT_3 = `spks1-${"3".repeat(64)}`;
const HASH_A = `sha256:${"a".repeat(64)}`;
const PROJECT = `P-${"1".repeat(26)}`;
const WORKTREE = `WT-${"2".repeat(26)}`;
const A_ONE = `A-${"3".repeat(26)}`;
const A_TWO = `A-${"4".repeat(26)}`;
const A_THREE = `A-${"5".repeat(26)}`;
const E_ONE = `E-${"6".repeat(26)}`;
const E_TWO = `E-${"7".repeat(26)}`;

function snapshotManifest(graphRoot, overlay = "b".repeat(64)) {
  return createSnapshotMetadata({
    project_uid: PROJECT, worktree_uid: WORKTREE, revision_id: "rev-1",
    base_generation_hash: "a".repeat(64), overlay_generation_hash: overlay,
    schema_version: 2, parser_version: "wave3-1", analyzer_version: "none-1",
    provider_contract_version: "none-1", policy_hash: "c".repeat(64),
    base_segments: [], graph_root: graphRoot
  });
}

function node(uid, nodeKind = "Artifact", recordType = "artifact") {
  return { uid, node_kind: nodeKind, project_uid: PROJECT, revision_id: "rev-1", record_type: recordType, record_hash: HASH_A, visibility: "project", trust_scope: "reviewed_reference", status: "active" };
}

function edge(uid, from, to, edgeType = "links_to") {
  return {
    schema_version: 2, type: "edge", uid, edge_type: edgeType, from_uid: from, to_uid: to,
    origin: "explicit", status: "proposed", confidence_milli: 1000, created_by: "principal:test", created_at_revision: "rev-1", evidence_uids: [], generator: null,
    provenance: { project_uid: PROJECT, worktree_uid: WORKTREE, revision_id: "rev-1", input_snapshot_uid: SNAPSHOT_1, source_uid: null, source_location: null, decision_uid: null }, authority: null
  };
}

function pin(store, snapshotUid = SNAPSHOT_1) {
  return store.pin(snapshotUid, { scope_digest: "scope:user", policy_version: 1 });
}

test("graph roots and deltas are canonical and operation sets are disjoint", () => {
  const one = node(A_ONE);
  const two = node(A_TWO);
  const relation = edge(E_ONE, one.uid, two.uid);
  assert.equal(graphRoot([one, two], [relation]), graphRoot([two, one], [relation]));
  const input = {
    base_snapshot_uid: SNAPSHOT_1,
    base_graph_root: graphRoot([one], []),
    nodes: { added: [two], updated: [], removed: [] },
    edges: { added: [relation], updated: [], removed: [] }
  };
  assert.equal(hashGraphDelta(input), hashGraphDelta(createGraphDelta(input)));
  assert.throws(() => createGraphDelta({ ...input, nodes: { added: [two], updated: [], removed: [{ uid: two.uid, before_hash: graphRecordHash(two) }] } }), /UID-disjoint/);
});

test("graph apply guards base and before hashes and records exact replay", () => {
  const store = new GraphStore();
  const one = node(A_ONE);
  const two = node(A_TWO);
  const base = store.build({ snapshot_uid: SNAPSHOT_1, nodes: [one], edges: [] });
  const delta = createGraphDelta({
    base_snapshot_uid: SNAPSHOT_1, base_graph_root: base.graph_root,
    nodes: { added: [two], updated: [], removed: [] },
    edges: { added: [edge(E_ONE, one.uid, two.uid)], updated: [], removed: [] }
  });
  const applied = store.apply({ delta, output_snapshot_uid: SNAPSHOT_2 });
  assert.equal(applied.status, "applied");
  assert.equal(store.apply({ delta, output_snapshot_uid: SNAPSHOT_2 }).status, "already_applied");
  assert.throws(() => store.apply({ delta, output_snapshot_uid: SNAPSHOT_3 }), /different output snapshot/);
  assert.equal(store.node(pin(store, SNAPSHOT_2), two.uid).uid, two.uid);
  assert.throws(() => store.apply({ delta: { ...delta, base_graph_root: `sha256:${"f".repeat(64)}` }, output_snapshot_uid: SNAPSHOT_3 }), /stale base/);

  const badUpdate = createGraphDelta({
    base_snapshot_uid: SNAPSHOT_2, base_graph_root: applied.output_graph_root,
    nodes: { added: [], updated: [{ before_hash: `sha256:${"0".repeat(64)}`, node: { ...two, revision_id: "rev-2" } }], removed: [] },
    edges: { added: [], updated: [], removed: [] }
  });
  assert.throws(() => store.apply({ delta: badUpdate, output_snapshot_uid: SNAPSHOT_3 }), /before_hash mismatch/);
});

test("graph reads require live store-issued pins and bind authenticated cursors", () => {
  const store = new GraphStore();
  const records = [node(A_ONE), node(A_TWO), node(A_THREE)];
  const relations = [edge(E_ONE, A_ONE, A_TWO), edge(E_TWO, A_ONE, A_THREE)];
  store.build({ snapshot_uid: SNAPSHOT_1, nodes: records, edges: relations });
  const snapshotPin = pin(store);
  assert.equal(Object.isFrozen(snapshotPin), true);
  assert.throws(() => { snapshotPin.snapshot_uid = SNAPSHOT_2; }, TypeError);
  const first = store.edges(snapshotPin, { from_uid: A_ONE, limit: 1 });
  assert.equal(first.items.length, 1);
  assert.ok(first.cursor);
  const second = store.edges(snapshotPin, { from_uid: A_ONE, limit: 1, cursor: first.cursor });
  assert.equal(second.items.length, 1);
  assert.notEqual(second.items[0].uid, first.items[0].uid);
  assert.throws(() => store.edges(snapshotPin, { to_uid: A_TWO, limit: 1, cursor: first.cursor }), /binding mismatch/);
  assert.throws(() => store.node({ ...snapshotPin }, A_ONE), /not issued/);
  store.release(snapshotPin);
  assert.throws(() => store.node(snapshotPin, A_ONE), /no longer live/);
});

test("bounded traversal reports deterministic exhaustion and trace matrix paginates", () => {
  const store = new GraphStore();
  const records = [node(A_ONE), node(A_TWO), node(A_THREE)];
  const relations = [edge(E_ONE, A_ONE, A_TWO), edge(E_TWO, A_TWO, A_THREE)];
  store.build({ snapshot_uid: SNAPSHOT_1, nodes: records, edges: relations });
  const snapshotPin = pin(store);
  const result = store.traverse(snapshotPin, { start_uids: [A_ONE], max_visited_nodes: 1 });
  assert.equal(result.exhausted, true);
  assert.equal(result.reason, "visited_nodes");
  assert.ok(result.cursor);
  const matrix = store.trace_matrix(snapshotPin, { limit: 1 });
  assert.equal(matrix.rows.length, 1);
  assert.ok(matrix.cursor);
  assert.equal(store.trace_matrix(snapshotPin, { limit: 1, cursor: matrix.cursor }).rows[0].uid, A_TWO);
});

test("traversal continuation cursor resumes the exact frontier without duplicate results", () => {
  const store = new GraphStore();
  store.build({
    snapshot_uid: SNAPSHOT_1,
    nodes: [node(A_ONE), node(A_TWO), node(A_THREE)],
    edges: [edge(E_ONE, A_ONE, A_TWO), edge(E_TWO, A_TWO, A_THREE)]
  });
  const snapshotPin = pin(store);
  const query = { start_uids: [A_ONE], max_returned_edges: 1 };
  const first = store.traverse(snapshotPin, query);
  assert.equal(first.reason, "returned_edges");
  assert.deepEqual(first.edges.map((value) => value.uid), [E_ONE]);
  const second = store.traverse(snapshotPin, { ...query, cursor: first.cursor });
  assert.deepEqual(second.edges.map((value) => value.uid), [E_TWO]);
  assert.equal(second.cursor, null);
  assert.equal(second.exhausted, false);
  assert.throws(() => store.traverse(snapshotPin, { ...query, direction: "in", cursor: first.cursor }), /binding mismatch/);
});

test("visited-node exhaustion leaves the edge and neighbor for exact continuation", () => {
  const store = new GraphStore();
  store.build({
    snapshot_uid: SNAPSHOT_1,
    nodes: [node(A_ONE), node(A_TWO), node(A_THREE)],
    edges: [edge(E_ONE, A_ONE, A_TWO), edge(E_TWO, A_TWO, A_THREE)]
  });
  const snapshotPin = pin(store);
  const query = { start_uids: [A_ONE], max_visited_nodes: 1 };
  const first = store.traverse(snapshotPin, query);
  assert.deepEqual(first.edges, []);
  assert.equal(first.reason, "visited_nodes");
  const second = store.traverse(snapshotPin, { ...query, cursor: first.cursor });
  assert.deepEqual(second.edges.map((value) => value.uid), [E_ONE]);
  assert.equal(second.node_uids.includes(A_TWO), true);
  const third = store.traverse(snapshotPin, { ...query, cursor: second.cursor });
  assert.deepEqual(third.edges.map((value) => value.uid), [E_TWO]);
  assert.equal(third.node_uids.includes(A_THREE), true);
});

test("edge and trace scans stop at configured work and returned-edge bounds", () => {
  const store = new GraphStore();
  store.build({
    snapshot_uid: SNAPSHOT_1,
    nodes: [node(A_ONE), node(A_TWO), node(A_THREE)],
    edges: [edge(E_ONE, A_ONE, A_TWO), edge(E_TWO, A_ONE, A_THREE)]
  });
  const snapshotPin = pin(store);
  const edgePage = store.edges(snapshotPin, { to_uid: A_THREE, max_work_units: 1 });
  assert.equal(edgePage.exhausted, true);
  assert.equal(edgePage.reason, "work_units");
  assert.equal(edgePage.counters.work_units, 1);
  assert.ok(edgePage.cursor);
  const resumed = store.edges(snapshotPin, { to_uid: A_THREE, max_work_units: 1, cursor: edgePage.cursor });
  assert.equal(resumed.items.length, 1);

  const trace = store.trace_matrix(snapshotPin, { max_returned_edges: 1 });
  assert.equal(trace.exhausted, true);
  assert.equal(trace.reason, "returned_edges");
  assert.equal(trace.counters.returned_edges, 1);
  assert.ok(trace.cursor);
  const continued = store.trace_matrix(snapshotPin, { max_returned_edges: 1, cursor: trace.cursor });
  assert.equal(continued.counters.returned_edges, 1);
});

test("canonical graph models and closed endpoint-kind rules reject malformed storage", () => {
  const store = new GraphStore();
  assert.throws(() => store.build({ snapshot_uid: SNAPSHOT_1, nodes: [{ uid: A_ONE }], edges: [] }), /fields must match GraphNode/);
  const requirement = node(`RQ-${"8".repeat(26)}`, "Requirement", "requirement");
  assert.throws(() => store.build({
    snapshot_uid: SNAPSHOT_1, nodes: [node(A_ONE), requirement],
    edges: [edge(E_ONE, A_ONE, requirement.uid, "verifies")]
  }), /endpoint kinds are not admitted/);
});

test("snapshot publication stages immutable objects, applies CAS, and rejects forged pins", () => {
  const root = mkdtempSync(join(tmpdir(), "spipe-graph-snapshot-"));
  try {
    const store = new GraphSnapshotStore({ cacheRoot: root, repositoryId: "repo", worktreeUid: WORKTREE });
    const emptyGraphRoot = graphRoot([], []);
    const emptyGraphObject = { hash: emptyGraphRoot, bytes: canonicalGraphBytes([], []) };
    const firstManifest = snapshotManifest(emptyGraphRoot);
    const replay = {
      delta_hash: `sha256:${"d".repeat(64)}`, base_snapshot_uid: SNAPSHOT_2,
      base_graph_root: `sha256:${"c".repeat(64)}`, output_snapshot_uid: firstManifest.snapshot_uid,
      output_graph_root: firstManifest.graph_root
    };
    const first = store.stage(firstManifest, [emptyGraphObject], { replay_record: replay });
    assert.equal(Object.isFrozen(first), true);
    assert.equal("directory" in first, false);
    assert.throws(() => { first.transaction_id = "attacker"; }, TypeError);
    assert.throws(() => store.abort({ ...first }), /not issued/);
    assert.equal(store.publish(null, first).snapshot_uid, firstManifest.snapshot_uid);
    assert.deepEqual(store.replay(firstManifest.snapshot_uid), replay);
    const snapshotPin = store.pin_current("scope:user", { policy_version: 1 });
    assert.equal(Object.isFrozen(snapshotPin), true);
    assert.throws(() => { snapshotPin.graph_root = `sha256:${"f".repeat(64)}`; }, TypeError);
    assert.equal(store.assert_live_pin(snapshotPin).snapshot_uid, firstManifest.snapshot_uid);
    assert.throws(() => store.assert_live_pin({ ...snapshotPin }), /not issued/);
    store.release(snapshotPin);
    assert.throws(() => store.assert_live_pin(snapshotPin), /not issued|no longer live/);

    const second = store.stage(snapshotManifest(emptyGraphRoot, "d".repeat(64)), []);
    assert.throws(() => store.publish(SNAPSHOT_3, second), /compare-and-swap conflict/);
    store.abort(second);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("snapshot stage canonicalizes graph roots without exposing filesystem authority", () => {
  const root = mkdtempSync(join(tmpdir(), "spipe-graph-capability-"));
  try {
    const store = new GraphSnapshotStore({ cacheRoot: root, repositoryId: "repo", worktreeUid: WORKTREE });
    const rootHash = graphRoot([], []);
    const stage = store.stage(snapshotManifest(rootHash), [{ hash: rootHash, bytes: canonicalGraphBytes([], []) }]);
    assert.equal(stage.graph_root, rootHash);
    assert.equal(store.publish(null, stage).graph_root, rootHash);
    assert.equal(store.current().graph_root, rootHash);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
