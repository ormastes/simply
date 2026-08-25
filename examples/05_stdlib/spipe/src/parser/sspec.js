import {
  canonicalPath,
  contentHash,
  identityStatus,
  normalizeAlias,
  normalizeSemanticKey,
  normalizeText,
  provisionalArtifactUid,
  sha256,
  slugify,
} from "../core/identity.js";
import { parseMetadataAttributes } from "./sdn.js";
import { assertCanonicalUid } from "../model/identity.js";

function freeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) freeze(child, seen);
  return Object.freeze(value);
}

function diagnostic(code, severity, messageKey, details = {}) {
  return freeze({ code, severity, message_key: messageKey, details: freeze({ ...details }) });
}

function arrayValue(value) {
  if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean);
  return normalizeText(value).split(/[;,]/).map(normalizeText).filter(Boolean);
}

function marker(line, kind, bounds) {
  const match = line.match(new RegExp(`^\\s*#\\s*spipe:${kind}\\s+([\\s\\S]*?)\\s*$`, "i"));
  return match ? parseMetadataAttributes(match[1], { bounds }) : null;
}

function requirementIds(text) {
  return [...new Set([...String(text).matchAll(/\bREQ[-_][A-Z0-9][A-Z0-9_-]*\b/gi)].map((match) => match[0].toUpperCase()))].sort();
}

function lineOffsets(source) {
  const offsets = [];
  let offset = 0;
  for (const line of source.split("\n")) { offsets.push(offset); offset += line.length + 1; }
  return offsets;
}

