/**
 * Receipt generation.
 *
 * Receipts pair 1:1 with witness events. Receipt fields are derived
 * deterministically from the witness event content. The receipt is
 * hash-addressable: receipt_hash is computed via canonicalize + sha256
 * over all fields except receipt_hash itself.
 */

import { sha256OfCanonical } from '../integrity/hash-chain.js';
import type {
  ExecutionReceipt,
  ExecutionReceiptDraft,
} from '../../schemas/receipt.schema.js';
import type { WitnessEvent } from '../../schemas/witness-event.schema.js';

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
