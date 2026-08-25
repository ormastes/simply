import {
  canonicalPath,
  contentHash,
  identityStatus,
  normalizeAlias,
  normalizeSemanticKey,
  normalizeText,
  provisionalArtifactUid,
  slugify,
} from "../core/identity.js";
import { parseMetadataAttributes, parseSdnDocument } from "./sdn.js";

function freeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) freeze(child, seen);
  return Object.freeze(value);
}

function diagnostic(code, severity, messageKey, details = {}) {
  return freeze({ code, severity, message_key: messageKey, details: freeze({ ...details }) });
}

function mergeMetadata(...values) {
  const output = {};
  for (const value of values) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    for (const [key, item] of Object.entries(value)) output[key] = item;
  }
  return output;
}

function arrayValue(value) {
  if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean);
  if (value === undefined || value === null || value === "") return [];
  return String(value).split(/[;,]/).map(normalizeText).filter(Boolean);
}

function parseMarker(line, marker, bounds) {
  const match = line.match(new RegExp(`^\\s*<!--\\s*spipe:${marker}\\s+([\\s\\S]*?)\\s*-->\\s*$`, "i"));
  return match ? parseMetadataAttributes(match[1], { bounds }) : null;
}

function frontMatter(source, bounds, maxBytes) {
  if (!source.startsWith("---\n") && source !== "---") return { metadata: {}, end: 0, diagnostics: [] };
  const endMatch = source.match(/^---\n([\s\S]*?)\n(?:---|\.\.\.)\s*(?:\n|$)/);
  if (!endMatch) return { metadata: {}, end: 0, diagnostics: [diagnostic("SPK008", "error", "markdown.unclosed_front_matter")] };
  const parsed = parseSdnDocument(endMatch[1], {
    maxBytes, maxNodes: bounds.maxNodes, maxDepth: bounds.maxDepth, bounds
  });
  const root = parsed.value;
  const metadata = root.spipe?.artifact || root.spipe || root.artifact || root;
  return { metadata: metadata && typeof metadata === "object" ? metadata : {}, end: endMatch[0].length, diagnostics: parsed.diagnostics };
}

function byteOffset(source, charOffset) {
  return Buffer.byteLength(source.slice(0, charOffset), "utf8");
}

function lineOffsets(source) {
  const offsets = [];
  let offset = 0;
  for (const line of source.split("\n")) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  return offsets;
}

function inferKind(path, value) {
  if (value) return normalizeText(value).toLocaleLowerCase("en-US");
  const lifecycle = normalizeText(path).replaceAll("\\", "/").split("/")
    .map((part) => part.match(/^\d+[_-](research|requirements|plan|architecture|design|spec|guide|tracking|report)$/)?.[1])
    .find(Boolean);
  return lifecycle || "guide";
}

function metadataMarker(source, lines, bounds) {
  for (const line of lines) {
    const parsed = parseMarker(line, "artifact", bounds);
    if (parsed) return parsed;
  }
  return {};
}

function metadataForArtifact(front, marker) {
  const nested = marker.artifact && typeof marker.artifact === "object" ? marker.artifact : {};
  return mergeMetadata(front, nested, marker);
}

function markerKey(value, fallback) {
  return normalizeSemanticKey(value) || normalizeSemanticKey(fallback) || "document";
}

