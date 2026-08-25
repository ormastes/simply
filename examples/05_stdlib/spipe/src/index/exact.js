import { compareUtf8, searchFail } from "./contracts.js";

export function resolveExactIdentity(value, records, authorize = () => true) {
  const normalized = String(value).normalize("NFC");
  const matches = records.filter((record) => authorize(record) && (record.uid === normalized || record.key === normalized || (record.aliases ?? []).some((alias) => alias.value === normalized && alias.status === "accepted")));
  if (matches.length === 0) searchFail("not_found", "identity was not found");
  if (matches.length > 1) searchFail("ambiguous_identity", "identity resolves to multiple authorized artifacts");
  return matches[0];
}

export function searchWithIdentityDominance({ query, identities, authorize, sources, fusion }) {
  let pinned = null, ambiguity = null;
  try { pinned = resolveExactIdentity(query, identities, authorize); } catch (error) { if (error.code === "ambiguous_identity") ambiguity = error; else if (error.code !== "not_found") throw error; }
  const filtered = Object.fromEntries(Object.entries(sources).map(([name, entries]) => [name, entries.filter((entry) => entry.document_id !== pinned?.uid)]));
  const fused = fusion(filtered).sort((a, b) => a.final_rank - b.final_rank || compareUtf8(a.document_id, b.document_id));
  const results = pinned ? [Object.freeze({ document_id: pinned.uid, final_rank: 1, match_tier: "exact_identity", explanation: Object.freeze({ resolved_uid: pinned.uid, pinned_rank: 1 }) }), ...fused.map((entry, index) => Object.freeze({ ...entry, final_rank: index + 2 }))] : fused;
  return Object.freeze({ identity_ambiguity: ambiguity?.code ?? null, results: Object.freeze(results) });
}
