import { contentHash } from "../core/identity.js";
import { deepFreeze } from "../model/identity.js";
import { createVerifiedSourceLocation } from "../model/source_location.js";
import { createDiagnosticRecord } from "../diagnostics/record.js";

const REQUIREMENT_HEADING = /^(REQ|NFR)-[A-Z0-9]+(?:-[A-Z0-9]+)+ — (\S(?:.*\S)?)$/u;
const MARKER = /^\s*(?:<!--\s*|#\s*)spipe:([a-z_]+)\s+(.+?)(?:\s*-->)?\s*$/i;
const UID = /^[A-Z][A-Z0-9]*-(?:[0-9A-F]{32}|[0-9A-HJKMNP-TV-Z]{26})$/;

function diagnostic(code, messageKey, args = {}, severity = "error", context = {}) {
  return createDiagnosticRecord({
    code, severity, message_key: messageKey, arguments: args,
    project_uid: context.project_uid ?? null, revision_id: context.revision_id ?? null,
    snapshot_uid: context.snapshot_uid ?? null, artifact_uid: context.artifact_uid ?? args.artifact_uid ?? null,
    source_span: context.source_span ?? null, related_uids: [...new Set(context.related_uids ?? [])].sort(),
    remediation: context.remediation ?? null, cause_chain: [...(context.cause_chain ?? [])],
  });
}

function normalizedSource(input) {
  const source = typeof input === "string" ? input : String(input?.content ?? "");
  return source.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

function offsets(source) {
  const result = [];
  let character = 0;
  for (const line of source.split("\n")) {
    result.push(Buffer.byteLength(source.slice(0, character), "utf8"));
    character += line.length + 1;
  }
  return result;
}

function parseAttributes(text) {
  const result = {};
  for (const token of text.trim().split(/\s+/)) {
    const separator = token.indexOf("=");
    if (separator < 1 || separator === token.length - 1) return null;
    const key = token.slice(0, separator);
    if (Object.hasOwn(result, key)) return null;
    result[key] = token.slice(separator + 1);
  }
  return result;
}

function marker(line, expected) {
  const match = MARKER.exec(line);
  if (!match || (expected && match[1].toLowerCase() !== expected)) return null;
  const attributes = parseAttributes(match[2]);
  return attributes ? { kind: match[1].toLowerCase(), attributes } : { kind: match[1].toLowerCase(), invalid: true };
}

function list(value) {
  if (value === "none" || value == null) return [];
  const values = value.split(",");
  return values.length && values.every((entry) => entry && entry.trim() === entry) &&
    new Set(values).size === values.length && values.every((entry, index) => index === 0 || values[index - 1] < entry)
    ? values : null;
}

function sourceLocation(artifact, span) {
  return { source_artifact_uid: artifact.uid, source_hash: artifact.content_hash, span };
}

function provenance(context, artifact, location) {
  return {
    project_uid: artifact.project_uid,
    worktree_uid: context.worktreeUid ?? null,
    revision_id: context.revisionId ?? artifact.revision,
    input_snapshot_uid: context.snapshotUid ?? null,
    source_uid: artifact.uid,
    source_location: location,
    decision_uid: null,
  };
}

function candidate(edgeType, fromUid, targetRef, artifact, location, context, evidenceUids = []) {
  return {
    edge_type: edgeType, from_uid: fromUid, target_ref: targetRef,
    origin: "explicit", status: "proposed", confidence_milli: 1000,
    created_by: context.principal ?? "parser:spipe-wave3", created_at_revision: context.revisionId ?? artifact.revision,
    evidence_uids: [...new Set([artifact.uid, ...evidenceUids])].sort(), generator: null,
    provenance: provenance(context, artifact, location), authority: null,
  };
}

function validUid(value, prefix) {
  return typeof value === "string" && value.startsWith(`${prefix}-`) && UID.test(value);
}

function exactAttributes(value, fields) {
  return value && Object.keys(value).sort().join("\0") === [...fields].sort().join("\0");
}

function utf8Boundary(bytes, offset) {
  return Number.isSafeInteger(offset) && offset >= 0 && offset <= bytes.length &&
    (offset === 0 || offset === bytes.length || (bytes[offset] & 0xc0) !== 0x80);
}

function sourceMarkers(source) {
  const lines = source.split("\n");
  const byteOffsets = offsets(source);
  const records = [];
  for (let index = 0; index < lines.length; index += 1) {
    const parsed = marker(lines[index], "symbol");
    if (!parsed) continue;
    let next = index + 1;
    while (next < lines.length) {
      const trimmed = lines[next].trim();
      if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("//") ||
          trimmed.startsWith("/*") || trimmed.startsWith("*") || trimmed.startsWith("<!--")) { next += 1; continue; }
      break;
    }
    const tokenColumn = next < lines.length ? lines[next].search(/\S/) : -1;
    const tokenByte = tokenColumn < 0 ? null : byteOffsets[next] + Buffer.byteLength(lines[next].slice(0, tokenColumn), "utf8");
    records.push({ parsed, line: index + 1, token_byte: tokenByte });
  }
  return records;
}

function canonicalRecordOwner(parsed, context) {
  const artifact = parsed?.artifact;
  if (!artifact?.uid || !artifact.project_uid || !artifact.content_hash || !artifact.revision) {
    return { artifact, error: diagnostic("SPK004", "source_owner_mismatch", { reason: "artifact owner fields are incomplete" }) };
  }
  if (context.projectUid && context.projectUid !== artifact.project_uid) {
    return { artifact, error: diagnostic("SPK004", "source_owner_mismatch", { field: "project_uid" }) };
  }
  if (context.revisionId && context.revisionId !== artifact.revision) {
    return { artifact, error: diagnostic("SPK004", "source_owner_mismatch", { field: "revision_id" }) };
  }
  return { artifact };
}

/** Extract canonical requirement records and explicit Markdown link candidates. */
export function extractMarkdownTrace(parsed, input, context = {}) {
  const source = normalizedSource(input);
  const lines = source.split("\n");
  const byteOffsets = offsets(source);
  const result = { requirements: [], links: [], edge_candidates: [], diagnostics: [] };
  const owner = canonicalRecordOwner(parsed, context);
  if (owner.error) { result.diagnostics.push(owner.error); return deepFreeze(result); }
  const artifact = owner.artifact;
  const sectionByHeadingOffset = new Map((parsed.sections ?? []).map((section) => [
    section.heading_offset ?? section.source_span?.start_byte, section
  ]));

  for (let index = 0; index < lines.length; index += 1) {
    const heading = /^##\s+(.+?)\s*$/.exec(lines[index]);
    if (heading) {
      const parts = REQUIREMENT_HEADING.exec(heading[1]);
      if (parts) {
        const section = sectionByHeadingOffset.get(byteOffsets[index]);
        const kind = parts[1] === "REQ" ? "requirement" : "nfr";
        const block = [];
        for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
          const parsedMarker = marker(lines[cursor]);
          if (!parsedMarker) break;
          block.push(parsedMarker);
        }
        const sectionMarker = block[0]?.kind === "section" ? block[0] : null;
        const recordMarker = block[1]?.kind === kind ? block[1] : null;
        const attributes = recordMarker?.attributes;
        const aliases = list(attributes?.aliases);
        const prefix = kind === "requirement" ? "RQ" : "NFR";
        const valid = block.length === 2 && block.every((entry) => !entry.invalid) &&
          exactAttributes(sectionMarker?.attributes, ["uid", "key"]) &&
          exactAttributes(attributes, ["uid", "key", "display_id", "status", "aliases"]) &&
          section?.uid && sectionMarker?.attributes?.uid === section.uid && attributes &&
          validUid(attributes.uid, prefix) && attributes.display_id === heading[1].split(" — ")[0] &&
          attributes.key === section.key && aliases !== null &&
          ["proposed", "accepted", "designed", "specified", "implemented", "verified", "superseded", "stale", "deprecated"].includes(attributes.status);
        if (!valid) {
          result.diagnostics.push(diagnostic("SPK003", "marker_invalid", { path: artifact.canonical_path, line: index + 1 }));
        } else {
          result.requirements.push({
            type: kind === "requirement" ? "requirement" : "non_functional_requirement",
            uid: attributes.uid, kind, key: attributes.key, display_id: attributes.display_id,
            project_uid: artifact.project_uid, revision_id: artifact.revision,
            artifact_uid: artifact.uid, section_uid: section.uid, title: parts[2],
            status: attributes.status, content_hash: section.content_hash, aliases,
          });
        }
      }
    }

    for (const match of lines[index].matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const rawTarget = match[1].trim();
      if (/^(?:https?|mailto):/i.test(rawTarget)) continue;
      const start = byteOffsets[index] + Buffer.byteLength(lines[index].slice(0, match.index), "utf8");
      const end = start + Buffer.byteLength(match[0], "utf8");
      const location = sourceLocation(artifact, { start_byte: start, end_byte: end });
      const section = [...(parsed.sections ?? [])].reverse().find((entry) => entry.source_span.start_byte <= start);
      result.links.push({ from_uid: section?.uid ?? artifact.uid, target_ref: rawTarget, source_location: location });
      result.edge_candidates.push(candidate("links_to", section?.uid ?? artifact.uid, rawTarget, artifact, location, context));
    }
  }
  return deepFreeze(sortExtraction(result));
}

