import {
  assertUid,
  assertCanonicalUid,
  compareLexical,
  immutableRecord,
  normalizeHash,
  normalizeSemanticKey,
  normalizeText,
  requireInteger,
  sortedUnique
} from "./identity.js";

const MARKER_PATTERN = /^<!--\s*spipe:section\s+uid=([^\s]+)\s+key=([^\s]+)\s*-->$/;

function sourceSpan(value) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("source_span must be an object");
  const startByte = requireInteger(value.start_byte, "source_span.start_byte");
  const endByte = requireInteger(value.end_byte, "source_span.end_byte");
  if (endByte < startByte) throw new TypeError("source_span.end_byte must not precede start_byte");
  return Object.freeze({ start_byte: startByte, end_byte: endByte });
}

export function createSectionRecord(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("section must be an object");
  }
  const record = {
    type: "section",
    uid: assertCanonicalUid(input.uid, "uid", ["S"]),
    artifact_uid: assertUid(input.artifact_uid, "artifact_uid", ["A", "P"]),
    key: normalizeSemanticKey(input.key, "key"),
    heading: normalizeText(input.heading, "heading").trim(),
    ordinal: requireInteger(input.ordinal, "ordinal"),
    source_span: sourceSpan(input.source_span),
    content_hash: normalizeHash(input.content_hash, "content_hash"),
    aliases: sortedUnique(input.aliases, "aliases", (item) => normalizeText(item, "alias").trim()),
    managed: true,
    marker_present: true,
    identity_status: "canonical"
  };
  if (!record.heading) throw new TypeError("section heading must not be empty");
  if (input.marker_present === false || input.identity_status === "provisional") {
    throw new TypeError("markerless sections are SectionCandidate records, not canonical SectionRecord values");
  }
  return immutableRecord(record);
}

export function parseSectionMarker(line) {
  const text = normalizeText(line, "section_marker").trim();
  const match = MARKER_PATTERN.exec(text);
  if (!match) return null;
  return immutableRecord({
    uid: assertUid(match[1], "uid", ["S"]),
    key: normalizeSemanticKey(match[2], "key")
  });
}

export function formatSectionMarker({ uid, key }) {
  return `<!-- spipe:section uid=${assertUid(uid, "uid", ["S"])} key=${normalizeSemanticKey(key, "key")} -->`;
}

export function headingSlug(heading) {
  return normalizeText(heading, "heading").trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function sectionSortKey(record) {
  return `${record.artifact_uid}\u0000${String(record.ordinal).padStart(12, "0")}\u0000${record.uid}`;
}

export function sortSections(records) {
  if (!Array.isArray(records)) throw new TypeError("sections must be an array");
  return [...records].sort((left, right) => compareLexical(sectionSortKey(left), sectionSortKey(right)));
}

export const SectionRecord = createSectionRecord;
