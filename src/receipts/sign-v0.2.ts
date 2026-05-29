/**
 * v0.2 receipt signing — S1 clear-to-defaults pre-image + RFC-002 §6
 * algorithm-prefixed final value.
 *
 * ─── Pre-image construction (S1 clear-to-defaults) ───────────────────────────
 *
 * Per the cross-track S1 construction procedure (F-2 / Bridge Proof v0.2
 * cascade § 2.2, captured in
 * `tests/fixtures/golden-receipt/inputs.json` `_construction_procedure`), the
 * signing pre-image is built by CLEARING the two self-referential fields to
 * their defaults and canonicalizing:
 *
 *   - `signature`    = "" (empty-string sentinel, R-3 / F-2)
 *   - `receipt_hash` = the 64-char all-zeros placeholder
 *
 * This is ONE canonical pre-image. Both `receipt_hash` and the Ed25519
 * `signature` are computed over the SAME bytes — the body with `signature=""`
 * AND `receipt_hash` set to the zero placeholder. This is the single
 * structural change from the prior v0.2 procedure, which built two distinct
 * pre-images: a `receipt_hash` pre-image with the `receipt_hash` KEY REMOVED
 * (variant D₀), and a separate signature pre-image carrying the populated
 * `receipt_hash`. The two procedures produce DIFFERENT bytes and therefore
 * different `receipt_hash`/`signature` values; the S1 clear-to-defaults form
 * is the cross-track binding choice (Rust + Python + TS golden receipt), so
 * the production helper is reconciled onto it here. See
 * `tests/golden-receipt.test.ts` / `tests/golden-receipt-self-check.test.ts`
 * for the three-way byte-identity gate (RFC-002 §7).
 *
 * Why CLEAR-to-defaults and not field-removal: under JCS canonicalization a
 * present-but-zeroed `receipt_hash` key and a present-but-empty `signature`
 * key both contribute a fixed, deterministic key/value pair to the canonical
 * byte stream. Every track materializes the receipt struct with these two
 * fields present and defaulted before signing, so the bytes are identical
 * across Rust (`Sha256Hash::zero()` + `signature = ""`), Python, and TS. A
 * field-removal form would require each track to agree on key absence, which
 * the strongly-typed Rust struct cannot express without a separate draft type.
 *
 * ─── Final wire value (RFC-002 §6 amendment, 2026-05-23) ─────────────────────
 *
 * The FINAL populated `signature` value carries an algorithm prefix:
 * `ed25519:` + base64. The prefix appears ONLY in the final wire value, NOT
 * in the pre-image (the pre-image still uses `signature = ""`). The prefix
 * mirrors the §5 digest prefix and exists for future-algorithm extension
 * without a wire break.
 *
 * ─── Signing procedure ───────────────────────────────────────────────────────
 *
 *   1. Build pre-image object `P` from the receipt body with
 *      `signature = ""` AND `receipt_hash = <64 zeros>`.
 *   2. `preimage_bytes = JCS(P)`.
 *   3. `receipt_hash = sha256(preimage_bytes)`.
 *   4. `signature_bytes = ed25519_sign(privkey, preimage_bytes)`  ← SAME bytes.
 *   5. Final receipt = body with `receipt_hash` set to the step-3 value and
 *      `signature` set to `"ed25519:" + base64(signature_bytes)`.
 *
 * ─── Verification (procedure inverse) ────────────────────────────────────────
 *
 *   1. Take receipt; require `signature` matches `ed25519:<base64>` —
 *      reject as malformed otherwise (distinct from "invalid signature").
 *   2. Strip the `ed25519:` prefix; base64-decode the payload.
 *   3. Rebuild pre-image `P` by setting `signature = ""` AND
 *      `receipt_hash = <64 zeros>`; `preimage_bytes = JCS(P)`.
 *   4. `ed25519_verify(pubkey, sig_bytes, preimage_bytes)` → must succeed.
 *   5. Recompute `sha256(preimage_bytes)`; assert equality with
 *      `receipt.receipt_hash`.
 *
 * This module exposes those two operations as pure functions. Key
 * management (where the private key lives, rotation, sigstore keyless
 * mode, etc.) is the caller's responsibility — this helper takes raw
 * key material as inputs.
 */

import { createHash, createPrivateKey, createPublicKey, sign as nodeSign, verify as nodeVerify } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { canonicalize, sha256OfCanonical } from '../integrity/hash-chain.js';
import type {
  ExecutionReceiptV02,
  ExecutionReceiptV02Draft,
} from '../../schemas/receipt-v0.2.schema.js';

/** Empty-string sentinel used during signing pre-image construction (R-3 / F-2). */
export const SIGNATURE_SENTINEL = '';

/** All-zeros `receipt_hash` placeholder used during S1 clear-to-defaults
 *  pre-image construction. 64 lowercase hex zeros = the wire-form of the
 *  Rust `Sha256Hash::zero()` ([u8; 32] of zero bytes). Both the
 *  `receipt_hash` computation and the Ed25519 signature run over the canonical
 *  body carrying this placeholder (and `signature = ""`). */
