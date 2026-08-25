import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { CONTRACTS, createUnicode17Analyzer, deriveScopedSearchDocument } from "../../src/index/index.js";
import { canonicalBytes } from "../../src/model/identity.js";
import { InProcessSearchProviderAdapter, JsFixedPointSearchProvider } from "../../src/provider/index.js";
import { ALPHABETIC_RANGES, DECIMAL_NUMBER_RANGES, MARK_RANGES, CASED_RANGES, CASE_IGNORABLE_RANGES, CANONICAL_COMBINING_CLASS, CANONICAL_DECOMPOSITIONS, CANONICAL_COMPOSITIONS, DEFAULT_LOWERCASE, HANGUL_NFC } from "../../src/search/generated/unicode_17_0_0.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = join(here, "..", "fixture", "wave4_search");
const repositoryRoot = resolve(here, "../../../../..");
const HASH0 = `sha256:${"0".repeat(64)}`;
const HASH1 = `sha256:${"1".repeat(64)}`;

function bytes(name) { return readFileSync(join(fixtureRoot, name)); }
function fixture(name) { return JSON.parse(bytes(name).toString("utf8")); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function objectHash(value) { return `sha256:${sha256(canonicalBytes(value))}`; }
function u64be(value) { const result = Buffer.alloc(8); result.writeBigUInt64BE(BigInt(value)); return result; }
function domainHash(vector) { const payload = Buffer.from(vector.canonical_payload, "utf8"); return sha256(Buffer.concat([Buffer.from(vector.domain, "utf8"), u64be(payload.length), payload])); }

function rangeContains(ranges, cp) { let lo = 0, hi = ranges.length - 1; while (lo <= hi) { const mid = (lo + hi) >>> 1, range = ranges[mid]; if (cp < range[0]) hi = mid - 1; else if (cp > range[1]) lo = mid + 1; else return true; } return false; }
const cccMap = new Map(CANONICAL_COMBINING_CLASS);
const decompositionMap = new Map(CANONICAL_DECOMPOSITIONS);
const compositionMap = new Map(CANONICAL_COMPOSITIONS.map(([a, b, c]) => [`${a}:${b}`, c]));
const lowercaseMap = new Map(DEFAULT_LOWERCASE.map(([cp, mapping, conditional_mapping, condition]) => [cp, { mapping, conditional_mapping, condition }]));
const cpText = (values) => String.fromCodePoint(...values);
const ccc = (cp) => cccMap.get(cp) ?? 0;
function decomposeOne(cp, output) { const h = HANGUL_NFC, sIndex = cp - h.s_base, nCount = h.v_count * h.t_count, sCount = h.l_count * nCount; if (sIndex >= 0 && sIndex < sCount) { output.push(h.l_base + Math.floor(sIndex / nCount), h.v_base + Math.floor((sIndex % nCount) / h.t_count)); if (sIndex % h.t_count) output.push(h.t_base + (sIndex % h.t_count)); return; } const mapping = decompositionMap.get(cp); if (mapping) for (const part of mapping) decomposeOne(part, output); else output.push(cp); }
function composePair(a, b) { const h = HANGUL_NFC, nCount = h.v_count * h.t_count, lIndex = a - h.l_base, vIndex = b - h.v_base; if (lIndex >= 0 && lIndex < h.l_count && vIndex >= 0 && vIndex < h.v_count) return h.s_base + (lIndex * h.v_count + vIndex) * h.t_count; const sIndex = a - h.s_base, tIndex = b - h.t_base; if (sIndex >= 0 && sIndex < h.l_count * nCount && sIndex % h.t_count === 0 && tIndex > 0 && tIndex < h.t_count) return a + tIndex; return compositionMap.get(`${a}:${b}`); }
function nfc(text) { const values = []; for (const cp of [...text].map((value) => value.codePointAt(0))) decomposeOne(cp, values); for (let i = 1; i < values.length; i++) { const cls = ccc(values[i]); if (!cls) continue; let j = i; while (j > 0 && ccc(values[j - 1]) > cls) { [values[j - 1], values[j]] = [values[j], values[j - 1]]; j--; } } if (!values.length) return ""; const output = [values[0]]; let starterIndex = 0, starter = output[0], lastClass = 0; for (let i = 1; i < values.length; i++) { const cp = values[i], cls = ccc(cp), composite = composePair(starter, cp); if (composite !== undefined && (lastClass < cls || lastClass === 0)) output[starterIndex] = starter = composite; else { if (cls === 0) { starterIndex = output.length; starter = cp; } output.push(cp); lastClass = cls; } } return cpText(output); }
function finalSigma(values, index) { let before = false; for (let i = index - 1; i >= 0; i--) { if (rangeContains(CASE_IGNORABLE_RANGES, values[i])) continue; before = rangeContains(CASED_RANGES, values[i]); break; } if (!before) return false; for (let i = index + 1; i < values.length; i++) { if (rangeContains(CASE_IGNORABLE_RANGES, values[i])) continue; return !rangeContains(CASED_RANGES, values[i]); } return true; }
function defaultLower(text) { const values = [...nfc(text)].map((value) => value.codePointAt(0)), output = []; for (let i = 0; i < values.length; i++) { const entry = lowercaseMap.get(values[i]); if (!entry) output.push(values[i]); else if (entry.condition === "Final_Sigma" && finalSigma(values, i)) output.push(...entry.conditional_mapping); else output.push(...entry.mapping); } return nfc(cpText(output)); }
const tables = Object.freeze({ version: "17.0.0", normalizeNfc: nfc, defaultLowercase: defaultLower, isAlphabetic: (cp) => rangeContains(ALPHABETIC_RANGES, cp), isDecimalNumber: (cp) => rangeContains(DECIMAL_NUMBER_RANGES, cp), isMark: (cp) => rangeContains(MARK_RANGES, cp) });

function createJsProviderFixture() {
  const corpus = fixture("golden_corpus.json");
  const analyzer = createUnicode17Analyzer(tables, { stop_words: ["and", "the"] });
  const documents = corpus.documents.filter(({ visibility }) => visibility === "public").map((record) =>
    deriveScopedSearchDocument({
      document_id: record.id,
      revision: record.revision,
      fields: corpus.field_order.map((name) => ({ name, value: record.fields[name].normalize("NFC") })),
      facets: [{ name: "visibility", value: record.visibility }],
      visibility_digest: HASH1,
      scope_digest: HASH0,
    })
  );
  const provider = new JsFixedPointSearchProvider({ analyzer });
  const adapter = new InProcessSearchProviderAdapter(provider);
  adapter.initialize({ request_id: "fixture-init", operation: "initialize", protocol: { major: 1, minor: 0 }, client: "spipe", required: { provider: CONTRACTS.provider, analyzer: CONTRACTS.analyzer, score: CONTRACTS.score, explanation: CONTRACTS.explanation, logical_index: CONTRACTS.logical_index }, limits: { max_frame_bytes: 1_048_576 } });
  const opened = adapter.open({ scope_digest: HASH0, documents });
  return { adapter, analyzer, documents, opened, provider };
}

function assertGoldenQueries(context) {
  const expected = fixture("golden_results.json");
  assert.equal(context.opened.logical_root, expected.logical_root);
  const stats = context.adapter.stats({ logical_root: context.opened.logical_root });
  assert.equal(stats.document_count, expected.stats.document_count);
  assert.deepEqual(stats.field_stats, expected.stats.field_stats);
  for (const query of expected.queries) {
    const page = context.adapter.search({ query_text: query.query_text, filters: query.filters, limit: 10, cursor: null, explain: true });
    assert.equal(objectHash(page), query.page_hash, query.id);
    assert.deepEqual(page.hits.map((hit) => ({ document_id: hit.document_id, score_milli: hit.score_milli, matched_fields: hit.matched_fields, source_rank: hit.source_rank, explanation_hash: objectHash(hit.explanation) })), query.hits, query.id);
    for (const hit of page.hits) assert.equal(hit.explanation.public_score_milli, hit.score_milli);
  }
}

function assertDeltaParity(context) {
  const [alpha, empty, accented] = context.documents;
  const noOp = context.adapter.apply({ base_logical_root: context.opened.logical_root, operations: [{ kind: "delete", document_id: "A-absent", before_revision: null, before_hash: null, after: null }] });
  assert.equal(noOp.status, "no_op");
  assert.equal(noOp.candidate.logical_root, context.opened.logical_root);
  const replacement = deriveScopedSearchDocument({ ...alpha, revision: "r2", fields: alpha.fields.map((field) => field.name === "body" ? { name: "body", value: "alpha replacement" } : field) });
  const added = deriveScopedSearchDocument({ ...empty, document_id: "A-added", revision: "r1" });
  const operations = [
    { kind: "add", document_id: added.document_id, before_revision: null, before_hash: null, after: added },
    { kind: "replace", document_id: alpha.document_id, before_revision: alpha.revision, before_hash: alpha.scoped_content_hash, after: replacement },
    { kind: "delete", document_id: accented.document_id, before_revision: accented.revision, before_hash: accented.scoped_content_hash, after: null },
  ];
  const delta = context.adapter.apply({ base_logical_root: context.opened.logical_root, operations });
  assert.deepEqual([delta.added, delta.replaced, delta.deleted], [1, 1, 1]);
  assert.equal(context.adapter.publish({ candidate: delta.candidate, expected_base_logical_root: context.opened.logical_root }), "published");
  const clean = createJsProviderFixture();
  const cleanDelta = clean.adapter.apply({ base_logical_root: clean.opened.logical_root, operations });
  assert.equal(context.provider.health().logical_root, cleanDelta.candidate.logical_root);
}

const jsChecks = new Map([
  ["W4-SRCH-01", (c) => { assert.deepEqual(c.analyzer.analyze("Alpha the BETA").tokens, [{ term: "alpha", position: 1 }, { term: "beta", position: 3 }]); assert.deepEqual(c.analyzer.analyze("é").tokens, c.analyzer.analyze("é").tokens); }],
  ["W4-SRCH-02", assertGoldenQueries],
  ["W4-SRCH-03", assertGoldenQueries],
  ["W4-SRCH-04", (c) => assert.equal(c.opened.logical_root, fixture("golden_results.json").logical_root)],
  ["W4-SRCH-05", assertDeltaParity],
  ["W4-SRCH-11", (c) => { assert.equal(c.documents.some(({ document_id }) => document_id === "A-private"), false); assertGoldenQueries(c); }],
  ["W4-SRCH-15", assertGoldenQueries],
  ["W4-SRCH-16", (c) => { for (const document of c.documents) assert.deepEqual(document.fields.map(({ name }) => name), ["identifier", "title", "heading", "classification", "body"]); }],
  ["W4-SRCH-21", (c) => { for (const document of c.documents) assert.equal(document.scoped_content_hash, objectHash({ document_id: document.document_id, revision: document.revision, fields: document.fields, facets: document.facets, visibility_digest: document.visibility_digest, scope_digest: document.scope_digest })); }],
  ["W4-SRCH-22", (c) => { const page = c.adapter.search({ query_text: "alpha missing-term", filters: [], limit: 10, cursor: null, explain: true }); assert.ok(page.hits.every((hit) => hit.explanation.fields.some((field) => field.terms.some((term) => term.kind === "absent")))); assert.ok(page.hits.every((hit) => hit.explanation.fields.some((field) => field.terms.some((term) => term.kind === "scored")))); }],
]);

function runProviderConformance() {
  const applicability = fixture("conformance_applicability.json").implementations;
  const results = [];
  for (let number = 1; number <= 27; number += 1) {
    const matrix_id = `W4-SRCH-${String(number).padStart(2, "0")}`;
    const check = jsChecks.get(matrix_id);
    if (check) {
      try { check(createJsProviderFixture()); results.push({ matrix_id, implementation: "javascript", applicability: "required", status: "pass", evidence_path: "test/integration/knowledge_wave4_search_test.js", reason: "executed against locked fixture" }); }
      catch (error) { results.push({ matrix_id, implementation: "javascript", applicability: "required", status: "fail", evidence_path: null, reason: error.message }); }
    } else results.push({ matrix_id, implementation: "javascript", applicability: "required", status: "fail", evidence_path: null, reason: "matrix has no complete executable JavaScript oracle yet" });
    for (const implementation of ["simple", "dbfs"]) {
      const required = applicability[implementation].required.includes(number);
      results.push({
        matrix_id,
        implementation,
        applicability: required ? "required" : "not_applicable",
        status: required ? "fail" : "not_evidence",
        evidence_path: null,
        reason: required ? `required ${implementation} conformance oracle is not closed` : applicability[implementation].reason,
      });
    }
  }
  return results;
}

const CONFORMANCE_PREFIX = "SPIPE_WAVE4_CONFORMANCE=";

function enforceSchema(value, schema, path = "evidence") {
  if (schema.type === "object") {
    assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), `${path} must be an object`);
    if (schema.additionalProperties === false) assert.deepEqual(Object.keys(value).sort(), Object.keys(schema.properties).sort(), `${path} is closed`);
    for (const key of schema.required || []) assert.ok(Object.hasOwn(value, key), `${path}.${key} is required`);
    for (const [key, child] of Object.entries(schema.properties || {})) if (Object.hasOwn(value, key)) enforceSchema(value[key], child, `${path}.${key}`);
  } else if (schema.type === "array") {
    assert.ok(Array.isArray(value), `${path} must be an array`);
    for (let index = 0; index < value.length; index += 1) enforceSchema(value[index], schema.items, `${path}[${index}]`);
  } else if (schema.type) assert.equal(typeof value, schema.type, `${path} type`);
  if (Object.hasOwn(schema, "const")) assert.deepEqual(value, schema.const, `${path} constant`);
  if (schema.enum) assert.ok(schema.enum.includes(value), `${path} enum`);
  if (schema.pattern) assert.match(value, new RegExp(schema.pattern), `${path} pattern`);
}

