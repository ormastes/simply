import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import test from "node:test";

import { createAuthorizationPort, signEdgeAcceptanceReceipt } from "../../src/core/authorization.js";
import { parseMarkdownArtifact, parseSspecMetadata, parseSourceMetadata } from "../../src/parser/index.js";
import { extractMarkdownTrace, extractSspecTrace, extractSourceTrace, extractTraceRecords } from "../../src/extract/index.js";
import { buildTraceMatrix, diagnoseTrace, projectMirroredSpecDiagnostics } from "../../src/diagnostics/index.js";
import { canonicalJson } from "../../src/storage/canonical.js";

const P = "P-000000000000000000000000000000AA";
const WT = "WT-00000000000000000000000000000001";
const SNAP = "V-00000000000000000000000000000001";
const A_REQ = "A-00000000000000000000000000000001";
const A_SPEC = "A-00000000000000000000000000000002";
const A_SOURCE = "A-00000000000000000000000000000003";
const SECTION = "S-00000000000000000000000000000001";
const REQUIREMENT = "RQ-00000000000000000000000000000001";
const SCENARIO = "SS-00000000000000000000000000000001";
const TEST = "T-00000000000000000000000000000001";
const SYMBOL = "SY-00000000000000000000000000000001";
const EDGE = "E-00000000000000000000000000000001";
const POLICY_HASH = `sha256:${"a".repeat(64)}`;
const INPUT_SNAPSHOT = `spks1-${"b".repeat(64)}`;

const requirementSource = `<!-- spipe:artifact uid=${A_REQ} key=requirements.graph revision=r1 kind=requirements -->
# Requirements

## REQ-SPKC-003 — Typed graph snapshots
<!-- spipe:section uid=${SECTION} key=req-spkc-003 -->
<!-- spipe:requirement uid=${REQUIREMENT} key=req-spkc-003 display_id=REQ-SPKC-003 status=accepted aliases=none -->

See [itself](#req-spkc-003) and [missing](../design/missing.md#gone).
`;

const specSource = `# spipe:artifact uid=${A_SPEC} key=spec.graph revision=r1
# spipe:scenario uid=${SCENARIO} key=graph.snapshot status=accepted requires=${REQUIREMENT}
# spipe:test uid=${TEST} kind=unit status=accepted scenario=${SCENARIO} verifies=${REQUIREMENT}
it "publishes one graph snapshot":
  expect(true).to_be(true)
`;

const sourceText = `# spipe:symbol uid=${SYMBOL} status=accepted implements=${REQUIREMENT}
fn publish_snapshot():
    1
`;

const context = { projectUid: P, revisionId: "r1", worktreeUid: WT, snapshotUid: SNAP, principal: "principal:test" };

test("extractors produce canonical owner-bound records and explicit provenance deterministically", () => {
  const markdown = parseMarkdownArtifact(requirementSource, { path: "doc/02_requirements/graph.md", projectUid: P, revision: "r1" });
  const spec = parseSspecMetadata(specSource, { path: "test/03_system/graph_spec.spl", projectUid: P, revision: "r1" });
  const extractedMarkdown = extractMarkdownTrace(markdown, requirementSource, context);
  const extractedSpec = extractSspecTrace(spec, specSource, context);
  assert.equal(extractedMarkdown.requirements[0].uid, REQUIREMENT);
  assert.equal(extractedMarkdown.requirements[0].section_uid, SECTION);
  assert.equal(extractedMarkdown.edge_candidates[0].origin, "explicit");
  assert.equal(extractedMarkdown.edge_candidates[0].provenance.input_snapshot_uid, SNAP);
  assert.equal(extractedSpec.scenarios[0].uid, SCENARIO);
  assert.deepEqual(extractedSpec.scenarios[0].requirement_uids, [REQUIREMENT]);
  assert.equal(extractedSpec.tests[0].scenario_uid, SCENARIO);
  assert.equal(extractedSpec.edge_candidates.length, 2);
  assert.deepEqual(extractSspecTrace(spec, specSource, context), extractedSpec);

  const aggregate = extractTraceRecords({
    markdown: [{ parsed: markdown, input: requirementSource }],
    sspec: [{ parsed: spec, input: specSource }],
  }, context);
  assert.equal(aggregate.requirements.length, 1);
  assert.equal(aggregate.tests.length, 1);
  assert.throws(() => { aggregate.requirements.push({}); }, TypeError);
});

