import { CONTRACTS, checkedI128, compareUtf8, searchFail } from "./contracts.js";

export const SCALE = 1_000_000n;
const K1 = 1_200_000n, B = 750_000n, LN2 = 693_147n;
const div = (a, b, code = "invalid_denominator") => {
  if (b <= 0n) searchFail(code, "division denominator must be positive");
  return checkedI128(a / b);
};
const mul = (...values) => values.reduce((a, b) => checkedI128(a * b), 1n);
const add = (...values) => values.reduce((a, b) => checkedI128(a + b), 0n);

export function fixedLn(input) {
  let x = BigInt(input);
  if (x <= 0n) searchFail("invalid_logarithm_input", "fixed logarithm input must be positive");
  let exponent = 0n;
  while (x < SCALE) { x = mul(x, 2n); exponent -= 1n; }
  while (x >= 2n * SCALE) { x = div(x, 2n); exponent += 1n; }
  const y = div(mul(x - SCALE, SCALE), x + SCALE);
  const y2 = div(mul(y, y), SCALE);
  let sum = y, power = y;
  for (const denominator of [3n, 5n, 7n, 9n, 11n, 13n]) {
    power = div(mul(power, y2), SCALE);
    sum = add(sum, power / denominator);
  }
  return add(mul(2n, sum), mul(exponent, LN2));
}

export function scoreTerm({ N, df, total_length, document_length, tf, weight_milli }) {
  for (const [name, value] of Object.entries({ N, df, total_length, document_length, tf, weight_milli })) if (!Number.isSafeInteger(value) || value < 0) searchFail("invalid_request", `${name} must be a nonnegative safe integer`);
  if (tf === 0) return null;
  if (N === 0) searchFail("invalid_corpus_n", "N must be positive when scoring");
  if (df > N) searchFail("invalid_document_frequency", "df must not exceed N");
  if (total_length === 0) searchFail("invalid_average_length", "total field length must be positive when scoring");
  const n = BigInt(N), d = BigInt(df), length = BigInt(document_length), frequency = BigInt(tf), weight = BigInt(weight_milli);
  const average = div(mul(BigInt(total_length), SCALE), n, "invalid_average_length");
  if (average <= 0n) searchFail("invalid_average_length", "average length must be positive");
  const ratio = div(mul(length, SCALE, SCALE), average);
  const norm = add(SCALE - B, div(mul(B, ratio), SCALE));
  const denominator = add(mul(frequency, SCALE), div(mul(K1, norm), SCALE));
  const tfScaled = div(mul(frequency, K1 + SCALE, SCALE), denominator);
  const idfArgument = add(SCALE, div(mul(2n * n - 2n * d + 1n, SCALE), 2n * d + 1n));
  const idf = fixedLn(idfArgument);
  const unweighted = div(mul(idf, tfScaled), SCALE);
  const weighted = div(mul(unweighted, weight), 1000n);
  return Object.freeze({ idf_argument_scaled: idfArgument.toString(), idf_scaled: idf.toString(), length_ratio_scaled: ratio.toString(), norm_scaled: norm.toString(), denominator_scaled: denominator.toString(), tf_scaled: tfScaled.toString(), unweighted: unweighted.toString(), weighted: weighted.toString() });
}

export function finalizeExplanation({ scope_digest, logical_root, document_id, fields }) {
  let total = 0n;
  for (const field of fields) total = add(total, BigInt(field.field_total));
  const publicScore = total / 1000n;
  if (publicScore < 0n || publicScore > BigInt(Number.MAX_SAFE_INTEGER)) searchFail("score_overflow", "public score exceeds WireInteger");
  return Object.freeze({ contract: CONTRACTS.explanation, analyzer: CONTRACTS.analyzer, score_contract: CONTRACTS.score, logical_index: CONTRACTS.logical_index, scope_digest, logical_root, document_id, fields: Object.freeze(fields), internal_total: total.toString(), public_score_milli: Number(publicScore), tie_key_utf8_hex: Buffer.from(document_id, "utf8").toString("hex") });
}

export function sortHits(hits) {
  return [...hits].sort((a, b) => a.score_milli === b.score_milli ? compareUtf8(a.document_id, b.document_id) : (a.score_milli > b.score_milli ? -1 : 1));
}
