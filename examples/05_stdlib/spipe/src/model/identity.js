import { createHash } from "node:crypto";

/**
 * Identity and canonicalization helpers shared by the Wave 2 model records.
 *
 * A path is deliberately never used as an identity.  The helpers in this
 * module only normalize names and validate already assigned opaque IDs; UID
 * assignment belongs to the registry/parser layer.
 */

export const UID_PREFIXES = Object.freeze([
  "A", "S", "SS", "SY", "E", "P", "W", "WS", "WT", "R", "RQ", "NFR",
  "T", "F", "C", "L", "TG", "AL", "M", "K", "V", "D"
]);

export const TRUST_SCOPES = Object.freeze([
  "untrusted_data", "reviewed_reference", "executable_policy"
]);

export const VISIBILITIES = Object.freeze([
  "public", "project", "private", "restricted"
]);

const UID_PATTERN = /^([A-Z][A-Z0-9]*)-([A-Za-z0-9_-]{1,190})$/;
const OPAQUE_PAYLOAD_PATTERN = /^(?:[0-9A-F]{32}|[0-9A-HJKMNP-TV-Z]{26})$/;
const PROVISIONAL_ARTIFACT_PATTERN = /^P-(P-(?:[0-9A-F]{32}|[0-9A-HJKMNP-TV-Z]{26}))-([a-f0-9]{64})$/;
const HASH_PATTERN = /^(?:sha256:)?[a-f0-9]{64}$/;
const REVISION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+\-/]{0,255}$/;

export class ModelValidationError extends TypeError {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ModelValidationError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export function fail(code, message, details) {
  throw new ModelValidationError(code, message, details);
}

export function requireString(value, field, { allowEmpty = false } = {}) {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
    fail("SPK001", `${field} must be a ${allowEmpty ? "string" : "non-empty string"}`, { field });
  }
  return value;
}

export function requireInteger(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail("SPK002", `${field} must be an integer in [${min}, ${max}]`, { field, value });
  }
  return value;
}

export function normalizeText(value, field) {
  requireString(value, field);
  const normalized = value.normalize("NFC");
  if (normalized.includes("\u0000")) fail("SPK003", `${field} must not contain NUL`, { field });
  return normalized;
}

export function assertUid(value, field = "uid", prefixes = UID_PREFIXES) {
  requireString(value, field);
  const match = UID_PATTERN.exec(value);
  if (!match) fail("SPK004", `${field} is not an opaque typed UID`, { field, value });
  const prefix = match[1];
  if (!prefixes.includes(prefix)) fail("SPK005", `${field} has an unknown UID prefix`, { field, value });
  if (!OPAQUE_PAYLOAD_PATTERN.test(match[2]) && !isProvisionalArtifactUid(value)) {
    fail("SPK004", `${field} must contain an opaque 128-bit payload`, { field, value });
  }
  return value;
}

export function assertCanonicalUid(value, field = "uid", prefixes = UID_PREFIXES) {
  assertUid(value, field, prefixes);
  if (isProvisionalArtifactUid(value)) fail("SPK004", `${field} must be canonical, not provisional`, { field, value });
  return value;
}

export function assertUidPrefix(value, prefix, field = "uid") {
  assertUid(value, field, [prefix]);
  return value;
}

export function normalizeSemanticKey(value, field = "key") {
  const text = normalizeText(value, field).trim().toLowerCase();
  if (text.length === 0) fail("SPK006", `${field} must not be empty`, { field });
  // Semantic keys are dotted names.  Rejecting rather than silently changing
  // punctuation prevents a rename from accidentally creating a new identity.
  if (!/^[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9][a-z0-9_-]*)*$/.test(text)) {
    fail("SPK007", `${field} must be a normalized dotted semantic key`, { field, value });
  }
  return text;
}

export function normalizeAlias(value, field = "alias") {
  return normalizeText(value, field).trim();
}

export function normalizeHeadingSlug(value, field = "heading_slug") {
  const text = normalizeText(value, field).trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (text.length === 0) fail("SPK008", `${field} must contain an alphanumeric character`, { field });
  return text;
}

export function normalizeCanonicalPath(value, field = "canonical_path") {
  const raw = normalizeText(value, field).replaceAll("\\", "/");
  if (raw.startsWith("/") || /^[A-Za-z]:\//.test(raw) || raw.startsWith("//")) {
    fail("SPK009", `${field} must be a project-relative POSIX path`, { field, value });
  }
  const parts = raw.split("/");
  if (parts.some((part) => part === "..")) {
    fail("SPK010", `${field} must not escape the project root`, { field, value });
  }
  const normalized = parts.filter((part) => part !== "" && part !== ".").join("/");
  if (normalized.length === 0) fail("SPK011", `${field} must identify a path`, { field });
  if (normalized.includes("\u0000")) fail("SPK003", `${field} must not contain NUL`, { field });
  return normalized;
}

