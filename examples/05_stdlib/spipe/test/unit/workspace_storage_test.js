import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalJson, ZERO_HASH } from "../../src/storage/canonical.js";
import { ContentAddressedObjectStore } from "../../src/storage/object_store.js";
import { WorktreeOverlayStore } from "../../src/storage/overlay_store.js";
import { ImmutableSnapshotStore, createSnapshotMetadata, computeSnapshotId } from "../../src/storage/snapshot_store.js";
import { createProjectRelation } from "../../src/workspace/linked_project.js";
import { normalizeRelativePath } from "../../src/workspace/paths.js";
import { WorkspaceRegistry } from "../../src/workspace/registry.js";
import { createWorktreeRecord, deriveWorktreeUid } from "../../src/workspace/worktree.js";

const PROJECT_ONE = "P-000000000000000000000000000000A1";
const PROJECT_TWO = "P-000000000000000000000000000000A2";
const WORKTREE_ONE = "W-000000000000000000000000000000B1";
const WORKTREE_TWO = "W-000000000000000000000000000000B2";

function tempRoot() {
  return mkdtempSync(join(tmpdir(), "spipe-workspace-storage-"));
}

function snapshotInput(overrides = {}) {
  return {
    project_uid: PROJECT_ONE,
    worktree_uid: WORKTREE_ONE,
    revision_id: "abc123",
    base_generation_hash: "1".repeat(64),
    overlay_generation_hash: ZERO_HASH,
    schema_version: 1,
    parser_version: "markdown@1",
    analyzer_version: "analyzer@1",
    provider_contract_version: "provider@1",
    policy_hash: "2".repeat(64),
    ...overrides
  };
}

test("project relations keep semantic dependency separate from physical linkage", () => {
  const relation = createProjectRelation({
    from_project_uid: PROJECT_ONE,
    to_project_uid: PROJECT_TWO,
    semantic: "extends",
    physical: "gitlink",
    revision: "abc123",
    version_relation: "pinned",
    mount: ".spipe/spipe_project",
    trust: "trusted"
  });
  assert.equal(relation.semantic, "extends");
  assert.equal(relation.physical, "gitlink");
  assert.equal(relation.trust, "trusted");
  assert.notEqual(relation.semantic, relation.physical);
  assert.throws(() => createProjectRelation({
    from_project_uid: PROJECT_ONE, to_project_uid: PROJECT_TWO, mount: "../escape", semantic: "extends", physical: "path"
  }), /escape the project root/);
});

