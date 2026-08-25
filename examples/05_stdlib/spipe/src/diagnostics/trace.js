import { createHash } from "node:crypto";

import { isTrustedAuthorizationPort } from "../core/authorization.js";
import { canonicalJson } from "../storage/canonical.js";
import { deepFreeze } from "../model/identity.js";
import { createDiagnosticRecord } from "./record.js";

function item(code, messageKey, args = {}, severity = "error", context = {}) {
  return createDiagnosticRecord({
    code, severity, message_key: messageKey, arguments: args,
    project_uid: context.project_uid ?? null, revision_id: context.revision_id ?? null,
    snapshot_uid: context.snapshot_uid ?? null, artifact_uid: context.artifact_uid ?? args.artifact_uid ?? null,
    source_span: context.source_span ?? null, related_uids: [...new Set(context.related_uids ?? [])].sort(),
    remediation: context.remediation ?? null, cause_chain: [...(context.cause_chain ?? [])],
  });
}

function key(value) {
  return `${value.code}\0${JSON.stringify(value.arguments)}`;
}

function sorted(values) {
  return [...values].sort((left, right) => key(left).localeCompare(key(right)));
}

function acceptanceSubjectHash(edge) {
  const subject = { ...edge, provenance: { ...edge.provenance } };
  delete subject.status;
  delete subject.authority;
  delete subject.provenance.decision_uid;
  return `sha256:${createHash("sha256").update(Buffer.concat([
    Buffer.from("spipe-edge-accept-v1\0", "utf8"), Buffer.from(canonicalJson(subject), "utf8"),
  ])).digest("hex")}`;
}

function receiptFor(options, uid) {
  const receipts = options.authorizationReceipts;
  if (typeof receipts === "function") return receipts(uid);
  if (receipts instanceof Map) return receipts.get(uid);
  return receipts?.[uid];
}

function verifiedAuthority(edge, options) {
  const port = options.authorizationPort;
  if (!isTrustedAuthorizationPort(port) || typeof port.verifyEdgeAcceptanceReceipt !== "function") return false;
  if (!edge.authority || edge.provenance?.decision_uid !== edge.authority.receipt_uid) return false;
  const receipt = receiptFor(options, edge.authority.receipt_uid);
  if (!receipt) return false;
  const capability = edge.origin === "explicit" ? "trace.accept.explicit" : "trace.accept.generated";
  const expected = {
    edge_uid: edge.uid, acceptance_subject_hash: acceptanceSubjectHash(edge),
    from_uid: edge.from_uid, to_uid: edge.to_uid, origin: edge.origin, status: "accepted",
    project_uid: edge.provenance.project_uid, worktree_uid: edge.provenance.worktree_uid,
    input_snapshot_uid: edge.provenance.input_snapshot_uid,
    policy_hash: edge.authority.policy_hash, policy_version: edge.authority.policy_version,
    capability,
  };
  return Boolean(port.verifyEdgeAcceptanceReceipt(receipt, expected));
}

function accepted(edge, profile, options) {
  if (edge.status !== "accepted" || !["explicit", "generated"].includes(edge.origin)) return false;
  if (["standard", "strict", "mission_critical"].includes(profile)) return verifiedAuthority(edge, options);
  return true;
}

function canonicalPath(path) {
  const parts = [];
  for (const part of String(path).replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop(); else parts.push(part);
  }
  return parts.join("/");
}

function resolveRelative(base, target) {
  if (target.startsWith("/")) return null;
  const directory = base.split("/").slice(0, -1).join("/");
  return canonicalPath(`${directory}/${target}`);
}

