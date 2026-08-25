import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, sign, verify, createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { CONTRACTS, LogicalLexicalIndex, createUnicode17Analyzer, deriveScopedSearchDocument, fixedLn, fuseRankings, resolveExactIdentity, scoreTerm, searchWithIdentityDominance } from "../../src/index/index.js";
import { BoundRequestTracker, DurableCandidateLifecycle, FileLifecycleOwner, InProcessSearchProviderAdapter, JsFixedPointSearchProvider, healthProbe, indexPayloadHash } from "../../src/provider/index.js";

const HASH0 = `sha256:${"0".repeat(64)}`;
const HASH1 = `sha256:${"1".repeat(64)}`;
const tables = Object.freeze({
  version: "17.0.0",
  normalizeNfc: (value) => value.normalize("NFC"),
  defaultLowercase: (value) => value.toLowerCase(),
  isAlphabetic: (cp) => /\p{Alphabetic}/u.test(String.fromCodePoint(cp)),
  isDecimalNumber: (cp) => /\p{Decimal_Number}/u.test(String.fromCodePoint(cp)),
  isMark: (cp) => /\p{Mark}/u.test(String.fromCodePoint(cp))
});
const analyzer = createUnicode17Analyzer(tables, { stop_words: ["the"] });

function doc(document_id, title, body, facets = []) {
  return deriveScopedSearchDocument({ document_id, revision: "rev-1", fields: [
    { name: "identifier", value: document_id }, { name: "title", value: title }, { name: "body", value: body }
  ], facets, visibility_digest: HASH1, scope_digest: HASH0 });
}

test("analyzer preserves positions across stop words and exact identifier token", () => {
  const prose = analyzer.analyze("Alpha the BETA");
  assert.deepEqual(prose.tokens, [{ term: "alpha", position: 1 }, { term: "beta", position: 3 }]);
  const identifier = analyzer.analyze("REQ-Search_001", { identifier: true });
  assert.ok(identifier.tokens.some(({ term }) => term === "req-search_001"));
  assert.deepEqual(analyzer.query("beta beta alpha"), [{ term: "alpha", qtf: 1 }, { term: "beta", qtf: 2 }]);
  assert.throws(() => createUnicode17Analyzer(null), (error) => error.code === "incompatible_contract");
});

test("checked BM25 emits recomputable fixed-point intermediates", () => {
  assert.equal(fixedLn(1_000_000n), 0n);
  const contribution = scoreTerm({ N: 2, df: 1, total_length: 4, document_length: 2, tf: 1, weight_milli: 1000 });
  assert.match(contribution.weighted, /^[0-9]+$/);
  assert.throws(() => scoreTerm({ N: 1, df: 2, total_length: 1, document_length: 1, tf: 1, weight_milli: 1000 }), (error) => error.code === "invalid_document_frequency");
});

test("logical index is deterministic, searchable, explainable, and delta-safe", () => {
  const alpha = doc("A-alpha", "Alpha Search", "shared ranking search", [{ name: "kind", value: "design" }]);
  const beta = doc("A-beta", "Beta", "ranking", [{ name: "kind", value: "design" }]);
  const first = new LogicalLexicalIndex({ scope_digest: HASH0, analyzer, documents: [beta, alpha] });
  const second = new LogicalLexicalIndex({ scope_digest: HASH0, analyzer, documents: [alpha, beta] });
  assert.equal(first.logical_root, second.logical_root);
  const page = first.query({ query_text: "search ranking", filters: [], limit: 10, explain: true });
  assert.deepEqual(page.hits.map(({ document_id }) => document_id), ["A-alpha", "A-beta"]);
  assert.equal(page.hits[0].explanation.contract, CONTRACTS.explanation);
  assert.equal(page.hits[0].explanation.public_score_milli, page.hits[0].score_milli);
  const absent = first.apply({ base_logical_root: first.logical_root, operations: [{ kind: "delete", document_id: "A-missing", before_revision: null, before_hash: null, after: null }] });
  assert.equal(absent.status, "no_op"); assert.equal(absent.candidate.logical_root, first.logical_root);
  const changed = first.apply({ base_logical_root: first.logical_root, operations: [{ kind: "delete", document_id: beta.document_id, before_revision: beta.revision, before_hash: beta.scoped_content_hash, after: null }] });
  assert.equal(first.publish(changed.candidate, first.logical_root), "published");
  assert.equal(first.document_count, 1);
});