/** Parse one canonical Markdown artifact without changing its bytes. */
export function parseMarkdownArtifact(input, options = {}) {
  const source = typeof input === "string" ? input : String(input?.content ?? "");
  const maxBytes = options.maxBytes ?? 1_048_576;
  const maxSections = options.maxSections ?? 100_000;
  const maxAliases = options.maxAliases ?? 100_000;
  const maxSdnNodes = options.maxSdnNodes ?? 100_000;
  const maxSdnDepth = options.maxSdnDepth ?? 64;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError("maxBytes must be a positive integer");
  if (!Number.isSafeInteger(maxSections) || maxSections < 1) throw new TypeError("maxSections must be a positive integer");
  if (!Number.isSafeInteger(maxAliases) || maxAliases < 1) throw new TypeError("maxAliases must be a positive integer");
  if (!Number.isSafeInteger(maxSdnNodes) || maxSdnNodes < 1) throw new TypeError("maxSdnNodes must be a positive integer");
  if (!Number.isSafeInteger(maxSdnDepth) || maxSdnDepth < 1) throw new TypeError("maxSdnDepth must be a positive integer");
  if (Buffer.byteLength(source, "utf8") > maxBytes) throw new RangeError("SPK020 parser_input_too_large");
  const pathInput = options.path ?? input?.path ?? "";
  const normalizedPath = canonicalPath(pathInput);
  const diagnostics = [];
  if (!normalizedPath.valid) diagnostics.push(diagnostic("SPK009", "error", "path.invalid_canonical_path", { path: pathInput }));
  const normalized = source.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const lines = normalized.split("\n");
  const sdnBounds = { nodes: 0, maxNodes: maxSdnNodes, maxDepth: maxSdnDepth };
  const front = frontMatter(normalized, sdnBounds, maxBytes);
  diagnostics.push(...front.diagnostics);
  const marker = metadataMarker(normalized, lines, sdnBounds);
  const metadata = metadataForArtifact(front.metadata, marker);
  const headingIndex = lines.findIndex((line) => /^\s*#\s+/.test(line));
  const title = normalizeText(metadata.title) || (headingIndex >= 0 ? lines[headingIndex].replace(/^\s*#\s+/, "").replace(/\s+#+\s*$/, "") : "") || normalizedPath.path.split("/").at(-1)?.replace(/\.md(?:own)?$/i, "") || "Untitled";
  const key = markerKey(metadata.key, title);
  const hash = contentHash(normalized);
  const projectUid = normalizeText(options.projectUid ?? metadata.project_uid ?? metadata.project) || "unregistered";
  const uid = normalizeText(metadata.uid) || provisionalArtifactUid(projectUid, hash);
  const artifact = {
    uid,
    key,
    project_uid: projectUid,
    revision: normalizeText(options.revision ?? metadata.revision),
    kind: inferKind(normalizedPath.path, metadata.kind),
    title,
    canonical_path: normalizedPath.path,
    content_hash: hash,
    features: arrayValue(metadata.features),
    components: arrayValue(metadata.components),
    layers: arrayValue(metadata.layers),
    visibility: normalizeText(metadata.visibility) || "project",
    trust_scope: "untrusted_data",
    declared_trust_scope: normalizeText(metadata.trust_scope ?? metadata.trust),
    status: normalizeText(metadata.status) || "proposed",
    aliases: arrayValue(metadata.aliases).map(normalizeAlias),
    identity_status: identityStatus(uid),
    parser: { id: "markdown", version: 1 },
  };

  const sectionStarts = [];
  const offsets = lineOffsets(normalized);
  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index].match(/^\s*(#{2,6})\s+(.+?)\s*#*\s*$/);
    if (!heading) continue;
    const headingText = normalizeText(heading[2]);
    if (!headingText) continue;
    const markerLine = index + 1 < lines.length ? parseMarker(lines[index + 1], "section", sdnBounds) : null;
    const markerStart = markerLine ? offsets[index + 1] : null;
    sectionStarts.push({ index, headingText, depth: heading[1].length, marker: markerLine, markerStart });
  }
  const sections = sectionStarts.map((entry, ordinal) => {
    const next = sectionStarts[ordinal + 1];
    const startIndex = entry.index;
    const contentStartIndex = entry.marker ? startIndex + 2 : startIndex + 1;
    const endIndex = next ? next.index : lines.length;
    const body = lines.slice(contentStartIndex, endIndex).join("\n").replace(/\n+$/, "");
    const sectionUid = normalizeText(entry.marker?.uid);
    const sectionKey = markerKey(entry.marker?.key, `${key}.${slugify(entry.headingText)}`);
    const headingOffset = offsets[startIndex] ?? 0;
    const bodyStart = offsets[Math.min(contentStartIndex, lines.length - 1)] ?? normalized.length;
    const endOffset = next ? offsets[next.index] : normalized.length;
    const section = {
      uid: sectionUid || undefined,
      artifact_uid: uid,
      key: sectionKey,
      heading: entry.headingText,
      depth: entry.depth,
      ordinal,
      source_span: { start_byte: byteOffset(normalized, headingOffset), end_byte: byteOffset(normalized, endOffset) },
      heading_offset: byteOffset(normalized, headingOffset),
      heading_end_offset: byteOffset(normalized, offsets[startIndex] + lines[startIndex].length + 1),
      marker_offset: entry.markerStart === null ? null : byteOffset(normalized, entry.markerStart),
      content_hash: contentHash(body),
      aliases: [...new Set([...arrayValue(entry.marker?.aliases).map(normalizeAlias), slugify(entry.headingText)])].sort(),
      identity_status: sectionUid ? identityStatus(sectionUid) : "provisional",
    };
    if (sectionUid === "") delete section.uid;
    return section;
  });
  if (sections.length > maxSections) throw new RangeError("SPK021 parser_node_limit_exceeded");
  if (artifact.aliases.length + sections.reduce((count, section) => count + section.aliases.length, 0) > maxAliases) {
    throw new RangeError("SPK021 parser_alias_limit_exceeded");
  }
  if (options.strictSections) {
    for (const section of sections) if (!section.uid) diagnostics.push(diagnostic(
      "SPK104", "error", "section.missing_uid", { path: normalizedPath.path, ordinal: section.ordinal, heading: section.heading },
    ));
  }
  const result = {
    artifact,
    sections,
    diagnostics: diagnostics.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    canonical_path: normalizedPath.path,
    content_hash: hash,
    parser: { id: "markdown", version: 1 },
    budget_usage: { sdn_nodes: sdnBounds.nodes },
  };
  return freeze(result);
}

export const parseMarkdown = parseMarkdownArtifact;

export function parseMarkdownArtifacts(inputs = [], options = {}) {
  const values = Array.isArray(inputs) ? inputs : [inputs];
  return freeze(values.map((input) => parseMarkdownArtifact(input, options)));
}
