import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { GraphSnapshotStore, validateGraphSnapshotManifest } from "../../src/storage/graph_snapshot_store.js";
import { createSnapshotMetadata } from "../../src/storage/snapshot_store.js";
import { canonicalGraphBytes, graphRoot } from "../../src/graph/index.js";

const ID = "01K3R8G3N70ZMT43W6QJ7YHX4P";
const P = `P-${ID}`, W = `W-${ID}`, WT = `WT-${ID}`;
const HASH = "a".repeat(64);

function manifest(worktree_uid = W, schema_version = 1) {
  return createSnapshotMetadata({ project_uid: P, worktree_uid, revision_id: "rev-1", base_generation_hash: HASH,
    overlay_generation_hash: "b".repeat(64), schema_version, parser_version: "wave3-1", analyzer_version: "none-1",
    provider_contract_version: "none-1", policy_hash: "c".repeat(64), base_segments: [], graph_root: graphRoot([], []) });
}

test("graph snapshot boundary admits only canonical closed manifests and typed worktrees", () => {
  const legacy = manifest();
  const wave3 = manifest(WT, 2);
  assert.deepEqual(validateGraphSnapshotManifest(legacy, W), legacy);
  assert.deepEqual(validateGraphSnapshotManifest(wave3, WT), wave3);
  assert.throws(() => validateGraphSnapshotManifest({ ...legacy, extra: true }, W), /closed graph snapshot schema/);
  assert.throws(() => validateGraphSnapshotManifest({ ...legacy, snapshot_uid: `spks1-${"0".repeat(64)}` }, W), /snapshot_uid does not match|SnapshotUid/);
  assert.throws(() => validateGraphSnapshotManifest({ ...legacy, worktree_uid: WT }, W), /schema|worktree/);
  assert.throws(() => new GraphSnapshotStore({ cacheRoot: tmpdir(), repositoryId: "repo", worktreeUid: "WT-ONE" }), /opaque|UID/);
});

test("stage rejects foreign/open manifests before publication", () => {
  const root = mkdtempSync(join(tmpdir(), "spipe-graph-boundary-"));
  try {
    const store = new GraphSnapshotStore({ cacheRoot: root, repositoryId: "repo", worktreeUid: WT });
    const valid = manifest(WT, 2);
    assert.throws(() => store.stage({ snapshot_uid: valid.snapshot_uid, graph_root: valid.graph_root }), /closed graph snapshot schema/);
    assert.throws(() => store.stage({ ...valid, worktree_uid: W }), /worktree|schema/);
    const stage = store.stage(valid, [{ hash: valid.graph_root, bytes: canonicalGraphBytes([], []) }]);
    assert.equal(stage.snapshot_uid, valid.snapshot_uid);
    store.abort(stage);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
