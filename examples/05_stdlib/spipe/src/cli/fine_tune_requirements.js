import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readlinkSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
import { initRegistry, quoteSdn, validateAttemptId } from "./fine_tune_common.js";
import { commandFineTuneRecordRequirements } from "./fine_tune_setup.js";
const featureOptionsRel = "doc/02_requirements/feature/spipe_llm_finetune_process_options.md";
const nfrOptionsRel = "doc/02_requirements/nfr/spipe_llm_finetune_process_options.md";
const featureRequirementsRel = "doc/02_requirements/feature/spipe_llm_finetune_process.md";
const nfrRequirementsRel = "doc/02_requirements/nfr/spipe_llm_finetune_process.md";

function normalizeOption(value) {
  const match = String(value || "").trim().match(/(?:option[-_\s]*)?([A-Za-z])$/i);
  return match ? match[1].toUpperCase() : "";
}

function normalizeOptionList(value) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  const matches = [...raw.matchAll(/[A-Za-z]/g)].map((match) => match[0].toUpperCase());
  return [...new Set(matches)];
}

function optionHeadings(path) {
  if (!existsSync(path)) return [];
  const content = readFileSync(path, "utf8");
  return [...content.matchAll(/^## Option ([A-Z]):\s*(.+)$/gm)].map((match) => ({
    letter: match[1],
    title: match[2].trim()
  }));
}

