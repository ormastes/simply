import {
  UNICODE_TABLE_METADATA, unicodeIsAlphabetic, unicodeIsDecimalNumber,
  unicodeIsMark, unicodeNormalizeNfc, unicodeDefaultLowercase
} from "../search/generated/unicode_17_0_0.js";

/** Verified adapter over the generated, complete-corpus-tested UCD 17 API. */
export const UNICODE_17_TABLE_ADAPTER = Object.freeze({
  version: UNICODE_TABLE_METADATA.unicode_version,
  metadata: UNICODE_TABLE_METADATA,
  normalizeNfc: unicodeNormalizeNfc,
  defaultLowercase: unicodeDefaultLowercase,
  isAlphabetic: unicodeIsAlphabetic,
  isDecimalNumber: unicodeIsDecimalNumber,
  isMark: unicodeIsMark
});