test("invalid adjacency and owner mismatches fail closed", () => {
  const malformed = specSource.replace(`# spipe:test uid=${TEST}`, `\n# spipe:test uid=${TEST}`);
  const parsed = parseSspecMetadata(malformed, { path: "test/03_system/graph_spec.spl", projectUid: P, revision: "r1" });
  const result = extractSspecTrace(parsed, malformed, context);
  assert.equal(result.scenarios.length, 0);
  assert.ok(result.diagnostics.some((entry) => entry.code === "SPK003"));

  const markdown = parseMarkdownArtifact(requirementSource, { path: "doc/02_requirements/graph.md", projectUid: P, revision: "r1" });
  const mismatch = extractMarkdownTrace(markdown, requirementSource, { ...context, revisionId: "r2" });
  assert.equal(mismatch.requirements.length, 0);
  assert.equal(mismatch.diagnostics[0].code, "SPK004");
});

test("Markdown and SSpec marker blocks reject unknown fields, duplicates, and reversed order atomically", () => {
  const markdownCases = [
    requirementSource.replace("status=accepted aliases=none", "status=accepted aliases=none extra=no"),
    requirementSource.replace("aliases=none -->", `aliases=none -->\n<!-- spipe:requirement uid=${REQUIREMENT} key=req-spkc-003 display_id=REQ-SPKC-003 status=accepted aliases=none -->`),
    requirementSource.replace(`<!-- spipe:section uid=${SECTION} key=req-spkc-003 -->\n<!-- spipe:requirement`, `<!-- spipe:requirement uid=${REQUIREMENT} key=req-spkc-003 display_id=REQ-SPKC-003 status=accepted aliases=none -->\n<!-- spipe:section uid=${SECTION} key=req-spkc-003 -->\n<!-- spipe:requirement`),
  ];
  for (const source of markdownCases) {
    const parsed = parseMarkdownArtifact(source, { path: "doc/02_requirements/graph.md", projectUid: P, revision: "r1" });
    const result = extractMarkdownTrace(parsed, source, context);
    assert.equal(result.requirements.length, 0);
    assert.ok(result.diagnostics.some((entry) => entry.code === "SPK003"));
  }

  const scenarioLine = `# spipe:scenario uid=${SCENARIO} key=graph.snapshot status=accepted requires=${REQUIREMENT}`;
  const testLine = `# spipe:test uid=${TEST} kind=unit status=accepted scenario=${SCENARIO} verifies=${REQUIREMENT}`;
  const sspecCases = [
    specSource.replace(scenarioLine, `${scenarioLine} extra=no`),
    specSource.replace(scenarioLine, `${scenarioLine}\n${scenarioLine}`),
    specSource.replace(testLine, `${testLine}\n${testLine}`),
    specSource.replace(`${scenarioLine}\n${testLine}`, `${testLine}\n${scenarioLine}`),
  ];
  for (const source of sspecCases) {
    const parsed = parseSspecMetadata(source, { path: "test/03_system/graph_spec.spl", projectUid: P, revision: "r1" });
    const result = extractSspecTrace(parsed, source, context);
    assert.equal(result.scenarios.length, 0);
    assert.equal(result.tests.length, 0);
    assert.ok(result.diagnostics.some((entry) => entry.code === "SPK003"));
  }
});

