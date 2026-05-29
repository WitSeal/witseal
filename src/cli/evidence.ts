/**
 * `witseal evidence export` — export an evidence package.
 *
 * Receipt-version dispatch (C2): defaults to v0.1 receipts. Pass
 * `receiptVersion: 'witseal.receipt.v0.2'` plus a signing key and the
 * build-provenance inputs to emit signed v0.2 receipts in the package.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createPrivateKey } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { join } from 'node:path';
import { exportEvidencePackage } from '../evidence/package.js';
import type { EvidenceExportV02Options } from '../evidence/package.js';
import { EventLog } from '../witness/event-log.js';
import { CLASSIFIER_VERSION } from '../risk/classifier.js';
import { PolicyPackSchema, type PolicyPack } from '../../schemas/policy.schema.js';

export interface EvidenceExportOptions {
  outPath?: string;
  startSequence?: number;
  endSequence?: number;
  dataDir: string;
  segmentId: string;
  /** Receipt schema version. Defaults to v0.1 (backward-compatible). */
  receiptVersion?: 'witseal.receipt.v0.1' | 'witseal.receipt.v0.2';
  /** Path to an Ed25519 private key (PEM/DER) or 64-char raw-seed hex.
   *  Required when `receiptVersion` is v0.2. */
  signingKeyPath?: string;
  /** Build-provenance overrides for v0.2 receipts. */
  gitCommit?: string;
  artifactDigest?: string;
  attestationDigest?: string;
  artifactType?: string;
  buildId?: string;
}

export async function runEvidenceExport(opts: EvidenceExportOptions): Promise<number> {
  const eventLog = new EventLog({ root: opts.dataDir, segmentId: opts.segmentId });
  const packs = loadActivePacks(opts.dataDir);

  let pkg;
  try {
    if (opts.receiptVersion === 'witseal.receipt.v0.2') {
      const v02 = buildV02Options(opts);
      pkg = await exportEvidencePackage(eventLog, packs, CLASSIFIER_VERSION, {
        ...(opts.startSequence !== undefined ? { startSequence: opts.startSequence } : {}),
        ...(opts.endSequence !== undefined ? { endSequence: opts.endSequence } : {}),
        ...v02,
      });
    } else {
      pkg = await exportEvidencePackage(eventLog, packs, CLASSIFIER_VERSION, {
        ...(opts.startSequence !== undefined ? { startSequence: opts.startSequence } : {}),
        ...(opts.endSequence !== undefined ? { endSequence: opts.endSequence } : {}),
      });
    }
  } catch (err: unknown) {
    process.stderr.write(`witseal: evidence export failed: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  const json = JSON.stringify(pkg, null, 2);
  if (opts.outPath) {
    writeFileSync(opts.outPath, json + '\n', { encoding: 'utf8' });
    process.stderr.write(
      `witseal: exported ${pkg.events.length} events to ${opts.outPath}\n` +
        `         receipts: ${opts.receiptVersion ?? 'witseal.receipt.v0.1'}\n` +
        `         range:  ${pkg.range.start_sequence}..${pkg.range.end_sequence}\n` +
        `         head:   ${pkg.chain_head_after_range}\n`
    );
  } else {
    process.stdout.write(json + '\n');
  }
  return 0;
}

/**
 * Assemble the v0.2 export options from CLI inputs, loading the signing key
 * and applying provenance defaults. Throws (caught by the caller) if the
 * signing key is missing.
 */
function buildV02Options(opts: EvidenceExportOptions): EvidenceExportV02Options {
  if (!opts.signingKeyPath) {
    throw new Error(
      'v0.2 receipt export requires a signing key (--signing-key <path|hex>)'
    );
  }
  return {
    receiptVersion: 'witseal.receipt.v0.2',
    signingKey: loadSigningKey(opts.signingKeyPath),
    // Build provenance: real values come from the build context (M9). Until
    // then, fall back to zero/placeholder provenance so the export path is
    // exercisable end-to-end. These remain schema-valid v0.2 wire values.
    gitCommit: opts.gitCommit ?? '0'.repeat(40),
    artifactDigest: opts.artifactDigest ?? 'sha256:' + '0'.repeat(64),
    attestationDigest: opts.attestationDigest ?? 'sha256:' + '0'.repeat(64),
    artifactType: opts.artifactType ?? 'generic-binary',
    buildId: opts.buildId ?? `local-export-${Date.now()}`,
  };
}

/**
 * Load an Ed25519 signing key from `source`, which is either:
 *   - a path to a PEM/DER private-key file, or
 *   - a 64-char hex string of the raw 32-byte Ed25519 seed.
 */
function loadSigningKey(source: string): KeyObject | Uint8Array {
  const hex = source.trim();
  if (/^[0-9a-fA-F]{64}$/.test(hex)) {
    return Uint8Array.from(Buffer.from(hex, 'hex'));
  }
  if (!existsSync(source)) {
    throw new Error(`signing key not found: ${source}`);
  }
  const raw = readFileSync(source);
  const text = raw.toString('utf8');
  if (text.includes('-----BEGIN')) {
    return createPrivateKey(text);
  }
  // 64-char raw-seed hex stored in a file.
  const fileHex = text.trim();
  if (/^[0-9a-fA-F]{64}$/.test(fileHex)) {
    return Uint8Array.from(Buffer.from(fileHex, 'hex'));
  }
  // Fall back to DER.
  return createPrivateKey({ key: raw, format: 'der', type: 'pkcs8' });
}

function loadActivePacks(dataDir: string): PolicyPack[] {
  const dir = join(dataDir, 'policy-packs');
  if (!existsSync(dir)) return [];
  const out: PolicyPack[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const pack = PolicyPackSchema.parse(JSON.parse(readFileSync(join(dir, file), 'utf8')));
      out.push(pack);
    } catch {
      // ignore invalid packs at export time
    }
  }
  return out;
}
