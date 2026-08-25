import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalGraphBytes, graphRoot } from "../../src/graph/index.js";
import { GraphSnapshotStore } from "../../src/storage/graph_snapshot_store.js";
import { createSnapshotMetadata } from "../../src/storage/snapshot_store.js";

const ID = "01K3R8G3N70ZMT43W6QJ7YHX4P";
const PROJECT = `P-${ID}`;
const WORKTREE = `WT-${ID}`;

function manifest(root) {
  return createSnapshotMetadata({
    project_uid: PROJECT, worktree_uid: WORKTREE, revision_id: "rev-restart",
    base_generation_hash: "a".repeat(64), overlay_generation_hash: "b".repeat(64),
    schema_version: 2, parser_version: "wave3-1", analyzer_version: "none-1",
    provider_contract_version: "none-1", policy_hash: "c".repeat(64),
    base_segments: [], graph_root: root
  });
}

test("published canonical graph is recovered and verified after store restart", () => {
  const cacheRoot = mkdtempSync(join(tmpdir(), "spipe-graph-restart-"));
  try {
    const bytes = canonicalGraphBytes([], []);
    const root = graphRoot([], []);
    const first = new GraphSnapshotStore({ cacheRoot, repositoryId: "repo", worktreeUid: WORKTREE });
    const record = manifest(root);
    first.publish(null, first.stage(record, [{ hash: root, bytes }]));

    const restarted = new GraphSnapshotStore({ cacheRoot, repositoryId: "repo", worktreeUid: WORKTREE });
    assert.deepEqual(restarted.read_graph(), { schema: 1, nodes: [], edges: [] });
    assert.deepEqual(restarted.read_graph(record.snapshot_uid), { schema: 1, nodes: [], edges: [] });

    writeFileSync(join(restarted.object_root, root.slice(7)), "corrupt");
    assert.throws(() => restarted.read_graph(), /graph object|JSON|SPK803/);
  } finally { rmSync(cacheRoot, { recursive: true, force: true }); }
});

test("stage rejects missing, schema-less, and root-mismatched graph bytes", () => {
  const cacheRoot = mkdtempSync(join(tmpdir(), "spipe-graph-coherence-"));
  try {
    const store = new GraphSnapshotStore({ cacheRoot, repositoryId: "repo", worktreeUid: WORKTREE });
    const root = graphRoot([], []);
    assert.throws(() => store.stage(manifest(root)), /must reference a staged or existing graph object/);
    assert.throws(() => store.stage(manifest(root), [{ hash: root, bytes: Buffer.from('{"edges":[],"nodes":[]}') }]), /hash mismatch|SPK803/);
    const other = graphRoot([], []);
    assert.throws(() => store.stage(manifest(`sha256:${"f".repeat(64)}`), [{ bytes: canonicalGraphBytes([], []) }]), /must reference|graph_root/);
    assert.equal(other, root);
  } finally { rmSync(cacheRoot, { recursive: true, force: true }); }
});
