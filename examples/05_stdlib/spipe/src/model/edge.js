import { assertCanonicalUid, assertUid, canonicalBytes, crockfordDigestPayload, isProvisionalArtifactUid, compareLexical, immutableRecord, normalizeEnum, normalizeHash, normalizeRevision, normalizeText, requireInteger, sortedUnique } from "./identity.js";
import { createSourceLocation } from "./source_location.js";

export const EDGE_TYPES = Object.freeze(["contains", "classifies", "evidence_for", "derives", "satisfies", "realizes", "schedules", "specifies", "implements", "verifies", "covers", "produces", "links_to", "aliases", "supersedes", "extends", "promoted_from", "depends_on", "mounted_as"]);
export const WAVE3_EDGE_TYPES = Object.freeze(EDGE_TYPES.filter((value) => !["produces", "promoted_from"].includes(value)));
export const EDGE_ORIGINS = Object.freeze(["explicit", "generated", "structural", "lexical_inference", "semantic_inference", "llm_inference"]);
export const EDGE_STATUSES = Object.freeze(["accepted", "proposed", "rejected", "stale", "superseded"]);

const TEST_NODE_KINDS = Object.freeze(["UnitTest", "IntegrationTest", "SystemTest"]);
const CLASSIFICATION_NODE_KINDS = Object.freeze(["Feature", "Component", "Layer", "Tag"]);
export const EDGE_ENDPOINT_KINDS = Object.freeze({
  contains: Object.freeze({ from: Object.freeze(["Workspace", "Worktree", "Project", "Artifact", "Section"]), to: "any_except_workspace_worktree" }),
  classifies: Object.freeze({ from: Object.freeze(["Artifact", "Section"]), to: "classification" }),
  evidence_for: Object.freeze({ from: Object.freeze(["Artifact", "Section"]), to: Object.freeze(["Artifact", "Section", "Requirement", "NonFunctionalRequirement"]) }),
  derives: Object.freeze({ from: Object.freeze(["Artifact", "Section"]), to: Object.freeze(["Artifact", "Section", "Requirement", "NonFunctionalRequirement"]) }),
  satisfies: Object.freeze({ from: Object.freeze(["Artifact", "Section", "SourceSymbol"]), to: Object.freeze(["Requirement", "NonFunctionalRequirement", "Artifact", "Section", "Component"]) }),
  realizes: Object.freeze({ from: Object.freeze(["Artifact", "Section", "SourceSymbol"]), to: Object.freeze(["Requirement", "NonFunctionalRequirement", "Artifact", "Section", "Component"]) }),
  schedules: Object.freeze({ from: Object.freeze(["Artifact", "Section"]), to: "requirement_scenario_symbol_test" }),
  specifies: Object.freeze({ from: Object.freeze(["SSpecScenario"]), to: Object.freeze(["Requirement", "NonFunctionalRequirement"]) }),
  implements: Object.freeze({ from: Object.freeze(["SourceSymbol"]), to: Object.freeze(["Requirement", "NonFunctionalRequirement", "SSpecScenario", "Artifact", "Section"]) }),
  verifies: Object.freeze({ from: TEST_NODE_KINDS, to: Object.freeze(["Requirement", "NonFunctionalRequirement", "SSpecScenario", "SourceSymbol"]) }),
  covers: Object.freeze({ from: TEST_NODE_KINDS, to: Object.freeze(["SourceSymbol", "Artifact"]) }),
  links_to: Object.freeze({ from: "any", to: "any" }),
  aliases: Object.freeze({ from: Object.freeze(["Alias"]), to: "any_except_alias" }),
  supersedes: Object.freeze({ from: Object.freeze(["Artifact", "Section", "Requirement", "NonFunctionalRequirement"]), to: "same_as_from" }),
  extends: Object.freeze({ from: Object.freeze(["Project", "Artifact"]), to: Object.freeze(["Project", "Artifact"]) }),
  depends_on: Object.freeze({ from: Object.freeze(["Project", "Artifact"]), to: Object.freeze(["Project", "Artifact"]) }),
  mounted_as: Object.freeze({ from: Object.freeze(["ProjectRelation"]), to: Object.freeze(["Mount"]) })
});

