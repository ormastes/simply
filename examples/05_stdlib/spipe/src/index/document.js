import { createHash } from "node:crypto";
import { canonicalBytes } from "../model/identity.js";
import { CONTRACTS, FIELD_CONTRACT, assertClosedObject, compareUtf8, searchFail } from "./contracts.js";

const SCOPED_FIELDS = ["document_id", "revision", "fields", "facets", "visibility_digest", "scoped_content_hash", "scope_digest"];
const FIELD_NAMES = FIELD_CONTRACT.map(({ name }) => name);
const HASH = /^sha256:[a-f0-9]{64}$/;

export function hashCanonical(value) {
  return `sha256:${createHash("sha256").update(canonicalBytes(value)).digest("hex")}`;
}

function idText(value, label) {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") < 1 || Buffer.byteLength(value, "utf8") > 128 || /[\u0000-\u001f\u007f]/u.test(value)) searchFail("invalid_request", `${label} must be IdText`);
  return value.normalize("NFC");
}

export function createScopedSearchDocument(input) {
  assertClosedObject(input, SCOPED_FIELDS, "ScopedSearchDocumentV1");
  const fields = input.fields.map((field) => {
    assertClosedObject(field, ["name", "value"], "ScopedFieldV1");
    if (!FIELD_NAMES.includes(field.name) || typeof field.value !== "string" || field.value !== field.value.normalize("NFC")) searchFail("invalid_request", "invalid scoped field");
    if (Buffer.byteLength(field.value, "utf8") > 1_048_576) searchFail("limit_exceeded", "scoped field exceeds max_field_value_bytes");
    return Object.freeze({ name: field.name, value: field.value });
  });
  const fieldOrdinals = fields.map(({ name }) => FIELD_NAMES.indexOf(name));
  if (new Set(fieldOrdinals).size !== fieldOrdinals.length || fieldOrdinals.some((value, i) => i > 0 && value <= fieldOrdinals[i - 1])) searchFail("invalid_parallel_arrays", "fields must be unique and in canonical order");
  const facets = input.facets.map((facet) => {
    assertClosedObject(facet, ["name", "value"], "ScopedFacetV1");
    if (typeof facet.value !== "string" || facet.value !== facet.value.normalize("NFC")) searchFail("invalid_request", "facet value must be an NFC string");
    if (Buffer.byteLength(facet.value, "utf8") > 1_048_576) searchFail("limit_exceeded", "facet value exceeds max_field_value_bytes");
    return Object.freeze({ name: idText(facet.name, "facet.name"), value: facet.value });
  });
  for (let i = 1; i < facets.length; i += 1) {
    const prior = facets[i - 1], next = facets[i];
    if (compareUtf8(prior.name, next.name) > 0 || (prior.name === next.name && compareUtf8(prior.value, next.value) >= 0)) searchFail("invalid_request", "facets must be unique and canonically sorted");
  }
  for (const [name, value] of [["visibility_digest", input.visibility_digest], ["scope_digest", input.scope_digest]]) if (!HASH.test(value)) searchFail("invalid_request", `${name} must be HashText`);
  const unsigned = { document_id: idText(input.document_id, "document_id"), revision: idText(input.revision, "revision"), fields, facets, visibility_digest: input.visibility_digest, scope_digest: input.scope_digest };
  const expected = hashCanonical(unsigned);
  if (input.scoped_content_hash !== expected) searchFail("binding_mismatch", "scoped_content_hash does not match authorized content");
  return Object.freeze({ document_id: unsigned.document_id, revision: unsigned.revision, fields: unsigned.fields, facets: unsigned.facets, visibility_digest: unsigned.visibility_digest, scoped_content_hash: expected, scope_digest: unsigned.scope_digest });
}

export function deriveScopedSearchDocument(input) {
  const unsigned = { document_id: input.document_id, revision: input.revision, fields: input.fields, facets: input.facets, visibility_digest: input.visibility_digest, scope_digest: input.scope_digest };
  return createScopedSearchDocument({ document_id: unsigned.document_id, revision: unsigned.revision, fields: unsigned.fields, facets: unsigned.facets, visibility_digest: unsigned.visibility_digest, scoped_content_hash: hashCanonical(unsigned), scope_digest: unsigned.scope_digest });
}

export function fieldWeight(name) {
  const found = FIELD_CONTRACT.find((field) => field.name === name);
  if (!found) searchFail("invalid_request", `unknown field ${name}`);
  return found.weight_milli;
}

export const LOGICAL_INDEX_CONTRACT = CONTRACTS.logical_index;
