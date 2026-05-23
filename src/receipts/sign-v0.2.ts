/**
 * v0.2 receipt signing — R-3 empty-string-sentinel procedure + RFC-002 §6
 * algorithm-prefixed final value.
 *
 * Per ratification R-3 (founder-ratified F-1), the signing pre-image is
 * built by canonicalizing the receipt body with `signature = ""` (empty
 * string), NOT by removing the `signature` field. This preserves byte
 * identity across tracks under JCS canonicalization: a missing `signature`
 * key and a present-but-empty `signature` key produce different canonical
 * byte streams; the empty-sentinel form is the binding choice.
 *
 * Per RFC-002 §6 amendment (2026-05-23, three-track concurrence collected),
 * the FINAL populated `signature` value carries an algorithm prefix:
 * `ed25519:` + base64. The prefix appears only in the final wire value, NOT
 * in the pre-image (the pre-image still uses `signature = ""`). The prefix
 * mirrors the §5 digest prefix and exists for future-algorithm extension
 * without a wire break.
 *
 * Signing procedure:
 *
 *   1. Build draft `D₀` from receipt body excluding `{receipt_hash}` and
 *      with `signature = ""`.
 *   2. Compute `receipt_hash = sha256(JCS(D₀))`.
 *   3. Build `D₁` = D₀ ∪ {receipt_hash}; `signature` still = "".
 *   4. Compute `signature_bytes = ed25519_sign(privkey, JCS(D₁))`.
 *   5. Final receipt = D₁ with `signature` set to
 *      `"ed25519:" + base64(signature_bytes)`.
 *
 * Verification:
 *
 *   1. Take receipt; require `signature` matches `ed25519:<base64>` —
 *      reject as malformed otherwise (distinct from "invalid signature").
 *   2. Strip the `ed25519:` prefix; base64-decode the payload.
 *   3. Rebuild `D₁` by setting `signature` to "".
 *   4. `ed25519_verify(pubkey, sig_bytes, JCS(D₁))` → must succeed.
 *   5. Take `D₀` by removing `receipt_hash` from D₁; recompute
 *      `sha256(JCS(D₀))`; assert equality with `receipt.receipt_hash`.
 *
 * This module exposes those two operations as pure functions. Key
 * management (where the private key lives, rotation, sigstore keyless
 * mode, etc.) is the caller's responsibility — this helper takes raw
 * key material as inputs.
 */

import { createPrivateKey, createPublicKey, sign as nodeSign, verify as nodeVerify } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { canonicalize, sha256OfCanonical } from '../integrity/hash-chain.js';
import type {
  ExecutionReceiptV02,
  ExecutionReceiptV02Draft,
} from '../../schemas/receipt-v0.2.schema.js';

/** Empty-string sentinel used during signing pre-image construction (R-3). */
export const SIGNATURE_SENTINEL = '';

/** Algorithm-prefix tag carried on the final populated `signature` value per
 *  RFC-002 §6 amendment (2026-05-23). Schema version 0.2 permits this exact
 *  prefix only; any other tag is a malformed-receipt schema violation. */
export const SIGNATURE_ALGORITHM_PREFIX = 'ed25519:';

/**
 * Build the canonical signing pre-image bytes for a receipt body.
 *
 * The body must already carry `signature = ""` (the empty-string sentinel).
 * Caller chooses whether to include `receipt_hash`:
 *   - exclude → produces the pre-image for the `receipt_hash` computation
 *   - include → produces the pre-image for the Ed25519 signature
 */
export function signingPreImageBytes(body: Record<string, unknown>): Uint8Array {
  if (body['signature'] !== SIGNATURE_SENTINEL) {
    throw new Error(
      'signingPreImageBytes: body.signature must be the empty-string sentinel ("") per R-3'
    );
  }
  return new TextEncoder().encode(canonicalize(body));
}

/**
 * Compute `receipt_hash` per step 2 of the procedure.
 *
 * Input: the v0.2 receipt draft with `signature = ""`.
 * Returns: 64-char lowercase hex SHA-256 of the canonical draft bytes.
 */
export function computeReceiptHash(draft: ExecutionReceiptV02Draft): string {
  if (draft.signature !== SIGNATURE_SENTINEL) {
    throw new Error(
      'computeReceiptHash: draft.signature must be the empty-string sentinel ("") per R-3'
    );
  }
  return sha256OfCanonical(draft as unknown as Record<string, unknown>);
}

/**
 * Sign a v0.2 receipt body per the full R-3 procedure.
 *
 * Inputs:
 *   - `draft`: the v0.2 receipt draft (no `receipt_hash`, `signature = ""`).
 *   - `privateKey`: Ed25519 private key (Node KeyObject, PEM string, or
 *     raw 32-byte seed).
 *
 * Returns the finalized receipt with `receipt_hash` and `signature` set.
 */
