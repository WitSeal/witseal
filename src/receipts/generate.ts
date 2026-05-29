/**
 * Receipt generation — v0.1 and v0.2 dispatch.
 *
 * Receipts pair 1:1 with witness events. Receipt fields are derived
 * deterministically from the witness event content. The receipt is
 * hash-addressable: receipt_hash is computed via canonicalize + sha256
 * over all fields except receipt_hash itself.
 *
 * v0.2 adds: signature (empty-string-sentinel), prev_hash (nullable-mandatory
 * with genesis-null), git_commit / artifact_digest / attestation_digest
 * (build provenance), receipt_id nullable (null for the execution_lost
 * outcome), and serialize-skip optionals. v0.2 generation is
 * routed through `signReceiptV02` (see `sign-v0.2.ts`).
 */

import type { KeyObject } from 'node:crypto';
import { sha256OfCanonical } from '../integrity/hash-chain.js';
import type {
  ExecutionReceipt,
  ExecutionReceiptDraft,
} from '../../schemas/receipt.schema.js';
import type {
  ExecutionReceiptV02,
  ExecutionReceiptV02Draft,
} from '../../schemas/receipt-v0.2.schema.js';
import type { WitnessEvent } from '../../schemas/witness-event.schema.js';
import { SIGNATURE_SENTINEL, signReceiptV02 } from './sign-v0.2.js';

/** Outcome marker for the v0.2 `execution_lost` flow. When set as the
 *  receipt's outcome, `receipt_id` is `null` (nullable-mandatory). The
 *  v0.1 `WitnessOutcomeSchema` enum does NOT include this value; extending
 *  v0.1 is a cross-track schema decision and is out of scope for v0.2
 *  receipt generation. */
export const EXECUTION_LOST_OUTCOME = 'execution_lost';

export function generateReceipt(event: WitnessEvent): ExecutionReceipt {
  const draft: ExecutionReceiptDraft = {
    schema_version: 'witseal.receipt.v0.1',
    receipt_id: event.receipt_id,
    witness_event_id: event.event_id,
    chain_segment_id: event.chain_segment_id,
    finalized_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    policy_decision_hash: sha256OfCanonical(event.policy_decision),
    classified_intent_hash: sha256OfCanonical(event.classified_intent),
    execution_result_hash: event.execution_result
      ? sha256OfCanonical(event.execution_result)
      : null,
    outcome: event.outcome,
  };

  const receipt_hash = sha256OfCanonical(draft);
  return { ...draft, receipt_hash };
}

/**
 * Verify a receipt against its companion witness event.
 *
 * Returns:
 *   - { valid: true } if all hash references match and self-hash is correct
 *   - { valid: false, reason } otherwise
 */
export function verifyReceipt(
  receipt: ExecutionReceipt,
  event: WitnessEvent
): { valid: boolean; reason?: string } {
  if (receipt.witness_event_id !== event.event_id) {
    return { valid: false, reason: 'witness_event_id does not match event_id' };
  }
  if (receipt.receipt_id !== event.receipt_id) {
    return { valid: false, reason: 'receipt_id does not match event.receipt_id' };
  }
  if (receipt.classified_intent_hash !== sha256OfCanonical(event.classified_intent)) {
    return { valid: false, reason: 'classified_intent_hash mismatch' };
  }
  if (receipt.policy_decision_hash !== sha256OfCanonical(event.policy_decision)) {
    return { valid: false, reason: 'policy_decision_hash mismatch' };
  }
  const expectedExecHash = event.execution_result
    ? sha256OfCanonical(event.execution_result)
    : null;
  if (receipt.execution_result_hash !== expectedExecHash) {
    return { valid: false, reason: 'execution_result_hash mismatch' };
  }
  // Verify self-hash
  const { receipt_hash, ...draft } = receipt;
  if (sha256OfCanonical(draft) !== receipt_hash) {
    return { valid: false, reason: 'receipt_hash invalid (self-hash check failed)' };
  }
  return { valid: true };
}

/**
 * Extra v0.2 inputs that the witness event does NOT carry: build provenance
 * (git_commit / artifact_digest / attestation_digest), chain-segment linkage
 * (prev_hash), and serialize-skip optionals.
 */