test("source extraction requires a provider with the normalized-byte coordinate contract", () => {
  const parsed = parseSourceMetadata(sourceText, { path: "src/graph.spl", projectUid: P });
  const artifact = { uid: A_SOURCE, project_uid: P, revision: "r1", canonical_path: "src/graph.spl", content_hash: parsed.content_hash };
  const absent = extractSourceTrace(parsed, sourceText, { ...context, artifact });
  assert.equal(absent.symbols.length, 0);
  assert.equal(absent.diagnostics[0].code, "SPK406");
  const bytes = Buffer.from(sourceText, "utf8");
  const declarationStart = Buffer.byteLength(sourceText.slice(0, sourceText.indexOf("fn publish_snapshot")), "utf8");
  const result = extractSourceTrace(parsed, sourceText, {
    ...context, artifact,
    symbolProvider: (request) => ({
      coordinate_system: request.coordinate_system, source_hash: request.source_hash,
      symbols: [{ uid: SYMBOL, symbol_kind: "function", name: "publish_snapshot", qualified_name: "graph.publish_snapshot",
        signature_hash: null, source_span: { start_byte: declarationStart, end_byte: bytes.length }, annotation_uids: [REQUIREMENT], status: "accepted" }],
    }),
  });
  assert.equal(result.symbols[0].source_location.source_hash, parsed.content_hash);
  assert.equal(result.edge_candidates[0].edge_type, "implements");
});

test("source marker schema, provider token binding, owner equality, and UTF-8 boundaries fail closed", () => {
  const unknown = sourceText.replace(`implements=${REQUIREMENT}`, `implements=${REQUIREMENT} extra=no`);
  const parsedUnknown = parseSourceMetadata(unknown, { path: "src/graph.spl", projectUid: P });
  const artifactUnknown = { uid: A_SOURCE, project_uid: P, revision: "r1", canonical_path: "src/graph.spl", content_hash: parsedUnknown.content_hash };
  const unknownResult = extractSourceTrace(parsedUnknown, unknown, { ...context, artifact: artifactUnknown, symbolProvider: () => ({
    coordinate_system: "spipe-normalized-utf8-bytes-v1", source_hash: artifactUnknown.content_hash, symbols: [],
  }) });
  assert.equal(unknownResult.diagnostics[0].code, "SPK003");

  const parsed = parseSourceMetadata(sourceText, { path: "src/graph.spl", projectUid: P });
  const artifact = { uid: A_SOURCE, project_uid: P, revision: "r1", canonical_path: "src/graph.spl", content_hash: parsed.content_hash };
  const token = Buffer.byteLength(sourceText.slice(0, sourceText.indexOf("fn publish_snapshot")), "utf8");
  const response = (span, sourceHash = artifact.content_hash) => ({
    coordinate_system: "spipe-normalized-utf8-bytes-v1", source_hash: sourceHash,
    symbols: [{ uid: SYMBOL, symbol_kind: "function", name: "publish_snapshot", qualified_name: "graph.publish_snapshot",
      signature_hash: null, source_span: span, annotation_uids: [REQUIREMENT], status: "accepted" }],
  });
  assert.equal(extractSourceTrace(parsed, sourceText, { ...context, revisionId: "r2", artifact }).diagnostics[0].code, "SPK004");
  assert.equal(extractSourceTrace(parsed, sourceText, { ...context, artifact, symbolProvider: () => response({ start_byte: token + 1, end_byte: Buffer.byteLength(sourceText) }) }).diagnostics.at(-1).code, "SPK406");

  const unicode = sourceText.replace("fn publish_snapshot", "fn épublish_snapshot");
  const unicodeParsed = parseSourceMetadata(unicode, { path: "src/graph.spl", projectUid: P });
  const unicodeArtifact = { ...artifact, content_hash: unicodeParsed.content_hash };
  const unicodeToken = Buffer.byteLength(unicode.slice(0, unicode.indexOf("épublish_snapshot")), "utf8");
  const splitCodePoint = unicodeToken + 1;
  assert.equal(extractSourceTrace(unicodeParsed, unicode, { ...context, artifact: unicodeArtifact,
    symbolProvider: () => response({ start_byte: splitCodePoint, end_byte: Buffer.byteLength(unicode, "utf8") }, unicodeArtifact.content_hash),
  }).diagnostics.at(-1).code, "SPK406");
});