function selectedOptionBlock(path, option) {
  if (!existsSync(path)) return null;
  const content = readFileSync(path, "utf8");
  const letter = normalizeOption(option);
  const header = new RegExp(`^## Option ${letter}:\\s*(.+)$`, "m");
  const match = content.match(header);
  if (!match || match.index === undefined) return null;
  const rest = content.slice(match.index);
  const next = rest.slice(match[0].length).search(/\n## (Option [A-Z]:|Selection Needed)/);
  const block = next === -1 ? rest : rest.slice(0, match[0].length + next);
  return {
    letter,
    title: match[1].trim(),
    block: block.trimEnd()
  };
}

function selectedOptionBlocks(path, options) {
  const letters = normalizeOptionList(options);
  return letters.map((letter) => selectedOptionBlock(path, letter));
}

function commandFineTuneOptions() {
  const hostRoot = process.cwd();
  const featurePath = join(hostRoot, featureOptionsRel);
  const nfrPath = join(hostRoot, nfrOptionsRel);
  console.log("feature_options:");
  for (const option of optionHeadings(featurePath)) {
    console.log(`  ${option.letter}: ${option.title}`);
  }
  console.log("nfr_options:");
  for (const option of optionHeadings(nfrPath)) {
    console.log(`  ${option.letter}: ${option.title}`);
  }
}

function writeSelectedDoc(path, title, sourceRel, selectedItems, selectedBy, notes) {
  mkdirSync(dirname(path), { recursive: true });
  const selected = Array.isArray(selectedItems) ? selectedItems : [selectedItems];
  const selectedLine = selected.map((item) => `Option ${item.letter}: ${item.title}`).join(" -> ");
  const body = selected.map((item) => item.block).join("\n\n");
  writeFileSync(path, `# ${title}

Selected option: ${selectedLine}
Selected by: ${selectedBy}
Source options: ${sourceRel}
Notes: ${notes || ""}

${body}
`);
}

function commandFineTuneSelectRequirements(args) {
  const [attemptId, featureOptionArg, nfrOptionArg, selectedBy, notes = ""] = args;
  if (!attemptId || !featureOptionArg || !nfrOptionArg || !selectedBy) {
    console.error("spipe fine-tune-select-requirements: attempt_id, feature_option, nfr_option, and selected_by are required");
    process.exitCode = 2;
    return;
  }
  if (!validateAttemptId("fine-tune-select-requirements", attemptId)) return;

  const hostRoot = process.cwd();
  const featureOptionsPath = join(hostRoot, featureOptionsRel);
  const nfrOptionsPath = join(hostRoot, nfrOptionsRel);
  const featureSelected = selectedOptionBlocks(featureOptionsPath, featureOptionArg);
  const nfrSelected = selectedOptionBlocks(nfrOptionsPath, nfrOptionArg);
  if (!featureSelected.length || featureSelected.some((item) => !item)) {
    console.error(`spipe fine-tune-select-requirements: feature option not found: ${featureOptionArg}`);
    process.exitCode = 1;
    return;
  }
  if (!nfrSelected.length || nfrSelected.some((item) => !item)) {
    console.error(`spipe fine-tune-select-requirements: nfr option not found: ${nfrOptionArg}`);
    process.exitCode = 1;
    return;
  }

  writeSelectedDoc(join(hostRoot, featureRequirementsRel), "SPipe LLM Fine-Tune Process Requirements", featureOptionsRel, featureSelected, selectedBy, notes);
  writeSelectedDoc(join(hostRoot, nfrRequirementsRel), "SPipe LLM Fine-Tune Process NFR Requirements", nfrOptionsRel, nfrSelected, selectedBy, notes);
  rmSync(featureOptionsPath, { force: true });
  rmSync(nfrOptionsPath, { force: true });
  commandFineTuneRecordRequirements([
    attemptId,
    featureSelected.map((item) => `Option ${item.letter}`).join(" -> "),
    nfrSelected.map((item) => `Option ${item.letter}`).join(" + "),
    selectedBy,
    featureRequirementsRel,
    notes
  ]);
  console.log(featureRequirementsRel);
  console.log(nfrRequirementsRel);
}

function commandFineTuneRecordApp(args) {
  const [attemptId, appTarget, usage, handoffDoc, licenseConstraints, safetyEval, deploymentEvidence] = args;
  if (!attemptId || !appTarget || !usage || !handoffDoc || !licenseConstraints || !safetyEval || !deploymentEvidence) {
    console.error("spipe fine-tune-record-app: attempt_id, app_target, usage, handoff_doc, license_constraints, safety_eval, and deployment_evidence are required");
    process.exitCode = 2;
    return;
  }
  if (!validateAttemptId("fine-tune-record-app", attemptId)) return;
  const root = join(process.cwd(), ".spipe/llm-finetune-process");
  const registryPath = initRegistry(root, "app_handoffs.sdn", "# LLM-backed app/server handoff evidence for SPipe fine-tune attempts.", "app_handoffs");
  appendFileSync(registryPath, `  - attempt_id: "${quoteSdn(attemptId)}"
    app_target: "${quoteSdn(appTarget)}"
    usage: "${quoteSdn(usage)}"
    handoff_doc: "${quoteSdn(handoffDoc)}"
    license_constraints: "${quoteSdn(licenseConstraints)}"
    safety_eval: "${quoteSdn(safetyEval)}"
    deployment_evidence: "${quoteSdn(deploymentEvidence)}"
`);
  console.log(registryPath);
}

export function commandFineTuneRecordRetune(args) {
  const [attemptId, reason, sourceEval, nextAttempt, retryTarget] = args;
  if (!attemptId || !reason || !sourceEval || !nextAttempt || !retryTarget) {
    console.error("spipe fine-tune-record-retune: attempt_id, reason, source_eval, next_attempt, and retry_target are required");
    process.exitCode = 2;
    return;
  }
  if (!validateAttemptId("fine-tune-record-retune", attemptId)) return;
  const root = join(process.cwd(), ".spipe/llm-finetune-process");
  const registryPath = initRegistry(root, "retune_requests.sdn", "# Retune request evidence for SPipe LLM-backed app/server loops.", "retune_requests");
  appendFileSync(registryPath, `  - attempt_id: "${quoteSdn(attemptId)}"
    reason: "${quoteSdn(reason)}"
    source_eval: "${quoteSdn(sourceEval)}"
    next_attempt: "${quoteSdn(nextAttempt)}"
    retry_target: "${quoteSdn(retryTarget)}"
`);
  console.log(registryPath);
}

export function runFineTuneRequirements(command, args = []) {
  switch (command) {
    case "fine-tune-options": commandFineTuneOptions(); break;
    case "fine-tune-select-requirements": commandFineTuneSelectRequirements(args); break;
    case "fine-tune-record-app": commandFineTuneRecordApp(args); break;
    case "fine-tune-record-retune": commandFineTuneRecordRetune(args); break;
    default: return false;
  }
  return true;
}
