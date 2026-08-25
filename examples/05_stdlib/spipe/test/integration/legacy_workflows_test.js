#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const testRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleRoot = resolve(testRoot, "..");
const cliPath = join(moduleRoot, "cli/spipe.js");
const setupPath = join(moduleRoot, "scripts/setup-spipe-links.shs");
const host = mkdtempSync(join(tmpdir(), "spipe-legacy-workflows-"));

function run(args, expected = 0) {
  const result = spawnSync(process.execPath, [cliPath, ...args], { cwd: host, encoding: "utf8", timeout: 10_000 });
  assert.ifError(result.error);
  assert.equal(result.status, expected, `${args.join(" ")}\nstdout=${result.stdout}\nstderr=${result.stderr}`);
  return result;
}

try {
  const cli = JSON.parse(readFileSync(join(testRoot, "fixture/legacy_cli.json"), "utf8"));
  const help = run(["--help"]).stdout;
  assert.equal(Buffer.byteLength(help), cli.help.stdoutBytes);
  assert.equal(createHash("sha256").update(help).digest("hex"), cli.help.stdoutSha256);
  assert.equal(run(["-h"]).stdout, help);
  assert.equal(run(["--version"]).stdout, "0.1.0\n");
  assert.equal(run(["-v"]).stdout, "0.1.0\n");
  assert.equal(run(["unknown-command"], 2).stderr, "spipe: unknown command: unknown-command\n");
  assert.equal(run(["fine-tune-new-attempt"], 2).stderr,
    "spipe fine-tune-new-attempt: attempt_id and goal are required\n");

  mkdirSync(join(host, ".spipe"), { recursive: true });
  writeFileSync(join(host, ".spipe/config.sdn"), "host_process_doc: docs/process\n");
  assert.equal(run(["doc-root", host]).stdout, "docs/process\n");
  const plan = run(["link-plan", host]).stdout;
  assert.ok(plan.includes("docs/process/skill_command"));
  assert.ok(plan.includes(`target=${join(host, "docs/process/tool_expert")}`));
  assert.equal(run(["doc-link", host], 1).stderr,
    "spipe doc-link: doc root does not exist: docs/process\n");
  mkdirSync(join(host, "docs/process"), { recursive: true });
  assert.ok(run(["doc-link", host]).stdout.startsWith("doc_link=linked "));
  assert.ok(run(["doc-link", host]).stdout.startsWith("doc_link=ok "));

  const drySetup = spawnSync("sh", [setupPath, "--dry-run"], {
    cwd: host, encoding: "utf8", env: { ...process.env, SPIPE_HOST_ROOT: host }
  });
  assert.equal(drySetup.status, 0);
  assert.ok(drySetup.stdout.includes("would_link docs/process/skill_command"));
  const setup = spawnSync("sh", [setupPath], {
    cwd: host, encoding: "utf8", env: { ...process.env, SPIPE_HOST_ROOT: host }
  });
  assert.equal(setup.status, 0, setup.stderr);
  assert.ok(setup.stdout.includes("linked docs/process/skill_command"));
  const doctor = run(["doctor", host], 1);
  assert.ok(doctor.stdout.includes("source_ok doc/00_llm_process/spipe"));
  assert.ok(doctor.stdout.includes("spipe_doctor=fail"));

  assert.ok(run(["info"]).stdout.includes(`spipe_module=${moduleRoot}\n`));
  assert.ok(run(["experts"]).stdout.includes("project_expert="));
  assert.ok(run(["skill"]).stdout.startsWith("# SPipe Test Writing Skill\n"));
  assert.ok(run(["fine-tune-guide"]).stdout.length > 100);
  assert.ok(run(["fine-tune-model-guide"]).stdout.length > 100);
  assert.ok(run(["fine-tune-template"]).stdout.includes("attempt_id:"));

  run(["fine-tune-init"]);
  run(["fine-tune-new-attempt", "a1", "compat goal", "fixture-app"]);
  run(["fine-tune-record-data", "a1", "data", "fixture", "MIT", "true", "cache/data", "sha256:test"]);
  run(["fine-tune-record-data-check", "a1", "data", "cache/data", "pass", "sha256:test", "checked"]);
  assert.ok(run(["fine-tune-data-plan", "a1"]).stdout.includes("data_downloads:"));
  run(["fine-tune-record-model", "a1", "model", "rev1", "fixture", "local"]);
  run(["fine-tune-record-model-research", "a1", "model", "MIT", "4096", "fits", "none", "select"]);
  run(["fine-tune-record-model-arch", "a1", "doc/model.md", "decoder", "fixture", "lora", "local", "base"]);
  run(["fine-tune-scaffold-model-arch", "a1", "doc/model_scaffold.md", "decoder", "fixture", "lora", "local", "base"]);
  run(["fine-tune-record-method", "a1", "local-lora", "fixture", "base", "tester"]);
  assert.ok(run(["fine-tune-model-method-options", "a1"]).stdout.includes("local-lora"));
  run(["fine-tune-select-model-method", "a1", "model", "rev1", "local", "local-lora", "tester", "base"]);
  run(["fine-tune-record-training", "a1", "local-lora", "train.sh", "sh train.sh", "model.bin"]);
  run(["fine-tune-scaffold-training", "a1", "local-lora", ".spipe/llm-finetune-process/scripts/train.sh", "model.bin"]);
  run(["fine-tune-record-eval", "a1", "true", "accuracy=1", "accuracy=1", "pass"]);
  run(["fine-tune-record-decision", "a1", "retry-implementation", "implementation", "a2", "fixture"]);
  run(["fine-tune-create-retry", "a1", "a2", "retry goal", "fixture-app"]);
  run(["fine-tune-record-verify-loop", "a2", "true", "accuracy=1", "accuracy=1", "pass", "accepted"]);
  const retryLoop = run(["fine-tune-record-verify-loop", "a2", "true", "accuracy=0", "accuracy=1", "fail", "retry-implementation", "implementation", "a3", "retry"]);
  assert.ok(retryLoop.stdout.includes("retune_requests.sdn"));
  assert.ok(readFileSync(join(host, ".spipe/llm-finetune-process/attempts/a3.sdn"), "utf8").includes('attempt_id: "a3"'));
  run(["fine-tune-record-process", "a1", "r.md", "req.md", "nfr.md", "plan.md", "arch.md", "design.md"]);
  run(["fine-tune-scaffold-process-docs", "a1", "fixture_feature", "Fixture Feature"]);
  run(["fine-tune-record-requirements", "a1", "Option A", "Option A", "tester", "selection.md", "fixture"]);

  const optionFixture = join(testRoot, "fixture/fine_tune_options.md");
  const featureOptions = join(host, "doc/02_requirements/feature/spipe_llm_finetune_process_options.md");
  const nfrOptions = join(host, "doc/02_requirements/nfr/spipe_llm_finetune_process_options.md");
  mkdirSync(dirname(featureOptions), { recursive: true });
  mkdirSync(dirname(nfrOptions), { recursive: true });
  cpSync(optionFixture, featureOptions);
  cpSync(optionFixture, nfrOptions);
  assert.ok(run(["fine-tune-options"]).stdout.includes("A: Fixture Choice"));
  run(["fine-tune-select-requirements", "a1", "A", "A", "tester", "fixture"]);
  run(["fine-tune-record-app", "a1", "fixture-app", "test", "handoff.md", "MIT", "pass", "local"]);
  run(["fine-tune-record-retune", "a1", "fixture", "eval", "a2", "implementation"]);
  assert.ok(readFileSync(join(host, ".spipe/llm-finetune-process/app_handoffs.sdn"), "utf8").includes('attempt_id: "a1"'));
  assert.ok(readFileSync(join(host, ".spipe/llm-finetune-process/retune_requests.sdn"), "utf8").includes('attempt_id: "a1"'));
  assert.ok(run(["fine-tune-app-handoff", "a1"]).stdout.includes("# SPipe LLM App/Server Handoff"));
  assert.ok(run(["fine-tune-status", "a1"]).stdout.includes("attempt_id=a1"));
  run(["fine-tune-doctor", "a1"], 1);
  run(["fine-tune-ready", "a1"], 1);
  assert.ok(run(["fine-tune-next", "a1"], 1).stdout.includes("STATUS: WARN llm-finetune-next"));
  assert.ok(run(["fine-tune-report", "a1"]).stdout.includes("a1"));
  run(["fine-tune-verify", join(host, ".spipe/llm-finetune-process/attempts/a1.sdn")], 1);
  console.log("STATUS: PASS spipe-legacy-host-fine-tune-workflows");
} finally {
  rmSync(host, { recursive: true, force: true });
}
