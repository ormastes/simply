import { opaqueUid } from "../core/identity.js";
import { createProjectRelationRecord, projectRelationKey } from "../model/project_relation.js";

/**
 * Create the explicit semantic/physical relation record.  These fields are
 * intentionally separate: a gitlink can be semantically independent, and a
 * path mount can semantically extend another project.
 */
export function createProjectRelation(input) {
  if (!input || typeof input !== "object") throw new TypeError("relation must be an object");
  const fromProjectUid = String(input.fromProjectUid ?? input.from_project_uid ?? input.from ?? "");
  const toProjectUid = String(input.toProjectUid ?? input.to_project_uid ?? input.to ?? "");
  if (!fromProjectUid || !toProjectUid || fromProjectUid === toProjectUid) throw new TypeError("relation endpoints must be distinct");
  const semantic = input.semantic ?? "independent";
  const physical = input.physical ?? input.physical_linkage ?? input.linkage ?? "none";
  const trust = input.trust ?? "reviewed";
  const mount = input.mount === undefined || input.mount === null ? null : String(input.mount);
  const revision = input.revision === undefined || input.revision === null ? null : String(input.revision);
  const versionRelation = input.versionRelation ?? input.version_relation ?? (revision ? "pinned" : null);
  return createProjectRelationRecord({
    relation_uid: input.relationUid ?? input.relation_uid ?? opaqueUid("R"),
    from_project_uid: fromProjectUid,
    to_project_uid: toProjectUid,
    semantic,
    physical,
    revision,
    version_relation: versionRelation,
    mount,
    trust
  });
}

export function relationKey(relation) {
  return projectRelationKey(relation);
}

export function validateProjectRelation(relation) {
  return createProjectRelation(relation);
}