test("diagnostics resolve explicit links and report exact requirement gaps", () => {
  const parsed = parseMarkdownArtifact(requirementSource, { path: "doc/02_requirements/graph.md", projectUid: P, revision: "r1" });
  const extracted = extractMarkdownTrace(parsed, requirementSource, context);
  const data = {
    ...extracted, artifacts: [parsed.artifact], sections: parsed.sections,
    projects: [{ uid: P, status: "active" }], edges: [], scenarios: [], tests: [], symbols: [],
  };
  const report = diagnoseTrace(data);
  assert.ok(report.resolved_links.some((entry) => entry.to_uid === SECTION));
  assert.deepEqual(report.diagnostics.filter((entry) => /^SPK20/.test(entry.code)).map((entry) => entry.code), ["SPK201", "SPK202", "SPK203", "SPK204"]);
  assert.ok(report.diagnostics.some((entry) => entry.code === "SPK101"));
  assert.deepEqual(Object.keys(report.diagnostics[0]).sort(), [
    "arguments", "artifact_uid", "cause_chain", "code", "message_key", "project_uid",
    "related_uids", "remediation", "revision_id", "severity", "snapshot_uid", "source_span", "type",
  ]);
});

test("trace matrix is deterministic and strict policy ignores unreceipted evidence", () => {
  const requirements = [{ uid: REQUIREMENT, display_id: "REQ-SPKC-003" }];
  const artifacts = [{ uid: A_REQ, kind: "design" }];
  const scenarios = [{ uid: SCENARIO }];
  const tests = [{ uid: TEST, test_kind: "unit" }];
  const edge = (from_uid, edge_type, authority = null) => ({ from_uid, to_uid: REQUIREMENT, edge_type, origin: "explicit", status: "accepted", authority });
  const data = { requirements, artifacts, scenarios, tests, symbols: [], edges: [edge(A_REQ, "satisfies"), edge(SCENARIO, "specifies"), edge(TEST, "verifies")] };
  assert.equal(buildTraceMatrix(data, { profile: "standard" }).rows[0].unit_test_uids.length, 0);
  assert.equal(buildTraceMatrix(data, { profile: "strict" }).rows[0].unit_test_uids.length, 0);
  data.edges = data.edges.map((entry) => ({ ...entry, authority: { receipt_uid: "D-00000000000000000000000000000001" },
    provenance: { decision_uid: "D-00000000000000000000000000000001" } }));
  assert.equal(buildTraceMatrix(data, { profile: "strict" }).rows[0].scenario_uids.length, 0);
});

function acceptanceSubjectHash(edge) {
  const subject = { ...edge, provenance: { ...edge.provenance } };
  delete subject.status;
  delete subject.authority;
  delete subject.provenance.decision_uid;
  return `sha256:${createHash("sha256").update(Buffer.concat([
    Buffer.from("spipe-edge-accept-v1\0", "utf8"), Buffer.from(canonicalJson(subject), "utf8"),
  ])).digest("hex")}`;
}

function acceptedScenarioEdge(receiptUid = null) {
  return {
    schema_version: 2, type: "edge", uid: EDGE, edge_type: "specifies",
    from_uid: SCENARIO, to_uid: REQUIREMENT, origin: "explicit", status: "accepted",
    confidence_milli: 1000, created_by: "principal:reviewer", created_at_revision: "r1",
    evidence_uids: [A_SPEC], generator: null,
    provenance: {
      project_uid: P, worktree_uid: WT, revision_id: "r1", input_snapshot_uid: INPUT_SNAPSHOT,
      source_uid: A_SPEC, source_location: null, decision_uid: receiptUid,
    },
    authority: receiptUid == null ? null : {
      kind: "explicit_review", receipt_uid: receiptUid, policy_hash: POLICY_HASH, policy_version: 1,
    },
  };
}

