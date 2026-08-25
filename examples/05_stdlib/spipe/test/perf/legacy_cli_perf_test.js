#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const testRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleRoot = resolve(testRoot, "..");
const cliPath = join(moduleRoot, "cli/spipe.js");
const baseline = JSON.parse(readFileSync(join(testRoot, "fixture/wave0_cli_perf_baseline.json"), "utf8"));
const host = mkdtempSync(join(tmpdir(), "spipe-perf-host-"));

function invoke(args) {
  const start = performance.now();
  const result = spawnSync(process.execPath, [cliPath, ...args], { cwd: host, stdio: "ignore", timeout: 10_000 });
  assert.ok(result.status === 0 || (args[0] === "doctor" && result.status === 1));
  return performance.now() - start;
}

function p95(args) {
  const samples = [];
  // Match the 80-sample qualification and remove first-load cache effects.
  for (let index = 0; index < 3; index += 1) invoke(args);
  for (let index = 0; index < baseline.testSamples; index += 1) {
    samples.push(invoke(args));
  }
  samples.sort((left, right) => left - right);
  return samples[Math.ceil(samples.length * 0.95) - 1];
}

try {
  const measured = {
    version: p95(["--version"]),
    help: p95(["--help"]),
    doctor: p95(["doctor", host])
  };
  for (const [name, milliseconds] of Object.entries(measured)) {
    const limit = baseline.p95Milliseconds[name] * baseline.maximumRegressionRatio;
    assert.ok(milliseconds <= limit,
      `${name} P95 ${milliseconds.toFixed(3)} ms exceeds qualified limit ${limit.toFixed(3)} ms`);
  }
  console.log(`version_p95_ms=${measured.version.toFixed(3)}`);
  console.log(`help_p95_ms=${measured.help.toFixed(3)}`);
  console.log(`doctor_p95_ms=${measured.doctor.toFixed(3)}`);
  console.log("STATUS: PASS spipe-wave0-cli-perf-regression");
} finally {
  rmSync(host, { recursive: true, force: true });
}
