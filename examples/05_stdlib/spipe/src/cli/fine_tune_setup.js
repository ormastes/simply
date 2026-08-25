import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readlinkSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { registryBlockForAttempt } from "./fine_tune_common.js";

const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function readQuotedValue(content, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...content.matchAll(new RegExp(`^\\s*${escaped}:\\s*"([^"]*)"\\s*$`, "gm"))];
  return matches.length ? matches[matches.length - 1][1] : "";
}

function commandFineTuneGuide() {
  const path = join(moduleRoot, "doc/00_llm_process/spipe/llm_finetune.md");
  process.stdout.write(readFileSync(path, "utf8"));
}

function commandFineTuneModelGuide() {
  const path = join(moduleRoot, "doc/00_llm_process/spipe/llm_model_research.md");
  process.stdout.write(readFileSync(path, "utf8"));
}

function commandFineTuneTemplate() {
  const path = join(moduleRoot, "doc/00_llm_process/spipe/llm_finetune_attempt_template.sdn");
  process.stdout.write(readFileSync(path, "utf8"));
}

function writeIfMissing(path, content) {
  if (!existsSync(path)) {
    writeFileSync(path, content);
  }
}

function commandFineTuneInit() {
  const root = join(process.cwd(), ".spipe/llm-finetune-process");
  const attemptsDir = join(root, "attempts");
  const scriptsDir = join(root, "scripts");
  mkdirSync(attemptsDir, { recursive: true });
  mkdirSync(scriptsDir, { recursive: true });

  const template = readFileSync(join(moduleRoot, "doc/00_llm_process/spipe/llm_finetune_attempt_template.sdn"), "utf8");
  writeIfMissing(join(attemptsDir, "template.sdn"), template);
  writeIfMissing(join(root, "attempts.sdn"), "# Attempt index for SPipe LLM fine-tune process.\n\nattempts: []\n");
  writeIfMissing(join(root, "data_downloads.sdn"), "# Data download evidence for SPipe LLM fine-tune attempts.\n\ndata_downloads:\n");
  writeIfMissing(join(root, "data_checks.sdn"), "# Data cache/checksum verification evidence for SPipe LLM fine-tune attempts.\n\ndata_checks:\n");
  writeIfMissing(join(root, "process_docs.sdn"), "# Pipeline document trace for SPipe LLM fine-tune attempts.\n\nprocess_docs:\n");
  writeIfMissing(join(root, "requirements_selection.sdn"), "# Requirement option selection evidence for SPipe LLM fine-tune attempts.\n\nrequirements_selection:\n");
  writeIfMissing(join(root, "model_research.sdn"), "# Candidate model research evidence for SPipe LLM fine-tune attempts.\n\nmodel_research:\n");
  writeIfMissing(join(root, "model_architecture.sdn"), "# New-model architecture evidence for SPipe LLM fine-tune attempts.\n\nmodel_architecture:\n");
  writeIfMissing(join(root, "tuning_methods.sdn"), "# Tuning-method selection evidence for SPipe LLM fine-tune attempts.\n\ntuning_methods:\n");
  writeIfMissing(join(root, "models.sdn"), "# Model selection evidence for SPipe LLM fine-tune attempts.\n\nmodels:\n");
  writeIfMissing(join(root, "training_scripts.sdn"), "# Training script evidence for SPipe LLM fine-tune attempts.\n\ntraining_scripts:\n");
  writeIfMissing(join(root, "eval_results.sdn"), "# Evaluation evidence for SPipe LLM fine-tune attempts.\n\neval_results:\n");
  writeIfMissing(join(root, "decisions.sdn"), "# Verification decision evidence for SPipe LLM fine-tune attempts.\n\ndecisions:\n");
  writeIfMissing(join(root, "app_handoffs.sdn"), "# LLM-backed app/server handoff evidence for SPipe fine-tune attempts.\n\napp_handoffs:\n");
  writeIfMissing(join(root, "retune_requests.sdn"), "# Retune request evidence for SPipe LLM-backed app/server loops.\n\nretune_requests:\n");
  console.log(`fine_tune_init=ok ${root}`);
}

