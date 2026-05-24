/**
 * Witness Event schema.
 *
 * A WitnessEvent is an append-only record of a single classified, evaluated,
 * and (where relevant) executed action. Events are linked into a hash chain
 * via `previous_event_hash`. See ARCHITECTURE.md Section 3.4 and ADR-0001.
 *
 * Schema version: witseal.witness.v0.1
 *
 * Stability: Phase 1 is v0.1. Breaking changes require a major version bump
 * and an RFC. Additive (minor) changes preserve forward compatibility.
 */

import { z } from 'zod';
import { ClassifiedIntentSchema } from './intent.schema.js';
import { PolicyDecisionSchema } from './policy.schema.js';
import { ApprovalRecordSchema } from './approval.schema.js';
import { ExecutionResultSchema } from './execution-result.schema.js';

/**
 * SHA-256 hash, hex-encoded, lowercase.
 */
export const Sha256HashSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, 'must be a lowercase hex SHA-256 hash');

/**
 * RFC 3339 timestamp, UTC, with second or sub-second precision.
 */
export const TimestampSchema = z
  .string()
  .datetime({ offset: false, message: 'must be RFC 3339 UTC timestamp' });

/**
 * Outcome of the witness event — what actually happened to the action.
 *
 * Additive value `no_policy_configured` (P0-4, runtime-boundary audit
 * 2026-05-25): emitted when the runtime detected that no policy packs are
 * loaded. By default the runtime fails closed (no execution, `null`
 * execution_result). With the operator-explicit opt-in
 * `WITSEAL_UNSAFE_ALLOW_NO_POLICY=1`, the action proceeds but the witness
 * event still carries this outcome (NOT `allowed_executed`) so downstream
 * evidence consumers can distinguish "allowed by policy" from "ran without
 * policy mediation". Presence of `execution_result` tells the consumer
 * which case occurred: `null` = blocked; non-null = ran under escape hatch.
 */
export const WitnessOutcomeSchema = z.enum([
  'allowed_executed',
  'allowed_executed_with_error',
  'approved_executed',
  'approved_executed_with_error',
  'denied_by_policy',
  'denied_by_approval',
  'denied_by_classification_failure',
  'no_policy_configured',
]);

export type WitnessOutcome = z.infer<typeof WitnessOutcomeSchema>;

/**
 * The canonical witness event.
 *
 * Hashing rule (per ADR-0001 / RFC 8785):
 *   1. Take this object with `event_hash` field omitted
 *   2. Canonicalize via JCS (RFC 8785)
 *   3. SHA-256 the canonical bytes
 *   4. Hex-encode lowercase, set as `event_hash`
 */
export const WitnessEventSchema = z.object({
  /** Always 'witseal.witness.v0.1' for this version. */
  schema_version: z.literal('witseal.witness.v0.1'),

  /** Unique event identifier; ULID-like, sortable by time. */
  event_id: z
    .string()
    .regex(/^evt_[0-9a-zA-Z]{20,}$/, 'must be evt_<id>'),

  /** ID of the chain segment this event belongs to. Default: 'default'. */
  chain_segment_id: z.string().min(1).default('default'),

  /** Sequence number within this chain segment. Starts at 0 for the genesis event. */
  sequence: z.number().int().nonnegative(),

  /** ISO 8601 UTC timestamp at which the event was emitted. */
  timestamp: TimestampSchema,

  /** Hash of the previous event in the chain. null for the genesis event. */
  previous_event_hash: Sha256HashSchema.nullable(),

  /** Self-hash of this event (computed last). */
  event_hash: Sha256HashSchema,

  /** Originating-node identifier. Phase 1: hostname or 'local'. Phase 6: federated node ID. */
  originating_node: z.string().default('local'),

  /** Identifier of the agent that produced the intent. Free-form in v0.1. */
  agent_identifier: z.string().min(1),

  /** The classified intent that was evaluated. */
  classified_intent: ClassifiedIntentSchema,

  /** The policy decision that resulted from evaluation. */
  policy_decision: PolicyDecisionSchema,

  /** The approval record, if approval was required. null otherwise. */
  approval: ApprovalRecordSchema.nullable(),

  /** The execution result, if execution proceeded. null if denied. */
  execution_result: ExecutionResultSchema.nullable(),

  /** Final outcome label, derived from the above. */
  outcome: WitnessOutcomeSchema,

  /** Receipt ID for this action. Receipts are paired 1:1 with witness events. */
  receipt_id: z.string().regex(/^rcpt_[0-9a-zA-Z]{20,}$/),

  /** Versions of the runtime components that produced this event. For replay. */
  versions: z.object({
    witseal_runtime: z.string(),
    classifier: z.string(),
    schema: z.literal('witseal.witness.v0.1'),
  }),
});

export type WitnessEvent = z.infer<typeof WitnessEventSchema>;

/**
 * Type alias for a witness event before its self-hash is computed.
 * Used during construction; internally only. Never persisted.
 */
export type WitnessEventDraft = Omit<WitnessEvent, 'event_hash'>;
