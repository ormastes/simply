import { extractTraceRecords } from "../extract/index.js";
import { diagnoseTrace, buildTraceMatrix } from "../diagnostics/index.js";
import { GraphStore, graphRecordHash } from "../graph/index.js";
import {
  createGraphNode, createRequirementRecord, createSSpecScenarioRecord,
  createSourceSymbolRecord, createTestRecord, materializeProposedEdge,
  deriveMigratedIdentityUid
} from "../model/index.js";
import { freezeDeep } from "../storage/canonical.js";
import { createDiagnosticRecord } from "../diagnostics/record.js";

function diagnostic(code, messageKey, details = {}) {
  return createDiagnosticRecord({ code, severity: "error", message_key: messageKey, arguments: details });
}

function canonicalArtifact(value) {
  return value?.identity_status === "canonical" && value.uid?.startsWith("A-");
}

function graphNode(record, nodeKind, artifact = null) {
  const owner = artifact ?? record;
  const recordType = record.type === "test" ? "test" : record.type;
  return createGraphNode({
    uid: record.uid, node_kind: nodeKind,
    project_uid: record.project_uid ?? owner.project_uid ?? null,
    revision_id: record.revision_id ?? record.revision ?? owner.revision ?? null,
    record_type: recordType, record_hash: graphRecordHash(record),
    visibility: record.visibility ?? owner.visibility ?? "project",
    trust_scope: record.trust_scope ?? owner.trust_scope ?? "untrusted_data",
    status: record.identity_status === "provisional" ? "candidate" : (record.status ?? owner.status ?? "candidate")
  });
}

function construct(values, constructor, diagnostics) {
  const output = [];
  for (const value of values ?? []) {
    try { output.push(constructor(value)); }
    catch (error) { diagnostics.push(diagnostic("SPK003", "trace.record_invalid", { uid: value?.uid ?? null, message: error.message })); }
  }
  return output;
}

function inputGroups(inventory, symbolProvider) {
  const groups = { markdown: [], sspec: [], source: [] };
  for (let index = 0; index < inventory.parsed.length; index += 1) {
    const parsed = inventory.parsed[index];
    const input = inventory.source_inputs[index];
    if (parsed.parser?.id === "markdown") groups.markdown.push({ parsed, input });
    else if (parsed.parser?.id === "sspec") groups.sspec.push({ parsed, input });
    else if (parsed.parser?.id === "source_metadata") groups.source.push({
      parsed, input, context: { artifact: parsed.artifact, symbolProvider }
    });
  }
  return groups;
}

function resolver(records, artifacts, sections) {
  const index = new Map();
  for (const record of [...records, ...artifacts, ...sections]) {
    if (record.uid) index.set(record.uid, record.uid);
    if (record.key) index.set(record.key, record.uid);
    if (record.display_id) index.set(record.display_id, record.uid);
    for (const alias of record.aliases ?? []) index.set(alias, record.uid);
  }
  return (target) => index.get(target) ?? null;
}

/** Attach a deterministic Wave 3 graph projection to a Wave 2 inventory. */
export function compileKnowledgeGraph(inventory, options = {}) {
  if (!inventory?.snapshot || !Array.isArray(inventory.parsed)) throw new TypeError("compiled inventory is required");
  const worktreeUid = inventory.snapshot.worktree_uid.startsWith("WT-")
    ? inventory.snapshot.worktree_uid
    : deriveMigratedIdentityUid(inventory.snapshot.worktree_uid, "worktree");
  const context = {
    projectUid: inventory.snapshot.project_uid, revisionId: inventory.snapshot.revision_id,
    worktreeUid, snapshotUid: inventory.snapshot.snapshot_uid,
    principal: options.principal ?? "compiler:spipe-wave3"
  };
  const extracted = extractTraceRecords(inputGroups(inventory, options.symbol_provider ?? null), context);
  const diagnostics = [...extracted.diagnostics];
  const requirements = construct(extracted.requirements, createRequirementRecord, diagnostics);
  const scenarios = construct(extracted.scenarios, createSSpecScenarioRecord, diagnostics);
  const symbols = construct(extracted.symbols, createSourceSymbolRecord, diagnostics);
  const tests = construct(extracted.tests, createTestRecord, diagnostics);
  const artifacts = inventory.artifacts.filter(canonicalArtifact);
  const artifactByUid = new Map(artifacts.map((record) => [record.uid, record]));
  const sections = inventory.sections.filter((record) => artifactByUid.has(record.artifact_uid));
  const nodeByUid = new Map();
  const conflictingTraceUids = new Set();
  const addInventoryNode = (node) => {
    if (!nodeByUid.has(node.uid)) nodeByUid.set(node.uid, node);
  };
  const addTraceNode = (node) => {
    if (nodeByUid.has(node.uid)) {
      conflictingTraceUids.add(node.uid);
      nodeByUid.delete(node.uid);
      diagnostics.push(diagnostic("SPK001", "identity.duplicate_uid", { uid: node.uid }));
    } else if (!conflictingTraceUids.has(node.uid)) nodeByUid.set(node.uid, node);
  };
  for (const record of artifacts) addInventoryNode(graphNode(record, "Artifact"));
  for (const record of sections) addInventoryNode(graphNode(record, "Section", artifactByUid.get(record.artifact_uid)));
  for (const record of requirements) addTraceNode(graphNode(record, record.kind === "nfr" ? "NonFunctionalRequirement" : "Requirement", artifactByUid.get(record.artifact_uid)));
  for (const record of scenarios) addTraceNode(graphNode(record, "SSpecScenario", artifactByUid.get(record.artifact_uid)));
  for (const record of symbols) addTraceNode(graphNode(record, "SourceSymbol", artifactByUid.get(record.source_location.source_artifact_uid)));
  for (const record of tests) addTraceNode(graphNode(record, `${record.test_kind[0].toUpperCase()}${record.test_kind.slice(1)}Test`, artifactByUid.get(record.artifact_uid)));
  // Wave 2 deliberately retains conflicting records so identity diagnostics can
  // report them. The graph projection is read-only and must not turn those
  // already-diagnosed conflicts into a compiler exception.
  const nodes = [...nodeByUid.values()];

  const nodeUids = new Set(nodes.map((node) => node.uid));
  const resolve = resolver([...requirements, ...scenarios, ...symbols, ...tests], artifacts, sections);
  const edges = [];
  for (const candidate of extracted.edge_candidates) {
    const toUid = resolve(candidate.target_ref);
    if (!toUid || !nodeUids.has(candidate.from_uid) || !nodeUids.has(toUid)) continue;
    try { edges.push(materializeProposedEdge(candidate, { to_uid: toUid })); }
    catch (error) { diagnostics.push(diagnostic("SPK003", "trace.edge_invalid", { message: error.message })); }
  }
  const traceData = { artifacts, sections, requirements, scenarios, symbols, tests, edges, links: extracted.links, diagnostics };
  const diagnosticOptions = {
    profile: options.profile ?? "standard", authorizationPort: options.authorization_port ?? null,
    authorizationReceipts: options.authorization_receipts ?? null
  };
  const diagnosed = diagnoseTrace(traceData, diagnosticOptions);
  const store = new GraphStore();
  const graph = store.build({ snapshot_uid: inventory.snapshot.snapshot_uid, nodes, edges });
  return freezeDeep({
    nodes: graph.nodes, edges: graph.edges, graph_root: graph.graph_root,
    requirements, scenarios, symbols, tests,
    diagnostics: diagnosed.diagnostics,
    trace_matrix: buildTraceMatrix(traceData, diagnosticOptions)
  });
}
