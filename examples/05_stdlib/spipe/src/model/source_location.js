import { TextDecoder } from "node:util";
import { assertCanonicalUid, contentHash, immutableRecord, normalizeHash, requireInteger } from "./identity.js";

export function createSourceSpan(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("span must be an object");
  const keys = Object.keys(input).sort();
  if (keys.join(",") !== "end_byte,start_byte") throw new TypeError("span fields must match SourceSpan exactly");
  const start_byte = requireInteger(input.start_byte, "span.start_byte");
  const end_byte = requireInteger(input.end_byte, "span.end_byte");
  if (end_byte < start_byte) throw new TypeError("span.end_byte must not precede span.start_byte");
  return immutableRecord({ start_byte, end_byte });
}

export function createSourceLocation(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("source_location must be an object");
  const keys = Object.keys(input).sort();
  if (keys.join(",") !== "source_artifact_uid,source_hash,span") throw new TypeError("source_location fields must match SourceLocation exactly");
  return immutableRecord({
    source_artifact_uid: assertCanonicalUid(input.source_artifact_uid, "source_location.source_artifact_uid", ["A"]),
    source_hash: normalizeHash(input.source_hash, "source_location.source_hash"),
    span: createSourceSpan(input.span)
  });
}

function normalizedBuffer(value) {
  if (!(typeof value === "string" || Buffer.isBuffer(value) || value instanceof Uint8Array)) throw new TypeError("normalized bytes must be UTF-8 text or bytes");
  const bytes = Buffer.from(value);
  try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new TypeError("normalized bytes must be valid UTF-8"); }
  if (bytes.includes(0x0d)) throw new TypeError("normalized bytes must use the spipe normalized-newline contract");
  return bytes;
}

function isCodePointBoundary(bytes, offset) {
  return offset === 0 || offset === bytes.length || (bytes[offset] & 0xc0) !== 0x80;
}

/** Verify hash, bounds, and UTF-8 boundaries against the canonical normalized bytes. */
export function verifySourceLocationBytes(input, normalized_bytes) {
  const location = createSourceLocation(input);
  const bytes = normalizedBuffer(normalized_bytes);
  if (contentHash(bytes) !== location.source_hash) throw new TypeError("source_location source_hash does not match normalized bytes");
  const { start_byte, end_byte } = location.span;
  if (end_byte > bytes.length) throw new TypeError("source_location span exceeds normalized bytes");
  if (!isCodePointBoundary(bytes, start_byte) || !isCodePointBoundary(bytes, end_byte)) throw new TypeError("source_location span must lie on UTF-8 code-point boundaries");
  return location;
}

export function createVerifiedSourceLocation(input, normalized_bytes) {
  return verifySourceLocationBytes(input, normalized_bytes);
}
