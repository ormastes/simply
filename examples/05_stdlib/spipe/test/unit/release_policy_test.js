import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { initializeResult } from "../../mcp/protocol/initialize.js";
import { tools, callTool } from "../../mcp/protocol/tools.js";
import {
  canonicalProjectionSemanticHash,
  candidateManifestFields,
  candidateIdentity,
  promotionPlanFields,
  projectionSemanticHash,
  releaseAdmissionFields,
  releaseContractHash
} from "../../src/release/contract.js";
import { createReleasePlan } from "../../src/release/planner.js";

const root = new URL("../../", import.meta.url).pathname;
const sha = "a".repeat(40);
const sha2 = "c".repeat(40);
const hash = "b".repeat(64);

function sessionInput() { return { session_id: "s-release-001", workspace_path: "/tmp/release-s-release-001", main_workspace_path: "/repo", work_branch: "work/release/v1.2.0-beta.1-s-release-001", target_ref: "release/1.2", base_sha: sha, expected_target_sha: sha2, policy_sha256: hash }; }
function backportInput() { return { direction: "main_to_beta", source_ref: "main", source_commit_sha: sha, change_id: "change-1", work_id: "gh-1", change_kind: "fix", review_receipt_sha256: hash, reviewed_source_commit_sha: sha, reviewed_change_id: "change-1", target_line: "release/1.2", expected_target_sha: sha2, adaptation_reason: "none", evidence_sha256: hash, evidence_result_commit_sha: "d".repeat(40), evidence_target_sha: sha2, result_commit_sha: "d".repeat(40), forward_port_target_ref: "", forward_port_receipt_sha256: "" }; }
function candidateInput() { return { version: "1.2.0-beta.1", attempt: 1, candidate_ref: "candidate/v1.2.0-beta.1/a001", commit_sha: sha, source_tree_sha256: hash, policy_sha256: hash, version_manifest_sha256: hash, toolchain_manifest_sha256: hash, support_manifest_sha256: hash, build_graph_sha256: hash, creator_identity: "github:ormastes/simple/actions/runs/42/attempts/1", evidence_manifest_sha256: hash, existing_identity: "" }; }
function promotionInput() {
  const candidate = candidateInput();
  return { candidate_version: candidate.version, candidate_attempt: candidate.attempt, candidate_ref: candidate.candidate_ref, candidate_identity: candidateIdentity(candidate), candidate_commit_sha: candidate.commit_sha, source_tree_sha256: candidate.source_tree_sha256, policy_sha256: candidate.policy_sha256, version_manifest_sha256: candidate.version_manifest_sha256, toolchain_manifest_sha256: candidate.toolchain_manifest_sha256, support_manifest_sha256: candidate.support_manifest_sha256, build_graph_sha256: candidate.build_graph_sha256, creator_identity: candidate.creator_identity, target_commit_sha: candidate.commit_sha, tag: `v${candidate.version}`, artifact_manifest_sha256: hash, admitted_artifact_manifest_sha256: hash, evidence_manifest_sha256: candidate.evidence_manifest_sha256, qualification_receipt_sha256: hash, admission_receipt_sha256: hash, signed_tag: true, annotated_tag: true, exact_tag_push: true, rebuild: false, fallback_artifact: false, release_authority_approved: true };
}

test("plugin release schemas and identities stay at 0.2.0", () => {
  assert.equal(initializeResult().serverInfo.version, "0.2.0");
  assert.equal(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version, "0.2.0");
  const manifest = readFileSync(join(root, "plugin/manifest.sdn"), "utf8");
  assert.match(manifest, /version: 0\.2\.0/);
  assert.match(manifest, /reviewed_beta_backports: true/);
  assert.match(manifest, /immutable_release_candidates: true/);
  assert.match(manifest, /promote_without_rebuild: true/);
  assert.match(manifest, /operational_release_planning: true/);
  assert.match(manifest, /main_fix_discovery_planning: true/);
  assert.match(manifest, /release_first_forward_port_validation: true/);
  assert.match(manifest, /scoped_self_review_guidance: true/);
  assert.match(manifest, /external_release_mutation: false/);
});

test("MCP exposes read-only release policy surfaces", () => {
  assert.ok(tools.some((tool) => tool.name === "spipe_release_guide"));
  assert.ok(tools.some((tool) => tool.name === "spipe_release_capabilities"));
  for (const name of [
    "spipe_release_session_plan",
    "spipe_release_beta_backport_plan",
    "spipe_release_candidate_plan",
    "spipe_release_promotion_plan",
    "spipe_release_main_fix_discovery_plan",
    "spipe_release_forward_port_plan"
  ]) {
    const tool = tools.find((candidate) => candidate.name === name);
    assert.ok(tool, `missing MCP planner: ${name}`);
    assert.equal(tool.inputSchema.additionalProperties, false, `${name}: schema must reject unknown fields`);
    assert.deepEqual(tool.inputSchema.required.sort(), Object.keys(tool.inputSchema.properties).sort(), `${name}: every policy field is required`);
  }
  const capabilities = callTool(root, "spipe_release_capabilities").content[0].text;
  assert.match(capabilities, /immutable_release_candidates=true/);
  assert.match(capabilities, /promote_without_rebuild=true/);
  assert.match(capabilities, /external_release_mutation=false/);
  assert.match(capabilities, new RegExp(`contract_sha256=${releaseContractHash()}`));
});

