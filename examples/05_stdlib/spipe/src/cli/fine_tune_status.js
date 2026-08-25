import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readlinkSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
import { quoteSdn, readQuotedValue, retryStatuses, validateAttemptId } from "./fine_tune_common.js";
import { commandFineTuneRecordRetune } from "./fine_tune_requirements.js";
import { commandFineTuneNewAttempt } from "./fine_tune_setup.js";
function commandFineTuneCreateRetry(args) {
  const [sourceAttemptId, nextAttemptId, goal = "", target = ""] = args;
  if (!sourceAttemptId || !nextAttemptId) {
    console.error("spipe fine-tune-create-retry: source_attempt_id and next_attempt_id are required");
    process.exitCode = 2;
    return;
  }
  if (!validateAttemptId("fine-tune-create-retry", sourceAttemptId)) return;
  if (!validateAttemptId("fine-tune-create-retry", nextAttemptId)) return;

  const root = join(process.cwd(), ".spipe/llm-finetune-process");
  const sourceAttemptPath = join(root, "attempts", `${sourceAttemptId}.sdn`);
  const sourceContent = existsSync(sourceAttemptPath) ? readFileSync(sourceAttemptPath, "utf8") : "";
  const status = registryValueForAttempt(root, "decisions.sdn", sourceAttemptId, "status") || readQuotedValue(sourceContent, "status");
  const retryTarget = registryValueForAttempt(root, "decisions.sdn", sourceAttemptId, "retry_target") || readQuotedValue(sourceContent, "retry_target");

  if (!status || status === "accepted") {
    console.error(`spipe fine-tune-create-retry: source attempt has no retry decision: ${sourceAttemptId}`);
    process.exitCode = 1;
    return;
  }
  if (!retryTarget) {
    console.error(`spipe fine-tune-create-retry: source attempt has no retry target: ${sourceAttemptId}`);
    process.exitCode = 1;
    return;
  }

  const nextGoal = goal || `Retry ${sourceAttemptId} via ${retryTarget}`;
  commandFineTuneNewAttempt([nextAttemptId, nextGoal, target]);
  if (process.exitCode) return;
  commandFineTuneRecordRetune([sourceAttemptId, status, `decisions.sdn:${sourceAttemptId}`, nextAttemptId, retryTarget]);
}

function commandFineTuneAppHandoff(args) {
  const [attemptId] = args;
  if (!attemptId) {
    console.error("spipe fine-tune-app-handoff: attempt_id is required");
    process.exitCode = 2;
    return;
  }
  if (!validateAttemptId("fine-tune-app-handoff", attemptId)) return;
  const root = join(process.cwd(), ".spipe/llm-finetune-process");
  console.log("# SPipe LLM App/Server Handoff");
  console.log(`attempt_id: ${attemptId}`);
  console.log("");
  console.log("## App Handoff");
  console.log(registryBlockForAttempt(root, "app_handoffs.sdn", attemptId) || "missing");
  console.log("");
  console.log("## Model");
  console.log(registryBlockForAttempt(root, "models.sdn", attemptId) || "missing");
  console.log("");
  console.log("## Training");
  console.log(registryBlockForAttempt(root, "training_scripts.sdn", attemptId) || "missing");
  console.log("");
  console.log("## Evaluation");
  console.log(registryBlockForAttempt(root, "eval_results.sdn", attemptId) || "missing");
  console.log("");
  console.log("## Decision");
  console.log(registryBlockForAttempt(root, "decisions.sdn", attemptId) || "missing");
  console.log("");
  console.log("## Retune Requests");
  console.log(registryBlockForAttempt(root, "retune_requests.sdn", attemptId) || "missing");
}

function registryHasAttempt(root, fileName, attemptId) {
  const path = join(root, fileName);
  if (!existsSync(path)) return false;
  const content = readFileSync(path, "utf8");
  return content.includes(`attempt_id: "${attemptId}"`);
}

