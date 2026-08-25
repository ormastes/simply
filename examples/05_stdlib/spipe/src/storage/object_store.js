import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import { assertSha256, contentHash, sha256Hex } from "./canonical.js";
import { canonicalRoot } from "../workspace/paths.js";

function bytesOf(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") return Buffer.from(value, "utf8");
  throw new TypeError("content-addressed objects require bytes, Uint8Array, Buffer, or string");
}

function isRegular(path) {
  try {
    const info = lstatSync(path);
    return info.isFile() && !info.isSymbolicLink();
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

/** Immutable SHA-256 byte store.  Garbage collection is explicit and never
 * occurs during put/get, keeping request paths bounded and predictable. */
export class ContentAddressedObjectStore {
  constructor({ root, objectRoot = null } = {}) {
    if (!root && !objectRoot) throw new TypeError("object store root is required");
    this.root = canonicalRoot(String(root ?? dirname(dirname(String(objectRoot)))));
    this.objectRoot = canonicalRoot(String(objectRoot ?? join(this.root, "objects", "sha256")));
    mkdirSync(this.objectRoot, { recursive: true });
  }

  hash(content) {
    return contentHash(bytesOf(content));
  }

  pathFor(hash) {
    const hex = assertSha256(hash);
    return join(this.objectRoot, hex.slice(0, 2), hex);
  }

  relativePath(hash) {
    return relative(this.root, this.pathFor(hash)).split("\\").join("/");
  }

  has(hash) {
    return isRegular(this.pathFor(hash));
  }

  put(content) {
    const bytes = bytesOf(content);
    const hash = contentHash(bytes);
    const target = this.pathFor(hash);
    if (isRegular(target)) {
      const existing = readFileSync(target);
      if (sha256Hex(existing) !== hash.slice(7)) throw new Error(`CAS corruption at ${hash}`);
      return Object.freeze({ hash, size: existing.length, path: this.relativePath(hash), existed: true });
    }
    mkdirSync(dirname(target), { recursive: true });
    const temporary = join(dirname(target), `.${hash.slice(7)}.${process.pid}.${Date.now()}.tmp`);
    let descriptor = -1;
    try {
      descriptor = openSync(temporary, "wx", 0o444);
      writeFileSync(descriptor, bytes);
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = -1;
      if (!isRegular(target)) renameSync(temporary, target);
      else unlinkSync(temporary);
    } finally {
      if (descriptor !== -1) closeSync(descriptor);
      if (existsSync(temporary)) unlinkSync(temporary);
    }
    return Object.freeze({ hash, size: bytes.length, path: this.relativePath(hash), existed: false });
  }

  putBytes(content) {
    return this.put(content);
  }

  putText(content) {
    return this.put(String(content));
  }

  read(hash) {
    const target = this.pathFor(hash);
    if (!isRegular(target)) throw new Error(`content-addressed object is missing: ${hash}`);
    const bytes = readFileSync(target);
    if (sha256Hex(bytes) !== assertSha256(hash)) throw new Error(`content-addressed object failed verification: ${hash}`);
    return bytes;
  }

  get(hash) {
    return this.read(hash);
  }

  verify(hash) {
    try {
      this.read(hash);
      return true;
    } catch (error) {
      if (error.code === "ENOENT" || /missing|failed verification/.test(error.message)) return false;
      throw error;
    }
  }

  stat(hash) {
    const target = this.pathFor(hash);
    if (!isRegular(target)) return null;
    const info = statSync(target);
    return Object.freeze({ hash: `sha256:${assertSha256(hash)}`, size: info.size, path: this.relativePath(hash) });
  }

  /** Remove only unreferenced objects after the caller supplies a complete,
   * trusted reachability set.  This maintenance operation is intentionally
   * separate from all request-time reads and writes. */
  collect(reachableHashes) {
    if (!reachableHashes || typeof reachableHashes[Symbol.iterator] !== "function") throw new TypeError("reachableHashes must be iterable");
    const reachable = new Set([...reachableHashes].map((hash) => assertSha256(hash)));
    let removed = 0;
    if (!existsSync(this.objectRoot)) return 0;
    for (const prefix of readdirSafe(this.objectRoot)) {
      const directory = join(this.objectRoot, prefix);
      if (!/^[0-9a-f]{2}$/.test(prefix)) continue;
      for (const name of readdirSafe(directory)) {
        if (!/^[0-9a-f]{64}$/.test(name) || reachable.has(name)) continue;
        const target = join(directory, name);
        if (isRegular(target)) {
          unlinkSync(target);
          removed += 1;
        }
      }
    }
    return removed;
  }
}

function readdirSafe(path) {
  try {
    // The object-root fan-out is intentionally shallow and is read only by GC.
    return statSync(path).isDirectory() ? readdirSync(path) : [];
  } catch {
    return [];
  }
}

export function createObjectStore(options) {
  return new ContentAddressedObjectStore(options);
}
