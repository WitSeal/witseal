/**
 * v0.2 receipt positive-fixture corpus — regenerator (source-of-truth script).
 *
 * Run from the repo root with:
 *
 *   npx tsx tests/fixtures/receipts/v0.2/regenerate.ts
 *
 * Produces the static JSON fixtures + the matching public-key file. The
 * outputs are deterministic: the Ed25519 keypair is derived from a fixed
 * 32-byte seed (`SEED_HEX`), and all fixture content is hand-rolled with
 * fixed timestamps, identifiers, and hash inputs. Re-running the script
 * MUST produce byte-identical output (the test in
 * `tests/receipt-v0.2-fixtures.test.ts` asserts this surface by parsing
 * each JSON and re-verifying the signature against the committed public
 * key).
 *
 * Surface coverage (per the M8 plan in
 * `ts-tech-lead-to-pm-m8-start-confirmation-2026-05-23.md` § 2):
 *
 *   01-genesis-allowed-executed     (a) prev_hash = null at genesis
 *                                   (d) Path-D optionals omitted
 *   02-chained-allowed-executed     (b) prev_hash = receipt_hash of #01
 *                                   (d) Path-D optionals omitted
 *   03-execution-lost               (c) receipt_id = null + R-5 outcome
 *                                       + execution_result_hash = null
 *   04-path-d-optionals-populated   (e) sigstore_signature + classifier_version
 *                                       + shadow_mode all carried through
 *
 * Cross-track use: any track (Rust, Python) that implements RFC-002
 * canonicalization, the R-3 empty-string-sentinel signing procedure, and
 * the v0.2 zod-equivalent schema can verify each fixture by:
 *
 *   1. Reading the JSON.
 *   2. Rebuilding the signing pre-image by setting `signature = ""` and
 *      JSC-canonicalizing the body (with `receipt_hash` present).
 *   3. ed25519_verify(public_key, base64decode(signature), pre_image).
 *   4. Re-deriving receipt_hash by stripping `receipt_hash` and signing
 *      again with `signature = ""`, asserting equality.
 *
 * Public key for verification: see `ed25519-publickey.hex` (raw 32-byte
 * Ed25519 public key, hex-encoded).
 */

import { createPrivateKey, createPublicKey } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { signReceiptV02 } from '../../../../src/receipts/sign-v0.2.js';
import type { ExecutionReceiptV02Draft } from '../../../../schemas/receipt-v0.2.schema.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Fixed 32-byte Ed25519 seed. Hand-picked counter pattern; not derived from
 *  any production-meaningful secret. Other tracks can reproduce the keypair
 *  by treating these bytes as the PKCS#8 Ed25519 seed (RFC 8032 §5.1.5). */
const SEED_HEX = '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20';

function loadKeyPair(): { privateKey: KeyObject; publicKeyHex: string } {
  const seed = Buffer.from(SEED_HEX, 'hex');
  if (seed.length !== 32) {
    throw new Error('SEED_HEX must decode to exactly 32 bytes');
  }
  // Wrap seed as PKCS#8 Ed25519 → KeyObject (matches the helper inside
  // src/receipts/sign-v0.2.ts § coercePrivateKey).
  const pkcs8Prefix = Buffer.from('302e020100300506032b657004220420', 'hex');
  const pkcs8 = Buffer.concat([pkcs8Prefix, seed]);
  const privateKey = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
  const publicKey = createPublicKey(privateKey);
  // Extract raw 32-byte public key from SPKI DER (last 32 bytes).
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  const publicKeyHex = spki.subarray(spki.length - 32).toString('hex');
  return { privateKey, publicKeyHex };
}

function repeatHex(byte: string, len: number): string {
  if (byte.length !== 1) throw new Error('repeatHex expects a single hex char');
  return byte.repeat(len);
}

const COMMON_GIT_COMMIT = repeatHex('a', 40);
const COMMON_ARTIFACT_DIGEST = 'sha256:' + repeatHex('b', 64);
const COMMON_ATTESTATION_DIGEST = 'sha256:' + repeatHex('c', 64);
const COMMON_ARTIFACT_TYPE = 'generic-binary';
const COMMON_BUILD_ID = 'witseal-fixture-build-0001';

