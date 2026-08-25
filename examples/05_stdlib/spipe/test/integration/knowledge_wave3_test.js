import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  canonicalGraphBytes, graphRoot, GraphStore, createGraphDelta, graphRecordHash
} from "../../src/graph/index.js";
import { GraphSnapshotStore } from "../../src/storage/graph_snapshot_store.js";
import { createSnapshotMetadata } from "../../src/storage/snapshot_store.js";
import {
  createIdentityMigrationRecord, deriveMigratedIdentityUid, migrateV1Edge
} from "../../src/model/migration.js";
import { createSourceLocation } from "../../src/model/source_location.js";
import { createGraphNode } from "../../src/model/graph_node.js";
import { createEdgeRecord, isStrictEvidence } from "../../src/model/edge.js";
import { KnowledgeCompiler, compileKnowledgeDelta, compileKnowledgeInventory } from "../../src/core/knowledge_compiler.js";
import { createAuthorizationPort, signEdgeAcceptanceReceipt } from "../../src/core/authorization.js";
import { canonicalJson } from "../../src/storage/canonical.js";
import {
  extractTraceRecords
} from "../../src/extract/index.js";
import { parseMarkdownArtifact, parseSourceMetadata, parseSspecMetadata } from "../../src/parser/index.js";
import {
  buildTraceMatrix, diagnoseTrace, projectMirroredSpecDiagnostics
} from "../../src/diagnostics/index.js";

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixture/wave3_graph");
const uid = (prefix, digit) => `${prefix}-${String(digit).repeat(26)}`;
const hash = (digit) => `sha256:${String(digit).repeat(64)}`;
const snapshot = (digit) => `spks1-${String(digit).repeat(64)}`;
const canonicalHash = (value) => createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");

const U = Object.freeze({
  project: uid("P", 1), workspaceV1: `W-${"1".repeat(32)}`,
  artifact: uid("A", 1), requirement: uid("RQ", 1), design: uid("A", 2),
  scenario: uid("SS", 1), symbol: uid("SY", 1), unit: uid("T", 1),
  integration: uid("T", 2)
});

function storageManifest(digit, graphRoot = hash(digit)) {
  return createSnapshotMetadata({ project_uid: U.project, worktree_uid: U.workspaceV1,
    revision_id: `rev-${digit}`, base_generation_hash: hash(digit), overlay_generation_hash: hash("0"),
    schema_version: 1, parser_version: "wave3-test", analyzer_version: "none-1",
    provider_contract_version: "none-1", policy_hash: hash("9"), graph_root: graphRoot });
}

function storedGraph(nodes = [], edges = []) {
  const root = graphRoot(nodes, edges);
  return { root, objects: [{ hash: root, bytes: canonicalGraphBytes(nodes, edges) }] };
}

function node(uidValue, nodeKind = "Artifact") {
  const recordType = {
    Artifact: "artifact", Section: "section", Requirement: "requirement",
    NonFunctionalRequirement: "non_functional_requirement", SSpecScenario: "sspec_scenario",
    SourceSymbol: "source_symbol", UnitTest: "test", IntegrationTest: "test", SystemTest: "test"
  }[nodeKind];
  return createGraphNode({ uid: uidValue, node_kind: nodeKind, project_uid: U.project,
    revision_id: "rev-1", record_type: recordType, record_hash: hash("a"),
    visibility: "project", trust_scope: "untrusted_data", status: nodeKind === "Artifact" ? "approved" : "accepted" });
}

function edge(edgeUid, from, to, edgeType, extra = {}) {
  return Object.freeze({
    schema_version: 2, type: "edge", uid: edgeUid, edge_type: edgeType,
    from_uid: from, to_uid: to, origin: "explicit", status: "accepted",
    confidence_milli: 1000, created_by: "principal:test", created_at_revision: "rev-1",
    evidence_uids: [], generator: null,
    provenance: {
      project_uid: U.project, worktree_uid: deriveMigratedIdentityUid(U.workspaceV1, "worktree"),
      revision_id: "rev-1", input_snapshot_uid: snapshot("1"), source_uid: null,
      source_location: null, decision_uid: null
    }, authority: null, ...extra
  });
}

test("clean build and incremental graph application converge on one graph root", () => {
  const baseNodes = [node(U.requirement, "Requirement"), node(U.design)];
  const baseEdge = edge(uid("E", 1), U.design, U.requirement, "satisfies");
  const addedNode = node(U.scenario, "SSpecScenario");
  const addedEdge = edge(uid("E", 2), U.scenario, U.requirement, "specifies");
  const cleanStore = new GraphStore();
  const clean = cleanStore.build({ snapshot_uid: snapshot("2"), nodes: [addedNode, ...baseNodes].reverse(), edges: [addedEdge, baseEdge].reverse() });

  const incrementalStore = new GraphStore();
  const base = incrementalStore.build({ snapshot_uid: snapshot("1"), nodes: baseNodes, edges: [baseEdge] });
  const delta = createGraphDelta({
    base_snapshot_uid: base.snapshot_uid, base_graph_root: base.graph_root,
    nodes: { added: [addedNode], updated: [], removed: [] },
    edges: { added: [addedEdge], updated: [], removed: [] }
  });
  const receipt = incrementalStore.apply({ delta, output_snapshot_uid: snapshot("2") });
  assert.equal(receipt.status, "applied");
  assert.equal(receipt.output_graph_root, clean.graph_root);
  assert.equal(incrementalStore.apply({ delta, output_snapshot_uid: snapshot("2") }).status, "already_applied");
});

