import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  ModelValidationError,
  canonicalSnapshotTuple,
  contentHash,
  createProjectionUid,
  createSnapshotId
} from "../../src/model/identity.js";
import { createProjectRecord } from "../../src/model/project.js";
import { createProjectRelationRecord } from "../../src/model/project_relation.js";
import { createArtifactRecord, isDurableArtifact } from "../../src/model/artifact.js";
import { createSectionRecord, formatSectionMarker, parseSectionMarker } from "../../src/model/section.js";
import { createEdgeRecord, isStrictEvidence } from "../../src/model/edge.js";
import { AliasRegistry, createAliasRecord } from "../../src/model/alias.js";
import { createProjectionRecord, createViewRecord, virtualFilename } from "../../src/model/view.js";
import { supportedModelRecordTypes, validateModelRecord } from "../../src/model/schema.js";
import { parseSdnDocument } from "../../src/parser/sdn.js";

const HASH = contentHash("knowledge");
const REVISION = "3b676a1";

function artifact(overrides = {}) {
  return createArtifactRecord({
    uid: "A-01K3R8G3N70ZMT43W6QJ7YHX4P",
    key: "design.search.bm25_core",
    project_uid: "P-01K3R8G3N70ZMT43W6QJ7YHX4P",
    revision: REVISION,
    kind: "design",
    title: "Shared BM25 Search Core",
    canonical_path: "doc/05_design/search/bm25_core.md",
    content_hash: HASH,
    features: ["search", "project_knowledge"],
    components: ["std.common.search"],
    layers: ["ranking", "index"],
    aliases: ["design.db.bm25"],
    ...overrides
  });
}

test("artifact separates UID from mutable key/path and deeply freezes normalized fields", () => {
  const record = artifact({ features: ["project_knowledge", "search"], layers: ["index", "ranking"] });
  assert.equal(record.uid, "A-01K3R8G3N70ZMT43W6QJ7YHX4P");
  assert.equal(record.key, "design.search.bm25_core");
  assert.equal(record.canonical_path, "doc/05_design/search/bm25_core.md");
  assert.deepEqual(record.features, ["project_knowledge", "search"]);
  assert.ok(Object.isFrozen(record));
  assert.ok(Object.isFrozen(record.features));
  assert.equal(isDurableArtifact(record), true);
  assert.throws(() => { record.key = "design.changed"; }, TypeError);
});

test("project relations validate semantic and physical dimensions independently", () => {
  const relation = createProjectRelationRecord({
    relation_uid: "R-01K3R8G3N70ZMT43W6QJ7YHX4P",
    from_project_uid: "P-01K3R8G3N70ZMT43W6QJ7YHX4P",
    to_project_uid: "P-01K3R8G3N70ZMT43W6QJ7YHX4Q",
    semantic: "extends", physical: "gitlink", revision: REVISION,
    version_relation: "pinned", mount: ".spipe/spipe_project", trust: "trusted"
  });
  assert.equal(relation.semantic, "extends");
  assert.equal(relation.physical, "gitlink");
});

test("invalid identity and paths fail with stable model diagnostics", () => {
  assert.throws(() => artifact({ uid: "A-bad uid" }), (error) => {
    assert.ok(error instanceof ModelValidationError);
    assert.equal(error.code, "SPK004");
    return true;
  });
  assert.throws(() => artifact({ canonical_path: "../outside.md" }), /escape the project root/);
  assert.throws(() => artifact({ features: ["search", "search"] }), /must not contain duplicates/);
});

test("provisional identity remains non-durable and cannot masquerade as canonical", () => {
  const provisional = artifact({ uid: "P-P-01K3R8G3N70ZMT43W6QJ7YHX4P-" + "a".repeat(64), identity_status: "provisional" });
  assert.equal(provisional.identity_status, "provisional");
  assert.equal(isDurableArtifact(provisional), false);
  assert.throws(() => artifact({ uid: "A-01K3R8G3N70ZMT43W6QJ7YHX4P", identity_status: "provisional" }), /unknown UID prefix/);
});

test("section marker round-trips and section identity is independent of heading text", () => {
  const marker = formatSectionMarker({ uid: "S-01K3R8G3N70ZMT43W6QJ7YHX4P", key: "design.search.incremental_maintenance" });
  assert.equal(marker, "<!-- spipe:section uid=S-01K3R8G3N70ZMT43W6QJ7YHX4P key=design.search.incremental_maintenance -->");
  assert.deepEqual(parseSectionMarker(marker), {
    uid: "S-01K3R8G3N70ZMT43W6QJ7YHX4P",
    key: "design.search.incremental_maintenance"
  });
  const section = createSectionRecord({
    uid: "S-01K3R8G3N70ZMT43W6QJ7YHX4P",
    artifact_uid: artifact().uid,
    key: "design.search.incremental_maintenance",
    heading: "Incremental Index Maintenance",
    ordinal: 7,
    source_span: { start_byte: 10, end_byte: 80 },
    content_hash: HASH
  });
  assert.equal(section.uid, parseSectionMarker(marker).uid);
  assert.equal(section.ordinal, 7);
});