function commandFineTuneStatus(args) {
  const [attemptId] = args;
  if (!attemptId) {
    console.error("spipe fine-tune-status: attempt_id is required");
    process.exitCode = 2;
    return;
  }
  if (!validateAttemptId("fine-tune-status", attemptId)) return;

  const root = join(process.cwd(), ".spipe/llm-finetune-process");
  const attemptPath = join(root, "attempts", `${attemptId}.sdn`);
  const checks = [
    ["attempt_record", existsSync(attemptPath)],
    ["data_downloads", registryHasAttempt(root, "data_downloads.sdn", attemptId)],
    ["data_checks", registryHasAttempt(root, "data_checks.sdn", attemptId)],
    ["process_docs", registryHasAttempt(root, "process_docs.sdn", attemptId)],
    ["requirements_selection", registryHasAttempt(root, "requirements_selection.sdn", attemptId)],
    ["model_research", registryHasAttempt(root, "model_research.sdn", attemptId)],
    ["model_architecture", registryHasAttempt(root, "model_architecture.sdn", attemptId)],
    ["tuning_methods", registryHasAttempt(root, "tuning_methods.sdn", attemptId)],
    ["models", registryHasAttempt(root, "models.sdn", attemptId)],
    ["training_scripts", registryHasAttempt(root, "training_scripts.sdn", attemptId)],
    ["eval_results", registryHasAttempt(root, "eval_results.sdn", attemptId)],
    ["decisions", registryHasAttempt(root, "decisions.sdn", attemptId)],
    ["app_handoffs", registryHasAttempt(root, "app_handoffs.sdn", attemptId)],
    ["retune_requests", registryHasAttempt(root, "retune_requests.sdn", attemptId)]
  ];

  let failures = 0;
  let warnings = 0;
  console.log(`attempt_id=${attemptId}`);
  for (const [name, ok] of checks) {
    if (!ok) failures += 1;
    console.log(`${name}=${ok ? "present" : "missing"}`);
  }
  const gate = fineTuneDataGateStatus(root, attemptId);
  if (gate) {
    if (gate.status === "WARN") warnings += 1;
    if (gate.status === "FAIL") failures += 1;
    console.log(`data_check_execution=${gate.status === "PASS" ? "pass" : gate.status === "WARN" ? "warn" : "fail"}`);
    console.log(`data_check_status="${quoteSdn(gate.statusLine)}"`);
    printFineTuneGateFields(gate, [
      "result",
      "training_allowed",
      "model_manifest_exists",
      "eval_result_exists",
      "target_accuracy",
      "required_accuracy",
      "target_eval_reached",
      "acceptance_allowed"
    ]);
  }
  const firstReadinessBlocker = readinessChecks(root, attemptId).find(([, ok]) => !ok);
  if (firstReadinessBlocker) {
    warnings += 1;
    console.log(`readiness_blocker=${firstReadinessBlocker[0]}`);
  } else {
    console.log("readiness_blocker=none");
  }
  console.log(failures === 0 && warnings === 0 ? "STATUS: PASS llm-finetune-status" : failures ? "STATUS: FAIL llm-finetune-status" : "STATUS: WARN llm-finetune-status");
  process.exitCode = failures === 0 ? 0 : 1;
}

function hasPlaceholder(value) {
  return !value
    || value.includes("pending")
    || value === "not-selected"
    || value === "not-created"
    || value === "dry-run-record-only"
    || value === "not-run"
    || value === "not-deployable";
}