export function normalizeRevision(value, field = "revision") {
  const text = normalizeText(value, field).trim();
  if (!REVISION_PATTERN.test(text) || text.includes("..")) {
    fail("SPK012", `${field} is not a valid immutable revision`, { field, value });
  }
  return text;
}

export function normalizeHash(value, field = "content_hash") {
  const text = normalizeText(value, field).trim().toLowerCase();
  if (!HASH_PATTERN.test(text)) fail("SPK013", `${field} must be a SHA-256 hash`, { field, value });
  return text.startsWith("sha256:") ? text : `sha256:${text}`;
}

export function normalizeDigestHex(value, field = "hash") {
  return normalizeHash(value, field).replace(/^sha256:/, "");
}

export function normalizeOptionalHash(value, field) {
  return value == null ? null : normalizeHash(value, field);
}

export function normalizeEnum(value, allowed, field) {
  const text = normalizeText(value, field);
  if (!allowed.includes(text)) fail("SPK014", `${field} has an unsupported value`, { field, value, allowed });
  return text;
}

export function sortedUnique(values, field, normalize = (item) => item) {
  if (values == null) return [];
  if (!Array.isArray(values)) fail("SPK015", `${field} must be an array`, { field });
  const result = values.map((item) => normalize(item));
  if (new Set(result).size !== result.length) fail("SPK016", `${field} must not contain duplicates`, { field });
  return result.sort(compareLexical);
}