test("edge model preserves active direction and strict authority rules", () => {
  const edge = createEdgeRecord({
    uid: "E-01K3R8G3N70ZMT43W6QJ7YHX4P",
    edge_type: "verifies",
    from_uid: "T-01K3R8G3N70ZMT43W6QJ7YHX4P",
    to_uid: "A-01K3R8G3N70ZMT43W6QJ7YHX4P",
    origin: "explicit",
    status: "accepted",
    confidence_milli: 1000,
    created_by: "principal:alice",
    created_at_revision: REVISION,
    evidence_uids: ["A-01K3R8G3N70ZMT43W6QJ7YHX4P"]
  });
  assert.equal(edge.from_uid.startsWith("T-"), true);
  assert.equal(edge.to_uid.startsWith("A-"), true);
  assert.equal(isStrictEvidence(edge), false, "schema-v1 edges remain advisory after Wave 3");
  const inferred = createEdgeRecord({ ...edge, uid: "E-01K3R8G3N70ZMT43W6QJ7YHX4Q", origin: "lexical_inference", status: "proposed" });
  assert.equal(isStrictEvidence(inferred), false);
  assert.throws(() => createEdgeRecord({ ...edge, uid: "E-01K3R8G3N70ZMT43W6QJ7YHX4R", to_uid: "P-P-01K3R8G3N70ZMT43W6QJ7YHX4P-" + "b".repeat(64) }), /provisional/);
  assert.throws(() => createEdgeRecord({ ...edge, origin: "generated" }), /generator metadata/);
});

test("aliases reject ambiguity while preserving scoped resolution", () => {
  const target = artifact().uid;
  const registry = new AliasRegistry([
    createAliasRecord({ value: "design.db.bm25", kind: "artifact_key", target_uid: target, project_uid: "P-01K3R8G3N70ZMT43W6QJ7YHX4P" }),
    createAliasRecord({ value: "old-bm25", kind: "heading_slug", target_uid: "S-01K3R8G3N70ZMT43W6QJ7YHX4P" })
  ]);
  assert.equal(registry.resolve("design.db.bm25", "artifact_key", "P-01K3R8G3N70ZMT43W6QJ7YHX4P").target_uid, target);
  assert.equal(registry.resolve("old-bm25", "heading_slug").target_uid, "S-01K3R8G3N70ZMT43W6QJ7YHX4P");
  assert.equal(registry.resolve("design.db.bm25", "artifact_key"), null);
  assert.throws(() => new AliasRegistry([
    { value: "same", kind: "feature", target_uid: "A-01K3R8G3N70ZMT43W6QJ7YHX4P" },
    { value: "same", kind: "feature", target_uid: "A-01K3R8G3N70ZMT43W6QJ7YHX4Q" }
  ]), /ambiguous alias/);
  assert.throws(() => createAliasRecord({ value: "temporary", kind: "artifact_key", target_uid: "P-P-01K3R8G3N70ZMT43W6QJ7YHX4P-" + "a".repeat(64) }), /provisional/);
});

test("snapshot and projection identities are deterministic and distinct", () => {
  const tuple = {
    project_uid: "P-01K3R8G3N70ZMT43W6QJ7YHX4P",
    worktree_uid: "W-01K3R8G3N70ZMT43W6QJ7YHX4P",
    revision_id: REVISION,
    base_generation_hash: HASH,
    overlay_generation_hash: "sha256:" + "0".repeat(64),
    schema_version: "1",
    parser_version: "markdown-1",
    analyzer_version: "analyzer-1",
    provider_contract_version: "provider-1",
    policy_hash: HASH
  };
  const snapshot = createSnapshotId(tuple);
  assert.equal(snapshot, "spks1-1b2057c3b5662b83de4a62cf705488ae8f702c1db590558becd398fac2ae54d7");
  assert.match(snapshot, /^spks1-[a-f0-9]{64}$/);
  assert.equal(createSnapshotId({ ...tuple }), snapshot);
  const projectionTuple = {
    workspace_uid: "W-01K3R8G3N70ZMT43W6QJ7YHX4P",
    snapshot_id: snapshot,
    view_kind: "feature",
    normalized_logical_path: "feature/search",
    normalized_parameters_hash: HASH,
    effective_auth_scope_hash: HASH,
    page_start_key: ""
  };
  const projection = createProjectionUid(projectionTuple);
  assert.match(projection, /^spkp1-[a-f0-9]{64}$/);
  assert.notEqual(projection, snapshot);
  assert.match(canonicalSnapshotTuple(tuple), /overlay_generation_hash: "0{64}"/);
  assert.throws(() => createSnapshotId({ ...tuple, schema_version: "01" }), /schema_version/);
});

test("views and projections are read-only, bounded, and collision-safe", () => {
  const view = createViewRecord({ key: "feature.search", kind: "feature", page_size: 100 });
  assert.equal(view.read_only, true);
  assert.throws(() => createViewRecord({ key: "feature.search", kind: "feature", read_only: false }), /always read-only/);
  assert.equal(virtualFilename("Search", artifact().uid), "search.md");
  assert.equal(virtualFilename("Search", artifact().uid, true), "search--A-01K3R8G3N70ZMT43W6QJ7YHX4P.md");
  const projection = createProjectionRecord({
    workspace_uid: "W-01K3R8G3N70ZMT43W6QJ7YHX4P",
    snapshot_id: "spks1-" + "a".repeat(64),
    view_kind: "feature",
    logical_path: "feature/search",
    entry_kind: "directory",
    parameters_hash: HASH,
    auth_scope_hash: HASH
  });
  assert.equal(projection.canonical_uid, null);
  assert.match(projection.uid, /^spkp1-[a-f0-9]{64}$/);
});

test("every shipped record schema names a runtime validator", () => {
  const files = ["alias", "artifact", "edge", "project", "project_relation", "section", "view"];
  const supported = supportedModelRecordTypes();
  for (const name of files) {
    const parsed = parseSdnDocument(readFileSync(new URL(`../../schema/${name}.schema.sdn`, import.meta.url), "utf8"));
    assert.equal(parsed.diagnostics.length, 0, name);
    assert.equal(parsed.value.record, name);
    assert.ok(supported.includes(name));
  }
  assert.equal(validateModelRecord(artifact()).type, "artifact");
});