function signedAcceptance(edge, privateKey, now, expiresAt = now + 60_000) {
  return signEdgeAcceptanceReceipt({
    issuer_key_id: "review-key", edge_uid: edge.uid, acceptance_subject_hash: acceptanceSubjectHash(edge),
    from_uid: edge.from_uid, to_uid: edge.to_uid, origin: edge.origin, status: edge.status,
    project_uid: edge.provenance.project_uid, worktree_uid: edge.provenance.worktree_uid,
    input_snapshot_uid: edge.provenance.input_snapshot_uid, policy_hash: POLICY_HASH, policy_version: 1,
    capability: "trace.accept.explicit", decided_at_ms: now - 1, expires_at_ms: expiresAt,
    audit_evidence_hash: `sha256:${"c".repeat(64)}`,
  }, privateKey);
}

test("strict trace accepts only valid signed, current, non-revoked edge receipts", () => {
  const now = 2_000_000;
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const unsignedEdge = acceptedScenarioEdge();
  const validReceipt = signedAcceptance(unsignedEdge, privateKey, now);
  const edge = acceptedScenarioEdge(validReceipt.receipt_uid);
  const data = { requirements: [{ uid: REQUIREMENT, display_id: "REQ-SPKC-003" }], artifacts: [],
    scenarios: [{ uid: SCENARIO }], tests: [], symbols: [], edges: [edge] };
  const receipts = new Map([[validReceipt.receipt_uid, validReceipt]]);
  const validPort = createAuthorizationPort({ publicKeys: { "review-key": publicKey }, now: () => now });
  assert.deepEqual(buildTraceMatrix(data, { profile: "standard", authorizationPort: validPort, authorizationReceipts: receipts }).rows[0].scenario_uids, [SCENARIO]);
  assert.deepEqual(buildTraceMatrix(data, { profile: "strict", authorizationPort: validPort, authorizationReceipts: receipts }).rows[0].scenario_uids, [SCENARIO]);

  const forged = { ...validReceipt, signature: Buffer.alloc(64).toString("base64") };
  assert.deepEqual(buildTraceMatrix(data, { profile: "strict", authorizationPort: validPort,
    authorizationReceipts: new Map([[validReceipt.receipt_uid, forged]]) }).rows[0].scenario_uids, []);

  const revokedPort = createAuthorizationPort({ publicKeys: { "review-key": publicKey },
    revokedReceiptUids: [validReceipt.receipt_uid], now: () => now });
  assert.deepEqual(buildTraceMatrix(data, { profile: "strict", authorizationPort: revokedPort,
    authorizationReceipts: receipts }).rows[0].scenario_uids, []);

  const expiredReceipt = signedAcceptance(unsignedEdge, privateKey, now, now);
  const expiredEdge = acceptedScenarioEdge(expiredReceipt.receipt_uid);
  assert.deepEqual(buildTraceMatrix({ ...data, edges: [expiredEdge] }, { profile: "strict", authorizationPort: validPort,
    authorizationReceipts: new Map([[expiredReceipt.receipt_uid, expiredReceipt]]) }).rows[0].scenario_uids, []);
});

test("TRC231/TRC232 compatibility covers all mirrored-manual states", () => {
  const spec = "test/03_system/app/search/feature/query_spec.spl";
  const expected = "doc/06_spec/03_system/app/search/feature/query_spec.md";
  const wrong = "doc/06_spec/query_spec.md";
  assert.deepEqual(projectMirroredSpecDiagnostics([spec], [expected]), []);
  assert.deepEqual(projectMirroredSpecDiagnostics([spec], []).map((entry) => entry.code), ["TRC231"]);
  assert.deepEqual(projectMirroredSpecDiagnostics([spec], [wrong]).map((entry) => entry.code), ["TRC231", "TRC232"]);
  assert.deepEqual(projectMirroredSpecDiagnostics([spec], [expected, wrong]).map((entry) => entry.code), ["TRC232"]);
});