function makeBaseDraft(): ExecutionReceiptV02Draft {
  return {
    schema_version: 'witseal.receipt.v0.2',
    receipt_id: 'rcpt_fixture0000000000001',
    witness_event_id: 'evt_fixture00000000000001',
    chain_segment_id: 'fixture-segment-1',
    finalized_at: '2026-05-22T12:00:00Z',
    policy_decision_hash: repeatHex('1', 64),
    classified_intent_hash: repeatHex('2', 64),
    execution_result_hash: repeatHex('3', 64),
    outcome: 'allowed_executed',
    prev_hash: null,
    signature: '',
    git_commit: COMMON_GIT_COMMIT,
    artifact_digest: COMMON_ARTIFACT_DIGEST,
    attestation_digest: COMMON_ATTESTATION_DIGEST,
    artifact_type: COMMON_ARTIFACT_TYPE,
    build_id: COMMON_BUILD_ID,
  };
}

function writeJson(filename: string, value: unknown): void {
  const path = join(HERE, filename);
  const serialized = JSON.stringify(value, null, 2) + '\n';
  writeFileSync(path, serialized, 'utf8');
  console.log(`wrote ${filename} (${serialized.length} bytes)`);
}

function main(): void {
  const { privateKey, publicKeyHex } = loadKeyPair();
  console.log(`Ed25519 public key (raw 32-byte hex): ${publicKeyHex}`);

  // 01 — Genesis, allowed_executed, Path-D optionals omitted.
  const draft01 = makeBaseDraft();
  const receipt01 = signReceiptV02(draft01, privateKey);
  writeJson('01-genesis-allowed-executed.json', receipt01);

  // 02 — Chained, allowed_executed, Path-D optionals omitted.
  //      prev_hash points at the receipt_hash of #01; receipt_id and
  //      witness_event_id advance one step within the same chain segment.
  const draft02: ExecutionReceiptV02Draft = {
    ...makeBaseDraft(),
    receipt_id: 'rcpt_fixture0000000000002',
    witness_event_id: 'evt_fixture00000000000002',
    finalized_at: '2026-05-22T12:00:01Z',
    policy_decision_hash: repeatHex('4', 64),
    classified_intent_hash: repeatHex('5', 64),
    execution_result_hash: repeatHex('6', 64),
    prev_hash: receipt01.receipt_hash,
  };
  const receipt02 = signReceiptV02(draft02, privateKey);
  writeJson('02-chained-allowed-executed.json', receipt02);

  // 03 — execution_lost (R-5): receipt_id = null, outcome = execution_lost,
  //      execution_result_hash = null. Path-D optionals omitted. Genesis.
  const draft03: ExecutionReceiptV02Draft = {
    ...makeBaseDraft(),
    receipt_id: null,
    witness_event_id: 'evt_fixture00000000000003',
    finalized_at: '2026-05-22T12:00:02Z',
    execution_result_hash: null,
    outcome: 'execution_lost',
    prev_hash: null,
  };
  const receipt03 = signReceiptV02(draft03, privateKey);
  writeJson('03-execution-lost.json', receipt03);

  // 04 — Path-D optionals populated: sigstore_signature + classifier_version
  //      + shadow_mode all present. Genesis, allowed_executed.
  const draft04: ExecutionReceiptV02Draft = {
    ...makeBaseDraft(),
    receipt_id: 'rcpt_fixture0000000000004',
    witness_event_id: 'evt_fixture00000000000004',
    finalized_at: '2026-05-22T12:00:03Z',
    sigstore_signature: 'sigstore-fixture-blob-v0.2',
    classifier_version: 'fixture-classifier-1.0',
    shadow_mode: true,
  };
  const receipt04 = signReceiptV02(draft04, privateKey);
  writeJson('04-path-d-optionals-populated.json', receipt04);

  // Public key file: raw 32-byte Ed25519 public key, hex-encoded, one line
  // with trailing newline. Cross-track tools that don't speak PEM can read
  // this directly.
  writeFileSync(join(HERE, 'ed25519-publickey.hex'), publicKeyHex + '\n', 'utf8');
  console.log(`wrote ed25519-publickey.hex (${publicKeyHex.length + 1} bytes)`);
}

main();
