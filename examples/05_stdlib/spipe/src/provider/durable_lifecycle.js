import { createHash } from "node:crypto";
import { open, mkdir, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { canonicalBytes } from "../model/identity.js";
import { searchFail } from "../index/contracts.js";

const HASH = /^sha256:[a-f0-9]{64}$/;
const domainInput = (domain, bytes) => { const length = Buffer.alloc(8); length.writeBigUInt64BE(BigInt(bytes.length)); return Buffer.concat([Buffer.from(`${domain}\0`), length, bytes]); };
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const indexPayloadHash = (kind, payloadWithoutHash) => `sha256:${digest(domainInput(kind === "apply" ? "SPKC-INDEX-APPLY-PAYLOAD-V1" : "SPKC-INDEX-PUBLISH-PAYLOAD-V1", canonicalBytes(payloadWithoutHash)))}`;

export class FileLifecycleOwner {
  constructor(directory) { if (!path.isAbsolute(directory)) searchFail("invalid_request", "lifecycle directory must be absolute"); this.directory = directory; this.file = path.join(directory, "provider-lifecycle-v1.json"); this.lock = path.join(directory, ".provider-lifecycle.lock"); }
  async load() { try { return JSON.parse(await readFile(this.file, "utf8")); } catch (error) { if (error.code === "ENOENT") return { schema: "spipe-provider-lifecycle-store-v1", roots: {}, candidates: {}, candidate_objects: {}, replay: {}, terminal_errors: {} }; searchFail("snapshot_corrupt", "durable lifecycle state cannot be loaded"); } }
  async commit(state) {
    await mkdir(this.directory, { recursive: true });
    const temporary = path.join(this.directory, `.provider-lifecycle-${process.pid}-${Date.now()}.tmp`), bytes = canonicalBytes(state);
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, this.file);
    const directory = await open(this.directory, "r"); try { await directory.sync(); } finally { await directory.close(); }
  }
  async transaction(work) {
    await mkdir(this.directory, { recursive: true });
    let lock;
    try { lock = await open(this.lock, "wx", 0o600); await lock.writeFile(`${process.pid}\n`); await lock.sync(); }
    catch (error) { if (error.code === "EEXIST") searchFail("provider_unavailable", "another process owns the lifecycle writer lock"); throw error; }
    try { const state = await this.load(); const result = await work(state); await this.commit(state); return result; }
    finally { if (lock) await lock.close(); await unlink(this.lock).catch(() => undefined); }
  }
}

function authorityIdentity(authority) {
  if (!authority || typeof authority.identity !== "function" || typeof authority.sign !== "function" || typeof authority.verify !== "function") searchFail("provider_unavailable", "receipt authority is unavailable");
  const identity = authority.identity();
  for (const field of ["key_id", "authority_id", "authority_generation", "policy_version", "policy_digest", "revocation_generation"]) if (identity[field] == null) searchFail("provider_unavailable", `receipt authority lacks ${field}`);
  return identity;
}

function signedReceipt(authority, domain, prefix, unsigned) {
  const bytes = canonicalBytes(unsigned), input = domainInput(domain, bytes), suffix = digest(input), signature = authority.sign(input);
  if (typeof signature !== "string" || !authority.verify(input, signature)) searchFail("provider_unavailable", "receipt authority signature did not verify");
  return Object.freeze({ ...unsigned, receipt_id: `${prefix}${suffix}`, signature });
}

