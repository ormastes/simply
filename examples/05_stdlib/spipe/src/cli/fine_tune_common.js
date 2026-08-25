import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const retryStatuses = new Set([
  "retry-implementation",
  "retry-data-research",
  "retry-base-model",
  "retry-tuning-method",
  "try-other-way"
]);

export function readQuotedValue(content, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...content.matchAll(new RegExp(`^\\s*${escaped}:\\s*"([^"]*)"\\s*$`, "gm"))];
  return matches.length ? matches[matches.length - 1][1] : "";
}

export function quoteSdn(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n");
}

export function initRegistry(root, fileName, header, rootKey) {
  const registryPath = join(root, fileName);
  mkdirSync(root, { recursive: true });
  if (!existsSync(registryPath)) writeFileSync(registryPath, `${header}\n\n${rootKey}:\n`);
  return registryPath;
}

export function validateAttemptId(commandName, attemptId) {
  if (!/^[A-Za-z0-9_.-]+$/.test(attemptId)) {
    console.error(`spipe ${commandName}: attempt_id may contain only letters, numbers, dot, dash, and underscore`);
    process.exitCode = 2;
    return false;
  }
  return true;
}

export function registryBlockForAttempt(root, fileName, attemptId) {
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
    if (inAttempt) out.push(line);
  }
  if (inAttempt) latest = out;
  return latest.join("\n").trimEnd();
}
