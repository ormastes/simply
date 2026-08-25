#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const testRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleRoot = resolve(testRoot, "..");
const fixtureRoot = join(testRoot, "fixture");
const cliPath = join(moduleRoot, "cli", "spipe.js");
const mcpPath = join(moduleRoot, "mcp", "server.js");
const isolatedCwd = mkdtempSync(join(tmpdir(), "spipe-legacy-compat-"));

function loadFixture(name) {
  return JSON.parse(readFileSync(join(fixtureRoot, name), "utf8"));
}

function runCli(contract) {
  const result = spawnSync(process.execPath, [cliPath, ...contract.args], {
    cwd: isolatedCwd,
    encoding: "utf8",
    timeout: 10_000
  });
  assert.ifError(result.error);
  assert.equal(result.status, contract.exitCode);
  assert.equal(result.stderr, contract.stderr);
  if (contract.stdout !== undefined) assert.equal(result.stdout, contract.stdout);
  if (contract.stdoutBytes !== undefined) assert.equal(Buffer.byteLength(result.stdout), contract.stdoutBytes);
  if (contract.stdoutStartsWith) assert.ok(result.stdout.startsWith(contract.stdoutStartsWith));
  for (const fragment of contract.stdoutContains || []) assert.ok(result.stdout.includes(fragment));
  return result.stdout;
}

async function runMcp(requests) {
  return await new Promise((accept, reject) => {
    const child = spawn(process.execPath, [mcpPath], {
      cwd: isolatedCwd,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("legacy MCP server did not close within 10 seconds"));
    }, 10_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timeout);
      try {
        assert.equal(code, 0);
        assert.equal(stderr, "");
        accept(stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(`${requests.map((request) => JSON.stringify(request)).join("\n")}\n`);
  });
}

try {
  const cli = loadFixture("legacy_cli.json");
  runCli(cli.help);
  runCli(cli.version);
  const info = runCli(cli.info)
    .replaceAll(moduleRoot, "<MODULE_ROOT>")
    .trimEnd()
    .split("\n");
  assert.deepEqual(info, cli.info.normalizedStdout);

  const mcp = loadFixture("legacy_mcp.json");
  const responses = await runMcp(mcp.requests);
  assert.equal(responses.length, mcp.responseCount, "notifications must remain silent");

  const byId = new Map(responses.filter((item) => item.id !== null).map((item) => [item.id, item]));
  assert.equal(byId.get(1).result.protocolVersion, mcp.protocolVersion);
  assert.deepEqual(byId.get(1).result.serverInfo, mcp.serverInfo);
  assert.deepEqual(byId.get(2).result.tools, mcp.toolSchemas);
  assert.deepEqual(byId.get(3).result.resources, [{
    uri: mcp.resource.uri,
    name: mcp.resource.name,
    mimeType: mcp.resource.mimeType,
    description: mcp.resource.description
  }]);

  const content = byId.get(4).result.contents[0];
  assert.equal(content.uri, mcp.resource.uri);
  assert.equal(content.mimeType, mcp.resource.mimeType);
  assert.ok(content.text.startsWith(mcp.resource.textStartsWith));

  const infoText = byId.get(5).result.content[0].text.replaceAll(moduleRoot, "<MODULE_ROOT>");
  assert.ok(infoText.startsWith("module=<MODULE_ROOT>\n"));
  assert.ok(infoText.includes("surface=doc/00_llm_process/spipe"));
  assert.ok(byId.get(6).result.content[0].text.includes("project_expert="));
  assert.ok(byId.get(7).result.content[0].text.startsWith("# SPipe"));
  assert.ok(byId.get(8).result.content[0].text.length > 100);
  assert.ok(byId.get(9).result.content[0].text.length > 100);
  assert.ok(byId.get(10).result.content[0].text.includes("attempt_id:"));

  const legacyError = responses.find((item) => item.id === null);
  assert.equal(legacyError.id, mcp.legacyError.id);
  assert.equal(legacyError.error.code, mcp.legacyError.code);
  assert.equal(legacyError.error.message, mcp.legacyError.message);
  console.log("STATUS: PASS spipe-legacy-cli-mcp-compat");
} finally {
  rmSync(isolatedCwd, { recursive: true, force: true });
}
