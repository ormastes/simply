import { assertExactReleaseFields, candidateIdentity, digest, releaseContractHash } from "./contract.js";

const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const SHA256 = /^[0-9a-f]{64}$/;
const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(?:alpha|beta|rc)\.(0|[1-9][0-9]*))?$/;
const RELEASE_LINE = /^release\/(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

function text(input, key) { if (typeof input[key] !== "string" || input[key].trim() === "") throw new Error(`${key} is required`); return input[key]; }
function match(input, key, pattern) { const value = text(input, key); if (!pattern.test(value)) throw new Error(`${key} has invalid format`); return value; }
function yes(input, key) { if (input[key] !== true) throw new Error(`${key} must be true`); }
function no(input, key) { if (input[key] !== false) throw new Error(`${key} must be false`); }
function safeIdentity(input, key) { const value = text(input, key); if (value.includes("\n") || value.includes("\r")) throw new Error(`${key} must be one safe identity`); return value; }
function plan(operation, inputs, checks, nextAction) { const body = { schema: "spipe-release-plan/1", operation, contract_sha256: releaseContractHash(), mutation: "none", external_authority_required: true, checks, next_action: nextAction, inputs }; return Object.freeze({ ...body, plan_sha256: digest(body) }); }

function validateSession(input) {
  text(input, "session_id"); text(input, "workspace_path"); text(input, "main_workspace_path");
  const branch = text(input, "work_branch"); const target = text(input, "target_ref");
  match(input, "base_sha", COMMIT); match(input, "expected_target_sha", COMMIT); match(input, "policy_sha256", SHA256);
  if (!branch.startsWith("work/")) throw new Error("work_branch must be an owned work/* ref");
  if (input.workspace_path === input.main_workspace_path) throw new Error("workspace_path must not be the main worktree");
  if (target !== "main" && !RELEASE_LINE.test(target)) throw new Error("target_ref must be main or release/X.Y");
}

export function planIsolatedSession(input) { validateSession(input); return plan("isolated-session", input, ["unique owned work branch", "unique non-main workspace", "exact base and target commits", "policy digest bound"], "create the session only through an authorized workspace/session provider"); }

export function planBetaBackport(input) {
  if (input.direction !== "main_to_beta" && input.direction !== "beta_to_main") throw new Error("direction must be main_to_beta or beta_to_main");
  match(input, "source_commit_sha", COMMIT); match(input, "result_commit_sha", COMMIT); match(input, "expected_target_sha", COMMIT);
  match(input, "review_receipt_sha256", SHA256); match(input, "evidence_sha256", SHA256);
  text(input, "change_id"); text(input, "work_id"); text(input, "source_ref"); text(input, "target_line"); text(input, "adaptation_reason");
  if (input.change_kind !== "fix") throw new Error("change_kind must be fix");
  if (!RELEASE_LINE.test(input.target_line)) throw new Error("target_line must be release/X.Y");
  if (input.reviewed_source_commit_sha !== input.source_commit_sha || input.reviewed_change_id !== input.change_id) throw new Error("review evidence does not bind source commit and change identity");
  if (input.evidence_result_commit_sha !== input.result_commit_sha || input.evidence_target_sha !== input.expected_target_sha || input.result_commit_sha === input.expected_target_sha) throw new Error("renewed evidence does not bind result and target revisions");
  if (input.direction === "main_to_beta") {
    if (input.source_ref !== "main") throw new Error("main_to_beta source_ref must be main");
    if (input.forward_port_target_ref !== "" || input.forward_port_receipt_sha256 !== "") throw new Error("main_to_beta must not claim a forward port");
  } else {
    if (input.source_ref !== input.target_line || input.forward_port_target_ref !== "main") throw new Error("release-first fix requires a forward port to main");
    match(input, "forward_port_receipt_sha256", SHA256);
  }
  return plan("beta-backport", input, ["exact reviewed bug-fix commit", "stable change and work identities", "exact release target", "renewed result evidence", "release-first forward-port receipt when required"], "apply this exact commit in an isolated work branch and submit through protected integration");
}

export function planMainFixDiscovery(input) {
  for (const key of ["main_commit_sha", "since_commit_sha", "release_line_head_sha"]) match(input, key, COMMIT);
  yes(input, "read_only_snapshot"); yes(input, "main_is_independent_trunk");
  if (!["main_to_release", "release_to_main"].includes(input.direction)) throw new Error("direction must be main_to_release or release_to_main");
  if (!Number.isSafeInteger(input.interval_seconds) || input.interval_seconds <= 0 || !Number.isSafeInteger(input.last_scan_epoch) || !Number.isSafeInteger(input.now_epoch) || input.now_epoch < input.last_scan_epoch) throw new Error("scan interval and epochs must be positive and monotonic");
  if (!Array.isArray(input.candidates) || !Array.isArray(input.selected_commit_shas)) throw new Error("candidates and selected_commit_shas must be arrays");
  const candidateFields = ["commit_sha", "title", "direction", "classification", "reviewed", "review_receipt_sha256", "changed_paths"];
  const eligible = input.candidates.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error(`candidates[${index}] must be an object`);
    const unknown = Object.keys(candidate).filter((key) => !candidateFields.includes(key)); const missing = candidateFields.filter((key) => !Object.hasOwn(candidate, key));
    if (unknown.length || missing.length) throw new Error(`candidates[${index}] field mismatch: unknown=${unknown.join(",")} missing=${missing.join(",")}`);
    match(candidate, "commit_sha", COMMIT); text(candidate, "title"); match(candidate, "review_receipt_sha256", SHA256);
    if (!Array.isArray(candidate.changed_paths) || candidate.changed_paths.some((path) => typeof path !== "string" || path === "")) throw new Error(`candidates[${index}].changed_paths must contain paths`);
    return candidate;
  }).filter((candidate) => candidate.classification === "bug-fix" && candidate.reviewed === true && candidate.direction === input.direction);
  const eligibleShas = new Set(eligible.map((candidate) => candidate.commit_sha));
  if (new Set(input.selected_commit_shas).size !== input.selected_commit_shas.length || input.selected_commit_shas.some((sha) => !eligibleShas.has(sha))) throw new Error("selected_commit_shas must be unique eligible reviewed bug fixes");
  if (input.direction === "release_to_main") { yes(input, "forward_port_required"); if (input.forward_port_target_ref !== "main") throw new Error("release-first fixes require a forward port to main"); }
  else if (input.forward_port_required !== false || input.forward_port_target_ref !== "") throw new Error("main-to-release discovery must not claim a forward port");
  return plan("main-fix-discovery", { ...input, eligible_candidates: eligible }, ["periodic immutable snapshots", "independent main trunk", "reviewed bug-fix classification", "explicit caller selection", "directional forward-port policy"], "present eligible fixes; an authorized caller must select each exact commit before any VCS mutation");
}

