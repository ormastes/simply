#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDoc } from "../../mcp/protocol/tools.js";

const root = mkdtempSync(join(tmpdir(), "spipe-mcp-security-"));
const outside = mkdtempSync(join(tmpdir(), "spipe-mcp-outside-"));

try {
  mkdirSync(join(root, "doc/00_llm_process/spipe"), { recursive: true });
  writeFileSync(join(root, "README.md"), "# allowed\n");
  writeFileSync(join(outside, "secret.md"), "legacy-symlink-target\n");
  symlinkSync(outside, join(root, "doc/00_llm_process/spipe/external"));

  assert.equal(readDoc(root, "README.md"), "# allowed\n");
  assert.throws(() => readDoc(root, "../README.md"), /relative path inside/);
  assert.throws(() => readDoc(root, "/etc/passwd"), /relative path inside/);
  assert.throws(() => readDoc(root, "\\server\\share"), /relative path inside/);
  assert.throws(() => readDoc(root, "package.json"), /outside the SPipe documentation allowlist/);
  assert.throws(() => readDoc(root, "doc/00_llm_process/spipe/missing.md"), /document not found/);

  // Retain the legacy contract explicitly: lexical allowlisting does not resolve
  // symlinks. A later security hardening must update this fixture deliberately.
  assert.equal(readDoc(root, "doc/00_llm_process/spipe/external/secret.md"), "legacy-symlink-target\n");
  console.log("STATUS: PASS spipe-legacy-mcp-read-security-contract");
} finally {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
}
