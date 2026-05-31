/**
 * Crash-recovery torn-tail fix — deterministic proof test.
 *
 * Class B bug confirmed in @witseal/cli@0.1.2: if the process crashes
 * mid-writeSync, the JSONL log may end with a partial JSON fragment that
 * has no terminating '\n'. The next append would place a valid line
 * immediately after the fragment; JSON.parse on the joined partial+next
 * line would throw, breaking readEvents / verifyAll.
 *
 * Fix: `appendEventUnsafe` now checks the last byte of the file before
 * opening for append. If it is not '\n', the partial fragment is truncated
 * back to the last complete line boundary (or to 0 if none). The
 * read/verify path is unchanged — it handles the (now-absent) partial
 * fragment transparently.
 *
 * Proof: inject a partial fragment into a 2-event chain, append a 3rd
 * event, and assert verifyAll() returns valid=true, eventCount=3.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  appendFileSync,
  mkdtempSync,
  openSync,
  rmSync,
  writeSync,
  closeSync,
  statSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hostname } from 'node:os';

import { EventLog } from '../src/witness/event-log.js';
import { emitWitnessEvent, generateEventId, generateReceiptId, WITSEAL_RUNTIME_VERSION } from '../src/witness/emit.js';
import type { ClassifiedIntent } from '../schemas/intent.schema.js';
import type { PolicyDecision } from '../schemas/policy.schema.js';
import type { WitnessEventDraft } from '../schemas/witness-event.schema.js';

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makeIntent(n: number): ClassifiedIntent {
  return {
    schema_version: 'witseal.intent.v0.1',
    intent_id: `int_torntail${String(n).padStart(13, '0')}`,
    intent: {
      action_type: 'shell_command',
      executable: '/bin/echo',
      args: [`torn-tail-${n}`],
      cwd: '/tmp',
      use_tty: false,
    },
    risk_class: 'C0',
    classification_reasons: ['informational'],
    classifier_version: 'torn-tail-test-1.0',
  };
}

function makeDecision(): PolicyDecision {
  return {
    schema_version: 'witseal.policy.v0.1',
    outcome: 'allow',
    matched_rule: null,
    reason: 'test',
    active_pack_hashes: [],
  };
}

function makeDraft(
  log: EventLog,
  head: string | null,
  seq: number,
  n: number
): WitnessEventDraft {
  return {
    schema_version: 'witseal.witness.v0.1',
    event_id: generateEventId(),
    chain_segment_id: log.segmentId,
    sequence: seq,
    timestamp: '2026-05-31T09:00:00Z',
    previous_event_hash: head,
    originating_node: hostname() || 'local',
    agent_identifier: 'torn-tail-test',
    classified_intent: makeIntent(n),
    policy_decision: makeDecision(),
    approval: null,
    execution_result: null,
    outcome: 'allowed_executed',
    receipt_id: generateReceiptId(),
    versions: {
      witseal_runtime: WITSEAL_RUNTIME_VERSION,
      classifier: 'torn-tail-test-1.0',
      schema: 'witseal.witness.v0.1',
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('torn-tail crash-recovery fix', () => {
  let dataDir: string;
  let log: EventLog;
  let logPath: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'witseal-torn-tail-'));
    log = new EventLog({ root: dataDir, segmentId: 'default' });
    logPath = join(dataDir, 'events', 'default.jsonl');
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  // ── Deterministic proof ────────────────────────────────────────────────────

  it('PROOF: torn tail is healed and chain remains valid after 3rd append', async () => {
    // Step 1: emit 2 complete events → well-formed 2-event chain.
    const ev1 = log.appendDraftEvent((h, s) => makeDraft(log, h, s, 0));
    const ev2 = log.appendDraftEvent((h, s) => makeDraft(log, h, s, 1));

    // Verify the baseline is healthy before injection.
    const before = await log.verifyAll();
    expect(before.valid).toBe(true);
    expect(before.eventCount).toBe(2);

    // Step 2: inject a partial JSON fragment without '\n' — simulates a
    // crash mid-writeSync. The fragment is invalid JSON; appending '\n'
    // to this file without the fix would cause JSON.parse to throw.
    const partial = '{"schema_version":"witseal.witness.v0.1","event_id":"evt_torn_INCOMPLETE';
    const fdInject = openSync(logPath, 'a');
    try {
      // Write bytes without '\n' — torn tail.
      writeSync(fdInject, Buffer.from(partial, 'utf8'));
    } finally {
      closeSync(fdInject);
    }

    // Confirm the partial is there (last byte is NOT '\n').
    const contentAfterInject = readFileSync(logPath);
    expect(contentAfterInject[contentAfterInject.length - 1]).not.toBe(0x0a);

    // Step 3: append event #3 — appendEventUnsafe must detect and discard
    // the partial fragment before writing.
    const ev3 = log.appendDraftEvent((h, s) => makeDraft(log, h, s, 2));

    // Step 4: the chain must be valid with exactly 3 events.
    const after = await log.verifyAll();
    expect(after.valid).toBe(true);
    expect(after.eventCount).toBe(3);

    // Chain linkage must be intact: ev3 links to ev2 which links to ev1.
    const all = await log.readAllEvents();
    expect(all[0]!.event_hash).toBe(ev1.event_hash);
    expect(all[1]!.event_hash).toBe(ev2.event_hash);
    expect(all[2]!.event_hash).toBe(ev3.event_hash);
    expect(all[1]!.previous_event_hash).toBe(ev1.event_hash);
    expect(all[2]!.previous_event_hash).toBe(ev2.event_hash);

    // The log file must end with '\n' (clean write).
    const finalContent = readFileSync(logPath);
    expect(finalContent[finalContent.length - 1]).toBe(0x0a);
  });

  it('PROOF: torn tail with NO prior complete line → file truncated to 0 before append', async () => {
    // Inject ONLY a partial fragment with no '\n' — no complete line at all.
    // The fix must truncate to 0 (no prior '\n' found) and then append
    // event #1 as a clean genesis.
    appendFileSync(logPath, '{"partial":true', { encoding: 'utf8' });

    const contentBefore = readFileSync(logPath);
    expect(contentBefore[contentBefore.length - 1]).not.toBe(0x0a);

    const ev1 = log.appendDraftEvent((h, s) => makeDraft(log, h, s, 0));

    const after = await log.verifyAll();
    expect(after.valid).toBe(true);
    expect(after.eventCount).toBe(1);
    expect(ev1.sequence).toBe(0);
    expect(ev1.previous_event_hash).toBeNull();
  });

  it('normal appends are unaffected when last byte is already \\n (no regression)', async () => {
    // Emit 5 events with no tear — the heal check must run cleanly on each
    // append (last byte IS '\n' after each write).
    for (let i = 0; i < 5; i++) {
      log.appendDraftEvent((h, s) => makeDraft(log, h, s, i));
    }
    const result = await log.verifyAll();
    expect(result.valid).toBe(true);
    expect(result.eventCount).toBe(5);

    const content = readFileSync(logPath);
    expect(content[content.length - 1]).toBe(0x0a);
  });

  // ── Stability ──────────────────────────────────────────────────────────────

  it('stability: 10 appends after a torn tail all chain correctly', async () => {
    // Emit 3 events, inject torn tail, then emit 10 more. The first of the
    // 10 heals the tear; the subsequent 9 append normally.
    for (let i = 0; i < 3; i++) {
      log.appendDraftEvent((h, s) => makeDraft(log, h, s, i));
    }

    // Inject torn tail.
    const fdInject = openSync(logPath, 'a');
    try {
      writeSync(fdInject, Buffer.from('{"schema_version":"witseal.witness.v0.1","INCOMPLETE', 'utf8'));
    } finally {
      closeSync(fdInject);
    }

    // Emit 10 more — first one heals the tail.
    for (let i = 3; i < 13; i++) {
      log.appendDraftEvent((h, s) => makeDraft(log, h, s, i));
    }

    const result = await log.verifyAll();
    expect(result.valid).toBe(true);
    expect(result.eventCount).toBe(13);

    const all = await log.readAllEvents();
    for (let i = 1; i < all.length; i++) {
      expect(all[i]!.previous_event_hash).toBe(all[i - 1]!.event_hash);
      expect(all[i]!.sequence).toBe(i);
    }
  });

  it('recovery emit (execution_lost) also heals a torn tail (via appendDraftEvent path)', async () => {
    // The recovery path calls appendDraftEvent → appendEventUnsafe, so it
    // is covered by the same fix. Simulate: 1 event, torn tail, recovery emit.
    await emitWitnessEvent(log, {
      classifiedIntent: makeIntent(0),
      policyDecision: makeDecision(),
      approval: null,
      executionResult: null,
      outcome: 'allowed_executed',
      agentIdentifier: 'torn-recovery-test',
      classifierVersion: 'torn-tail-test-1.0',
    });

    // Inject torn tail.
    const fdInject = openSync(logPath, 'a');
    try {
      writeSync(fdInject, Buffer.from('{"partial_recovery":true', 'utf8'));
    } finally {
      closeSync(fdInject);
    }

    // Append a second event via emitWitnessEvent (uses appendDraftEvent internally).
    await emitWitnessEvent(log, {
      classifiedIntent: makeIntent(1),
      policyDecision: makeDecision(),
      approval: null,
      executionResult: null,
      outcome: 'allowed_executed',
      agentIdentifier: 'torn-recovery-test',
      classifierVersion: 'torn-tail-test-1.0',
    });

    const result = await log.verifyAll();
    expect(result.valid).toBe(true);
    expect(result.eventCount).toBe(2);
  });
});