function quoteSdn(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function quoteShell(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export function commandFineTuneNewAttempt(args) {
  const [attemptId, goal, target = ""] = args;
  if (!attemptId || !goal) {
    console.error("spipe fine-tune-new-attempt: attempt_id and goal are required");
    process.exitCode = 2;
    return;
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(attemptId)) {
    console.error("spipe fine-tune-new-attempt: attempt_id may contain only letters, numbers, dot, dash, and underscore");
    process.exitCode = 2;
    return;
  }

  const hostRoot = process.cwd();
  const attemptsDir = join(hostRoot, ".spipe/llm-finetune-process/attempts");
  const outPath = join(attemptsDir, `${attemptId}.sdn`);
  if (existsSync(outPath)) {
    console.error(`spipe fine-tune-new-attempt: attempt already exists: ${outPath}`);
    process.exitCode = 1;
    return;
  }

  mkdirSync(attemptsDir, { recursive: true });
  let content = readFileSync(join(moduleRoot, "doc/00_llm_process/spipe/llm_finetune_attempt_template.sdn"), "utf8");
  content = content
    .replace('  attempt_id: ""', `  attempt_id: "${quoteSdn(attemptId)}"`)
    .replace('  goal: ""', `  goal: "${quoteSdn(goal)}"`)
    .replace('  app_or_server_target: ""', `  app_or_server_target: "${quoteSdn(target)}"`);
  writeFileSync(outPath, content);
  console.log(outPath);
}

function commandFineTuneRecordData(args) {
  const [attemptId, name, source, license, downloadCommand, cachePath, checksum = ""] = args;
  if (!attemptId || !name || !source || !license || !downloadCommand || !cachePath) {
    console.error("spipe fine-tune-record-data: attempt_id, name, source, license, download_command, and cache_path are required");
    process.exitCode = 2;
    return;
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(attemptId)) {
    console.error("spipe fine-tune-record-data: attempt_id may contain only letters, numbers, dot, dash, and underscore");
    process.exitCode = 2;
    return;
  }

  const hostRoot = process.cwd();
  const root = join(hostRoot, ".spipe/llm-finetune-process");
  const registryPath = join(root, "data_downloads.sdn");
  mkdirSync(root, { recursive: true });
  if (!existsSync(registryPath)) {
    writeFileSync(registryPath, "# Data download evidence for SPipe LLM fine-tune attempts.\n\ndata_downloads:\n");
  }

  appendFileSync(registryPath, `  - attempt_id: "${quoteSdn(attemptId)}"
    name: "${quoteSdn(name)}"
    source: "${quoteSdn(source)}"
    license: "${quoteSdn(license)}"
    download_command: "${quoteSdn(downloadCommand)}"
    cache_path: "${quoteSdn(cachePath)}"
    checksum: "${quoteSdn(checksum)}"
`);
  console.log(registryPath);
}

function commandFineTuneRecordDataCheck(args) {
  const [attemptId, name, cachePath, result, checksum = "", notes = ""] = args;
  if (!attemptId || !name || !cachePath || !result) {
    console.error("spipe fine-tune-record-data-check: attempt_id, name, cache_path, and result are required");
    process.exitCode = 2;
    return;
  }
  if (!validateAttemptId("fine-tune-record-data-check", attemptId)) return;
  const root = join(process.cwd(), ".spipe/llm-finetune-process");
  const registryPath = initRegistry(root, "data_checks.sdn", "# Data cache/checksum verification evidence for SPipe LLM fine-tune attempts.", "data_checks");
  appendFileSync(registryPath, `  - attempt_id: "${quoteSdn(attemptId)}"
    name: "${quoteSdn(name)}"
    cache_path: "${quoteSdn(cachePath)}"
    result: "${quoteSdn(result)}"
    checksum: "${quoteSdn(checksum)}"
    notes: "${quoteSdn(notes)}"
`);
  console.log(registryPath);
}

function initRegistry(root, fileName, header, rootKey) {
  const registryPath = join(root, fileName);
  mkdirSync(root, { recursive: true });
  if (!existsSync(registryPath)) {
    writeFileSync(registryPath, `${header}\n\n${rootKey}:\n`);
  }
  return registryPath;
}

function commandFineTuneRecordModel(args) {
  const [attemptId, baseModel, revision, reason, deploymentTarget] = args;
  if (!attemptId || !baseModel || !revision || !reason || !deploymentTarget) {
    console.error("spipe fine-tune-record-model: attempt_id, base_model, revision, reason, and deployment_target are required");
    process.exitCode = 2;
    return;
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(attemptId)) {
    console.error("spipe fine-tune-record-model: attempt_id may contain only letters, numbers, dot, dash, and underscore");
    process.exitCode = 2;
    return;
  }
  const root = join(process.cwd(), ".spipe/llm-finetune-process");
  const registryPath = initRegistry(root, "models.sdn", "# Model selection evidence for SPipe LLM fine-tune attempts.", "models");
  appendFileSync(registryPath, `  - attempt_id: "${quoteSdn(attemptId)}"
    base_model: "${quoteSdn(baseModel)}"
    revision: "${quoteSdn(revision)}"
    reason: "${quoteSdn(reason)}"
    deployment_target: "${quoteSdn(deploymentTarget)}"
`);
  console.log(registryPath);
}

function commandFineTuneRecordModelResearch(args) {
  const [attemptId, candidateModel, license, contextLength, fit, constraints, decision] = args;
  if (!attemptId || !candidateModel || !license || !contextLength || !fit || !constraints || !decision) {
    console.error("spipe fine-tune-record-model-research: attempt_id, candidate_model, license, context_length, fit, constraints, and decision are required");
    process.exitCode = 2;
    return;
  }
  if (!validateAttemptId("fine-tune-record-model-research", attemptId)) return;
  const root = join(process.cwd(), ".spipe/llm-finetune-process");
  const registryPath = initRegistry(root, "model_research.sdn", "# Candidate model research evidence for SPipe LLM fine-tune attempts.", "model_research");
  appendFileSync(registryPath, `  - attempt_id: "${quoteSdn(attemptId)}"
    candidate_model: "${quoteSdn(candidateModel)}"
    license: "${quoteSdn(license)}"
    context_length: "${quoteSdn(contextLength)}"
    fit: "${quoteSdn(fit)}"
    constraints: "${quoteSdn(constraints)}"
    decision: "${quoteSdn(decision)}"
`);
  console.log(registryPath);
}

function commandFineTuneRecordModelArch(args) {
  const [attemptId, architectureDoc, modelFamily, dataStrategy, trainingStrategy, deploymentTarget, fallback] = args;
  if (!attemptId || !architectureDoc || !modelFamily || !dataStrategy || !trainingStrategy || !deploymentTarget || !fallback) {
    console.error("spipe fine-tune-record-model-arch: attempt_id, architecture_doc, model_family, data_strategy, training_strategy, deployment_target, and fallback are required");
    process.exitCode = 2;
    return;
  }
  if (!validateAttemptId("fine-tune-record-model-arch", attemptId)) return;
  const root = join(process.cwd(), ".spipe/llm-finetune-process");
  const registryPath = initRegistry(root, "model_architecture.sdn", "# New-model architecture evidence for SPipe LLM fine-tune attempts.", "model_architecture");
  appendFileSync(registryPath, `  - attempt_id: "${quoteSdn(attemptId)}"
    architecture_doc: "${quoteSdn(architectureDoc)}"
    model_family: "${quoteSdn(modelFamily)}"
    data_strategy: "${quoteSdn(dataStrategy)}"
    training_strategy: "${quoteSdn(trainingStrategy)}"
    deployment_target: "${quoteSdn(deploymentTarget)}"
    fallback: "${quoteSdn(fallback)}"
`);
  console.log(registryPath);
}

function modelArchDocBody(attemptId, modelFamily, dataStrategy, trainingStrategy, deploymentTarget, fallback) {
  return `# SPipe LLM Model Architecture: ${attemptId}

## Attempt

- Attempt ID: ${attemptId}
- Model family: ${modelFamily}
- Deployment target: ${deploymentTarget}

## Data Strategy

${dataStrategy}

## Training Strategy

${trainingStrategy}

## Architecture Notes

- Define tokenizer and context assumptions.
- Define adapter/new-model boundaries.
- Define app/server integration points.
- Define eval metrics that prove the architecture is fit for use.
- Define artifact naming and retention policy.

## Fallback

${fallback}
`;
}

function commandFineTuneScaffoldModelArch(args) {
  const [attemptId, architectureDoc, modelFamily, dataStrategy, trainingStrategy, deploymentTarget, fallback] = args;
  if (!attemptId || !architectureDoc || !modelFamily || !dataStrategy || !trainingStrategy || !deploymentTarget || !fallback) {
    console.error("spipe fine-tune-scaffold-model-arch: attempt_id, architecture_doc, model_family, data_strategy, training_strategy, deployment_target, and fallback are required");
    process.exitCode = 2;
    return;
  }
  if (!validateAttemptId("fine-tune-scaffold-model-arch", attemptId)) return;
  const outPath = resolve(process.cwd(), architectureDoc);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, modelArchDocBody(attemptId, modelFamily, dataStrategy, trainingStrategy, deploymentTarget, fallback));
  commandFineTuneRecordModelArch([attemptId, architectureDoc, modelFamily, dataStrategy, trainingStrategy, deploymentTarget, fallback]);
  console.log(architectureDoc);
}

function commandFineTuneRecordMethod(args) {
  const [attemptId, method, reason, fallback, selectedBy] = args;
  if (!attemptId || !method || !reason || !fallback || !selectedBy) {
    console.error("spipe fine-tune-record-method: attempt_id, method, reason, fallback, and selected_by are required");
    process.exitCode = 2;
    return;
  }
  if (!validateAttemptId("fine-tune-record-method", attemptId)) return;
  const root = join(process.cwd(), ".spipe/llm-finetune-process");
  const registryPath = initRegistry(root, "tuning_methods.sdn", "# Tuning-method selection evidence for SPipe LLM fine-tune attempts.", "tuning_methods");
  appendFileSync(registryPath, `  - attempt_id: "${quoteSdn(attemptId)}"
    method: "${quoteSdn(method)}"
    reason: "${quoteSdn(reason)}"
    fallback: "${quoteSdn(fallback)}"
    selected_by: "${quoteSdn(selectedBy)}"
`);
  console.log(registryPath);
}

const supportedTuningMethods = [
  "retrieval-context-update",
  "prompt-tool-protocol-update",
  "provider-fine-tune",
  "local-lora",
  "local-qlora",
  "full-fine-tune",
  "new-model-architecture"
];

function commandFineTuneModelMethodOptions(args) {
  const [attemptId] = args;
  if (!attemptId) {
    console.error("spipe fine-tune-model-method-options: attempt_id is required");
    process.exitCode = 2;
    return;
  }
  if (!validateAttemptId("fine-tune-model-method-options", attemptId)) return;
  const root = join(process.cwd(), ".spipe/llm-finetune-process");
  console.log("model_candidates:");
  const block = registryBlockForAttempt(root, "model_research.sdn", attemptId);
  console.log(block || "  missing");
  console.log("supported_tuning_methods:");
  for (const method of supportedTuningMethods) {
    console.log(`  ${method}`);
  }
}

function commandFineTuneSelectModelMethod(args) {
  const [attemptId, baseModel, revision, deploymentTarget, method, selectedBy, fallback, reason = "selected during design"] = args;
  if (!attemptId || !baseModel || !revision || !deploymentTarget || !method || !selectedBy || !fallback) {
    console.error("spipe fine-tune-select-model-method: attempt_id, base_model, revision, deployment_target, method, selected_by, and fallback are required");
    process.exitCode = 2;
    return;
  }
  if (!validateAttemptId("fine-tune-select-model-method", attemptId)) return;
  if (!supportedTuningMethods.includes(method)) {
    console.error(`spipe fine-tune-select-model-method: invalid method: ${method}`);
    process.exitCode = 2;
    return;
  }
  commandFineTuneRecordModel([attemptId, baseModel, revision, reason, deploymentTarget]);
  commandFineTuneRecordMethod([attemptId, method, reason, fallback, selectedBy]);
}

function commandFineTuneRecordTraining(args) {
  const [attemptId, method, trainingScript, trainingCommand, modelArtifact] = args;
  if (!attemptId || !method || !trainingScript || !trainingCommand || !modelArtifact) {
    console.error("spipe fine-tune-record-training: attempt_id, method, training_script, training_command, and model_artifact are required");
    process.exitCode = 2;
    return;
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(attemptId)) {
    console.error("spipe fine-tune-record-training: attempt_id may contain only letters, numbers, dot, dash, and underscore");
    process.exitCode = 2;
    return;
  }
  const root = join(process.cwd(), ".spipe/llm-finetune-process");
  const registryPath = initRegistry(root, "training_scripts.sdn", "# Training script evidence for SPipe LLM fine-tune attempts.", "training_scripts");
  appendFileSync(registryPath, `  - attempt_id: "${quoteSdn(attemptId)}"
    method: "${quoteSdn(method)}"
    training_script: "${quoteSdn(trainingScript)}"
    training_command: "${quoteSdn(trainingCommand)}"
    model_artifact: "${quoteSdn(modelArtifact)}"
`);
  console.log(registryPath);
}

function trainingScriptBody(attemptId, method, modelArtifact) {
  return `#!/bin/sh
set -eu

ATTEMPT_ID=${quoteShell(attemptId)}
METHOD=${quoteShell(method)}
MODEL_ARTIFACT=${quoteShell(modelArtifact)}

cat <<'MSG'
SPipe training scaffold.
Replace this script with the selected trainer/provider command after requirements,
model, method, data, and evaluation targets are finalized.
MSG

printf 'attempt_id=%s\\n' "$ATTEMPT_ID"
printf 'method=%s\\n' "$METHOD"
printf 'model_artifact=%s\\n' "$MODEL_ARTIFACT"
`;
}

function commandFineTuneScaffoldTraining(args) {
  const [attemptId, method, scriptPath, modelArtifact = "not-created"] = args;
  if (!attemptId || !method || !scriptPath) {
    console.error("spipe fine-tune-scaffold-training: attempt_id, method, and script_path are required");
    process.exitCode = 2;
    return;
  }
  if (!validateAttemptId("fine-tune-scaffold-training", attemptId)) return;
  if (!supportedTuningMethods.includes(method) && method !== "dry-run-record-only") {
    console.error(`spipe fine-tune-scaffold-training: invalid method: ${method}`);
    process.exitCode = 2;
    return;
  }
  const outPath = resolve(process.cwd(), scriptPath);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, trainingScriptBody(attemptId, method, modelArtifact));
  chmodSync(outPath, 0o755);
  commandFineTuneRecordTraining([attemptId, method, scriptPath, `${scriptPath}`, modelArtifact]);
}