function declaration(line) {
  let match = line.match(/^\s*(?:describe|feature)\s+["'](.+?)["']\s*:??\s*$/i);
  if (match) return { kind: "suite", title: match[1] };
  match = line.match(/^\s*(?:it|scenario|example|case)\s+["'](.+?)["']\s*:??\s*$/i);
  return match ? { kind: "scenario", title: match[1] } : null;
}

/** Parse SSpec comments/declarations into an artifact and scenario metadata. */
export function parseSspecMetadata(input, options = {}) {
  const source = typeof input === "string" ? input : String(input?.content ?? "");
  const maxBytes = options.maxBytes ?? 1_048_576;
  const maxScenarios = options.maxScenarios ?? 10_000;
  const maxAliases = options.maxAliases ?? 100_000;
  const maxSdnNodes = options.maxSdnNodes ?? 100_000;
  const maxSdnDepth = options.maxSdnDepth ?? 64;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError("maxBytes must be a positive integer");
  if (!Number.isSafeInteger(maxScenarios) || maxScenarios < 1) throw new TypeError("maxScenarios must be a positive integer");
  if (!Number.isSafeInteger(maxAliases) || maxAliases < 1) throw new TypeError("maxAliases must be a positive integer");
  if (!Number.isSafeInteger(maxSdnNodes) || maxSdnNodes < 1) throw new TypeError("maxSdnNodes must be a positive integer");
  if (!Number.isSafeInteger(maxSdnDepth) || maxSdnDepth < 1) throw new TypeError("maxSdnDepth must be a positive integer");
  if (Buffer.byteLength(source, "utf8") > maxBytes) throw new RangeError("SPK020 parser_input_too_large");
  const pathInput = options.path ?? input?.path ?? "";
  const path = canonicalPath(pathInput);
  const normalized = source.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const lines = normalized.split("\n");
  const offsets = lineOffsets(normalized);
  const diagnostics = [];
  const sdnBounds = { nodes: 0, maxNodes: maxSdnNodes, maxDepth: maxSdnDepth };
  if (!path.valid) diagnostics.push(diagnostic("SPK009", "error", "path.invalid_canonical_path", { path: pathInput }));
  let artifactMarker = null;
  let pendingScenario = null;
  let pendingTags = [];
  const scenarios = [];
  const suites = [];
  const scenarioLines = lines.map((line, index) => declaration(line)?.kind === "scenario" ? index : -1).filter((index) => index >= 0);
  if (scenarioLines.length > maxScenarios) throw new RangeError("SPK021 parser_node_limit_exceeded");
  const nextScenarioByLine = new Map(scenarioLines.map((line, index) => [line, scenarioLines[index + 1] ?? lines.length]));
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    artifactMarker ||= marker(line, "artifact", sdnBounds) || marker(line, "sspec", sdnBounds);
    const scenarioMarker = marker(line, "scenario", sdnBounds);
    if (scenarioMarker) { pendingScenario = scenarioMarker; continue; }
    const tagMatch = line.match(/^\s*#\s*(?:tags?|tag):\s*(.+)$/i);
    if (tagMatch) { pendingTags = [...pendingTags, ...arrayValue(tagMatch[1])]; continue; }
    const found = declaration(line);
    if (!found) continue;
    if (found.kind === "suite") {
      suites.push({ title: found.title, line: index + 1, source_offset: offsets[index] });
      continue;
    }
    const data = pendingScenario || {};
    const ordinal = scenarios.length;
    const title = normalizeText(data.title) || found.title;
    const uid = normalizeText(data.uid);
    if (uid) assertCanonicalUid(uid, "scenario uid", ["SS"]);
    const key = normalizeSemanticKey(data.key) || normalizeSemanticKey(`${path.path}:${slugify(title)}`);
    const nextScenario = nextScenarioByLine.get(index);
    const end = nextScenario === lines.length ? normalized.length : offsets[nextScenario];
    const ids = [...new Set([...requirementIds(line), ...requirementIds(data.requirements), ...requirementIds(data.requirement_ids)])].sort();
    scenarios.push({
      uid: uid || undefined,
      key,
      title,
      ordinal,
      source_span: { start_byte: Buffer.byteLength(normalized.slice(0, offsets[index]), "utf8"), end_byte: Buffer.byteLength(normalized.slice(0, end), "utf8") },
      line: index + 1,
      tags: [...new Set([...pendingTags, ...arrayValue(data.tags)])].sort(),
      requirement_ids: ids,
      identity_status: uid ? identityStatus(uid) : "provisional",
      content_hash: contentHash(lines[index]),
    });
    pendingScenario = null;
    pendingTags = [];
  }
  const hash = contentHash(normalized);
  const projectUid = normalizeText(options.projectUid ?? artifactMarker?.project_uid) || "unregistered";
  const artifactUid = normalizeText(artifactMarker?.uid) || provisionalArtifactUid(projectUid, hash);
  if (artifactMarker?.uid) assertCanonicalUid(artifactUid, "SSpec artifact uid", ["A"]);
  const title = normalizeText(artifactMarker?.title) || suites[0]?.title || path.path.split("/").at(-1)?.replace(/\.spl$/i, "") || "SSpec";
  const artifact = {
    uid: artifactUid,
    key: normalizeSemanticKey(artifactMarker?.key) || normalizeSemanticKey(`${path.path}:${slugify(title)}`),
    project_uid: projectUid,
    revision: normalizeText(options.revision ?? artifactMarker?.revision),
    kind: "test",
    title,
    canonical_path: path.path,
    content_hash: hash,
    budget_usage: { sdn_nodes: sdnBounds.nodes },
    aliases: arrayValue(artifactMarker?.aliases).map(normalizeAlias),
    features: arrayValue(artifactMarker?.features),
    components: arrayValue(artifactMarker?.components),
    layers: arrayValue(artifactMarker?.layers),
    visibility: normalizeText(artifactMarker?.visibility) || "project",
    trust_scope: "untrusted_data",
    declared_trust_scope: normalizeText(artifactMarker?.trust_scope ?? artifactMarker?.trust),
    status: normalizeText(artifactMarker?.status) || "proposed",
    identity_status: identityStatus(artifactUid),
    parser: { id: "sspec", version: 1 },
  };
  if (artifact.aliases.length > maxAliases) throw new RangeError("SPK021 parser_alias_limit_exceeded");
  const result = {
    parser: { id: "sspec", version: 1 },
    artifact,
    suites,
    scenarios,
    diagnostics: diagnostics.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    canonical_path: path.path,
    content_hash: hash,
  };
  return freeze(result);
}

export const parseSspec = parseSspecMetadata;
