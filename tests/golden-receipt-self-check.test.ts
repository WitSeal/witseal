/**
 * TS within-track self-check: INDEPENDENT GENERATION of the golden receipt.
 *
 * ─── What this proves ────────────────────────────────────────────────────────
 *
 * PR #25 (three-way demo) proved SERIALIZATION parity: TS, Python, and Rust
 * each canonicalize an already-constructed receipt to byte-identical output.
 *
 * This file closes the INDEPENDENT GENERATION gap (flagged by the Python track):
 * it proves the TS line can re-derive the receipt content from seed strings
 * alone — the sentinel hashes, the Ed25519 keypair, the signature — WITHOUT
 * loading rust-golden.json as a derivation input. The independently generated
 * canonical bytes and signature are then compared to the reference; they MUST
 * be byte-identical.
 *
 * ─── Provenance of every input value ────────────────────────────────────────
 *
 *   DERIVED (SHA-256 of seed strings per inputs.json `_sentinel_seeds`):
 *     policy_decision_hash, classified_intent_hash, execution_result_hash,
 *     artifact_digest, attestation_digest
 *
 *   DERIVED (SHA-256 of seed string per test-only-do-not-use-in-prod.key.json):
 *     Ed25519 private key + public key (via PKCS#8 wrap; node:crypto built-in)
 *
 *   LITERAL (from inputs.json `receipt_inputs` — hardcoded here, NOT from
 *   rust-golden.json):
 *     schema_version, receipt_id, witness_event_id, chain_segment_id,
 *     finalized_at, outcome, artifact_type, build_id, git_commit, prev_hash
 *
 *   COMPUTED via S1 clear-defaults procedure (inputs.json `_construction_procedure`):
 *     receipt_hash = SHA-256(pre-image canonical bytes)
 *     signature    = Ed25519_sign(private_key, pre-image canonical bytes)
 *                    wire-form: "ed25519:" + base64-standard-padded
 *
 *   LOADED (for COMPARISON ONLY — never as a derivation input):
 *     rust-golden.canonical — 1050-byte reference blob (bytes comparison)
 *     rust-golden.sig       — detached signature reference (signature comparison)
 *
 * ─── Source documents ────────────────────────────────────────────────────────
 *
 *   tests/fixtures/golden-receipt/inputs.json
 *   tests/fixtures/golden-receipt/test-only-do-not-use-in-prod.key.json
 *   tests/fixtures/golden-receipt/README.md
 */

import { describe, expect, it } from 'vitest';
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as nodeSign,
  verify as nodeVerify,
} from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { canonicalize } from '../src/integrity/hash-chain.js';

const CORPUS = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'golden-receipt');

// ─── Reference blobs (loaded for comparison ONLY) ────────────────────────────

const REF_CANONICAL = readFileSync(join(CORPUS, 'rust-golden.canonical'));
const REF_SIGNATURE = readFileSync(join(CORPUS, 'rust-golden.sig'), 'utf8').trim();

// ─── Key derivation (inputs.json / test-only-do-not-use-in-prod.key.json) ───
//
// seed_string → SHA-256 → 32-byte seed → Ed25519 SigningKey (PKCS#8 wrap).
// node:crypto's Ed25519 implementation accepts a PKCS#8 DER encoding whose
// last 32 bytes are the raw private key seed (ed25519_dalek-compatible).
//
// PKCS#8 Ed25519 prefix: 302e020100300506032b657004220420 (16 bytes).

const KEY_SEED_STRING = 'witseal-v0.2-golden-receipt-test-key-0001';
/** Expected by the key.json — tested explicitly below. */
const KEY_SEED_EXPECTED_HEX =
  '2950951f134b988957c5b5e0644e0a16f3139f45858fc920a7303971d404ae9f';
const PUBKEY_EXPECTED_HEX =
  'fd62f46e4e64333ef4c0693e9caf52a540cb21a3546547f016bcd0e990c91862';

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function deriveEd25519Key(): {
  seedHex: string;
  privateKey: ReturnType<typeof createPrivateKey>;
  publicKey: ReturnType<typeof createPublicKey>;
  pubRawHex: string;
} {
  const seedBytes = createHash('sha256').update(KEY_SEED_STRING, 'utf8').digest();
  const pkcs8 = Buffer.concat([PKCS8_ED25519_PREFIX, seedBytes]);
  const privateKey = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
  const publicKey = createPublicKey(privateKey);
  const spki = publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
  const pubRawBytes = spki.subarray(spki.length - 32);
  return {
    seedHex: seedBytes.toString('hex'),
    privateKey,
    publicKey,
    pubRawHex: pubRawBytes.toString('hex'),
  };
}

