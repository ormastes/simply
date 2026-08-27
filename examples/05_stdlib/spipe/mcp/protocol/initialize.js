export const PROTOCOL_VERSION = "2024-11-05";

export function initializeResult() {
  return {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: { tools: {}, resources: {} },
    serverInfo: { name: "spipe", version: "0.2.0" }
  };
}
