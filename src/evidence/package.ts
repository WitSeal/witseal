/**
 * Evidence package export.
 *
 * Bundles a contiguous range of witness events, their receipts, and the
 * policy packs in effect into an exportable, independently-verifiable
 * artifact.
 *
 * Receipt-version dispatch (C2): the export path can emit either v0.1
 * receipts (the default — `generateReceipt`, unsigned hash-addressable) or
 * v0.2 receipts (`generateReceiptByVersion` → `signReceiptV02`, the S1
 * clear-to-defaults pre-image + Ed25519 signature). The default is v0.1 so
 * existing callers and the `witseal.evidence-package.v0.1` wire contract are
 * unchanged. v0.2 is opt-in via `receiptVersion: 'witseal.receipt.v0.2'`,
 * which additionally requires a signing key and the build-provenance inputs
 * the witness event does not carry.
 */

import type { KeyObject } from 'node:crypto';
import { generateReceipt, generateReceiptByVersion } from '../receipts/generate.js';
import type { ReceiptV02ExtraInputs } from '../receipts/generate.js';
import type { EventLog } from '../witness/event-log.js';
import type { EvidencePackage } from '../../schemas/evidence-package.schema.js';
import type { ExecutionReceipt } from '../../schemas/receipt.schema.js';
import type { ExecutionReceiptV02 } from '../../schemas/receipt-v0.2.schema.js';
import type { PolicyPack } from '../../schemas/policy.schema.js';
import type { WitnessEvent } from '../../schemas/witness-event.schema.js';
import { generateId } from '../cli/id.js';
import { WITSEAL_RUNTIME_VERSION } from '../witness/emit.js';

export interface ExportRange {
  startSequence?: number;
  endSequence?: number;
}

/**
 * Receipt schema version for the exported package. Defaults to
 * `'witseal.receipt.v0.1'` to preserve the existing wire contract and
 * backward compatibility.
 */
export type ExportReceiptVersion =
  | 'witseal.receipt.v0.1'
  | 'witseal.receipt.v0.2';

/**
 * Build provenance + signing inputs required when exporting v0.2 receipts.
 * These mirror `ReceiptV02ExtraInputs` minus the per-receipt `prev_hash`
 * (the export path derives receipt-level chaining itself across the range)
 * and minus `finalized_at` / `executionLost` (derived per event), so the
 * caller supplies one provenance block for the whole export.
 */
export interface EvidenceExportV02Options {
  receiptVersion: 'witseal.receipt.v0.2';
  /** Ed25519 private key (Node KeyObject, PEM string, or raw 32-byte seed). */
  signingKey: KeyObject | string | Uint8Array;
  /** Bare 40-char lowercase SHA-1 hex of the build commit. */
  gitCommit: string;
  /** `sha256:` + 64-hex digest of the build artifact. */
  artifactDigest: string;
  /** `sha256:` + 64-hex digest of the attestation. */
  attestationDigest: string;
  /** Closed kebab-case artifact taxonomy literal, e.g. `generic-binary`. */
  artifactType: string;
  /** Free-form build-context identifier. */
  buildId: string;
  /** Path-D serialize-skip optionals — omitted from the receipt when absent. */
  sigstoreSignature?: string;
  classifierVersion?: string;
  shadowMode?: boolean;
}

export interface ExportV01Options extends ExportRange {
  receiptVersion?: 'witseal.receipt.v0.1';
}

export type ExportV02Options = ExportRange & EvidenceExportV02Options;

export type ExportOptions = ExportV01Options | ExportV02Options;

/**
 * Evidence package whose receipts are v0.2 (signed). Structurally identical
 * to `EvidencePackage` apart from the `receipts` element type. The wire
 * `schema_version` discriminant stays `witseal.evidence-package.v0.1` — only
 * the receipt element schema is versioned independently (receipts already
 * carry their own `schema_version`).
 */
export type EvidencePackageV02 = Omit<EvidencePackage, 'receipts'> & {
  receipts: ExecutionReceiptV02[];
};

