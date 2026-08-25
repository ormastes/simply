function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  return value;
}

export function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function quoteSdn(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n")}"`;
}

export function stableSdn(value) {
  return Object.entries(stableValue(value)).map(([key, item]) => {
    if (item === null) return `${key}: null`;
    if (typeof item === "boolean" || typeof item === "number") return `${key}: ${item}`;
    if (typeof item === "object") return `${key}: ${quoteSdn(stableJson(item))}`;
    return `${key}: ${quoteSdn(item)}`;
  }).join("\n");
}