test("exact identity dominance is authorization-aware and outside RRF", () => {
  const identities = [{ uid: "A-one", key: "search", aliases: [], allowed: true }, { uid: "A-private", key: "private", aliases: [{ value: "old", status: "accepted" }], allowed: false }];
  assert.equal(resolveExactIdentity("search", identities, (item) => item.allowed).uid, "A-one");
  assert.throws(() => resolveExactIdentity("old", identities, (item) => item.allowed), (error) => error.code === "not_found");
  const result = searchWithIdentityDominance({ query: "search", identities, authorize: (item) => item.allowed, sources: { lexical: [{ document_id: "A-two" }, { document_id: "A-one" }], graph: [{ document_id: "A-one" }, { document_id: "A-two" }] }, fusion: fuseRankings });
  assert.equal(result.results[0].document_id, "A-one"); assert.equal(result.results[0].match_tier, "exact_identity");
  assert.equal(result.results[1].document_id, "A-two"); assert.equal(result.results[1].final_rank, 2);
});

test("RRF rejects source duplicates and ignores incompatible raw score scales", () => {
  const fused = fuseRankings({ lexical: [{ document_id: "A" , score: 999999 }, { document_id: "B", score: 1 }], graph: [{ document_id: "B", score: -8 }, { document_id: "A", score: 88 }] });
  assert.deepEqual(fused.map(({ document_id }) => document_id), ["A", "B"]);
  assert.throws(() => fuseRankings({ lexical: [{ document_id: "A" }, { document_id: "A" }] }), (error) => error.code === "invalid_request");
});

test("in-process provider requires handshake and proves contract/root health", () => {
  const provider = new JsFixedPointSearchProvider({ analyzer });
  const adapter = new InProcessSearchProviderAdapter(provider);
  assert.throws(() => adapter.open({ scope_digest: HASH0 }), (error) => error.code === "provider_unavailable");
  const initialized = adapter.initialize({ request_id: "request-1", operation: "initialize", protocol: { major: 1, minor: 0 }, client: "spipe", required: { provider: CONTRACTS.provider, analyzer: CONTRACTS.analyzer, score: CONTRACTS.score, explanation: CONTRACTS.explanation, logical_index: CONTRACTS.logical_index }, limits: { max_frame_bytes: 1048576 } });
  assert.equal(initialized.result.capabilities.phrase, false);
  const opened = adapter.open({ scope_digest: HASH0, documents: [doc("A-alpha", "Alpha", "search")] });
  assert.equal(healthProbe(provider, opened.logical_root).state, "healthy");
  assert.equal(adapter.search({ query_text: "search", filters: [], limit: 10, cursor: null, explain: false }).hits.length, 1);
  const added = doc("A-beta", "Beta", "search");
  const staged = adapter.apply({ base_logical_root: opened.logical_root, operations: [{ kind: "add", document_id: added.document_id, before_revision: null, before_hash: null, after: added }] });
  assert.equal(staged.status, "applied");
  assert.equal(adapter.publish({ candidate: staged.candidate, expected_base_logical_root: opened.logical_root }), "published");
  assert.equal(adapter.stats({ logical_root: provider.health().logical_root }).document_count, 2);
  assert.equal(adapter.shutdown().status, "closing");
});

test("authenticated cursors bind the exact query and reject tampering", () => {
  const documents = [doc("A-a", "Search", "one"), doc("A-b", "Search", "two"), doc("A-c", "Search", "three")];
  const index = new LogicalLexicalIndex({ scope_digest: HASH0, analyzer, documents, cursor_key: Buffer.alloc(32, 7) });
  const first = index.query({ query_text: "search", filters: [], limit: 1, cursor: null, explain: false });
  assert.equal(first.exhausted, false); assert.ok(first.next_cursor);
  const second = index.query({ query_text: "search", filters: [], limit: 1, cursor: first.next_cursor, explain: false });
  assert.equal(second.hits[0].source_rank, 2);
  assert.throws(() => index.query({ query_text: "other", filters: [], limit: 1, cursor: first.next_cursor, explain: false }), (error) => error.code === "stale_cursor");
  const changed = `${first.next_cursor.slice(0, -1)}${first.next_cursor.endsWith("A") ? "B" : "A"}`;
  assert.throws(() => index.query({ query_text: "search", filters: [], limit: 1, cursor: changed, explain: false }), (error) => error.code === "stale_cursor");
});