// ─── Sentinel hash derivation (inputs.json `_sentinel_seeds`) ────────────────
//
// Each sentinel hash = SHA-256(utf-8 seed string).
// Sha256Hash fields → bare 64-hex.
// Sha256DigestField fields → "sha256:" + 64-hex.

function sha256hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

const SENTINELS = {
  policy_decision_hash: sha256hex('witseal-v0.2-golden-policy-decision'),
  classified_intent_hash: sha256hex('witseal-v0.2-golden-classified-intent'),
  execution_result_hash: sha256hex('witseal-v0.2-golden-execution-result'),
  artifact_digest: 'sha256:' + sha256hex('witseal-v0.2-golden-artifact-digest'),
  attestation_digest: 'sha256:' + sha256hex('witseal-v0.2-golden-attestation-digest'),
} as const;

// Expected wire-form values from inputs.json (captured resolved values):
const SENTINEL_EXPECTED = {
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
} as const;

// ─── Receipt construction helpers ─────────────────────────────────────────────

/** S1 clear-defaults placeholder values. */
const SIG_SENTINEL = '';
const HASH_ZERO =
  '0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Literal scalar fields from inputs.json `receipt_inputs`.
 * Not sourced from rust-golden.json.
 */
interface GoldenReceiptShape {
  artifact_digest: string;
  artifact_type: string;
  attestation_digest: string;
  build_id: string;
  chain_segment_id: string;
  classified_intent_hash: string;
  execution_result_hash: string;
  finalized_at: string;
  git_commit: string;
  outcome: string;
  policy_decision_hash: string;
  prev_hash: string | null;
  receipt_hash: string;
  receipt_id: string;
  schema_version: 'witseal.receipt.v0.2';
  signature: string;
  witness_event_id: string;
}

function buildPreImageReceipt(): GoldenReceiptShape {
  return {
    schema_version: 'witseal.receipt.v0.2',
    // — sentinel-derived hash fields —
    artifact_digest: SENTINELS.artifact_digest,
    artifact_type: 'generic-binary',
    attestation_digest: SENTINELS.attestation_digest,
    build_id: 'witseal-golden-build-0001',
    chain_segment_id: 'corpus-golden-receipt-v0_2',
    classified_intent_hash: SENTINELS.classified_intent_hash,
    execution_result_hash: SENTINELS.execution_result_hash,
    finalized_at: '2026-05-26T10:00:00.000Z',
    git_commit: '0000000000000000000000000000000000000000',
    outcome: 'allowed_executed',
    policy_decision_hash: SENTINELS.policy_decision_hash,
    prev_hash: null,                  // emits explicit null (wire-format invariant)
    receipt_hash: HASH_ZERO,          // S1 zero-placeholder
    receipt_id: 'rcpt_golden00000000000000001',
    signature: SIG_SENTINEL,          // S1 empty-string sentinel
    witness_event_id: 'evt_golden0000000000000001',
  };
}

/**
 * Full S1 clear-defaults construction procedure (steps 1–5 of inputs.json).
 * Returns: final canonical bytes, receipt_hash hex, signature wire-form,
 * and the populated receipt struct.
 */