function resolveLink(link, index) {
  const raw = link.target_ref;
  const sourceArtifact = index.artifactByUid.get(link.source_location.source_artifact_uid);
  const uri = /^spipe:\/\/project\/([^/]+)\/(?:artifact|section)\/([^/?#]+)/.exec(raw);
  if (uri) {
    const project = index.projectByUid.get(uri[1]);
    if (!project || project.status === "unavailable" || (project.revision && project.revision !== index.revisionByProject.get(uri[1]))) {
      return { code: "SPK103", details: { target: raw, project_uid: uri[1] } };
    }
    return index.nodeByUid.has(uri[2]) ? { uid: uri[2] } : { code: uri[2].startsWith("S-") ? "SPK102" : "SPK101", details: { target: raw } };
  }
  if (raw.startsWith("#")) {
    const fragment = decodeURIComponent(raw.slice(1));
    const section = index.sections.find((entry) => entry.artifact_uid === sourceArtifact?.uid &&
      (entry.uid === fragment || entry.key === fragment || (entry.aliases ?? []).includes(fragment)));
    return section ? { uid: section.uid } : { code: "SPK102", details: { target: raw, artifact_uid: sourceArtifact?.uid } };
  }
  const [pathPart, fragment] = raw.split("#", 2);
  const path = resolveRelative(sourceArtifact?.canonical_path ?? "", pathPart);
  const artifact = index.artifactByPath.get(`${sourceArtifact?.project_uid}\0${path}`);
  if (!artifact) return { code: "SPK101", details: { target: raw, resolved_path: path } };
  if (!fragment) return { uid: artifact.uid };
  const section = index.sections.find((entry) => entry.artifact_uid === artifact.uid &&
    (entry.uid === fragment || entry.key === fragment || (entry.aliases ?? []).includes(fragment)));
  return section ? { uid: section.uid } : { code: "SPK102", details: { target: raw, artifact_uid: artifact.uid } };
}

function buildIndex(data) {
  const artifacts = data.artifacts ?? [];
  const sections = data.sections ?? [];
  const projects = data.projects ?? [];
  const nodes = [...artifacts, ...sections, ...(data.requirements ?? []), ...(data.scenarios ?? []), ...(data.tests ?? []), ...(data.symbols ?? [])];
  return {
    artifacts, sections,
    artifactByUid: new Map(artifacts.map((entry) => [entry.uid, entry])),
    artifactByPath: new Map(artifacts.map((entry) => [`${entry.project_uid}\0${entry.canonical_path}`, entry])),
    nodeByUid: new Map(nodes.map((entry) => [entry.uid, entry])),
    projectByUid: new Map(projects.map((entry) => [entry.uid, entry])),
    revisionByProject: new Map(artifacts.map((entry) => [entry.project_uid, entry.revision])),
  };
}

/** Resolve explicit links and report trace obligations without guessing by local title/name. */
export function diagnoseTrace(data, options = {}) {
  const profile = options.profile ?? "standard";
  const index = buildIndex(data);
  const diagnostics = [...(data.diagnostics ?? [])];
  const resolvedLinks = [];
  for (const link of data.links ?? []) {
    const resolution = resolveLink(link, index);
    if (resolution.code) diagnostics.push(item(resolution.code,
      resolution.code === "SPK101" ? "link.broken_artifact" : resolution.code === "SPK102" ? "link.broken_section" : "link.project_unavailable",
      { ...resolution.details, from_uid: link.from_uid }));
    else resolvedLinks.push({ ...link, to_uid: resolution.uid });
  }

  const edges = (data.edges ?? []).filter((edge) => accepted(edge, profile, options));
  const artifacts = new Map((data.artifacts ?? []).map((entry) => [entry.uid, entry]));
  const scenarios = new Map((data.scenarios ?? []).map((entry) => [entry.uid, entry]));
  const tests = new Map((data.tests ?? []).map((entry) => [entry.uid, entry]));
  for (const requirement of data.requirements ?? []) {
    const incoming = edges.filter((edge) => edge.to_uid === requirement.uid);
    const design = incoming.some((edge) => ["satisfies", "realizes"].includes(edge.edge_type) && ["design", "architecture"].includes(artifacts.get(edge.from_uid)?.kind));
    const spec = incoming.some((edge) => edge.edge_type === "specifies" && scenarios.has(edge.from_uid));
    const unit = incoming.some((edge) => edge.edge_type === "verifies" && tests.get(edge.from_uid)?.test_kind === "unit");
    const integration = incoming.some((edge) => edge.edge_type === "verifies" && ["integration", "system"].includes(tests.get(edge.from_uid)?.test_kind));
    if (!design) diagnostics.push(item("SPK201", "trace.requirement_missing_design", { requirement_uid: requirement.uid }));
    if (!spec) diagnostics.push(item("SPK202", "trace.requirement_missing_sspec", { requirement_uid: requirement.uid }));
    if (!unit) diagnostics.push(item("SPK203", "trace.requirement_missing_unit_test", { requirement_uid: requirement.uid }));
    if (!integration) diagnostics.push(item("SPK204", "trace.requirement_missing_integration_or_system_test", { requirement_uid: requirement.uid }));
  }
  return deepFreeze({ diagnostics: sorted(diagnostics), resolved_links: resolvedLinks.sort((a, b) => `${a.from_uid}\0${a.to_uid}`.localeCompare(`${b.from_uid}\0${b.to_uid}`)) });
}

/** Deterministic requirement-centric matrix input; presentation remains a view concern. */
export function buildTraceMatrix(data, options = {}) {
  const profile = options.profile ?? "standard";
  const edges = (data.edges ?? []).filter((edge) => accepted(edge, profile, options));
  const artifacts = new Map((data.artifacts ?? []).map((entry) => [entry.uid, entry]));
  const scenarios = new Set((data.scenarios ?? []).map((entry) => entry.uid));
  const symbols = new Set((data.symbols ?? []).map((entry) => entry.uid));
  const tests = new Map((data.tests ?? []).map((entry) => [entry.uid, entry]));
  const rows = (data.requirements ?? []).map((requirement) => {
    const incoming = edges.filter((edge) => edge.to_uid === requirement.uid);
    const collect = (predicate) => incoming.filter(predicate).map((edge) => edge.from_uid).sort();
    return {
      requirement_uid: requirement.uid, display_id: requirement.display_id,
      design_uids: collect((edge) => ["satisfies", "realizes"].includes(edge.edge_type) && ["design", "architecture"].includes(artifacts.get(edge.from_uid)?.kind)),
      scenario_uids: collect((edge) => edge.edge_type === "specifies" && scenarios.has(edge.from_uid)),
      symbol_uids: collect((edge) => edge.edge_type === "implements" && symbols.has(edge.from_uid)),
      unit_test_uids: collect((edge) => edge.edge_type === "verifies" && tests.get(edge.from_uid)?.test_kind === "unit"),
      integration_test_uids: collect((edge) => edge.edge_type === "verifies" && ["integration", "system"].includes(tests.get(edge.from_uid)?.test_kind)),
    };
  }).sort((left, right) => left.requirement_uid.localeCompare(right.requirement_uid));
  return deepFreeze({ profile, rows });
}

function expectedManual(specPath) {
  if (!specPath.startsWith("test/") || !specPath.endsWith("_spec.spl")) return null;
  return `doc/06_spec/${specPath.slice(5, -4)}.md`;
}

/** Preserve the legacy mirrored SSpec/manual four-state projection. */
export function projectMirroredSpecDiagnostics(specPaths, manualPaths) {
  const manuals = new Set(manualPaths.map(canonicalPath));
  const diagnostics = [];
  for (const original of [...specPaths].sort()) {
    const spec = canonicalPath(original);
    const expected = expectedManual(spec);
    if (!expected) continue;
    const basename = expected.split("/").at(-1);
    const wrong = [...manuals].sort().find((path) => path !== expected && path.split("/").at(-1) === basename);
    if (!manuals.has(expected)) diagnostics.push(item("TRC231", "spec.missing_mirrored_manual", { path: spec, expected_path: expected }, "warning"));
    if (wrong) diagnostics.push(item("TRC232", "spec.manual_path_mismatch", { path: wrong, source_path: spec, expected_path: expected }, "warning"));
  }
  return deepFreeze(sorted(diagnostics));
}