function endpointRuleAccepts(rule, kind, otherKind = null) {
  if (Array.isArray(rule)) return rule.includes(kind);
  if (rule === "any") return true;
  if (rule === "any_except_workspace_worktree") return !["Workspace", "Worktree"].includes(kind);
  if (rule === "any_except_alias") return kind !== "Alias";
  if (rule === "classification") return CLASSIFICATION_NODE_KINDS.includes(kind);
  if (rule === "requirement_scenario_symbol_test") return ["Requirement", "NonFunctionalRequirement", "SSpecScenario", "SourceSymbol", ...TEST_NODE_KINDS].includes(kind);
  if (rule === "same_as_from") return kind === otherKind;
  return false;
}

export function validateEdgeEndpointKinds(edgeType, fromKind, toKind) {
  const type = normalizeEnum(edgeType, WAVE3_EDGE_TYPES, "edge_type");
  const rule = EDGE_ENDPOINT_KINDS[type];
  if (!rule || !endpointRuleAccepts(rule.from, fromKind) || !endpointRuleAccepts(rule.to, toKind, fromKind)) {
    throw new TypeError(`unsupported endpoint kinds for ${type}: ${fromKind} -> ${toKind}`);
  }
  return true;
}

function exact(value, fields, name) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join("\0") !== [...fields].sort().join("\0")) throw new TypeError(`${name} fields must match the canonical schema exactly`);
}
function legacyGenerator(value) {
  if (value == null) return null;
  return immutableRecord({ id: normalizeText(value.id, "generator.id"), version: normalizeText(String(value.version), "generator.version"), rule: normalizeText(value.rule, "generator.rule"), input_snapshot: normalizeText(value.input_snapshot, "generator.input_snapshot") });
}
export function createGeneratorEvidence(value) {
  if (value == null) return null;
  exact(value, ["generator_id", "version", "rule", "input_snapshot_uid"], "generator");
  if (!/^spks1-[a-f0-9]{64}$/.test(value.input_snapshot_uid)) throw new TypeError("generator.input_snapshot_uid must be a snapshot UID");
  return immutableRecord({ generator_id: normalizeText(value.generator_id, "generator.generator_id"), version: normalizeText(value.version, "generator.version"), rule: normalizeText(value.rule, "generator.rule"), input_snapshot_uid: value.input_snapshot_uid });
}
export function createEdgeProvenance(value) {
  exact(value, ["project_uid", "worktree_uid", "revision_id", "input_snapshot_uid", "source_uid", "source_location", "decision_uid"], "provenance");
  if (!/^spks1-[a-f0-9]{64}$/.test(value.input_snapshot_uid)) throw new TypeError("provenance.input_snapshot_uid must be a snapshot UID");
  return immutableRecord({ project_uid: assertCanonicalUid(value.project_uid, "provenance.project_uid", ["P"]), worktree_uid: assertCanonicalUid(value.worktree_uid, "provenance.worktree_uid", ["WT"]), revision_id: normalizeRevision(value.revision_id, "provenance.revision_id"), input_snapshot_uid: value.input_snapshot_uid, source_uid: value.source_uid == null ? null : assertCanonicalUid(value.source_uid, "provenance.source_uid"), source_location: value.source_location == null ? null : createSourceLocation(value.source_location), decision_uid: value.decision_uid == null ? null : assertCanonicalUid(value.decision_uid, "provenance.decision_uid", ["D"]) });
}
export function createEdgeAuthority(value) {
  if (value == null) return null;
  exact(value, ["kind", "receipt_uid", "policy_hash", "policy_version"], "authority");
  return immutableRecord({ kind: normalizeEnum(value.kind, ["explicit_review", "trusted_generator"], "authority.kind"), receipt_uid: assertCanonicalUid(value.receipt_uid, "authority.receipt_uid", ["D"]), policy_hash: normalizeHash(value.policy_hash, "authority.policy_hash"), policy_version: requireInteger(value.policy_version, "authority.policy_version", { max: 4294967295 }) });
}
function validateCommon(record, wave3) {
  if (record.from_uid === record.to_uid && record.edge_type !== "links_to") throw new TypeError("an edge cannot connect a node to itself");
  if (record.origin === "generated" && record.generator == null) throw new TypeError("generated edges require generator metadata");
  if (record.origin !== "generated" && record.generator != null) throw new TypeError("only generated edges may carry generator metadata");
  if (record.status === "accepted" && (isProvisionalArtifactUid(record.from_uid) || isProvisionalArtifactUid(record.to_uid))) throw new TypeError("accepted trace edges cannot target provisional identity");
  if (wave3 && record.origin.endsWith("_inference") && record.status === "accepted") throw new TypeError("inferred edges cannot become accepted evidence");
}
function createLegacyEdgeRecord(input) {
  const origin = normalizeEnum(input.origin, EDGE_ORIGINS, "origin");
  const record = { type: "edge", uid: assertUid(input.uid, "uid", ["E"]), edge_type: normalizeEnum(input.edge_type ?? input.relation ?? input.kind, EDGE_TYPES, "edge_type"), from_uid: assertUid(input.from_uid ?? input.from, "from_uid"), to_uid: assertUid(input.to_uid ?? input.to, "to_uid"), origin, status: normalizeEnum(input.status ?? "proposed", EDGE_STATUSES, "status"), confidence_milli: requireInteger(input.confidence_milli ?? 0, "confidence_milli", { max: 1000 }), created_by: normalizeText(input.created_by ?? "system", "created_by"), created_at_revision: normalizeRevision(input.created_at_revision, "created_at_revision"), evidence_uids: sortedUnique(input.evidence_uids, "evidence_uids", (item) => assertUid(item, "evidence_uid")), generator: legacyGenerator(input.generator) };
  validateCommon(record, false);
  return immutableRecord(record);
}
export function createEdgeRecord(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("edge must be an object");
  if (input.schema_version == null) return createLegacyEdgeRecord(input);
  exact(input, ["schema_version", "type", "uid", "edge_type", "from_uid", "to_uid", "origin", "status", "confidence_milli", "created_by", "created_at_revision", "evidence_uids", "generator", "provenance", "authority"], "edge");
  if (input.schema_version !== 2 || input.type !== "edge") throw new TypeError("Wave 3 edges require schema_version 2 and type edge");
  const origin = normalizeEnum(input.origin, EDGE_ORIGINS, "origin");
  const provenance = createEdgeProvenance(input.provenance);
  const authority = createEdgeAuthority(input.authority);
  const record = { schema_version: 2, type: "edge", uid: assertCanonicalUid(input.uid, "uid", ["E"]), edge_type: normalizeEnum(input.edge_type, WAVE3_EDGE_TYPES, "edge_type"), from_uid: assertCanonicalUid(input.from_uid, "from_uid"), to_uid: assertCanonicalUid(input.to_uid, "to_uid"), origin, status: normalizeEnum(input.status, EDGE_STATUSES, "status"), confidence_milli: requireInteger(input.confidence_milli, "confidence_milli", { max: 1000 }), created_by: normalizeText(input.created_by, "created_by"), created_at_revision: normalizeRevision(input.created_at_revision, "created_at_revision"), evidence_uids: sortedUnique(input.evidence_uids, "evidence_uids", (item) => assertCanonicalUid(item, "evidence_uid")), generator: createGeneratorEvidence(input.generator), provenance, authority };
  validateCommon(record, true);
  if (authority != null) {
    if (record.status !== "accepted" || !["explicit", "generated"].includes(origin)) throw new TypeError("authority is valid only for accepted explicit/generated edges");
    if (provenance.decision_uid !== authority.receipt_uid) throw new TypeError("authority receipt must equal provenance decision_uid");
    if ((origin === "explicit") !== (authority.kind === "explicit_review")) throw new TypeError("authority kind must match edge origin");
  } else if (provenance.decision_uid != null) throw new TypeError("decision_uid requires authority");
  return immutableRecord(record);
}

