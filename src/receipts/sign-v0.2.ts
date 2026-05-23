/**
 * v0.2 receipt signing — R-3 empty-string-sentinel procedure.
 *
 * Per ratification R-3 (founder-ratified F-1), the signing pre-image is
 * built by canonicalizing the receipt body with `signature = ""` (empty
 * string), NOT by removing the `signature` field. This preserves byte
 * identity across tracks under JCS canonicalization: a missing `signature`
 * key and a present-but-empty `signature` key produce different canonical
 * byte streams; the empty-sentinel form is the binding choice.
 *
 * Signing procedure:
 *
 *   1. Build draft `D₀` from receipt body excluding `{receipt_hash}` and
 *      with `signature = ""`.
 *   2. Compute `receipt_hash = sha256(JCS(D₀))`.
 *   3. Build `D₁` = D₀ ∪ {receipt_hash}; `signature` still = "".
 *   4. Compute `signature = ed25519_sign(privkey, JCS(D₁))`.
 *   5. Final receipt = D₁ with `signature` set to base64 std-padded encoding
 *      of the 64 raw signature bytes.
 *
 * Verification:
 *
 *   1. Take receipt; rebuild `D₁` by setting `signature` to "".
 *   2. `ed25519_verify(pubkey, sig, JCS(D₁))` → must succeed.
 *   3. Take `D₀` by removing `receipt_hash` from D₁; recompute
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
  const signature = Buffer.from(sigBytes).toString('base64');

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

  // Rebuild D₁ with signature = "".
  const d1 = { ...rest, receipt_hash, signature: SIGNATURE_SENTINEL };
  const preImage = signingPreImageBytes(d1 as unknown as Record<string, unknown>);

  let sigBytes: Buffer;
  try {
    sigBytes = Buffer.from(signature, 'base64');
  } catch {
    return { valid: false, reason: 'signature is not valid base64' };
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