const retryStatuses = new Set([
  "retry-implementation",
  "retry-data-research",
  "retry-base-model",
  "retry-tuning-method",
  "try-other-way"
]);

function validateAttemptId(commandName, attemptId) {
  if (!/^[A-Za-z0-9_.-]+$/.test(attemptId)) {
    console.error(`spipe ${commandName}: attempt_id may contain only letters, numbers, dot, dash, and underscore`);
    process.exitCode = 2;
    return false;
  }
  return true;
}

function commandFineTuneRecordEval(args) {
  const [attemptId, evalCommand, metrics, target, result] = args;
  if (!attemptId || !evalCommand || !metrics || !target || !result) {
    console.error("spipe fine-tune-record-eval: attempt_id, eval_command, metrics, target, and result are required");
    process.exitCode = 2;
    return;
  }
  if (!validateAttemptId("fine-tune-record-eval", attemptId)) return;
  const root = join(process.cwd(), ".spipe/llm-finetune-process");
  const registryPath = initRegistry(root, "eval_results.sdn", "# Evaluation evidence for SPipe LLM fine-tune attempts.", "eval_results");
  appendFileSync(registryPath, `  - attempt_id: "${quoteSdn(attemptId)}"
    eval_command: "${quoteSdn(evalCommand)}"
    metrics: "${quoteSdn(metrics)}"
    target: "${quoteSdn(target)}"
    result: "${quoteSdn(result)}"
`);
  console.log(registryPath);
}