function parseConformanceEvidence(stdout, implementation) {
  const lines = stdout.split(/\r?\n/).filter((line) => line.startsWith(CONFORMANCE_PREFIX));
  if (lines.length !== 1) throw new Error(`expected exactly one ${CONFORMANCE_PREFIX} record`);
  let evidence;
  try { evidence = JSON.parse(lines[0].slice(CONFORMANCE_PREFIX.length)); }
  catch { throw new Error("conformance record is not valid JSON"); }
  const schema = fixture("conformance_evidence_schema.json");
  assert.equal(schema.schema, "spipe-wave4-provider-conformance-schema-v2");
  assert.equal(schema.line_prefix, CONFORMANCE_PREFIX);
  enforceSchema(evidence, { type: "object", additionalProperties: schema.additionalProperties, required: schema.required, properties: schema.properties });
  assert.equal(evidence.implementation, implementation);
  const golden = fixture("golden_results.json");
  assert.equal(evidence.logical_root, golden.logical_root);
  assert.deepEqual(evidence.stats, golden.stats);
  assert.deepEqual(evidence.queries, golden.queries);
  assert.equal(evidence.delta.no_op_logical_root, schema.delta_oracle.base_logical_root);
  assert.equal(evidence.delta.clean_logical_root, evidence.delta.candidate_logical_root);
  assert.equal(evidence.delta.candidate_logical_root, schema.delta_oracle.candidate_logical_root, "candidate root must equal locked delta oracle");
  const applicability = fixture("conformance_applicability.json").implementations[implementation];
  const expectedCells = applicability.required.map((number) => `W4-SRCH-${String(number).padStart(2, "0")}`);
  assert.deepEqual(evidence.cells.map(({ matrix_id }) => matrix_id), expectedCells);
  assert.equal(new Set(evidence.cells.map(({ matrix_id }) => matrix_id)).size, expectedCells.length, "one executed evidence object per required cell");
  for (const cell of evidence.cells) assert.equal(cell.oracle, `wave4_search_${cell.matrix_id.slice(-2)}`, `${cell.matrix_id} executed oracle binding`);
  return evidence;
}