/**
 * Derive identity for one canonical extraction occurrence.  Semantic duplicate
 * edges at distinct source spans remain distinct multigraph records.
 */
export function deriveEdgeUid(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("edge occurrence must be an object");
  const provenance = createEdgeProvenance(input.provenance);
  const source_location = createSourceLocation(input.source_location ?? provenance.source_location);
  if (provenance.source_location == null) throw new TypeError("edge occurrence provenance requires source_location");
  if (provenance.source_uid == null) throw new TypeError("edge occurrence provenance requires source_uid");
  if (provenance.input_snapshot_uid !== input.input_snapshot_uid) throw new TypeError("edge occurrence snapshot must equal provenance input snapshot");
  if (source_location.source_artifact_uid !== provenance.source_location.source_artifact_uid ||
      source_location.source_hash !== provenance.source_location.source_hash ||
      source_location.span.start_byte !== provenance.source_location.span.start_byte ||
      source_location.span.end_byte !== provenance.source_location.span.end_byte) throw new TypeError("edge occurrence location must equal provenance source_location");
  const tuple = [
    provenance.input_snapshot_uid, provenance.source_uid, source_location,
    normalizeEnum(input.edge_type, WAVE3_EDGE_TYPES, "edge_type"),
    assertCanonicalUid(input.from_uid, "from_uid"), assertCanonicalUid(input.to_uid, "to_uid"),
    normalizeEnum(input.origin, EDGE_ORIGINS, "origin"), provenance
  ];
  const bytes = Buffer.concat([Buffer.from("spipe-edge-occurrence-v1\0", "utf8"), canonicalBytes(tuple)]);
  return `E-${crockfordDigestPayload(bytes)}`;
}