test("typed multigraph preserves parallel edges and complete provenance", () => {
  const nodes = [node(U.design), node(U.requirement, "Requirement")];
  const first = edge(uid("E", 1), U.design, U.requirement, "satisfies", {
    provenance: { ...edge(uid("E", 8), U.design, U.requirement, "satisfies").provenance, source_uid: uid("S", 1) }
  });
  const second = edge(uid("E", 2), U.design, U.requirement, "satisfies", {
    provenance: { ...first.provenance, source_uid: uid("S", 2) }, evidence_uids: [uid("A", 9)]
  });
  const store = new GraphStore();
  store.build({ snapshot_uid: snapshot("1"), nodes, edges: [second, first] });
  const pin = store.pin(snapshot("1"), { scope_digest: hash("b"), policy_version: 1 });
  const page = store.edges(pin, { from_uid: U.design, edge_type: "satisfies" });
  assert.deepEqual(page.items.map(({ uid: value }) => value), [first.uid, second.uid]);
  assert.deepEqual(page.items.map(({ provenance }) => provenance.source_uid), [uid("S", 1), uid("S", 2)]);
  assert.equal(store.edges(pin, { to_uid: U.requirement }).items.length, 2);
  assert.equal(store.edges(pin, { from_uid: U.requirement }).items.length, 0, "inverse edges are query behavior, not stored duplicates");
});

test("graph deltas enforce before hashes, CAS bases, and immutable edge identity", () => {
  const original = edge(uid("E", 1), U.design, U.requirement, "satisfies");
  const store = new GraphStore();
  const base = store.build({ snapshot_uid: snapshot("1"), nodes: [node(U.design), node(U.requirement, "Requirement")], edges: [original] });
  const changedEndpoint = { ...original, from_uid: U.requirement, to_uid: U.design };
  const invalid = createGraphDelta({ base_snapshot_uid: base.snapshot_uid, base_graph_root: base.graph_root,
    nodes: {}, edges: { updated: [{ before_hash: graphRecordHash(original), edge: changedEndpoint }] } });
  assert.throws(() => store.apply({ delta: invalid, output_snapshot_uid: snapshot("2") }), /remove-plus-add/);
  const stale = createGraphDelta({ ...invalid, base_graph_root: hash("f"), edges: {} });
  assert.throws(() => store.apply({ delta: stale, output_snapshot_uid: snapshot("2") }), (error) => error.code === "SPK902");
});