const OPERATION_RECEIPT_FIELDS = ["schema", "key_id", "authority_id", "authority_generation", "operation_id", "operation", "provider_generation", "workspace", "snapshot", "scope_digest", "base_logical_root", "result_logical_root", "candidate_uid", "payload_hash", "outcome", "issued_at_ms", "expires_at_ms", "policy_version", "policy_digest", "revocation_generation", "receipt_id", "signature"];
const EXPIRY_RECEIPT_FIELDS = ["schema", "key_id", "authority_id", "authority_generation", "candidate_uid", "workspace", "snapshot", "scope_digest", "base_logical_root", "candidate_logical_root", "apply_operation_id", "apply_receipt_id", "candidate_expires_at_ms", "expired_at_ms", "policy_version", "policy_digest", "revocation_generation", "outcome", "receipt_id", "signature"];
const CANDIDATE_FIELDS = ["schema", "candidate_uid", "apply_operation_id", "apply_receipt_id", "workspace", "snapshot", "scope_digest", "base_logical_root", "candidate_logical_root", "payload_hash", "created_at_ms", "candidate_expires_at_ms", "state", "terminal_operation_id", "terminal_receipt_kind", "terminal_receipt_id", "terminal_at_ms"];
const TERMINAL_ERROR_FIELDS = ["schema", "workspace", "snapshot", "scope_digest", "operation", "operation_id", "payload_hash", "candidate_uid", "observed_terminal_state", "observed_terminal_receipt_kind", "observed_terminal_receipt_id", "response", "response_hash", "recorded_at_ms"];
const closed = (record, fields, label) => { if (!record || typeof record !== "object" || Array.isArray(record) || Object.keys(record).length !== fields.length || Object.keys(record).some((key) => !fields.includes(key))) searchFail("snapshot_corrupt", `${label} is not a closed v1 record`); };

function verifyReceipt(receipt, authority, candidateAuthority) {
  const expiry = receipt?.schema === "spipe-candidate-expiry-receipt-v1", fields = expiry ? EXPIRY_RECEIPT_FIELDS : OPERATION_RECEIPT_FIELDS;
  closed(receipt, fields, "durable receipt"); const verifier = expiry ? candidateAuthority : authority, identity = authorityIdentity(verifier);
  for (const field of ["key_id", "authority_id", "authority_generation", "policy_version", "policy_digest", "revocation_generation"]) if (receipt[field] !== identity[field]) searchFail("snapshot_corrupt", `receipt ${field} no longer binds admitted authority`);
  const { receipt_id, signature, ...unsigned } = receipt, domain = expiry ? "SPKC-CANDIDATE-EXPIRY-RECEIPT-V1" : "SPKC-OPERATION-RECEIPT-V1", prefix = expiry ? "cer-" : "or-", input = domainInput(domain, canonicalBytes(unsigned));
  if (receipt_id !== `${prefix}${digest(input)}` || !verifier.verify(input, signature)) searchFail("snapshot_corrupt", "durable receipt signature or identity is invalid");
}

