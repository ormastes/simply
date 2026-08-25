import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

/** Canonical project-relative paths use POSIX separators on every host. */
export function normalizeRelativePath(input, { allowEmpty = false } = {}) {
  if (typeof input !== "string") throw new TypeError("relative path must be a string");
  if (input.includes("\0") || input.includes("\\")) throw new TypeError("backslash and NUL are not valid canonical separators");
  if (input.startsWith("/") || /^[A-Za-z]:[\\/]/.test(input) || input.startsWith("//")) {
    throw new TypeError("absolute paths are not valid canonical relative paths");
  }
  const pieces = input.split("/");
  const output = [];
  for (const piece of pieces) {
    if (piece === "") {
      if (pieces.length === 1 && allowEmpty) continue;
      throw new TypeError("empty path segments are not valid canonical paths");
    }
    if (piece === "." || piece === "..") throw new TypeError("dot and dot-dot path segments are not allowed");
    output.push(piece.normalize("NFC"));
  }
  if (output.length === 0 && !allowEmpty) throw new TypeError("empty path is not allowed");
  return output.join("/");
}

export function canonicalRoot(input) {
  if (typeof input !== "string" || input.length === 0) throw new TypeError("root must be a non-empty path");
  const absolute = resolve(input);
  if (existsSync(absolute)) return realpathSync(absolute);
  return absolute;
}

export function canonicalExistingIdentity(input) {
  const root = canonicalRoot(input);
  return existsSync(root) ? realpathSync(root) : root;
}

export function resolveWithin(root, relative) {
  const base = canonicalRoot(root);
  const normalized = normalizeRelativePath(relative);
  const target = resolve(base, ...normalized.split("/"));
  if (target !== base && !target.startsWith(`${base}/`)) throw new TypeError("path escapes root");
  return target;
}

export function safeNamespace(value, name = "namespace") {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._~-]*$/.test(value)) {
    throw new TypeError(`${name} contains unsafe characters`);
  }
  return value;
}