test("CLI, MCP, manifest, and plugin descriptor expose the same release policy", () => {
  const manifest = readFileSync(join(root, "plugin/manifest.sdn"), "utf8");
  const descriptor = JSON.parse(readFileSync(join(root, "plugin/.codex-plugin/plugin.json"), "utf8"));
  const contractSource = readFileSync(join(root, "src/release/contract.js"), "utf8");
  const mcpCapabilities = callTool(root, "spipe_release_capabilities").content[0].text;
  for (const capability of [
    "isolated_sessions",
    "reviewed_beta_backports",
    "immutable_release_candidates",
    "promote_without_rebuild",
    "operational_release_planning",
    "main_fix_discovery_planning",
    "release_first_forward_port_validation",
    "scoped_self_review_guidance"
  ]) {
    assert.match(manifest, new RegExp(`${capability}: true`));
    assert.match(contractSource, new RegExp(`${capability}: true`));
    assert.match(mcpCapabilities, new RegExp(`${capability}=true`));
  }
  assert.equal(descriptor.skills, "./skills/");
  assert.deepEqual(descriptor.interface.capabilities, ["Read", "Planning"]);
  assert.equal(Object.hasOwn(descriptor, "commands"), false);
  for (const path of [
    "plugin/skills/software-release/SKILL.md",
    "plugin/skills/release/SKILL.md",
    "plugin/skills/sync/SKILL.md"
  ]) assert.ok(readFileSync(join(root, path), "utf8").length > 0, `missing installed skill: ${path}`);
});

test("guarded planners bind exact evidence and never perform mutation", () => {
  const session = createReleasePlan("isolated-session", sessionInput());
  assert.equal(session.mutation, "none");
  assert.equal(session.contract_sha256, releaseContractHash());
  const backport = createReleasePlan("beta-backport", backportInput());
  assert.equal(backport.operation, "beta-backport");
  const candidate = createReleasePlan("candidate", candidateInput());
  assert.equal(candidate.operation, "candidate");
  const promotion = JSON.parse(callTool(root, "spipe_release_promotion_plan", promotionInput()).content[0].text);
  assert.equal(promotion.mutation, "none");
  assert.match(promotion.next_action, /no push, tag, delete, rebuild, or publication/);
});

test("candidate identity matches Simple's ordered length-prefixed SHA256 contract", () => {
  const candidate = candidateInput();
  assert.equal(candidateIdentity(candidate), "d3ff94490db119ad782bcb13fe41cda894af2824ffaf360d8f5b1cc351a482cc");
  const planned = createReleasePlan("candidate", candidate);
  assert.equal(planned.inputs.candidate_identity, candidateIdentity(candidate));
  assert.notEqual(candidateIdentity({ ...candidate, build_graph_sha256: "c".repeat(64) }), planned.inputs.candidate_identity);
  assert.notEqual(candidateIdentity({ ...candidate, creator_identity: `${candidate.creator_identity}-other` }), planned.inputs.candidate_identity);
  const unicodeCreator = { ...candidate, creator_identity: "github:release/β" };
  assert.equal(candidateIdentity(unicodeCreator), "dfbf22095ce95222a7486d5ce7d70dc1e766fe6e0263e52178268b297e798f35");
});

test("candidate and promotion schemas preserve exact Simple field parity", () => {
  assert.deepEqual(candidateManifestFields, ["version", "attempt", "candidate_ref", "commit_sha", "source_tree_sha256", "policy_sha256", "version_manifest_sha256", "toolchain_manifest_sha256", "support_manifest_sha256", "build_graph_sha256", "creator_identity", "evidence_manifest_sha256"]);
  assert.deepEqual(releaseAdmissionFields, ["candidate_version", "candidate_attempt", "candidate_ref", "candidate_identity", "candidate_commit_sha", "source_tree_sha256", "policy_sha256", "version_manifest_sha256", "toolchain_manifest_sha256", "support_manifest_sha256", "build_graph_sha256", "creator_identity", "artifact_manifest_sha256", "evidence_manifest_sha256", "qualification_receipt_sha256", "admission_receipt_sha256"]);
  assert.deepEqual(promotionPlanFields, ["candidate_identity", "tag", "target_commit_sha", "candidate_commit_sha", "artifact_manifest_sha256", "admitted_artifact_manifest_sha256", "signed_tag", "annotated_tag", "exact_tag_push", "rebuild", "fallback_artifact"]);
});