function commandFineTuneDoctor(args) {
  const [attemptId] = args;
  if (!attemptId) {
    console.error("spipe fine-tune-doctor: attempt_id is required");
    process.exitCode = 2;
    return;
  }
  if (!validateAttemptId("fine-tune-doctor", attemptId)) return;

  const root = join(process.cwd(), ".spipe/llm-finetune-process");
  const attemptPath = join(root, "attempts", `${attemptId}.sdn`);
  const attemptContent = existsSync(attemptPath) ? readFileSync(attemptPath, "utf8") : "";
  const requiredRegistries = [
    "data_downloads.sdn",
    "data_checks.sdn",
    "process_docs.sdn",
    "requirements_selection.sdn",
    "model_research.sdn",
    "model_architecture.sdn",
    "tuning_methods.sdn",
    "models.sdn",
    "training_scripts.sdn",
    "eval_results.sdn",
    "decisions.sdn",
    "app_handoffs.sdn",
    "retune_requests.sdn"
  ];

  let failures = 0;
  let warnings = 0;
  console.log(`attempt_id=${attemptId}`);
  if (!existsSync(attemptPath)) {
    failures += 1;
    console.log("ERROR missing_attempt_record");
  }

  for (const fileName of requiredRegistries) {
    if (!registryHasAttempt(root, fileName, attemptId)) {
      warnings += 1;
      console.log(`WARN missing_registry_evidence ${fileName}`);
    }
  }

  const modelArtifact = registryValueForAttempt(root, "training_scripts.sdn", attemptId, "model_artifact") || readQuotedValue(attemptContent, "model_artifact");
  const handoffDoc = registryValueForAttempt(root, "app_handoffs.sdn", attemptId, "handoff_doc") || readQuotedValue(attemptContent, "handoff_doc");
  const fields = [
    ["feature_option", registryValueForAttempt(root, "requirements_selection.sdn", attemptId, "feature_option")],
    ["nfr_option", registryValueForAttempt(root, "requirements_selection.sdn", attemptId, "nfr_option")],
    ["base_model", registryValueForAttempt(root, "models.sdn", attemptId, "base_model") || readQuotedValue(attemptContent, "base_model")],
    ["tuning_method", registryValueForAttempt(root, "tuning_methods.sdn", attemptId, "method") || readQuotedValue(attemptContent, "method")],
    ["model_artifact", modelArtifact],
    ["decision_status", registryValueForAttempt(root, "decisions.sdn", attemptId, "status") || readQuotedValue(attemptContent, "status")],
    ["license_constraints", registryValueForAttempt(root, "app_handoffs.sdn", attemptId, "license_constraints") || readQuotedValue(attemptContent, "license_constraints")],
    ["safety_eval", registryValueForAttempt(root, "app_handoffs.sdn", attemptId, "safety_eval") || readQuotedValue(attemptContent, "safety_eval")],
    ["deployment_evidence", registryValueForAttempt(root, "app_handoffs.sdn", attemptId, "deployment_evidence") || readQuotedValue(attemptContent, "deployment_evidence")],
    ["handoff_doc", handoffDoc]
  ];
  for (const [name, value] of fields) {
    if (hasPlaceholder(value)) {
      warnings += 1;
      console.log(`WARN placeholder ${name}=${value || "(missing)"}`);
    }
  }
  if (modelArtifact && !hasPlaceholder(modelArtifact) && !artifactReferenceExistsOrUri(modelArtifact)) {
    warnings += 1;
    console.log(`WARN missing_local_model_artifact model_artifact=${modelArtifact}`);
  }
  if (handoffDoc && !hasPlaceholder(handoffDoc) && !artifactReferenceExistsOrUri(handoffDoc)) {
    warnings += 1;
    console.log(`WARN missing_local_handoff_doc handoff_doc=${handoffDoc}`);
  }
  const evalDiagnostic = fineTuneEvalTargetDiagnostic(root, attemptId, attemptContent);
  if (evalDiagnostic) {
    warnings += 1;
    console.log(`WARN target_eval_not_reached reason=${evalDiagnostic.reason} result=${evalDiagnostic.result || "(missing)"} target="${quoteSdn(evalDiagnostic.targetText)}" metrics="${quoteSdn(evalDiagnostic.metricsText)}"`);
  }

  const gate = fineTuneDataGateStatus(root, attemptId);
  if (gate) {
    if (gate.status === "WARN") warnings += 1;
    if (gate.status === "FAIL") failures += 1;
    console.log(`${gate.status === "PASS" ? "OK" : gate.status} data_check_execution ${gate.statusLine}`);
    printFineTuneGateFields(gate, [
      "result",
      "training_allowed",
      "model_manifest_exists",
      "eval_result_exists",
      "target_accuracy",
      "required_accuracy",
      "target_eval_reached",
      "acceptance_allowed"
    ]);
  }

  const decisionStatus = registryValueForAttempt(root, "decisions.sdn", attemptId, "status") || readQuotedValue(attemptContent, "status");
  const retryTarget = registryValueForAttempt(root, "decisions.sdn", attemptId, "retry_target") || readQuotedValue(attemptContent, "retry_target");
  const nextAttempt = registryValueForAttempt(root, "decisions.sdn", attemptId, "next_attempt") || readQuotedValue(attemptContent, "next_attempt");
  const next = readinessChecks(root, attemptId).find(([, ok]) => !ok);
  if (decisionStatus && decisionStatus !== "accepted" && retryTarget) {
    console.log(`next_action=${decisionStatus}`);
    console.log(`retry_target=${retryTarget}`);
    if (nextAttempt) console.log(`next_attempt=${nextAttempt}`);
  } else {
    console.log(`next_action=${next ? next[0] : "ready"}`);
  }
  const ready = !next && failures === 0;
  console.log(ready ? "STATUS: PASS llm-finetune-doctor" : failures ? "STATUS: FAIL llm-finetune-doctor" : "STATUS: WARN llm-finetune-doctor");
  process.exitCode = ready ? 0 : failures ? 1 : 1;
}

