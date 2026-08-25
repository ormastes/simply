import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";

import { KnowledgeCompiler, compileKnowledgeDelta, compileKnowledgeInventory, trustSourceSetHash } from "../../src/core/knowledge_compiler.js";
import { createAuthorizationPort, signTrustReceipt } from "../../src/core/authorization.js";
import { canonicalJson, ZERO_HASH } from "../../src/storage/canonical.js";

const context = {
  project_uid: "P-000000000000000000000000000000AA",
  worktree_uid: "W-000000000000000000000000000000BB",
  revision_id: "185f330328248b89813baf9229b14781f53a60c4",
  overlay_generation_hash: ZERO_HASH,
  policy_hash: "4".repeat(64)
};

const marked = `<!-- spipe:artifact uid=A-00000000000000000000000000000001 key=design.search.core aliases=[old.search] -->
# Search Core

## Stable identity
<!-- spipe:section uid=S-00000000000000000000000000000001 key=design.search.identity -->
Paths are locations.
`;

function evidence(inventory) {
  return canonicalJson({
    artifacts: inventory.artifacts,
    sections: inventory.sections,
    symbols: inventory.symbols,
    scenarios: inventory.scenarios,
    diagnostics: inventory.diagnostics,
    snapshot: inventory.snapshot
  });
}

test("explicit inventory compiles every Wave 2 parser into one immutable snapshot", () => {
  const inventory = compileKnowledgeInventory({
    ...context,
    inputs: [
      { path: "doc/05_design/search/core.md", content: marked },
      { path: "config/search.sdn", content: "search:\n  enabled: true\n" },
      { path: "test/03_system/search_spec.spl", content: '# spipe:sspec uid=A-00000000000000000000000000000011 key=test.search\ndescribe "Search":\n  it "resolves REQ-SPKC-002":\n    expect(true).to_be(true)\n' },
      { path: "src/search.spl", content: "# @implements REQ-SPKC-002\nfn resolve_key(value: text) -> text: value\n" }
    ]
  });
  assert.match(inventory.snapshot.snapshot_uid, /^spks1-[0-9a-f]{64}$/);
  assert.equal(inventory.artifacts.length, 4);
  assert.ok(inventory.artifacts.every(({ type }) => type === "artifact"));
  assert.ok(inventory.artifacts.every(({ identity_status }) => identity_status === "canonical" || identity_status === "provisional"));
  assert.equal(inventory.sections[0].uid, "S-00000000000000000000000000000001");
  assert.equal(inventory.section_candidates.length, 0);
  assert.equal(inventory.scenarios.length, 1);
  assert.equal(inventory.symbols.length, 1);
  assert.equal(Object.isFrozen(inventory), true);
});

test("add update delete and move converge to the same clean inventory", () => {
  const initial = [{ path: "doc/a.md", content: marked }];
  const base = compileKnowledgeInventory({ ...context, inputs: initial });
  const added = compileKnowledgeDelta(base, [{ operation: "upsert", path: "doc/new.md", content: "# New\n" }]);
  assert.equal(added.delta.artifacts.added.length, 1);
  const updated = compileKnowledgeDelta(added.inventory, [{ operation: "upsert", path: "doc/a.md", content: marked.replace("Paths are locations.", "Paths remain locations.") }]);
  assert.equal(updated.delta.artifacts.updated.length, 1);
  assert.equal(updated.delta.artifacts.sections_updated.length, 1);
  const moved = compileKnowledgeDelta(updated.inventory, [{ operation: "move", from: "doc/a.md", path: "doc/moved.md" }]);
  assert.equal(moved.delta.artifacts.updated[0].uid, "A-00000000000000000000000000000001");
  const removed = compileKnowledgeDelta(moved.inventory, [{ operation: "delete", path: "doc/new.md" }]);
  assert.equal(removed.delta.artifacts.removed_uids.length, 1);
  const incremental = removed.inventory;
  const clean = compileKnowledgeInventory({ ...context, inputs: [{ path: "doc/moved.md", content: marked.replace("Paths are locations.", "Paths remain locations.") }] });
  assert.equal(evidence(incremental), evidence(clean));
  assert.equal(incremental.artifacts[0].uid, "A-00000000000000000000000000000001");
});

