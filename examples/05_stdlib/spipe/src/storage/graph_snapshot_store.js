import { randomBytes } from "node:crypto";
import {
  closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync,
  rmSync, unlinkSync, writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";

import { canonicalJson, contentHash, freezeDeep } from "./canonical.js";
import { canonicalRoot, safeNamespace } from "../workspace/paths.js";
import { assertCanonicalUid } from "../model/identity.js";
import { createSnapshotMetadata } from "./snapshot_store.js";
import { canonicalGraphBytes, canonicalGraphObject } from "../graph/canonical.js";

const STAGE_BRAND = new WeakSet();
const PIN_BRAND = new WeakSet();
const STAGE_STATE = new WeakMap();
const PIN_STATE = new WeakMap();

function fail(code, message) {
  const value = new Error(message);
  value.code = code;
  return value;
}

function required(value, name) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${name} must be a non-empty string`);
  return value.normalize("NFC");
}

function requiredHash(value, name) {
  const text = required(value, name);
  if (!/^(?:sha256:)?[0-9a-f]{64}$/.test(text)) throw new TypeError(`${name} must be a lowercase SHA-256 hash`);
  return text.startsWith("sha256:") ? text : `sha256:${text}`;
}

const GRAPH_MANIFEST_FIELDS = Object.freeze([
  "schema", "snapshot_uid", "project_uid", "worktree_uid", "revision_id",
  "base_generation_hash", "overlay_generation_hash", "schema_version",
  "parser_version", "analyzer_version", "provider_contract_version", "policy_hash",
  "base_segments", "overlay_segment", "alias_root", "graph_root", "lexical_root",
  "projection_root", "diagnostics_root", "config_hash", "parser_set_hash", "canonical_tuple"
]);

function snapshotUid(value, name = "snapshot_uid") {
  const text = required(value, name);
  if (!/^spks1-[0-9a-f]{64}$/.test(text)) throw new TypeError(`${name} must be a canonical SnapshotUid`);
  return text;
}

export function validateGraphSnapshotManifest(value, expectedWorktreeUid = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("manifest must be an object");
  if (Object.keys(value).sort().join("\0") !== [...GRAPH_MANIFEST_FIELDS].sort().join("\0")) throw new TypeError("manifest fields must match the closed graph snapshot schema exactly");
  const schemaVersion = value.schema_version;
  const worktreePrefix = schemaVersion === 1 ? "W" : schemaVersion === 2 ? "WT" : null;
  if (worktreePrefix == null) throw new TypeError("manifest.schema_version must be 1 or 2");
  const worktreeUid = assertCanonicalUid(value.worktree_uid, "manifest.worktree_uid", [worktreePrefix]);
  if (expectedWorktreeUid != null && worktreeUid !== expectedWorktreeUid) throw new TypeError("manifest worktree_uid does not match this store");
  snapshotUid(value.snapshot_uid, "manifest.snapshot_uid");
  const rebuilt = createSnapshotMetadata(value);
  if (canonicalJson(rebuilt) !== canonicalJson(value)) throw new TypeError("manifest is not canonical or its SnapshotUid does not match its tuple");
  if (rebuilt.graph_root == null) throw new TypeError("manifest.graph_root is required");
  return rebuilt;
}

function atomicWrite(path, bytes) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`;
  const fd = openSync(temporary, "wx");
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temporary, path);
  syncDirectory(dirname(path));
}

function syncDirectory(path) {
  let fd;
  try { fd = openSync(path, "r"); fsyncSync(fd); }
  finally { if (fd !== undefined) closeSync(fd); }
}

function canonicalReplay(value, snapshotUid, graphRoot) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("replay_record must be an object");
  const fields = ["delta_hash", "base_snapshot_uid", "base_graph_root", "output_snapshot_uid", "output_graph_root"];
  if (Object.keys(value).sort().join("\0") !== fields.sort().join("\0")) throw new TypeError("replay_record fields must match the canonical schema exactly");
  const record = {
    delta_hash: requiredHash(value.delta_hash, "replay_record.delta_hash"),
    base_snapshot_uid: snapshotUidValue(value.base_snapshot_uid, "replay_record.base_snapshot_uid"),
    base_graph_root: requiredHash(value.base_graph_root, "replay_record.base_graph_root"),
    output_snapshot_uid: snapshotUidValue(value.output_snapshot_uid, "replay_record.output_snapshot_uid"),
    output_graph_root: requiredHash(value.output_graph_root, "replay_record.output_graph_root")
  };
  if (record.output_snapshot_uid !== snapshotUid || record.output_graph_root !== graphRoot) throw new TypeError("replay_record must bind the staged output snapshot and graph root");
  return freezeDeep(record);
}

