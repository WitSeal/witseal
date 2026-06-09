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
import {
  checkProvenance,
  type ReceiptProvenanceFields,
} from '../verify/provenance.js';

export interface VerifyOptions {
  dataDir: string;
  segmentId: string;
  /** Path to a receipt or evidence-package JSON file. When set, verifies
   *  the artifact instead of the live chain. */
  artifactPath?: string;
  /** Path to an Ed25519 public key (PEM/DER) or 64-char raw-hex; required
   *  for v0.2 receipt signature verification. */
  publicKeyPath?: string;
  /** Opt-in: additionally re-check that the receipt's recorded build-provenance
   *  digests are bound to a DSSE in-toto attestation. ADDITIVE — when this is
   *  not set, `verify` behaves exactly as before. */
  checkProvenance?: boolean;
  /** Path to the DSSE in-toto attestation JSON; required with
   *  `checkProvenance`. The file is read VERBATIM — its exact bytes are what
   *  the receipt's `attestation_digest` is computed over. */
  attestationPath?: string;
  /** Path to / 64-char hex of the builder's Ed25519 public key (PEM/DER path
   *  or raw hex); used with `checkProvenance` to authenticate the DSSE
   *  envelope. Defaults to `--public-key` when omitted. */
  builderKeyPath?: string;
}

export async function runVerify(opts: VerifyOptions): Promise<number> {
  const prov: ProvenanceOptions = {
    ...(opts.checkProvenance !== undefined ? { checkProvenance: opts.checkProvenance } : {}),
    ...(opts.attestationPath !== undefined ? { attestationPath: opts.attestationPath } : {}),
    ...(opts.builderKeyPath !== undefined ? { builderKeyPath: opts.builderKeyPath } : {}),
  };
  if (opts.artifactPath !== undefined) {
    return runVerifyArtifact(opts.artifactPath, opts.publicKeyPath, prov);
  }
  // The live-chain mode has no receipt to bind provenance against.
  if (opts.checkProvenance === true) {
    process.stderr.write(
      `witseal: INVALID ✗\n         reason: --check-provenance requires a receipt file argument\n`
    );
    return 2;
  }
  return runVerifyChain(opts);
}

/** Opt-in provenance-recheck inputs (W5). */
interface ProvenanceOptions {
  checkProvenance?: boolean;
  attestationPath?: string;
  builderKeyPath?: string;
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
function runVerifyArtifact(
  artifactPath: string,
  publicKeyPath?: string,
  prov: ProvenanceOptions = {}
): number {
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

  if (!result.valid) {
    process.stderr.write(
      `witseal: INVALID ✗ (${result.kind})\n` +
        `         file:   ${artifactPath}\n` +
        `         reason: ${result.reason ?? 'unknown'}\n`
    );
    return 1;
  }

  process.stdout.write(
    `witseal: VALID ✓ (${result.kind})\n` +
      `         file:    ${artifactPath}\n` +
      (result.receiptResults
        ? `         receipts: ${result.receiptResults.length} verified\n`
        : '')
  );

  // ── Additive provenance re-check (opt-in via --check-provenance) ──────────
  // The existing signature + chain verification above is unchanged and has
  // already passed. This is a strictly-additional gate: on failure the overall
  // verdict becomes INVALID (non-zero exit); on success an extra line is
  // printed and the exit code stays 0.
  if (prov.checkProvenance === true) {
    const provExit = runProvenanceCheck(parsed, publicKey, publicKeyPath, prov);
    if (provExit !== 0) return provExit;
  }

  return 0;
}

/**
 * Run the opt-in provenance re-check against the receipt's recorded
 * build-provenance digests. Returns 0 on success (after printing the extra
 * `provenance: VALID …` line) or a non-zero exit with a clear reason on
 * failure. Only standalone v0.2 receipts carry the provenance fields; this is
 * additive and never runs unless `--check-provenance` was passed.
 */
function runProvenanceCheck(
  parsed: unknown,
  publicKey: KeyObject | undefined,
  publicKeyPath: string | undefined,
  prov: ProvenanceOptions
): number {
  if (prov.attestationPath === undefined) {
    process.stderr.write(
      `witseal: INVALID ✗ (provenance)\n         reason: --check-provenance requires --attestation <attestation.json>\n`
    );
    return 2;
  }

  // The receipt must be a standalone v0.2 receipt carrying the provenance
  // fields. (Evidence packages bundle many receipts and have no single
  // artifact_digest; provenance re-check targets a single receipt.)
  const receiptFields = readReceiptProvenanceFields(parsed);
  if (receiptFields === undefined) {
    process.stderr.write(
      `witseal: INVALID ✗ (provenance)\n         reason: --check-provenance expects a standalone v0.2 receipt with artifact_digest/attestation_digest fields\n`
    );
    return 1;
  }

  if (!existsSync(prov.attestationPath)) {
    process.stderr.write(
      `witseal: INVALID ✗ (provenance)\n         reason: attestation file not found: ${prov.attestationPath}\n`
    );
    return 1;
  }
  // Read the attestation VERBATIM — its exact bytes are what attestation_digest
  // is computed over.
  const attestationBytes = readFileSync(prov.attestationPath);

  // Builder key: --builder-key overrides; otherwise reuse --public-key.
  let builderKey: KeyObject;
  try {
    if (prov.builderKeyPath !== undefined) {
      builderKey = loadPublicKey(prov.builderKeyPath);
    } else if (publicKey !== undefined) {
      builderKey = publicKey;
    } else {
      process.stderr.write(
        `witseal: INVALID ✗ (provenance)\n         reason: --check-provenance requires a builder key (--builder-key <path|hex> or --public-key)\n`
      );
      return 2;
    }
  } catch (err: unknown) {
    process.stderr.write(
      `witseal: INVALID ✗ (provenance)\n         reason: could not load builder key: ${err instanceof Error ? err.message : String(err)}\n`
    );
    return 1;
  }
  // Silence unused-parameter lint when only --public-key is used; the path is
  // already resolved into `publicKey` by the caller.
  void publicKeyPath;

  const provResult = checkProvenance(
    new Uint8Array(attestationBytes),
    receiptFields,
    builderKey
  );

  if (!provResult.valid) {
    process.stderr.write(
      `witseal: INVALID ✗ (provenance)\n         reason: ${provResult.reason ?? 'unknown'}\n`
    );
    return 1;
  }

  process.stdout.write(
    `provenance: VALID (artifact ↔ attestation bound)\n` +
      `         artifact_digest: ${provResult.artifactDigest}\n` +
      `         predicateType:   ${provResult.predicateType}\n`
  );
  return 0;
}

/**
 * Extract the provenance fields off a parsed v0.2 receipt. Returns undefined if
 * the object is not a v0.2 receipt or lacks string `artifact_digest` /
 * `attestation_digest` fields.
 */
function readReceiptProvenanceFields(
  value: unknown
): ReceiptProvenanceFields | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const v = value as Record<string, unknown>;
  if (v['schema_version'] !== 'witseal.receipt.v0.2') return undefined;
  const artifact_digest = v['artifact_digest'];
  const attestation_digest = v['attestation_digest'];
  if (typeof artifact_digest !== 'string' || typeof attestation_digest !== 'string') {
    return undefined;
  }
  return { artifact_digest, attestation_digest };
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