export const RECEIPT_HASH_PLACEHOLDER =
  '0000000000000000000000000000000000000000000000000000000000000000';

/** Algorithm-prefix tag carried on the final populated `signature` value per
 *  RFC-002 §6 amendment (2026-05-23). Schema version 0.2 permits this exact
 *  prefix only; any other tag is a malformed-receipt schema violation. */
export const SIGNATURE_ALGORITHM_PREFIX = 'ed25519:';

/**
 * Build the canonical S1 clear-to-defaults pre-image bytes from a receipt
 * draft.
 *
 * The single pre-image is the receipt body canonicalized with the two
 * self-referential fields cleared to their defaults:
 *   - `signature`    = "" (empty-string sentinel)
 *   - `receipt_hash` = the all-zeros placeholder
 *
 * Both `receipt_hash` and the Ed25519 signature are derived from these exact
 * bytes. The function asserts `draft.signature` is the empty-string sentinel
 * (the draft must not carry a populated signature) and overwrites
 * `receipt_hash` with the placeholder regardless of any value already present.
 */
export function signingPreImageBytes(body: Record<string, unknown>): Uint8Array {
  if (body['signature'] !== SIGNATURE_SENTINEL) {
    throw new Error(
      'signingPreImageBytes: body.signature must be the empty-string sentinel ("") per R-3/F-2'
    );
  }
  const preImage = { ...body, receipt_hash: RECEIPT_HASH_PLACEHOLDER };
  return new TextEncoder().encode(canonicalize(preImage));
}

/**
 * Compute `receipt_hash` per step 3 of the procedure.
 *
 * Input: the v0.2 receipt draft with `signature = ""` (no populated
 * `receipt_hash` — the draft type excludes it; any value present is ignored
 * and overwritten with the zero placeholder).
 * Returns: 64-char lowercase hex SHA-256 of the canonical S1 pre-image bytes.
 */
export function computeReceiptHash(draft: ExecutionReceiptV02Draft): string {
  if (draft.signature !== SIGNATURE_SENTINEL) {
    throw new Error(
      'computeReceiptHash: draft.signature must be the empty-string sentinel ("") per R-3/F-2'
    );
  }
  const preImage = {
    ...(draft as unknown as Record<string, unknown>),
    receipt_hash: RECEIPT_HASH_PLACEHOLDER,
  };
  return sha256OfCanonical(preImage);
}

/**
 * Sign a v0.2 receipt body per the full S1 clear-to-defaults procedure.
 *
 * Inputs:
 *   - `draft`: the v0.2 receipt draft (no `receipt_hash`, `signature = ""`).
 *   - `privateKey`: Ed25519 private key (Node KeyObject, PEM string, or
 *     raw 32-byte seed).
 *
 * Returns the finalized receipt with `receipt_hash` and `signature` set.
 *
 * Both `receipt_hash` and `signature` are computed over the SAME canonical
 * pre-image bytes (S1 clear-to-defaults: `signature=""` AND
 * `receipt_hash=<zeros>`).
 */
export function signReceiptV02(
  draft: ExecutionReceiptV02Draft,
  privateKey: KeyObject | string | Uint8Array
): ExecutionReceiptV02 {
  // ONE canonical pre-image (signature="" AND receipt_hash=zeros). Both the
  // hash and the signature are derived from these exact bytes.
  const preImage = signingPreImageBytes(draft as unknown as Record<string, unknown>);

  // Step 3: receipt_hash = sha256(pre-image bytes).
  const receipt_hash = createHash('sha256').update(preImage).digest('hex');

  // Step 4: signature = ed25519_sign over the SAME pre-image bytes.
  const key = coercePrivateKey(privateKey);
  const sigBytes = nodeSign(null, preImage, key);
  // RFC-002 §6 amendment: prepend the algorithm-prefix to the final wire value.
  // The prefix is added AFTER signing; the signed pre-image carries
  // `signature = ""` and `receipt_hash = <zeros>` and is unaffected.
  const signature =
    SIGNATURE_ALGORITHM_PREFIX + Buffer.from(sigBytes).toString('base64');

  // Step 5: finalize — populate receipt_hash and the prefixed signature.
  return { ...draft, receipt_hash, signature } as ExecutionReceiptV02;
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

  // Rebuild the S1 clear-to-defaults pre-image: signature="" AND
  // receipt_hash=<zeros>. The prefix appears only in the final wire value,
  // never in the signed bytes; the populated receipt_hash is likewise cleared
  // back to the placeholder for the pre-image.
  const preImage = signingPreImageBytes({ ...rest, signature: SIGNATURE_SENTINEL });

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

  // Recompute receipt_hash from the SAME pre-image bytes and compare.
  const expected = createHash('sha256').update(preImage).digest('hex');
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
