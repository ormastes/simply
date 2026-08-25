import {
  TRUST_SCOPES,
  VISIBILITIES,
  assertUid,
  assertCanonicalUid,
  immutableRecord,
  normalizeCanonicalPath,
  normalizeEnum,
  normalizeOptionalHash,
  normalizeRevision,
  normalizeSemanticKey,
  normalizeText,
  sortedUnique
} from "./identity.js";

export const PROJECT_STATUSES = Object.freeze(["active", "unavailable", "deprecated"]);

function normalizeAliases(value) {
  return sortedUnique(value, "aliases", (item) => normalizeText(item, "alias").trim());
}

export function createProjectRecord(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("project must be an object");
  }
  const uid = assertCanonicalUid(input.uid, "uid", ["P"]);
  const record = {
    type: "project",
    uid,
    key: normalizeSemanticKey(input.key, "key"),
    title: normalizeText(input.title ?? input.key, "title").trim(),
    root_path: input.root_path === "." ? "." : normalizeCanonicalPath(input.root_path, "root_path"),
    revision: normalizeRevision(input.revision, "revision"),
    trust_scope: normalizeEnum(input.trust_scope ?? "untrusted_data", TRUST_SCOPES, "trust_scope"),
    visibility: normalizeEnum(input.visibility ?? "project", VISIBILITIES, "visibility"),
    status: normalizeEnum(input.status ?? "active", PROJECT_STATUSES, "status"),
    aliases: normalizeAliases(input.aliases),
    metadata_hash: normalizeOptionalHash(input.metadata_hash, "metadata_hash")
  };
  return immutableRecord(record);
}
