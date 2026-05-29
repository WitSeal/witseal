/**
 * `witseal replay` — replay an action from its evidence.
 *
 * Phase 1 v0.1: replay = reconstruct the chain head deterministically from
 * the recorded event. This proves the recorded evidence is internally
 * consistent. It does NOT re-execute the original action (re-execution
 * would have side effects on the live system; out of scope).
 */

import { EventLog } from '../witness/event-log.js';
import { verifyEventHash } from '../integrity/hash-chain.js';
import { generateReceipt, verifyReceipt } from '../receipts/generate.js';
import type { WitnessEvent } from '../../schemas/witness-event.schema.js';

export interface ReplayOptions {
  identifier: string;
  dataDir: string;
  segmentId: string;
}

export async function runReplay(opts: ReplayOptions): Promise<number> {
  const eventLog = new EventLog({ root: opts.dataDir, segmentId: opts.segmentId });
  const events = await eventLog.readAllEvents();

  const event = findEvent(events, opts.identifier);
  if (!event) {
    process.stderr.write(`witseal: no event found matching '${opts.identifier}'\n`);
    return 1;
  }

  process.stdout.write(`witseal: replaying event ${event.event_id} (sequence ${event.sequence})\n\n`);

  // 1. Verify event self-hash
  if (!verifyEventHash(event)) {
    process.stderr.write(`  ✗ event_hash invalid\n`);
    return 1;
  }
  process.stdout.write(`  ✓ event_hash valid\n`);

  // 2. Verify chain linkage to predecessor
  const prev = events.find((e) => e.sequence === event.sequence - 1);
  if (event.sequence === 0) {
    if (event.previous_event_hash !== null) {
      process.stderr.write(`  ✗ genesis event has non-null previous_event_hash\n`);
      return 1;
    }
    process.stdout.write(`  ✓ genesis event (no predecessor)\n`);
  } else {
    if (!prev) {
      process.stderr.write(`  ✗ predecessor event (sequence ${event.sequence - 1}) not found\n`);
      return 1;
    }
    if (event.previous_event_hash !== prev.event_hash) {
      process.stderr.write(`  ✗ previous_event_hash does not match predecessor's event_hash\n`);
      return 1;
    }
    process.stdout.write(`  ✓ chain linkage valid (previous = ${prev.event_id})\n`);
  }

  // 3. Regenerate the receipt and verify against the event
  const receipt = generateReceipt(event);
  const receiptCheck = verifyReceipt(receipt, event);
  if (!receiptCheck.valid) {
    process.stderr.write(`  ✗ receipt verification failed: ${receiptCheck.reason}\n`);
    return 1;
  }
  process.stdout.write(`  ✓ receipt regenerable and consistent (receipt_hash=${receipt.receipt_hash.slice(0, 16)}...)\n`);

  // 4. Print the replayed action summary
  process.stdout.write(`\n  Action:    ${describeIntent(event.classified_intent.intent)}\n`);
  process.stdout.write(`  Risk:      ${event.classified_intent.risk_class}\n`);
  process.stdout.write(`  Decision:  ${event.policy_decision.outcome}`);
  if (event.policy_decision.matched_rule) {
    process.stdout.write(
      ` (${event.policy_decision.matched_rule.rule_id} in ${event.policy_decision.matched_rule.pack_id})`
    );
  }
  process.stdout.write('\n');
  if (event.approval) {
    process.stdout.write(`  Approval:  ${event.approval.outcome} by ${event.approval.principal.identifier}\n`);
  }
  if (event.execution_result) {
    process.stdout.write(`  Exit:      ${event.execution_result.exit_code}`);
    if (event.execution_result.signal) process.stdout.write(` (signal=${event.execution_result.signal})`);
    process.stdout.write('\n');
  }
  process.stdout.write(`  Outcome:   ${event.outcome}\n`);

  return 0;
}

function findEvent(events: WitnessEvent[], id: string): WitnessEvent | undefined {
  // Try sequence number first
  const asNum = parseInt(id, 10);
  if (Number.isFinite(asNum) && String(asNum) === id) {
    const bySeq = events.find((e) => e.sequence === asNum);
    if (bySeq) return bySeq;
  }
  // Then full event_id
  const byId = events.find((e) => e.event_id === id);
  if (byId) return byId;
  // Then prefix match on event_id
  const matches = events.filter((e) => e.event_id.startsWith(id));
  if (matches.length === 1) return matches[0];
  return undefined;
}

function describeIntent(intent: import('../../schemas/intent.schema.js').Intent): string {
  switch (intent.action_type) {
    case 'shell_command':
      return `shell: ${intent.executable} ${intent.args.join(' ')}`;
    case 'file_write':
      return `file_write: ${intent.path} (${intent.mode})`;
    case 'file_read':
      return `file_read: ${intent.path}`;
  }
}
