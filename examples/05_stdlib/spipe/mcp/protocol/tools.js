import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { releaseCapabilities, releaseContractHash, releaseOperations, releaseSchemas } from "../../src/release/contract.js";
import { createReleasePlan } from "../../src/release/planner.js";

const booleanFields = new Set(["read_only_snapshot", "main_is_independent_trunk", "forward_port_required", "release_first_exception_approved", "reviewed", "main_tests_renewed", "protected_ref_direct_update", "signed_tag", "annotated_tag", "exact_tag_push", "rebuild", "fallback_artifact", "release_authority_approved"]);
const integerFields = new Set(["attempt", "candidate_attempt", "interval_seconds", "last_scan_epoch", "now_epoch"]);
const arrayFields = new Set(["candidates", "selected_commit_shas"]);
function releasePlanSchema(operation) {
  const fields = releaseOperations[operation];
  return {
    type: "object",
    description: `Exact ${operation} planning facts. Unknown, missing, or malformed authority evidence is rejected.`,
    properties: Object.fromEntries(fields.map((field) => [field, { type: booleanFields.has(field) ? "boolean" : integerFields.has(field) ? "integer" : arrayFields.has(field) ? "array" : "string" }])),
    required: [...fields],
    additionalProperties: false
  };
}

export const tools = Object.freeze([
  { name: "spipe_info", description: "Return SPipe module paths and link surfaces.", inputSchema: { type: "object", properties: {} } },
  { name: "spipe_experts", description: "List project, domain, and tool experts packaged with SPipe.", inputSchema: { type: "object", properties: {} } },
  {
    name: "spipe_read_doc",
    description: "Read a whitelisted SPipe document by relative path.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Relative path under the SPipe module." } },
      required: ["path"]
    }
  },
  { name: "spipe_fine_tune_guide", description: "Read the SPipe LLM fine-tune process guide.", inputSchema: { type: "object", properties: {} } },
  { name: "spipe_fine_tune_model_guide", description: "Read the SPipe LLM model research and architecture guide.", inputSchema: { type: "object", properties: {} } },
  { name: "spipe_fine_tune_template", description: "Read the SPipe LLM fine-tune attempt record template.", inputSchema: { type: "object", properties: {} } },
  { name: "spipe_release_guide", description: "Read the canonical protected software-release and beta-backport guide.", inputSchema: { type: "object", properties: {} } },
  { name: "spipe_release_capabilities", description: "Return declared release/session/candidate schemas and safe planning capabilities.", inputSchema: { type: "object", properties: {} } },
  { name: "spipe_release_session_plan", description: "Validate and plan an isolated release session. Performs no workspace or ref mutation.", inputSchema: releasePlanSchema("isolated-session") },
  { name: "spipe_release_beta_backport_plan", description: "Validate one exact reviewed caller-selected beta bug-fix backport. Performs no cherry-pick.", inputSchema: releasePlanSchema("beta-backport") },
  { name: "spipe_release_candidate_plan", description: "Validate an immutable build-once candidate plan. Performs no candidate creation or build.", inputSchema: releasePlanSchema("candidate") },
  { name: "spipe_release_promotion_plan", description: "Validate exact admitted promotion inputs. Performs no tag, push, delete, rebuild, or publication.", inputSchema: releasePlanSchema("promotion") },
  { name: "spipe_release_main_fix_discovery_plan", description: "Check supplied immutable snapshots for reviewed bug-fix candidates. Never selects or cherry-picks a fix.", inputSchema: releasePlanSchema("main-fix-discovery") },
  { name: "spipe_release_forward_port_plan", description: "Validate an isolated main forward-port for an approved release-first fix. Never pushes a protected ref.", inputSchema: releasePlanSchema("forward-port") }
]);

function text(content) {
  return { content: [{ type: "text", text: content }] };
}

function listDirs(moduleRoot, root) {
  const abs = join(moduleRoot, root);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function readDoc(moduleRoot, path) {
  if (!path || path.includes("..") || path.startsWith("/") || path.startsWith("\\")) {
    throw new Error("path must be a relative path inside the SPipe module");
  }
  const allowed = [
    "README.md",
    "doc/00_llm_process/spipe/",
    "doc/00_llm_process/project_expert/",
    "doc/00_llm_process/domain_expert/",
    "doc/00_llm_process/tool_expert/",
    "doc/00_llm_process/template/"
  ];
  if (!allowed.some((prefix) => path === prefix || path.startsWith(prefix))) {
    throw new Error("path is outside the SPipe documentation allowlist");
  }
  const abs = join(moduleRoot, path);
  if (!existsSync(abs)) throw new Error(`document not found: ${path}`);
  return readFileSync(abs, "utf8");
}

export function callTool(moduleRoot, name, args = {}) {
  if (name === "spipe_info") {
    return text([
      `module=${moduleRoot}`,
      "surface=doc/00_llm_process/skill_command",
      "surface=doc/00_llm_process/spipe",
      "surface=doc/00_llm_process/template",
      "surface=doc/00_llm_process/project_expert",
      "surface=doc/00_llm_process/domain_expert",
      "surface=doc/00_llm_process/tool_expert"
    ].join("\n"));
  }
  if (name === "spipe_experts") {
    return text([
      `project_expert=${listDirs(moduleRoot, "doc/00_llm_process/project_expert").join(",")}`,
      `domain_expert=${listDirs(moduleRoot, "doc/00_llm_process/domain_expert").join(",")}`,
      `tool_expert=${listDirs(moduleRoot, "doc/00_llm_process/tool_expert").join(",")}`
    ].join("\n"));
  }
  if (name === "spipe_read_doc") return text(readDoc(moduleRoot, args.path));
  if (name === "spipe_fine_tune_guide") return text(readDoc(moduleRoot, "doc/00_llm_process/spipe/llm_finetune.md"));
  if (name === "spipe_fine_tune_model_guide") return text(readDoc(moduleRoot, "doc/00_llm_process/spipe/llm_model_research.md"));
  if (name === "spipe_fine_tune_template") return text(readDoc(moduleRoot, "doc/00_llm_process/spipe/llm_finetune_attempt_template.sdn"));
  if (name === "spipe_release_guide") return text(readDoc(moduleRoot, "doc/00_llm_process/skill_command/command/release.md"));
  if (name === "spipe_release_capabilities") return text([
    ...Object.entries(releaseSchemas).map(([key, value]) => `${key}=${value}`),
    ...Object.entries(releaseCapabilities).map(([key, value]) => `${key}=${value}`),
    `contract_sha256=${releaseContractHash()}`
  ].join("\n"));
  const releaseTools = {
    spipe_release_session_plan: "isolated-session",
    spipe_release_beta_backport_plan: "beta-backport",
    spipe_release_candidate_plan: "candidate",
    spipe_release_promotion_plan: "promotion",
    spipe_release_main_fix_discovery_plan: "main-fix-discovery",
    spipe_release_forward_port_plan: "forward-port"
  };
  if (releaseTools[name]) return text(JSON.stringify(createReleasePlan(releaseTools[name], args), null, 2));
  throw new Error(`unknown tool: ${name}`);
}