function registryValueForAttempt(root, fileName, attemptId, key) {
  const path = join(root, fileName);
  if (!existsSync(path)) return "";
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  let inAttempt = false;
  let latest = "";
  for (const line of lines) {
    const attemptMatch = line.match(/^\s*-\s*attempt_id:\s*"([^"]*)"\s*$/);
    if (attemptMatch) {
      inAttempt = attemptMatch[1] === attemptId;
      continue;
    }
    if (inAttempt) {
      const valueMatch = line.match(new RegExp(`^\\s*${key}:\\s*"([^"]*)"\\s*$`));
      if (valueMatch) latest = valueMatch[1];
    }
  }
  return latest;
}

function fineTuneDataGateStatus(root, attemptId) {
  const checker = registryValueForAttempt(root, "data_checks.sdn", attemptId, "checker");
  if (!checker) return null;

  const parts = checker.trim().split(/\s+/).filter(Boolean);
  const script = parts[0] || "";
  const scriptsDir = resolve(process.cwd(), ".spipe/llm-finetune-process/scripts");
  const scriptPath = resolve(process.cwd(), script);
  const inScriptsDir = scriptPath === scriptsDir || scriptPath.startsWith(`${scriptsDir}/`);
  if (!script.endsWith(".shs") || !inScriptsDir) {
    return {
      checker,
      result: "blocked-unsafe-checker-path",
      status: "FAIL",
      statusLine: "STATUS: FAIL llm-finetune-data-gate"
    };
  }

  const run = spawnSync(scriptPath, parts.slice(1), {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false
  });
  const output = `${run.stdout || ""}${run.stderr || ""}`;
  const statusLine = output.split(/\r?\n/).reverse().find((line) => /^STATUS: (PASS|WARN|FAIL) /.test(line)) || "";
  const match = statusLine.match(/^STATUS: (PASS|WARN|FAIL) /);
  const fields = parseFineTuneGateFields(output);
  if (run.error) {
    return {
      checker,
      result: `checker-error:${run.error.code || run.error.message}`,
      status: "FAIL",
      statusLine: "STATUS: FAIL llm-finetune-data-gate",
      fields
    };
  }
  if (run.status !== 0 && !match) {
    return {
      checker,
      result: `checker-exit-${run.status}`,
      status: "FAIL",
      statusLine: "STATUS: FAIL llm-finetune-data-gate",
      fields
    };
  }
  return {
    checker,
    result: match ? match[1].toLowerCase() : "missing-status",
    status: match ? match[1] : "FAIL",
    statusLine: statusLine || "STATUS: FAIL llm-finetune-data-gate",
    fields
  };
}

function parseFineTuneGateFields(output) {
  const fields = new Map();
  for (const line of (output || "").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_.-]+)=(.*)$/);
    if (match) fields.set(match[1], match[2]);
  }
  return fields;
}

function printFineTuneGateFields(gate, names) {
  if (!gate.fields) return;
  for (const name of names) {
    if (gate.fields.has(name)) {
      console.log(`${name}=${gate.fields.get(name)}`);
    }
  }
}

function parseMetricMap(value) {
  const metrics = new Map();
  for (const part of (value || "").split(/[,\s]+/)) {
    const match = part.match(/^([A-Za-z0-9_.-]+)\s*=\s*(-?\d+(?:\.\d+)?)$/);
    if (match) metrics.set(match[1], Number(match[2]));
  }
  return metrics;
}

function parseTarget(value) {
  const match = (value || "").match(/^([A-Za-z0-9_.-]+)\s*>=\s*(-?\d+(?:\.\d+)?)$/);
  return match ? { metric: match[1], threshold: Number(match[2]) } : null;
}

function artifactReferenceExistsOrUri(reference) {
  if (!reference) return false;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(reference)) return true;

  let artifactPath = reference;
  if (!isAbsolute(artifactPath)) artifactPath = join(process.cwd(), artifactPath);
  return existsSync(artifactPath);
}

function fineTuneEvalTargetStatus(root, attemptId, attemptContent) {
  const metricsText = registryValueForAttempt(root, "eval_results.sdn", attemptId, "metrics") || readQuotedValue(attemptContent, "metrics");
  const targetText = registryValueForAttempt(root, "eval_results.sdn", attemptId, "target") || readQuotedValue(attemptContent, "target");
  const result = registryValueForAttempt(root, "eval_results.sdn", attemptId, "result") || readQuotedValue(attemptContent, "result");
  const target = parseTarget(targetText);
  const metrics = parseMetricMap(metricsText);
  const metricValue = target ? metrics.get(target.metric) : undefined;
  return Boolean(
    result === "pass"
    && target
    && metricValue !== undefined
    && metricValue >= target.threshold
  );
}

