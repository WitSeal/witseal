/**
 * Unified, version-discriminating verification surface.
 *
 * One entry point that, given a parsed JSON object, determines what it is
 * (a v0.1 receipt, a v0.2 receipt, or an evidence package) and runs the
 * right verification, returning a single VALID / INVALID verdict with a
 * precise reason on failure.
 *
 * Verification depth by artifact:
 *
 *   - `witseal.receipt.v0.1`  — structural schema parse + receipt_hash
 *     self-consistency. A standalone v0.1 receipt is unsigned and carries
 *     no companion event, so the self-hash is the available integrity check.
 *   - `witseal.receipt.v0.2`  — structural schema parse + Ed25519 signature
 *     verification + receipt_hash self-consistency (`verifyReceiptV02`,
 *     S1 clear-to-defaults pre-image). Requires a public key.
 *   - `witseal.evidence-package.v0.1` — structural schema parse + hash-chain
 *     verification (`verifyChain`, walking previous_event_hash linkage,
 *     self-hashes, and sequence monotonicity) + per-receipt integrity. Each
 *     receipt is checked against its companion event; v0.2 receipts in the
 *     package additionally require a public key for signature verification.
 *
 * Pure functions — no file I/O. The CLI layer (`src/cli/verify.ts`) reads
 * the file and supplies the public key.
 */

import type { KeyObject } from 'node:crypto';
import { sha256OfCanonical, verifyChain } from '../integrity/hash-chain.js';
import { verifyReceipt } from '../receipts/generate.js';
import { verifyReceiptV02 } from '../receipts/sign-v0.2.js';
import {
  ExecutionReceiptSchema,
  type ExecutionReceipt,
} from '../../schemas/receipt.schema.js';
import {
  ExecutionReceiptV02Schema,
  type ExecutionReceiptV02,
} from '../../schemas/receipt-v0.2.schema.js';
import {
  EvidencePackageSchema,
  type EvidencePackage,
} from '../../schemas/evidence-package.schema.js';
import type { WitnessEvent } from '../../schemas/witness-event.schema.js';

/** What the verifier decided the artifact was. */
export type VerifiedArtifactKind =
  | 'receipt.v0.1'
  | 'receipt.v0.2'
  | 'evidence-package.v0.1'
  | 'unknown';

export interface VerifyResult {
  /** The single VALID / INVALID verdict. */
  valid: boolean;
  /** What the verifier classified the artifact as. */
  kind: VerifiedArtifactKind;
  /** Schema-version discriminant read off the artifact (if present). */
  schemaVersion?: string;
  /** Precise human-readable reason when `valid` is false. */
  reason?: string;
  /** Per-receipt sub-results when verifying an evidence package. */
  receiptResults?: Array<{ index: number; valid: boolean; reason?: string }>;
}

function readSchemaVersion(value: unknown): string | undefined {
  if (typeof value === 'object' && value !== null && 'schema_version' in value) {
    const sv = (value as { schema_version?: unknown }).schema_version;
    return typeof sv === 'string' ? sv : undefined;
  }
  return undefined;
}

/**
 * Top-level discriminator. Reads `schema_version` and routes to the right
 * verifier. Returns `{ valid: false, kind: 'unknown' }` for anything that is
 * not a recognized WitSeal receipt or evidence package.
 */
export function verifyArtifact(
  value: unknown,
  publicKey?: KeyObject | string | Uint8Array
): VerifyResult {
  const schemaVersion = readSchemaVersion(value);

  switch (schemaVersion) {
    case 'witseal.receipt.v0.1':
      return verifyReceiptV01Object(value);
    case 'witseal.receipt.v0.2':
      return verifyReceiptV02Object(value, publicKey);
    case 'witseal.evidence-package.v0.1':
      return verifyEvidencePackageObject(value, publicKey);
    default:
      return {
        valid: false,
        kind: 'unknown',
        ...(schemaVersion !== undefined ? { schemaVersion } : {}),
        reason:
          schemaVersion === undefined
            ? 'no schema_version field: not a recognized WitSeal artifact'
            : `unrecognized schema_version '${schemaVersion}' (expected a witseal.receipt.* or witseal.evidence-package.* artifact)`,
      };
  }
}

/**
 * Verify a standalone v0.1 receipt: schema parse + receipt_hash
 * self-consistency. (No companion event is available for a standalone
 * receipt, so the cross-reference checks in `verifyReceipt` that compare
 * against an event are not applicable here; the self-hash is the integrity
 * gate.)
 */
