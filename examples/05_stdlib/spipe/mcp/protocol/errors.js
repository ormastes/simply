export function errorResult(id, error) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: Number.isInteger(error?.code) ? error.code : -32000,
      message: error?.message || String(error)
    }
  };
}
