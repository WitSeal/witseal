/**
 * Witness emission — the high-level API for writing a witness event to
 * the chain.
 *
 * Usage:
 *
 *   const eventLog = new EventLog({ root: '...', segmentId: 'default' });
 *   const event = await emitWitnessEvent(eventLog, {
 *     classifiedIntent,
 *     policyDecision,
 *     approval,
 *     executionResult,
 *     outcome,
 *     agentIdentifier,
 *   });
 *
 * The function is synchronous-feeling but uses await to coordinate with
 * the read APIs of EventLog. All write I/O happens under exclusive
 * chain lock.
 */

import { hostname } from 'node:os';
import { WITSEAL_VERSION } from '../version.js';
import type { EventLog } from './event-log.js';
import type { WitnessEvent, WitnessEventDraft, WitnessOutcome } from '../../schemas/witness-event.schema.js';
import type { ClassifiedIntent } from '../../schemas/intent.schema.js';
import type { PolicyDecision } from '../../schemas/policy.schema.js';
import type { ApprovalRecord } from '../../schemas/approval.schema.js';
import type { ExecutionResult } from '../../schemas/execution-result.schema.js';

/** Runtime version stamped into `versions.witseal_runtime`. Tracks
 *  package.json via the single source of truth (no hardcoded literal). */
export const WITSEAL_RUNTIME_VERSION = WITSEAL_VERSION;
export const WITNESS_SCHEMA_VERSION = 'witseal.witness.v0.1' as const;

export interface EmitInput {
  classifiedIntent: ClassifiedIntent;
  policyDecision: PolicyDecision;
  approval: ApprovalRecord | null;
  executionResult: ExecutionResult | null;
  outcome: WitnessOutcome;
  agentIdentifier: string;
  classifierVersion: string;
  /**
   * Structured identity origin for `agentIdentifier`.
   * When set, propagated into `WitnessEvent.identity_origin` using the
   * same omit-when-absent discipline as other optional wire fields.
   */
  identityOrigin?: 'configured' | 'fallback';
  /**
   * P1-8: optional idempotency key. When set, EventLog.appendDraftEvent
   * scans the chain for a prior event with the same operation_id and
   * returns it WITHOUT re-appending. Use a UUIDv4 (or similar) generated
   * once at the request boundary and reused across retries.
   */
  operationId?: string;
}

export async function emitWitnessEvent(
  eventLog: EventLog,
  input: EmitInput
): Promise<WitnessEvent> {
  // P0-2: read-head + finalize + append happen under one exclusive critical
  // section via EventLog.appendDraftEvent. The previous implementation read
  // the chain head BEFORE acquiring the lock, leaving a race window where a
  // second writer could advance the chain between the read and the append.
  // The atomic helper closes that window.
  return eventLog.appendDraftEvent((head, sequence) =>
    buildBaseDraft(eventLog, head, sequence, input)
  );
}

/**
 * Internal: assemble the base WitnessEventDraft from an EmitInput. Used by
 * `emitWitnessEvent`, `emitIntentRecorded`, and `emitExecutionComplete` so
 * the field set stays in sync.
 */
function buildBaseDraft(
  eventLog: EventLog,
  head: string | null,
  sequence: number,
  input: EmitInput,
  intentRecordedEventId?: string
): WitnessEventDraft {
  return {
    schema_version: WITNESS_SCHEMA_VERSION,
    event_id: generateEventId(),
    chain_segment_id: eventLog.segmentId,
    sequence,
    timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    previous_event_hash: head,
    originating_node: hostname() || 'local',
    agent_identifier: input.agentIdentifier,
    // Structured identity origin. Omit-when-absent to preserve
    // JCS byte-identity with implementations that do not emit the field.
    ...(input.identityOrigin !== undefined
      ? { identity_origin: input.identityOrigin }
      : {}),
    classified_intent: input.classifiedIntent,
    policy_decision: input.policyDecision,
    approval: input.approval,
    execution_result: input.executionResult,
    outcome: input.outcome,
    receipt_id: generateReceiptId(),
    // Link the second-phase event to its
    // matching `intent_recorded`. Use conditional spread so the field is
    // omitted entirely (not serialized as null) when absent — preserves
    // JCS byte-identity with Rust's serde skip_serializing_if pattern.
    ...(intentRecordedEventId !== undefined
      ? { intent_recorded_event_id: intentRecordedEventId }
      : {}),
    // P1-8: append-retry idempotency key. Same skip-when-absent rule.
    ...(input.operationId !== undefined
      ? { operation_id: input.operationId }
      : {}),
    versions: {
      witseal_runtime: WITSEAL_RUNTIME_VERSION,
      classifier: input.classifierVersion,
      schema: WITNESS_SCHEMA_VERSION,
    },
  };
}

/**
 * Phase A: emit `intent_recorded` BEFORE the
 * execution attempt. The witness chain records the action's intent + policy
 * decision so a crash mid-execution leaves a recoverable trace
 * (`execution_lost` on next startup).
 *
 * The input must carry `outcome: 'pending'` and `executionResult: null`;
 * this function does not synthesize those values to make the discipline
 * explicit at the call site.
 */
export async function emitIntentRecorded(
  eventLog: EventLog,
  input: EmitInput
): Promise<WitnessEvent> {
  // DEPRECATED-FOR-EMISSION (RFC-0003 Decision B): emitIntentRecorded emits
  // 'pending' under witseal.witness.v0.1. New runtimes should not call this
  // function; 2PC semantics develop under witseal.witness.v0.2.
  if (input.outcome !== 'pending') {
    throw new Error(
      `emitIntentRecorded: outcome must be 'pending' (got ${input.outcome})`
    );
  }
  if (input.executionResult !== null) {
    throw new Error(
      `emitIntentRecorded: executionResult must be null (got non-null result)`
    );
  }
  return eventLog.appendDraftEvent((head, sequence) =>
    buildBaseDraft(eventLog, head, sequence, input)
  );
}

/**
 * Phase B: emit `execution_complete` AFTER the
 * execution attempt returns. References the matching `intent_recorded`
 * event via `intent_recorded_event_id`.
 *
 * Outcome here is the final computed outcome (allowed_executed,
 * allowed_executed_with_error, approved_executed, etc.) — caller derives
 * it from the policy decision + execution result.
 */
export async function emitExecutionComplete(
  eventLog: EventLog,
  input: EmitInput,
  intentRecordedEventId: string
): Promise<WitnessEvent> {
  if (input.outcome === 'pending' || input.outcome === 'execution_lost') {
    throw new Error(
      `emitExecutionComplete: outcome must be a final outcome (got ${input.outcome})`
    );
  }
  return eventLog.appendDraftEvent((head, sequence) =>
    buildBaseDraft(eventLog, head, sequence, input, intentRecordedEventId)
  );
}

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function generateId(prefix: string, length: number = 22): string {
  // Time-prefixed random ID. Not strict ULID — sufficient for v0.1.
  const timePart = Date.now().toString(36).padStart(8, '0');
  let randomPart = '';
  const remaining = Math.max(length - timePart.length, 8);
  const buf = new Uint8Array(remaining);
  crypto.getRandomValues(buf);
  for (let i = 0; i < buf.length; i++) {
    randomPart += ID_ALPHABET[buf[i]! % ID_ALPHABET.length]!;
  }
  return `${prefix}_${timePart}${randomPart}`;
}

export function generateEventId(): string {
  return generateId('evt', 22);
}

export function generateReceiptId(): string {
  return generateId('rcpt', 22);
}

export function generateIntentId(): string {
  return generateId('int', 22);
}

export function generateApprovalId(): string {
  return generateId('apr', 22);
}
