import {
  assertCanonicalUid, immutableRecord, normalizeCanonicalPath, normalizeEnum,
  normalizeRevision
} from "./identity.js";

export const SEMANTIC_RELATIONS = Object.freeze(["independent", "dependent", "extends"]);
export const PHYSICAL_LINKAGES = Object.freeze(["none", "path", "symlink", "junction", "gitlink", "worktree", "package"]);
export const TRUST_RELATIONS = Object.freeze(["trusted", "reviewed", "untrusted"]);
export const VERSION_RELATIONS = Object.freeze(["commit", "tag", "range", "floating", "pinned"]);

export function createProjectRelationRecord(input) {
  if (!input || typeof input !== "object") throw new TypeError("project relation must be an object");
  const record = {
    type: "project_relation",
    relation_uid: assertCanonicalUid(input.relation_uid, "relation_uid", ["R"]),
    from_project_uid: assertCanonicalUid(input.from_project_uid, "from_project_uid", ["P"]),
    to_project_uid: assertCanonicalUid(input.to_project_uid, "to_project_uid", ["P"]),
    semantic: normalizeEnum(input.semantic ?? "independent", SEMANTIC_RELATIONS, "semantic"),
    physical: normalizeEnum(input.physical ?? "none", PHYSICAL_LINKAGES, "physical"),
    revision: input.revision == null ? null : normalizeRevision(input.revision, "revision"),
    version_relation: input.version_relation == null ? null : normalizeEnum(input.version_relation, VERSION_RELATIONS, "version_relation"),
    mount: input.mount == null ? null : normalizeCanonicalPath(input.mount, "mount"),
    trust: normalizeEnum(input.trust ?? "reviewed", TRUST_RELATIONS, "trust")
  };
  if (record.from_project_uid === record.to_project_uid) throw new TypeError("project relation endpoints must be distinct");
  return immutableRecord(record);
}

export function projectRelationKey(relation) {
  return [
    relation.from_project_uid, relation.to_project_uid, relation.semantic, relation.physical,
    relation.mount ?? "", relation.revision ?? "", relation.version_relation ?? "", relation.trust
  ].join("\u001f");
}

export const ProjectRelationRecord = createProjectRelationRecord;