export interface ReceiptV02ExtraInputs {
  /** Receipt-level chain-segment linkage. `null` at chain-segment genesis
   *  (genesis-null convention); otherwise the predecessor receipt's
   *  `receipt_hash`. */
  prev_hash: string | null;
  /** Bare 40-char lowercase SHA-1 hex of the build commit (no `git:` prefix). */
  git_commit: string;
  /** `sha256:` + 64-hex digest of the build artifact. */
  artifact_digest: string;
  /** `sha256:` + 64-hex digest of the attestation. */
  attestation_digest: string;
  /** Closed kebab-case artifact taxonomy literal,
   *  e.g. `generic-binary`. Mandatory v0.2 wire field. */
  artifact_type: string;
  /** Free-form build-context identifier. Mandatory v0.2
   *  wire field. */
  build_id: string;
  /** When `true`, the receipt represents an `execution_lost` outcome:
   *  `outcome = 'execution_lost'`, `receipt_id = null`, and
   *  `execution_result_hash = null`. The v0.1-typed WitnessEvent cannot carry
   *  this outcome directly (its enum lacks the value), so callers signal it
   *  explicitly. */
  executionLost?: boolean;
  /** Serialize-skip optionals — omit when absent. */
  sigstore_signature?: string;
  classifier_version?: string;
  shadow_mode?: boolean;
  /** Override the timestamp; defaults to `new Date()` with second precision.
   *  Useful for deterministic fixtures and tests. */
  finalized_at?: string;
}

/**
 * Generate a v0.2 receipt from a witness event plus the v0.2-only inputs
 * the event does not carry, sign per the empty-string-sentinel procedure,
 * and return the finalized receipt.
 *
 * For `execution_lost`, pass `extra.executionLost = true`; the function
 * then sets `outcome = 'execution_lost'`, `receipt_id = null`, and
 * `execution_result_hash = null` regardless of `event.execution_result`.
 */
export function generateReceiptV02(
  event: WitnessEvent,
  extra: ReceiptV02ExtraInputs,
  privateKey: KeyObject | string | Uint8Array
): ExecutionReceiptV02 {
  const executionLost = extra.executionLost === true;

  const finalized_at =
    extra.finalized_at ??
    new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  const draft: ExecutionReceiptV02Draft = {
    schema_version: 'witseal.receipt.v0.2',
    receipt_id: executionLost ? null : event.receipt_id,
    witness_event_id: event.event_id,
    chain_segment_id: event.chain_segment_id,
    finalized_at,
    policy_decision_hash: sha256OfCanonical(event.policy_decision),
    classified_intent_hash: sha256OfCanonical(event.classified_intent),
    execution_result_hash:
      executionLost || event.execution_result === null
        ? null
        : sha256OfCanonical(event.execution_result),
    outcome: executionLost ? EXECUTION_LOST_OUTCOME : event.outcome,
    prev_hash: extra.prev_hash,
    signature: SIGNATURE_SENTINEL,
    git_commit: extra.git_commit,
    artifact_digest: extra.artifact_digest,
    attestation_digest: extra.attestation_digest,
    artifact_type: extra.artifact_type,
    build_id: extra.build_id,
    ...(extra.sigstore_signature !== undefined
      ? { sigstore_signature: extra.sigstore_signature }
      : {}),
    ...(extra.classifier_version !== undefined
      ? { classifier_version: extra.classifier_version }
      : {}),
    ...(extra.shadow_mode !== undefined ? { shadow_mode: extra.shadow_mode } : {}),
  };

  return signReceiptV02(draft, privateKey);
}

/**
 * Schema-version dispatch entry-point.
 *
 * Routes to the v0.1 or v0.2 generator based on the requested
 * `schema_version`. v0.2 requires `extra` (build provenance and prev_hash)
 * and `privateKey`; v0.1 ignores both.
 */
export function generateReceiptByVersion(
  event: WitnessEvent,
  schemaVersion: 'witseal.receipt.v0.1',
): ExecutionReceipt;
export function generateReceiptByVersion(
  event: WitnessEvent,
  schemaVersion: 'witseal.receipt.v0.2',
  extra: ReceiptV02ExtraInputs,
  privateKey: KeyObject | string | Uint8Array,
): ExecutionReceiptV02;
export function generateReceiptByVersion(
  event: WitnessEvent,
  schemaVersion: 'witseal.receipt.v0.1' | 'witseal.receipt.v0.2',
  extra?: ReceiptV02ExtraInputs,
  privateKey?: KeyObject | string | Uint8Array,
): ExecutionReceipt | ExecutionReceiptV02 {
  if (schemaVersion === 'witseal.receipt.v0.1') {
    return generateReceipt(event);
  }
  if (schemaVersion === 'witseal.receipt.v0.2') {
    if (extra === undefined || privateKey === undefined) {
      throw new Error(
        'generateReceiptByVersion: v0.2 requires `extra` and `privateKey`'
      );
    }
    return generateReceiptV02(event, extra, privateKey);
  }
  throw new Error(
    `generateReceiptByVersion: unknown schema_version ${schemaVersion as string}`
  );
}