const snapshotUidValue = snapshotUid;

function normalizeObjects(objects) {
  if (!Array.isArray(objects)) throw new TypeError("objects must be an array");
  return objects.map((object) => {
    if (!object || typeof object !== "object") throw new TypeError("object entry must be an object");
    const bytes = Buffer.isBuffer(object.bytes) ? object.bytes : Buffer.from(object.bytes ?? "");
    const hash = contentHash(bytes);
    if (object.hash != null && object.hash !== hash && object.hash !== hash.slice(7)) throw fail("SPK803", "staged object hash mismatch");
    return { hash, bytes };
  }).sort((a, b) => a.hash.localeCompare(b.hash));
}

function validateGraphObject(bytes, expectedHash) {
  let parsed;
  try { parsed = JSON.parse(bytes.toString("utf8")); }
  catch (cause) { throw fail("SPK803", `graph object is not JSON: ${cause.message}`); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
      Object.keys(parsed).sort().join("\0") !== "edges\0nodes\0schema" || parsed.schema !== 1 ||
      !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
    throw fail("SPK803", "graph object must match the closed schema-1 graph record");
  }
  let canonical;
  try { canonical = canonicalGraphObject(parsed.nodes, parsed.edges); }
  catch (cause) { throw fail("SPK803", `graph object contains invalid records: ${cause.message}`); }
  const canonicalBytes = canonicalGraphBytes(canonical.nodes, canonical.edges);
  if (!bytes.equals(canonicalBytes)) throw fail("SPK803", "graph object bytes are not canonical");
  if (contentHash(canonicalBytes) !== expectedHash) throw fail("SPK803", "graph object does not match manifest.graph_root");
  return canonical;
}

/** Filesystem owner for graph snapshot staging, CAS publication, and pins. */
export class GraphSnapshotStore {
  #storeId = randomBytes(16).toString("hex");
  #livePins = new Map();
  #liveness = 1;

  constructor({ cacheRoot, repositoryId = "default", worktreeUid }) {
    if (!cacheRoot) throw new TypeError("cacheRoot is required");
    this.cache_root = canonicalRoot(String(cacheRoot));
    this.repository_id = safeNamespace(String(repositoryId), "repository id");
    this.worktree_uid = safeNamespace(assertCanonicalUid(worktreeUid, "worktreeUid", ["W", "WT"]), "worktree UID");
    this.shared_root = join(this.cache_root, "shared", this.repository_id, "graph-snapshots");
    this.worktree_root = join(this.cache_root, "worktrees", this.worktree_uid, "graph-snapshots");
    this.object_root = join(this.shared_root, "objects");
    this.manifest_root = join(this.shared_root, "manifests");
    this.replay_root = join(this.shared_root, "replays");
    this.stage_root = join(this.worktree_root, "stage");
    this.current_path = join(this.worktree_root, "current.sdn");
    this.lock_path = join(this.worktree_root, "writer.lock");
    for (const path of [this.object_root, this.manifest_root, this.replay_root, this.stage_root]) mkdirSync(path, { recursive: true });
  }

