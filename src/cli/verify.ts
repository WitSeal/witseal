/**
 * `witseal verify` — version-discriminating verification.
 *
 * Two modes:
 *
 *   1. No file argument (default, backward-compatible): walk the live event
 *      log for the active segment and verify every hash linkage. Reports the
 *      exact location of any tampering or corruption.
 *
 *   2. A file argument (`witseal verify <file>`): read the JSON artifact,
 *      determine what it is from its `schema_version` (a v0.1 receipt, a v0.2
 *      receipt, or an evidence package), and run the appropriate verification.
 *      v0.2 receipts (standalone or inside a package) require a public key
 *      (`--public-key <path|hex>`) for signature verification.
 *
 * Both modes emit a single VALID / INVALID verdict; on INVALID the precise
 * reason is printed.
 */

import { existsSync, readFileSync } from 'node:fs';
import { createPublicKey } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { EventLog } from '../witness/event-log.js';
import { verifyArtifact } from '../verify/verify.js';

export interface VerifyOptions {
  dataDir: string;
  segmentId: string;
  /** Path to a receipt or evidence-package JSON file. When set, verifies
   *  the artifact instead of the live chain. */
  artifactPath?: string;
  /** Path to an Ed25519 public key (PEM/DER) or 64-char raw-hex; required
   *  for v0.2 receipt signature verification. */
  publicKeyPath?: string;
}

export async function runVerify(opts: VerifyOptions): Promise<number> {
  if (opts.artifactPath !== undefined) {
    return runVerifyArtifact(opts.artifactPath, opts.publicKeyPath);
  }
  return runVerifyChain(opts);
}

/** Mode 1 — live-chain verification (the original behavior). */
async function runVerifyChain(opts: VerifyOptions): Promise<number> {
  const eventLog = new EventLog({ root: opts.dataDir, segmentId: opts.segmentId });
  const result = await eventLog.verifyAll();

  if (result.valid) {
    process.stdout.write(
      `witseal: VALID ✓ (chain)\n` +
        `         segment: ${opts.segmentId}\n` +
        `         events:  ${result.eventCount}\n`
    );
    return 0;
  }

  process.stderr.write(
    `witseal: INVALID ✗ (chain)\n` +
      `         segment:   ${opts.segmentId}\n` +
      `         events:    ${result.eventCount}\n` +
      `         broken at: index ${result.brokenAt}\n` +
      `         reason:    ${result.reason}\n`
  );
  return 1;
}

/** Mode 2 — artifact (receipt / evidence-package) verification. */
function runVerifyArtifact(artifactPath: string, publicKeyPath?: string): number {
  if (!existsSync(artifactPath)) {
    process.stderr.write(`witseal: INVALID ✗\n         reason: file not found: ${artifactPath}\n`);
    return 1;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(artifactPath, 'utf8'));
  } catch (err: unknown) {
    process.stderr.write(
      `witseal: INVALID ✗\n         reason: not valid JSON: ${err instanceof Error ? err.message : String(err)}\n`
    );
    return 1;
  }

  let publicKey: KeyObject | undefined;
  if (publicKeyPath !== undefined) {
    try {
      publicKey = loadPublicKey(publicKeyPath);
    } catch (err: unknown) {
      process.stderr.write(
        `witseal: INVALID ✗\n         reason: could not load public key: ${err instanceof Error ? err.message : String(err)}\n`
      );
      return 1;
    }
  }

  const result = verifyArtifact(parsed, publicKey);

  if (result.valid) {
    process.stdout.write(
      `witseal: VALID ✓ (${result.kind})\n` +
        `         file:    ${artifactPath}\n` +
        (result.receiptResults
          ? `         receipts: ${result.receiptResults.length} verified\n`
          : '')
    );
    return 0;
  }

  process.stderr.write(
    `witseal: INVALID ✗ (${result.kind})\n` +
      `         file:   ${artifactPath}\n` +
      `         reason: ${result.reason ?? 'unknown'}\n`
  );
  return 1;
}

/**
 * Load an Ed25519 public key from `source`, which is either:
 *   - a path to a PEM/DER public-key file, or
 *   - a 64-char hex string of the raw 32-byte Ed25519 public key.
 */
function loadPublicKey(source: string): KeyObject {
  const hex = source.trim();
  if (/^[0-9a-fA-F]{64}$/.test(hex)) {
    return rawHexToPublicKey(hex);
  }
  if (!existsSync(source)) {
    throw new Error(`public key not found: ${source}`);
  }
  const raw = readFileSync(source);
  const text = raw.toString('utf8');
  if (text.includes('-----BEGIN')) {
    return createPublicKey(text);
  }
  const fileHex = text.trim();
  if (/^[0-9a-fA-F]{64}$/.test(fileHex)) {
    return rawHexToPublicKey(fileHex);
  }
  return createPublicKey({ key: raw, format: 'der', type: 'spki' });
}

/** Wrap a raw 32-byte Ed25519 public key (hex) as SPKI DER. */
function rawHexToPublicKey(hex: string): KeyObject {
  const raw = Buffer.from(hex, 'hex');
  const spki = Buffer.concat([
    Buffer.from('302a300506032b6570032100', 'hex'),
    raw,
  ]);
  return createPublicKey({ key: spki, format: 'der', type: 'spki' });
}