function probeCallableSimpleLane(kind) {
  const enabled = process.env.SPIPE_RUN_SIMPLE_CONFORMANCE === "1";
  const target = kind === "simple"
    ? "examples/05_stdlib/spipe/test/support/simple_provider_wave4_parity_probe.spl"
    : "examples/05_stdlib/spipe/test/support/dbfs_wave4_parity_probe.spl";
  if (!enabled) return { implementation: kind, invoked: false, status: "fail", reason: "callable pure-Simple conformance probe not enabled; source presence is not evidence" };
  const binary = process.env.SPIPE_SIMPLE_BIN;
  const provenance = process.env.SPIPE_STAGE4_PROVENANCE;
  if (!binary || !isAbsolute(binary) || !provenance || !isAbsolute(provenance)) return { implementation: kind, invoked: true, admitted: false, focused_status: "not_run", status: "fail", evidence_path: target, reason: "SPIPE_SIMPLE_BIN and SPIPE_STAGE4_PROVENANCE must be absolute paths" };
  try {
    if (lstatSync(binary).isSymbolicLink() || lstatSync(provenance).isSymbolicLink() || realpathSync(binary) !== binary || realpathSync(provenance) !== provenance) throw new Error("non-canonical or symlinked admission path");
  } catch (error) { return { implementation: kind, invoked: true, admitted: false, focused_status: "not_run", status: "fail", evidence_path: target, reason: `invalid admission path: ${error.message}` }; }
  const binarySha256 = sha256(readFileSync(binary));
  const helper = join(repositoryRoot, "scripts", "check", "lib", "stage4-candidate-provenance.shs");
  const admission = spawnSync("sh", ["-c", '. "$1"; stage4_verify_candidate_provenance "$2" "$3" "$4"', "wave4-admission", helper, provenance, binary, repositoryRoot], { cwd: repositoryRoot, encoding: "utf8", timeout: 15_000, maxBuffer: 65_536 });
  if (admission.status !== 0) return { implementation: kind, invoked: true, admitted: false, focused_status: "not_run", status: "fail", evidence_path: target, reason: "binary failed canonical Stage4 provenance admission" };
  const identity = spawnSync(binary, ["--version"], { cwd: repositoryRoot, encoding: "utf8", timeout: 15_000, maxBuffer: 65_536 });
  const identityText = `${identity.stdout || ""}\n${identity.stderr || ""}`;
  if (identity.status !== 0 || /bootstrap seed only|Rust-built Simple binary/i.test(identityText)) {
    return { implementation: kind, invoked: true, admitted: false, focused_status: "not_run", status: "fail", evidence_path: target, reason: "configured executable is not an admitted pure-Simple self-hosted binary" };
  }
  const run = spawnSync(binary, ["run", target], { cwd: repositoryRoot, env: { ...process.env, SIMPLE_LIB: join(repositoryRoot, "src") }, encoding: "utf8", timeout: 120_000, maxBuffer: 1_048_576 });
  if (run.status !== 0) return { implementation: kind, invoked: true, focused_status: "fail", status: "fail", reason: `focused pure-Simple fixture exited ${run.status ?? "without status"}` };
  try {
    const evidence = parseConformanceEvidence(run.stdout, kind);
    return { implementation: kind, invoked: true, admitted: true, binary_path: binary, binary_sha256: binarySha256, stage4_provenance_path: provenance, stage4_provenance_sha256: sha256(readFileSync(provenance)), focused_status: "pass", status: "pass", evidence_path: target, evidence };
  } catch (error) {
    return { implementation: kind, invoked: true, focused_status: "pass", status: "fail", evidence_path: target, reason: `focused fixture is not canonical parity evidence: ${error.message}` };
  }
}

