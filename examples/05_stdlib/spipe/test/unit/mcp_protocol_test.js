import assert from "node:assert/strict";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createRouter } from "../../mcp/protocol/router.js";
import { createLineHandler } from "../../mcp/transport/stdio.js";
import { stableJson, stableSdn } from "../../src/format/stable.js";

const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const route = createRouter({ moduleRoot });

test("initialize preserves protocol and request id", () => {
  const reply = route({ jsonrpc: "2.0", id: "request-7", method: "initialize" });
  assert.equal(reply.id, "request-7");
  assert.equal(reply.result.protocolVersion, "2024-11-05");
  assert.deepEqual(reply.result.capabilities, { tools: {}, resources: {} });
});

test("tools remain ordered and contain the compatibility surface", () => {
  const reply = route({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.deepEqual(reply.result.tools.map(({ name }) => name), [
    "spipe_info", "spipe_experts", "spipe_read_doc", "spipe_fine_tune_guide",
    "spipe_fine_tune_model_guide", "spipe_fine_tune_template"
  ]);
});

test("resource list and read preserve spipe skill", () => {
  const listed = route({ jsonrpc: "2.0", id: 2, method: "resources/list" });
  assert.deepEqual(listed.result.resources.map(({ uri }) => uri), ["spipe://skill"]);
  const read = route({ jsonrpc: "2.0", id: 3, method: "resources/read", params: { uri: "spipe://skill" } });
  assert.equal(read.result.contents[0].uri, "spipe://skill");
  assert.match(read.result.contents[0].text, /SPipe/);
});

test("notifications stay silent", () => {
  assert.equal(route({ jsonrpc: "2.0", method: "notifications/initialized" }), undefined);
});

test("recognized legacy messages without ids still produce id-less responses", () => {
  const output = [];
  const handleLine = createLineHandler(route, (line) => output.push(JSON.parse(line)));
  for (const method of ["initialize", "tools/list", "resources/list"]) {
    handleLine(JSON.stringify({ jsonrpc: "2.0", method }));
  }
  assert.equal(output.length, 3);
  assert.equal(Object.hasOwn(output[0], "id"), false);
  assert.equal(output[0].result.protocolVersion, "2024-11-05");
  assert.equal(output[1].result.tools.length, 6);
  assert.deepEqual(output[2].result.resources.map(({ uri }) => uri), ["spipe://skill"]);
});

test("notification namespace remains silent through the transport", () => {
  const output = [];
  const handleLine = createLineHandler(route, (line) => output.push(line));
  handleLine(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
  handleLine(JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled" }));
  assert.deepEqual(output, []);
});

test("transport preserves legacy null ids on handler errors", () => {
  const output = [];
  const handleLine = createLineHandler(route, (line) => output.push(JSON.parse(line)));
  handleLine(JSON.stringify({ jsonrpc: "2.0", id: 91, method: "tools/call", params: { name: "missing" } }));
  assert.equal(output[0].id, null);
  assert.equal(output[0].error.code, -32000);
  assert.match(output[0].error.message, /unknown tool/);
});

test("malformed JSON has a null error id", () => {
  const output = [];
  createLineHandler(route, (line) => output.push(JSON.parse(line)))("not-json");
  assert.equal(output[0].id, null);
});

test("stable serializers order nested values without collapsing them", () => {
  assert.equal(stableJson({ z: { b: 2, a: 1 }, a: [2, 1] }), '{"a":[2,1],"z":{"a":1,"b":2}}');
  assert.equal(stableSdn({ nested: { b: 2, a: 1 }, ready: true }),
    'nested: "{\\"a\\":1,\\"b\\":2}"\nready: true');
});