test("registry round-trips projects, explicit relations, and worktree identity", () => {
  const root = tempRoot();
  try {
    const registry = new WorkspaceRegistry({ root, resolutionAuthorizer: () => true });
    mkdirSync(join(root, ".spipe"));
    const spipe = registry.registerProject({ key: "spipe", root: join(root, ".spipe"), revision: "abc123" });
    const simple = registry.registerProject({ key: "simple", root, revision: "abc123" });
    const relation = registry.registerRelation({
      from_project_uid: simple.uid,
      to_project_uid: spipe.uid,
      semantic: "extends",
      physical: "path",
      mount: ".spipe",
      revision: "abc123",
      trust: "trusted"
    });
    const worktree = registry.registerWorktree({
      project_uid: simple.uid,
      root,
      git_common_dir: join(root, ".git-common"),
      git_dir: join(root, ".git-worktree"),
      revision_id: "git:abc"
    });
    assert.match(worktree.worktree_uid, /^W-[0-9A-F]{32}$/);
    assert.equal(registry.relationsFrom(simple.uid).length, 1);
    assert.equal(registry.resolveLinkedProject(relation.relation_uid, { expectedRevision: "abc123" }).status, "resolved");
    assert.equal(registry.resolveLinkedProject(relation.relation_uid, { expectedRevision: "wrong" }).diagnostic.code, "SPK103");
    assert.equal(registry.worktreesFor(simple.uid)[0].worktree_uid, worktree.worktree_uid);
    const restored = WorkspaceRegistry.fromRecord(JSON.parse(registry.toJSON()));
    assert.equal(restored.toJSON(), registry.toJSON());
    const denied = restored.resolveLinkedProject(relation.relation_uid);
    assert.equal(denied.diagnostic.message_key, "linked_project.authorization_denied");
    assert.deepEqual(denied.diagnostic.details, { relation_uid: relation.relation_uid });
    const deniedMissing = restored.resolveLinkedProject("R-000000000000000000000000000000FF");
    assert.equal(deniedMissing.diagnostic.message_key, denied.diagnostic.message_key);
    assert.deepEqual(Object.keys(deniedMissing.diagnostic.details), Object.keys(denied.diagnostic.details));
    const outside = registry.registerProject({ key: "outside", root: join(root, "..", "outside"), revision: "abc123" });
    assert.equal(outside.root_path, ".");
    assert.throws(() => registry.save("../outside.sdn"), /dot and dot-dot/);
    assert.throws(() => registry.save(".spipe/projects.sdn"), /SafeRegistryPersistencePort unavailable/);
    const alternate = registry.registerRelation({
      from_project_uid: simple.uid, to_project_uid: outside.uid,
      semantic: "dependent", physical: "none", trust: "reviewed"
    });
    assert.throws(() => registry.registerRelation({
      relation_uid: relation.relation_uid, from_project_uid: alternate.from_project_uid,
      to_project_uid: alternate.to_project_uid, semantic: alternate.semantic,
      physical: alternate.physical, trust: alternate.trust
    }), /already names a different relation/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("registry persistence is delegated to a bounded owner port", () => {
  const root = tempRoot();
  try {
    let request = null;
    const port = {
      bytes: null,
      writeRegistry(value) { request = value; this.bytes = value.bytes; return "stored"; },
      readRegistry() { return this.bytes; },
      authorizeProjectRoot() { return true; },
      authorizeLinkedProject() { return true; }
    };
    const registry = new WorkspaceRegistry({
      root,
      persistencePort: port
    });
    registry.registerProject({ key: "spipe", root, revision: "abc123" });
    assert.equal(registry.save(".spipe/projects.sdn"), "stored");
    assert.equal(request.workspace_root, root);
    assert.equal(request.relative_path, ".spipe/projects.sdn");
    assert.match(request.bytes.toString("utf8"), /"projects"/);
    const loaded = WorkspaceRegistry.load({ workspaceRoot: root, relativePath: ".spipe/projects.sdn", persistencePort: port });
    assert.equal(loaded.toJSON(), registry.toJSON());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("worktree UID is opaque and explicit identity remains stable", () => {
  const first = deriveWorktreeUid({ projectUid: PROJECT_ONE, gitCommonDir: "/repo/.git", gitDir: "/repo/.git/worktrees/a" });
  const second = deriveWorktreeUid({ projectUid: PROJECT_ONE, gitCommonDir: "/repo/.git", gitDir: "/repo/.git/worktrees/b" });
  assert.notEqual(first, second);
  assert.match(first, /^W-[0-9A-F]{32}$/);
  const record = createWorktreeRecord({ project_uid: PROJECT_ONE, root: "/repo", worktree_uid: WORKTREE_ONE });
  assert.equal(record.cache_namespace, WORKTREE_ONE);
});

test("canonical relative paths reject traversal and alternate separators", () => {
  assert.equal(normalizeRelativePath("doc/05_design/search.md"), "doc/05_design/search.md");
  assert.throws(() => normalizeRelativePath("../outside"), /dot and dot-dot/);
  assert.throws(() => normalizeRelativePath("doc\\outside"), /backslash/);
  assert.throws(() => normalizeRelativePath("/absolute"), /absolute/);
});

test("content-addressed object store deduplicates and verifies immutable bytes", () => {
  const root = tempRoot();
  try {
    const store = new ContentAddressedObjectStore({ root });
    const first = store.putText("same bytes");
    const second = store.putText("same bytes");
    assert.equal(first.hash, second.hash);
    assert.equal(second.existed, true);
    assert.equal(store.get(first.hash).toString(), "same bytes");
    assert.equal(store.verify(first.hash), true);
    assert.equal(store.stat(first.hash).size, 10);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("dirty overlays are isolated by worktree and reload from their own manifest", () => {
  const root = tempRoot();
  try {
    const one = new WorktreeOverlayStore({ cacheRoot: root, worktreeUid: WORKTREE_ONE });
    const two = new WorktreeOverlayStore({ cacheRoot: root, worktreeUid: WORKTREE_TWO });
    assert.equal(one.snapshot().overlay_generation_hash, ZERO_HASH);
    one.set("doc/state.md", "one");
    two.set("doc/state.md", "two");
    assert.equal(one.read("doc/state.md").toString(), "one");
    assert.equal(two.read("doc/state.md").toString(), "two");
    assert.notEqual(one.snapshot().overlay_generation_hash, two.snapshot().overlay_generation_hash);
    const reloaded = new WorktreeOverlayStore({ cacheRoot: root, worktreeUid: WORKTREE_ONE });
    assert.equal(reloaded.read("doc/state.md").toString(), "one");
    two.delete("doc/state.md");
    assert.equal(two.read("doc/state.md"), null);
    assert.equal(one.read("doc/state.md").toString(), "one");
    assert.notEqual(readFileSync(join(root, "worktrees", WORKTREE_ONE, "current.sdn"), "utf8"), readFileSync(join(root, "worktrees", WORKTREE_TWO, "current.sdn"), "utf8"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("snapshot identity is deterministic, worktree-bound, and immutable", () => {
  const first = createSnapshotMetadata(snapshotInput({ base_segments: ["sha256:" + "b".repeat(64), "sha256:" + "a".repeat(64)] }));
  const reordered = createSnapshotMetadata(snapshotInput({ base_segments: ["sha256:" + "a".repeat(64), "sha256:" + "b".repeat(64)] }));
  const otherWorktree = createSnapshotMetadata(snapshotInput({ worktree_uid: WORKTREE_TWO }));
  assert.equal(first.snapshot_uid, reordered.snapshot_uid);
  assert.match(first.snapshot_uid, /^spks1-[a-f0-9]{64}$/);
  assert.notEqual(first.snapshot_uid, otherWorktree.snapshot_uid);
  assert.equal(computeSnapshotId(snapshotInput()), createSnapshotMetadata(snapshotInput()).snapshot_uid);
  const root = tempRoot();
  try {
    const store = new ImmutableSnapshotStore({ cacheRoot: root, repositoryId: "repo" });
    const saved = store.put(first);
    assert.equal(store.read(saved.snapshot_uid).snapshot_uid, saved.snapshot_uid);
    assert.throws(() => store.put({ ...first, policy_hash: "3".repeat(64), snapshot_uid: first.snapshot_uid }), /does not match/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("canonical metadata serialization is stable across key insertion order", () => {
  assert.equal(canonicalJson({ z: 1, a: { d: 4, c: 3 } }), canonicalJson({ a: { c: 3, d: 4 }, z: 1 }));
});