function commandFineTuneRecordDecision(args) {
  const [attemptId, status, retryTarget, nextAttempt = "", notes = ""] = args;
  if (!attemptId || !status) {
    console.error("spipe fine-tune-record-decision: attempt_id and status are required");
    process.exitCode = 2;
    return;
  }
  if (!validateAttemptId("fine-tune-record-decision", attemptId)) return;
  if (status !== "accepted" && !retryStatuses.has(status)) {
    console.error(`spipe fine-tune-record-decision: invalid status: ${status}`);
    process.exitCode = 2;
    return;
  }
  if (retryStatuses.has(status) && !retryTarget) {
    console.error("spipe fine-tune-record-decision: retry_target is required for retry status");
    process.exitCode = 2;
    return;
  }
  const root = join(process.cwd(), ".spipe/llm-finetune-process");
  const registryPath = initRegistry(root, "decisions.sdn", "# Verification decision evidence for SPipe LLM fine-tune attempts.", "decisions");
  appendFileSync(registryPath, `  - attempt_id: "${quoteSdn(attemptId)}"
    status: "${quoteSdn(status)}"
    retry_target: "${quoteSdn(retryTarget || "")}"
    next_attempt: "${quoteSdn(nextAttempt)}"
    notes: "${quoteSdn(notes)}"
`);
  console.log(registryPath);
}

