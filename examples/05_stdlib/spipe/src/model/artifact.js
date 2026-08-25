import {
  TRUST_SCOPES,
  VISIBILITIES,
  assertUid,
  assertCanonicalUid,
  assertUidPrefix,
  isProvisionalArtifactUid,
  compareLexical,
  immutableRecord,
  normalizeCanonicalPath,
  normalizeEnum,
  normalizeHash,
  normalizeOptionalHash,
  normalizeRevision,
  normalizeSemanticKey,
  normalizeText,
  sortedUnique
} from "./identity.js";

export const ARTIFACT_KINDS = Object.freeze([
  "research", "requirements", "plan", "architecture", "design", "spec",
  "guide", "tracking", "report", "source", "test", "result", "common_knowledge"
]);
export const ARTIFACT_STATUSES = Object.freeze([
  "draft", "proposed", "approved", "implemented", "verified", "stale", "deprecated"
]);
export const IDENTITY_STATUSES = Object.freeze(["canonical", "provisional"]);

function aliases(value) {
  return sortedUnique(value, "aliases", (item) => normalizeText(item, "alias").trim());
}

function tags(value, field) {
  return sortedUnique(value, field, (item) => normalizeSemanticKey(item, `${field} entry`));
}

function parserInfo(value) {
  if (value == null) return Object.freeze({ id: "unknown", version: "0" });
  if (typeof value !== "object" || Array.isArray(value)) throw new TypeError("parser must be an object");
  return Object.freeze({
    id: normalizeSemanticKey(value.id, "parser.id"),
    version: normalizeText(String(value.version), "parser.version")
  });
}

export function createArtifactRecord(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("artifact must be an object");
  }
  const identityStatus = normalizeEnum(input.identity_status ?? "canonical", IDENTITY_STATUSES, "identity_status");
  const uid = identityStatus === "provisional"
    ? assertUid(input.uid, "uid", ["P"])
    : assertCanonicalUid(input.uid, "uid", ["A"]);
  const record = {
    type: "artifact",
    uid,
    identity_status: identityStatus,
    key: normalizeSemanticKey(input.key, "key"),
    project_uid: assertCanonicalUid(input.project_uid, "project_uid", ["P"]),
    revision: normalizeRevision(input.revision, "revision"),
    kind: normalizeEnum(input.kind, ARTIFACT_KINDS, "kind"),
    title: normalizeText(input.title, "title").trim(),
    canonical_path: normalizeCanonicalPath(input.canonical_path, "canonical_path"),
    content_hash: normalizeHash(input.content_hash, "content_hash"),
    features: tags(input.features, "features"),
    components: tags(input.components, "components"),
    layers: tags(input.layers, "layers"),
    visibility: normalizeEnum(input.visibility ?? "project", VISIBILITIES, "visibility"),
    trust_scope: normalizeEnum(input.trust_scope ?? input.trust ?? "untrusted_data", TRUST_SCOPES, "trust_scope"),
    status: normalizeEnum(input.status ?? "draft", ARTIFACT_STATUSES, "status"),
    aliases: aliases(input.aliases),
    parser: parserInfo(input.parser),
    source_hash: normalizeOptionalHash(input.source_hash, "source_hash")
  };
  if (!record.title) throw new TypeError("artifact title must not be empty");
  if (record.identity_status === "provisional" && !isProvisionalArtifactUid(record.uid)) {
    throw new TypeError("provisional artifact identity must use the exact P-<project-uid>-<content-hash> form");
  }
  return immutableRecord(record);
}

export function createProvisionalArtifactRecord(input) {
  return createArtifactRecord({ ...input, identity_status: "provisional" });
}

export function isDurableArtifact(record) {
  return record?.type === "artifact" && record.identity_status === "canonical" && record.uid.startsWith("A-");
}

export function artifactSortKey(record) {
  return `${record.project_uid}\u0000${record.canonical_path}\u0000${record.uid}`;
}

export function sortArtifacts(records) {
  if (!Array.isArray(records)) throw new TypeError("artifacts must be an array");
  return [...records].sort((left, right) => compareLexical(artifactSortKey(left), artifactSortKey(right)));
}

// Kept as an explicit alias for callers that use the architecture vocabulary.
export const ArtifactRecord = createArtifactRecord;