function fineTuneEvalTargetDiagnostic(root, attemptId, attemptContent) {
  const metricsText = registryValueForAttempt(root, "eval_results.sdn", attemptId, "metrics") || readQuotedValue(attemptContent, "metrics");
  const targetText = registryValueForAttempt(root, "eval_results.sdn", attemptId, "target") || readQuotedValue(attemptContent, "target");
  const result = registryValueForAttempt(root, "eval_results.sdn", attemptId, "result") || readQuotedValue(attemptContent, "result");
  if (!metricsText && !targetText && !result) return null;

  const target = parseTarget(targetText);
  const metrics = parseMetricMap(metricsText);
  const metricValue = target ? metrics.get(target.metric) : undefined;
  if (result === "pass" && target && metricValue !== undefined && metricValue >= target.threshold) return null;

  let reason = "result-not-pass";
  if (!target) reason = "target-unparseable";
  else if (metricValue === undefined) reason = "metric-missing";
  else if (metricValue < target.threshold) reason = "metric-below-target";

  return { reason, result, targetText, metricsText };
}

function fineTuneAppHandoffReady(handoffDoc, usage, licenseConstraints, safetyEval, deploymentEvidence) {
  if (!handoffDoc || handoffDoc === "missing" || handoffDoc === "pending") return false;
  if (!artifactReferenceExistsOrUri(handoffDoc)) return false;
  if (!usage || /^do not deploy\b/i.test(usage)) return false;
  if (!licenseConstraints || licenseConstraints === "pending") return false;
  if (!safetyEval || safetyEval === "not-run") return false;
  if (!deploymentEvidence || deploymentEvidence === "not-deployable") return false;
  return true;
}

function commandFineTuneReady(args) {
  const [attemptId] = args;
  if (!attemptId) {
    console.error("spipe fine-tune-ready: attempt_id is required");
    process.exitCode = 2;
    return;
  }
  if (!validateAttemptId("fine-tune-ready", attemptId)) return;

  const root = join(process.cwd(), ".spipe/llm-finetune-process");
  const attemptPath = join(root, "attempts", `${attemptId}.sdn`);
  let failures = 0;
  if (!existsSync(attemptPath)) {
    console.log(`ERROR missing_attempt_record ${attemptId}`);
    failures += 1;
  }

  const attemptContent = existsSync(attemptPath) ? readFileSync(attemptPath, "utf8") : "";
  const featureOption = registryValueForAttempt(root, "requirements_selection.sdn", attemptId, "feature_option");
  const nfrOption = registryValueForAttempt(root, "requirements_selection.sdn", attemptId, "nfr_option");
  const baseModel = registryValueForAttempt(root, "models.sdn", attemptId, "base_model") || readQuotedValue(attemptContent, "base_model");
  const method = registryValueForAttempt(root, "tuning_methods.sdn", attemptId, "method") || readQuotedValue(attemptContent, "method");
  const modelArtifact = registryValueForAttempt(root, "training_scripts.sdn", attemptId, "model_artifact") || readQuotedValue(attemptContent, "model_artifact");
  const status = registryValueForAttempt(root, "decisions.sdn", attemptId, "status") || readQuotedValue(attemptContent, "status");
  const licenseConstraints = registryValueForAttempt(root, "app_handoffs.sdn", attemptId, "license_constraints") || readQuotedValue(attemptContent, "license_constraints");
  const safetyEval = registryValueForAttempt(root, "app_handoffs.sdn", attemptId, "safety_eval") || readQuotedValue(attemptContent, "safety_eval");
  const deploymentEvidence = registryValueForAttempt(root, "app_handoffs.sdn", attemptId, "deployment_evidence") || readQuotedValue(attemptContent, "deployment_evidence");
  const handoffDoc = registryValueForAttempt(root, "app_handoffs.sdn", attemptId, "handoff_doc") || readQuotedValue(attemptContent, "handoff_doc");
  const handoffUsage = registryValueForAttempt(root, "app_handoffs.sdn", attemptId, "usage") || readQuotedValue(attemptContent, "usage");
  const artifactReady = modelArtifactReady(modelArtifact);
  const evalTargetReached = fineTuneEvalTargetStatus(root, attemptId, attemptContent);

  const checks = [
    ["feature_option_selected", featureOption && featureOption !== "pending-user-selection"],
    ["nfr_option_selected", nfrOption && nfrOption !== "pending-user-selection"],
    ["base_model_selected", baseModel && baseModel !== "not-selected"],
    ["tuning_method_real", method && method !== "dry-run-record-only"],
    ["model_artifact_created", artifactReady],
    ["target_eval_reached", evalTargetReached],
    ["decision_accepted", status === "accepted"],
    ["license_constraints_reviewed", licenseConstraints && licenseConstraints !== "pending"],
    ["safety_eval_complete", safetyEval && safetyEval !== "not-run"],
    ["deployment_evidence_ready", deploymentEvidence && deploymentEvidence !== "not-deployable"],
    ["app_handoff_doc_ready", fineTuneAppHandoffReady(handoffDoc, handoffUsage, licenseConstraints, safetyEval, deploymentEvidence)]
  ];

  console.log(`attempt_id=${attemptId}`);
  for (const [name, ok] of checks) {
    if (!ok) failures += 1;
    console.log(`${name}=${ok ? "ready" : "pending"}`);
  }
  console.log(failures === 0 ? "STATUS: PASS llm-finetune-ready" : "STATUS: FAIL llm-finetune-ready");
  process.exitCode = failures === 0 ? 0 : 1;
}

