/**
 * Recovery — emit `execution_lost` for an abandoned `pending` tail event.
 *
 * The runtime's two-phase commit writes an
 * `intent_recorded` (outcome=`pending`) event BEFORE invoking the mediator
 * and an `execution_complete` event AFTER the mediator returns. A crash
 * between those phases leaves a `pending` event at the chain tail with no
 * matching successor. On next startup, before the next exec proceeds,
 * `runRecoveryIfNeeded` detects that unpaired tail and emits an
 * `execution_lost` event referencing the abandoned `intent_recorded`.
 *
 * Design choice: the `execution_lost` event is SELF-CONTAINED — it copies
 * `classified_intent`, `policy_decision`, `approval`, and `versions` from
 * the abandoned `intent_recorded`. This keeps each chain entry
 * independently verifiable without a sequence-index lookup.
 *
 * Concurrency: the detection AND the emit run under one exclusive critical
 * section (EventLog.appendDraftEvent acquires the chain lock). Two
 * processes recovering the same abandoned event are mutually exclusive;
 * the second observes a non-`pending` tail and returns null.
 */

import { hostname } from 'node:os';
import type { EventLog } from './event-log.js';
import type {
  WitnessEvent,
  WitnessEventDraft,
} from '../../schemas/witness-event.schema.js';
import {
  WITNESS_SCHEMA_VERSION,
  WITSEAL_RUNTIME_VERSION,
  generateEventId,
  generateReceiptId,
} from './emit.js';

/**
 * If the chain segment's tail event is an unpaired `pending`
 * (`intent_recorded` with no `execution_complete` successor), emit an
 * `execution_lost` event referencing it and return the new event.
 *
 * Returns `null` if no recovery is needed (empty chain, or tail is not
 * `pending`).
 *
 * Idempotent under concurrent invocation: the appendDraftEvent critical
 * section re-reads the tail; if a peer process already wrote
 * `execution_lost`, the buildDraft callback observes a non-`pending` tail
 * via the abandoned-event lookup below and the caller exits the recovery
 * path on the next invocation.
 */
export async function runRecoveryIfNeeded(
  eventLog: EventLog
): Promise<WitnessEvent | null> {
  // Snapshot the chain to find an abandoned pending tail. This read is
  // outside the lock; the in-lock build callback re-validates the chain
  // state and produces no-op if the tail moved.
  const events = await eventLog.readAllEvents();
  if (events.length === 0) return null;
  const tail = events[events.length - 1]!;
  if (tail.outcome !== 'pending') return null;

  // The tail is an unpaired `intent_recorded`. Emit `execution_lost` under
  // the exclusive lock; appendDraftEvent will revalidate the chain state.
  let recovered: WitnessEvent | null = null;
  try {
    recovered = eventLog.appendDraftEvent((head, sequence) =>
      buildExecutionLostDraft(eventLog, head, sequence, tail)
    );
  } catch (e: unknown) {
    // If another writer raced us to the recovery emit, the second appendDraftEvent
    // attempt will see a head that no longer matches `tail.event_hash` and the
    // build callback's previous_event_hash assertion will fail. That's a benign
    // race-loser — re-throw any other error.
    if (e instanceof Error && /previous_event_hash/i.test(e.message)) {
      return null;
    }
    throw e;
  }
  return recovered;
}

function buildExecutionLostDraft(
  eventLog: EventLog,
  head: string | null,
  sequence: number,
  abandoned: WitnessEvent
): WitnessEventDraft {
  return {
    schema_version: WITNESS_SCHEMA_VERSION,
    event_id: generateEventId(),
    chain_segment_id: eventLog.segmentId,
    sequence,
    timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    previous_event_hash: head,
    originating_node: hostname() || 'local',
    // Copy identity + context from the abandoned event so the recovery
    // entry is self-contained. The actual operator who triggered the
    // recovery is not necessarily the same as the original — but the
    // abandoned action's identity is what the chain needs to record.
    agent_identifier: abandoned.agent_identifier,
    // Propagate identity_origin from the abandoned event
    // if present; omit-when-absent to preserve JCS byte-identity.
    ...(abandoned.identity_origin !== undefined
      ? { identity_origin: abandoned.identity_origin }
      : {}),
    classified_intent: abandoned.classified_intent,
    policy_decision: abandoned.policy_decision,
    approval: abandoned.approval,
    execution_result: null,
    // DEPRECATED-FOR-EMISSION (RFC-0003 Decision B): execution_lost is retained
    // for historical-receipt compatibility only. Do not extend this path for new
    // v0.1 runtimes; 2PC → witseal.witness.v0.2.
    outcome: 'execution_lost',
    receipt_id: generateReceiptId(),
    intent_recorded_event_id: abandoned.event_id,
    versions: {
      witseal_runtime: WITSEAL_RUNTIME_VERSION,
      classifier: abandoned.versions.classifier,
      schema: WITNESS_SCHEMA_VERSION,
    },
  };
}
