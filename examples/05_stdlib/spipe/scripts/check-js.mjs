#!/usr/bin/env node
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function javascriptFiles(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return javascriptFiles(path);
    return entry.isFile() && /\.(?:js|mjs)$/.test(entry.name) ? [path] : [];
  });
}

const files = ["cli", "mcp", "src", "test"]
  .flatMap(javascriptFiles)
  .concat(["scripts/check-js.mjs"])
  .sort();

for (const file of files) {
  const checked = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (checked.status !== 0) process.exit(checked.status ?? 1);
}

console.log(`STATUS: PASS javascript-syntax files=${files.length}`);
