import { createHash } from "node:crypto";

export const releaseSchemas = Object.freeze({ vcs_policy: "spipe-vcs/3", session: "spipe-session/1", release: "spipe-release/1", candidate: "spipe-candidate/1" });
export const releaseCapabilities = Object.freeze({ isolated_sessions: true, reviewed_beta_backports: true, immutable_release_candidates: true, promote_without_rebuild: true, operational_release_planning: true, main_fix_discovery_planning: true, release_first_forward_port_validation: true, scoped_self_review_guidance: true, external_release_mutation: false });

export const releaseProjectionContract = Object.freeze([
  ["isolated-session", "one isolated release session owns one work branch and one non-main worktree"],
  ["canonical-version", "release/version.sdn is the sole version authority and all other version locations are checked projections"],
  ["reviewed-beta-backport", "beta maintenance admits only caller-selected reviewed bug-fix commits with exact provenance and renewed result-revision evidence"],
  ["periodic-main-convergence", "bootstrap periodically performs read-only main-to-release convergence discovery and never selects or cherry-picks fixes automatically"],
  ["release-first-forward-port", "an approved release-first emergency fix requires an exact reviewed forward-port receipt to main"],
  ["independent-main-trunk", "main remains the independent development trunk and never tracks or becomes a release branch"],
  ["protected-integration", "protected refs change only through exact-revision compare-and-swap integration authority"],
  ["immutable-candidate", "each changed source policy support or toolchain identity creates a new immutable candidate attempt"],
  ["build-once", "build and qualify the exact candidate once and reject required failures or fallback artifacts"],
  ["promote-without-rebuild", "promotion reuses admitted artifacts without rebuilding and pushes exactly one signed annotated tag"],
  ["whole-confirmation", "release admission requires focused failures to reach zero followed by one clean whole-suite confirmation"],
  ["non-destructive-release-identity", "withdrawal preserves published tags assets and history and corrections use a new version"],
  ["self-review-status", "protected PR self review uses a required status check because GitHub forbids an author APPROVED review and never claims provider approval"],
  ["self-review-scopes", "ordinary code and text are eligible by default absent an operator deny or constrain record with code, text, file, directory_files, and directory_recursive scopes"],
  ["self-review-invalidation", "push, retarget, base, diff, ruleset, policy, or expiry invalidation requires a fresh exact-head review and a new self-review admission dispatch"],
  ["self-review-remediation", "rejection remediation follows the exact reason without broadening protected integration, candidate, release, signing, or publication authority"]
]);

// These three field lists mirror Simple's CandidateManifest,
// ReleaseAdmission, and PromotionPlan in src/app/release/policy.spl. The final
// authority flag is Spipe's explicit operational extension at the irreversible
// boundary; it is not part of the shared candidate identity.
export const candidateManifestFields = Object.freeze(["version", "attempt", "candidate_ref", "commit_sha", "source_tree_sha256", "policy_sha256", "version_manifest_sha256", "toolchain_manifest_sha256", "support_manifest_sha256", "build_graph_sha256", "creator_identity", "evidence_manifest_sha256"]);
export const releaseAdmissionFields = Object.freeze(["candidate_version", "candidate_attempt", "candidate_ref", "candidate_identity", "candidate_commit_sha", "source_tree_sha256", "policy_sha256", "version_manifest_sha256", "toolchain_manifest_sha256", "support_manifest_sha256", "build_graph_sha256", "creator_identity", "artifact_manifest_sha256", "evidence_manifest_sha256", "qualification_receipt_sha256", "admission_receipt_sha256"]);
export const promotionPlanFields = Object.freeze(["candidate_identity", "tag", "target_commit_sha", "candidate_commit_sha", "artifact_manifest_sha256", "admitted_artifact_manifest_sha256", "signed_tag", "annotated_tag", "exact_tag_push", "rebuild", "fallback_artifact"]);

export const releaseOperations = Object.freeze({
  "isolated-session": ["session_id", "workspace_path", "main_workspace_path", "work_branch", "target_ref", "base_sha", "expected_target_sha", "policy_sha256"],
  "beta-backport": ["direction", "source_ref", "source_commit_sha", "change_id", "work_id", "change_kind", "review_receipt_sha256", "reviewed_source_commit_sha", "reviewed_change_id", "target_line", "expected_target_sha", "adaptation_reason", "evidence_sha256", "evidence_result_commit_sha", "evidence_target_sha", "result_commit_sha", "forward_port_target_ref", "forward_port_receipt_sha256"],
  candidate: [...candidateManifestFields, "existing_identity"],
  promotion: [...new Set([...releaseAdmissionFields, ...promotionPlanFields]), "release_authority_approved"],
  "main-fix-discovery": ["main_commit_sha", "since_commit_sha", "release_line_head_sha", "direction", "read_only_snapshot", "main_is_independent_trunk", "interval_seconds", "last_scan_epoch", "now_epoch", "candidates", "selected_commit_shas", "forward_port_required", "forward_port_target_ref"],
  "forward-port": ["release_fix_commit_sha", "main_base_commit_sha", "review_receipt_sha256", "forward_port_receipt_sha256", "main_result_sha256", "release_first_exception_approved", "reviewed", "main_tests_renewed", "protected_ref_direct_update", "forward_port_branch", "forward_port_target_ref"]
});

function stableJson(value) { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }
export function digest(value) { return createHash("sha256").update(typeof value === "string" ? value : stableJson(value)).digest("hex"); }
export function candidateIdentity(candidate) {
  const fields = candidateManifestFields.map((field) => field === "attempt" ? String(candidate[field]) : candidate[field]);
  // Simple text.len() is the UTF-8 byte length. Buffer.byteLength keeps the
  // shared identity stable even if the creator identity contains Unicode.
  return digest(fields.map((field) => `${Buffer.byteLength(field, "utf8")}:${field}`).join(""));
}
function normalize(value) { return value.toLowerCase().replace(/[`*_#>()[\]{}:;,.!?/\\|+="']/g, " ").replace(/\s+/g, " ").trim(); }
export function releaseContractHash() { return digest({ schemas: releaseSchemas, capabilities: releaseCapabilities, operations: releaseOperations, projection: releaseProjectionContract }); }
export function projectionSemantics(content) { const normalized = normalize(content); return releaseProjectionContract.filter(([, statement]) => normalized.includes(normalize(statement))).map(([id, statement]) => [id, normalize(statement)]); }
export function projectionSemanticHash(content) { const semantics = projectionSemantics(content); if (semantics.length !== releaseProjectionContract.length) { const found = new Set(semantics.map(([id]) => id)); const missing = releaseProjectionContract.map(([id]) => id).filter((id) => !found.has(id)); throw new Error(`release projection is missing normalized contract clauses: ${missing.join(", ")}`); } return digest(semantics); }
export function canonicalProjectionSemanticHash() { return digest(releaseProjectionContract.map(([id, statement]) => [id, normalize(statement)])); }
export function assertExactReleaseFields(operation, input) { const allowed = releaseOperations[operation]; if (!allowed) throw new Error(`unknown release planning operation: ${operation}`); const unknown = Object.keys(input).filter((key) => !allowed.includes(key)).sort(); if (unknown.length) throw new Error(`${operation} contains unknown fields: ${unknown.join(", ")}`); const missing = allowed.filter((key) => !Object.hasOwn(input, key)); if (missing.length) throw new Error(`${operation} is missing fields: ${missing.join(", ")}`); }
