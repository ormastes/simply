import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { CONTRACTS, FIELD_CONTRACT, compareUtf8, searchFail } from "./contracts.js";
import { createScopedSearchDocument, fieldWeight, hashCanonical } from "./document.js";
import { finalizeExplanation, scoreTerm, sortHits } from "./bm25.js";
import { canonicalBytes } from "../model/identity.js";

function documentHash(document) { return document.scoped_content_hash; }
function sortedDocuments(documents) { return [...documents.values()].sort((a, b) => compareUtf8(a.document_id, b.document_id)); }

export function logicalRoot(scope_digest, documents) {
  return hashCanonical({ contract: CONTRACTS.logical_index, analyzer: CONTRACTS.analyzer, score: CONTRACTS.score, scope_digest, documents: sortedDocuments(documents) });
}

function analyzeDocument(document, analyzer) {
  const analyzed = new Map();
  for (const field of document.fields) {
    const tokens = analyzer.analyze(field.value, { identifier: field.name === "identifier" }).tokens.map(({ term }) => term);
    const frequencies = new Map();
    for (const term of tokens) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
    analyzed.set(field.name, Object.freeze({ length: tokens.length, frequencies }));
  }
  return analyzed;
}

function buildState(scope_digest, documents, analyzer) {
  const analyzed = new Map(), fieldStats = new Map();
  for (const field of FIELD_CONTRACT) fieldStats.set(field.name, { N: 0, total_length: 0, df: new Map() });
  for (const document of documents.values()) {
    const record = analyzeDocument(document, analyzer);
    analyzed.set(document.document_id, record);
    for (const field of document.fields) {
      const local = record.get(field.name), stats = fieldStats.get(field.name);
      stats.N += 1; stats.total_length += local.length;
      for (const term of local.frequencies.keys()) stats.df.set(term, (stats.df.get(term) ?? 0) + 1);
    }
  }
  return { scope_digest, documents, analyzed, fieldStats, logical_root: logicalRoot(scope_digest, documents) };
}

function validateFilters(filters) {
  if (!Array.isArray(filters) || filters.length > 32) searchFail("limit_exceeded", "at most 32 equality filters are supported");
  let prior = null;
  for (const filter of filters) {
    if (!filter || Object.keys(filter).join(",") !== "name,values" || !Array.isArray(filter.values) || filter.values.length < 1 || filter.values.length > 64) searchFail("invalid_request", "invalid equality filter");
    if (prior !== null && compareUtf8(prior, filter.name) >= 0) searchFail("invalid_request", "filter names must be unique and sorted");
    prior = filter.name;
    if (typeof filter.name !== "string" || Buffer.byteLength(filter.name, "utf8") > 128 || filter.name !== filter.name.normalize("NFC")) searchFail("invalid_request", "filter name must be canonical IdText");
    for (const value of filter.values) if (typeof value !== "string" || value !== value.normalize("NFC") || Buffer.byteLength(value, "utf8") > 1_048_576) searchFail("limit_exceeded", "filter value is invalid or oversized");
    for (let i = 1; i < filter.values.length; i += 1) if (compareUtf8(filter.values[i - 1], filter.values[i]) >= 0) searchFail("invalid_request", "filter values must be unique and sorted");
  }
}

function matchesFilters(document, filters) {
  return filters.every((filter) => document.facets.some((facet) => facet.name === filter.name && filter.values.includes(facet.value)));
}

function explainDocument(state, analyzer, document, queryTerms) {
  const analyzed = state.analyzed.get(document.document_id), fields = [];
  for (const field of document.fields) {
    const stats = state.fieldStats.get(field.name), local = analyzed.get(field.name), terms = [];
    let fieldTotal = 0n;
    for (const { term, qtf } of queryTerms) {
      const tf = local.frequencies.get(term) ?? 0, df = stats.df.get(term) ?? 0;
      const scored = scoreTerm({ N: stats.N, df, total_length: stats.total_length, document_length: local.length, tf, weight_milli: fieldWeight(field.name) });
      if (scored) { fieldTotal += BigInt(scored.weighted); terms.push(Object.freeze({ kind: "scored", term, qtf, df, tf, ...scored })); }
      else terms.push(Object.freeze({ kind: "absent", term, qtf, df, tf: 0, idf_argument_scaled: null, idf_scaled: null, length_ratio_scaled: null, norm_scaled: null, denominator_scaled: null, tf_scaled: null, unweighted: "0", weighted: "0" }));
    }
    fields.push(Object.freeze({ field: field.name, N: stats.N, total_length: stats.total_length, average_length_scaled: stats.N ? String(BigInt(stats.total_length) * 1_000_000n / BigInt(stats.N)) : "0", document_length: local.length, weight_milli: fieldWeight(field.name), terms: Object.freeze(terms), field_total: fieldTotal.toString() }));
  }
  return finalizeExplanation({ scope_digest: state.scope_digest, logical_root: state.logical_root, document_id: document.document_id, fields });
}