test("Wave 4 golden corpus and result manifests are immutable", () => { const manifest = fixture("fixture_manifest.json"); for (const [name, expected] of Object.entries(manifest.files)) assert.equal(`sha256:${sha256(bytes(name))}`, expected, name); });

test("published Wave 4 wire vectors have exact bytes, framing, and identities", () => { const vectors = fixture("provider_protocol_vectors.json"); for (const vector of vectors.wire_vectors) { const payload = Buffer.from(vector.canonical_payload); assert.equal(payload.length, vector.payload_bytes); assert.equal(payload.length.toString(16).padStart(8, "0"), vector.frame_header); assert.equal(sha256(payload), vector.sha256); } for (const vector of vectors.identity_vectors) { assert.equal(Buffer.byteLength(vector.canonical_payload), vector.payload_bytes); assert.equal(domainHash(vector), vector.expected_hash); } });

test("actual JavaScript provider matches locked roots, scores, ordering, and explanations", () => assertGoldenQueries(createJsProviderFixture()));

test("actual JavaScript provider mixed delta equals clean incremental state", () => assertDeltaParity(createJsProviderFixture()));

test("generated Unicode 17 tables produce exact locked analyzer outputs", () => { const analyzer = createUnicode17Analyzer(tables, { stop_words: ["and", "the"] }); for (const vector of fixture("unicode_golden_outputs.json").vectors) assert.deepEqual(analyzer.analyze(vector.input), { normalized: vector.normalized, tokens: vector.tokens }, vector.id); });