export function verifyReceiptV01Object(value: unknown): VerifyResult {
  const parsed = ExecutionReceiptSchema.safeParse(value);
  if (!parsed.success) {
    return {
      valid: false,
      kind: 'receipt.v0.1',
      schemaVersion: 'witseal.receipt.v0.1',
      reason: `schema validation failed: ${formatZodError(parsed.error)}`,
    };
  }
  const receipt: ExecutionReceipt = parsed.data;
  const { receipt_hash, ...draft } = receipt;
  const expected = sha256OfCanonical(draft);
  if (expected !== receipt_hash) {
    return {
      valid: false,
      kind: 'receipt.v0.1',
      schemaVersion: 'witseal.receipt.v0.1',
      reason: 'receipt_hash invalid (self-hash check failed)',
    };
  }
  return {
    valid: true,
    kind: 'receipt.v0.1',
    schemaVersion: 'witseal.receipt.v0.1',
  };
}

/**
 * Verify a standalone v0.2 receipt: schema parse + Ed25519 signature +
 * receipt_hash self-consistency. Requires a public key.
 */
export function verifyReceiptV02Object(
  value: unknown,
  publicKey?: KeyObject | string | Uint8Array
): VerifyResult {
  const parsed = ExecutionReceiptV02Schema.safeParse(value);
  if (!parsed.success) {
    return {
      valid: false,
      kind: 'receipt.v0.2',
      schemaVersion: 'witseal.receipt.v0.2',
      reason: `schema validation failed: ${formatZodError(parsed.error)}`,
    };
  }
  if (publicKey === undefined) {
    return {
      valid: false,
      kind: 'receipt.v0.2',
      schemaVersion: 'witseal.receipt.v0.2',
      reason:
        'v0.2 receipt verification requires a public key (none supplied)',
    };
  }
  const receipt: ExecutionReceiptV02 = parsed.data;
  const sig = verifyReceiptV02(receipt, publicKey);
  if (!sig.valid) {
    return {
      valid: false,
      kind: 'receipt.v0.2',
      schemaVersion: 'witseal.receipt.v0.2',
      ...(sig.reason !== undefined ? { reason: sig.reason } : {}),
    };
  }
  return {
    valid: true,
    kind: 'receipt.v0.2',
    schemaVersion: 'witseal.receipt.v0.2',
  };
}

/**
 * Verify an evidence package: schema parse + hash-chain verification +
 * per-receipt integrity (each receipt against its companion event; v0.2
 * receipts additionally require a public key for signature verification).
 */
export function verifyEvidencePackageObject(
  value: unknown,
  publicKey?: KeyObject | string | Uint8Array
): VerifyResult {
  // Validate the package envelope + events, but NOT the receipts array.
  // `EvidencePackageSchema` types `receipts` against the v0.1 receipt schema
  // (the wire contract is frozen); a v0.2 receipt would fail that element
  // schema on its `witseal.receipt.v0.2` literal. Receipts are therefore
  // discriminated and verified per-element below, by their own schema_version.
  // `.omit` derives a local schema in the verify layer; it does not mutate the
  // frozen package schema definition.
  const envelopeSchema = EvidencePackageSchema.omit({ receipts: true });
  const parsed = envelopeSchema.safeParse(value);
  if (!parsed.success) {
    return {
      valid: false,
      kind: 'evidence-package.v0.1',
      schemaVersion: 'witseal.evidence-package.v0.1',
      reason: `schema validation failed: ${formatZodError(parsed.error)}`,
    };
  }
  const pkg: Omit<EvidencePackage, 'receipts'> = parsed.data;

  // 1. Chain verification over the package's events, anchored at the
  //    declared head-before-range.
  const chain = verifyChain(pkg.events, pkg.chain_head_before_range);
  if (!chain.valid) {
    return {
      valid: false,
      kind: 'evidence-package.v0.1',
      schemaVersion: 'witseal.evidence-package.v0.1',
      reason: `chain verification failed: ${chain.reason}`,
    };
  }

  // 2. chain_head_after_range must match the recomputed head.
  const recomputedHead =
    pkg.events.length > 0 ? pkg.events[pkg.events.length - 1]!.event_hash : null;
  if (recomputedHead !== pkg.chain_head_after_range) {
    return {
      valid: false,
      kind: 'evidence-package.v0.1',
      schemaVersion: 'witseal.evidence-package.v0.1',
      reason: `chain_head_after_range mismatch: declared ${pkg.chain_head_after_range}, recomputed ${recomputedHead}`,
    };
  }

  // 3. Per-receipt integrity. Receipts are paired 1:1 with events by
  //    witness_event_id. Each receipt is verified against its companion
  //    event; the receipt's own schema_version selects the verifier (v0.1 vs
  //    v0.2), since the package envelope above deliberately skipped the
  //    receipts array.
  const rawReceiptsField = (value as { receipts?: unknown }).receipts;
  if (!Array.isArray(rawReceiptsField)) {
    return {
      valid: false,
      kind: 'evidence-package.v0.1',
      schemaVersion: 'witseal.evidence-package.v0.1',
      reason: 'receipts: missing or not an array',
    };
  }
  const rawReceipts: unknown[] = rawReceiptsField;

  const eventById = new Map<string, WitnessEvent>();
  for (const ev of pkg.events) eventById.set(ev.event_id, ev);

  const receiptResults: Array<{ index: number; valid: boolean; reason?: string }> = [];
  let firstFailure: { index: number; reason: string } | undefined;

  for (let i = 0; i < rawReceipts.length; i++) {
    const raw = rawReceipts[i];
    const sub = verifyPackageReceipt(raw, eventById, publicKey);
    receiptResults.push({ index: i, valid: sub.valid, ...(sub.reason !== undefined ? { reason: sub.reason } : {}) });
    if (!sub.valid && firstFailure === undefined) {
      firstFailure = { index: i, reason: sub.reason ?? 'unknown receipt failure' };
    }
  }

  if (firstFailure !== undefined) {
    return {
      valid: false,
      kind: 'evidence-package.v0.1',
      schemaVersion: 'witseal.evidence-package.v0.1',
      reason: `receipt[${firstFailure.index}] verification failed: ${firstFailure.reason}`,
      receiptResults,
    };
  }

  return {
    valid: true,
    kind: 'evidence-package.v0.1',
    schemaVersion: 'witseal.evidence-package.v0.1',
    receiptResults,
  };
}