/** Extract canonical scenario/test records and their explicit trace candidates. */
export function extractSspecTrace(parsed, input, context = {}) {
  const source = normalizedSource(input);
  const lines = source.split("\n");
  const byteOffsets = offsets(source);
  const result = { scenarios: [], tests: [], edge_candidates: [], diagnostics: [] };
  const owner = canonicalRecordOwner(parsed, context);
  if (owner.error) { result.diagnostics.push(owner.error); return deepFreeze(result); }
  const artifact = owner.artifact;
  const parsedByOrdinal = parsed.scenarios ?? [];
  let ordinal = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const declaration = /^\s*it\s+["'](.+?)["']\s*:\s*$/.exec(lines[index]);
    if (!declaration) continue;
    const block = [];
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const parsedMarker = marker(lines[cursor]);
      if (!parsedMarker || !["scenario", "test"].includes(parsedMarker.kind)) break;
      block.unshift(parsedMarker);
    }
    const scenarioMarker = block[0]?.kind === "scenario" ? block[0] : null;
    const testMarker = block.at(-1)?.kind === "test" ? block.at(-1) : null;
    const parsedScenario = parsedByOrdinal[ordinal];
    const start = parsedScenario?.source_span?.start_byte ?? byteOffsets[index];
    const next = parsedByOrdinal[ordinal + 1]?.source_span?.start_byte ?? Buffer.byteLength(source, "utf8");
    const span = { start_byte: start, end_byte: next };
    const location = sourceLocation(artifact, span);
    if (block.length === 0) {
      result.diagnostics.push(diagnostic("SPK104", "trace.marker_missing", { path: artifact.canonical_path, line: index + 1 }, "warning"));
      ordinal += 1; continue;
    }
    const kinds = block.map((entry) => entry.kind).join(",");
    const validOrder = kinds === "scenario" || kinds === "test" || kinds === "scenario,test";
    const validSchemas = block.every((entry) => !entry.invalid && (entry.kind === "scenario"
      ? exactAttributes(entry.attributes, ["uid", "key", "status", "requires"])
      : entry.kind === "test" && exactAttributes(entry.attributes, ["uid", "kind", "status", "scenario", "verifies"])));
    if (!validOrder || !validSchemas) {
      result.diagnostics.push(diagnostic("SPK003", "marker_invalid", { path: artifact.canonical_path, line: index + 1 }));
      ordinal += 1; continue;
    }
    if (scenarioMarker) {
      const a = scenarioMarker.attributes;
      const requires = list(a.requires);
      if (!validUid(a.uid, "SS") || requires === null || requires.some((uid) =>
        !(validUid(uid, "RQ") || validUid(uid, "NFR"))) || !a.key ||
        !["candidate", "proposed", "accepted", "deprecated"].includes(a.status)) {
        result.diagnostics.push(diagnostic("SPK003", "marker_invalid", { kind: "scenario", line: index + 1 }));
      } else {
        const record = {
          type: "sspec_scenario", uid: a.uid, key: a.key, project_uid: artifact.project_uid,
          revision_id: artifact.revision, artifact_uid: artifact.uid, title: declaration[1].normalize("NFC"), ordinal,
          source_location: location, content_hash: contentHash(Buffer.from(source, "utf8").subarray(start, next)),
          requirement_uids: requires, status: a.status,
        };
        result.scenarios.push(record);
        for (const target of requires) result.edge_candidates.push(candidate("specifies", record.uid, target, artifact, location, context));
      }
    }
    if (testMarker) {
      const a = testMarker.attributes;
      const verifies = list(a.verifies);
      const scenarioUid = a.scenario === "none" ? null : a.scenario;
      if (!validUid(a.uid, "T") || verifies === null || verifies.some((uid) =>
        !["RQ", "NFR", "SS", "SY"].some((prefix) => validUid(uid, prefix))) ||
        !["unit", "integration", "system"].includes(a.kind) ||
        !["candidate", "accepted", "deprecated"].includes(a.status) ||
        (scenarioMarker && scenarioUid !== scenarioMarker.attributes?.uid) || (!scenarioMarker && scenarioUid !== null)) {
        result.diagnostics.push(diagnostic("SPK003", "marker_invalid", { kind: "test", line: index + 1 }));
      } else {
        const record = {
          type: "test", uid: a.uid, test_kind: a.kind, project_uid: artifact.project_uid,
          revision_id: artifact.revision, artifact_uid: artifact.uid, scenario_uid: scenarioUid,
          title: declaration[1].normalize("NFC"), source_location: location,
          content_hash: contentHash(Buffer.from(source, "utf8").subarray(start, next)), verifies_uids: verifies, status: a.status,
        };
        result.tests.push(record);
        for (const target of verifies) result.edge_candidates.push(candidate("verifies", record.uid, target, artifact, location, context));
      }
    }
    ordinal += 1;
  }
  return deepFreeze(sortExtraction(result));
}