export function planForwardPort(input) {
  match(input, "release_fix_commit_sha", COMMIT); match(input, "main_base_commit_sha", COMMIT); match(input, "review_receipt_sha256", SHA256); match(input, "forward_port_receipt_sha256", SHA256); match(input, "main_result_sha256", SHA256);
  yes(input, "release_first_exception_approved"); yes(input, "reviewed"); yes(input, "main_tests_renewed"); no(input, "protected_ref_direct_update");
  if (input.forward_port_target_ref !== "main") throw new Error("forward_port_target_ref must be main");
  const branch = text(input, "forward_port_branch"); if (!branch.startsWith("work/backport/") && !branch.startsWith("work/fix/")) throw new Error("forward_port_branch must be an isolated work/backport/* or work/fix/* ref");
  return plan("forward-port", input, ["exact release-first fix", "exception and review receipts bound", "isolated main-target branch", "renewed main evidence"], "submit through protected main integration; do not push main directly");
}

export function planCandidate(input) {
  const version = match(input, "version", VERSION); const attempt = Number(input.attempt);
  if (!Number.isSafeInteger(attempt) || attempt < 1) throw new Error("attempt must be a positive integer");
  const expectedRef = `candidate/v${version}/a${String(attempt).padStart(3, "0")}`; if (input.candidate_ref !== expectedRef) throw new Error(`candidate_ref must equal ${expectedRef}`);
  match(input, "commit_sha", COMMIT); for (const key of ["source_tree_sha256", "policy_sha256", "version_manifest_sha256", "toolchain_manifest_sha256", "support_manifest_sha256", "build_graph_sha256", "evidence_manifest_sha256"]) match(input, key, SHA256);
  safeIdentity(input, "creator_identity");
  if (typeof input.existing_identity !== "string") throw new Error("existing_identity must be a string");
  const { existing_identity: _existing, ...candidateManifest } = input;
  const identity = candidateIdentity(candidateManifest); if (input.existing_identity !== "" && input.existing_identity !== identity) throw new Error("candidate identity is create-once and cannot be mutated");
  return plan("candidate", { ...input, candidate_identity: identity }, ["canonical candidate ref", "complete source policy version toolchain support and evidence identities", "create-once identity", "no fallback"], "request candidate creation from the protected candidate authority");
}

