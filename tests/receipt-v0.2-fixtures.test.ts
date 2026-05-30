/**
 * v0.2 receipt positive-fixture corpus — verification tests.
 *
 * Reads the static JSON fixtures committed under
 * `tests/fixtures/receipts/v0.2/`, parses each against
 * `ExecutionReceiptV02Schema`, and verifies the signature + self-hash
 * via `verifyReceiptV02`, using the committed raw Ed25519 public key.
 *
 * The fixtures are the source-of-truth artifact; the regenerator
 * (`tests/fixtures/receipts/v0.2/regenerate.ts`) is the script that
 * produced them deterministically and is not invoked by this test. See
 * `tests/fixtures/receipts/v0.2/README.md` for the verification procedure
 * and cross-track usage.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPublicKey } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ExecutionReceiptV02Schema,
  type ExecutionReceiptV02,
} from '../schemas/receipt-v0.2.schema.js';
import { verifyReceiptV02 } from '../src/receipts/sign-v0.2.js';

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'receipts',
  'v0.2'
);

function loadFixture(name: string): ExecutionReceiptV02 {
  const raw = readFileSync(join(FIXTURE_DIR, name), 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  return ExecutionReceiptV02Schema.parse(parsed);
}

function loadPublicKey(): import('node:crypto').KeyObject {
  const hex = readFileSync(
    join(FIXTURE_DIR, 'ed25519-publickey.hex'),
    'utf8'
  ).trim();
  const raw = Buffer.from(hex, 'hex');
  expect(raw.length).toBe(32);
  // Wrap raw 32-byte Ed25519 public key as SPKI DER (matches the helper in
  // src/receipts/sign-v0.2.ts § coercePublicKey).
  const spki = Buffer.concat([
    Buffer.from('302a300506032b6570032100', 'hex'),
    raw,
  ]);
  return createPublicKey({ key: spki, format: 'der', type: 'spki' });
}

describe('v0.2 positive fixture corpus', () => {
  const publicKey = loadPublicKey();

  describe('01-genesis-allowed-executed', () => {
    const receipt = loadFixture('01-genesis-allowed-executed.json');

    it('parses against ExecutionReceiptV02Schema', () => {
      expect(receipt.schema_version).toBe('witseal.receipt.v0.2');
    });

    it('carries prev_hash = null at chain-segment genesis (genesis-null)', () => {
      expect(receipt.prev_hash).toBeNull();
    });

    it('omits all serialize-skip optionals', () => {
      expect('sigstore_signature' in receipt).toBe(false);
      expect('classifier_version' in receipt).toBe(false);
      expect('shadow_mode' in receipt).toBe(false);
    });

    it('carries outcome = allowed_executed with a non-null receipt_id', () => {
      expect(receipt.outcome).toBe('allowed_executed');
      expect(receipt.receipt_id).not.toBeNull();
    });

    it('verifies under the committed public key (signature + self-hash)', () => {
      expect(verifyReceiptV02(receipt, publicKey)).toEqual({ valid: true });
    });
  });

  describe('02-chained-allowed-executed', () => {
    const genesis = loadFixture('01-genesis-allowed-executed.json');
    const receipt = loadFixture('02-chained-allowed-executed.json');

    it('parses against ExecutionReceiptV02Schema', () => {
      expect(receipt.schema_version).toBe('witseal.receipt.v0.2');
    });

    it('links to the genesis receipt via prev_hash = #01.receipt_hash', () => {
      expect(receipt.prev_hash).toBe(genesis.receipt_hash);
    });

    it('omits all serialize-skip optionals', () => {
      expect('sigstore_signature' in receipt).toBe(false);
      expect('classifier_version' in receipt).toBe(false);
      expect('shadow_mode' in receipt).toBe(false);
    });

    it('verifies under the committed public key (signature + self-hash)', () => {
      expect(verifyReceiptV02(receipt, publicKey)).toEqual({ valid: true });
    });
  });

  describe('03-execution-lost', () => {
    const receipt = loadFixture('03-execution-lost.json');

    it('parses against ExecutionReceiptV02Schema', () => {
      expect(receipt.schema_version).toBe('witseal.receipt.v0.2');
    });

    it('carries receipt_id = null (nullable-mandatory for execution_lost)', () => {
      expect(receipt.receipt_id).toBeNull();
    });

    it('carries outcome = execution_lost', () => {
      expect(receipt.outcome).toBe('execution_lost');
    });

    it('carries execution_result_hash = null', () => {
      expect(receipt.execution_result_hash).toBeNull();
    });

    it('verifies under the committed public key (signature + self-hash)', () => {
      expect(verifyReceiptV02(receipt, publicKey)).toEqual({ valid: true });
    });
  });

  describe('04-path-d-optionals-populated', () => {
    const receipt = loadFixture('04-path-d-optionals-populated.json');

    it('parses against ExecutionReceiptV02Schema', () => {
      expect(receipt.schema_version).toBe('witseal.receipt.v0.2');
    });

    it('carries all three serialize-skip optionals', () => {
      expect(receipt.sigstore_signature).toBe('sigstore-fixture-blob-v0.2');
      expect(receipt.classifier_version).toBe('fixture-classifier-1.0');
      expect(receipt.shadow_mode).toBe(true);
    });

    it('verifies under the committed public key (signature + self-hash)', () => {
      expect(verifyReceiptV02(receipt, publicKey)).toEqual({ valid: true });
    });
  });

  describe('cross-fixture invariants', () => {
    it('all four fixtures share the same chain_segment_id', () => {
      const fixtures = [
        loadFixture('01-genesis-allowed-executed.json'),
        loadFixture('02-chained-allowed-executed.json'),
        loadFixture('03-execution-lost.json'),
        loadFixture('04-path-d-optionals-populated.json'),
      ];
      const segments = new Set(fixtures.map((r) => r.chain_segment_id));
      expect(segments.size).toBe(1);
    });

    it('all four fixtures verify under the same public key', () => {
      const names = [
        '01-genesis-allowed-executed.json',
        '02-chained-allowed-executed.json',
        '03-execution-lost.json',
        '04-path-d-optionals-populated.json',
      ];
      for (const name of names) {
        const receipt = loadFixture(name);
        expect(
          verifyReceiptV02(receipt, publicKey),
          `fixture ${name} should verify`
        ).toEqual({ valid: true });
      }
    });

    it('all four fixtures carry distinct receipt_hash values', () => {
      const hashes = [
        loadFixture('01-genesis-allowed-executed.json').receipt_hash,
        loadFixture('02-chained-allowed-executed.json').receipt_hash,
        loadFixture('03-execution-lost.json').receipt_hash,
        loadFixture('04-path-d-optionals-populated.json').receipt_hash,
      ];
      expect(new Set(hashes).size).toBe(4);
    });
  });
});