/** Resolve an extraction candidate into a canonical proposed EdgeRecord. */
export function materializeProposedEdge(candidate, { to_uid = null, explicit_uid = null } = {}) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new TypeError("edge candidate must be an object");
  if ((candidate.status ?? "proposed") !== "proposed" || candidate.authority != null || candidate.provenance?.decision_uid != null) throw new TypeError("candidate materialization accepts proposed non-authoritative edges only");
  const resolvedTo = assertCanonicalUid(to_uid ?? candidate.to_uid ?? candidate.target_ref, "to_uid");
  const occurrence = { input_snapshot_uid: candidate.provenance?.input_snapshot_uid, source_location: candidate.provenance?.source_location,
    edge_type: candidate.edge_type, from_uid: candidate.from_uid, to_uid: resolvedTo, origin: candidate.origin, provenance: candidate.provenance };
  const supplied = explicit_uid ?? candidate.uid ?? null;
  const uid = supplied == null ? deriveEdgeUid(occurrence) : assertCanonicalUid(supplied, "explicit_uid", ["E"]);
  return createEdgeRecord({ schema_version: 2, type: "edge", uid, edge_type: candidate.edge_type, from_uid: candidate.from_uid, to_uid: resolvedTo,
    origin: candidate.origin, status: "proposed", confidence_milli: candidate.confidence_milli, created_by: candidate.created_by,
    created_at_revision: candidate.created_at_revision, evidence_uids: candidate.evidence_uids ?? [], generator: candidate.generator ?? null,
    provenance: candidate.provenance, authority: null });
}
export function isStrictEvidence(edge, verifyReceipt = null) {
  if (edge?.schema_version == null) return false;
  return edge?.schema_version === 2 && edge.status === "accepted" && edge.authority != null && edge.provenance?.decision_uid === edge.authority.receipt_uid && ["explicit", "generated"].includes(edge.origin) && typeof verifyReceipt === "function" && verifyReceipt(edge) === true;
}
export function edgeSortKey(edge) { return `${edge.from_uid}\u0000${edge.edge_type}\u0000${edge.to_uid}\u0000${edge.uid}`; }
export function sortEdges(edges) { if (!Array.isArray(edges)) throw new TypeError("edges must be an array"); return [...edges].sort((a, b) => compareLexical(edgeSortKey(a), edgeSortKey(b))); }
export function inverseEdgeType(edgeType) { normalizeEnum(edgeType, EDGE_TYPES, "edge_type"); return Object.freeze({ type: "inverse", of: edgeType }); }
export const TraceEdge = createEdgeRecord;
