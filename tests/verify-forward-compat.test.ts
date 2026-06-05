/**
 * Forward-compatibility regression for the v0.2 verify surface.
 *
 * A v0.2 receipt that carries an UNKNOWN additive top-level field — a field
 * outside the 17-field canon — and is correctly signed over ALL of its fields
 * (the unknown one included) MUST verify VALID. Previously it verified
 * INVALID: the verify path parsed the received JSON through the zod schema,
 * which strips unknown keys, then recomputed the signature/receipt_hash
 * pre-image from the stripped object, so the pre-image no longer matched the
 * bytes that were actually signed.
 *
 * These cases drive the PUBLIC verify entry point (`verifyArtifact`), which is
 * what the CLI feeds the raw parsed JSON into, and use the repo's real Ed25519
 * signing primitive (`signReceiptV02`) so the receipts are genuinely signed.
 *
 * Three cases:
 *   (a) control      — valid receipt, NO extra field, signed        → VALID
 *   (b) forward-compat — same receipt PLUS one unknown additive field,
 *                        signed over ALL fields incl. the extra      → VALID
 *   (c) tamper       — a signed valid receipt with an existing field
 *                      value mutated WITHOUT re-signing              → INVALID
 *
 * Plus guards proving the fix does NOT weaken validation: a receipt missing a
 * required field, and one with a wrong-typed existing field, still verify
 * INVALID.
 */

import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, createPublicKey } from 'node:crypto';
import {
  SIGNATURE_SENTINEL,
  signReceiptV02,
} from '../src/receipts/sign-v0.2.js';
import type { ExecutionReceiptV02Draft } from '../schemas/receipt-v0.2.schema.js';
import { verifyArtifact } from '../src/verify/verify.js';

function makeKeyPair() {
  return generateKeyPairSync('ed25519');
}

/** A canonical 17-field v0.2 draft (signature = empty sentinel, no receipt_hash). */
function makeDraft(
  overrides: Partial<ExecutionReceiptV02Draft> = {}
): ExecutionReceiptV02Draft {
  return {
    schema_version: 'witseal.receipt.v0.2',
    receipt_id: 'rcpt_fwdcompat0000000000001',
    witness_event_id: 'evt_fwdcompat000000000001',
    chain_segment_id: 'fwd-compat-test-segment',
    finalized_at: '2026-05-26T10:00:00.000Z',
    policy_decision_hash: 'a'.repeat(64),
    classified_intent_hash: 'b'.repeat(64),
    execution_result_hash: 'c'.repeat(64),
    outcome: 'allowed_executed',
    prev_hash: null,
    signature: SIGNATURE_SENTINEL,
    git_commit: '0'.repeat(40),
    artifact_digest: 'sha256:' + 'd'.repeat(64),
    attestation_digest: 'sha256:' + 'e'.repeat(64),
    artifact_type: 'generic-binary',
    build_id: 'witseal-fwdcompat-build-0001',
    ...overrides,
  };
}

