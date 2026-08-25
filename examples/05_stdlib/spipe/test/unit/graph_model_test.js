import assert from "node:assert/strict";
import test from "node:test";

import { contentHash } from "../../src/model/identity.js";
import { createSourceLocation, createVerifiedSourceLocation } from "../../src/model/source_location.js";
import { createRequirementRecord, createSSpecScenarioRecord, createSourceSymbolRecord, createTestRecord } from "../../src/model/trace.js";
import { createClassificationRecord, deriveClassificationUid } from "../../src/model/classification.js";
import { createGraphNode, deriveAliasProjectionUid, deriveMountProjectionUid } from "../../src/model/graph_node.js";
import { EDGE_ENDPOINT_KINDS, createEdgeRecord, deriveEdgeUid, isStrictEvidence, materializeProposedEdge, validateEdgeEndpointKinds } from "../../src/model/edge.js";
import { createIdentityMigrationRecord, deriveMigratedIdentityUid, hashEdgeWrapper, migrateV1Edge } from "../../src/model/migration.js";

const ID = "01K3R8G3N70ZMT43W6QJ7YHX4P";
const P = `P-${ID}`, A = `A-${ID}`, S = `S-${ID}`, RQ = `RQ-${ID}`, NFR = `NFR-${ID}`;
const SS = `SS-${ID}`, SY = `SY-${ID}`, T = `T-${ID}`, E = `E-${ID}`, D = `D-${ID}`;
const SNAP = `spks1-${"a".repeat(64)}`, HASH = contentHash("normalized\nbytes"), REV = "3b676a1";
const location = () => ({ source_artifact_uid: A, source_hash: HASH, span: { start_byte: 0, end_byte: 16 } });

test("Wave 3 trace records enforce closed canonical schemas and normalized locations", () => {
  const requirement = createRequirementRecord({ type: "requirement", uid: RQ, kind: "requirement", key: "req-spkc-003", display_id: "REQ-SPKC-003", project_uid: P, revision_id: REV, artifact_uid: A, section_uid: S, title: "Typed graph snapshots", status: "accepted", content_hash: HASH, aliases: [] });
  const nfr = createRequirementRecord({ ...requirement, type: "non_functional_requirement", uid: NFR, kind: "nfr", key: "nfr-spkc-002", display_id: "NFR-SPKC-002" });
  const scenario = createSSpecScenarioRecord({ type: "sspec_scenario", uid: SS, key: "scenario.typed_graph", project_uid: P, revision_id: REV, artifact_uid: A, title: "builds a graph", ordinal: 0, source_location: location(), content_hash: HASH, requirement_uids: [RQ, NFR], status: "accepted" });
  const symbol = createSourceSymbolRecord({ type: "source_symbol", uid: SY, project_uid: P, revision_id: REV, canonical_path: "src/graph/build.spl", symbol_kind: "function", name: "build", qualified_name: "graph.build", signature_hash: HASH, source_location: location(), content_hash: HASH, annotation_uids: [RQ, SS], status: "accepted" });
  const record = createTestRecord({ type: "test", uid: T, test_kind: "system", project_uid: P, revision_id: REV, artifact_uid: A, scenario_uid: SS, title: "builds a graph", source_location: location(), content_hash: HASH, verifies_uids: [RQ, SS, SY], status: "accepted" });
  assert.equal(requirement.uid, RQ);
  assert.equal(nfr.kind, "nfr");
  assert.deepEqual(scenario.requirement_uids, [NFR, RQ]);
  assert.equal(symbol.source_location.span.end_byte, 16);
  assert.equal(record.test_kind, "system");
  assert.throws(() => createSourceLocation({ ...location(), line: 1 }), /exactly/);
  assert.throws(() => createRequirementRecord({ ...requirement, extra: true }), /exactly/);
});

