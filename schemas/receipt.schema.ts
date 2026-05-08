/**
 * Execution Receipt schema.
 *
 * A receipt is structured proof of a completed action — pairing 1:1 with
 * a witness event. The receipt is hash-addressable and verifiable
 * independently of the producing system.
 *
 * See ARCHITECTURE.md Section 3.3 and ADR-0001.
 *
 * Schema version: witseal.receipt.v0.1
 */

import { z } from 'zod';

export const ExecutionReceiptSchema = z.object({
  schema_version: z.literal('witseal.receipt.v0.1'),
  receipt_id: z.string().regex(/^rcpt_[0-9a-zA-Z]{20,}$/),
  /** Links the receipt to its witness event. */
  witness_event_id: z.string().regex(/^evt_[0-9a-zA-Z]{20,}$/),
  /** ID of the chain segment this receipt belongs to. */
  chain_segment_id: z.string().min(1),
  /** When the receipt was finalized (after execution, before chain append). */
  finalized_at: z.string().datetime({ offset: false }),
  /** The hash of this receipt. Self-referential: receipt_hash field excluded
   *  during canonicalization, then hash computed and assigned. */
  receipt_hash: z.string().regex(/^[a-f0-9]{64}$/),
  /** Hash of the matched policy decision (for replay verification). */
  policy_decision_hash: z.string().regex(/^[a-f0-9]{64}$/),
  /** Hash of the classified intent. */
  classified_intent_hash: z.string().regex(/^[a-f0-9]{64}$/),
  /** Hash of the execution result, if any. null for denied actions. */
  execution_result_hash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  /** Outcome label, mirrored from the witness event for quick filtering. */
  outcome: z.string(),
});

export type ExecutionReceipt = z.infer<typeof ExecutionReceiptSchema>;

export type ExecutionReceiptDraft = Omit<ExecutionReceipt, 'receipt_hash'>;
