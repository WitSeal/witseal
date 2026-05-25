/**
 * F-1 — Golden-receipt three-way byte-identity demo.
 *
 * Reproduces the authoritative Rust artifact
 * (`tests/fixtures/golden-receipt/rust-golden.canonical`, copied from
 * `witseal-rs-3/crates/witseal-testkit/corpus/v0.2/golden_receipt/`) on
 * the TS line and asserts byte-identical canonical wire bytes.
 *
 * The test is intentionally STANDALONE from the production
 * `src/receipts/sign-v0.2.ts` pipeline. Two reasons:
 *
 *   1. The Rust authoritative struct (`ReceiptV0_2` per
 *      witseal-rs-3/crates/witseal-core/src/receipt.rs) carries fields
 *      `artifact_type` and `build_id` that the TS production
 *      `schemas/receipt-v0.2.schema.ts` does not yet declare (those
 *      land in a subsequent schema-alignment PR, separate from this
 *      F-1 demonstration scope).
 *
 *   2. The Rust S1 clear-defaults construction procedure (per
 *      `inputs.json` `_construction_procedure`) signs canonical bytes
 *      with `signature = ""` AND `receipt_hash` set to the
 *      all-zeros placeholder, whereas the production TS
 *      `signReceiptV02` builds the pre-image by REMOVING the
 *      `receipt_hash` key (D₀ in the existing TSDoc). Both shapes are
 *      sound; the S1 clear-defaults shape is the one Rust + Python +
 *      TS are aligning on per F-2 / Bridge Proof v0.2 cascade § 2.2.
 *      Migrating the production helper to S1 clear-defaults is a
 *      separate PR; this demo proves the procedure works on TS
 *      without forcing the migration on the same commit.
 *
 * Source-of-truth corpus: `tests/fixtures/golden-receipt/` — copied
 * verbatim from the Rust corpus at cycle 69 publication. Re-sync from
 * the Rust repo if the corpus regenerates.
 *
 * Acceptance per the 2026-05-26 goal directive:
 *   - TS canonical bytes === `rust-golden.canonical`, byte for byte
 *   - TS signature       === `rust-golden.sig` contents (after trim)
 *   - Demo is reproducible — run `npx vitest run tests/golden-receipt.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { createHash, createPrivateKey, createPublicKey, sign as nodeSign, verify as nodeVerify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { canonicalize } from '../src/integrity/hash-chain.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = join(HERE, 'fixtures', 'golden-receipt');

// ---------------------------------------------------------------------------
// Test-only key derivation (per test-only-do-not-use-in-prod.key.json)
// ---------------------------------------------------------------------------
//
// Seed string SHA-256 → 32-byte seed → Ed25519 SigningKey (PKCS#8 wrap for
// node:crypto). See the key fixture for cross-track equivalents
// (Rust ed25519_dalek, Python cryptography, TS noble-curves).

const TEST_KEY_SEED_STRING = 'witseal-v0.2-golden-receipt-test-key-0001';
const EXPECTED_SEED_HEX =
  '2950951f134b988957c5b5e0644e0a16f3139f45858fc920a7303971d404ae9f';
const EXPECTED_PUBLIC_KEY_HEX =
  'fd62f46e4e64333ef4c0693e9caf52a540cb21a3546547f016bcd0e990c91862';

function deriveTestSeed(): Buffer {
  return createHash('sha256').update(TEST_KEY_SEED_STRING, 'utf8').digest();
}

function wrapSeedAsPkcs8(seed: Buffer): Buffer {
  // PKCS#8 Ed25519 prefix: 0x302e020100300506032b657004220420 (16 bytes) + 32-byte seed
  const pkcs8Prefix = Buffer.from('302e020100300506032b657004220420', 'hex');
  return Buffer.concat([pkcs8Prefix, seed]);
}

function loadSigningKey() {
  const seed = deriveTestSeed();
  if (seed.toString('hex') !== EXPECTED_SEED_HEX) {
    throw new Error(
      `seed derivation drift: expected ${EXPECTED_SEED_HEX}, got ${seed.toString('hex')}`
    );
  }
  const pkcs8 = wrapSeedAsPkcs8(seed);
  const privateKey = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
  const publicKey = createPublicKey(privateKey);
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  // Last 32 bytes of SPKI DER = raw Ed25519 public key
  const pubRaw = spki.subarray(spki.length - 32);
  if (pubRaw.toString('hex') !== EXPECTED_PUBLIC_KEY_HEX) {
    throw new Error(
      `public-key drift: expected ${EXPECTED_PUBLIC_KEY_HEX}, got ${pubRaw.toString('hex')}`
    );
  }
  return { privateKey, publicKey, pubRaw };
}

// ---------------------------------------------------------------------------
// Sentinel-hash derivation (per inputs.json `_sentinel_seeds`)
// ---------------------------------------------------------------------------

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

const SENTINEL_HASHES = {
  policy_decision_hash: sha256Hex('witseal-v0.2-golden-policy-decision'),
  classified_intent_hash: sha256Hex('witseal-v0.2-golden-classified-intent'),
  execution_result_hash: sha256Hex('witseal-v0.2-golden-execution-result'),
  // The digest fields carry the literal `sha256:` prefix (RFC-002 §5).
  artifact_digest: 'sha256:' + sha256Hex('witseal-v0.2-golden-artifact-digest'),
  attestation_digest:
    'sha256:' + sha256Hex('witseal-v0.2-golden-attestation-digest'),
};

const EXPECTED_SENTINELS = {
  policy_decision_hash:
    'b7dda4aea89781686aaf8fd2b2f88ca54c4e7b798f9cd1edd5ca3cbc93d92b79',
  classified_intent_hash:
    '819f4734564908d46ac7c78c1fc9df867c1fd16d88efbe298da72476df70a246',
  execution_result_hash:
    '7341501eef01eadf49ffa951751546712f476dda00db751cac10f80a0ea50cee',
  artifact_digest:
    'sha256:c007606a264a9ef0c0950f3b0f4e542bb09737c64437cd91e47bb2accbc8cb29',
  attestation_digest:
    'sha256:fab32ae873e47bc9375351acf767087cb4239fe26a028869f8e3d454bccb500f',
};

// ---------------------------------------------------------------------------
// Receipt construction (S1 clear-defaults procedure per inputs.json)
// ---------------------------------------------------------------------------
//
// Field set + values are the LITERAL spec from inputs.json `receipt_inputs`,
// with sentinel-derived hash fields filled in. The struct shape mirrors the
// Rust ReceiptV0_2 (which carries `artifact_type` + `build_id` not present
// in the current TS production schema — see test-header note).

const SIGNATURE_SENTINEL_VALUE = '';
const RECEIPT_HASH_ZERO_PLACEHOLDER =
  '0000000000000000000000000000000000000000000000000000000000000000';
const SIGNATURE_ALGORITHM_PREFIX = 'ed25519:';

interface GoldenReceiptShape {
  schema_version: 'witseal.receipt.v0.2';
  receipt_id: string;
  witness_event_id: string;
  chain_segment_id: string;
  finalized_at: string;
  policy_decision_hash: string;
  classified_intent_hash: string;
  execution_result_hash: string;
  outcome: string;
  artifact_digest: string;
  artifact_type: string;
  build_id: string;
  git_commit: string;
  attestation_digest: string;
  signature: string;
  prev_hash: string | null;
  receipt_hash: string;
}

function buildBaseReceipt(): GoldenReceiptShape {
  return {
    schema_version: 'witseal.receipt.v0.2',
    receipt_id: 'rcpt_golden00000000000000001',
    witness_event_id: 'evt_golden0000000000000001',
    chain_segment_id: 'corpus-golden-receipt-v0_2',
    finalized_at: '2026-05-26T10:00:00.000Z',
    policy_decision_hash: SENTINEL_HASHES.policy_decision_hash,
    classified_intent_hash: SENTINEL_HASHES.classified_intent_hash,
    execution_result_hash: SENTINEL_HASHES.execution_result_hash,
    outcome: 'allowed_executed',
    artifact_digest: SENTINEL_HASHES.artifact_digest,
    artifact_type: 'generic-binary',
    build_id: 'witseal-golden-build-0001',
    git_commit: '0000000000000000000000000000000000000000',
    attestation_digest: SENTINEL_HASHES.attestation_digest,
    // S1 clear-defaults pre-image placeholders (before steps 3+4):
    signature: SIGNATURE_SENTINEL_VALUE,
    prev_hash: null,
    receipt_hash: RECEIPT_HASH_ZERO_PLACEHOLDER,
  };
}

function s1PreImageBytes(receipt: GoldenReceiptShape): Buffer {
  // Step 2 of the construction procedure: serialize per RFC 8785 with
  // signature="" AND receipt_hash=all-zeros. prev_hash=null emits explicit
  // `null`. Path D optionals are absent from the type so canonicalize
  // doesn't emit them.
  return Buffer.from(canonicalize(receipt), 'utf8');
}

function generateGoldenReceiptBytes(): {
  finalBytes: Buffer;
  receiptHashHex: string;
  signatureWire: string;
  populatedReceipt: GoldenReceiptShape;
} {
  const draft = buildBaseReceipt();
  // Step 2 — canonicalize pre-image
  const preImage = s1PreImageBytes(draft);
  // Step 3 — receipt_hash
  const receiptHashHex = createHash('sha256').update(preImage).digest('hex');
  // Step 4 — sign
  const { privateKey } = loadSigningKey();
  const sigBytes = nodeSign(null, preImage, privateKey);
  const signatureWire =
    SIGNATURE_ALGORITHM_PREFIX + Buffer.from(sigBytes).toString('base64');
  // Step 5 — finalize
  const populatedReceipt: GoldenReceiptShape = {
    ...draft,
    signature: signatureWire,
    receipt_hash: receiptHashHex,
  };
  const finalBytes = Buffer.from(canonicalize(populatedReceipt), 'utf8');
  return { finalBytes, receiptHashHex, signatureWire, populatedReceipt };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('F-1 — golden-receipt three-way byte-identity demo', () => {
  const rustCanonicalBytes = readFileSync(
    join(CORPUS_DIR, 'rust-golden.canonical')
  );
  const rustSignatureLine = readFileSync(
    join(CORPUS_DIR, 'rust-golden.sig'),
    'utf8'
  ).trim();
  const rustGoldenJson = JSON.parse(
    readFileSync(join(CORPUS_DIR, 'rust-golden.json'), 'utf8')
  ) as Record<string, unknown>;

  describe('cross-track invariants (sentinel hashes / key derivation)', () => {
    it('sentinel hash derivations match the Rust authoritative values', () => {
      expect(SENTINEL_HASHES.policy_decision_hash).toBe(
        EXPECTED_SENTINELS.policy_decision_hash
      );
      expect(SENTINEL_HASHES.classified_intent_hash).toBe(
        EXPECTED_SENTINELS.classified_intent_hash
      );
      expect(SENTINEL_HASHES.execution_result_hash).toBe(
        EXPECTED_SENTINELS.execution_result_hash
      );
      expect(SENTINEL_HASHES.artifact_digest).toBe(
        EXPECTED_SENTINELS.artifact_digest
      );
      expect(SENTINEL_HASHES.attestation_digest).toBe(
        EXPECTED_SENTINELS.attestation_digest
      );
    });

    it('Ed25519 test-key derivation matches the Rust authoritative bytes', () => {
      const seed = deriveTestSeed();
      expect(seed.toString('hex')).toBe(EXPECTED_SEED_HEX);
      const { pubRaw } = loadSigningKey();
      expect(pubRaw.toString('hex')).toBe(EXPECTED_PUBLIC_KEY_HEX);
    });
  });

  describe('TS canonical bytes byte-identical to Rust', () => {
    const generated = generateGoldenReceiptBytes();

    it('S1 pre-image: receipt_hash matches Rust authoritative value', () => {
      expect(generated.receiptHashHex).toBe(
        '199304f0ba3c8260f40fa6d7358ec6ff7b5c1d3c1c97a49e2f729f022eca9651'
      );
      expect(generated.receiptHashHex).toBe(rustGoldenJson.receipt_hash);
    });

    it('S1 pre-image: signature matches Rust authoritative value', () => {
      expect(generated.signatureWire).toBe(rustSignatureLine);
      expect(generated.signatureWire).toBe(rustGoldenJson.signature);
      expect(generated.signatureWire).toMatch(
        /^ed25519:[A-Za-z0-9+/]{86}==$/
      );
    });

    it('final canonical bytes byte-identical to rust-golden.canonical', () => {
      // The acceptance criterion of the goal.
      expect(generated.finalBytes.length).toBe(rustCanonicalBytes.length);
      expect(generated.finalBytes.equals(rustCanonicalBytes)).toBe(true);
    });

    it('byte-by-byte equality at byte indexes (diagnostic if it ever fails)', () => {
      // Provides a precise byte index in diagnostics if a future regression
      // breaks parity. Kept separate from the equals() assertion above so
      // the failure surfaces the location, not just "they differ".
      const a = generated.finalBytes;
      const b = rustCanonicalBytes;
      for (let i = 0; i < Math.min(a.length, b.length); i++) {
        if (a[i] !== b[i]) {
          throw new Error(
            `byte mismatch at index ${i}: TS=0x${a[i]?.toString(16)} (${String.fromCharCode(a[i]!)})  Rust=0x${b[i]?.toString(16)} (${String.fromCharCode(b[i]!)})`
          );
        }
      }
      expect(a.length).toBe(b.length);
    });

    it('the Ed25519 signature verifies against the TS-computed pre-image and the test public key', () => {
      const { publicKey } = loadSigningKey();
      const sigPayload = generated.signatureWire.slice(
        SIGNATURE_ALGORITHM_PREFIX.length
      );
      const sigBytes = Buffer.from(sigPayload, 'base64');
      // Re-derive the pre-image: zero out signature and receipt_hash, canonicalize.
      const preImage = s1PreImageBytes({
        ...generated.populatedReceipt,
        signature: SIGNATURE_SENTINEL_VALUE,
        receipt_hash: RECEIPT_HASH_ZERO_PLACEHOLDER,
      });
      const ok = nodeVerify(null, preImage, publicKey, sigBytes);
      expect(ok).toBe(true);
    });
  });

  describe('three-way roll-up', () => {
    it('TS ↔ Rust byte-identity holds (Python pending)', () => {
      // PYTHON STATUS: at file time, no python-golden.canonical was found
      // in any drive-mounted Python repo. The three-way gate is two-way
      // green (TS ↔ Rust) pending Python's publication.
      //
      // When Python publishes `python-golden.canonical`, drop the artifact
      // alongside `rust-golden.canonical` in this fixture directory and
      // extend this test with the third `cmp` against
      // `generated.finalBytes`.
      const { finalBytes } = generateGoldenReceiptBytes();
      expect(finalBytes.equals(rustCanonicalBytes)).toBe(true);
    });
  });
});