/** Promote only provider-backed, coordinate-checked source symbols to canonical trace records. */
export function extractSourceTrace(parsed, input, context = {}) {
  const source = normalizedSource(input);
  const result = { symbols: [], edge_candidates: [], diagnostics: [] };
  const artifact = context.artifact;
  if (!artifact || artifact.content_hash !== parsed.content_hash || artifact.canonical_path !== parsed.canonical_path ||
      (context.projectUid && artifact.project_uid !== context.projectUid) ||
      (context.revisionId && artifact.revision !== context.revisionId)) {
    result.diagnostics.push(diagnostic("SPK004", "source_owner_mismatch", { path: parsed.canonical_path }));
    return deepFreeze(result);
  }
  const markers = sourceMarkers(source);
  const markerByToken = new Map();
  for (const entry of markers) {
    const a = entry.parsed.attributes;
    const implementsUids = list(a?.implements);
    if (entry.parsed.invalid || !exactAttributes(a, ["uid", "status", "implements"]) ||
        !validUid(a?.uid, "SY") || !["candidate", "accepted", "deprecated"].includes(a?.status) ||
        implementsUids === null || implementsUids.some((uid) => !validUid(uid, uid.startsWith("NFR-") ? "NFR" : uid.startsWith("RQ-") ? "RQ" : "SS")) ||
        entry.token_byte == null || markerByToken.has(entry.token_byte)) {
      result.diagnostics.push(diagnostic("SPK003", "marker_invalid", { kind: "symbol", line: entry.line }));
      continue;
    }
    markerByToken.set(entry.token_byte, { ...entry, implements_uids: implementsUids });
  }
  const provider = context.symbolProvider;
  if (!provider) {
    for (const entry of markerByToken.values()) result.diagnostics.push(diagnostic("SPK406", "provider_coordinate_contract", { symbol: entry.parsed.attributes.uid }, "warning"));
    return deepFreeze(result);
  }
  const bytes = Buffer.from(source, "utf8");
  const response = provider({ coordinate_system: "spipe-normalized-utf8-bytes-v1", bytes, source_hash: artifact.content_hash });
  if (response?.coordinate_system !== "spipe-normalized-utf8-bytes-v1" || response?.source_hash !== artifact.content_hash) {
    result.diagnostics.push(diagnostic("SPK406", "provider_coordinate_contract"));
    return deepFreeze(result);
  }
  for (const symbol of response.symbols ?? []) {
    const start = symbol.source_span?.start_byte;
    const end = symbol.source_span?.end_byte;
    const bound = markerByToken.get(start);
    if (!bound || bound.parsed.attributes.uid !== symbol.uid || !validUid(symbol.uid, "SY") ||
        !utf8Boundary(bytes, start) || !utf8Boundary(bytes, end) || end <= start ||
        typeof symbol.symbol_kind !== "string" || typeof symbol.name !== "string" || typeof symbol.qualified_name !== "string" ||
        symbol.status !== bound.parsed.attributes.status ||
        JSON.stringify([...(symbol.annotation_uids ?? [])].sort()) !== JSON.stringify(bound.implements_uids)) {
      result.diagnostics.push(diagnostic("SPK406", "provider_coordinate_contract", { kind: "symbol", uid: symbol.uid })); continue;
    }
    let location;
    try { location = createVerifiedSourceLocation(sourceLocation(artifact, symbol.source_span), bytes); }
    catch {
      result.diagnostics.push(diagnostic("SPK406", "provider_coordinate_contract", { kind: "symbol", uid: symbol.uid }));
      continue;
    }
    const record = {
      type: "source_symbol", uid: symbol.uid, project_uid: artifact.project_uid, revision_id: artifact.revision,
      canonical_path: artifact.canonical_path, symbol_kind: symbol.symbol_kind, name: symbol.name.normalize("NFC"),
      qualified_name: symbol.qualified_name.normalize("NFC"), signature_hash: symbol.signature_hash ?? null,
      source_location: location, content_hash: contentHash(bytes.subarray(start, end)),
      annotation_uids: bound.implements_uids, status: bound.parsed.attributes.status,
    };
    result.symbols.push(record);
    for (const target of record.annotation_uids) result.edge_candidates.push(candidate("implements", record.uid, target, artifact, location, context));
  }
  return deepFreeze(sortExtraction(result));
}

