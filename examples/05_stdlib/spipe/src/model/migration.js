import { assertCanonicalUid, assertUid, canonicalBytes, contentHash, crockfordDigestPayload, immutableRecord, normalizeEnum, normalizeHash } from "./identity.js";
import { createEdgeRecord, validateEdgeEndpointKinds, WAVE3_EDGE_TYPES } from "./edge.js";

export const HISTORICAL_EDGE_REASONS = Object.freeze(["deferred_edge_type", "missing_endpoint", "unsupported_endpoint_kind", "identity_mapping_missing", "identity_mapping_ambiguous"]);

export function deriveMigratedIdentityUid(old_uid, old_record_type) {
  assertCanonicalUid(old_uid, "old_uid", ["W"]);
  const type = normalizeEnum(old_record_type, ["workspace", "worktree"], "old_record_type");
  const bytes = Buffer.from(`spipe-identity-migration-v1\0${type}\0${old_uid}`, "utf8");
  return `${type === "workspace" ? "WS" : "WT"}-${crockfordDigestPayload(bytes)}`;
}

export function createIdentityMigrationRecord(input) {
  const fields = ["type", "old_uid", "old_record_type", "new_uid", "migrated_in_snapshot_uid"];
  if (!input || Object.keys(input).sort().join("\0") !== fields.sort().join("\0")) throw new TypeError("identity migration fields must match exactly");
  const old_uid = assertCanonicalUid(input.old_uid, "old_uid", ["W"]);
  const old_record_type = normalizeEnum(input.old_record_type, ["workspace", "worktree"], "old_record_type");
  const new_uid = assertCanonicalUid(input.new_uid, "new_uid", [old_record_type === "workspace" ? "WS" : "WT"]);
  if (new_uid !== deriveMigratedIdentityUid(old_uid, old_record_type)) throw new TypeError("new_uid does not match identity migration derivation");
  if (input.type !== "identity_migration" || !/^spks1-[a-f0-9]{64}$/.test(input.migrated_in_snapshot_uid)) throw new TypeError("invalid identity migration type or snapshot UID");
  return immutableRecord({ type: "identity_migration", old_uid, old_record_type, new_uid, migrated_in_snapshot_uid: input.migrated_in_snapshot_uid });
}

export function createEdgeMigrationRecord(input) {
  const record = { type: "edge_migration", edge_uid: assertUid(input.edge_uid, "edge_uid", ["E"]), source_snapshot_uid: input.source_snapshot_uid,
    source_edge_hash: normalizeHash(input.source_edge_hash, "source_edge_hash"), target_edge_hash: normalizeHash(input.target_edge_hash, "target_edge_hash") };
  if (!/^spks1-[a-f0-9]{64}$/.test(record.source_snapshot_uid)) throw new TypeError("invalid source snapshot UID");
  return immutableRecord(record);
}

export function createHistoricalEdgeRecord(input) {
  if (!/^spks1-[a-f0-9]{64}$/.test(input.source_snapshot_uid)) throw new TypeError("invalid source snapshot UID");
  return immutableRecord({ schema_version: 2, type: "historical_edge", source_snapshot_uid: input.source_snapshot_uid,
    source_edge_hash: normalizeHash(input.source_edge_hash, "source_edge_hash"), reason: normalizeEnum(input.reason, HISTORICAL_EDGE_REASONS, "reason"), original_edge: immutableRecord({ ...input.original_edge }) });
}

export function hashEdgeWrapper(edge, version) {
  return contentHash(Buffer.concat([Buffer.from(`spipe-edge-v${version}\0`, "utf8"), canonicalBytes(edge)]));
}

function translatedUid(uid, kind, migrations) {
  if (!String(uid).startsWith("W-")) return { uid };
  const old_record_type = kind === "Workspace" ? "workspace" : kind === "Worktree" ? "worktree" : null;
  if (old_record_type == null) return { reason: "unsupported_endpoint_kind" };
  const matches = migrations.filter((item) => item.old_uid === uid && item.old_record_type === old_record_type);
  if (matches.length === 0) return { reason: "identity_mapping_missing" };
  if (matches.length !== 1) return { reason: "identity_mapping_ambiguous" };
  return { uid: matches[0].new_uid };
}

/** Deterministically wrap one immutable schema-v1 edge for a schema-v2 graph. */
export function migrateV1Edge({ edge, manifest, identity_migrations = [], endpoint_kinds = {} }) {
  if (!edge || edge.schema_version != null || edge.type !== "edge") throw new TypeError("migrateV1Edge requires an immutable schema-v1 edge");
  const source_snapshot_uid = manifest?.snapshot_uid;
  if (!/^spks1-[a-f0-9]{64}$/.test(source_snapshot_uid)) throw new TypeError("manifest snapshot binding is required");
  const source_edge_hash = hashEdgeWrapper(edge, 1);
  const historical = (reason) => immutableRecord({ historical: createHistoricalEdgeRecord({ source_snapshot_uid, source_edge_hash, reason, original_edge: edge }), migration: null, edge: null });
  if (!WAVE3_EDGE_TYPES.includes(edge.edge_type)) return historical("deferred_edge_type");
  const fromKind = endpoint_kinds[edge.from_uid];
  const toKind = endpoint_kinds[edge.to_uid];
  if (!fromKind || !toKind) return historical("missing_endpoint");
  const from = translatedUid(edge.from_uid, fromKind, identity_migrations);
  const to = translatedUid(edge.to_uid, toKind, identity_migrations);
  if (from.reason || to.reason) return historical(from.reason ?? to.reason);
  const provenanceWorktree = translatedUid(manifest.worktree_uid, "Worktree", identity_migrations);
  if (provenanceWorktree.reason) return historical(provenanceWorktree.reason);
  try { validateEdgeEndpointKinds(edge.edge_type, fromKind, toKind); }
  catch { return historical("unsupported_endpoint_kind"); }
  const evidence = [...(edge.evidence_uids ?? [])].sort();
  const generator = edge.generator == null ? null : { generator_id: edge.generator.id, version: edge.generator.version, rule: edge.generator.rule, input_snapshot_uid: edge.generator.input_snapshot };
  const migrated = createEdgeRecord({ schema_version: 2, type: "edge", uid: edge.uid, edge_type: edge.edge_type, from_uid: from.uid, to_uid: to.uid,
    origin: edge.origin, status: edge.status, confidence_milli: edge.confidence_milli, created_by: edge.created_by, created_at_revision: edge.created_at_revision,
    evidence_uids: evidence, generator, provenance: { project_uid: manifest.project_uid, worktree_uid: provenanceWorktree.uid, revision_id: manifest.revision_id,
      input_snapshot_uid: source_snapshot_uid, source_uid: evidence[0] ?? null, source_location: null, decision_uid: null }, authority: null });
  const target_edge_hash = hashEdgeWrapper(migrated, 2);
  return immutableRecord({ edge: migrated, migration: createEdgeMigrationRecord({ edge_uid: migrated.uid, source_snapshot_uid, source_edge_hash, target_edge_hash }), historical: null });
}