export function signReceiptV02(
  draft: ExecutionReceiptV02Draft,
  privateKey: KeyObject | string | Uint8Array
): ExecutionReceiptV02 {
  const receipt_hash = computeReceiptHash(draft);

  // Build D₁: draft + receipt_hash, signature still = "".
  const d1 = { ...draft, receipt_hash };

  const preImage = signingPreImageBytes(d1 as unknown as Record<string, unknown>);
  const key = coercePrivateKey(privateKey);
  const sigBytes = nodeSign(null, preImage, key);
  // RFC-002 §6 amendment: prepend the algorithm-prefix to the final wire value.
  // The prefix is added AFTER signing; the signed pre-image carries
  // `signature = ""` (the R-3 empty-string sentinel) and is unaffected.
  const signature =
    SIGNATURE_ALGORITHM_PREFIX + Buffer.from(sigBytes).toString('base64');

  return { ...d1, signature } as ExecutionReceiptV02;
}

/**
 * Verify a v0.2 receipt's `signature` and `receipt_hash` per the procedure
 * inverse. Returns `{ valid: true }` on success or `{ valid: false, reason }`
 * on first failure encountered.
 */
export function verifyReceiptV02(
  receipt: ExecutionReceiptV02,
  publicKey: KeyObject | string | Uint8Array
): { valid: boolean; reason?: string } {
  const { signature, receipt_hash, ...rest } = receipt;

  // RFC-002 §6 amendment: the final wire value MUST be algorithm-prefixed.
  // Missing or wrong algorithm-tag → malformed receipt (distinct diagnostic
  // from "invalid signature"); both collapse to { valid: false } here, but
  // the `reason` field preserves the distinction for callers.
  if (!signature.startsWith(SIGNATURE_ALGORITHM_PREFIX)) {
    return {
      valid: false,
      reason:
        'malformed signature: missing or unknown algorithm tag (v0.2 requires "ed25519:" prefix per RFC-002 §6)',
    };
  }
  const sigPayload = signature.slice(SIGNATURE_ALGORITHM_PREFIX.length);

  // Rebuild D₁ with signature = "" (pre-image carries the empty-string
  // sentinel — prefix appears only in the final wire value, never in the
  // signed bytes).
  const d1 = { ...rest, receipt_hash, signature: SIGNATURE_SENTINEL };
  const preImage = signingPreImageBytes(d1 as unknown as Record<string, unknown>);

  let sigBytes: Buffer;
  try {
    sigBytes = Buffer.from(sigPayload, 'base64');
  } catch {
    return { valid: false, reason: 'signature payload is not valid base64' };
  }

  const key = coercePublicKey(publicKey);
  const ok = nodeVerify(null, preImage, key, sigBytes);
  if (!ok) {
    return { valid: false, reason: 'ed25519 signature verification failed' };
  }

  // Recompute receipt_hash from D₀ = D₁ minus receipt_hash.
  const d0 = { ...rest, signature: SIGNATURE_SENTINEL };
  const expected = sha256OfCanonical(d0 as unknown as Record<string, unknown>);
  if (expected !== receipt_hash) {
    return { valid: false, reason: 'receipt_hash mismatch (self-hash check failed)' };
  }

  return { valid: true };
}

function coercePrivateKey(k: KeyObject | string | Uint8Array): KeyObject {
  if (typeof k === 'object' && k !== null && 'asymmetricKeyType' in k) {
    return k as KeyObject;
  }
  if (typeof k === 'string') {
    return createPrivateKey(k);
  }
  // Raw seed (32 bytes) — wrap as PKCS#8 Ed25519.
  if (k instanceof Uint8Array && k.length === 32) {
    const pkcs8 = Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      Buffer.from(k),
    ]);
    return createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
  }
  throw new Error('coercePrivateKey: unsupported key material');
}

function coercePublicKey(k: KeyObject | string | Uint8Array): KeyObject {
  if (typeof k === 'object' && k !== null && 'asymmetricKeyType' in k) {
    return k as KeyObject;
  }
  if (typeof k === 'string') {
    return createPublicKey(k);
  }
  if (k instanceof Uint8Array && k.length === 32) {
    const spki = Buffer.concat([
      Buffer.from('302a300506032b6570032100', 'hex'),
      Buffer.from(k),
    ]);
    return createPublicKey({ key: spki, format: 'der', type: 'spki' });
  }
  throw new Error('coercePublicKey: unsupported key material');
}