export function planPromotion(input) {
  const version = match(input, "candidate_version", VERSION); if (input.tag !== `v${version}`) throw new Error(`tag must equal v${version}`);
  const attempt = Number(input.candidate_attempt); if (!Number.isSafeInteger(attempt) || attempt < 1) throw new Error("candidate_attempt must be a positive integer");
  const expectedRef = `candidate/v${version}/a${String(attempt).padStart(3, "0")}`; if (input.candidate_ref !== expectedRef) throw new Error(`candidate_ref must equal ${expectedRef}`);
  match(input, "candidate_identity", SHA256); match(input, "candidate_commit_sha", COMMIT); match(input, "target_commit_sha", COMMIT);
  if (input.target_commit_sha !== input.candidate_commit_sha) throw new Error("target_commit_sha must equal candidate_commit_sha");
  for (const key of ["source_tree_sha256", "policy_sha256", "version_manifest_sha256", "toolchain_manifest_sha256", "support_manifest_sha256", "build_graph_sha256", "artifact_manifest_sha256", "admitted_artifact_manifest_sha256", "evidence_manifest_sha256", "qualification_receipt_sha256", "admission_receipt_sha256"]) match(input, key, SHA256);
  safeIdentity(input, "creator_identity");
  const admittedCandidate = {
    version: input.candidate_version, attempt: input.candidate_attempt,
    candidate_ref: input.candidate_ref, commit_sha: input.candidate_commit_sha,
    source_tree_sha256: input.source_tree_sha256, policy_sha256: input.policy_sha256,
    version_manifest_sha256: input.version_manifest_sha256,
    toolchain_manifest_sha256: input.toolchain_manifest_sha256,
    support_manifest_sha256: input.support_manifest_sha256,
    build_graph_sha256: input.build_graph_sha256,
    creator_identity: input.creator_identity,
    evidence_manifest_sha256: input.evidence_manifest_sha256
  };
  if (input.candidate_identity !== candidateIdentity(admittedCandidate)) throw new Error("candidate_identity does not bind the canonical admitted candidate");
  if (input.artifact_manifest_sha256 !== input.admitted_artifact_manifest_sha256) throw new Error("artifact manifest must match admission");
  yes(input, "signed_tag"); yes(input, "annotated_tag"); yes(input, "exact_tag_push"); yes(input, "release_authority_approved"); no(input, "rebuild"); no(input, "fallback_artifact");
  return plan("promotion", input, ["exact admitted candidate and commit", "qualification and admission receipts", "exact artifact and evidence identities", "signed annotated immutable exact tag", "promotion does not rebuild"], "submit to the protected release authority; this planner performs no push, tag, delete, rebuild, or publication");
}

export function createReleasePlan(operation, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("input must be a JSON object");
  assertExactReleaseFields(operation, input);
  if (operation === "isolated-session") return planIsolatedSession(input);
  if (operation === "beta-backport") return planBetaBackport(input);
  if (operation === "candidate") return planCandidate(input);
  if (operation === "promotion") return planPromotion(input);
  if (operation === "main-fix-discovery") return planMainFixDiscovery(input);
  if (operation === "forward-port") return planForwardPort(input);
  throw new Error(`unknown release planning operation: ${operation}`);
}