  stage(manifest, objects = [], { replay_record = null } = {}) {
    const canonicalManifest = validateGraphSnapshotManifest(manifest, this.worktree_uid);
    const stagedSnapshotUid = canonicalManifest.snapshot_uid;
    const graphRoot = canonicalManifest.graph_root;
    const replayRecord = replay_record == null ? null : canonicalReplay(replay_record, stagedSnapshotUid, graphRoot);
    const normalizedObjects = normalizeObjects(objects);
    const stagedGraph = normalizedObjects.find((object) => object.hash === graphRoot);
    const existingGraphPath = join(this.object_root, graphRoot.slice(7));
    if (stagedGraph == null && !existsSync(existingGraphPath)) {
      throw fail("SPK803", "manifest.graph_root must reference a staged or existing graph object");
    }
    validateGraphObject(stagedGraph?.bytes ?? readFileSync(existingGraphPath), graphRoot);
    const transactionId = `stage-${randomBytes(16).toString("hex")}`;
    const directory = join(this.stage_root, transactionId);
    mkdirSync(directory, { recursive: false });
    try {
      for (const object of normalizedObjects) {
        const path = join(directory, object.hash.slice(7));
        const fd = openSync(path, "wx");
        try { writeFileSync(fd, object.bytes); fsyncSync(fd); } finally { closeSync(fd); }
      }
      atomicWrite(join(directory, "manifest.sdn"), `${canonicalJson(canonicalManifest)}\n`);
      if (replayRecord != null) atomicWrite(join(directory, "replay.sdn"), `${canonicalJson(replayRecord)}\n`);
      syncDirectory(directory);
      const state = {
        store_id: this.#storeId,
        transaction_id: transactionId,
        directory,
        snapshot_uid: stagedSnapshotUid,
        graph_root: graphRoot,
        manifest: canonicalManifest,
        replay_record: replayRecord,
        object_hashes: normalizedObjects.map((object) => object.hash),
        consumed: false
      };
      const handle = freezeDeep({
        transaction_id: state.transaction_id, snapshot_uid: state.snapshot_uid,
        graph_root: state.graph_root, object_hashes: state.object_hashes
      });
      STAGE_BRAND.add(handle);
      STAGE_STATE.set(handle, state);
      return handle;
    } catch (cause) {
      rmSync(directory, { recursive: true, force: true });
      throw cause;
    }
  }

  publish(expectedCurrentUid, stage) {
    const staged = this.#assertStage(stage);
    if (expectedCurrentUid != null) snapshotUid(expectedCurrentUid, "expectedCurrentUid");
    const lock = this.#acquireWriterLock(staged.transaction_id);
    try {
      const current = this.current();
      const currentUid = current?.snapshot_uid ?? null;
      if (currentUid !== (expectedCurrentUid ?? null)) throw fail("SPK901", "snapshot compare-and-swap conflict");
      for (const hash of staged.object_hashes) {
        const name = hash.slice(7);
        const source = join(staged.directory, name);
        const target = join(this.object_root, name);
        const bytes = readFileSync(source);
        if (contentHash(bytes) !== hash) throw fail("SPK803", `staged object failed verification: ${hash}`);
        if (existsSync(target)) {
          if (contentHash(readFileSync(target)) !== hash) throw fail("SPK803", `immutable object collision: ${hash}`);
        } else {
          renameSync(source, target);
        }
      }
      const manifestBytes = Buffer.from(`${canonicalJson(staged.manifest)}\n`, "utf8");
      const manifestPath = join(this.manifest_root, `${safeNamespace(staged.snapshot_uid, "snapshot UID")}.sdn`);
      if (existsSync(manifestPath)) {
        if (!readFileSync(manifestPath).equals(manifestBytes)) throw fail("SPK803", `immutable manifest collision: ${stage.snapshot_uid}`);
      } else {
        atomicWrite(manifestPath, manifestBytes);
      }
      if (staged.replay_record != null) {
        const replayBytes = Buffer.from(`${canonicalJson(staged.replay_record)}\n`, "utf8");
        const replayPath = join(this.replay_root, `${safeNamespace(staged.snapshot_uid, "snapshot UID")}.sdn`);
        if (existsSync(replayPath)) {
          if (!readFileSync(replayPath).equals(replayBytes)) throw fail("SPK803", `immutable replay collision: ${stage.snapshot_uid}`);
        } else atomicWrite(replayPath, replayBytes);
      }
      syncDirectory(this.object_root);
      syncDirectory(this.manifest_root);
      syncDirectory(this.replay_root);
      atomicWrite(this.current_path, manifestBytes);
      staged.consumed = true;
      rmSync(staged.directory, { recursive: true, force: true });
      this.#liveness += 1;
      return freezeDeep({ status: "published", previous_snapshot_uid: currentUid, snapshot_uid: staged.snapshot_uid, graph_root: staged.graph_root });
    } finally {
      closeSync(lock.fd);
      unlinkSync(this.lock_path);
      syncDirectory(dirname(this.lock_path));
    }
  }

  current() {
    if (!existsSync(this.current_path)) return null;
    const record = JSON.parse(readFileSync(this.current_path, "utf8"));
    try { return validateGraphSnapshotManifest(record, this.worktree_uid); }
    catch (cause) { throw fail("SPK803", `current snapshot is malformed: ${cause.message}`); }
  }