function readinessChecks(root, attemptId) {
  const attemptPath = join(root, "attempts", `${attemptId}.sdn`);
  const attemptContent = existsSync(attemptPath) ? readFileSync(attemptPath, "utf8") : "";
  const featureOption = registryValueForAttempt(root, "requirements_selection.sdn", attemptId, "feature_option");
  const nfrOption = registryValueForAttempt(root, "requirements_selection.sdn", attemptId, "nfr_option");
  const baseModel = registryValueForAttempt(root, "models.sdn", attemptId, "base_model") || readQuotedValue(attemptContent, "base_model");
  const method = registryValueForAttempt(root, "tuning_methods.sdn", attemptId, "method") || readQuotedValue(attemptContent, "method");
  const modelArtifact = registryValueForAttempt(root, "training_scripts.sdn", attemptId, "model_artifact") || readQuotedValue(attemptContent, "model_artifact");
  const status = registryValueForAttempt(root, "decisions.sdn", attemptId, "status") || readQuotedValue(attemptContent, "status");
  const licenseConstraints = registryValueForAttempt(root, "app_handoffs.sdn", attemptId, "license_constraints") || readQuotedValue(attemptContent, "license_constraints");
  const safetyEval = registryValueForAttempt(root, "app_handoffs.sdn", attemptId, "safety_eval") || readQuotedValue(attemptContent, "safety_eval");
  const deploymentEvidence = registryValueForAttempt(root, "app_handoffs.sdn", attemptId, "deployment_evidence") || readQuotedValue(attemptContent, "deployment_evidence");
  const handoffDoc = registryValueForAttempt(root, "app_handoffs.sdn", attemptId, "handoff_doc") || readQuotedValue(attemptContent, "handoff_doc");
  const handoffUsage = registryValueForAttempt(root, "app_handoffs.sdn", attemptId, "usage") || readQuotedValue(attemptContent, "usage");
  const evalTargetReached = fineTuneEvalTargetStatus(root, attemptId, attemptContent);
  return [
    ["requirements-selection", featureOption && featureOption !== "pending-user-selection" && nfrOption && nfrOption !== "pending-user-selection"],
    ["base-model-selection", baseModel && baseModel !== "not-selected"],
    ["tuning-method-selection", method && method !== "dry-run-record-only"],
    ["model-artifact", modelArtifactReady(modelArtifact)],
    ["target-eval", evalTargetReached],
    ["acceptance-decision", status === "accepted"],
    ["license-constraints", licenseConstraints && licenseConstraints !== "pending"],
    ["safety-eval", safetyEval && safetyEval !== "not-run"],
    ["deployment-evidence", deploymentEvidence && deploymentEvidence !== "not-deployable"],
    ["app-handoff-doc", fineTuneAppHandoffReady(handoffDoc, handoffUsage, licenseConstraints, safetyEval, deploymentEvidence)]
  ];
}

function modelArtifactReady(modelArtifact) {
  if (!modelArtifact || modelArtifact === "not-created") return false;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(modelArtifact)) return true;

  let artifactPath = modelArtifact;
  if (!isAbsolute(artifactPath)) artifactPath = join(process.cwd(), artifactPath);
  if (!existsSync(artifactPath)) return false;

  const content = readFileSync(artifactPath, "utf8");
  if (content.includes('"deployable":false') || content.includes('"deployable": false')) return false;
  if (content.includes("FAIL_IMPLEMENTATION_DRY_RUN_NO_REAL_TRAINING")) return false;
  return true;
}