// Overloads: default / explicit-v0.1 returns the v0.1 package; explicit-v0.2
// returns the v0.2-receipt package.
export function exportEvidencePackage(
  eventLog: EventLog,
  policyPacks: PolicyPack[],
  classifierVersion: string,
  options?: ExportV01Options
): Promise<EvidencePackage>;
export function exportEvidencePackage(
  eventLog: EventLog,
  policyPacks: PolicyPack[],
  classifierVersion: string,
  options: ExportV02Options
): Promise<EvidencePackageV02>;
export async function exportEvidencePackage(
  eventLog: EventLog,
  policyPacks: PolicyPack[],
  classifierVersion: string,
  options: ExportOptions = {}
): Promise<EvidencePackage | EvidencePackageV02> {
  const allEvents = await eventLog.readAllEvents();
  if (allEvents.length === 0) {
    throw new Error('Cannot export evidence: chain is empty');
  }

  const startSeq = options.startSequence ?? allEvents[0]!.sequence;
  const endSeq = options.endSequence ?? allEvents[allEvents.length - 1]!.sequence;

  const inRange = allEvents.filter(
    (ev) => ev.sequence >= startSeq && ev.sequence <= endSeq
  );

  if (inRange.length === 0) {
    throw new Error(`No events found in range [${startSeq}, ${endSeq}]`);
  }

  const headBefore = findHashBefore(allEvents, startSeq);
  const headAfter = inRange[inRange.length - 1]!.event_hash;

  const base = {
    package_id: generateId('pkg', 22),
    exported_at: toIsoZ(new Date()),
    chain_segment_id: inRange[0]!.chain_segment_id,
    range: {
      start_sequence: startSeq,
      end_sequence: endSeq,
    },
    chain_head_before_range: headBefore,
    chain_head_after_range: headAfter,
    events: inRange,
    policy_packs: policyPacks,
    classifier_version: classifierVersion,
    witseal_runtime_version: WITSEAL_RUNTIME_VERSION,
  };

  if (options.receiptVersion === 'witseal.receipt.v0.2') {
    const receipts = generateV02Receipts(inRange, options);
    return {
      schema_version: 'witseal.evidence-package.v0.1',
      ...base,
      receipts,
    };
  }

  const receipts: ExecutionReceipt[] = inRange.map((ev) => generateReceipt(ev));
  return {
    schema_version: 'witseal.evidence-package.v0.1',
    ...base,
    receipts,
  };
}

/**
 * Generate v0.2 receipts for the in-range events, signing each and chaining
 * them via `prev_hash`. The first receipt in the exported range carries
 * `prev_hash = null` (Option B genesis-of-range); each subsequent receipt
 * carries the predecessor receipt's `receipt_hash`. Build provenance and the
 * signing key come from `opts`.
 */
function generateV02Receipts(
  events: WitnessEvent[],
  opts: EvidenceExportV02Options
): ExecutionReceiptV02[] {
  const receipts: ExecutionReceiptV02[] = [];
  let prevHash: string | null = null;
  for (const ev of events) {
    const extra: ReceiptV02ExtraInputs = {
      prev_hash: prevHash,
      git_commit: opts.gitCommit,
      artifact_digest: opts.artifactDigest,
      attestation_digest: opts.attestationDigest,
      artifact_type: opts.artifactType,
      build_id: opts.buildId,
      ...(opts.sigstoreSignature !== undefined
        ? { sigstore_signature: opts.sigstoreSignature }
        : {}),
      ...(opts.classifierVersion !== undefined
        ? { classifier_version: opts.classifierVersion }
        : {}),
      ...(opts.shadowMode !== undefined ? { shadow_mode: opts.shadowMode } : {}),
    };
    const receipt = generateReceiptByVersion(
      ev,
      'witseal.receipt.v0.2',
      extra,
      opts.signingKey
    );
    receipts.push(receipt);
    prevHash = receipt.receipt_hash;
  }
  return receipts;
}

function findHashBefore(allEvents: WitnessEvent[], startSeq: number): string | null {
  if (startSeq === 0) return null;
  const prev = allEvents.find((ev) => ev.sequence === startSeq - 1);
  return prev ? prev.event_hash : null;
}

function toIsoZ(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