export class LogicalLexicalIndex {
  #analyzer; #state; #cursorKey;
  constructor({ scope_digest, analyzer, documents = [], cursor_key = null }) {
    if (analyzer?.identity?.contract !== CONTRACTS.analyzer) searchFail("incompatible_contract", "logical index requires spipe-unicode-lex-v1");
    const map = new Map(documents.map((input) => { const doc = createScopedSearchDocument(input); if (doc.scope_digest !== scope_digest) searchFail("binding_mismatch", "document scope mismatch"); return [doc.document_id, doc]; }));
    if (map.size !== documents.length) searchFail("invalid_request", "duplicate document ID");
    this.#analyzer = analyzer; this.#state = buildState(scope_digest, map, analyzer);
    this.#cursorKey = cursor_key === null ? randomBytes(32) : Buffer.from(cursor_key);
    if (this.#cursorKey.length < 32) searchFail("invalid_request", "cursor key must contain at least 32 bytes");
  }
  get logical_root() { return this.#state.logical_root; }
  get document_count() { return this.#state.documents.size; }
  snapshot() { return Object.freeze({ logical_root: this.logical_root, scope_digest: this.#state.scope_digest, documents: Object.freeze(sortedDocuments(this.#state.documents)) }); }
  apply({ base_logical_root, operations }) {
    if (base_logical_root !== this.logical_root) searchFail("stale_base", "delta base is not current");
    if (!Array.isArray(operations) || operations.length > 1000) searchFail("limit_exceeded", "delta exceeds 1000 operations");
    const next = new Map(this.#state.documents), seen = new Set(); let added = 0, replaced = 0, deleted = 0;
    let previousKey = null;
    for (const operation of operations) {
      const required = operation.kind === "add" ? ["kind", "document_id", "before_revision", "before_hash", "after"] : operation.kind === "replace" ? ["kind", "document_id", "before_revision", "before_hash", "after"] : operation.kind === "delete" ? ["kind", "document_id", "before_revision", "before_hash", "after"] : null;
      if (!required || Object.keys(operation).join(",") !== required.join(",")) searchFail("invalid_request", "IndexOperationV1 must be closed and ordered");
      const sortKey = `${operation.document_id}\0${operation.kind}`;
      if (previousKey !== null && compareUtf8(previousKey, sortKey) >= 0) searchFail("invalid_request", "index operations must be canonically sorted"); previousKey = sortKey;
      if (seen.has(operation.document_id)) searchFail("invalid_request", "document IDs must be unique across delta"); seen.add(operation.document_id);
      const prior = this.#state.documents.get(operation.document_id);
      if (operation.kind === "add") { if (operation.before_revision !== null || operation.before_hash !== null || prior) searchFail("precondition_conflict", "add precondition failed"); const doc = createScopedSearchDocument(operation.after); if (doc.document_id !== operation.document_id || doc.scope_digest !== this.#state.scope_digest) searchFail("binding_mismatch", "added document binding mismatch"); next.set(doc.document_id, doc); added += 1; }
      else if (operation.kind === "replace") { if (!prior || prior.revision !== operation.before_revision || documentHash(prior) !== operation.before_hash) searchFail("precondition_conflict", "replace precondition failed"); const doc = createScopedSearchDocument(operation.after); if (doc.document_id !== operation.document_id || doc.scope_digest !== this.#state.scope_digest) searchFail("binding_mismatch", "replacement document binding mismatch"); next.set(doc.document_id, doc); replaced += 1; }
      else if (operation.kind === "delete") {
        const bothNull = operation.before_revision === null && operation.before_hash === null, bothSet = operation.before_revision !== null && operation.before_hash !== null;
        if (!bothNull && !bothSet) searchFail("invalid_request", "delete preconditions must be paired");
        if (operation.after !== null) searchFail("invalid_request", "delete after must be null");
        if (bothNull) { if (prior) searchFail("precondition_conflict", "delete expected absence"); }
        else { if (!prior || prior.revision !== operation.before_revision || documentHash(prior) !== operation.before_hash || operation.after !== null) searchFail("precondition_conflict", "delete precondition failed"); next.delete(operation.document_id); deleted += 1; }
      } else searchFail("invalid_request", "unknown index operation");
    }
    const candidate = buildState(this.#state.scope_digest, next, this.#analyzer);
    return Object.freeze({ status: added + replaced + deleted === 0 ? "no_op" : "applied", candidate: Object.freeze(candidate), added, replaced, deleted });
  }
  publish(candidate, expected_base_logical_root) { if (this.logical_root !== expected_base_logical_root) return "stale_base"; this.#state = candidate; return "published"; }
  #encodeCursor(binding) {
    const payload = canonicalBytes(binding), mac = createHmac("sha256", this.#cursorKey).update(payload).digest();
    return Buffer.concat([payload, Buffer.from("."), mac]).toString("base64url");
  }
  #decodeCursor(cursor, expected) {
    if (typeof cursor !== "string" || Buffer.byteLength(cursor, "utf8") > 8192) searchFail("stale_cursor", "cursor is invalid or oversized");
    let bytes; try { bytes = Buffer.from(cursor, "base64url"); } catch { searchFail("stale_cursor", "cursor encoding is invalid"); }
    const split = bytes.length - 33;
    if (split <= 0 || bytes[split] !== 46) searchFail("stale_cursor", "cursor framing is invalid");
    const payload = bytes.subarray(0, split), actual = bytes.subarray(split + 1), wanted = createHmac("sha256", this.#cursorKey).update(payload).digest();
    if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) searchFail("stale_cursor", "cursor authentication failed");
    let decoded; try { decoded = JSON.parse(payload.toString("utf8")); } catch { searchFail("stale_cursor", "cursor payload is invalid"); }
    if (hashCanonical({ ...decoded, next_rank: 0 }) !== hashCanonical({ ...expected, next_rank: 0 })) searchFail("stale_cursor", "cursor binding mismatch");
    if (!Number.isSafeInteger(decoded.next_rank) || decoded.next_rank < 1) searchFail("stale_cursor", "cursor rank is invalid");
    return decoded.next_rank - 1;
  }
  query({ query_text, filters = [], limit = 20, cursor = null, explain = false }) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) searchFail("limit_exceeded", "limit must be 1..1000"); validateFilters(filters);
    const terms = this.#analyzer.query(query_text);
    if (terms.length === 0 && filters.length === 0) return Object.freeze({ logical_root: this.logical_root, hits: Object.freeze([]), next_cursor: null, exhausted: true });
    const hits = [];
    for (const document of this.#state.documents.values()) {
      if (!matchesFilters(document, filters)) continue;
      const explanation = explainDocument(this.#state, this.#analyzer, document, terms);
      if (terms.length && explanation.public_score_milli === 0) continue;
      hits.push({ document_id: document.document_id, score_milli: explanation.public_score_milli, matched_fields: explanation.fields.filter((field) => field.terms.some((term) => term.kind === "scored")).map((field) => field.field), explanation: explain ? explanation : null });
    }
    const binding = { contract: "spipe-search-cursor-v1", logical_root: this.logical_root, scope_digest: this.#state.scope_digest, query_hash: hashCanonical({ query_text, filters, limit, explain }), next_rank: 0 };
    const offset = cursor === null ? 0 : this.#decodeCursor(cursor, binding);
    const all = sortHits(hits), ordered = all.slice(offset, offset + limit).map((hit, index) => Object.freeze({ ...hit, source_rank: offset + index + 1 }));
    for (const hit of ordered) if (hit.explanation && canonicalBytes(hit.explanation).length > 65_536) searchFail("limit_exceeded", "explanation exceeds max_explanation_bytes_per_hit");
    while (ordered.length && canonicalBytes({ logical_root: this.logical_root, hits: ordered, next_cursor: null, exhausted: false }).length > 524_288) ordered.pop();
    if (!ordered.length && all.length > offset) searchFail("limit_exceeded", "one hit exceeds max_page_bytes");
    const exhausted = offset + ordered.length >= all.length;
    const next_cursor = exhausted ? null : this.#encodeCursor({ ...binding, next_rank: offset + ordered.length + 1 });
    return Object.freeze({ logical_root: this.logical_root, hits: Object.freeze(ordered), next_cursor, exhausted });
  }
  explain({ document_id, query_text, filters = [] }) { validateFilters(filters); const document = this.#state.documents.get(document_id); if (!document || !matchesFilters(document, filters)) searchFail("snapshot_not_found", "document is not present in the scoped snapshot"); return explainDocument(this.#state, this.#analyzer, document, this.#analyzer.query(query_text)); }
  stats() { return Object.freeze({ logical_root: this.logical_root, document_count: this.document_count, field_stats: Object.freeze([...this.#state.fieldStats].filter(([name]) => [...this.#state.documents.values()].some((doc) => doc.fields.some((field) => field.name === name))).map(([field, stats]) => Object.freeze({ field, N: stats.N, total_length: stats.total_length, average_length_scaled: stats.N ? Number(BigInt(stats.total_length) * 1_000_000n / BigInt(stats.N)) : 0 }))) }); }
}