function commandFineTuneNext(args) {
  const [attemptId] = args;
  if (!attemptId) {
    console.error("spipe fine-tune-next: attempt_id is required");
    process.exitCode = 2;
    return;
  }
  if (!validateAttemptId("fine-tune-next", attemptId)) return;

  const root = join(process.cwd(), ".spipe/llm-finetune-process");
  const attemptPath = join(root, "attempts", `${attemptId}.sdn`);
  if (!existsSync(attemptPath)) {
    console.log(`attempt_id=${attemptId}`);
    console.log("next_action=create-attempt");
    console.log("STATUS: WARN llm-finetune-next");
    process.exitCode = 1;
    return;
  }
  const attemptContent = readFileSync(attemptPath, "utf8");
  const decisionStatus = registryValueForAttempt(root, "decisions.sdn", attemptId, "status") || readQuotedValue(attemptContent, "status");
  const retryTarget = registryValueForAttempt(root, "decisions.sdn", attemptId, "retry_target") || readQuotedValue(attemptContent, "retry_target");
  const nextAttempt = registryValueForAttempt(root, "decisions.sdn", attemptId, "next_attempt") || readQuotedValue(attemptContent, "next_attempt");
  const firstReadinessBlocker = readinessChecks(root, attemptId).find(([, ok]) => !ok);
  if (decisionStatus && decisionStatus !== "accepted" && retryTarget) {
    console.log(`attempt_id=${attemptId}`);
    console.log(`next_action=${decisionStatus}`);
    console.log(`retry_target=${retryTarget}`);
    if (firstReadinessBlocker) console.log(`readiness_blocker=${firstReadinessBlocker[0]}`);
    if (nextAttempt) console.log(`next_attempt=${nextAttempt}`);
    console.log("STATUS: WARN llm-finetune-next");
    process.exitCode = 1;
    return;
  }
  if (firstReadinessBlocker) {
    console.log(`attempt_id=${attemptId}`);
    console.log(`next_action=${firstReadinessBlocker[0]}`);
    console.log(`readiness_blocker=${firstReadinessBlocker[0]}`);
    console.log("STATUS: WARN llm-finetune-next");
    process.exitCode = 1;
    return;
  }
  console.log(`attempt_id=${attemptId}`);
  console.log("next_action=ready");
  console.log("STATUS: PASS llm-finetune-next");
}

function registryBlockForAttempt(root, fileName, attemptId) {
  const path = join(root, fileName);
  if (!existsSync(path)) return "";
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  let out = [];
  let latest = [];
  let inAttempt = false;
  for (const line of lines) {
    const attemptMatch = line.match(/^(\s*)-\s*attempt_id:\s*"([^"]*)"\s*$/);
    if (attemptMatch) {
      if (inAttempt) latest = out;
      inAttempt = attemptMatch[2] === attemptId;
      out = [];
      if (inAttempt) out.push(line);
      continue;
    }
    if (inAttempt) {
      out.push(line);
    }
  }
  if (inAttempt) latest = out;
  return latest.join("\n").trimEnd();
}

function commandFineTuneReport(args) {
  const [attemptId] = args;
  if (!attemptId) {
    console.error("spipe fine-tune-report: attempt_id is required");
    process.exitCode = 2;
    return;
  }
  if (!validateAttemptId("fine-tune-report", attemptId)) return;

  const root = join(process.cwd(), ".spipe/llm-finetune-process");
  const attemptPath = join(root, "attempts", `${attemptId}.sdn`);
  console.log(`# SPipe Fine-Tune Attempt Report`);
  console.log(`attempt_id: ${attemptId}`);
  console.log("");
  console.log("## Attempt Record");
  if (existsSync(attemptPath)) {
    process.stdout.write(readFileSync(attemptPath, "utf8").trimEnd());
    console.log("");
  } else {
    console.log("missing");
  }

  const registries = [
    ["Requirements Selection", "requirements_selection.sdn"],
    ["Process Docs", "process_docs.sdn"],
    ["Data Downloads", "data_downloads.sdn"],
    ["Data Checks", "data_checks.sdn"],
    ["Model Research", "model_research.sdn"],
    ["Model Architecture", "model_architecture.sdn"],
    ["Tuning Methods", "tuning_methods.sdn"],
    ["Models", "models.sdn"],
    ["Training Scripts", "training_scripts.sdn"],
    ["Eval Results", "eval_results.sdn"],
    ["Decisions", "decisions.sdn"],
    ["App Handoffs", "app_handoffs.sdn"],
    ["Retune Requests", "retune_requests.sdn"]
  ];

  for (const [title, fileName] of registries) {
    console.log("");
    console.log(`## ${title}`);
    const block = registryBlockForAttempt(root, fileName, attemptId);
    console.log(block || "missing");
  }
}

