import { TRUST_SCOPES, VISIBILITIES, assertCanonicalUid, canonicalBytes, crockfordDigestPayload, immutableRecord, normalizeEnum, normalizeHash, normalizeRevision } from "./identity.js";

export const NODE_KINDS = Object.freeze(["Workspace", "Worktree", "Project", "ProjectRelation", "Mount", "Alias", "Artifact", "Section", "Requirement", "NonFunctionalRequirement", "SSpecScenario", "SourceSymbol", "UnitTest", "IntegrationTest", "SystemTest", "Feature", "Component", "Layer", "Tag"]);
export const RECORD_TYPES = Object.freeze(["workspace", "worktree", "project", "project_relation", "mount_projection", "alias_projection", "artifact", "section", "requirement", "non_functional_requirement", "sspec_scenario", "source_symbol", "test", "classification"]);
export const NODE_STATUSES = Object.freeze(["candidate", "proposed", "accepted", "deprecated", "active", "unavailable", "draft", "approved", "designed", "specified", "implemented", "verified", "superseded", "stale"]);

const PREFIXES = Object.freeze({ Workspace:["WS"], Worktree:["WT"], Project:["P"], ProjectRelation:["R"], Mount:["M"], Alias:["AL"], Artifact:["A"], Section:["S"], Requirement:["RQ"], NonFunctionalRequirement:["NFR"], SSpecScenario:["SS"], SourceSymbol:["SY"], UnitTest:["T"], IntegrationTest:["T"], SystemTest:["T"], Feature:["F"], Component:["C"], Layer:["L"], Tag:["TG"] });
const RECORD_KIND = Object.freeze({ workspace:["Workspace"], worktree:["Worktree"], project:["Project"], project_relation:["ProjectRelation"], mount_projection:["Mount"], alias_projection:["Alias"], artifact:["Artifact"], section:["Section"], requirement:["Requirement"], non_functional_requirement:["NonFunctionalRequirement"], sspec_scenario:["SSpecScenario"], source_symbol:["SourceSymbol"], test:["UnitTest","IntegrationTest","SystemTest"], classification:["Feature","Component","Layer","Tag"] });

export function createGraphNode(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("graph node must be an object");
  const fields = ["uid", "node_kind", "project_uid", "revision_id", "record_type", "record_hash", "visibility", "trust_scope", "status"];
  if (Object.keys(input).sort().join("\0") !== fields.sort().join("\0")) throw new TypeError("graph node fields must match GraphNode exactly");
  const node_kind = normalizeEnum(input.node_kind, NODE_KINDS, "node_kind");
  const record_type = normalizeEnum(input.record_type, RECORD_TYPES, "record_type");
  if (!RECORD_KIND[record_type].includes(node_kind)) throw new TypeError("record_type cannot project to node_kind");
  return immutableRecord({
    uid: assertCanonicalUid(input.uid, "uid", PREFIXES[node_kind]), node_kind,
    project_uid: input.project_uid == null ? null : assertCanonicalUid(input.project_uid, "project_uid", ["P"]),
    revision_id: input.revision_id == null ? null : normalizeRevision(input.revision_id, "revision_id"), record_type,
    record_hash: normalizeHash(input.record_hash, "record_hash"), visibility: normalizeEnum(input.visibility, VISIBILITIES, "visibility"),
    trust_scope: normalizeEnum(input.trust_scope, TRUST_SCOPES, "trust_scope"), status: normalizeEnum(input.status, NODE_STATUSES, "status")
  });
}

function projectionUid(prefix, domain, tuple) {
  return `${prefix}-${crockfordDigestPayload(Buffer.concat([Buffer.from(`${domain}\0`, "utf8"), canonicalBytes(tuple)]))}`;
}
export function deriveAliasProjectionUid({ workspace_uid, project_uid = null, kind, alias, canonical_target_uid }) {
  return projectionUid("AL", "spipe-alias-projection-v1", [assertCanonicalUid(workspace_uid, "workspace_uid", ["WS"]), project_uid == null ? null : assertCanonicalUid(project_uid, "project_uid", ["P"]), String(kind).normalize("NFC"), String(alias).normalize("NFC"), assertCanonicalUid(canonical_target_uid, "canonical_target_uid")]);
}
export function deriveMountProjectionUid({ workspace_uid, relation_uid, linkage, mount, canonical_target_uid }) {
  return projectionUid("M", "spipe-mount-projection-v1", [assertCanonicalUid(workspace_uid, "workspace_uid", ["WS"]), assertCanonicalUid(relation_uid, "relation_uid", ["R"]), String(linkage).normalize("NFC"), String(mount).normalize("NFC"), assertCanonicalUid(canonical_target_uid, "canonical_target_uid")]);
}