function commandFineTuneRecordVerifyLoop(args) {
  const [attemptId, evalCommand, metrics, target, result, status, retryTarget = "", nextAttempt = "", notes = ""] = args;
  if (!attemptId || !evalCommand || !metrics || !target || !result || !status) {
    console.error("spipe fine-tune-record-verify-loop: attempt_id, eval_command, metrics, target, result, and status are required");
    process.exitCode = 2;
    return;
  }
  if (!validateAttemptId("fine-tune-record-verify-loop", attemptId)) return;
  commandFineTuneRecordEval([attemptId, evalCommand, metrics, target, result]);
  if (process.exitCode) return;
  commandFineTuneRecordDecision([attemptId, status, retryTarget, nextAttempt, notes]);
  if (process.exitCode) return;
  if (status !== "accepted" && nextAttempt) {
    commandFineTuneNewAttempt([nextAttempt, `Retry ${attemptId} via ${retryTarget}`, ""]);
    if (process.exitCode) return;
    const root = join(process.cwd(), ".spipe/llm-finetune-process");
    const registryPath = initRegistry(root, "retune_requests.sdn", "# Retune request evidence for SPipe LLM-backed app/server loops.", "retune_requests");
    appendFileSync(registryPath, `  - attempt_id: "${quoteSdn(attemptId)}"
    reason: "${quoteSdn(status)}"
    source_eval: "${quoteSdn(`decisions.sdn:${attemptId}`)}"
    next_attempt: "${quoteSdn(nextAttempt)}"
    retry_target: "${quoteSdn(retryTarget)}"
`);
    console.log(registryPath);
  }
}

