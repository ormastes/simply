import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { canonicalJson, contentHash, freezeDeep, sha256Hex, ZERO_HASH } from "./canonical.js";
import { ensureWorktreeCacheLayout } from "../workspace/worktree.js";
import { normalizeRelativePath, safeNamespace } from "../workspace/paths.js";

function contentBytes(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") return Buffer.from(value, "utf8");
  throw new TypeError("overlay content must be bytes, Uint8Array, Buffer, or string");
}

function clone(value) {
  return JSON.parse(canonicalJson(value));
}

function writeAtomic(path, bytes) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  let descriptor = -1;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = -1;
    renameSync(temporary, path);
  } finally {
    if (descriptor !== -1) {
      try { fsyncSync(descriptor); } catch { /* close below */ }
      try { closeSync(descriptor); } catch { /* cleanup below */ }
    }
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

/**
 * Worktree-private copy-on-write overlay.  The object bytes and manifest live
 * below a namespace derived from one WorktreeId; no module-level mutable map
 * or shared current file is used.
 */
export class WorktreeOverlayStore {
  constructor({ cacheRoot = null, root = null, worktreeUid = null, worktreeId = null, worktree_id = null, load = true } = {}) {
    cacheRoot ??= root;
    worktreeUid ??= worktreeId ?? worktree_id;
    if (!cacheRoot || !worktreeUid) throw new TypeError("cacheRoot and worktreeUid are required");
    this.worktree_uid = safeNamespace(String(worktreeUid), "worktree uid");
    this.layout = ensureWorktreeCacheLayout(cacheRoot, this.worktree_uid);
    this._entries = new Map();
    if (load) this._loadCurrent();
  }

  _objectPath(hash) {
    const hex = hash.replace(/^sha256:/, "");
    if (!/^[0-9a-f]{64}$/.test(hex)) throw new TypeError("overlay object hash is invalid");
    return join(this.layout.overlayObjects, hex.slice(0, 2), hex);
  }

  _loadCurrent() {
    if (!existsSync(this.layout.current)) return;
    const current = JSON.parse(readFileSync(this.layout.current, "utf8"));
    if (current.worktree_uid !== this.worktree_uid) throw new Error("overlay belongs to another worktree");
    if (!Array.isArray(current.entries)) throw new Error("overlay current manifest is malformed");
    this._entries.clear();
    for (const entry of current.entries) {
      const normalized = this._validateEntry(entry);
      if (this._entries.has(normalized.path)) throw new Error(`duplicate overlay path: ${normalized.path}`);
      this._entries.set(normalized.path, normalized);
    }
    const expected = this.generationHash();
    if (current.overlay_generation_hash !== expected) throw new Error("overlay generation hash does not match its manifest");
  }

  _validateEntry(entry) {
    if (!entry || typeof entry !== "object") throw new TypeError("overlay entry must be an object");
    const path = normalizeRelativePath(String(entry.path));
    const operation = entry.operation;
    if (operation !== "upsert" && operation !== "delete") throw new TypeError("overlay operation must be upsert or delete");
    if (operation === "upsert") {
      if (typeof entry.content_hash !== "string" || !/^sha256:[0-9a-f]{64}$/.test(entry.content_hash)) throw new TypeError("overlay upsert requires a SHA-256 content hash");
      if (!Number.isInteger(entry.size) || entry.size < 0) throw new TypeError("overlay size must be a non-negative integer");
      return { path, operation, content_hash: entry.content_hash, size: entry.size };
    }
    return { path, operation };
  }

  set(relativePath, content) {
    const path = normalizeRelativePath(relativePath);
    const bytes = contentBytes(content);
    const hash = contentHash(bytes);
    const target = this._objectPath(hash);
    if (!existsSync(target)) {
      mkdirSync(dirname(target), { recursive: true });
      writeAtomic(target, bytes);
    } else if (!statSync(target).isFile() || sha256Hex(readFileSync(target)) !== hash.slice(7)) {
      throw new Error(`overlay object failed verification: ${hash}`);
    }
    const entry = { path, operation: "upsert", content_hash: hash, size: bytes.length };
    this._entries.set(path, entry);
    this.persist();
    return clone(entry);
  }

  delete(relativePath) {
    const path = normalizeRelativePath(relativePath);
    const entry = { path, operation: "delete" };
    this._entries.set(path, entry);
    this.persist();
    return clone(entry);
  }

  has(relativePath) {
    const entry = this._entries.get(normalizeRelativePath(relativePath));
    return Boolean(entry && entry.operation === "upsert");
  }

  isDeleted(relativePath) {
    const entry = this._entries.get(normalizeRelativePath(relativePath));
    return Boolean(entry && entry.operation === "delete");
  }

  getEntry(relativePath) {
    const entry = this._entries.get(normalizeRelativePath(relativePath));
    return entry ? clone(entry) : null;
  }

  read(relativePath) {
    const entry = this._entries.get(normalizeRelativePath(relativePath));
    if (!entry || entry.operation === "delete") return null;
    const bytes = readFileSync(this._objectPath(entry.content_hash));
    if (contentHash(bytes) !== entry.content_hash) throw new Error(`overlay content failed verification: ${entry.path}`);
    return bytes;
  }

  entries() {
    return [...this._entries.values()].sort((a, b) => a.path.localeCompare(b.path)).map(clone);
  }

  manifest() {
    return { version: 1, entries: this.entries() };
  }

  generationHash() {
    return this._entries.size === 0 ? ZERO_HASH : sha256Hex(canonicalJson(this.manifest()));
  }

  snapshot() {
    return freezeDeep(clone({
      version: 1,
      worktree_uid: this.worktree_uid,
      overlay_generation_hash: this.generationHash(),
      entries: this.entries()
    }));
  }

  persist() {
    const snapshot = this.snapshot();
    const generationPath = join(this.layout.overlays, `${snapshot.overlay_generation_hash}.sdn`);
    const bytes = Buffer.from(`${canonicalJson(snapshot)}\n`, "utf8");
    if (!existsSync(generationPath)) writeAtomic(generationPath, bytes);
    else if (readFileSync(generationPath, "utf8") !== bytes.toString("utf8")) throw new Error("immutable overlay generation collision");
    writeAtomic(this.layout.current, bytes);
    return snapshot;
  }

  clear() {
    this._entries.clear();
    return this.persist();
  }
}

export function createWorktreeOverlayStore(options) {
  return new WorktreeOverlayStore(options);
}

export { ZERO_HASH };