function s1Generate(): {
  preImageBytes: Buffer;
  receiptHashHex: string;
  signatureWire: string;
  finalBytes: Buffer;
  populated: GoldenReceiptShape;
} {
  // Step 1: construct with sentinels + clear-defaults.
  const draft = buildPreImageReceipt();

  // Step 2: canonicalize pre-image (RFC 8785 — sorted keys, no whitespace,
  // prev_hash=null emits explicit `null`, serialize-skip optionals absent from type).
  const preImageBytes = Buffer.from(canonicalize(draft), 'utf8');

  // Step 3: receipt_hash = SHA-256(pre-image bytes), bare 64-hex.
  const receiptHashHex = createHash('sha256').update(preImageBytes).digest('hex');

  // Step 4: signature = Ed25519_sign(private_key, pre-image bytes).
  // Message = step-2 bytes (signature="" AND receipt_hash=zero).
  // Wire-form: "ed25519:" + base64-standard-padded (88 chars after colon).
  const { privateKey } = deriveEd25519Key();
  const sigBytes = nodeSign(null, preImageBytes, privateKey);
  const signatureWire = 'ed25519:' + Buffer.from(sigBytes).toString('base64');

  // Step 5: populate and re-canonicalize for final wire form.
  const populated: GoldenReceiptShape = { ...draft, receipt_hash: receiptHashHex, signature: signatureWire };
  const finalBytes = Buffer.from(canonicalize(populated), 'utf8');

  return { preImageBytes, receiptHashHex, signatureWire, finalBytes, populated };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('TS within-track self-check: INDEPENDENT GENERATION of golden receipt', () => {
  describe('step 0 — derivation gate: sentinel hashes match inputs.json', () => {
    it('policy_decision_hash derived from seed matches captured value', () => {
      expect(SENTINELS.policy_decision_hash).toBe(SENTINEL_EXPECTED.policy_decision_hash);
    });

    it('classified_intent_hash derived from seed matches captured value', () => {
      expect(SENTINELS.classified_intent_hash).toBe(SENTINEL_EXPECTED.classified_intent_hash);
    });

    it('execution_result_hash derived from seed matches captured value', () => {
      expect(SENTINELS.execution_result_hash).toBe(SENTINEL_EXPECTED.execution_result_hash);
    });

    it('artifact_digest derived from seed carries sha256: prefix and matches captured value', () => {
      expect(SENTINELS.artifact_digest).toBe(SENTINEL_EXPECTED.artifact_digest);
    });

    it('attestation_digest derived from seed carries sha256: prefix and matches captured value', () => {
      expect(SENTINELS.attestation_digest).toBe(SENTINEL_EXPECTED.attestation_digest);
    });
  });

  describe('step 0 — derivation gate: Ed25519 key from seed string', () => {
    const { seedHex, pubRawHex } = deriveEd25519Key();

    it('SHA-256(KEY_SEED_STRING) matches key.json captured private_key_seed_bytes_hex', () => {
      expect(seedHex).toBe(KEY_SEED_EXPECTED_HEX);
    });

    it('derived public key matches key.json captured public_key_bytes_hex', () => {
      expect(pubRawHex).toBe(PUBKEY_EXPECTED_HEX);
    });
  });

  describe('S1 construction procedure (independent run)', () => {
    const gen = s1Generate();

    it('step 3: receipt_hash derived from pre-image matches inputs.json captured value', () => {
      // The captured value in inputs.json confirms the Rust track computed
      // the same pre-image bytes — this cross-check is the sentinel.
      expect(gen.receiptHashHex).toBe(
        '199304f0ba3c8260f40fa6d7358ec6ff7b5c1d3c1c97a49e2f729f022eca9651'
      );
    });

    it('step 4: independently-derived signature matches rust-golden.sig (byte-identical)', () => {
      // Core independent-generation assertion: the TS-derived signature must
      // be byte-identical to the detached signature produced by Rust. Ed25519
      // is deterministic for a fixed message + key, so any derivation drift
      // (in seed, pre-image construction, or canonicalization) surfaces here.
      expect(gen.signatureWire).toBe(REF_SIGNATURE);
    });

    it('step 4: signature wire-form matches ed25519: prefix regex', () => {
      expect(gen.signatureWire).toMatch(/^ed25519:[A-Za-z0-9+/]{86}==$/);
    });

    it('step 5: independently-generated final bytes are byte-identical to rust-golden.canonical', () => {
      // Primary acceptance criterion: the TS line independently re-derives
      // the same 1050-byte canonical wire form as the Rust authoritative track.
      expect(gen.finalBytes.length).toBe(1050);
      expect(gen.finalBytes.equals(REF_CANONICAL)).toBe(true);
    });

    it('step 5: SHA-256 of independently-generated bytes == 8fc29592...ef1b', () => {
      const digest = createHash('sha256').update(gen.finalBytes).digest('hex');
      expect(digest).toBe(
        '8fc29592fd3317e48caccc9b5c64d01cfa32d5e27846c50f233829e1bb17ef1b'
      );
    });

    it('step 6 (optional self-verify): Ed25519 signature verifies over pre-image with derived public key', () => {
      // Independent verification: re-derive the pre-image from the populated
      // receipt (zero out signature + receipt_hash) and verify.
      const { publicKey } = deriveEd25519Key();
      const preImage = Buffer.from(
        canonicalize({ ...gen.populated, signature: SIG_SENTINEL, receipt_hash: HASH_ZERO }),
        'utf8'
      );
      const sigBytes = Buffer.from(gen.signatureWire.slice('ed25519:'.length), 'base64');
      const ok = nodeVerify(null, preImage, publicKey, sigBytes);
      expect(ok).toBe(true);
    });
  });
});