function sortExtraction(result) {
  for (const key of ["requirements", "scenarios", "tests", "symbols"]) result[key]?.sort((a, b) => a.uid.localeCompare(b.uid));
  result.links?.sort((a, b) => `${a.from_uid}\0${a.target_ref}`.localeCompare(`${b.from_uid}\0${b.target_ref}`));
  result.edge_candidates?.sort((a, b) => `${a.from_uid}\0${a.edge_type}\0${a.target_ref}`.localeCompare(`${b.from_uid}\0${b.edge_type}\0${b.target_ref}`));
  result.diagnostics?.sort((a, b) => `${a.code}\0${JSON.stringify(a.arguments)}`.localeCompare(`${b.code}\0${JSON.stringify(b.arguments)}`));
  return result;
}

export function extractTraceRecords(inputs = {}, context = {}) {
  const parts = [];
  for (const item of inputs.markdown ?? []) parts.push(extractMarkdownTrace(item.parsed, item.input, { ...context, ...item.context }));
  for (const item of inputs.sspec ?? []) parts.push(extractSspecTrace(item.parsed, item.input, { ...context, ...item.context }));
  for (const item of inputs.source ?? []) parts.push(extractSourceTrace(item.parsed, item.input, { ...context, ...item.context }));
  const result = { requirements: [], scenarios: [], tests: [], symbols: [], links: [], edge_candidates: [], diagnostics: [] };
  for (const part of parts) for (const key of Object.keys(result)) result[key].push(...(part[key] ?? []));
  return deepFreeze(sortExtraction(result));
}
