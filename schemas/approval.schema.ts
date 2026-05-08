/**
 * Approval Record schema.
 *
 * An ApprovalRecord captures a human (or CI) authorization for an action
 * that policy evaluation flagged as require-approval. The record is sealed
 * into the witness event for the action — it is not a separate chain entry.
 *
 * See ADR-0004 and ARCHITECTURE.md Section 3.2.
 *
 * Schema version: witseal.approval.v0.1
 */

import { z } from 'zod';

/**
 * Approval principal type.
 *
 *   human — a person at a TTY responded
 *   ci    — a CI environment auto-approved via WITSEAL_AUTO_APPROVE allow-list
 *
 * Future: 'biometric', 'hardware_key', 'remote' (Phase 5+).
 */
export const PrincipalTypeSchema = z.enum(['human', 'ci']);
export type PrincipalType = z.infer<typeof PrincipalTypeSchema>;

export const ApprovalPrincipalSchema = z.object({
  type: PrincipalTypeSchema,
  /** For 'human': the local username ($USER). For 'ci': $WITSEAL_CI_PRINCIPAL or 'ci'. */
  identifier: z.string().min(1),
});

export type ApprovalPrincipal = z.infer<typeof ApprovalPrincipalSchema>;

export const ApprovalOutcomeSchema = z.enum([
  'approved',
  'rejected',
  'timed_out',
  'cancelled',
]);

export type ApprovalOutcome = z.infer<typeof ApprovalOutcomeSchema>;

export const ApprovalRecordSchema = z.object({
  schema_version: z.literal('witseal.approval.v0.1'),
  approval_id: z.string().regex(/^apr_[0-9a-zA-Z]{20,}$/),
  /** Links to the intent that triggered the approval. */
  intent_id: z.string().regex(/^int_[0-9a-zA-Z]{20,}$/),
  /** When the prompt was shown to the principal. */
  prompted_at: z.string().datetime({ offset: false }),
  /** When the prompt was resolved (approved/rejected/timed_out/cancelled). */
  resolved_at: z.string().datetime({ offset: false }),
  outcome: ApprovalOutcomeSchema,
  principal: ApprovalPrincipalSchema,
  /** Optional human-provided reason text (max 1024 chars). */
  reason: z.string().max(1024).optional(),
  /** Configured timeout for this approval, in seconds. */
  timeout_seconds: z.number().int().positive(),
});

export type ApprovalRecord = z.infer<typeof ApprovalRecordSchema>;