/**
 * Verify one receipt drawn from an evidence package against its companion
 * event. Discriminates on the receipt's own schema_version.
 */
function verifyPackageReceipt(
  raw: unknown,
  eventById: Map<string, WitnessEvent>,
  publicKey?: KeyObject | string | Uint8Array
): { valid: boolean; reason?: string } {
  const sv = readSchemaVersion(raw);

  if (sv === 'witseal.receipt.v0.2') {
    const parsed = ExecutionReceiptV02Schema.safeParse(raw);
    if (!parsed.success) {
      return { valid: false, reason: `v0.2 schema validation failed: ${formatZodError(parsed.error)}` };
    }
    const receipt = parsed.data;
    // Cross-reference: witness_event_id must resolve to an event in range.
    // (receipt_id may be null for execution_lost, so we key on the event id.)
    const event = eventById.get(receipt.witness_event_id);
    if (!event) {
      return { valid: false, reason: `witness_event_id ${receipt.witness_event_id} has no companion event in the package` };
    }
    if (publicKey === undefined) {
      return { valid: false, reason: 'v0.2 receipt in package requires a public key (none supplied)' };
    }
    const sig = verifyReceiptV02(receipt, publicKey);
    if (!sig.valid) {
      return { valid: false, ...(sig.reason !== undefined ? { reason: sig.reason } : {}) };
    }
    // Hash cross-references against the companion event.
    return crossCheckAgainstEvent(receipt, event);
  }

  // Default: v0.1 receipt.
  const parsed = ExecutionReceiptSchema.safeParse(raw);
  if (!parsed.success) {
    return { valid: false, reason: `v0.1 schema validation failed: ${formatZodError(parsed.error)}` };
  }
  const receipt = parsed.data;
  const event = eventById.get(receipt.witness_event_id);
  if (!event) {
    return { valid: false, reason: `witness_event_id ${receipt.witness_event_id} has no companion event in the package` };
  }
  return verifyReceipt(receipt, event);
}

/**
 * Cross-check a v0.2 receipt's hash references against its companion witness
 * event. `verifyReceiptV02` already confirmed the signature + self-hash; this
 * confirms the receipt actually describes the event it is paired with.
 */
function crossCheckAgainstEvent(
  receipt: ExecutionReceiptV02,
  event: WitnessEvent
): { valid: boolean; reason?: string } {
  if (receipt.classified_intent_hash !== sha256OfCanonical(event.classified_intent)) {
    return { valid: false, reason: 'classified_intent_hash does not match companion event' };
  }
  if (receipt.policy_decision_hash !== sha256OfCanonical(event.policy_decision)) {
    return { valid: false, reason: 'policy_decision_hash does not match companion event' };
  }
  // execution_result_hash may be null (denied / execution_lost). When the
  // receipt carries a non-null hash, it must match the event's execution
  // result; when null we accept it (the receipt may represent a lost or
  // denied execution even where the event recorded a result).
  if (receipt.execution_result_hash !== null) {
    const expected = event.execution_result
      ? sha256OfCanonical(event.execution_result)
      : null;
    if (receipt.execution_result_hash !== expected) {
      return { valid: false, reason: 'execution_result_hash does not match companion event' };
    }
  }
  return { valid: true };
}

function formatZodError(error: { errors: Array<{ path: (string | number)[]; message: string }> }): string {
  return error.errors
    .map((e) => `${e.path.join('.') || '<root>'}: ${e.message}`)
    .join('; ');
}