function commandFineTuneVerify(recordPath) {
  if (!recordPath) {
    console.error("spipe fine-tune-verify: record path is required");
    process.exitCode = 2;
    return;
  }
  if (!existsSync(recordPath)) {
    console.log(`ERROR missing_record ${recordPath}`);
    console.log("STATUS: FAIL llm-finetune-attempt-record");
    process.exitCode = 1;
    return;
  }

  const content = readFileSync(recordPath, "utf8");
  const required = [
    "attempt_id",
    "goal",
    "research_doc",
    "feature_option",
    "nfr_option",
    "selection_doc",
    "requirements_doc",
    "nfr_doc",
    "plan_doc",
    "architecture_doc",
    "design_doc",
    "candidate_model",
    "base_model",
    "base_model_reason",
    "download_command",
    "cache_path",
    "method",
    "training_script",
    "training_command",
    "model_artifact",
    "eval_command",
    "metrics",
    "target",
    "result",
    "status",
    "app_target",
    "handoff_doc",
    "license_constraints",
    "safety_eval",
    "deployment_evidence"
  ];

  let failures = 0;
  for (const key of required) {
    if (!readQuotedValue(content, key)) {
      failures += 1;
      console.log(`ERROR missing_field ${key}`);
    }
  }

  const status = readQuotedValue(content, "status");
  const retryTarget = readQuotedValue(content, "retry_target");
  if (status && status !== "accepted" && !retryStatuses.has(status)) {
    failures += 1;
    console.log(`ERROR invalid_status ${status}`);
  }
  if (retryStatuses.has(status) && !retryTarget) {
    failures += 1;
    console.log("ERROR missing_field retry_target");
  }

  const trainingScript = readQuotedValue(content, "training_script");
  if (trainingScript && trainingScript !== "provider-managed") {
    const scriptPath = resolve(process.cwd(), trainingScript);
    if (!existsSync(scriptPath)) {
      failures += 1;
      console.log(`ERROR missing_training_script ${trainingScript}`);
    }
  }

  console.log(failures === 0 ? "STATUS: PASS llm-finetune-attempt-record" : "STATUS: FAIL llm-finetune-attempt-record");
  process.exitCode = failures === 0 ? 0 : 1;
}

function commandFineTuneDataPlan(args) {
  const [attemptId] = args;
  if (!attemptId) {
    console.error("spipe fine-tune-data-plan: attempt_id is required");
    process.exitCode = 2;
    return;
  }
  if (!validateAttemptId("fine-tune-data-plan", attemptId)) return;
  const root = join(process.cwd(), ".spipe/llm-finetune-process");
  console.log("data_downloads:");
  console.log(registryBlockForAttempt(root, "data_downloads.sdn", attemptId) || "  missing");
  console.log("data_checks:");
  console.log(registryBlockForAttempt(root, "data_checks.sdn", attemptId) || "  missing");
  const gate = fineTuneDataGateStatus(root, attemptId);
  if (gate) {
    console.log("data_check_execution:");
    console.log(`  checker: "${quoteSdn(gate.checker)}"`);
    console.log(`  result: "${quoteSdn(gate.result)}"`);
    console.log(`  status: "${quoteSdn(gate.status)}"`);
    if (gate.statusLine) console.log(`  status_line: "${quoteSdn(gate.statusLine)}"`);
  }
}

export function runFineTuneStatus(command, args = []) {
  const arg = args[0];
  switch (command) {
    case "fine-tune-data-plan": commandFineTuneDataPlan(args); break;
    case "fine-tune-create-retry": commandFineTuneCreateRetry(args); break;
    case "fine-tune-app-handoff": commandFineTuneAppHandoff(args); break;
    case "fine-tune-status": commandFineTuneStatus(args); break;
    case "fine-tune-doctor": commandFineTuneDoctor(args); break;
    case "fine-tune-ready": commandFineTuneReady(args); break;
    case "fine-tune-next": commandFineTuneNext(args); break;
    case "fine-tune-report": commandFineTuneReport(args); break;
    case "fine-tune-verify": commandFineTuneVerify(arg); break;
    default: return false;
  }
  return true;
}
