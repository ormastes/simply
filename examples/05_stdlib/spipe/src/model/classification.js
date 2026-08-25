import { assertCanonicalUid, canonicalBytes, crockfordDigestPayload, immutableRecord, normalizeEnum, normalizeHash, normalizeSemanticKey } from "./identity.js";

export const CLASSIFICATION_KINDS = Object.freeze(["feature", "component", "layer", "tag"]);
const PREFIX = Object.freeze({ feature: "F", component: "C", layer: "L", tag: "TG" });

export function deriveClassificationUid({ workspace_uid, project_uid = null, classification_kind, key }) {
  const kind = normalizeEnum(classification_kind, CLASSIFICATION_KINDS, "classification_kind");
  const tuple = [assertCanonicalUid(workspace_uid, "workspace_uid", ["WS"]), project_uid == null ? null : assertCanonicalUid(project_uid, "project_uid", ["P"]), kind, normalizeSemanticKey(key)];
  const bytes = Buffer.concat([Buffer.from("spipe-classification-v1\0", "utf8"), canonicalBytes(tuple)]);
  return `${PREFIX[kind]}-${crockfordDigestPayload(bytes)}`;
}

export function createClassificationRecord(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("classification must be an object");
  const fields = ["type", "uid", "classification_kind", "key", "workspace_uid", "project_uid", "source_hash", "status"];
  if (Object.keys(input).sort().join("\0") !== fields.sort().join("\0")) throw new TypeError("classification fields must match the canonical schema exactly");
  const classification_kind = normalizeEnum(input.classification_kind, CLASSIFICATION_KINDS, "classification_kind");
  const workspace_uid = assertCanonicalUid(input.workspace_uid, "workspace_uid", ["WS"]);
  const project_uid = input.project_uid == null ? null : assertCanonicalUid(input.project_uid, "project_uid", ["P"]);
  const key = normalizeSemanticKey(input.key);
  const uid = assertCanonicalUid(input.uid, "uid", [PREFIX[classification_kind]]);
  if (uid !== deriveClassificationUid({ workspace_uid, project_uid, classification_kind, key })) throw new TypeError("classification UID does not match canonical derivation");
  if (input.type !== "classification" || input.status !== "active") throw new TypeError("classification type/status must be classification/active");
  return immutableRecord({ type: "classification", uid, classification_kind, key, workspace_uid, project_uid, source_hash: normalizeHash(input.source_hash, "source_hash"), status: "active" });
}
