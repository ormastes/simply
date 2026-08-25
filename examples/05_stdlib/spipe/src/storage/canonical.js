import { createHash } from "node:crypto";

/**
 * Canonical primitives shared by the registry, object store, overlays, and
 * snapshot store.  This module deliberately has no filesystem side effects.
 */

export const ZERO_HASH = "0".repeat(64);

function normalizeString(value, name = "value") {
  if (typeof value !== "string") {
    throw new TypeError(`${name} must be a string`);
  }
  return value.normalize("NFC");
}

function canonicalValue(value, seen = new Set()) {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value.normalize("NFC"));
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonical values require finite numbers");
    return JSON.stringify(value);
  }
  if (typeof value === "bigint") return JSON.stringify(`${value}n`);
  if (value instanceof Uint8Array) return JSON.stringify(Buffer.from(value).toString("base64"));
  if (typeof value !== "object") throw new TypeError(`unsupported canonical value: ${typeof value}`);
  if (seen.has(value)) throw new TypeError("canonical values cannot contain cycles");
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    result = `[${value.map((item) => canonicalValue(item, seen)).join(",")}]`;
  } else {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
    result = `{${keys.map((key) => `${JSON.stringify(key.normalize("NFC"))}:${canonicalValue(value[key], seen)}`).join(",")}}`;
  }
  seen.delete(value);
  return result;
}

export function canonicalJson(value) {
  return canonicalValue(value);
}

export function stableClone(value) {
  return JSON.parse(canonicalJson(value));
}

export function freezeDeep(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) freezeDeep(child, seen);
  return Object.freeze(value);
}

export function sha256Hex(bytes) {
  const input = bytes instanceof Uint8Array || Buffer.isBuffer(bytes) ? bytes : Buffer.from(normalizeString(bytes));
  return createHash("sha256").update(input).digest("hex");
}

export function contentHash(bytes) {
  return `sha256:${sha256Hex(bytes)}`;
}

export function canonicalTuple(label, values) {
  const normalizedLabel = normalizeString(label, "tuple label");
  if (!Array.isArray(values)) throw new TypeError("tuple values must be an array");
  const fields = values.map((value, index) => {
    const text = normalizeString(String(value ?? ""), `tuple field ${index}`);
    const bytes = Buffer.byteLength(text, "utf8");
    return `${bytes}:${text}`;
  });
  return `${normalizedLabel}|${fields.join("")}`;
}

export function hashCanonicalTuple(label, values) {
  return sha256Hex(canonicalTuple(label, values));
}

export function assertSha256(value, name = "hash") {
  if (typeof value !== "string" || !/^(?:sha256:)?[0-9a-f]{64}$/.test(value)) {
    throw new TypeError(`${name} must be a lowercase SHA-256 hash`);
  }
  return value.startsWith("sha256:") ? value.slice(7) : value;
}

export function assertOpaqueId(value, prefix, name = "id") {
  if (typeof value !== "string" || !new RegExp(`^${prefix}-[A-Za-z0-9._~-]+$`).test(value)) {
    throw new TypeError(`${name} must have the ${prefix}- opaque-id form`);
  }
  return value;
}
