import {
  assertUid,
  assertCanonicalUid,
  createSnapshotId,
  immutableRecord,
  normalizeHash,
  normalizeRevision,
  normalizeText,
  sortedUnique
} from "./identity.js";
import { sortArtifacts } from "./artifact.js";
import { sortEdges } from "./edge.js";
import { sortSections } from "./section.js";
import { createGraphDelta as createWave3GraphDelta } from "../graph/delta.js";

function hashes(value, field) {
  return sortedUnique(value, field, (item) => normalizeHash(item, `${field} entry`));
}

export function createSnapshotManifest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("snapshot manifest must be an object");
  const tuple = input.snapshot_tuple ?? {
    project_uid: input.project_uid,
    worktree_uid: input.worktree_uid,
    revision_id: input.revision_id,
    base_generation_hash: input.base_generation_hash,
    overlay_generation_hash: input.overlay_generation_hash,
    schema_version: input.schema_version,
    parser_version: input.parser_version,
    analyzer_version: input.analyzer_version,
    provider_contract_version: input.provider_contract_version,
    policy_hash: input.policy_hash
  };
  const derivedSnapshotUid = createSnapshotId(tuple);
  const record = {
    type: "snapshot_manifest",
    schema: 1,
    snapshot_uid: input.snapshot_uid ?? derivedSnapshotUid,
    project_uid: assertCanonicalUid(input.project_uid ?? tuple.project_uid, "project_uid", ["P"]),
    worktree_uid: assertCanonicalUid(input.worktree_uid ?? tuple.worktree_uid, "worktree_uid", ["W"]),
    revision_id: normalizeRevision(input.revision_id ?? tuple.revision_id, "revision_id"),
    base_segments: hashes(input.base_segments, "base_segments"),
    overlay_segment: input.overlay_segment == null ? null : normalizeHash(input.overlay_segment, "overlay_segment"),
    alias_root: normalizeHash(input.alias_root, "alias_root"),
    graph_root: normalizeHash(input.graph_root, "graph_root"),
    lexical_root: normalizeHash(input.lexical_root, "lexical_root"),
    projection_root: normalizeHash(input.projection_root, "projection_root"),
    diagnostics_root: normalizeHash(input.diagnostics_root, "diagnostics_root"),
    config_hash: normalizeHash(input.config_hash, "config_hash"),
    parser_set_hash: normalizeHash(input.parser_set_hash, "parser_set_hash")
  };
  if (record.snapshot_uid !== derivedSnapshotUid) throw new TypeError("snapshot_uid does not match snapshot_v1 tuple");
  return immutableRecord(record);
}

export function createArtifactDelta(input = {}) {
  const candidates = (values, field) => Object.freeze([...(values ?? [])].map((item) => {
    if (!item || typeof item !== "object" || typeof item.candidate_id !== "string") throw new TypeError(`${field} entries require candidate_id`);
    return immutableRecord({ ...item });
  }).sort((a, b) => a.candidate_id.localeCompare(b.candidate_id)));
  return immutableRecord({
    type: "artifact_delta",
    added: Object.freeze(sortArtifacts(input.added ?? [])),
    updated: Object.freeze(sortArtifacts(input.updated ?? [])),
    removed_uids: sortedUnique(input.removed_uids, "removed_uids", (item) => assertUid(item, "removed_uid", ["A", "P"])),
    sections_added: Object.freeze(sortSections(input.sections_added ?? [])),
    sections_updated: Object.freeze(sortSections(input.sections_updated ?? [])),
    sections_removed_uids: sortedUnique(input.sections_removed_uids, "sections_removed_uids", (item) => assertUid(item, "section_uid", ["S"]))
    ,section_candidates_added: candidates(input.section_candidates_added, "section_candidates_added")
    ,section_candidates_updated: candidates(input.section_candidates_updated, "section_candidates_updated")
    ,section_candidates_removed_ids: sortedUnique(input.section_candidates_removed_ids, "section_candidates_removed_ids", (item) => normalizeText(item, "candidate_id"))
  });
}

export function createGraphDelta(input = {}) {
  if (input?.base_snapshot_uid !== undefined || input?.base_graph_root !== undefined || input?.nodes !== undefined || input?.edges !== undefined) {
    return createWave3GraphDelta(input);
  }
  return immutableRecord({
    type: "graph_delta",
    added: Object.freeze(sortEdges(input.added ?? [])),
    updated: Object.freeze(sortEdges(input.updated ?? [])),
    removed_uids: sortedUnique(input.removed_uids, "removed_uids", (item) => assertUid(item, "removed_uid", ["E"]))
  });
}

export function createIndexDelta(input = {}) {
  const normalizeDocumentId = (item) => normalizeText(item, "document_id");
  return immutableRecord({
    type: "index_delta",
    added_document_ids: sortedUnique(input.added_document_ids, "added_document_ids", normalizeDocumentId),
    updated_document_ids: sortedUnique(input.updated_document_ids, "updated_document_ids", normalizeDocumentId),
    removed_document_ids: sortedUnique(input.removed_document_ids, "removed_document_ids", normalizeDocumentId)
  });
}

export function createKnowledgeDelta(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("knowledge delta must be an object");
  const artifactDelta = createArtifactDelta(input.artifacts ?? input.artifact_delta);
  const graphDelta = createGraphDelta(input.graph ?? input.graph_delta);
  const indexDelta = createIndexDelta(input.index ?? input.index_delta);
  const record = {
    type: "knowledge_delta",
    base_snapshot_uid: normalizeText(input.base_snapshot_uid, "base_snapshot_uid"),
    project_uid: assertCanonicalUid(input.project_uid, "project_uid", ["P"]),
    revision_id: normalizeRevision(input.revision_id, "revision_id"),
    artifacts: artifactDelta,
    graph: graphDelta,
    index: indexDelta,
    aliases_changed: sortedUnique(input.aliases_changed, "aliases_changed", (item) => normalizeText(item, "alias")),
    projection_invalidations: sortedUnique(input.projection_invalidations, "projection_invalidations", (item) => normalizeText(item, "projection_invalidation")),
    diagnostics: Object.freeze([...(input.diagnostics ?? [])])
  };
  return immutableRecord(record);
}

export const SnapshotManifest = createSnapshotManifest;
export const KnowledgeDelta = createKnowledgeDelta;