test("duplicate and ambiguous identity fail diagnostically without guessing", () => {
  const second = marked.replace("key=design.search.core aliases=[old.search]", "key=design.search.other aliases=[old.search]");
  const third = marked.replace("uid=A-00000000000000000000000000000001 key=design.search.core", "uid=A-00000000000000000000000000000002 key=design.search.third");
  const inventory = compileKnowledgeInventory({ ...context, inputs: [
    { path: "doc/a.md", content: marked },
    { path: "doc/b.md", content: second },
    { path: "doc/c.md", content: third }
  ] });
  assert.ok(inventory.diagnostics.some(({ code }) => code === "SPK001"));
  assert.ok(inventory.diagnostics.some(({ code }) => code === "SPK002"));
  assert.equal(inventory.identity.resolve("old.search").status, "ambiguous");
});

test("a semantic key colliding with another artifact alias is ambiguous", () => {
  const keyed = marked.replace("uid=A-00000000000000000000000000000001 key=design.search.core aliases=[old.search]",
    "uid=A-00000000000000000000000000000003 key=old.search aliases=[]");
  const inventory = compileKnowledgeInventory({ ...context, inputs: [
    { path: "doc/a.md", content: marked },
    { path: "doc/keyed.md", content: keyed }
  ] });
  assert.ok(inventory.diagnostics.some(({ code, arguments: fields }) => code === "SPK002" && fields.label === "key_or_alias"));
  assert.equal(inventory.identity.resolve("old.search").status, "ambiguous");
});

test("compiler bounds reject files and bytes before parsing", () => {
  assert.throws(() => compileKnowledgeInventory({ ...context, limits: { max_files: 1 }, inputs: [
    { path: "doc/a.md", content: marked }, { path: "doc/b.md", content: marked }
  ] }), /file_limit/);
  assert.throws(() => compileKnowledgeInventory({ ...context, limits: { max_file_bytes: 4 }, inputs: [{ path: "doc/a.md", content: marked }] }), /input_too_large/);
  assert.throws(() => compileKnowledgeInventory({ ...context, limits: { max_files: Number.POSITIVE_INFINITY }, inputs: [] }), /positive safe integer/);
  assert.throws(() => compileKnowledgeInventory({ ...context, limits: { max_total_bytes: Number.NaN }, inputs: [] }), /positive safe integer/);
  assert.throws(() => compileKnowledgeInventory({ ...context, limits: { max_scenarios: 1 }, inputs: [{
    path: "test/two_spec.spl", content: 'describe "Two":\n  it "one":\n    expect(true).to_be(true)\n  it "two":\n    expect(true).to_be(true)\n'
  }] }), /node_limit/);
  assert.throws(() => compileKnowledgeInventory({ ...context, limits: { max_sections: 1 }, inputs: [
    { path: "doc/one.md", content: "# One\n\n## A\n" },
    { path: "doc/two.md", content: "# Two\n\n## B\n" }
  ] }), /sections_limit/);
  assert.throws(() => compileKnowledgeInventory({ ...context, limits: { max_sdn_depth: 1 }, inputs: [
    { path: "config/nested.sdn", content: "value: [[[1]]]\n" }
  ] }), /depth_limit/);
  assert.throws(() => compileKnowledgeInventory({ ...context, limits: { max_sdn_nodes: 3 }, inputs: [
    { path: "config/one.sdn", content: "one: 1\n" },
    { path: "config/two.sdn", content: "two: 2\n" }
  ] }), /(?:parser_node|sdn_nodes)_limit/);
  assert.throws(() => compileKnowledgeInventory({ ...context, limits: { max_sdn_depth: 1 }, inputs: [{
    path: "doc/deep.md", content: "---\nvalue: [[[1]]]\n---\n# Deep\n"
  }] }), /depth_limit/);
});