test("W identity migration is deterministic and typed", () => {
  const workspace = deriveMigratedIdentityUid(U.workspaceV1, "workspace");
  const worktree = deriveMigratedIdentityUid(U.workspaceV1, "worktree");
  assert.match(workspace, /^WS-[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.match(worktree, /^WT-[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.notEqual(workspace, worktree);
  assert.equal(deriveMigratedIdentityUid(U.workspaceV1, "workspace"), workspace);
  assert.throws(() => createIdentityMigrationRecord({ type: "identity_migration", old_uid: U.workspaceV1,
    old_record_type: "workspace", new_uid: worktree, migrated_in_snapshot_uid: snapshot("2") }), /(?:derivation|unknown UID prefix)/);
});

test("legacy edges migrate only when identity and endpoint kinds are total", () => {
  const workspaceUid = deriveMigratedIdentityUid(U.workspaceV1, "workspace");
  const mapping = createIdentityMigrationRecord({ type: "identity_migration", old_uid: U.workspaceV1,
    old_record_type: "workspace", new_uid: workspaceUid, migrated_in_snapshot_uid: snapshot("2") });
  const worktreeMapping = createIdentityMigrationRecord({ type: "identity_migration", old_uid: U.workspaceV1,
    old_record_type: "worktree", new_uid: deriveMigratedIdentityUid(U.workspaceV1, "worktree"), migrated_in_snapshot_uid: snapshot("2") });
  const legacy = { type: "edge", uid: uid("E", 3), edge_type: "contains", from_uid: U.workspaceV1,
    to_uid: U.artifact, origin: "explicit", status: "accepted", confidence_milli: 1000,
    created_by: "legacy", created_at_revision: "rev-1", evidence_uids: [], generator: null };
  const migrationContext = {
    manifest: { schema: 1, snapshot_uid: snapshot("1"), project_uid: U.project,
      worktree_uid: U.workspaceV1, revision_id: "rev-1" }, identity_migrations: [mapping, worktreeMapping],
    endpoint_kinds: { [U.workspaceV1]: "Workspace", [U.artifact]: "Artifact" }
  };
  const migrated = migrateV1Edge({ edge: legacy, ...migrationContext });
  assert.equal(migrated.historical, null);
  assert.equal(migrated.edge.from_uid, workspaceUid);
  assert.equal(migrated.edge.authority, null, "legacy accepted evidence does not gain Wave 3 authority");
  const deferred = migrateV1Edge({ edge: { ...legacy, uid: uid("E", 4), edge_type: "produces" }, ...migrationContext });
  assert.equal(deferred.edge, null);
  assert.equal(deferred.historical.reason, "deferred_edge_type");
});

test("source locations use normalized-byte offsets across CRLF and non-BMP text", () => {
  const normalized = Buffer.from("a\n💡z\n", "utf8");
  const ownerHash = `sha256:${createHash("sha256").update(normalized).digest("hex")}`;
  const location = createSourceLocation({ source_artifact_uid: U.artifact, source_hash: ownerHash,
    span: { start_byte: 2, end_byte: 6 } });
  assert.deepEqual(location.span, { start_byte: 2, end_byte: 6 });
  assert.throws(() => createSourceLocation({ source_artifact_uid: U.artifact, source_hash: ownerHash,
    span: { start_byte: 6, end_byte: 2 } }), /precede/);
});

test("graph traversal budgets and authenticated cursors fail closed", () => {
  const nodes = [node(uid("A", 1)), node(uid("A", 2)), node(uid("A", 3))];
  const edges = [edge(uid("E", 1), nodes[0].uid, nodes[1].uid, "links_to"), edge(uid("E", 2), nodes[1].uid, nodes[2].uid, "links_to")];
  const store = new GraphStore();
  store.build({ snapshot_uid: snapshot("1"), nodes, edges });
  const pin = store.pin(snapshot("1"), { scope_digest: hash("c"), policy_version: 1 });
  const partial = store.traverse(pin, { start_uids: [nodes[0].uid], max_visited_nodes: 1 });
  assert.equal(partial.exhausted, true);
  assert.equal(partial.reason, "visited_nodes");
  const page = store.edges(pin, { limit: 1 });
  assert.ok(page.cursor);
  assert.throws(() => store.edges(pin, { limit: 1, cursor: `${page.cursor}x` }), (error) => error.code === "SPK704");
  const other = new GraphStore();
  other.build({ snapshot_uid: snapshot("1"), nodes, edges });
  assert.throws(() => other.node(pin, nodes[0].uid), (error) => error.code === "SPK704");
  store.release(pin);
  assert.throws(() => store.node(pin, nodes[0].uid), (error) => error.code === "SPK704");
});

test("snapshot publication is compare-and-swap and pins cannot be forged", () => {
  const cacheRoot = mkdtempSync(join(tmpdir(), "spipe-wave3-"));
  try {
    const store = new GraphSnapshotStore({ cacheRoot, repositoryId: "repo", worktreeUid: U.workspaceV1 });
    const firstGraph = storedGraph();
    const first = storageManifest("1", firstGraph.root);
    store.publish(null, store.stage(first, firstGraph.objects));
    const pin = store.pin_current(hash("d"), { policy_version: 1 });
    assert.equal(store.assert_live_pin(pin).snapshot_uid, first.snapshot_uid);
    const secondGraph = storedGraph();
    const secondStage = store.stage(storageManifest("2", secondGraph.root), secondGraph.objects);
    assert.throws(() => store.publish(snapshot("9"), secondStage), (error) => error.code === "SPK901");
    store.abort(secondStage);
    assert.throws(() => store.assert_live_pin({ ...pin }), (error) => error.code === "SPK704");
    store.release(pin);
    assert.throws(() => store.assert_live_pin(pin), (error) => error.code === "SPK704");
  } finally { rmSync(cacheRoot, { recursive: true, force: true }); }
});

test("marker blocks use normalized bytes and source ownership failures are excluded", () => {
  const requirements = readFileSync(join(fixtureRoot, "complete/requirements.md"), "utf8").replaceAll("\n", "\r\n");
  const requirementInput = { path: "doc/02_requirements/requirements.md", content: requirements };
  const scenarioInput = { path: "test/03_system/scenarios.spl", content: readFileSync(join(fixtureRoot, "complete/scenarios.spl"), "utf8") };
  const sourceInput = { path: "src/source.spl", content: readFileSync(join(fixtureRoot, "complete/source.spl"), "utf8") };
  const markdown = parseMarkdownArtifact(requirementInput, { projectUid: U.project, revision: "rev-1" });
  const sspec = parseSspecMetadata(scenarioInput, { projectUid: U.project, revision: "rev-1" });
  const parsedSource = parseSourceMetadata(sourceInput, { projectUid: U.project, revision: "rev-1" });
  const sourceArtifact = {
    uid: uid("A", 4), project_uid: U.project, revision: "rev-1",
    canonical_path: sourceInput.path, content_hash: parsedSource.content_hash,
    kind: "source", visibility: "project", trust_scope: "untrusted_data"
  };
  const provider = ({ coordinate_system, source_hash }) => ({ coordinate_system, source_hash, symbols: [{
    uid: U.symbol, source_span: parsedSource.symbols[0].definition_span, symbol_kind: "function",
    name: "publish_graph", qualified_name: "publish_graph", signature_hash: parsedSource.symbols[0].signature_hash,
    annotation_uids: [U.requirement, U.scenario], status: "accepted"
  }] });
  const result = extractTraceRecords({
    markdown: [{ parsed: markdown, input: requirementInput }],
    sspec: [{ parsed: sspec, input: scenarioInput }],
    source: [{ parsed: parsedSource, input: sourceInput, context: { artifact: sourceArtifact, symbolProvider: provider } }]
  }, { projectUid: U.project, revisionId: "rev-1", worktreeUid: deriveMigratedIdentityUid(U.workspaceV1, "worktree"), snapshotUid: snapshot("1"), principal: "principal:test" });
  assert.equal(result.requirements.length, 2);
  assert.ok(result.requirements.some(({ title }) => title.includes("💡")));
  assert.ok(result.scenarios[0].source_location.span.end_byte > result.scenarios[0].source_location.span.start_byte);
  assert.equal(result.symbols.length, 1);
  assert.equal(result.symbols[0].source_location.source_artifact_uid, sourceArtifact.uid);

  const mismatch = extractTraceRecords({ source: [{ parsed: parsedSource, input: sourceInput,
    context: { artifact: sourceArtifact, symbolProvider: () => ({ coordinate_system: "utf16", source_hash: hash("0"), symbols: [] }) } }] },
  { projectUid: U.project, revisionId: "rev-1" });
  assert.ok(mismatch.diagnostics.some(({ code }) => code === "SPK406" || code === "SPK004"));
  assert.equal(mismatch.symbols.length, 0);
});

test("inferred edges never satisfy strict trace obligations", () => {
  const inferred = ["structural", "lexical_inference", "semantic_inference", "llm_inference"].map((origin, index) =>
    edge(uid("E", index + 3), U.design, U.requirement, "satisfies", { origin, status: "accepted", confidence_milli: 1000 }));
  const records = { requirements: [{ uid: U.requirement, display_id: "REQ-SPKC-003" }], edges: inferred,
    artifacts: [{ uid: U.design, kind: "design" }], scenarios: [], symbols: [], tests: [] };
  const strict = diagnoseTrace(records, { profile: "strict" });
  assert.ok(strict.diagnostics.some(({ code }) => code === "SPK201"));
  const matrix = buildTraceMatrix(records, { profile: "strict" });
  assert.deepEqual(matrix.rows[0].design_uids, []);
});

test("broken links and obligation-specific trace gaps remain structured", () => {
  const brokenInput = { path: "doc/broken.md", content: readFileSync(join(fixtureRoot, "broken/links.md"), "utf8") };
  const brokenParsed = parseMarkdownArtifact(brokenInput, { projectUid: U.project, revision: "rev-1" });
  const broken = extractTraceRecords({ markdown: [{ parsed: brokenParsed, input: brokenInput }] }, { projectUid: U.project, revisionId: "rev-1" });
  const result = diagnoseTrace({ ...broken, artifacts: [brokenParsed.artifact], sections: brokenParsed.sections,
    projects: [{ uid: U.project, status: "active", revision: "rev-1" }] }, { profile: "strict" });
  const codes = new Set(result.diagnostics.map(({ code }) => code));
  for (const code of ["SPK101", "SPK102", "SPK103"]) assert.ok(codes.has(code), `missing ${code}`);

  const gaps = diagnoseTrace({ requirements: [{ uid: U.requirement }], artifacts: [], scenarios: [], tests: [], edges: [] }, { profile: "strict" });
  const gapCodes = new Set(gaps.diagnostics.map(({ code }) => code));
  for (const code of ["SPK201", "SPK202", "SPK203", "SPK204"]) assert.ok(gapCodes.has(code), `missing ${code}`);
});

test("TRC231 and TRC232 remain compatibility projections", () => {
  const missing = projectMirroredSpecDiagnostics(["test/03_system/search_spec.spl"], []);
  assert.deepEqual(missing.map(({ code }) => code), ["TRC231"]);
  const wrongOnly = projectMirroredSpecDiagnostics(["test/03_system/search_spec.spl"], ["doc/06_spec/wrong/search_spec.md"]);
  assert.deepEqual(wrongOnly.map(({ code }) => code).sort(), ["TRC231", "TRC232"]);
  const duplicate = projectMirroredSpecDiagnostics(["test/03_system/search_spec.spl"],
    ["doc/06_spec/03_system/search_spec.md", "doc/06_spec/wrong/search_spec.md"]);
  assert.deepEqual(duplicate.map(({ code }) => code), ["TRC232"]);
});

test("GraphNode schemas and the closed endpoint-kind table reject invalid edges", () => {
  const requirementNode = createGraphNode({
    uid: U.requirement, node_kind: "Requirement", project_uid: U.project,
    revision_id: "rev-1", record_type: "requirement", record_hash: hash("1"),
    visibility: "project", trust_scope: "reviewed_reference", status: "accepted"
  });
  const artifactNode = createGraphNode({
    uid: U.design, node_kind: "Artifact", project_uid: U.project,
    revision_id: "rev-1", record_type: "artifact", record_hash: hash("2"),
    visibility: "project", trust_scope: "reviewed_reference", status: "approved"
  });
  assert.throws(() => createGraphNode({ ...requirementNode, node_kind: "SSpecScenario" }), /record_type cannot project/);
  const wrongKinds = edge(uid("E", 9), requirementNode.uid, artifactNode.uid, "specifies", { status: "proposed" });
  const store = new GraphStore();
  assert.throws(() => store.build({ snapshot_uid: snapshot("1"), nodes: [requirementNode, artifactNode], edges: [wrongKinds] }),
    (error) => error.code === "SPK006");
});

test("strict evidence rejects forged, revoked, and expired authority decisions", () => {
  const decision = uid("D", 1);
  const authoritative = createEdgeRecord({
    ...edge(uid("E", 7), U.design, U.requirement, "satisfies"),
    provenance: { ...edge(uid("E", 8), U.design, U.requirement, "satisfies").provenance, decision_uid: decision },
    authority: { kind: "explicit_review", receipt_uid: decision, policy_hash: hash("7"), policy_version: 1 }
  });
  assert.equal(isStrictEvidence(authoritative), false, "authority-shaped prose is not verification");
  assert.equal(isStrictEvidence(authoritative, () => false), false, "forged signature is rejected");
  const revoked = new Set([decision]);
  assert.equal(isStrictEvidence(authoritative, (candidate) => !revoked.has(candidate.authority.receipt_uid)), false);
  const expiredAt = 1_000;
  assert.equal(isStrictEvidence(authoritative, () => Date.now() < expiredAt), false);
});

test("source symbols bind the next declaration token and UTF-8 byte boundaries", () => {
  const content = `# spipe:symbol uid=${U.symbol} status=accepted implements=${U.requirement}\n# 💡\nfn first() -> bool: true\nfn second() -> bool: true\n`;
  const input = { path: "src/binding.spl", content };
  const parsed = parseSourceMetadata(input, { projectUid: U.project, revision: "rev-1" });
  const artifact = { uid: uid("A", 8), project_uid: U.project, revision: "rev-1", canonical_path: input.path,
    content_hash: parsed.content_hash, kind: "source", visibility: "project", trust_scope: "untrusted_data" };
  const normalized = Buffer.from(content, "utf8");
  const firstStart = normalized.indexOf(Buffer.from("fn first", "utf8"));
  const secondStart = normalized.indexOf(Buffer.from("fn second", "utf8"));
  const providerResult = (span) => ({ coordinate_system: "spipe-normalized-utf8-bytes-v1", source_hash: artifact.content_hash,
    symbols: [{ uid: U.symbol, source_span: span, symbol_kind: "function", name: "first", qualified_name: "first",
      signature_hash: hash("3"), annotation_uids: [U.requirement], status: "accepted" }] });
  const context = { projectUid: U.project, revisionId: "rev-1" };
  const wrongDeclaration = extractTraceRecords({ source: [{ parsed, input, context: { artifact,
    symbolProvider: () => providerResult({ start_byte: secondStart, end_byte: normalized.length }) } }] }, context);
  assert.equal(wrongDeclaration.symbols.length, 0);
  assert.ok(wrongDeclaration.diagnostics.some(({ code }) => code === "SPK406"));
  const lightbulbStart = normalized.indexOf(Buffer.from("💡", "utf8"));
  const splitCodePoint = extractTraceRecords({ source: [{ parsed, input, context: { artifact,
    symbolProvider: () => providerResult({ start_byte: lightbulbStart + 1, end_byte: firstStart + 2 }) } }] }, context);
  assert.equal(splitCodePoint.symbols.length, 0);
  assert.ok(splitCodePoint.diagnostics.some(({ code }) => code === "SPK406"));
});

test("pins and stages are immutable capabilities and reject forgery or release", () => {
  const graph = new GraphStore();
  graph.build({ snapshot_uid: snapshot("1"), nodes: [node(U.artifact)], edges: [] });
  const graphPin = graph.pin(snapshot("1"), { scope_digest: hash("1"), policy_version: 1 });
  assert.equal(Object.isFrozen(graphPin), true);
  assert.throws(() => { graphPin.graph_root = hash("2"); }, TypeError);
  assert.throws(() => graph.node({ ...graphPin }, U.artifact), (error) => error.code === "SPK704");
  graph.release(graphPin);
  assert.throws(() => graph.node(graphPin, U.artifact), (error) => error.code === "SPK704");

  const cacheRoot = mkdtempSync(join(tmpdir(), "spipe-wave3-cap-"));
  try {
    const store = new GraphSnapshotStore({ cacheRoot, repositoryId: "repo", worktreeUid: U.workspaceV1 });
    const empty = storedGraph();
    const stage = store.stage(storageManifest("1", empty.root), empty.objects);
    assert.equal(Object.isFrozen(stage), true);
    assert.throws(() => { stage.directory = join(cacheRoot, "attacker"); }, TypeError);
    assert.throws(() => store.publish(null, { ...stage }), (error) => error.code === "SPK704");
    store.publish(null, stage);
    const pin = store.pin_current(hash("4"), { policy_version: 1 });
    assert.equal(Object.isFrozen(pin), true);
    assert.throws(() => { pin.snapshot_uid = snapshot("9"); }, TypeError);
    store.release(pin);
    assert.throws(() => store.assert_live_pin(pin), (error) => error.code === "SPK704");
  } finally { rmSync(cacheRoot, { recursive: true, force: true }); }
});

test("cursor continuation is exact-once and every graph hard limit fails closed", () => {
  const nodes = Array.from({ length: 5 }, (_, index) => node(uid("A", index + 1)));
  const edges = Array.from({ length: 4 }, (_, index) => edge(uid("E", index + 1), nodes[index].uid, nodes[index + 1].uid, "links_to"));
  const store = new GraphStore();
  store.build({ snapshot_uid: snapshot("1"), nodes, edges });
  const pin = store.pin(snapshot("1"), { scope_digest: hash("5"), policy_version: 1 });
  const seen = [];
  let cursor = null;
  do {
    const page = store.edges(pin, { limit: 1, cursor });
    seen.push(...page.items.map(({ uid: value }) => value));
    cursor = page.cursor;
  } while (cursor);
  assert.deepEqual(seen, edges.map(({ uid: value }) => value));
  assert.equal(new Set(seen).size, edges.length);
  assert.throws(() => store.edges(pin, { limit: 1_001 }), RangeError);
  assert.throws(() => store.trace_matrix(pin, { limit: 1_001 }), RangeError);
  assert.throws(() => store.traverse(pin, { start_uids: [nodes[0].uid], max_depth: 33 }), RangeError);
  assert.throws(() => store.traverse(pin, { start_uids: [nodes[0].uid], max_visited_nodes: 20_001 }), RangeError);
  assert.throws(() => store.traverse(pin, { start_uids: [nodes[0].uid], max_returned_edges: 50_001 }), RangeError);
  assert.throws(() => store.traverse(pin, { start_uids: [nodes[0].uid], max_work_units: 500_001 }), RangeError);
});

test("compiler clean and incremental graphs converge and publication binds their root", () => {
  const baseInput = { path: "doc/02_requirements/wave3.md",
    content: readFileSync(join(fixtureRoot, "complete/requirements.md"), "utf8") };
  const compileContext = { project_uid: U.project, worktree_uid: U.workspaceV1, revision_id: "rev-1",
    overlay_generation_hash: hash("0").slice(7), policy_hash: hash("9").slice(7) };
  const base = compileKnowledgeInventory({ ...compileContext, inputs: [baseInput] });
  const changedInput = { ...baseInput, content: baseInput.content.replace("one deterministic typed graph", "one coherent deterministic typed graph") };
  const incremental = compileKnowledgeDelta(base, [{ operation: "upsert", ...changedInput }]);
  const clean = compileKnowledgeInventory({ ...compileContext, inputs: [changedInput] });
  assert.equal(incremental.inventory.graph.graph_root, clean.graph.graph_root);
  assert.deepEqual(incremental.inventory.graph.nodes, clean.graph.nodes);
  assert.deepEqual(incremental.inventory.graph.edges, clean.graph.edges);
  assert.equal(incremental.inventory.snapshot.graph_root, incremental.inventory.graph.graph_root);

  const cacheRoot = mkdtempSync(join(tmpdir(), "spipe-wave3-publish-"));
  try {
    const store = new GraphSnapshotStore({ cacheRoot, repositoryId: "repo", worktreeUid: U.workspaceV1 });
    const persisted = storedGraph(incremental.inventory.graph.nodes, incremental.inventory.graph.edges);
    const published = store.publish(null, store.stage(incremental.inventory.snapshot, persisted.objects));
    assert.equal(published.graph_root, incremental.inventory.graph.graph_root);
    assert.equal(store.current().graph_root, incremental.inventory.graph.graph_root);
  } finally { rmSync(cacheRoot, { recursive: true, force: true }); }
});

test("KnowledgeCompiler publishes a non-empty graph and guarded graph delta", () => {
  const requirements = readFileSync(join(fixtureRoot, "complete/requirements.md"), "utf8");
  const scenarios = readFileSync(join(fixtureRoot, "complete/scenarios.spl"), "utf8");
  const base = compileKnowledgeInventory({
    project_uid: U.project, worktree_uid: U.workspaceV1, revision_id: "rev-1",
    inputs: [
      { path: "doc/02_requirements/requirements.md", content: requirements },
      { path: "test/03_system/scenarios_spec.spl", content: scenarios }
    ]
  });
  assert.match(base.graph.graph_root, /^sha256:[a-f0-9]{64}$/);
  assert.equal(base.graph.requirements.length, 2);
  assert.ok(base.graph.nodes.some(({ node_kind }) => node_kind === "Requirement"));
  assert.ok(base.graph.edges.some(({ edge_type }) => edge_type === "specifies"));

  const next = compileKnowledgeDelta(base, [{ operation: "upsert", path: "doc/02_requirements/requirements.md",
    content: requirements.replace("one deterministic typed graph", "one deterministic immutable typed graph") }],
  { overlay_generation_hash: hash("e") });
  assert.equal(next.delta.graph.base_snapshot_uid, base.snapshot.snapshot_uid);
  assert.equal(next.delta.graph.base_graph_root, base.graph.graph_root);
  assert.ok(next.delta.graph.nodes.updated.length > 0);
});

test("invalid KnowledgeDelta never publishes while successful delta persists replay", () => {
  const cacheRoot = mkdtempSync(join(tmpdir(), "spipe-wave3-delta-"));
  try {
    const store = new GraphSnapshotStore({ cacheRoot, repositoryId: "repo", worktreeUid: U.workspaceV1 });
    const compiler = new KnowledgeCompiler({ graphSnapshotStore: store });
    const input = { path: "doc/base.md", content: `<!-- spipe:artifact uid=${U.artifact} key=base -->\n# Base\n` };
    const base = compiler.compile({ project_uid: U.project, worktree_uid: U.workspaceV1, revision_id: "rev-1", inputs: [input] });
    const invalidBase = { ...base, graph: { ...base.graph, graph_root: "not-a-hash" } };
    assert.throws(() => compiler.compileDelta(invalidBase, [{ operation: "upsert", path: input.path,
      content: input.content.replace("# Base", "# Changed") }]), /base_graph_root|SHA-256/);
    assert.equal(store.current().snapshot_uid, base.snapshot.snapshot_uid, "validation failure cannot advance current");

    const changed = compiler.compileDelta(base, [{ operation: "upsert", path: input.path,
      content: input.content.replace("# Base", "# Changed") }]);
    assert.equal(changed.inventory.publication.status, "published");
    const replay = store.replay(changed.inventory.snapshot.snapshot_uid);
    assert.ok(replay);
    assert.equal(replay.base_snapshot_uid, base.snapshot.snapshot_uid);
    assert.equal(replay.output_snapshot_uid, changed.inventory.snapshot.snapshot_uid);
    assert.equal(replay.output_graph_root, changed.inventory.graph.graph_root);
  } finally { rmSync(cacheRoot, { recursive: true, force: true }); }
});

test("Wave 2 duplicate diagnostics survive while duplicate trace UIDs are excluded", () => {
  const requirement = (artifactUid, sectionUid, artifactKey, title) => `<!-- spipe:artifact uid=${artifactUid} key=${artifactKey} -->\n# ${title}\n\n## REQ-SPKC-003 — ${title}\n<!-- spipe:section uid=${sectionUid} key=req-spkc-003 -->\n<!-- spipe:requirement uid=${U.requirement} key=req-spkc-003 display_id=REQ-SPKC-003 status=accepted aliases=none -->\nBody.\n`;
  const duplicateArtifact = `<!-- spipe:artifact uid=${U.artifact} key=duplicate.artifact -->\n# Duplicate artifact\n`;
  const inventory = compileKnowledgeInventory({ project_uid: U.project, worktree_uid: U.workspaceV1, revision_id: "rev-1", inputs: [
    { path: "doc/one.md", content: requirement(U.artifact, uid("S", 1), "req.one", "One") },
    { path: "doc/two.md", content: requirement(uid("A", 2), uid("S", 2), "req.two", "Two") },
    { path: "doc/duplicate.md", content: duplicateArtifact }
  ] });
  assert.ok(inventory.diagnostics.some(({ code }) => code === "SPK001"), "Wave 2 artifact conflict remains diagnosed");
  assert.ok(inventory.graph.diagnostics.some(({ code }) => code === "SPK001"), "Wave 3 trace conflict is diagnosed");
  assert.equal(inventory.snapshot.diagnostics_root, canonicalHash(inventory.diagnostics));
  assert.ok(inventory.diagnostics.every((diagnostic) => diagnostic.type === "diagnostic"));
  assert.deepEqual(inventory.diagnostics, [...inventory.diagnostics].sort((left, right) => {
    const leftKey = canonicalJson(left);
    const rightKey = canonicalJson(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  }));
  assert.equal(inventory.graph.nodes.some(({ uid: value }) => value === U.requirement), false);
  assert.equal(inventory.graph.edges.some(({ from_uid, to_uid }) => from_uid === U.requirement || to_uid === U.requirement), false);

  const changed = compileKnowledgeDelta(inventory, [{
    operation: "upsert", path: "doc/duplicate.md", content: duplicateArtifact.replace("Duplicate artifact", "Renamed duplicate artifact")
  }]);
  assert.deepEqual(changed.delta.diagnostics, changed.inventory.diagnostics);
  assert.equal(changed.inventory.snapshot.diagnostics_root, canonicalHash(changed.delta.diagnostics));
});

test("closed marker blocks reject reversed and intervening declarations", () => {
  const reversedMarkdown = `<!-- spipe:artifact uid=${U.artifact} key=reversed -->\n# Reversed\n\n## REQ-SPKC-003 — Reversed\n<!-- spipe:requirement uid=${U.requirement} key=req-spkc-003 display_id=REQ-SPKC-003 status=accepted aliases=none -->\n<!-- spipe:section uid=${uid("S", 1)} key=req-spkc-003 -->\n`;
  const markdownInput = { path: "doc/reversed.md", content: reversedMarkdown };
  const markdownParsed = parseMarkdownArtifact(markdownInput, { projectUid: U.project, revision: "rev-1" });
  const markdown = extractTraceRecords({ markdown: [{ parsed: markdownParsed, input: markdownInput }] },
    { projectUid: U.project, revisionId: "rev-1" });
  assert.equal(markdown.requirements.length, 0);
  assert.ok(markdown.diagnostics.some(({ code }) => code === "SPK003"));

  const reversedSspec = `# spipe:artifact uid=${uid("A", 3)} key=reversed.spec\ndescribe "Reversed":\n    # spipe:test uid=${U.unit} kind=unit status=accepted scenario=${U.scenario} verifies=${U.requirement}\n    # spipe:scenario uid=${U.scenario} key=reversed.spec.case status=accepted requires=${U.requirement}\n    it "reversed":\n        expect(true).to_be(true)\n`;
  const sspecInput = { path: "test/01_unit/reversed_spec.spl", content: reversedSspec };
  const sspecParsed = parseSspecMetadata(sspecInput, { projectUid: U.project, revision: "rev-1" });
  const sspec = extractTraceRecords({ sspec: [{ parsed: sspecParsed, input: sspecInput }] },
    { projectUid: U.project, revisionId: "rev-1" });
  assert.equal(sspec.scenarios.length, 0);
  assert.equal(sspec.tests.length, 0);
  assert.ok(sspec.diagnostics.some(({ code }) => code === "SPK003"));
});

test("traversal, edge pages, and trace rows resume without loss under bounded work", () => {
  const nodes = Array.from({ length: 5 }, (_, index) => node(uid("A", index + 1)));
  const relations = Array.from({ length: 4 }, (_, index) => edge(uid("E", index + 1), nodes[index].uid, nodes[index + 1].uid, "links_to"));
  const store = new GraphStore();
  store.build({ snapshot_uid: snapshot("1"), nodes, edges: relations });
  const pin = store.pin(snapshot("1"), { scope_digest: hash("8"), policy_version: 1 });
  const traversal = [];
  let traversalCursor = null;
  do {
    const page = store.traverse(pin, { start_uids: [nodes[0].uid], max_returned_edges: 1, cursor: traversalCursor });
    traversal.push(...page.edges.map(({ uid: value }) => value));
    traversalCursor = page.cursor;
  } while (traversalCursor);
  assert.deepEqual(traversal, relations.map(({ uid: value }) => value));
  assert.equal(new Set(traversal).size, relations.length);

  const collect = (read, field) => {
    const values = []; let cursor = null;
    do { const page = read(cursor); values.push(...page[field]); cursor = page.cursor; } while (cursor);
    return values;
  };
  assert.deepEqual(collect((cursor) => store.edges(pin, { limit: 1, max_work_units: 1, cursor }), "items")
    .map(({ uid: value }) => value), relations.map(({ uid: value }) => value));
  const traceEdges = collect((cursor) => store.trace_matrix(pin, { limit: 1, max_work_units: 1, max_returned_edges: 1, cursor }), "rows")
    .flatMap(({ edges }) => edges.map(({ uid: value }) => value));
  assert.deepEqual(traceEdges, relations.map(({ uid: value }) => value));
  assert.throws(() => store.edges(pin, { max_work_units: 500_001 }), RangeError);
  assert.throws(() => store.trace_matrix(pin, { max_work_units: 500_001 }), RangeError);
  assert.throws(() => store.trace_matrix(pin, { max_returned_edges: 50_001 }), RangeError);
});

test("Standard trace obligations require a verified edge acceptance receipt", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const policyHash = hash("6");
  const preliminary = createEdgeRecord({ ...edge(uid("E", 6), U.design, U.requirement, "satisfies"), status: "accepted" });
  const subject = { ...preliminary, provenance: { ...preliminary.provenance } };
  delete subject.status; delete subject.authority; delete subject.provenance.decision_uid;
  const acceptanceSubjectHash = `sha256:${createHash("sha256").update(Buffer.concat([
    Buffer.from("spipe-edge-accept-v1\0", "utf8"), Buffer.from(canonicalJson(subject), "utf8")
  ])).digest("hex")}`;
  const receipt = signEdgeAcceptanceReceipt({ issuer_key_id: "reviewer", edge_uid: preliminary.uid,
    acceptance_subject_hash: acceptanceSubjectHash, from_uid: preliminary.from_uid, to_uid: preliminary.to_uid,
    origin: "explicit", status: "accepted", project_uid: U.project,
    worktree_uid: preliminary.provenance.worktree_uid, input_snapshot_uid: preliminary.provenance.input_snapshot_uid,
    policy_hash: policyHash, policy_version: 1, capability: "trace.accept.explicit",
    decided_at_ms: 1_000, expires_at_ms: 3_000, audit_evidence_hash: hash("a") }, privateKey);
  const accepted = createEdgeRecord({ ...preliminary,
    provenance: { ...preliminary.provenance, decision_uid: receipt.receipt_uid },
    authority: { kind: "explicit_review", receipt_uid: receipt.receipt_uid, policy_hash: policyHash, policy_version: 1 } });
  const port = createAuthorizationPort({ publicKeys: { reviewer: publicKey }, now: () => 2_000 });
  const data = { requirements: [{ uid: U.requirement, display_id: "REQ-SPKC-003" }],
    artifacts: [{ uid: U.design, kind: "design" }], scenarios: [], tests: [], edges: [accepted] };
  const unauthenticated = diagnoseTrace(data, { profile: "standard" });
  assert.ok(unauthenticated.diagnostics.some(({ code }) => code === "SPK201"));
  const authenticated = diagnoseTrace(data, { profile: "standard", authorizationPort: port,
    authorizationReceipts: { [receipt.receipt_uid]: receipt } });
  assert.equal(authenticated.diagnostics.some(({ code }) => code === "SPK201"), false);
});

test("diagnostics are canonical records and storage rejects open or noncanonical manifests", () => {
  const result = diagnoseTrace({ requirements: [{ uid: U.requirement }], artifacts: [], scenarios: [], tests: [], edges: [] });
  assert.ok(result.diagnostics.length > 0);
  for (const diagnostic of result.diagnostics) {
    assert.equal(diagnostic.type, "diagnostic");
    assert.equal(Object.hasOwn(diagnostic, "arguments"), true);
    assert.equal(Object.hasOwn(diagnostic, "details"), false);
    assert.equal(Object.isFrozen(diagnostic), true);
  }
  const cacheRoot = mkdtempSync(join(tmpdir(), "spipe-wave3-manifest-"));
  try {
    const store = new GraphSnapshotStore({ cacheRoot, repositoryId: "repo", worktreeUid: U.workspaceV1 });
    assert.throws(() => store.stage({ ...storageManifest("1"), snapshot_uid: "snapshot-latest" }), /snapshot_uid|snapshot UID/);
    assert.throws(() => store.stage({ ...storageManifest("1"), attacker_field: true }), /fields|manifest/);
  } finally { rmSync(cacheRoot, { recursive: true, force: true }); }
});
