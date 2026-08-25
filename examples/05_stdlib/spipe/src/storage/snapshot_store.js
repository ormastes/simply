import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { canonicalJson, freezeDeep, ZERO_HASH } from "./canonical.js";
import { canonicalSnapshotTuple as canonicalModelSnapshotTuple, createSnapshotId } from "../model/identity.js";
import { safeNamespace } from "../workspace/paths.js";
import { canonicalRoot } from "../workspace/paths.js";

export const SNAPSHOT_SCHEMA_VERSION = 1;
export const SNAPSHOT_ID_PREFIX = "spks1-";

const SNAPSHOT_FIELDS = Object.freeze([
  "project_uid", "worktree_uid", "revision_id", "base_generation_hash",
  "overlay_generation_hash", "schema_version", "parser_version",
  "analyzer_version", "provider_contract_version", "policy_hash"
]);

function requiredString(value, name) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${name} must be a non-empty string`);
  return value.normalize("NFC");
}

function hashField(value, name) {
  const text = requiredString(value, name);
  if (!/^(?:sha256:)?[0-9a-f]{64}$/.test(text)) throw new TypeError(`${name} must be a lowercase SHA-256 hash`);
  return text.replace(/^sha256:/, "");
}

function revisionField(value) {
  if (value === null || value === undefined || value === "") throw new TypeError("revision_id must be a resolved immutable revision");
  return requiredString(value, "revision_id");
}

function tupleFields(input) {
  return [
    requiredString(input.project_uid ?? input.projectUid, "project_uid"),
    requiredString(input.worktree_uid ?? input.worktreeUid, "worktree_uid"),
    revisionField(input.revision_id ?? input.revisionId),
    hashField(input.base_generation_hash ?? input.baseGenerationHash, "base_generation_hash"),
    hashField(input.overlay_generation_hash ?? input.overlayGenerationHash, "overlay_generation_hash"),
    String(input.schema_version ?? input.schemaVersion ?? SNAPSHOT_SCHEMA_VERSION),
    requiredString(input.parser_version ?? input.parserVersion ?? "1", "parser_version"),
    requiredString(input.analyzer_version ?? input.analyzerVersion ?? "1", "analyzer_version"),
    requiredString(input.provider_contract_version ?? input.providerContractVersion ?? "1", "provider_contract_version"),
    hashField(input.policy_hash ?? input.policyHash, "policy_hash")
  ];
}

export function canonicalSnapshotTuple(input) {
  const fields = tupleFields(input);
  return canonicalModelSnapshotTuple({
    project_uid: fields[0],
    worktree_uid: fields[1],
    revision_id: fields[2],
    base_generation_hash: fields[3],
    overlay_generation_hash: fields[4],
    schema_version: fields[5],
    parser_version: fields[6],
    analyzer_version: fields[7],
    provider_contract_version: fields[8],
    policy_hash: fields[9]
  });
}

export function computeSnapshotId(input) {
  const fields = tupleFields(input);
  return createSnapshotId({
    project_uid: fields[0],
    worktree_uid: fields[1],
    revision_id: fields[2],
    base_generation_hash: fields[3],
    overlay_generation_hash: fields[4],
    schema_version: fields[5],
    parser_version: fields[6],
    analyzer_version: fields[7],
    provider_contract_version: fields[8],
    policy_hash: fields[9]
  });
}

export const snapshotIdFor = computeSnapshotId;

function sortedHashes(values) {
  if (values === undefined || values === null) return [];
  if (!Array.isArray(values)) throw new TypeError("snapshot segment roots must be arrays");
  return [...new Set(values.map((value) => String(value)))].sort();
}

/** Construct and freeze one immutable metadata record. */
export function createSnapshotMetadata(input) {
  if (!input || typeof input !== "object") throw new TypeError("snapshot metadata must be an object");
  const fields = tupleFields(input);
  const snapshotUid = computeSnapshotId(input);
  if (input.snapshot_uid !== undefined && input.snapshot_uid !== snapshotUid) throw new Error("snapshot_uid does not match canonical snapshot tuple");
  const record = {
    schema: SNAPSHOT_SCHEMA_VERSION,
    snapshot_uid: snapshotUid,
    project_uid: fields[0],
    worktree_uid: fields[1],
    revision_id: fields[2],
    base_generation_hash: fields[3],
    overlay_generation_hash: fields[4],
    schema_version: Number(input.schema_version ?? input.schemaVersion ?? SNAPSHOT_SCHEMA_VERSION),
    parser_version: fields[6],
    analyzer_version: fields[7],
    provider_contract_version: fields[8],
    policy_hash: fields[9],
    base_segments: sortedHashes(input.base_segments ?? input.baseSegments),
    overlay_segment: input.overlay_segment ?? input.overlaySegment ?? null,
    alias_root: input.alias_root ?? input.aliasRoot ?? null,
    graph_root: input.graph_root ?? input.graphRoot ?? null,
    lexical_root: input.lexical_root ?? input.lexicalRoot ?? null,
    projection_root: input.projection_root ?? input.projectionRoot ?? null,
    diagnostics_root: input.diagnostics_root ?? input.diagnosticsRoot ?? null,
    config_hash: input.config_hash ?? input.configHash ?? null,
    parser_set_hash: input.parser_set_hash ?? input.parserSetHash ?? null,
    canonical_tuple: canonicalSnapshotTuple(input)
  };
  for (const field of ["overlay_segment", "alias_root", "graph_root", "lexical_root", "projection_root", "diagnostics_root", "config_hash", "parser_set_hash"]) {
    if (record[field] !== null) {
      const normalized = hashField(record[field], field);
      record[field] = field === "graph_root" ? `sha256:${normalized}` : normalized;
    }
  }
  return freezeDeep(JSON.parse(canonicalJson(record)));
}

function atomicWrite(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, text, { encoding: "utf8", flag: "wx" });
  renameSync(temporary, path);
}

export class ImmutableSnapshotStore {
  constructor({ cacheRoot = null, root = null, repositoryId = "default" } = {}) {
    cacheRoot ??= root;
    if (!cacheRoot) throw new TypeError("cacheRoot is required");
    this.cacheRoot = canonicalRoot(String(cacheRoot));
    this.repository_id = safeNamespace(String(repositoryId), "repository id");
    this.root = join(this.cacheRoot, "shared", this.repository_id, "snapshots");
    mkdirSync(this.root, { recursive: true });
  }

  pathFor(snapshotUid) {
    if (typeof snapshotUid !== "string" || !/^spks1-[0-9a-f]{64}$/.test(snapshotUid)) throw new TypeError("snapshot UID is invalid");
    return join(this.root, `${snapshotUid}.sdn`);
  }

  has(snapshotUid) {
    return existsSync(this.pathFor(snapshotUid));
  }

  put(metadata) {
    const record = createSnapshotMetadata(metadata);
    const path = this.pathFor(record.snapshot_uid);
    const bytes = `${canonicalJson(record)}\n`;
    if (existsSync(path)) {
      const existing = readFileSync(path, "utf8");
      if (existing !== bytes) throw new Error(`immutable snapshot collision: ${record.snapshot_uid}`);
      return record;
    }
    atomicWrite(path, bytes);
    return record;
  }

  read(snapshotUid) {
    const record = JSON.parse(readFileSync(this.pathFor(snapshotUid), "utf8"));
    const rebuilt = createSnapshotMetadata(record);
    if (canonicalJson(rebuilt) !== canonicalJson(record)) throw new Error(`snapshot metadata failed verification: ${snapshotUid}`);
    return rebuilt;
  }

  get(snapshotUid) {
    return this.read(snapshotUid);
  }

  pin(snapshotUid) {
    return this.read(snapshotUid);
  }

  static cleanOverlayHash() {
    return ZERO_HASH;
  }
}

export function createSnapshotStore(options) {
  return new ImmutableSnapshotStore(options);
}
