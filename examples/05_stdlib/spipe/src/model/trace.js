import {
  assertCanonicalUid, immutableRecord, normalizeCanonicalPath, normalizeEnum,
  normalizeHash, normalizeOptionalHash, normalizeRevision, normalizeSemanticKey,
  normalizeText, requireInteger, sortedUnique
} from "./identity.js";
import { createSourceLocation } from "./source_location.js";

export const REQUIREMENT_STATUSES = Object.freeze(["proposed", "accepted", "designed", "specified", "implemented", "verified", "superseded", "stale", "deprecated"]);
export const SCENARIO_STATUSES = Object.freeze(["candidate", "proposed", "accepted", "deprecated"]);
export const SYMBOL_STATUSES = Object.freeze(["candidate", "accepted", "deprecated"]);
export const TEST_STATUSES = SYMBOL_STATUSES;
export const SYMBOL_KINDS = Object.freeze(["module", "type", "function", "method", "constructor", "field", "constant", "trait", "interface", "enum", "variant"]);
export const TEST_KINDS = Object.freeze(["unit", "integration", "system"]);

function exact(input, fields, name) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError(`${name} must be an object`);
  const actual = Object.keys(input).sort();
  const expected = [...fields].sort();
  if (actual.join("\0") !== expected.join("\0")) throw new TypeError(`${name} fields must match the canonical schema exactly`);
}

const REQUIREMENT_FIELDS = ["type", "uid", "kind", "key", "display_id", "project_uid", "revision_id", "artifact_uid", "section_uid", "title", "status", "content_hash", "aliases"];
export function createRequirementRecord(input) {
  exact(input, REQUIREMENT_FIELDS, "requirement");
  const isNfr = input.type === "non_functional_requirement";
  if ((!isNfr && input.type !== "requirement") || input.kind !== (isNfr ? "nfr" : "requirement")) throw new TypeError("requirement type and kind must agree");
  const display_id = normalizeText(input.display_id, "display_id");
  if (!/^(?:REQ|NFR)-[A-Z0-9]+(?:-[A-Z0-9]+)+$/.test(display_id) || display_id.startsWith(isNfr ? "REQ-" : "NFR-")) throw new TypeError("display_id does not match requirement kind");
  return immutableRecord({
    type: input.type, uid: assertCanonicalUid(input.uid, "uid", [isNfr ? "NFR" : "RQ"]), kind: input.kind,
    key: normalizeSemanticKey(input.key), display_id,
    project_uid: assertCanonicalUid(input.project_uid, "project_uid", ["P"]), revision_id: normalizeRevision(input.revision_id, "revision_id"),
    artifact_uid: assertCanonicalUid(input.artifact_uid, "artifact_uid", ["A"]), section_uid: assertCanonicalUid(input.section_uid, "section_uid", ["S"]),
    title: normalizeText(input.title, "title").trim(), status: normalizeEnum(input.status, REQUIREMENT_STATUSES, "status"),
    content_hash: normalizeHash(input.content_hash), aliases: sortedUnique(input.aliases, "aliases", (v) => normalizeSemanticKey(v, "alias"))
  });
}

const SCENARIO_FIELDS = ["type", "uid", "key", "project_uid", "revision_id", "artifact_uid", "title", "ordinal", "source_location", "content_hash", "requirement_uids", "status"];
export function createSSpecScenarioRecord(input) {
  exact(input, SCENARIO_FIELDS, "sspec_scenario");
  if (input.type !== "sspec_scenario") throw new TypeError("scenario type must be sspec_scenario");
  const location = createSourceLocation(input.source_location);
  const artifact_uid = assertCanonicalUid(input.artifact_uid, "artifact_uid", ["A"]);
  if (location.source_artifact_uid !== artifact_uid) throw new TypeError("scenario source artifact must equal artifact_uid");
  return immutableRecord({ type: "sspec_scenario", uid: assertCanonicalUid(input.uid, "uid", ["SS"]), key: normalizeSemanticKey(input.key),
    project_uid: assertCanonicalUid(input.project_uid, "project_uid", ["P"]), revision_id: normalizeRevision(input.revision_id, "revision_id"), artifact_uid,
    title: normalizeText(input.title, "title").trim(), ordinal: requireInteger(input.ordinal, "ordinal", { max: 4294967295 }), source_location: location,
    content_hash: normalizeHash(input.content_hash), requirement_uids: sortedUnique(input.requirement_uids, "requirement_uids", (v) => assertCanonicalUid(v, "requirement_uid", ["RQ", "NFR"])),
    status: normalizeEnum(input.status, SCENARIO_STATUSES, "status") });
}

const SYMBOL_FIELDS = ["type", "uid", "project_uid", "revision_id", "canonical_path", "symbol_kind", "name", "qualified_name", "signature_hash", "source_location", "content_hash", "annotation_uids", "status"];
export function createSourceSymbolRecord(input) {
  exact(input, SYMBOL_FIELDS, "source_symbol");
  if (input.type !== "source_symbol") throw new TypeError("symbol type must be source_symbol");
  const signature_hash = normalizeOptionalHash(input.signature_hash, "signature_hash");
  const symbol_kind = normalizeEnum(input.symbol_kind, SYMBOL_KINDS, "symbol_kind");
  if (signature_hash == null && symbol_kind !== "module") throw new TypeError("only module symbols may omit signature_hash");
  return immutableRecord({ type: "source_symbol", uid: assertCanonicalUid(input.uid, "uid", ["SY"]), project_uid: assertCanonicalUid(input.project_uid, "project_uid", ["P"]),
    revision_id: normalizeRevision(input.revision_id, "revision_id"), canonical_path: normalizeCanonicalPath(input.canonical_path), symbol_kind,
    name: normalizeText(input.name, "name"), qualified_name: normalizeText(input.qualified_name, "qualified_name"), signature_hash,
    source_location: createSourceLocation(input.source_location), content_hash: normalizeHash(input.content_hash),
    annotation_uids: sortedUnique(input.annotation_uids, "annotation_uids", (v) => assertCanonicalUid(v, "annotation_uid", ["RQ", "NFR", "SS"])),
    status: normalizeEnum(input.status, SYMBOL_STATUSES, "status") });
}

const TEST_FIELDS = ["type", "uid", "test_kind", "project_uid", "revision_id", "artifact_uid", "scenario_uid", "title", "source_location", "content_hash", "verifies_uids", "status"];
export function createTestRecord(input) {
  exact(input, TEST_FIELDS, "test");
  if (input.type !== "test") throw new TypeError("test type must be test");
  const artifact_uid = assertCanonicalUid(input.artifact_uid, "artifact_uid", ["A"]);
  const source_location = createSourceLocation(input.source_location);
  if (source_location.source_artifact_uid !== artifact_uid) throw new TypeError("test source artifact must equal artifact_uid");
  return immutableRecord({ type: "test", uid: assertCanonicalUid(input.uid, "uid", ["T"]), test_kind: normalizeEnum(input.test_kind, TEST_KINDS, "test_kind"),
    project_uid: assertCanonicalUid(input.project_uid, "project_uid", ["P"]), revision_id: normalizeRevision(input.revision_id, "revision_id"), artifact_uid,
    scenario_uid: input.scenario_uid == null ? null : assertCanonicalUid(input.scenario_uid, "scenario_uid", ["SS"]), title: normalizeText(input.title, "title").trim(), source_location,
    content_hash: normalizeHash(input.content_hash), verifies_uids: sortedUnique(input.verifies_uids, "verifies_uids", (v) => assertCanonicalUid(v, "verifies_uid")),
    status: normalizeEnum(input.status, TEST_STATUSES, "status") });
}
