import { CONTRACTS, SearchContractError, compareUtf8, searchFail } from "./contracts.js";
import { UNICODE_17_TABLE_ADAPTER } from "./unicode_17.js";

const REQUIRED_TABLE_METHODS = Object.freeze(["normalizeNfc", "defaultLowercase", "isAlphabetic", "isDecimalNumber", "isMark"]);

export function createUnicode17Analyzer(unicodeTables = UNICODE_17_TABLE_ADAPTER, options = {}) {
  if (!unicodeTables || unicodeTables.version !== "17.0.0" || REQUIRED_TABLE_METHODS.some((name) => typeof unicodeTables[name] !== "function")) {
    searchFail("incompatible_contract", "spipe-unicode-lex-v1 requires a verified UCD 17.0.0 table adapter");
  }
  const stopWords = new Set(options.stop_words ?? []);
  const identity = Object.freeze({ contract: CONTRACTS.analyzer, unicode_version: "17.0.0", stop_words: "en-basic-v1" });

  function normalize(value) {
    if (typeof value !== "string" || /[\uD800-\uDFFF]/u.test(value)) searchFail("invalid_utf8", "input must contain Unicode scalar values");
    return unicodeTables.normalizeNfc(unicodeTables.defaultLowercase(unicodeTables.normalizeNfc(value)));
  }

  function analyze(value, { identifier = false } = {}) {
    const normalized = normalize(value);
    const raw = [];
    let token = "", position = 0;
    const flush = () => {
      if (!token) return;
      position += 1;
      raw.push(Object.freeze({ term: token, position, stopped: stopWords.has(token) }));
      token = "";
    };
    for (const scalar of normalized) {
      const cp = scalar.codePointAt(0);
      if (scalar === "_" || unicodeTables.isAlphabetic(cp) || unicodeTables.isDecimalNumber(cp) || unicodeTables.isMark(cp)) token += scalar;
      else flush();
    }
    flush();
    const tokens = raw.filter((entry) => !entry.stopped).map(({ term, position }) => Object.freeze({ term, position }));
    if (identifier && normalized && !tokens.some((entry) => entry.term === normalized)) tokens.push(Object.freeze({ term: normalized, position: 0 }));
    return Object.freeze({ normalized, tokens: Object.freeze(tokens) });
  }

  function query(value) {
    if (Buffer.byteLength(value, "utf8") > 4096) searchFail("limit_exceeded", "query exceeds 4096 UTF-8 bytes");
    const analyzed = analyze(value);
    if (analyzed.tokens.length > 128) searchFail("limit_exceeded", "query exceeds 128 analyzed tokens");
    const counts = new Map();
    for (const { term } of analyzed.tokens) counts.set(term, (counts.get(term) ?? 0) + 1);
    return Object.freeze([...counts].sort(([a], [b]) => compareUtf8(a, b)).map(([term, qtf]) => Object.freeze({ term, qtf })));
  }
  return Object.freeze({ identity, normalize, analyze, query });
}

export function isAnalyzerContractError(error) {
  return error instanceof SearchContractError;
}
