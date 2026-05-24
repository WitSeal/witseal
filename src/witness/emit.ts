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
import { finalizeEvent } from '../integrity/hash-chain.js';
import type { EventLog } from './event-log.js';
import type { WitnessEvent, WitnessEventDraft, WitnessOutcome } from '../../schemas/witness-event.schema.js';
import type { ClassifiedIntent } from '../../schemas/intent.schema.js';
import type { PolicyDecision } from '../../schemas/policy.schema.js';
import type { ApprovalRecord } from '../../schemas/approval.schema.js';
import type { ExecutionResult } from '../../schemas/execution-result.schema.js';

export const WITSEAL_RUNTIME_VERSION = '0.1.0-pre';
export const WITNESS_SCHEMA_VERSION = 'witseal.witness.v0.1' as const;

export interface EmitInput {
  classifiedIntent: ClassifiedIntent;
  policyDecision: PolicyDecision;
  approval: ApprovalRecord | null;
  executionResult: ExecutionResult | null;
  outcome: WitnessOutcome;
  agentIdentifier: string;
  classifierVersion: string;
}

export async function emitWitnessEvent(
  eventLog: EventLog,
  input: EmitInput
): Promise<WitnessEvent> {
  // Read current chain head (releases its own shared lock immediately).
  const { head, sequence } = eventLog.readChainHead();

  const eventId = generateEventId();
  const receiptId = generateReceiptId();

  const draft: WitnessEventDraft = {
    schema_version: WITNESS_SCHEMA_VERSION,
    event_id: eventId,
    // P0-5: read the segment from the EventLog instance rather than hardcoding
    // 'default'. This makes `--segment <id>` at the CLI surface propagate into
    // each persisted WitnessEvent's `chain_segment_id`.
    chain_segment_id: eventLog.segmentId,
    sequence,
    timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    previous_event_hash: head,
    originating_node: hostname() || 'local',
    agent_identifier: input.agentIdentifier,
    classified_intent: input.classifiedIntent,
    policy_decision: input.policyDecision,
    approval: input.approval,
    execution_result: input.executionResult,
    outcome: input.outcome,
    receipt_id: receiptId,
    versions: {
      witseal_runtime: WITSEAL_RUNTIME_VERSION,
      classifier: input.classifierVersion,
      schema: WITNESS_SCHEMA_VERSION,
    },
  };

  const event = finalizeEvent(draft);
  eventLog.appendEvent(event);
  return event;
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
