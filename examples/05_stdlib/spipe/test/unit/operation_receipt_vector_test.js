import assert from "node:assert/strict";
import test from "node:test";
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { readFile } from "node:fs/promises";

const fixtureUrl = new URL("../fixture/wave4_search/operation_receipt_vector.json", import.meta.url);

function rawEd25519PrivateKey(seed) {
  // RFC 8410 PKCS#8 prefix for an Ed25519 32-byte private seed.
  return createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), format: "der", type: "pkcs8" });
}

test("operation receipt fixture independently recomputes canonical domain id and signature", async () => {
  const vector = JSON.parse(await readFile(fixtureUrl, "utf8"));
  const unsigned = Buffer.from(vector.unsigned_canonical, "utf8");
  const independentlyCanonical = JSON.stringify(Object.fromEntries(
    Object.entries(JSON.parse(vector.unsigned_canonical)).sort(([left], [right]) => left.localeCompare(right))
  ));
  const length = Buffer.alloc(8); length.writeBigUInt64BE(BigInt(unsigned.length));
  const domain = Buffer.concat([Buffer.from("SPKC-OPERATION-RECEIPT-V1\0", "utf8"), length, unsigned]);
  const privateKey = rawEd25519PrivateKey(Buffer.from(vector.seed_hex, "hex"));
  const publicDer = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  const publicRaw = publicDer.subarray(publicDer.length - 32);
  const digest = createHash("sha256").update(domain).digest("hex");
  const signature = sign(null, domain, privateKey).toString("base64url");

  assert.equal(unsigned.length, vector.unsigned_utf8_length);
  assert.equal(independentlyCanonical, vector.unsigned_canonical);
  assert.equal(vector.domain_ascii_with_nul, "SPKC-OPERATION-RECEIPT-V1\0");
  assert.equal(domain.length, vector.domain_bytes_length);
  assert.equal(publicRaw.toString("hex"), vector.public_key_hex);
  assert.equal(`ed25519:${createHash("sha256").update(publicRaw).digest("hex")}`, vector.key_id);
  assert.equal(digest, vector.domain_bytes_sha256);
  assert.equal(`or-${digest}`, vector.receipt_id);
  assert.equal(signature, vector.signature_base64url);
  assert.equal(verify(null, domain, createPublicKey(privateKey), Buffer.from(signature, "base64url")), true);
});
