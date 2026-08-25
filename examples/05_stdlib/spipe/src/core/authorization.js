import { createHash, sign, timingSafeEqual, verify } from "node:crypto";

import { canonicalJson, freezeDeep } from "../storage/canonical.js";
import { assertCanonicalUid } from "../model/identity.js";

const TRUSTED_PORTS = new WeakSet();

function digest(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function unsignedPayload(input) {
  return {
    schema: 1, issuer_key_id: String(input.issuer_key_id),
    project_uid: String(input.project_uid), worktree_uid: String(input.worktree_uid),
    revision_id: String(input.revision_id), source_set_hash: String(input.source_set_hash),
    trust_scope: String(input.trust_scope), principal: String(input.principal),
    capability: String(input.capability), policy_hash: String(input.policy_hash),
    policy_version: String(input.policy_version), decided_at_ms: Number(input.decided_at_ms),
    expires_at_ms: Number(input.expires_at_ms), audit_evidence_hash: String(input.audit_evidence_hash)
  };
}

function unsignedEdgePayload(input) {
  return {
    schema: 1, receipt_kind: "edge_acceptance", issuer_key_id: String(input.issuer_key_id),
    edge_uid: String(input.edge_uid), acceptance_subject_hash: String(input.acceptance_subject_hash),
    from_uid: String(input.from_uid), to_uid: String(input.to_uid), origin: String(input.origin),
    status: String(input.status), project_uid: String(input.project_uid),
    worktree_uid: String(input.worktree_uid), input_snapshot_uid: String(input.input_snapshot_uid),
    policy_hash: String(input.policy_hash), policy_version: Number(input.policy_version),
    capability: String(input.capability), decided_at_ms: Number(input.decided_at_ms),
    expires_at_ms: Number(input.expires_at_ms), audit_evidence_hash: String(input.audit_evidence_hash)
  };
}

export function signTrustReceipt(input, privateKey) {
  const unsigned = unsignedPayload(input);
  const receipt_uid = `D-${digest(unsigned).slice(0, 32).toUpperCase()}`;
  const payload = { ...unsigned, receipt_uid };
  return freezeDeep({ ...payload, signature: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString("base64") });
}

export function signEdgeAcceptanceReceipt(input, privateKey) {
  const unsigned = unsignedEdgePayload(input);
  const receipt_uid = `D-${digest(unsigned).slice(0, 32).toUpperCase()}`;
  const payload = { ...unsigned, receipt_uid };
  return freezeDeep({ ...payload, signature: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString("base64") });
}

/** Verification-only capability injected by the trusted composition root. */
export function createAuthorizationPort({ publicKeys, revokedReceiptUids = [], now = () => Date.now() } = {}) {
  const keys = new Map(Object.entries(publicKeys ?? {}));
  if (!keys.size) throw new TypeError("AuthorizationPort requires trusted public keys");
  const revoked = new Set(revokedReceiptUids);
  const port = Object.freeze({
    verifyTrustReceipt(receipt, expected) {
      try {
        if (!receipt || typeof receipt !== "object" || revoked.has(receipt.receipt_uid)) return null;
        const unsigned = unsignedPayload(receipt);
        const expectedUid = `D-${digest(unsigned).slice(0, 32).toUpperCase()}`;
        assertCanonicalUid(receipt.receipt_uid, "receipt_uid", ["D"]);
        if (!timingSafeEqual(Buffer.from(expectedUid), Buffer.from(receipt.receipt_uid))) return null;
        const payload = { ...unsigned, receipt_uid: receipt.receipt_uid };
        const publicKey = keys.get(unsigned.issuer_key_id);
        if (!publicKey || !verify(null, Buffer.from(canonicalJson(payload)), publicKey, Buffer.from(receipt.signature, "base64"))) return null;
        if (!Number.isSafeInteger(unsigned.decided_at_ms) || !Number.isSafeInteger(unsigned.expires_at_ms) ||
            unsigned.decided_at_ms > now() || unsigned.expires_at_ms <= now()) return null;
        for (const [field, value] of Object.entries(expected)) if (unsigned[field] !== value) return null;
        const requiredCapability = unsigned.trust_scope === "executable_policy" ? "policy.publish" : "trust_scope.assign";
        if (unsigned.capability !== requiredCapability) return null;
        return freezeDeep(payload);
      } catch {
        return null;
      }
    },
    verifyEdgeAcceptanceReceipt(receipt, expected) {
      try {
        if (!receipt || typeof receipt !== "object" || revoked.has(receipt.receipt_uid)) return null;
        const unsigned = unsignedEdgePayload(receipt);
        const expectedUid = `D-${digest(unsigned).slice(0, 32).toUpperCase()}`;
        assertCanonicalUid(receipt.receipt_uid, "receipt_uid", ["D"]);
        if (!timingSafeEqual(Buffer.from(expectedUid), Buffer.from(receipt.receipt_uid))) return null;
        const payload = { ...unsigned, receipt_uid: receipt.receipt_uid };
        const publicKey = keys.get(unsigned.issuer_key_id);
        if (!publicKey || !verify(null, Buffer.from(canonicalJson(payload)), publicKey, Buffer.from(receipt.signature, "base64"))) return null;
        if (!Number.isSafeInteger(unsigned.policy_version) || !Number.isSafeInteger(unsigned.decided_at_ms) ||
            !Number.isSafeInteger(unsigned.expires_at_ms) || unsigned.decided_at_ms > now() || unsigned.expires_at_ms <= now()) return null;
        for (const [field, value] of Object.entries(expected)) if (unsigned[field] !== value) return null;
        if (![["explicit", "trace.accept.explicit"], ["generated", "trace.accept.generated"]]
          .some(([origin, capability]) => unsigned.origin === origin && unsigned.capability === capability)) return null;
        if (unsigned.status !== "accepted") return null;
        return freezeDeep(payload);
      } catch {
        return null;
      }
    }
  });
  TRUSTED_PORTS.add(port);
  return port;
}

export function isTrustedAuthorizationPort(port) {
  return Boolean(port && TRUSTED_PORTS.has(port));
}
