import {
  VISIBILITIES,
  assertUid,
  assertCanonicalUid,
  compareLexical,
  createProjectionUid,
  immutableRecord,
  normalizeCanonicalPath,
  normalizeEnum,
  normalizeHash,
  normalizeSemanticKey,
  normalizeText,
  requireInteger,
  sortedUnique
} from "./identity.js";

export const VIEW_KINDS = Object.freeze([
  "lifecycle", "feature", "component", "layer", "matrix", "trace",
  "project", "status", "diagnostics"
]);
export const VIEW_ENTRY_KINDS = Object.freeze(["artifact", "section", "directory", "aggregate"]);

function filters(value) {
  if (value == null) return Object.freeze({});
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("view filters must be an object");
  const result = {};
  for (const key of Object.keys(value).sort()) {
    const item = value[key];
    if (Array.isArray(item)) result[key] = sortedUnique(item, `filters.${key}`, (part) => normalizeText(part, `filters.${key}`));
    else result[key] = normalizeText(String(item), `filters.${key}`);
  }
  return Object.freeze(result);
}

export function createViewRecord(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("view must be an object");
  const record = {
    type: "view",
    key: normalizeSemanticKey(input.key, "key"),
    kind: normalizeEnum(input.kind, VIEW_KINDS, "kind"),
    title: normalizeText(input.title ?? input.key, "title").trim(),
    root_path: normalizeCanonicalPath(input.root_path ?? input.key.replaceAll(".", "/"), "root_path"),
    visibility: normalizeEnum(input.visibility ?? "project", VISIBILITIES, "visibility"),
    read_only: true,
    filters: filters(input.filters),
    page_size: requireInteger(input.page_size ?? 100, "page_size", { min: 1, max: 1000 })
  };
  if (input.read_only === false) throw new TypeError("virtual views are always read-only");
  return immutableRecord(record);
}

export function createProjectionRecord(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("projection must be an object");
  const entryKind = normalizeEnum(input.entry_kind ?? "artifact", VIEW_ENTRY_KINDS, "entry_kind");
  const aggregate = entryKind === "directory" || entryKind === "aggregate";
  const record = {
    type: "projection",
    uid: createProjectionUid({
      workspace_uid: input.workspace_uid,
      snapshot_id: input.snapshot_id,
      view_kind: input.view_kind,
      normalized_logical_path: input.logical_path,
      normalized_parameters_hash: input.parameters_hash,
      effective_auth_scope_hash: input.auth_scope_hash,
      page_start_key: input.page_start_key ?? ""
    }),
    workspace_uid: assertCanonicalUid(input.workspace_uid, "workspace_uid", ["W"]),
    snapshot_id: normalizeText(input.snapshot_id, "snapshot_id"),
    view_kind: normalizeEnum(input.view_kind, VIEW_KINDS, "view_kind"),
    logical_path: normalizeCanonicalPath(input.logical_path, "logical_path"),
    entry_kind: entryKind,
    canonical_uid: aggregate ? null : assertUid(input.canonical_uid, "canonical_uid", ["A", "S", "P"]),
    parameters_hash: normalizeHash(input.parameters_hash, "parameters_hash"),
    auth_scope_hash: normalizeHash(input.auth_scope_hash, "auth_scope_hash"),
    page_start_key: input.page_start_key == null ? "" : normalizeText(input.page_start_key, "page_start_key"),
    page_end_key: input.page_end_key == null ? null : normalizeText(input.page_end_key, "page_end_key"),
    generated: input.generated !== false
  };
  return immutableRecord(record);
}

export function virtualSlug(title) {
  const slug = normalizeText(title, "title").trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!slug) throw new TypeError("title must contain an alphanumeric character");
  return slug;
}

export function virtualFilename(title, uid, collision = false) {
  const slug = virtualSlug(title);
  if (!collision) return `${slug}.md`;
  return `${slug}--${assertUid(uid, "uid")}.md`;
}

export function collisionAwareFilenames(entries) {
  if (!Array.isArray(entries)) throw new TypeError("entries must be an array");
  const groups = new Map();
  for (const entry of entries) {
    const slug = virtualSlug(entry.title);
    const list = groups.get(slug) ?? [];
    list.push(entry);
    groups.set(slug, list);
  }
  const result = new Map();
  for (const [slug, list] of groups) {
    const collision = list.length > 1;
    for (const entry of list.sort((a, b) => compareLexical(assertUid(a.uid), assertUid(b.uid)))) {
      result.set(entry.uid, collision ? `${slug}--${assertUid(entry.uid)}.md` : `${slug}.md`);
    }
  }
  return result;
}

export const ViewRecord = createViewRecord;
