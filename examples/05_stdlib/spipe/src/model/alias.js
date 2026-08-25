import {
  assertUid,
  assertCanonicalUid,
  isProvisionalArtifactUid,
  compareLexical,
  immutableRecord,
  normalizeAlias,
  normalizeCanonicalPath,
  normalizeEnum,
  normalizeSemanticKey,
  normalizeText,
  sortedUnique
} from "./identity.js";

export const ALIAS_KINDS = Object.freeze([
  "artifact_key", "section_key", "heading_slug", "canonical_path", "feature",
  "component", "layer", "tag", "project_key"
]);
export const ALIAS_STATUSES = Object.freeze(["active", "deprecated"]);

function normalizeAliasValue(value, kind) {
  if (kind === "canonical_path") return normalizeCanonicalPath(value, "alias");
  if (["artifact_key", "section_key", "project_key"].includes(kind)) return normalizeSemanticKey(value, "alias");
  return normalizeAlias(value, "alias");
}

export function createAliasRecord(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("alias must be an object");
  const kind = normalizeEnum(input.kind, ALIAS_KINDS, "kind");
  const record = {
    type: "alias",
    value: normalizeAliasValue(input.value ?? input.alias, kind),
    kind,
    target_uid: assertUid(input.target_uid ?? input.target, "target_uid"),
    project_uid: input.project_uid == null ? null : assertCanonicalUid(input.project_uid, "project_uid", ["P"]),
    status: normalizeEnum(input.status ?? "active", ALIAS_STATUSES, "status"),
    created_at_revision: input.created_at_revision == null ? null : normalizeText(input.created_at_revision, "created_at_revision"),
    replaced_by: input.replaced_by == null ? null : normalizeAliasValue(input.replaced_by, kind)
  };
  if (isProvisionalArtifactUid(record.target_uid)) throw new TypeError("durable aliases cannot target provisional identity");
  return immutableRecord(record);
}

export class AliasRegistry {
  #byKey;

  constructor(records = []) {
    if (!Array.isArray(records)) throw new TypeError("alias records must be an array");
    const map = new Map();
    for (const input of records) {
      const record = input?.type === "alias" ? input : createAliasRecord(input);
      const key = aliasLookupKey(record.kind, record.value, record.project_uid);
      const existing = map.get(key);
      if (existing && existing.target_uid !== record.target_uid) {
        throw new TypeError(`ambiguous alias: ${record.value}`);
      }
      if (existing && existing.status !== record.status) {
        throw new TypeError(`conflicting alias status: ${record.value}`);
      }
      map.set(key, record);
    }
    this.#byKey = map;
    Object.freeze(this);
  }

  get size() { return this.#byKey.size; }

  resolve(value, kind, projectUid = null) {
    const normalizedKind = normalizeEnum(kind, ALIAS_KINDS, "kind");
    const normalizedValue = normalizeAliasValue(value, normalizedKind);
    const key = aliasLookupKey(normalizedKind, normalizedValue, projectUid);
    const record = this.#byKey.get(key);
    return record?.status === "active" ? record : null;
  }

  records() {
    return Object.freeze([...this.#byKey.values()].sort((left, right) => compareLexical(aliasSortKey(left), aliasSortKey(right))));
  }
}

export function aliasLookupKey(kind, value, projectUid = null) {
  return `${kind}\u0000${projectUid ?? "*"}\u0000${normalizeAliasValue(value, kind)}`;
}

function aliasSortKey(record) {
  return `${record.kind}\u0000${record.project_uid ?? "*"}\u0000${record.value}\u0000${record.target_uid}`;
}

export function sortAliases(records) {
  if (!Array.isArray(records)) throw new TypeError("aliases must be an array");
  return [...records].sort((left, right) => aliasSortKey(left).localeCompare(aliasSortKey(right)));
}

export const AliasRecord = createAliasRecord;