function commandFineTuneRecordProcess(args) {
  const [attemptId, researchDoc, requirementsDoc, nfrDoc, planDoc, architectureDoc, designDoc] = args;
  if (!attemptId || !researchDoc || !requirementsDoc || !nfrDoc || !planDoc || !architectureDoc || !designDoc) {
    console.error("spipe fine-tune-record-process: attempt_id, research_doc, requirements_doc, nfr_doc, plan_doc, architecture_doc, and design_doc are required");
    process.exitCode = 2;
    return;
  }
  if (!validateAttemptId("fine-tune-record-process", attemptId)) return;
  const root = join(process.cwd(), ".spipe/llm-finetune-process");
  const registryPath = initRegistry(root, "process_docs.sdn", "# Pipeline document trace for SPipe LLM fine-tune attempts.", "process_docs");
  appendFileSync(registryPath, `  - attempt_id: "${quoteSdn(attemptId)}"
    research_doc: "${quoteSdn(researchDoc)}"
    requirements_doc: "${quoteSdn(requirementsDoc)}"
    nfr_doc: "${quoteSdn(nfrDoc)}"
    plan_doc: "${quoteSdn(planDoc)}"
    architecture_doc: "${quoteSdn(architectureDoc)}"
    design_doc: "${quoteSdn(designDoc)}"
`);
  console.log(registryPath);
}

