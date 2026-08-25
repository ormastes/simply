import { CONTRACTS, compareUtf8, searchFail } from "./contracts.js";

export const RRF_SCALE = 1_000_000_000_000n;

export function fuseRankings(sources, { k = 60, source_k = 1000, source_order = ["lexical", "graph", "semantic"] } = {}) {
  if (!Number.isSafeInteger(k) || k < 1 || k > 10000 || !Number.isSafeInteger(source_k) || source_k < 1 || source_k > 1000) searchFail("invalid_request", "invalid RRF bounds");
  const totals = new Map(), ranks = new Map();
  for (const source of source_order) {
    const entries = sources[source]; if (!entries) continue;
    const seen = new Set();
    for (let index = 0; index < Math.min(entries.length, source_k); index += 1) {
      const id = entries[index].document_id;
      if (seen.has(id)) searchFail("invalid_request", `duplicate document ID in ${source}`); seen.add(id);
      const contribution = RRF_SCALE / BigInt(k + index + 1);
      totals.set(id, (totals.get(id) ?? 0n) + contribution);
      if (!ranks.has(id)) ranks.set(id, {}); ranks.get(id)[source] = index + 1;
    }
  }
  const ordered = [...totals].sort(([a, av], [b, bv]) => bv > av ? 1 : bv < av ? -1 : compareUtf8(a, b));
  return Object.freeze(ordered.map(([document_id, score], index) => Object.freeze({ document_id, final_rank: index + 1, match_tier: "fused", explanation: Object.freeze({ contract: CONTRACTS.fusion, k, source_k, source_ranks: Object.freeze({ ...ranks.get(document_id) }), raw_scaled: score.toString(), adjusted_scaled: score.toString() }) })));
}