function validateDurableState(state, authority, candidateAuthority) {
  if (!state || state.schema !== "spipe-provider-lifecycle-store-v1" || !state.roots || !state.candidates || !state.candidate_objects || !state.replay || !state.terminal_errors) searchFail("snapshot_corrupt", "durable lifecycle root schema is invalid");
  const receipts = new Map();
  for (const [key, replay] of Object.entries(state.replay)) {
    closed(replay, ["payload_hash", "response", "receipt"], "durable replay record");
    if (!HASH.test(replay.payload_hash)) searchFail("snapshot_corrupt", "durable replay payload hash is invalid");
    verifyReceipt(replay.receipt, authority, candidateAuthority); receipts.set(replay.receipt.receipt_id, replay.receipt);
    if (key.startsWith("expiry\0")) closed(replay.response, CANDIDATE_FIELDS, "expiry replay candidate");
    else if (replay.receipt.operation === "index_apply") closed(replay.response, ["status", "base_logical_root", "added", "replaced", "deleted", "candidate_uid", "candidate_logical_root", "candidate_expires_at_ms"], "index_apply replay response");
    else closed(replay.response, ["status", "previous_logical_root", "logical_root", "candidate_uid"], "index_publish replay response");
  }
  for (const candidate of Object.values(state.candidates)) {
    closed(candidate, CANDIDATE_FIELDS, "CandidateRecordV1");
    if (!receipts.has(candidate.apply_receipt_id)) searchFail("snapshot_corrupt", "candidate apply receipt is missing");
    if (candidate.state === "staged") { if ([candidate.terminal_operation_id, candidate.terminal_receipt_kind, candidate.terminal_receipt_id, candidate.terminal_at_ms].some((value) => value !== null)) searchFail("snapshot_corrupt", "staged candidate has terminal fields"); }
    else if (!receipts.has(candidate.terminal_receipt_id)) searchFail("snapshot_corrupt", "terminal candidate receipt is missing");
  }
  for (const errorRecord of Object.values(state.terminal_errors)) {
    closed(errorRecord, TERMINAL_ERROR_FIELDS, "DurableTerminalErrorV1");
    closed(errorRecord.response, ["request_id", "operation", "ok", "protocol", "provider_generation", "workspace", "snapshot", "scope_digest", "query_receipt", "operation_receipt", "error"], "durable ErrorResponseV1");
    closed(errorRecord.response.protocol, ["major", "minor"], "durable error protocol"); closed(errorRecord.response.error, ["code", "message", "retryable"], "durable error body");
    if (errorRecord.schema !== "spipe-durable-terminal-error-v1" || errorRecord.response_hash !== `sha256:${digest(canonicalBytes(errorRecord.response))}` || errorRecord.response.operation_receipt !== null || errorRecord.response.workspace !== errorRecord.workspace || errorRecord.response.scope_digest !== errorRecord.scope_digest) searchFail("snapshot_corrupt", "durable terminal error binding is invalid");
    if (!receipts.has(errorRecord.observed_terminal_receipt_id)) searchFail("snapshot_corrupt", "durable terminal error winner receipt is missing");
  }
  return state;
}