function writeIfMissingWithDirs(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) {
    writeFileSync(path, content);
  }
}

function commandFineTuneScaffoldProcessDocs(args) {
  const [attemptId, featureSlug, title = featureSlug] = args;
  if (!attemptId || !featureSlug) {
    console.error("spipe fine-tune-scaffold-process-docs: attempt_id and feature_slug are required");
    process.exitCode = 2;
    return;
  }
  if (!validateAttemptId("fine-tune-scaffold-process-docs", attemptId)) return;
  if (!/^[A-Za-z0-9_.-]+$/.test(featureSlug)) {
    console.error("spipe fine-tune-scaffold-process-docs: feature_slug may contain only letters, numbers, dot, dash, and underscore");
    process.exitCode = 2;
    return;
  }

  const docs = {
    research: `doc/01_research/local/${featureSlug}.md`,
    requirements: `doc/02_requirements/feature/${featureSlug}_options.md`,
    nfr: `doc/02_requirements/nfr/${featureSlug}_options.md`,
    plan: `doc/03_plan/agent_tasks/${featureSlug}.md`,
    architecture: `doc/04_architecture/${featureSlug}.md`,
    design: `doc/05_design/${featureSlug}.md`
  };

  writeIfMissingWithDirs(join(process.cwd(), docs.research), `# ${title} Local Research

Attempt: ${attemptId}

## Local Findings

- Source paths:
- Existing process/docs:
- Data sources:
`);
  writeIfMissingWithDirs(join(process.cwd(), docs.requirements), `# ${title} Requirement Options

Attempt: ${attemptId}

## Option A: Scaffold

Requirements:
- Record the selected user-facing behavior.

Pros:
- Fast to validate.

Cons:
- Needs expansion before implementation.

Effort: Medium.
`);
  writeIfMissingWithDirs(join(process.cwd(), docs.nfr), `# ${title} NFR Options

Attempt: ${attemptId}

## Option A: Auditability First

Targets:
- Record evidence for each process phase.

Pros: Clear release evidence.
Cons: More records to maintain.
Effort: Medium.
`);
  writeIfMissingWithDirs(join(process.cwd(), docs.plan), `# ${title} Agent Task Plan

Attempt: ${attemptId}

1. Complete research and data download evidence.
2. Select requirements and NFRs.
3. Choose base model and tuning method.
4. Implement/train and record artifacts.
5. Verify and route retry.
`);
  writeIfMissingWithDirs(join(process.cwd(), docs.architecture), `# ${title} Architecture

Attempt: ${attemptId}

## Layers

- Host records:
- SPipe reusable process:
- Trainer/provider adapter:
- App/server handoff:
`);
  writeIfMissingWithDirs(join(process.cwd(), docs.design), `# ${title} Design

Attempt: ${attemptId}

## Design Decisions

- Data:
- Base model:
- Tuning method:
- Evaluation:
- Retry route:
`);
  commandFineTuneRecordProcess([attemptId, docs.research, docs.requirements, docs.nfr, docs.plan, docs.architecture, docs.design]);
}