export function compareLexical(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalValue(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalBytes(value) {
  return Buffer.from(canonicalValue(value), "utf8");
}

export function sha256(value) {
  const bytes = Buffer.isBuffer(value) ? value : canonicalBytes(value);
  return createHash("sha256").update(bytes).digest("hex");
}

const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Encode the first 130 digest bits MSB-first, zero-padding the final 2 bits. */
export function crockfordDigestPayload(bytes) {
  const digest = createHash("sha256").update(bytes).digest();
  let bits = 0;
  let bitCount = 0;
  let output = "";
  for (const byte of digest) {
    bits = (bits << 8) | byte;
    bitCount += 8;
    while (bitCount >= 5 && output.length < 26) {
      bitCount -= 5;
      output += CROCKFORD_ALPHABET[(bits >> bitCount) & 31];
      bits &= (1 << bitCount) - 1;
    }
    if (output.length === 26) break;
  }
  if (output.length < 26) output += CROCKFORD_ALPHABET[(bits << (5 - bitCount)) & 31];
  return output;
}

export function deriveCanonicalUid(prefix, domain, value) {
  if (!UID_PREFIXES.includes(prefix) || prefix === "W") fail("SPK005", "unsupported derived UID prefix", { prefix });
  const bytes = Buffer.concat([Buffer.from(`${domain}\0`, "utf8"), canonicalBytes(value)]);
  return `${prefix}-${crockfordDigestPayload(bytes)}`;
}

function digestOrderedTuple(name, fields, values) {
  const lines = [name];
  for (let index = 0; index < fields.length; index += 1) {
    const field = String(fields[index]).normalize("NFC");
    const value = String(values[index]).normalize("NFC");
    lines.push(`${Buffer.byteLength(field, "utf8")}:${field}=${Buffer.byteLength(value, "utf8")}:${value}`);
  }
  return createHash("sha256").update(Buffer.from(lines.join("\n"), "utf8")).digest("hex");
}

export function contentHash(bytes) {
  if (!(typeof bytes === "string" || Buffer.isBuffer(bytes) || bytes instanceof Uint8Array)) {
    fail("SPK017", "contentHash expects text or bytes");
  }
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export function immutableRecord(value) {
  return deepFreeze(value);
}

function quoteSdn(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n")}"`;
}

export function canonicalSnapshotTuple(tuple) {
  const fields = [
    "project_uid", "worktree_uid", "revision_id", "base_generation_hash",
    "overlay_generation_hash", "schema_version", "parser_version", "analyzer_version",
    "provider_contract_version", "policy_hash"
  ];
  if (!tuple || typeof tuple !== "object") fail("SPK018", "snapshot tuple must be an object");
  const extra = Object.keys(tuple).filter((key) => !fields.includes(key));
  const missing = fields.filter((key) => tuple[key] === undefined);
  if (extra.length || missing.length) fail("SPK019", "snapshot tuple fields must match snapshot_v1 exactly", { extra, missing });
  const integerVersion = (value, field) => requireInteger(typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value) ? Number(value) : value, field);
  const versionId = (value, field) => {
    if (typeof value === "number") return String(requireInteger(value, field));
    const text = normalizeText(value, field);
    if (/^[0-9]+$/.test(text) && !/^(?:0|[1-9][0-9]*)$/.test(text)) fail("SPK023", `${field} has a noncanonical numeric form`, { field, value });
    if (!/^[A-Za-z0-9][A-Za-z0-9._@-]*$/.test(text)) fail("SPK023", `${field} is not a canonical version identifier`, { field, value });
    return text;
  };
  const schemaVersion = integerVersion(tuple.schema_version, "schema_version");
  const worktreePrefixes = schemaVersion === 1 ? ["W"] : schemaVersion === 2 ? ["WT"] : [];
  if (worktreePrefixes.length === 0) fail("SPK023", "schema_version must be 1 or 2", { schema_version: schemaVersion });
  const normalized = {
    project_uid: assertCanonicalUid(tuple.project_uid, "project_uid", ["P"]),
    worktree_uid: assertCanonicalUid(tuple.worktree_uid, "worktree_uid", worktreePrefixes),
    revision_id: normalizeRevision(tuple.revision_id, "revision_id"),
    base_generation_hash: normalizeDigestHex(tuple.base_generation_hash, "base_generation_hash"),
    overlay_generation_hash: normalizeDigestHex(tuple.overlay_generation_hash, "overlay_generation_hash"),
    schema_version: schemaVersion,
    parser_version: versionId(tuple.parser_version, "parser_version"),
    analyzer_version: versionId(tuple.analyzer_version, "analyzer_version"),
    provider_contract_version: versionId(tuple.provider_contract_version, "provider_contract_version"),
    policy_hash: normalizeDigestHex(tuple.policy_hash, "policy_hash")
  };
  return `snapshot_v1:\n${fields.map((field) => `  ${field}: ${typeof normalized[field] === "number" ? normalized[field] : quoteSdn(normalized[field])}`).join("\n")}\n`;
}

export function createSnapshotId(tuple) {
  return `spks1-${createHash("sha256").update(canonicalSnapshotTuple(tuple), "utf8").digest("hex")}`;
}

export function createProjectionUid(tuple) {
  const fields = [
    "workspace_uid", "snapshot_id", "view_kind", "normalized_logical_path",
    "normalized_parameters_hash", "effective_auth_scope_hash", "page_start_key"
  ];
  if (!tuple || typeof tuple !== "object") fail("SPK020", "projection tuple must be an object");
  const extra = Object.keys(tuple).filter((key) => !fields.includes(key));
  const missing = fields.filter((key) => tuple[key] === undefined && key !== "page_start_key");
  if (extra.length || missing.length) fail("SPK021", "projection tuple fields must match projection_v1 exactly", { extra, missing });
  const normalized = {
    workspace_uid: assertCanonicalUid(tuple.workspace_uid, "workspace_uid", ["W"]),
    snapshot_id: normalizeText(tuple.snapshot_id, "snapshot_id"),
    view_kind: normalizeText(tuple.view_kind, "view_kind").toLowerCase(),
    normalized_logical_path: normalizeCanonicalPath(tuple.normalized_logical_path, "normalized_logical_path"),
    normalized_parameters_hash: normalizeHash(tuple.normalized_parameters_hash, "normalized_parameters_hash"),
    effective_auth_scope_hash: normalizeHash(tuple.effective_auth_scope_hash, "effective_auth_scope_hash"),
    page_start_key: tuple.page_start_key == null || tuple.page_start_key === "" ? "" : normalizeText(tuple.page_start_key, "page_start_key")
  };
  if (!/^spks1-[a-f0-9]{64}$/.test(normalized.snapshot_id)) {
    fail("SPK022", "snapshot_id must use the spks1 form", { snapshot_id: normalized.snapshot_id });
  }
  return `spkp1-${digestOrderedTuple("projection_v1", fields, fields.map((field) => normalized[field]))}`;
}

export function isProvisionalUid(value) {
  return isProvisionalArtifactUid(value);
}

export function isProvisionalArtifactUid(value) {
  return typeof value === "string" && PROVISIONAL_ARTIFACT_PATTERN.test(value);
}
