import { CONTRACTS, CAPABILITIES, assertClosedObject, searchFail } from "../index/contracts.js";

export const PROTOCOL = Object.freeze({ major: 1, minor: 0 });
export const PROVIDER_LIMITS = Object.freeze({
  max_frame_bytes: 1_048_576, max_query_bytes: 4096,
  max_query_tokens: 128, max_filters: 32, max_values_per_filter: 64,
  max_hits: 1000, max_delta_documents: 1000, max_fields_per_document: 5,
  max_field_value_bytes: 1_048_576, max_explanation_terms: 128,
  max_explanation_fields: 5, max_explanation_bytes_per_hit: 65_536,
  max_page_bytes: 524_288, min_deadline_ms: 1, max_deadline_ms: 30_000
});

export function createInitializeResult({ request_id, implementation_digest }) {
  return Object.freeze({
    request_id, operation: "initialize", ok: true,
    result: Object.freeze({
      protocol: PROTOCOL, provider: CONTRACTS.provider, implementation_digest,
      provider_ids: Object.freeze([CONTRACTS.provider]), analyzer_ids: Object.freeze([CONTRACTS.analyzer]),
      score_ids: Object.freeze([CONTRACTS.score]), explanation_ids: Object.freeze([CONTRACTS.explanation]),
      logical_index_ids: Object.freeze([CONTRACTS.logical_index]), capabilities: CAPABILITIES,
      limits: PROVIDER_LIMITS, optional_fields: Object.freeze([])
    })
  });
}

export function validateInitializeRequest(request) {
  assertClosedObject(request, ["request_id", "operation", "protocol", "client", "required", "limits"], "InitializeRequestV1");
  if (request.operation !== "initialize" || request.client !== "spipe" || request.protocol?.major !== 1 || request.protocol?.minor !== 0) searchFail("protocol_unsupported", "provider protocol 1.0 is required");
  assertClosedObject(request.protocol, ["major", "minor"], "ProtocolV1");
  assertClosedObject(request.required, ["provider", "analyzer", "score", "explanation", "logical_index"], "RequiredContractsV1");
  assertClosedObject(request.limits, ["max_frame_bytes"], "InitializeLimitsV1");
  if (request.limits.max_frame_bytes !== 1_048_576) searchFail("limit_exceeded", "initialization frame limit must be 1 MiB");
  for (const name of ["provider", "analyzer", "score", "explanation", "logical_index"]) if (request.required?.[name] !== CONTRACTS[name]) searchFail("incompatible_contract", `${name} contract mismatch`);
  return request;
}

export function validateInitialization(result) {
  assertClosedObject(result, ["request_id", "operation", "ok", "result"], "InitializeResultV1");
  assertClosedObject(result.result, ["protocol", "provider", "implementation_digest", "provider_ids", "analyzer_ids", "score_ids", "explanation_ids", "logical_index_ids", "capabilities", "limits", "optional_fields"], "InitializeResultV1.result");
  assertClosedObject(result.result.protocol, ["major", "minor"], "ProtocolV1");
  assertClosedObject(result.result.capabilities, ["index_delta", "lexical", "explain", "stats", "cancel", "shutdown", "phrase", "regex", "wildcard", "duplicate", "symbols", "semantic", "scope_partition"], "ProviderCapabilitiesV1");
  assertClosedObject(result.result.limits, ["max_frame_bytes", "max_query_bytes", "max_query_tokens", "max_filters", "max_values_per_filter", "max_hits", "max_delta_documents", "max_fields_per_document", "max_field_value_bytes", "max_explanation_terms", "max_explanation_fields", "max_explanation_bytes_per_hit", "max_page_bytes", "min_deadline_ms", "max_deadline_ms"], "ProviderLimitsV1");
  if (!result?.ok || result.operation !== "initialize" || result.result?.protocol?.major !== 1 || result.result?.protocol?.minor !== 0 || result.result.provider !== CONTRACTS.provider) searchFail("protocol_unsupported", "invalid initialization result");
  if (!/^sha256:[a-f0-9]{64}$/.test(result.result.implementation_digest)) searchFail("invalid_request", "implementation_digest must be HashText");
  if (!Array.isArray(result.result.optional_fields) || result.result.optional_fields.length !== 0) searchFail("incompatible_contract", "protocol 1.0 optional_fields must be empty");
  const expected = { provider_ids: CONTRACTS.provider, analyzer_ids: CONTRACTS.analyzer, score_ids: CONTRACTS.score, explanation_ids: CONTRACTS.explanation, logical_index_ids: CONTRACTS.logical_index };
  for (const [field, identity] of Object.entries(expected)) {
    const ids = result.result[field];
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 16 || new Set(ids).size !== ids.length || ids.some((id, i) => i && Buffer.compare(Buffer.from(ids[i - 1]), Buffer.from(id)) >= 0) || !ids.includes(identity)) searchFail("incompatible_contract", `${field} is not a canonical admitted identity set`);
  }
  for (const [capability, value] of Object.entries(CAPABILITIES)) if (result.result.capabilities[capability] !== value) searchFail("incompatible_contract", `${capability} capability mismatch`);
  for (const [limit, value] of Object.entries(PROVIDER_LIMITS)) if (result.result.limits[limit] !== value) searchFail("limit_exceeded", `${limit} exceeds or differs from the v1 bound`);
  return true;
}

const OPERATION_FIELDS = Object.freeze({
  open: ["scope_digest", "documents"],
  apply: ["base_logical_root", "operations"],
  publish: ["candidate", "expected_base_logical_root"],
  search: ["query_text", "filters", "limit", "cursor", "explain"],
  explain: ["document_id", "query_text", "filters"],
  stats: ["logical_root"]
});

export function validateInProcessPayload(operation, payload) {
  const fields = OPERATION_FIELDS[operation];
  if (!fields) searchFail("unsupported_capability", `unsupported in-process operation ${operation}`);
  assertClosedObject(payload, fields, `${operation} payload`);
  if (["open", "apply", "search", "explain"].includes(operation)) {
    const array = operation === "open" ? payload.documents : operation === "apply" ? payload.operations : payload.filters;
    if (!Array.isArray(array)) searchFail("invalid_request", `${operation} array field is required`);
  }
  return payload;
}

export function healthProbe(provider, expectedRoot = null) {
  const health = provider.health();
  if (health.state !== "healthy") searchFail("provider_unavailable", "provider is not healthy");
  if (expectedRoot !== null && health.logical_root !== expectedRoot) searchFail("binding_mismatch", "provider logical-root probe failed");
  return Object.freeze(health);
}