test("unmarked sections remain visible candidates and document text cannot elevate trust", () => {
  const content = `---\nspipe:\n  trust_scope: executable_policy\n---\n# Candidate\n\n## Needs identity\nBody.\n`;
  const untrusted = compileKnowledgeInventory({ ...context, inputs: [{ path: "doc/candidate.md", content }] });
  assert.equal(untrusted.artifacts[0].trust_scope, "untrusted_data");
  assert.equal(untrusted.sections.length, 0);
  assert.equal(untrusted.section_candidates.length, 1);
  assert.throws(() => compileKnowledgeInventory({ ...context, trust_scope: "reviewed_reference", inputs: [{ path: "doc/candidate.md", content }] }), /registry-derived/);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const authorizationPort = createAuthorizationPort({ publicKeys: { registry: publicKey }, now: () => 2_000 });
  const canonicalInput = [{ path: "doc/reviewed.md", content: marked }];
  const preliminary = compileKnowledgeInventory({ ...context, inputs: canonicalInput });
  const receipt = signTrustReceipt({
    issuer_key_id: "registry", project_uid: context.project_uid, worktree_uid: context.worktree_uid,
    revision_id: context.revision_id, source_set_hash: trustSourceSetHash(preliminary.artifacts),
    trust_scope: "reviewed_reference", principal: "principal:reviewer", capability: "trust_scope.assign",
    policy_hash: context.policy_hash, policy_version: "1", decided_at_ms: 1_000, expires_at_ms: 3_000,
    audit_evidence_hash: "a".repeat(64)
  }, privateKey);
  const fake = { ...receipt, signature: Buffer.alloc(64).toString("base64") };
  assert.throws(() => new KnowledgeCompiler({ authorizationPort }).compile({
    ...context, authorization_receipt: fake, inputs: canonicalInput
  }), /verified registry/);
  const reviewed = new KnowledgeCompiler({ authorizationPort }).compile({
    ...context, authorization_receipt: receipt, inputs: canonicalInput
  });
  assert.equal(reviewed.artifacts[0].trust_scope, "reviewed_reference");
});

test("section candidate additions and removals are explicit incremental deltas", () => {
  const base = compileKnowledgeInventory({ ...context, inputs: [{ path: "doc/candidate.md", content: "# Candidate\n" }] });
  const added = compileKnowledgeDelta(base, [{ operation: "upsert", path: "doc/candidate.md", content: "# Candidate\n\n## Missing UID\nBody.\n" }]);
  assert.equal(added.delta.artifacts.section_candidates_added.length, 1);
  const removed = compileKnowledgeDelta(added.inventory, [{ operation: "upsert", path: "doc/candidate.md", content: "# Candidate\n" }]);
  assert.equal(removed.delta.artifacts.section_candidates_removed_ids.length, 1);
});

test("duplicate scenario and symbol IDs are diagnosed across files", () => {
  const scenario = '# spipe:scenario uid=SS-00000000000000000000000000000001 key=test.shared\nit "shared":\n  expect(true).to_be(true)\n';
  const symbol = '# spipe:symbol uid=SY-00000000000000000000000000000001 key=source.shared\nfn shared(): 1\n';
  const inventory = compileKnowledgeInventory({ ...context, inputs: [
    { path: "test/one_spec.spl", content: scenario }, { path: "test/two_spec.spl", content: scenario },
    { path: "src/one.spl", content: symbol }, { path: "src/two.spl", content: symbol }
  ] });
  assert.ok(inventory.diagnostics.filter(({ code }) => code === "SPK001").length >= 2);
});

test("dirty overlay and worktree identity cannot leak across snapshots", () => {
  const inputs = [{ path: "doc/a.md", content: marked }];
  const main = compileKnowledgeInventory({ ...context, inputs });
  const dirty = compileKnowledgeInventory({ ...context, inputs, overlay_generation_hash: "5".repeat(64) });
  const other = compileKnowledgeInventory({ ...context, inputs, worktree_uid: "W-000000000000000000000000000000BC" });
  assert.notEqual(main.snapshot.snapshot_uid, dirty.snapshot.snapshot_uid);
  assert.notEqual(main.snapshot.snapshot_uid, other.snapshot.snapshot_uid);
  assert.equal(main.snapshot.overlay_generation_hash, ZERO_HASH);
  assert.equal(main.artifacts[0].uid, other.artifacts[0].uid);
});