export function commandFineTuneRecordRequirements(args) {
  const [attemptId, featureOption, nfrOption, selectedBy, selectionDoc, notes = ""] = args;
  if (!attemptId || !featureOption || !nfrOption || !selectedBy || !selectionDoc) {
    console.error("spipe fine-tune-record-requirements: attempt_id, feature_option, nfr_option, selected_by, and selection_doc are required");
    process.exitCode = 2;
    return;
  }
  if (!validateAttemptId("fine-tune-record-requirements", attemptId)) return;
  const root = join(process.cwd(), ".spipe/llm-finetune-process");
  const registryPath = initRegistry(root, "requirements_selection.sdn", "# Requirement option selection evidence for SPipe LLM fine-tune attempts.", "requirements_selection");
  appendFileSync(registryPath, `  - attempt_id: "${quoteSdn(attemptId)}"
    feature_option: "${quoteSdn(featureOption)}"
    nfr_option: "${quoteSdn(nfrOption)}"
    selected_by: "${quoteSdn(selectedBy)}"
    selection_doc: "${quoteSdn(selectionDoc)}"
    notes: "${quoteSdn(notes)}"
`);
  console.log(registryPath);
}

export function runFineTuneSetup(command, args = []) {
  switch (command) {
    case "fine-tune-guide": commandFineTuneGuide(); break;
    case "fine-tune-model-guide": commandFineTuneModelGuide(); break;
    case "fine-tune-template": commandFineTuneTemplate(); break;
    case "fine-tune-init": commandFineTuneInit(); break;
    case "fine-tune-new-attempt": commandFineTuneNewAttempt(args); break;
    case "fine-tune-record-data": commandFineTuneRecordData(args); break;
    case "fine-tune-record-data-check": commandFineTuneRecordDataCheck(args); break;
    case "fine-tune-record-model": commandFineTuneRecordModel(args); break;
    case "fine-tune-record-model-research": commandFineTuneRecordModelResearch(args); break;
    case "fine-tune-record-model-arch": commandFineTuneRecordModelArch(args); break;
    case "fine-tune-scaffold-model-arch": commandFineTuneScaffoldModelArch(args); break;
    case "fine-tune-record-method": commandFineTuneRecordMethod(args); break;
    case "fine-tune-model-method-options": commandFineTuneModelMethodOptions(args); break;
    case "fine-tune-select-model-method": commandFineTuneSelectModelMethod(args); break;
    case "fine-tune-record-training": commandFineTuneRecordTraining(args); break;
    case "fine-tune-scaffold-training": commandFineTuneScaffoldTraining(args); break;
    case "fine-tune-record-eval": commandFineTuneRecordEval(args); break;
    case "fine-tune-record-decision": commandFineTuneRecordDecision(args); break;
    case "fine-tune-record-verify-loop": commandFineTuneRecordVerifyLoop(args); break;
    case "fine-tune-record-process": commandFineTuneRecordProcess(args); break;
    case "fine-tune-scaffold-process-docs": commandFineTuneScaffoldProcessDocs(args); break;
    case "fine-tune-record-requirements": commandFineTuneRecordRequirements(args); break;
    default: return false;
  }
  return true;
}