describe('v0.2 verify forward-compatibility', () => {
  it('(a) control: a valid receipt with NO extra field verifies VALID', () => {
    const { privateKey, publicKey } = makeKeyPair();
    const receipt = signReceiptV02(makeDraft(), privateKey);

    const result = verifyArtifact(receipt, publicKey);
    expect(result.valid).toBe(true);
    expect(result.kind).toBe('receipt.v0.2');
    expect(result.reason).toBeUndefined();
  });

  it('(b) forward-compat: a receipt with an unknown additive field, signed over ALL fields, verifies VALID', () => {
    const { privateKey, publicKey } = makeKeyPair();

    // Add an unknown top-level additive field to the body BEFORE signing, so
    // the field is part of the canonical pre-image and is genuinely signed
    // over. `signReceiptV02` canonicalizes the whole body (JCS sorts the new
    // key in with the rest), so the signature + receipt_hash cover it.
    const draftWithExtra = {
      ...makeDraft(),
      future_additive_field: 'a-value-the-current-canon-does-not-know',
    } as unknown as ExecutionReceiptV02Draft;

    const receipt = signReceiptV02(draftWithExtra, privateKey);

    // The unknown field is actually present on the signed receipt object.
    expect(
      (receipt as unknown as Record<string, unknown>)['future_additive_field']
    ).toBe('a-value-the-current-canon-does-not-know');

    const result = verifyArtifact(receipt, publicKey);
    expect(result.valid).toBe(true);
    expect(result.kind).toBe('receipt.v0.2');
    expect(result.reason).toBeUndefined();
  });

  it('(c) tamper: mutating an existing field of a signed receipt (no re-sign) verifies INVALID', () => {
    const { privateKey, publicKey } = makeKeyPair();
    const receipt = signReceiptV02(makeDraft(), privateKey);

    // Mutate an existing canon field value WITHOUT re-signing.
    const tampered = { ...receipt, outcome: 'denied_by_policy' };

    const result = verifyArtifact(tampered, publicKey);
    expect(result.valid).toBe(false);
    expect(result.kind).toBe('receipt.v0.2');
  });

  it('forward-compat does NOT make the signature optional: a tampered receipt that ALSO carries an unknown field still verifies INVALID', () => {
    const { privateKey, publicKey } = makeKeyPair();
    const receipt = signReceiptV02(makeDraft(), privateKey);

    // Start from a validly-signed receipt, then both (1) inject an unknown
    // additive field and (2) mutate an existing field — neither re-signed.
    const tampered = {
      ...receipt,
      future_additive_field: 'injected-after-signing',
      git_commit: '1'.repeat(40),
    };

    const result = verifyArtifact(tampered, publicKey);
    expect(result.valid).toBe(false);
  });

  describe('validation is NOT weakened by the forward-compat change', () => {
    it('a receipt missing a required field verifies INVALID (schema gate)', () => {
      const { privateKey, publicKey } = makeKeyPair();
      const receipt = signReceiptV02(makeDraft(), privateKey);

      // Drop a required canon field.
      const { build_id: _dropped, ...withoutRequired } = receipt as Record<
        string,
        unknown
      > & { build_id: string };
      void _dropped;

      const result = verifyArtifact(withoutRequired, publicKey);
      expect(result.valid).toBe(false);
      expect(result.kind).toBe('receipt.v0.2');
      expect(result.reason).toMatch(/schema validation failed/i);
    });

    it('a receipt with a wrong-typed existing field verifies INVALID (schema gate)', () => {
      const { privateKey, publicKey } = makeKeyPair();
      const receipt = signReceiptV02(makeDraft(), privateKey);

      // Wrong type / shape for an existing field (git_commit must be 40-hex).
      const wrongType = { ...receipt, git_commit: 12345 as unknown as string };

      const result = verifyArtifact(wrongType, publicKey);
      expect(result.valid).toBe(false);
      expect(result.kind).toBe('receipt.v0.2');
      expect(result.reason).toMatch(/schema validation failed/i);
    });

    it('receipt_id stays nullable-mandatory (a null receipt_id with execution_lost still verifies VALID when signed)', () => {
      // Guard against an over-broad "make receipt_id nullable/optional" mistake:
      // the nullable behavior is the existing canon and must be preserved, but
      // not loosened. A genuinely-signed execution_lost receipt (receipt_id =
      // null) must verify VALID through the same path.
      const { privateKey, publicKey } = makeKeyPair();
      const draft = makeDraft({
        receipt_id: null,
        outcome: 'execution_lost',
        execution_result_hash: null,
      });
      const receipt = signReceiptV02(draft, privateKey);
      const result = verifyArtifact(receipt, publicKey);
      expect(result.valid).toBe(true);
    });
  });
});

describe('v0.2 verify forward-compatibility — golden receipt regression', () => {
  it('the committed golden receipt (rust-golden.json, 17 canon fields) still verifies VALID', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const golden = JSON.parse(
      readFileSync(
        join(here, 'fixtures', 'golden-receipt', 'rust-golden.json'),
        'utf8'
      )
    ) as unknown;

    // Golden test public key (raw 32-byte hex) wrapped as SPKI DER.
    const pubHex =
      'fd62f46e4e64333ef4c0693e9caf52a540cb21a3546547f016bcd0e990c91862';
    const spki = Buffer.concat([
      Buffer.from('302a300506032b6570032100', 'hex'),
      Buffer.from(pubHex, 'hex'),
    ]);
    const publicKey = createPublicKey({ key: spki, format: 'der', type: 'spki' });

    const result = verifyArtifact(golden, publicKey);
    expect(result.valid).toBe(true);
    expect(result.kind).toBe('receipt.v0.2');
  });
});