test("closed initialization rejects extra fields and closed operations reject omissions", () => {
  const provider = new JsFixedPointSearchProvider({ analyzer, generation: "pg-11111111111111111111111111111111" });
  const adapter = new InProcessSearchProviderAdapter(provider);
  const request = { request_id: "request-2", operation: "initialize", protocol: { major: 1, minor: 0 }, client: "spipe", required: { provider: CONTRACTS.provider, analyzer: CONTRACTS.analyzer, score: CONTRACTS.score, explanation: CONTRACTS.explanation, logical_index: CONTRACTS.logical_index }, limits: { max_frame_bytes: 1048576 } };
  adapter.initialize(request);
  const opened = adapter.open({ scope_digest: HASH0, documents: [] });
  assert.throws(() => adapter.search({ query_text: "x", filters: [], limit: 1, explain: false }), (error) => error.code === "invalid_request");
  assert.throws(() => adapter.stats({ logical_root: `${opened.logical_root.slice(0, -1)}0` }), (error) => error.code === "binding_mismatch");
  const bad = new JsFixedPointSearchProvider({ analyzer });
  assert.throws(() => bad.initialize({ ...request, extra: true }), (error) => error.code === "invalid_request");
});

test("scoped content and filters enforce byte, NFC, and closed-array bounds", () => {
  assert.throws(() => deriveScopedSearchDocument({ document_id: "A-big", revision: "rev-1", fields: [{ name: "body", value: "x".repeat(1_048_577) }], facets: [], visibility_digest: HASH1, scope_digest: HASH0 }), (error) => error.code === "limit_exceeded");
  assert.throws(() => deriveScopedSearchDocument({ document_id: "A-nfc", revision: "rev-1", fields: [{ name: "body", value: "e\u0301" }], facets: [], visibility_digest: HASH1, scope_digest: HASH0 }), (error) => error.code === "invalid_request");
  const index = new LogicalLexicalIndex({ scope_digest: HASH0, analyzer, documents: [] });
  assert.throws(() => index.query({ query_text: "x", filters: [{ name: "kind", values: ["b", "a"] }], limit: 1, cursor: null, explain: false }), (error) => error.code === "invalid_request");
});

test("generated UCD 17 adapter supplies NFC, contextual lowercase, and positions by default", () => {
  const unicode = createUnicode17Analyzer(undefined, { stop_words: ["and"] });
  assert.equal(unicode.normalize("E\u0301"), "é");
  assert.equal(unicode.normalize("ΟΣ"), "ος");
  assert.equal(unicode.normalize("ΟΣΑ"), "οσα");
  assert.deepEqual(unicode.analyze("É and १२").tokens, [{ term: "é", position: 1 }, { term: "१२", position: 3 }]);
  assert.equal(unicode.identity.unicode_version, "17.0.0");
});