test("beta convergence discovers main fixes but requires selection and validates forward-port", () => {
  const discovery = createReleasePlan("main-fix-discovery", {
    main_commit_sha: sha, since_commit_sha: sha2, release_line_head_sha: "d".repeat(40),
    direction: "main_to_release", read_only_snapshot: true, main_is_independent_trunk: true,
    interval_seconds: 3600, last_scan_epoch: 100, now_epoch: 3700,
    candidates: [
      { commit_sha: "d".repeat(40), title: "fix parser", direction: "main_to_release", classification: "bug-fix", reviewed: true, review_receipt_sha256: hash, changed_paths: ["src/parser.spl"] },
      { commit_sha: "e".repeat(40), title: "new syntax", direction: "main_to_release", classification: "feature", reviewed: true, review_receipt_sha256: hash, changed_paths: ["src/parser.spl"] }
    ], selected_commit_shas: ["d".repeat(40)], forward_port_required: false, forward_port_target_ref: ""
  });
  assert.equal(discovery.inputs.eligible_candidates.length, 1);
  const forwardPort = createReleasePlan("forward-port", {
    release_fix_commit_sha: sha, main_base_commit_sha: "c".repeat(40),
    review_receipt_sha256: hash, forward_port_receipt_sha256: hash, main_result_sha256: hash,
    release_first_exception_approved: true, reviewed: true, main_tests_renewed: true,
    protected_ref_direct_update: false, forward_port_branch: "work/fix/gh-1-forward-port-parser", forward_port_target_ref: "main"
  });
  assert.equal(forwardPort.mutation, "none");
  assert.match(forwardPort.next_action, /do not push main directly/);
});

test("guarded planners fail closed on unsafe requests", () => {
  assert.throws(() => createReleasePlan("isolated-session", { ...sessionInput(), work_branch: "main" }), /work_branch/);
  assert.throws(() => createReleasePlan("beta-backport", { ...backportInput(), change_kind: "feat" }), /change_kind must be fix/);
  assert.throws(() => createReleasePlan("candidate", { ...candidateInput(), attempt: 2 }), /a002/);
  assert.throws(() => createReleasePlan("promotion", { ...promotionInput(), rebuild: true }), /rebuild must be false/);
  assert.throws(() => createReleasePlan("promotion", { ...promotionInput(), candidate_identity: hash }), /canonical admitted candidate/);
  assert.throws(() => createReleasePlan("promotion", { ...promotionInput(), build_graph_sha256: "c".repeat(64) }), /canonical admitted candidate/);
  assert.throws(() => createReleasePlan("candidate", { ...candidateInput(), unexpected: true }), /unknown fields: unexpected/);
});

test("release projections have one hashed semantic contract", () => {
  const paths = [
    "doc/00_llm_process/skill_command/command/release.md",
    "doc/00_llm_process/skill_command/skills/codex/release/skill.md",
    "doc/00_llm_process/skill_command/skills/gemini/release/skill.md",
    "doc/00_llm_process/skill_command/skills/pipe/release/skill.md",
    "doc/00_llm_process/skill_command/skills/pipe/release/repo_and_pull_req/skill.md",
    ".claude/skills/release.md",
    ".claude/skills/software-release.md",
    ".codex/skills/release/SKILL.md",
    ".codex/skills/software-release/SKILL.md",
    ".gemini/commands/release.toml",
    "plugin/skills/release/SKILL.md",
    "plugin/skills/software-release/SKILL.md"
  ];
  const expected = canonicalProjectionSemanticHash();
  for (const path of paths) {
    const content = readFileSync(join(root, path), "utf8");
    assert.equal(projectionSemanticHash(content), expected, `${path}: semantic release projection drift`);
  }
});

test("canonical release guidance rejects legacy unsafe behavior", () => {
  const paths = [
    "doc/00_llm_process/skill_command/command/release.md",
    "doc/00_llm_process/skill_command/skills/codex/release/skill.md",
    "doc/00_llm_process/skill_command/skills/gemini/release/skill.md",
    "doc/00_llm_process/skill_command/skills/pipe/release/skill.md",
    "doc/00_llm_process/skill_command/skills/pipe/release/repo_and_pull_req/skill.md"
  ];
  const guide = readFileSync(join(root, paths[0]), "utf8");
  for (const path of paths) {
    const content = readFileSync(join(root, path), "utf8");
    for (const forbidden of ["git push --tags", "bookmark set main", "gh release delete", "git tag -d", "NO BRANCHES"])
      assert.equal(content.includes(forbidden), false, `${path}: forbidden legacy command: ${forbidden}`);
  }
  assert.match(guide, /reviewed bug-fix commit/);
  assert.match(guide, /Promotion never rebuilds/);
  assert.match(guide, /GitHub forbids a PR author from submitting an `APPROVED` review/);
  assert.match(guide, /directory_files/);
  assert.match(guide, /directory_recursive/);
  assert.match(guide, /Rejection remediation/);
});