test("conformance executes real JavaScript cells and maps provider applicability without false PASS", () => { const evidence = runProviderConformance(); assert.equal(evidence.length, 81); assert.ok(evidence.filter((item) => item.implementation === "javascript" && item.status === "pass").length >= 10); assert.equal(evidence.filter((item) => item.implementation !== "javascript" && item.status === "pass").length, 0); assert.ok(evidence.filter((item) => item.implementation === "simple").every((item) => item.applicability === "required" && item.status === "fail")); assert.equal(evidence.filter((item) => item.implementation === "dbfs" && item.applicability === "required").length, 13); assert.ok(evidence.filter((item) => item.implementation === "dbfs" && item.applicability === "not_applicable").every((item) => item.status === "not_evidence")); });

test("conformance evidence schema rejects unknown fields and ID-only cells", () => {
  const schema = fixture("conformance_evidence_schema.json");
  assert.throws(() => enforceSchema({ unexpected: true }, { type: "object", additionalProperties: schema.additionalProperties, required: schema.required, properties: schema.properties }), /is closed/);
  assert.throws(() => enforceSchema(["W4-SRCH-01"], schema.properties.cells), /must be an object/);
});

test("Unicode provenance hashes pinned sources, generator, and both generated tables", () => { const manifest = fixture("unicode_17_0_0_manifest.json"); assert.equal(manifest.unicode_version, "17.0.0"); assert.equal(sha256(readFileSync(resolve(repositoryRoot, manifest.generator.file))), manifest.generator.sha256); for (const source of manifest.sources) assert.equal(sha256(readFileSync(resolve(repositoryRoot, "examples/05_stdlib/spipe/tools/unicode/ucd/17.0.0", source.name))), source.sha256, source.name); for (const generated of manifest.generated) assert.equal(sha256(readFileSync(resolve(repositoryRoot, generated.file))), generated.sha256, generated.file); });