export class DurableCandidateLifecycle {
  #owner; #authority; #candidateAuthority; #clock; #state = null; #tail = Promise.resolve();
  constructor({ owner, receipt_authority, candidate_authority = receipt_authority, clock = () => Date.now() }) { if (!owner?.load || !owner?.commit || !owner?.transaction) searchFail("provider_unavailable", "durable filesystem owner is unavailable"); this.#owner = owner; this.#authority = receipt_authority; this.#candidateAuthority = candidate_authority; this.#clock = clock; }
  async initialize() { this.#state = validateDurableState(await this.#owner.load(), this.#authority, this.#candidateAuthority); return this; }
  #ready() { if (!this.#state) searchFail("provider_unavailable", "durable lifecycle is not initialized"); }
  #exclusive(work) { const run = () => this.#owner.transaction(async (latest) => { this.#state = validateDurableState(latest, this.#authority, this.#candidateAuthority); return work(); }); const result = this.#tail.then(run, run); this.#tail = result.then(() => undefined, () => undefined); return result; }
  stage(input) { return this.#exclusive(() => this.#stage(input)); }
  async #stage({ binding, operation_id, payload_hash, base_logical_root, candidate_logical_root, candidate_object = null, outcome, response, expires_at_ms }) {
    this.#ready(); if (!HASH.test(payload_hash)) searchFail("invalid_request", "payload_hash must be HashText");
    const replayKey = `${binding.workspace}\0${binding.snapshot}\0${binding.scope_digest}\0index_apply\0${operation_id}`;
    const old = this.#state.replay[replayKey]; if (old) { if (old.payload_hash !== payload_hash) searchFail("operation_conflict", "operation ID payload changed"); return old; }
    const uidBytes = canonicalBytes({ workspace: binding.workspace, snapshot: binding.snapshot, scope_digest: binding.scope_digest, base_logical_root, candidate_logical_root, apply_payload_hash: payload_hash });
    const candidate_uid = `cand-${digest(domainInput("SPKC-CANDIDATE-UID-V1", uidBytes))}`, now = this.#clock(), identity = authorityIdentity(this.#authority);
    const unsigned = { schema: "spipe-operation-receipt-v1", key_id: identity.key_id, authority_id: identity.authority_id, authority_generation: identity.authority_generation, operation_id, operation: "index_apply", provider_generation: binding.provider_generation, workspace: binding.workspace, snapshot: binding.snapshot, scope_digest: binding.scope_digest, base_logical_root, result_logical_root: candidate_logical_root, candidate_uid, payload_hash, outcome, issued_at_ms: now, expires_at_ms, policy_version: identity.policy_version, policy_digest: identity.policy_digest, revocation_generation: identity.revocation_generation };
    const receipt = signedReceipt(this.#authority, "SPKC-OPERATION-RECEIPT-V1", "or-", unsigned);
    const record = { schema: "spipe-candidate-v1", candidate_uid, apply_operation_id: operation_id, apply_receipt_id: receipt.receipt_id, workspace: binding.workspace, snapshot: binding.snapshot, scope_digest: binding.scope_digest, base_logical_root, candidate_logical_root, payload_hash, created_at_ms: now, candidate_expires_at_ms: expires_at_ms, state: "staged", terminal_operation_id: null, terminal_receipt_kind: null, terminal_receipt_id: null, terminal_at_ms: null };
    const replay = { payload_hash, response: { ...response, candidate_uid, candidate_logical_root, candidate_expires_at_ms: expires_at_ms }, receipt };
    this.#state.candidates[candidate_uid] = record; if (candidate_object !== null) this.#state.candidate_objects[candidate_uid] = candidate_object; this.#state.replay[replayKey] = replay; return replay;
  }
  candidateObject(candidate_uid) { this.#ready(); const value = this.#state.candidate_objects[candidate_uid]; if (!value) searchFail("candidate_missing", "durable candidate object is absent"); return value; }
  terminal(input) { return this.#exclusive(() => this.#terminal(input)); }
  async #terminal({ binding, operation_id, payload_hash, candidate_uid, action, expected_base_logical_root, response }) {
    this.#ready(); const replayKey = `${binding.workspace}\0${binding.snapshot}\0${binding.scope_digest}\0index_publish\0${operation_id}`, old = this.#state.replay[replayKey];
    if (old) { if (old.payload_hash !== payload_hash) searchFail("operation_conflict", "operation ID payload changed"); return old; }
    const oldError = this.#state.terminal_errors[replayKey]; if (oldError) { if (oldError.payload_hash !== payload_hash) searchFail("operation_conflict", "operation ID payload changed"); return { error_record: oldError }; }
    const candidate = this.#state.candidates[candidate_uid]; if (!candidate || candidate.workspace !== binding.workspace || candidate.scope_digest !== binding.scope_digest) searchFail("candidate_missing", "candidate is absent or cross-scope");
    if (candidate.state !== "staged") {
      const code = candidate.state === "expired" ? "candidate_expired" : candidate.state === "aborted" ? "candidate_aborted" : "stale_base";
      const boundResponse = { request_id: operation_id, operation: "index_publish", ok: false, protocol: { major: 1, minor: 0 }, provider_generation: binding.provider_generation, workspace: binding.workspace, snapshot: binding.snapshot, scope_digest: binding.scope_digest, query_receipt: null, operation_receipt: null, error: { code, message: "candidate is already terminal", retryable: false } };
      const errorRecord = { schema: "spipe-durable-terminal-error-v1", workspace: binding.workspace, snapshot: binding.snapshot, scope_digest: binding.scope_digest, operation: "index_publish", operation_id, payload_hash, candidate_uid, observed_terminal_state: candidate.state, observed_terminal_receipt_kind: candidate.terminal_receipt_kind, observed_terminal_receipt_id: candidate.terminal_receipt_id, response: boundResponse, response_hash: `sha256:${digest(canonicalBytes(boundResponse))}`, recorded_at_ms: this.#clock() };
      this.#state.terminal_errors[replayKey] = errorRecord; return { error_record: errorRecord };
    }
    const current = this.#state.roots[binding.scope_digest] ?? expected_base_logical_root;
    const outcome = action === "abort" ? "aborted" : current === expected_base_logical_root ? "published" : "stale_base", resultRoot = outcome === "published" ? candidate.candidate_logical_root : current, now = this.#clock(), identity = authorityIdentity(this.#authority);
    const unsigned = { schema: "spipe-operation-receipt-v1", key_id: identity.key_id, authority_id: identity.authority_id, authority_generation: identity.authority_generation, operation_id, operation: "index_publish", provider_generation: binding.provider_generation, workspace: binding.workspace, snapshot: binding.snapshot, scope_digest: binding.scope_digest, base_logical_root: expected_base_logical_root, result_logical_root: resultRoot, candidate_uid, payload_hash, outcome, issued_at_ms: now, expires_at_ms: candidate.candidate_expires_at_ms, policy_version: identity.policy_version, policy_digest: identity.policy_digest, revocation_generation: identity.revocation_generation };
    const receipt = signedReceipt(this.#authority, "SPKC-OPERATION-RECEIPT-V1", "or-", unsigned);
    Object.assign(candidate, { state: outcome, terminal_operation_id: operation_id, terminal_receipt_kind: "operation", terminal_receipt_id: receipt.receipt_id, terminal_at_ms: now });
    if (outcome === "published") this.#state.roots[binding.scope_digest] = resultRoot;
    const replay = { payload_hash, response: { ...response, status: outcome, previous_logical_root: current, logical_root: resultRoot, candidate_uid }, receipt };
    this.#state.replay[replayKey] = replay; return replay;
  }
  expire(candidate_uid) { return this.#exclusive(() => this.#expire(candidate_uid)); }
  async #expire(candidate_uid) {
    this.#ready(); const candidate = this.#state.candidates[candidate_uid]; if (!candidate) searchFail("candidate_missing", "candidate is absent"); if (candidate.state !== "staged") return candidate;
    const now = this.#clock(); if (now < candidate.candidate_expires_at_ms) searchFail("invalid_request", "candidate has not expired"); const identity = authorityIdentity(this.#candidateAuthority);
    const unsigned = { schema: "spipe-candidate-expiry-receipt-v1", key_id: identity.key_id, authority_id: identity.authority_id, authority_generation: identity.authority_generation, candidate_uid, workspace: candidate.workspace, snapshot: candidate.snapshot, scope_digest: candidate.scope_digest, base_logical_root: candidate.base_logical_root, candidate_logical_root: candidate.candidate_logical_root, apply_operation_id: candidate.apply_operation_id, apply_receipt_id: candidate.apply_receipt_id, candidate_expires_at_ms: candidate.candidate_expires_at_ms, expired_at_ms: now, policy_version: identity.policy_version, policy_digest: identity.policy_digest, revocation_generation: identity.revocation_generation, outcome: "expired" };
    const receipt = signedReceipt(this.#candidateAuthority, "SPKC-CANDIDATE-EXPIRY-RECEIPT-V1", "cer-", unsigned);
    Object.assign(candidate, { state: "expired", terminal_operation_id: null, terminal_receipt_kind: "candidate_expiry", terminal_receipt_id: receipt.receipt_id, terminal_at_ms: now }); this.#state.replay[`expiry\0${candidate_uid}`] = { payload_hash: candidate.payload_hash, response: candidate, receipt }; return { candidate, receipt };
  }
}

export class BoundRequestTracker {
  #requests = new Map();
  start(request_id) { if (this.#requests.has(request_id)) searchFail("invalid_request", "request ID already exists"); const controller = new AbortController(); this.#requests.set(request_id, { state: "running", controller }); return controller.signal; }
  complete(request_id) { const request = this.#requests.get(request_id); if (request) request.state = "complete"; }
  cancel(target_request_id) { const request = this.#requests.get(target_request_id); if (!request) searchFail("cancel_target_not_found", "target request never existed in this generation"); if (request.state === "complete") return Object.freeze({ target_request_id, status: "already_complete" }); request.controller.abort(); request.state = "complete"; return Object.freeze({ target_request_id, status: "cancelled" }); }
}
