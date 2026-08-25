export const CONTRACTS = Object.freeze({
  provider: "spipe-search-provider/1.0",
  analyzer: "spipe-unicode-lex-v1",
  score: "bm25-fixed-v1",
  explanation: "bm25-explain-v1",
  logical_index: "spipe-lexical-snapshot-v1",
  fusion: "rrf-fixed-v1"
});

export const FIELD_CONTRACT = Object.freeze([
  Object.freeze({ name: "identifier", weight_milli: 4000 }),
  Object.freeze({ name: "title", weight_milli: 4000 }),
  Object.freeze({ name: "heading", weight_milli: 2500 }),
  Object.freeze({ name: "classification", weight_milli: 2000 }),
  Object.freeze({ name: "body", weight_milli: 1000 })
]);

export const CAPABILITIES = Object.freeze({
  index_delta: true, lexical: true, explain: true, stats: true,
  cancel: true, shutdown: true, phrase: false, regex: false,
  wildcard: false, duplicate: false, symbols: false, semantic: false,
  scope_partition: "independent"
});

export class SearchContractError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "SearchContractError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export function searchFail(code, message, details) {
  throw new SearchContractError(code, message, details);
}

export function assertClosedObject(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) searchFail("invalid_request", `${label} must be an object`);
  const actual = Object.keys(value);
  if (actual.length !== fields.length || actual.some((field, index) => field !== fields[index])) {
    searchFail("invalid_request", `${label} fields must be closed and ordered`, { expected: fields, actual });
  }
  return value;
}

export function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export function assertSafeInteger(value, label, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) searchFail("invalid_request", `${label} is outside its integer bounds`);
  return value;
}

export function checkedI128(value, code = "score_overflow") {
  const min = -(1n << 127n), max = (1n << 127n) - 1n;
  if (value < min || value > max) searchFail(code, "checked i128 arithmetic overflow");
  return value;
}
