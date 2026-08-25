import { buildIdentityIndex, contentHash, normalizeSemanticKey, provisionalArtifactUid } from "./identity.js";
import { parseMarkdownArtifact, parseSdnDocument, parseSourceMetadata, parseSspecMetadata } from "../parser/index.js";
import { canonicalJson, sha256Hex, ZERO_HASH } from "../storage/canonical.js";
import { createSnapshotMetadata } from "../storage/snapshot_store.js";
import { createArtifactRecord } from "../model/artifact.js";
import { createSectionRecord } from "../model/section.js";
import { createKnowledgeDelta } from "../model/snapshot.js";
import { TRUST_SCOPES } from "../model/identity.js";
import { isTrustedAuthorizationPort } from "./authorization.js";
import { compileKnowledgeGraph } from "./knowledge_graph.js";
import { graphRecordHash, hashGraphDelta } from "../graph/index.js";
import { GraphSnapshotStore } from "../storage/graph_snapshot_store.js";
import { canonicalGraphBytes } from "../graph/canonical.js";
import { createDiagnosticRecord } from "../diagnostics/record.js";

function compare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalDiagnostic(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("compiler diagnostic must be an object");
  }
  return createDiagnosticRecord({
    code: value.code,
    severity: value.severity,
    message_key: value.message_key,
    arguments: value.arguments ?? value.details ?? {},
    project_uid: value.project_uid ?? null,
    revision_id: value.revision_id ?? null,
    snapshot_uid: value.snapshot_uid ?? null,
    artifact_uid: value.artifact_uid ?? null,
    source_span: value.source_span ?? null,
    related_uids: value.related_uids ?? [],
    remediation: value.remediation ?? null,
    cause_chain: value.cause_chain ?? []
  });
}

/** Return the deterministic, canonical union used by results, deltas, and roots. */
function mergeDiagnostics(...groups) {
  const records = new Map();
  for (const value of groups.flat()) {
    const record = canonicalDiagnostic(value);
    records.set(canonicalJson(record), record);
  }
  return [...records.entries()]
    .sort(([left], [right]) => compare(left, right))
    .map(([, record]) => record);
}

function positiveSafeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${field} must be a positive safe integer`);
  return value;
}

function authorizedTrustScope(options, authorizationPort, expected, rawParsed) {
  if (options.trust_scope && options.trust_scope !== "untrusted_data") {
    throw new TypeError("trust_scope is registry-derived; provide a verified trust receipt through KnowledgeCompiler");
  }
  const receipt = options.authorization_receipt;
  if (!receipt) return "untrusted_data";
  const requested = receipt.trust_scope;
  if (!TRUST_SCOPES.includes(requested)) throw new TypeError("trust_scope is invalid");
  if (requested === "untrusted_data") return requested;
  if (rawParsed.some((item) => item.artifact.identity_status !== "canonical")) {
    throw new TypeError("trust elevation requires canonical registry artifacts");
  }
  if (!isTrustedAuthorizationPort(authorizationPort) || !authorizationPort.verifyTrustReceipt(receipt, {
    ...expected, trust_scope: requested
  })) throw new TypeError("trust elevation requires a verified registry authorization receipt");
  return requested;
}

export function trustSourceSetHash(records) {
  const artifacts = (records ?? []).map((item) => item.artifact ?? item).map((artifact) => ({
    uid: artifact.uid, canonical_path: artifact.canonical_path, content_hash: artifact.content_hash
  })).sort((a, b) => compare(`${a.uid}\0${a.canonical_path}`, `${b.uid}\0${b.canonical_path}`));
  return sha256Hex(canonicalJson(artifacts));
}

function sectionCandidate(section) {
  const value = {
    ...section,
    candidate_id: `spkc1-${sha256Hex(canonicalJson({
      artifact_uid: section.artifact_uid, key: section.key, ordinal: section.ordinal, heading_offset: section.heading_offset
    }))}`,
    type: "section_candidate"
  };
  delete value.uid;
  return freeze(value);
}

function freeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) freeze(child, seen);
  return Object.freeze(value);
}

function normalizedInput(input) {
  if (!input || typeof input !== "object") throw new TypeError("compiler input must be an object");
  const path = String(input.path ?? "").replaceAll("\\", "/");
  if (!path || path.startsWith("/") || path.split("/").some((part) => part === "..")) {
    throw new TypeError("compiler input path must be project-relative and contained");
  }
  const content = String(input.content ?? "").replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  return { path, content };
}

function genericArtifact(input, context, parserId) {
  const hash = contentHash(input.content);
  const base = input.path.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]+/g, ".");
  return {
    artifact: {
      uid: provisionalArtifactUid(context.projectUid, hash),
      key: normalizeSemanticKey(base) || "artifact",
      project_uid: context.projectUid,
      revision: context.revisionId,
      kind: "source",
      title: input.path.split("/").at(-1),
      canonical_path: input.path,
      content_hash: hash,
      features: [], components: [], layers: [], aliases: [],
      visibility: "project", trust_scope: "untrusted_data", status: "proposed",
      identity_status: "provisional", parser: { id: parserId, version: 1 }
    },
    sections: [], diagnostics: [], parser: { id: parserId, version: 1 }
  };
}

function parseInput(input, context) {
  if (/\.md(?:own)?$/i.test(input.path)) return parseMarkdownArtifact(input.content, {
    path: input.path, projectUid: context.projectUid, revision: context.revisionId,
    strictSections: context.strictSections, maxBytes: context.maxBytes,
    maxSections: context.maxSections, maxAliases: context.maxAliases,
    maxSdnNodes: context.maxSdnNodes, maxSdnDepth: context.maxSdnDepth
  });
  if (/_spec\.spl$/i.test(input.path)) return parseSspecMetadata(input.content, {
    path: input.path, projectUid: context.projectUid, revision: context.revisionId, maxBytes: context.maxBytes,
    maxScenarios: context.maxScenarios, maxAliases: context.maxAliases,
    maxSdnNodes: context.maxSdnNodes, maxSdnDepth: context.maxSdnDepth
  });
  if (/\.spl$/i.test(input.path)) {
    const parsed = parseSourceMetadata(input.content, {
      path: input.path, projectUid: context.projectUid, maxBytes: context.maxBytes, maxSymbols: context.maxSymbols,
      maxSdnNodes: context.maxSdnNodes, maxSdnDepth: context.maxSdnDepth
    });
    return {
      ...genericArtifact(input, context, "source_metadata"), symbols: parsed.symbols,
      diagnostics: parsed.diagnostics, budget_usage: parsed.budget_usage
    };
  }
  if (/\.sdn$/i.test(input.path)) {
    const parsed = parseSdnDocument(input.content, {
      maxBytes: context.maxBytes, maxDepth: context.maxSdnDepth, maxNodes: context.maxSdnNodes
    });
    return {
      ...genericArtifact(input, context, "sdn"), data: parsed.value,
      diagnostics: parsed.diagnostics, budget_usage: parsed.budget_usage
    };
  }
  throw new TypeError(`unsupported compiler input: ${input.path}`);
}

export function applyInputDelta(inputs, changes) {
  const state = new Map((inputs ?? []).map(normalizedInput).map((input) => [input.path, input]));
  for (const change of changes ?? []) {
    if (!change || typeof change !== "object") throw new TypeError("input delta must be an object");
    if (change.operation === "delete") {
      const target = normalizedInput({ path: change.path, content: "" }).path;
      state.delete(target);
    } else if (change.operation === "move") {
      const source = normalizedInput({ path: change.from, content: "" }).path;
      const target = normalizedInput({ path: change.path, content: "" }).path;
      const prior = state.get(source);
      if (!prior) throw new Error(`move source is absent: ${source}`);
      state.delete(source);
      state.set(target, { path: target, content: change.content === undefined ? prior.content : String(change.content) });
    } else if (change.operation === "upsert") {
      const next = normalizedInput(change);
      state.set(next.path, next);
    } else {
      throw new TypeError(`unsupported input delta operation: ${change.operation}`);
    }
  }
  return freeze([...state.values()].sort((a, b) => compare(a.path, b.path)));
}

/** Compile an explicit bounded input set. Filesystem enumeration belongs to a workspace adapter. */
function compileInventory(options = {}, authorizationPort = null, graphSnapshotStore = null) {
  const context = {
    projectUid: String(options.project_uid ?? ""),
    worktreeUid: String(options.worktree_uid ?? ""),
    revisionId: String(options.revision_id ?? ""),
    strictSections: options.strict_sections === true,
    trustScope: "untrusted_data"
  };
  if (!context.projectUid || !context.worktreeUid || !context.revisionId) {
    throw new TypeError("project_uid, worktree_uid, and revision_id are required");
  }
  const limits = {
    max_files: positiveSafeInteger(options.limits?.max_files ?? 10_000, "max_files"),
    max_file_bytes: positiveSafeInteger(options.limits?.max_file_bytes ?? 1_048_576, "max_file_bytes"),
    max_total_bytes: positiveSafeInteger(options.limits?.max_total_bytes ?? 33_554_432, "max_total_bytes"),
    max_sections: positiveSafeInteger(options.limits?.max_sections ?? 100_000, "max_sections"),
    max_scenarios: positiveSafeInteger(options.limits?.max_scenarios ?? 100_000, "max_scenarios"),
    max_symbols: positiveSafeInteger(options.limits?.max_symbols ?? 100_000, "max_symbols"),
    max_sdn_nodes: positiveSafeInteger(options.limits?.max_sdn_nodes ?? 100_000, "max_sdn_nodes"),
    max_sdn_depth: positiveSafeInteger(options.limits?.max_sdn_depth ?? 64, "max_sdn_depth"),
    max_aliases: positiveSafeInteger(options.limits?.max_aliases ?? 100_000, "max_aliases"),
    max_diagnostics: positiveSafeInteger(options.limits?.max_diagnostics ?? 100_000, "max_diagnostics")
  };
  const rawInputs = options.inputs ?? [];
  if (!Array.isArray(rawInputs) || rawInputs.length > limits.max_files) throw new RangeError("SPK020 compiler_file_limit_exceeded");
  const inputs = rawInputs.map(normalizedInput).sort((a, b) => compare(a.path, b.path));
  let totalBytes = 0;
  for (const input of inputs) {
    const size = Buffer.byteLength(input.content, "utf8");
    if (size > limits.max_file_bytes) throw new RangeError("SPK020 parser_input_too_large");
    totalBytes += size;
    if (totalBytes > limits.max_total_bytes) throw new RangeError("SPK020 compiler_total_input_too_large");
  }
  const rawParsed = [];
  const aggregate = { sections: 0, scenarios: 0, symbols: 0, aliases: 0, sdn_nodes: 0 };
  for (const input of inputs) {
    const remaining = (field, limitName) => Math.max(1, limits[limitName] - aggregate[field]);
    const item = parseInput(input, {
      ...context, maxBytes: limits.max_file_bytes,
      maxSections: remaining("sections", "max_sections"),
      maxScenarios: remaining("scenarios", "max_scenarios"),
      maxSymbols: remaining("symbols", "max_symbols"),
      maxSdnNodes: remaining("sdn_nodes", "max_sdn_nodes"),
      maxSdnDepth: limits.max_sdn_depth,
      maxAliases: remaining("aliases", "max_aliases")
    });
    aggregate.sections += (item.sections ?? []).length;
    aggregate.scenarios += (item.scenarios ?? []).length;
    aggregate.symbols += (item.symbols ?? []).length;
    aggregate.aliases += (item.artifact?.aliases ?? []).length;
    aggregate.aliases += (item.sections ?? []).reduce((count, section) => count + (section.aliases ?? []).length, 0);
    aggregate.sdn_nodes += item.budget_usage?.sdn_nodes ?? 0;
    for (const [field, limitName] of [
      ["sections", "max_sections"], ["scenarios", "max_scenarios"],
      ["symbols", "max_symbols"], ["aliases", "max_aliases"], ["sdn_nodes", "max_sdn_nodes"]
    ]) {
      if (aggregate[field] > limits[limitName]) throw new RangeError(`SPK021 compiler_${field}_limit_exceeded`);
    }
    rawParsed.push(item);
  }
  const policyHash = options.policy_hash ?? sha256Hex("spipe-policy-v1");
  context.trustScope = authorizedTrustScope(options, authorizationPort, {
    project_uid: context.projectUid, worktree_uid: context.worktreeUid,
    revision_id: context.revisionId, source_set_hash: trustSourceSetHash(rawParsed),
    policy_hash: policyHash, policy_version: String(options.policy_version ?? "1")
  }, rawParsed);
  const parsed = rawParsed.map((item) => ({
    ...item,
    artifact: createArtifactRecord({ ...item.artifact, trust_scope: context.trustScope }),
    sections: (item.sections ?? []).filter((section) => section.uid).map((section) => createSectionRecord({ ...section, marker_present: true }))
  }));
  const identity = buildIdentityIndex(parsed);
  const diagnostics = mergeDiagnostics(parsed.flatMap((item) => item.diagnostics ?? []), identity.diagnostics);
  if (diagnostics.length > limits.max_diagnostics) throw new RangeError("SPK022 diagnostic_limit_exceeded");
  const baseGenerationHash = sha256Hex(canonicalJson(parsed.map((item) => ({
    path: item.artifact.canonical_path,
    content_hash: item.artifact.content_hash,
    parser: item.parser
  }))));
  const overlayGenerationHash = options.overlay_generation_hash ?? ZERO_HASH;
  const snapshot = createSnapshotMetadata({
    project_uid: context.projectUid,
    worktree_uid: context.worktreeUid,
    revision_id: context.revisionId,
    base_generation_hash: baseGenerationHash,
    overlay_generation_hash: overlayGenerationHash,
    schema_version: 1,
    parser_version: "wave2-1",
    analyzer_version: "none-1",
    provider_contract_version: "none-1",
    policy_hash: policyHash,
    base_segments: parsed.map((item) => item.artifact.content_hash),
    diagnostics_root: sha256Hex(canonicalJson(diagnostics)),
    parser_set_hash: sha256Hex(canonicalJson([...new Set(parsed.map((item) => item.parser.id))].sort()))
  });
  const inventory = {
    snapshot,
    artifacts: parsed.map((item) => item.artifact),
    sections: parsed.flatMap((item) => item.sections ?? []),
    section_candidates: rawParsed.flatMap((item) => item.sections ?? []).filter((section) => !section.uid).map(sectionCandidate),
    symbols: parsed.flatMap((item) => item.symbols ?? []),
    scenarios: parsed.flatMap((item) => item.scenarios ?? []),
    diagnostics,
    identity,
    parsed,
    source_inputs: inputs
  };
  const graph = compileKnowledgeGraph(inventory, {
    symbol_provider: options.symbol_provider ?? null,
    principal: options.principal,
    profile: options.trace_profile ?? "standard",
    authorization_port: authorizationPort,
    authorization_receipts: options.authorization_receipts ?? null
  });
  const finalDiagnostics = mergeDiagnostics(diagnostics, graph.diagnostics);
  if (finalDiagnostics.length > limits.max_diagnostics) throw new RangeError("SPK022 diagnostic_limit_exceeded");
  const coherentSnapshot = createSnapshotMetadata({
    ...snapshot,
    graph_root: graph.graph_root,
    diagnostics_root: sha256Hex(canonicalJson(finalDiagnostics))
  });
  let publication = null;
  if (graphSnapshotStore !== null) {
    const stage = graphSnapshotStore.stage(coherentSnapshot, [
      { hash: graph.graph_root, bytes: canonicalGraphBytes(graph.nodes, graph.edges) }
    ]);
    publication = graphSnapshotStore.publish(options.expected_current_snapshot_uid ?? null, stage);
  }
  return freeze({
    ...inventory,
    snapshot: coherentSnapshot,
    diagnostics: finalDiagnostics,
    graph,
    graph_diagnostics: graph.diagnostics,
    publication
  });
}

export function compileKnowledgeInventory(options = {}) {
  return compileInventory(options, null);
}

export class KnowledgeCompiler {
  #authorizationPort;
  #graphSnapshotStore;

  constructor({ authorizationPort = null, graphSnapshotStore = null } = {}) {
    if (authorizationPort !== null && !isTrustedAuthorizationPort(authorizationPort)) {
      throw new TypeError("KnowledgeCompiler requires a trusted AuthorizationPort");
    }
    if (graphSnapshotStore !== null && !(graphSnapshotStore instanceof GraphSnapshotStore)) {
      throw new TypeError("KnowledgeCompiler requires a GraphSnapshotStore");
    }
    this.#authorizationPort = authorizationPort;
    this.#graphSnapshotStore = graphSnapshotStore;
  }

  compile(options = {}) {
    return compileInventory(options, this.#authorizationPort, this.#graphSnapshotStore);
  }

  compileDelta(previous, changes, options = {}) {
    return compileDelta(previous, changes, options, this.#authorizationPort, this.#graphSnapshotStore);
  }
}

function artifactMap(inventory) {
  return new Map(inventory.artifacts.map((artifact) => [artifact.uid, artifact]));
}

function sectionMap(inventory) {
  return new Map(inventory.sections.map((section) => [section.uid, section]));
}

function sectionCandidateMap(inventory) {
  return new Map(inventory.section_candidates.map((section) => [section.candidate_id, section]));
}

function graphOperations(beforeValues = [], afterValues = [], kind) {
  const before = new Map(beforeValues.map((record) => [record.uid, record]));
  const after = new Map(afterValues.map((record) => [record.uid, record]));
  return {
    added: [...after.entries()].filter(([uid]) => !before.has(uid)).map(([, record]) => record),
    updated: [...after.entries()].filter(([uid, record]) => before.has(uid) && canonicalJson(before.get(uid)) !== canonicalJson(record))
      .map(([uid, record]) => ({ before_hash: graphRecordHash(before.get(uid)), [kind]: record })),
    removed: [...before.entries()].filter(([uid]) => !after.has(uid)).map(([uid, record]) => ({ uid, before_hash: graphRecordHash(record) }))
  };
}

function compileDelta(previous, changes, options = {}, authorizationPort = null, graphSnapshotStore = null) {
  if (!previous?.snapshot || !Array.isArray(previous.source_inputs)) throw new TypeError("previous inventory with source_inputs is required");
  const nextInputs = applyInputDelta(previous.source_inputs, changes);
  const inventory = compileInventory({
    project_uid: previous.snapshot.project_uid,
    worktree_uid: previous.snapshot.worktree_uid,
    revision_id: previous.snapshot.revision_id,
    overlay_generation_hash: options.overlay_generation_hash ?? previous.snapshot.overlay_generation_hash,
    policy_hash: previous.snapshot.policy_hash,
    strict_sections: options.strict_sections,
    authorization_receipt: options.authorization_receipt,
    policy_version: options.policy_version,
    symbol_provider: options.symbol_provider,
    principal: options.principal,
    trace_profile: options.trace_profile,
    authorization_receipts: options.authorization_receipts,
    limits: options.limits,
    inputs: nextInputs,
    expected_current_snapshot_uid: options.expected_current_snapshot_uid ?? previous.snapshot.snapshot_uid
  }, authorizationPort, null);
  const before = artifactMap(previous);
  const after = artifactMap(inventory);
  const added = [...after.entries()].filter(([uid]) => !before.has(uid)).map(([, value]) => value);
  const removed_uids = [...before.keys()].filter((uid) => !after.has(uid));
  const updated = [...after.entries()].filter(([uid, value]) => before.has(uid) && canonicalJson(before.get(uid)) !== canonicalJson(value)).map(([, value]) => value);
  const beforeSections = sectionMap(previous);
  const afterSections = sectionMap(inventory);
  const sections_added = [...afterSections.entries()].filter(([uid]) => !beforeSections.has(uid)).map(([, value]) => value);
  const sections_removed_uids = [...beforeSections.keys()].filter((uid) => !afterSections.has(uid));
  const sections_updated = [...afterSections.entries()]
    .filter(([uid, value]) => beforeSections.has(uid) && canonicalJson(beforeSections.get(uid)) !== canonicalJson(value))
    .map(([, value]) => value);
  const beforeCandidates = sectionCandidateMap(previous);
  const afterCandidates = sectionCandidateMap(inventory);
  const section_candidates_added = [...afterCandidates.entries()].filter(([id]) => !beforeCandidates.has(id)).map(([, value]) => value);
  const section_candidates_removed_ids = [...beforeCandidates.keys()].filter((id) => !afterCandidates.has(id));
  const section_candidates_updated = [...afterCandidates.entries()]
    .filter(([id, value]) => beforeCandidates.has(id) && canonicalJson(beforeCandidates.get(id)) !== canonicalJson(value))
    .map(([, value]) => value);
  const graph = {
    base_snapshot_uid: previous.snapshot.snapshot_uid,
    base_graph_root: previous.graph.graph_root,
    nodes: graphOperations(previous.graph.nodes, inventory.graph.nodes, "node"),
    edges: graphOperations(previous.graph.edges, inventory.graph.edges, "edge")
  };
  const delta = createKnowledgeDelta({
    base_snapshot_uid: previous.snapshot.snapshot_uid,
    project_uid: previous.snapshot.project_uid,
    revision_id: previous.snapshot.revision_id,
    artifacts: {
      added, updated, removed_uids, sections_added, sections_updated, sections_removed_uids,
      section_candidates_added, section_candidates_updated, section_candidates_removed_ids
    },
    graph,
    index: {
      added_document_ids: added.map(({ uid }) => uid),
      updated_document_ids: updated.map(({ uid }) => uid),
      removed_document_ids: removed_uids
    },
    aliases_changed: [...new Set([...added, ...updated].flatMap(({ aliases }) => aliases))],
    projection_invalidations: [...new Set([...added, ...updated].flatMap(({ features, components, layers }) => [...features, ...components, ...layers]))],
    diagnostics: inventory.diagnostics
  });
  let publishedInventory = inventory;
  if (graphSnapshotStore !== null) {
    const replayRecord = {
      delta_hash: hashGraphDelta(delta.graph),
      base_snapshot_uid: previous.snapshot.snapshot_uid,
      base_graph_root: previous.graph.graph_root,
      output_snapshot_uid: inventory.snapshot.snapshot_uid,
      output_graph_root: inventory.graph.graph_root
    };
    const stage = graphSnapshotStore.stage(inventory.snapshot, [
      {
        hash: inventory.graph.graph_root,
        bytes: canonicalGraphBytes(inventory.graph.nodes, inventory.graph.edges)
      }
    ], { replay_record: replayRecord });
    const publication = graphSnapshotStore.publish(options.expected_current_snapshot_uid ?? previous.snapshot.snapshot_uid, stage);
    publishedInventory = freeze({ ...inventory, publication });
  }
  return freeze({ inventory: publishedInventory, delta });
}


export function compileKnowledgeDelta(previous, changes, options = {}) {
  return compileDelta(previous, changes, options, null);
}
