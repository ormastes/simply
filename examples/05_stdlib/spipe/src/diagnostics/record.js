import { deepFreeze } from "../model/identity.js";

/** Construct the single canonical diagnostic data shape used by Wave 3. */
export function createDiagnosticRecord(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("diagnostic must be an object");
  const required = ["code", "severity", "message_key"];
  if (required.some((field) => typeof input[field] !== "string" || input[field].length === 0)) {
    throw new TypeError("diagnostic code, severity, and message_key must be non-empty strings");
  }
  return deepFreeze({
    type: "diagnostic", code: input.code, severity: input.severity, message_key: input.message_key,
    arguments: { ...(input.arguments ?? {}) }, project_uid: input.project_uid ?? null,
    revision_id: input.revision_id ?? null, snapshot_uid: input.snapshot_uid ?? null,
    artifact_uid: input.artifact_uid ?? input.arguments?.artifact_uid ?? null,
    source_span: input.source_span ?? null,
    related_uids: [...new Set(input.related_uids ?? [])].sort(),
    remediation: input.remediation ?? null, cause_chain: [...(input.cause_chain ?? [])],
  });
}
