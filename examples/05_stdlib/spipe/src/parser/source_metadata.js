import {
  canonicalPath,
  contentHash,
  identityStatus,
  normalizeSemanticKey,
  normalizeText,
  sha256,
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

function sourceMarker(line, bounds) {
  const match = line.match(/(?:\/\/|#|\/\*+|<!--)\s*spipe:(?:symbol|source)\s+([\s\S]*?)(?:\s*\*\/|\s*-->)?\s*$/i);
  return match ? parseMetadataAttributes(match[1], { bounds }) : null;
}

function annotations(line) {
  const result = [];
  const regex = /@(?:cover|implements|satisfies|verifies|trace)\s+([^\s,;]+)/gi;
  for (const match of line.matchAll(regex)) result.push(match[1]);
  return result;
}

function declaration(line) {
  let match = line.match(/\b(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w!?]*)\s*(?:<[^>]*>)?\s*\(/);
  if (match) return { kind: "function", name: match[1] };
  match = line.match(/\b(?:export\s+)?(?:class|struct|trait|enum|interface|type)\s+([A-Za-z_][\w]*)/);
  if (match) return { kind: line.match(/\b(class|struct|trait|enum|interface|type)\b/)?.[1] || "type", name: match[1] };
  match = line.match(/\b(?:export\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/);
  if (match) return { kind: "function", name: match[1] };
  return null;
}

function uidForSymbol(projectUid, declarationInfo, line, ordinal) {
  return `P-${projectUid || "unregistered"}-${sha256(`source_symbol_provisional_v1\0${declarationInfo.kind}\0${declarationInfo.name}\0${ordinal}\0${line}`)}`;
}

/**
 * Parse source annotations and a deliberately conservative declaration subset.
 * Compiler/HIR providers can replace these provisional symbol identities later.
 */
export function parseSourceMetadata(input, options = {}) {
  const source = typeof input === "string" ? input : String(input?.content ?? "");
  const maxBytes = options.maxBytes ?? 1_048_576;
  const maxSymbols = options.maxSymbols ?? 10_000;
  const maxSdnNodes = options.maxSdnNodes ?? 100_000;
  const maxSdnDepth = options.maxSdnDepth ?? 64;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError("maxBytes must be a positive integer");
  if (!Number.isSafeInteger(maxSymbols) || maxSymbols < 1) throw new TypeError("maxSymbols must be a positive integer");
  if (!Number.isSafeInteger(maxSdnNodes) || maxSdnNodes < 1) throw new TypeError("maxSdnNodes must be a positive integer");
  if (!Number.isSafeInteger(maxSdnDepth) || maxSdnDepth < 1) throw new TypeError("maxSdnDepth must be a positive integer");
  if (Buffer.byteLength(source, "utf8") > maxBytes) throw new RangeError("SPK020 parser_input_too_large");
  const pathInput = options.path ?? input?.path ?? "";
  const path = canonicalPath(pathInput);
  const normalized = source.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const lines = normalized.split("\n");
  const diagnostics = [];
  if (!path.valid) diagnostics.push(diagnostic("SPK009", "error", "path.invalid_canonical_path", { path: pathInput }));
  const symbols = [];
  const sdnBounds = { nodes: 0, maxNodes: maxSdnNodes, maxDepth: maxSdnDepth };
  let pendingMarker = null;
  let pendingAnnotations = [];
  let ordinal = 0;
  let lineOffset = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const marker = sourceMarker(line, sdnBounds);
    if (marker) { pendingMarker = marker; lineOffset += line.length + 1; continue; }
    const refs = annotations(line);
    if (refs.length) pendingAnnotations = [...pendingAnnotations, ...refs];
    const declarationInfo = declaration(line);
    if (!declarationInfo) { lineOffset += line.length + 1; continue; }
    const markerData = pendingMarker || {};
    const explicitUid = normalizeText(markerData.uid);
    if (explicitUid) assertCanonicalUid(explicitUid, "source symbol uid", ["SY"]);
    const uid = explicitUid || uidForSymbol(options.projectUid, declarationInfo, line, ordinal);
    const key = normalizeSemanticKey(markerData.key) || normalizeSemanticKey(`${path.path}:${declarationInfo.name}`);
    const symbol = {
      uid,
      key,
      project_uid: normalizeText(options.projectUid ?? markerData.project_uid),
      canonical_path: path.path,
      kind: normalizeText(markerData.kind) || declarationInfo.kind,
      name: normalizeText(markerData.name) || declarationInfo.name,
      qualified_name: normalizeText(markerData.qualified_name) || declarationInfo.name,
      signature_hash: `sha256:${sha256(line.trim())}`,
      definition_span: { start_byte: Buffer.byteLength(normalized.slice(0, lineOffset), "utf8"), end_byte: Buffer.byteLength(normalized.slice(0, lineOffset + line.length), "utf8") },
      annotations: [...new Set([...arrayValue(markerData.annotations), ...pendingAnnotations])].sort(),
      requirement_ids: [...new Set([...arrayValue(markerData.requirements), ...arrayValue(markerData.requirement_ids), ...pendingAnnotations.filter((value) => /^REQ[-_]/i.test(value))])].sort(),
      identity_status: explicitUid ? identityStatus(uid) : "provisional",
      content_hash: contentHash(line),
    };
    symbols.push(symbol);
    if (symbols.length > maxSymbols) throw new RangeError("SPK021 parser_node_limit_exceeded");
    ordinal += 1;
    pendingMarker = null;
    pendingAnnotations = [];
    lineOffset += line.length + 1;
  }
  const result = {
    parser: { id: "source_metadata", version: 1 },
    canonical_path: path.path,
    content_hash: contentHash(normalized),
    symbols,
    diagnostics: diagnostics.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    budget_usage: { sdn_nodes: sdnBounds.nodes },
  };
  return freeze(result);
}

export const parseSource = parseSourceMetadata;

export function sourceMetadataForSymbol(symbol, options = {}) {
  const source = { ...symbol };
  if (!source.uid) source.uid = uidForSymbol(options.projectUid, source, source.name || "", options.ordinal || 0);
  return freeze(source);
}
