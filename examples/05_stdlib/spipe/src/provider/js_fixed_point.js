import { createHash } from "node:crypto";
import { CONTRACTS, searchFail } from "../index/contracts.js";
import { LogicalLexicalIndex } from "../index/logical_index.js";
import { createInitializeResult, validateInitializeRequest } from "./protocol.js";
import { indexPayloadHash } from "./durable_lifecycle.js";

const IMPLEMENTATION_DIGEST = `sha256:${createHash("sha256").update("spipe-js-fixed-point-v1", "utf8").digest("hex")}`;

export class JsFixedPointSearchProvider {
  #state = "new"; #index = null; #generation; #lifecycle;
  constructor({ analyzer, generation = "pg-00000000000000000000000000000000", lifecycle = null }) { this.analyzer = analyzer; this.#generation = generation; this.#lifecycle = lifecycle; }
  initialize(request) {
    if (this.#state !== "new") searchFail("invalid_request", "provider is already initialized");
    this.#state = "initializing";
    try { validateInitializeRequest(request); this.#state = "healthy"; return createInitializeResult({ request_id: request.request_id, implementation_digest: IMPLEMENTATION_DIGEST }); }
    catch (error) { this.#state = "quarantined"; throw error; }
  }
  open({ scope_digest, documents = [] }) { this.#requireHealthy(); this.#index = new LogicalLexicalIndex({ scope_digest, analyzer: this.analyzer, documents }); return Object.freeze({ logical_root: this.#index.logical_root, document_count: this.#index.document_count, state: documents.length ? "opened" : "created" }); }
  apply(payload) { this.#requireIndex(); return this.#index.apply(payload); }
  publish(candidate, expected_base_logical_root) { this.#requireIndex(); return this.#index.publish(candidate, expected_base_logical_root); }
  async stageApply({ binding, operation_id, payload_hash, base_logical_root, operations, expires_at_ms }) {
    this.#requireIndex(); if (!this.#lifecycle) searchFail("provider_unavailable", "durable candidate lifecycle is unavailable");
    if (payload_hash !== indexPayloadHash("apply", { operation_id, base_logical_root, operations })) searchFail("binding_mismatch", "apply payload hash mismatch");
    const staged = this.#index.apply({ base_logical_root, operations }), candidateSnapshot = { scope_digest: this.#index.snapshot().scope_digest, documents: staged.candidate ? [...staged.candidate.documents.values()] : [] };
    const durable = await this.#lifecycle.stage({ binding, operation_id, payload_hash, base_logical_root, candidate_logical_root: staged.candidate.logical_root, candidate_object: candidateSnapshot, outcome: staged.status, response: { status: staged.status, base_logical_root, added: staged.added, replaced: staged.replaced, deleted: staged.deleted }, expires_at_ms });
    return Object.freeze({ result: durable.response, operation_receipt: durable.receipt });
  }
  async publishCandidate({ binding, operation_id, payload_hash, action, candidate_uid, expected_base_logical_root, candidate_logical_root }) {
    this.#requireIndex(); if (!this.#lifecycle) searchFail("provider_unavailable", "durable candidate lifecycle is unavailable");
    if (payload_hash !== indexPayloadHash("publish", { operation_id, action, candidate_uid, expected_base_logical_root, candidate_logical_root })) searchFail("binding_mismatch", "publish payload hash mismatch");
    if (action !== "publish" && action !== "abort") searchFail("invalid_request", "publish action must be publish or abort");
    const stored = this.#lifecycle.candidateObject(candidate_uid), rebuilt = new LogicalLexicalIndex({ scope_digest: stored.scope_digest, analyzer: this.analyzer, documents: stored.documents });
    if (rebuilt.logical_root !== candidate_logical_root) searchFail("binding_mismatch", "requested candidate root mismatch");
    const durable = await this.#lifecycle.terminal({ binding, operation_id, payload_hash, candidate_uid, action, expected_base_logical_root, response: {} });
    if (durable.error_record) searchFail(durable.error_record.response.error.code, durable.error_record.response.error.message, { durable_terminal_error: durable.error_record });
    if (durable.response.status === "published") { if (rebuilt.logical_root !== durable.response.logical_root) searchFail("snapshot_corrupt", "durable candidate root mismatch"); this.#index = rebuilt; }
    return Object.freeze({ result: durable.response, operation_receipt: durable.receipt });
  }
  search(payload) { this.#requireIndex(); return this.#index.query(payload); }
  explain(payload) { this.#requireIndex(); return Object.freeze({ logical_root: this.#index.logical_root, document_id: payload.document_id, explanation: this.#index.explain(payload) }); }
  stats() { this.#requireIndex(); return Object.freeze({ ...this.#index.stats(), index_bytes: 0, cache_bytes: 0, peak_rss_bytes: process.memoryUsage().rss }); }
  health() { return Object.freeze({ state: this.#state, provider_generation: this.#generation, provider: CONTRACTS.provider, analyzer: CONTRACTS.analyzer, score: CONTRACTS.score, explanation: CONTRACTS.explanation, logical_index: CONTRACTS.logical_index, logical_root: this.#index?.logical_root ?? null }); }
  shutdown() { if (this.#state !== "closed") this.#state = "closed"; return Object.freeze({ status: "closing" }); }
  #requireHealthy() { if (this.#state !== "healthy") searchFail("handshake_required", "initialize first"); }
  #requireIndex() { this.#requireHealthy(); if (!this.#index) searchFail("snapshot_not_found", "no logical index is open"); }
}