  /** Recover and verify the immutable graph named by a published manifest. */
  read_graph(snapshotUid = null) {
    const manifest = snapshotUid == null ? this.current() : this.#readManifest(snapshotUid);
    if (manifest == null) return null;
    const path = join(this.object_root, manifest.graph_root.slice(7));
    if (!existsSync(path)) throw fail("SPK803", `published graph object is missing: ${manifest.graph_root}`);
    return validateGraphObject(readFileSync(path), manifest.graph_root);
  }

  replay(snapshotUid) {
    const path = join(this.replay_root, `${safeNamespace(snapshotUidValue(snapshotUid, "snapshotUid"), "snapshot UID")}.sdn`);
    if (!existsSync(path)) return null;
    return freezeDeep(JSON.parse(readFileSync(path, "utf8")));
  }

  pin_current(scope, { policy_version, ttl_ms = 300_000 } = {}) {
    const manifest = this.current();
    if (!manifest) throw fail("SPK902", "no current snapshot exists");
    const scopeDigest = required(scope, "scope");
    if (!Number.isInteger(policy_version) || policy_version < 0) throw new TypeError("policy_version must be a non-negative integer");
    if (!Number.isInteger(ttl_ms) || ttl_ms <= 0) throw new TypeError("ttl_ms must be a positive integer");
    const now = Date.now();
    const state = {
      store_id: this.#storeId,
      snapshot_uid: manifest.snapshot_uid,
      graph_root: manifest.graph_root,
      scope_digest: scopeDigest,
      policy_version,
      issued_at_ms: now,
      expires_at_ms: now + ttl_ms,
      liveness_generation: this.#liveness,
      release_handle: randomBytes(24).toString("base64url"),
      released: false,
      manifest
    };
    const pin = freezeDeep({
      snapshot_uid: state.snapshot_uid, graph_root: state.graph_root,
      scope_digest: state.scope_digest, policy_version: state.policy_version,
      issued_at_ms: state.issued_at_ms, expires_at_ms: state.expires_at_ms,
      liveness_generation: state.liveness_generation, release_handle: state.release_handle,
      manifest: state.manifest
    });
    PIN_BRAND.add(pin);
    PIN_STATE.set(pin, state);
    this.#livePins.set(state.release_handle, pin);
    return pin;
  }

  assert_live_pin(pin) {
    const state = pin && PIN_BRAND.has(pin) ? PIN_STATE.get(pin) : null;
    if (!state || state.store_id !== this.#storeId || this.#livePins.get(state.release_handle) !== pin) {
      throw fail("SPK704", "snapshot pin was not issued by this store");
    }
    if (state.released || state.expires_at_ms <= Date.now()) throw fail("SPK704", "snapshot pin is no longer live");
    return state.manifest;
  }

  release(pin) {
    this.assert_live_pin(pin);
    const state = PIN_STATE.get(pin);
    state.released = true;
    this.#livePins.delete(state.release_handle);
  }

  abort(stage) {
    const staged = this.#assertStage(stage);
    staged.consumed = true;
    rmSync(staged.directory, { recursive: true, force: true });
  }

  #assertStage(stage) {
    const state = stage && STAGE_BRAND.has(stage) ? STAGE_STATE.get(stage) : null;
    if (!state || state.store_id !== this.#storeId) throw fail("SPK704", "stage was not issued by this store");
    if (state.consumed) throw fail("SPK804", "stage has already been consumed");
    return state;
  }


  #readManifest(value) {
    const uid = snapshotUidValue(value, "snapshotUid");
    const path = join(this.manifest_root, `${safeNamespace(uid, "snapshot UID")}.sdn`);
    if (!existsSync(path)) return null;
    try { return validateGraphSnapshotManifest(JSON.parse(readFileSync(path, "utf8")), this.worktree_uid); }
    catch (cause) { throw fail("SPK803", `snapshot manifest is malformed: ${cause.message}`); }
  }

  #acquireWriterLock(transactionId) {
    mkdirSync(dirname(this.lock_path), { recursive: true });
    let fd;
    try { fd = openSync(this.lock_path, "wx"); }
    catch (cause) {
      if (cause?.code === "EEXIST") throw fail("SPK901", "another snapshot writer owns the worktree");
      throw cause;
    }
    writeFileSync(fd, `${canonicalJson({ pid: process.pid, transaction_id: transactionId, nonce: randomBytes(16).toString("hex"), started_at_ms: Date.now() })}\n`);
    fsyncSync(fd);
    syncDirectory(dirname(this.lock_path));
    return { fd };
  }
}