test("durable candidate lifecycle signs, fsyncs, replays, CAS-publishes, expires, and cancels", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "spipe-provider-lifecycle-"));
  try {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const publicDer = publicKey.export({ type: "spki", format: "der" });
    const authority = {
      identity: () => ({ key_id: `ed25519:${createHash("sha256").update(publicDer).digest("hex")}`, authority_id: "test-authority", authority_generation: 1, policy_version: 1, policy_digest: HASH1, revocation_generation: 0 }),
      sign: (bytes) => sign(null, bytes, privateKey).toString("base64url"),
      verify: (bytes, signature) => verify(null, bytes, publicKey, Buffer.from(signature, "base64url"))
    };
    let now = 1000;
    const owner = new FileLifecycleOwner(directory), lifecycle = await new DurableCandidateLifecycle({ owner, receipt_authority: authority, clock: () => now }).initialize();
    const binding = { provider_generation: "pg-00000000000000000000000000000000", workspace: "WS-TEST", snapshot: "spks1-test", scope_digest: HASH0 };
    const stageInput = { binding, operation_id: "apply-1", payload_hash: HASH1, base_logical_root: HASH0, candidate_logical_root: HASH1, outcome: "applied", response: { status: "applied", base_logical_root: HASH0, added: 1, replaced: 0, deleted: 0 }, expires_at_ms: 2000 };
    const staged = await lifecycle.stage(stageInput);
    assert.match(staged.receipt.receipt_id, /^or-[a-f0-9]{64}$/); assert.equal(staged.receipt.signature.length, 86);
    const restarted = await new DurableCandidateLifecycle({ owner: new FileLifecycleOwner(directory), receipt_authority: authority, clock: () => now }).initialize();
    assert.deepEqual(await restarted.stage(stageInput), staged);
    const published = await restarted.terminal({ binding, operation_id: "publish-1", payload_hash: HASH0, candidate_uid: staged.response.candidate_uid, action: "publish", expected_base_logical_root: HASH0, response: {} });
    assert.equal(published.response.status, "published"); assert.equal(published.response.logical_root, HASH1);
    assert.deepEqual(await restarted.terminal({ binding, operation_id: "publish-1", payload_hash: HASH0, candidate_uid: staged.response.candidate_uid, action: "publish", expected_base_logical_root: HASH0, response: {} }), published);
    const loser = await restarted.terminal({ binding, operation_id: "publish-loser", payload_hash: HASH1, candidate_uid: staged.response.candidate_uid, action: "abort", expected_base_logical_root: HASH0, response: {} });
    assert.equal(loser.error_record.response.error.code, "stale_base");
    assert.deepEqual(await restarted.terminal({ binding, operation_id: "publish-loser", payload_hash: HASH1, candidate_uid: staged.response.candidate_uid, action: "abort", expected_base_logical_root: HASH0, response: {} }), loser);
    const stagedExpiry = await restarted.stage({ ...stageInput, operation_id: "apply-2", payload_hash: `sha256:${"2".repeat(64)}`, expires_at_ms: 1100 });
    now = 1200; const expired = await restarted.expire(stagedExpiry.response.candidate_uid); assert.equal(expired.candidate.state, "expired"); assert.match(expired.receipt.receipt_id, /^cer-/);
    const tracker = new BoundRequestTracker(); tracker.start("req-1"); assert.equal(tracker.cancel("req-1").status, "cancelled"); tracker.start("req-2"); tracker.complete("req-2"); assert.equal(tracker.cancel("req-2").status, "already_complete"); assert.throws(() => tracker.cancel("unknown"), (error) => error.code === "cancel_target_not_found");

    const providerOwner = new FileLifecycleOwner(path.join(directory, "provider"));
    const providerLifecycle = await new DurableCandidateLifecycle({ owner: providerOwner, receipt_authority: authority, clock: () => now }).initialize();
    const provider = new JsFixedPointSearchProvider({ analyzer, lifecycle: providerLifecycle });
    provider.initialize({ request_id: "durable-init", operation: "initialize", protocol: { major: 1, minor: 0 }, client: "spipe", required: { provider: CONTRACTS.provider, analyzer: CONTRACTS.analyzer, score: CONTRACTS.score, explanation: CONTRACTS.explanation, logical_index: CONTRACTS.logical_index }, limits: { max_frame_bytes: 1048576 } });
    const opened = provider.open({ scope_digest: HASH0, documents: [doc("A-a", "Alpha", "search")] });
    const added = doc("A-b", "Beta", "search"), operations = [{ kind: "add", document_id: added.document_id, before_revision: null, before_hash: null, after: added }];
    const applyOperation = { operation_id: "apply-provider", base_logical_root: opened.logical_root, operations }, applyHash = indexPayloadHash("apply", applyOperation);
    const providerStage = await provider.stageApply({ binding, ...applyOperation, payload_hash: applyHash, expires_at_ms: 5000 });
    const publishOperation = { operation_id: "publish-provider", action: "publish", candidate_uid: providerStage.result.candidate_uid, expected_base_logical_root: opened.logical_root, candidate_logical_root: providerStage.result.candidate_logical_root }, publishHash = indexPayloadHash("publish", publishOperation);
    const providerPublish = await provider.publishCandidate({ binding, ...publishOperation, payload_hash: publishHash });
    assert.equal(providerPublish.result.status, "published"); assert.equal(provider.stats().document_count, 2);

    const lockOwner = new FileLifecycleOwner(path.join(directory, "lock-test")); let release;
    const held = lockOwner.transaction(async () => new Promise((resolve) => { release = resolve; }));
    while (!release) await new Promise((resolve) => setImmediate(resolve));
    await assert.rejects(() => new FileLifecycleOwner(path.join(directory, "lock-test")).transaction(async () => null), (error) => error.code === "provider_unavailable"); release(null); await held;

    const persisted = JSON.parse(await readFile(path.join(directory, "provider-lifecycle-v1.json"), "utf8"));
    const receiptReplay = Object.values(persisted.replay).find((entry) => entry.receipt?.signature); receiptReplay.receipt.signature = `${receiptReplay.receipt.signature[0] === "A" ? "B" : "A"}${receiptReplay.receipt.signature.slice(1)}`;
    await writeFile(path.join(directory, "provider-lifecycle-v1.json"), JSON.stringify(persisted));
    await assert.rejects(() => new DurableCandidateLifecycle({ owner: new FileLifecycleOwner(directory), receipt_authority: authority }).initialize(), (error) => error.code === "snapshot_corrupt");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