test("Simple and DBFS probes require canonical emitted values, never source existence or verdict alone", () => {
  const failures = [];
  for (const kind of ["simple", "dbfs"]) {
    const result = probeCallableSimpleLane(kind);
    assert.equal(result.invoked, process.env.SPIPE_RUN_SIMPLE_CONFORMANCE === "1");
    if (!result.invoked) { assert.equal(result.status, "fail"); assert.ok(result.reason.length > 0); continue; }
    assert.ok(result.evidence_path.endsWith(".spl"));
    if (result.admitted === false) { assert.equal(result.status, "fail"); assert.equal(result.focused_status, "not_run"); failures.push(`${kind}: ${result.reason}`); continue; }
    assert.equal(result.focused_status, "pass");
    assert.equal(result.binary_path, process.env.SPIPE_SIMPLE_BIN);
    assert.match(result.binary_sha256, /^[0-9a-f]{64}$/);
    assert.equal(result.stage4_provenance_path, process.env.SPIPE_STAGE4_PROVENANCE);
    assert.match(result.stage4_provenance_sha256, /^[0-9a-f]{64}$/);
    if (result.status !== "pass") failures.push(`${kind}: ${result.reason}`);
  }
  if (process.env.SPIPE_RUN_SIMPLE_CONFORMANCE === "1") assert.deepEqual(failures, []);
});
