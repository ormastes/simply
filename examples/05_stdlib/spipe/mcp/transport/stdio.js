import { errorResult } from "../protocol/errors.js";
import { stableJson } from "../../src/format/stable.js";

export function createLineHandler(router, write) {
  return function handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
      const response = router(message);
      if (response !== undefined) write(`${stableJson(response)}\n`);
    } catch (error) {
      // Legacy SPipe reports handler and parse failures with a null id. Keep
      // that wire behavior through the protocol-neutral Wave 1 extraction;
      // request-id preservation belongs to the later versioned MCP migration.
      write(`${stableJson(errorResult(null, error))}\n`);
    }
  };
}

export function runStdioTransport(router, input = process.stdin, output = process.stdout) {
  let buffer = "";
  const handleLine = createLineHandler(router, (content) => output.write(content));
  input.setEncoding("utf8");
  input.on("data", (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) handleLine(line);
    }
  });
}