test("derived identities are deterministic, typed, and domain separated", () => {
  const WS = deriveMigratedIdentityUid(`W-${ID}`, "workspace");
  const WT = deriveMigratedIdentityUid(`W-${ID}`, "worktree");
  assert.match(WS, /^WS-[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.match(WT, /^WT-[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.notEqual(WS, WT);
  const migrated = createIdentityMigrationRecord({ type: "identity_migration", old_uid: `W-${ID}`, old_record_type: "workspace", new_uid: WS, migrated_in_snapshot_uid: SNAP });
  assert.equal(migrated.new_uid, WS);
  const classificationInput = { workspace_uid: WS, project_uid: P, classification_kind: "feature", key: "typed.graph" };
  const classificationUid = deriveClassificationUid(classificationInput);
  assert.equal(createClassificationRecord({ type: "classification", uid: classificationUid, ...classificationInput, source_hash: HASH, status: "active" }).uid, classificationUid);
  assert.match(deriveAliasProjectionUid({ workspace_uid: WS, project_uid: P, kind: "artifact_key", alias: "old", canonical_target_uid: A }), /^AL-/);
  assert.match(deriveMountProjectionUid({ workspace_uid: WS, relation_uid: `R-${ID}`, linkage: "gitlink", mount: ".spipe", canonical_target_uid: P }), /^M-/);
});

test("GraphNode preserves canonical record identity without owning content", () => {
  const node = createGraphNode({ uid: RQ, node_kind: "Requirement", project_uid: P, revision_id: REV, record_type: "requirement", record_hash: HASH, visibility: "project", trust_scope: "reviewed_reference", status: "accepted" });
  assert.equal(node.record_type, "requirement");
  assert.throws(() => createGraphNode({ ...node, node_kind: "SourceSymbol" }), /cannot project/);
  assert.throws(() => createGraphNode({ ...node, extra: 1 }), /exactly/);
});

test("EdgeRecord v2 binds provenance and authority and fails inferred strict evidence closed", () => {
  const WT = deriveMigratedIdentityUid(`W-${ID}`, "worktree");
  const edge = createEdgeRecord({ schema_version: 2, type: "edge", uid: E, edge_type: "verifies", from_uid: T, to_uid: RQ, origin: "explicit", status: "accepted", confidence_milli: 1000, created_by: "principal:alice", created_at_revision: REV, evidence_uids: [A], generator: null,
    provenance: { project_uid: P, worktree_uid: WT, revision_id: REV, input_snapshot_uid: SNAP, source_uid: A, source_location: location(), decision_uid: D },
    authority: { kind: "explicit_review", receipt_uid: D, policy_hash: HASH, policy_version: 1 } });
  assert.equal(isStrictEvidence(edge), false);
  assert.equal(isStrictEvidence(edge, (candidate) => candidate.authority.receipt_uid === D), true);
  assert.throws(() => createEdgeRecord({ ...edge, origin: "lexical_inference", authority: null, provenance: { ...edge.provenance, decision_uid: null } }), /inferred/);
  assert.throws(() => createEdgeRecord({ ...edge, edge_type: "produces" }), /unsupported/);
});

test("schema-v1 migration preserves source history and makes authority advisory", () => {
  const oldW = `W-${ID}`;
  const WT = deriveMigratedIdentityUid(oldW, "worktree");
  const identity = createIdentityMigrationRecord({ type: "identity_migration", old_uid: oldW, old_record_type: "worktree", new_uid: WT, migrated_in_snapshot_uid: SNAP });
  const old = createEdgeRecord({ uid: E, edge_type: "verifies", from_uid: T, to_uid: RQ, origin: "explicit", status: "accepted", confidence_milli: 1000, created_by: "legacy", created_at_revision: REV, evidence_uids: [A] });
  const result = migrateV1Edge({ edge: old, manifest: { snapshot_uid: SNAP, project_uid: P, worktree_uid: oldW, revision_id: REV }, identity_migrations: [identity], endpoint_kinds: { [T]: "SystemTest", [RQ]: "Requirement" } });
  assert.equal(result.edge.schema_version, 2);
  assert.equal(result.edge.provenance.worktree_uid, WT);
  assert.equal(result.edge.authority, null);
  assert.equal(isStrictEvidence(result.edge, () => true), false);
  assert.equal(result.migration.source_edge_hash, hashEdgeWrapper(old, 1));
  const deferred = migrateV1Edge({ edge: createEdgeRecord({ ...old, edge_type: "produces" }), manifest: { snapshot_uid: SNAP, project_uid: P, worktree_uid: oldW, revision_id: REV }, identity_migrations: [identity], endpoint_kinds: { [T]: "SystemTest", [RQ]: "Requirement" } });
  assert.equal(deferred.historical.reason, "deferred_edge_type");
});

test("candidate materializer derives occurrence identity and preserves explicit marker identity", () => {
  const WT = deriveMigratedIdentityUid(`W-${ID}`, "worktree");
  const candidate = { edge_type: "specifies", from_uid: SS, target_ref: RQ, origin: "explicit", status: "proposed", confidence_milli: 1000,
    created_by: "parser:spipe-wave3", created_at_revision: REV, evidence_uids: [A], generator: null,
    provenance: { project_uid: P, worktree_uid: WT, revision_id: REV, input_snapshot_uid: SNAP, source_uid: A, source_location: location(), decision_uid: null }, authority: null };
  const first = materializeProposedEdge(candidate);
  const second = materializeProposedEdge({ ...candidate });
  assert.match(first.uid, /^E-[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.equal(first.uid, second.uid);
  assert.equal(first.uid, deriveEdgeUid({ input_snapshot_uid: SNAP, source_location: location(), edge_type: "specifies", from_uid: SS, to_uid: RQ, origin: "explicit", provenance: candidate.provenance }));
  assert.notEqual(first.uid, materializeProposedEdge({ ...candidate, provenance: { ...candidate.provenance, source_location: { ...location(), span: { start_byte: 1, end_byte: 16 } } } }).uid);
  assert.equal(materializeProposedEdge(candidate, { explicit_uid: E }).uid, E);
  assert.throws(() => materializeProposedEdge({ ...candidate, provenance: { ...candidate.provenance, input_snapshot_uid: null } }), /snapshot UID/);
});

test("closed endpoint-kind contract is reusable and v1 evidence is always advisory", () => {
  assert.ok(Object.isFrozen(EDGE_ENDPOINT_KINDS));
  assert.equal(validateEdgeEndpointKinds("verifies", "SystemTest", "Requirement"), true);
  assert.equal(validateEdgeEndpointKinds("classifies", "Artifact", "Feature"), true);
  assert.equal(validateEdgeEndpointKinds("supersedes", "Requirement", "Requirement"), true);
  assert.throws(() => validateEdgeEndpointKinds("verifies", "Artifact", "Requirement"), /unsupported endpoint/);
  assert.throws(() => validateEdgeEndpointKinds("supersedes", "Requirement", "Artifact"), /unsupported endpoint/);
  const legacy = createEdgeRecord({ uid: E, edge_type: "links_to", from_uid: A, to_uid: S, origin: "explicit", status: "accepted", confidence_milli: 1000, created_by: "legacy", created_at_revision: REV, evidence_uids: [] });
  assert.equal(isStrictEvidence(legacy, () => true), false);
});

test("v1 migration historicalizes endpoint-kind violations", () => {
  const oldW = `W-${ID}`;
  const WT = deriveMigratedIdentityUid(oldW, "worktree");
  const identity = createIdentityMigrationRecord({ type: "identity_migration", old_uid: oldW, old_record_type: "worktree", new_uid: WT, migrated_in_snapshot_uid: SNAP });
  const legacy = createEdgeRecord({ uid: E, edge_type: "verifies", from_uid: A, to_uid: RQ, origin: "explicit", status: "accepted", confidence_milli: 1000, created_by: "legacy", created_at_revision: REV, evidence_uids: [] });
  const result = migrateV1Edge({ edge: legacy, manifest: { snapshot_uid: SNAP, project_uid: P, worktree_uid: oldW, revision_id: REV }, identity_migrations: [identity], endpoint_kinds: { [A]: "Artifact", [RQ]: "Requirement" } });
  assert.equal(result.edge, null);
  assert.equal(result.historical.reason, "unsupported_endpoint_kind");
});

test("verified source locations bind normalized hash and UTF-8 code-point boundaries", () => {
  const bytes = Buffer.from("a💡b\n", "utf8");
  const source_hash = contentHash(bytes);
  const valid = { source_artifact_uid: A, source_hash, span: { start_byte: 1, end_byte: 5 } };
  assert.equal(createVerifiedSourceLocation(valid, bytes).span.end_byte, 5);
  assert.throws(() => createVerifiedSourceLocation({ ...valid, span: { start_byte: 2, end_byte: 5 } }, bytes), /code-point boundaries/);
  assert.throws(() => createVerifiedSourceLocation({ ...valid, source_hash: HASH }, bytes), /does not match/);
  assert.throws(() => createVerifiedSourceLocation({ ...valid, span: { start_byte: 1, end_byte: 99 } }, bytes), /exceeds/);
  assert.throws(() => createVerifiedSourceLocation({ ...valid, source_hash: contentHash("a\r\n") }, Buffer.from("a\r\n")), /normalized-newline/);
});
