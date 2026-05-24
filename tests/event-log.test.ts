/**
 * M1.6 — EventLog head-cache and rebuildHead edge-case coverage.
 *
 * Targets `src/witness/event-log.ts` lines 181-182 (readHeadCache JSON.parse
 * catch fallthrough) and 192-211 (rebuildHead — triggered when the head
 * cache is stale, missing, or corrupt). Includes the integrity-error throw
 * path when persisted events do not form a valid chain.
 *
 * Companion to M1 gap-analysis § 3 P2.7 (witness event-log branch gaps).
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { EventLog, StaleAppendError } from '../src/witness/event-log.js';
import { finalizeEvent } from '../src/integrity/hash-chain.js';
import { generateEventId, generateReceiptId, WITSEAL_RUNTIME_VERSION as RUNTIME_VERSION_FOR_DRAFT } from '../src/witness/emit.js';
import type { WitnessEventDraft } from '../schemas/witness-event.schema.js';
import { hostname } from 'node:os';
import { emitWitnessEvent, WITSEAL_RUNTIME_VERSION } from '../src/witness/emit.js';
import type { ClassifiedIntent } from '../schemas/intent.schema.js';
import type { PolicyDecision } from '../schemas/policy.schema.js';

const makeClassifiedIntent = (seq: number): ClassifiedIntent => ({
  schema_version: 'witseal.intent.v0.1',
  intent_id: `int_evlogtest${String(seq).padStart(13, '0')}`,
  intent: {
    action_type: 'shell_command',
    executable: 'echo',
    args: [`event-${seq}`],
    cwd: '/tmp',
    use_tty: false,
  },
  risk_class: 'C0',
  classification_reasons: ['informational'],
  classifier_version: 'evlogtest-1.0',
});

const makeDecision = (): PolicyDecision => ({
  schema_version: 'witseal.policy.v0.1',
  outcome: 'allow',
  matched_rule: null,
  reason: 'test default',
  active_pack_hashes: [],
});

async function emitN(eventLog: EventLog, n: number) {
  const results = [];
  for (let i = 0; i < n; i++) {
    const ev = await emitWitnessEvent(eventLog, {
      classifiedIntent: makeClassifiedIntent(i),
      policyDecision: makeDecision(),
      approval: null,
      executionResult: null,
      outcome: 'denied_by_policy',
      agentIdentifier: 'event-log-test',
      classifierVersion: 'evlogtest-1.0',
    });
    results.push(ev);
  }
  return results;
}

describe('EventLog — head cache edge cases', () => {
  let dataDir: string;
  let eventLog: EventLog;
  let headCachePath: string;
  let logPath: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'witseal-evlog-headcache-'));
    eventLog = new EventLog({ root: dataDir, segmentId: 'default' });
    headCachePath = join(dataDir, 'events', 'default.head');
    logPath = join(dataDir, 'events', 'default.jsonl');
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('readChainHead returns null/0 when log file does not yet exist', () => {
    expect(eventLog.readChainHead()).toEqual({ head: null, sequence: 0 });
  });

  it('rebuilds head when the head-cache file is missing but log has events', async () => {
    const emitted = await emitN(eventLog, 3);
    expect(existsSync(headCachePath)).toBe(true);

    // Delete the head cache: readHeadCache → null → rebuildHead runs.
    unlinkSync(headCachePath);
    expect(existsSync(headCachePath)).toBe(false);

    const head = eventLog.readChainHead();
    expect(head.head).toBe(emitted[2]!.event_hash);
    expect(head.sequence).toBe(3);

    // rebuildHead writes the cache back; verify it was repopulated.
    expect(existsSync(headCachePath)).toBe(true);
    const repaired = JSON.parse(readFileSync(headCachePath, 'utf8'));
    expect(repaired.head).toBe(emitted[2]!.event_hash);
  });

  it('rebuilds head when the head cache contains malformed JSON', async () => {
    const emitted = await emitN(eventLog, 2);

    // Overwrite cache with un-parseable content → readHeadCache catch → null → rebuildHead.
    writeFileSync(headCachePath, '{not-json{', { encoding: 'utf8' });

    const head = eventLog.readChainHead();
    expect(head.head).toBe(emitted[1]!.event_hash);
    expect(head.sequence).toBe(2);
  });

  it('rebuilds head when the head cache JSON is valid but shape is wrong', async () => {
    const emitted = await emitN(eventLog, 2);

    // Parseable JSON but missing/invalid 'head' field → shape check fails → null → rebuildHead.
    writeFileSync(headCachePath, JSON.stringify({ head: 'not-a-hash', sequence: 'oops' }), {
      encoding: 'utf8',
    });

    const head = eventLog.readChainHead();
    expect(head.head).toBe(emitted[1]!.event_hash);
    expect(head.sequence).toBe(2);
  });

  it('rebuilds head when the head cache references a stale tail event_hash', async () => {
    const emitted = await emitN(eventLog, 2);

    // Plausible but stale cache: 64-hex but does not match the actual tail.
    writeFileSync(
      headCachePath,
      JSON.stringify({ head: 'a'.repeat(64), sequence: 0 }),
      { encoding: 'utf8' },
    );

    const head = eventLog.readChainHead();
    expect(head.head).toBe(emitted[1]!.event_hash);
    expect(head.sequence).toBe(2);

    // Cache should now be repaired.
    const repaired = JSON.parse(readFileSync(headCachePath, 'utf8'));
    expect(repaired.head).toBe(emitted[1]!.event_hash);
    expect(repaired.sequence).toBe(1);
  });

  it('rebuilds head when log has only blank lines / whitespace', async () => {
    // Manually create a log with only whitespace lines — readLastEvent
    // and rebuildHead both treat this as empty.
    appendFileSync(logPath, '   \n\n  \t\n', { encoding: 'utf8' });
    expect(eventLog.readChainHead()).toEqual({ head: null, sequence: 0 });
  });

  it('rebuildHead throws when persisted events do not form a valid chain', async () => {
    await emitN(eventLog, 3);

    // Corrupt the middle line so its previous_event_hash no longer matches
    // the predecessor's event_hash. We blank out the cache so rebuildHead
    // is the path that runs (and throws).
    const original = readFileSync(logPath, 'utf8');
    const lines = original.split('\n').filter((l) => l.trim());
    const mid = JSON.parse(lines[1]!);
    mid.previous_event_hash = 'd'.repeat(64);
    lines[1] = JSON.stringify(mid);
    writeFileSync(logPath, lines.join('\n') + '\n', { encoding: 'utf8' });

    unlinkSync(headCachePath);

    expect(() => eventLog.readChainHead()).toThrow(/integrity error/i);
  });

  it('verifyAll surfaces brokenAt and reason when the chain is invalid', async () => {
    // verifyAll reads all events and calls verifyChain — when verifyChain
    // reports failure, the result must spread brokenAt + reason into the
    // returned object (event-log.ts lines 148-149 branches).
    await emitN(eventLog, 3);

    // Tamper the middle event's previous_event_hash so the chain breaks at
    // sequence 1. We bypass readChainHead by going straight to verifyAll,
    // which does not need the head cache.
    const original = readFileSync(logPath, 'utf8');
    const lines = original.split('\n').filter((l) => l.trim());
    const mid = JSON.parse(lines[1]!);
    mid.previous_event_hash = 'e'.repeat(64);
    lines[1] = JSON.stringify(mid);
    writeFileSync(logPath, lines.join('\n') + '\n', { encoding: 'utf8' });

    const result = await eventLog.verifyAll();
    expect(result.valid).toBe(false);
    expect(result.eventCount).toBe(3);
    expect(result.brokenAt).toBe(1);
    expect(result.reason).toEqual(expect.stringMatching(/previous_event_hash/));
  });

  it('verifyAll omits brokenAt and reason on a healthy chain', async () => {
    // Complementary path: verifyChain returns valid → the spread ternaries
    // pick the empty-object branch and the keys must NOT appear.
    await emitN(eventLog, 2);
    const result = await eventLog.verifyAll();
    expect(result.valid).toBe(true);
    expect(result.eventCount).toBe(2);
    expect('brokenAt' in result).toBe(false);
    expect('reason' in result).toBe(false);
  });

  it('readEvents skips blank/whitespace-only lines without error', async () => {
    // Closes event-log.ts:121 — the `if (!trimmed) continue;` branch inside
    // the readline loop. Build a valid 2-event chain, then splice in blank
    // и whitespace-only lines without disturbing event order.
    const emitted = await emitN(eventLog, 2);
    const original = readFileSync(logPath, 'utf8');
    const lines = original.split('\n').filter((l) => l.trim());
    expect(lines).toHaveLength(2);

    const munged = ['', lines[0]!, '', '  \t  ', lines[1]!, ''].join('\n');
    writeFileSync(logPath, munged + '\n', { encoding: 'utf8' });

    const seen: string[] = [];
    for await (const ev of eventLog.readEvents()) {
      seen.push(ev.event_hash);
    }
    expect(seen).toEqual([emitted[0]!.event_hash, emitted[1]!.event_hash]);

    // readAllEvents goes through the same iterator — also exercise it.
    const all = await eventLog.readAllEvents();
    expect(all.map((e) => e.event_hash)).toEqual(seen);
  });
});

// ---------------------------------------------------------------------------
// P0-2 — atomic append-under-lock + stale-event rejection
// ---------------------------------------------------------------------------
//
// Runtime-boundary audit 2026-05-25 finding TS-P0-2: before this fix
// `emitWitnessEvent` read the chain head OUTSIDE the lock and the legacy
// `appendEvent(event)` appended the event under lock WITHOUT revalidating
// `previous_event_hash` / `sequence` against the head observed in the
// critical section. A second writer could advance the chain in the gap,
// silently corrupting the linkage. These tests exercise the new
// `appendDraftEvent(buildDraft)` atomic helper and the `appendEvent` stale
// rejection path (`StaleAppendError`).

function makeDraftAt(
  log: EventLog,
  head: string | null,
  sequence: number,
  seed: number
): WitnessEventDraft {
  return {
    schema_version: 'witseal.witness.v0.1',
    event_id: generateEventId(),
    chain_segment_id: log.segmentId,
    sequence,
    timestamp: '2026-05-25T12:00:00Z',
    previous_event_hash: head,
    originating_node: hostname() || 'local',
    agent_identifier: `p0-2-test-${seed}`,
    classified_intent: makeClassifiedIntent(seed),
    policy_decision: makeDecision(),
    approval: null,
    execution_result: null,
    outcome: 'denied_by_policy',
    receipt_id: generateReceiptId(),
    versions: {
      witseal_runtime: RUNTIME_VERSION_FOR_DRAFT,
      classifier: 'evlogtest-1.0',
      schema: 'witseal.witness.v0.1',
    },
  };
}

describe('EventLog.appendDraftEvent (P0-2 atomic critical section)', () => {
  let dataDir: string;
  let log: EventLog;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'witseal-p0-2-'));
    log = new EventLog({ root: dataDir, segmentId: 'default' });
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('builds + finalizes + appends in one critical section (happy path)', () => {
    const event = log.appendDraftEvent((head, sequence) => {
      expect(head).toBeNull();
      expect(sequence).toBe(0);
      return makeDraftAt(log, head, sequence, 0);
    });
    expect(event.sequence).toBe(0);
    expect(event.previous_event_hash).toBeNull();
    expect(event.event_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects a buildDraft callback that ignores the provided head', () => {
    const first = log.appendDraftEvent((h, s) => makeDraftAt(log, h, s, 0));
    expect(() =>
      log.appendDraftEvent((_head, sequence) => {
        // Ignore the head and lie with a stale value.
        return makeDraftAt(log, 'a'.repeat(64), sequence, 1);
      })
    ).toThrow(StaleAppendError);
    // First event still on disk; nothing partial appended.
    expect(first.sequence).toBe(0);
  });

  it('rejects a buildDraft callback that ignores the provided sequence', () => {
    log.appendDraftEvent((h, s) => makeDraftAt(log, h, s, 0));
    expect(() =>
      log.appendDraftEvent((head, _sequence) =>
        // Use head correctly but lie about sequence.
        makeDraftAt(log, head, 0, 1)
      )
    ).toThrow(StaleAppendError);
  });

  it('chains contiguously across many sequential atomic appends', () => {
    const seq: string[] = [];
    for (let i = 0; i < 5; i++) {
      const ev = log.appendDraftEvent((h, s) => makeDraftAt(log, h, s, i));
      expect(ev.sequence).toBe(i);
      seq.push(ev.event_hash);
    }
    // Each event's prev should equal the prior event's hash.
    const persisted = readFileSync(
      join(dataDir, 'events', 'default.jsonl'),
      'utf8'
    )
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
    expect(persisted).toHaveLength(5);
    for (let i = 1; i < 5; i++) {
      expect(persisted[i]!.previous_event_hash).toBe(persisted[i - 1]!.event_hash);
      expect(persisted[i]!.sequence).toBe(i);
    }
  });

  it('emitWitnessEvent via Promise.all preserves contiguous sequence', async () => {
    // Five concurrent emits scheduled together. Each goes through
    // appendDraftEvent under the exclusive lock; the resulting sequence
    // must be 0..4 with valid prev-hash linkage.
    const emits = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        emitWitnessEvent(log, {
          classifiedIntent: makeClassifiedIntent(i),
          policyDecision: makeDecision(),
          approval: null,
          executionResult: null,
          outcome: 'denied_by_policy',
          agentIdentifier: `parallel-${i}`,
          classifierVersion: 'evlogtest-1.0',
        })
      )
    );
    const sequences = emits.map((e) => e.sequence).sort((a, b) => a - b);
    expect(sequences).toEqual([0, 1, 2, 3, 4]);
    const all = await log.readAllEvents();
    expect(all).toHaveLength(5);
    expect(all[0]!.previous_event_hash).toBeNull();
    for (let i = 1; i < 5; i++) {
      expect(all[i]!.previous_event_hash).toBe(all[i - 1]!.event_hash);
    }
  });
});

describe('EventLog.appendEvent stale rejection (P0-2)', () => {
  let dataDir: string;
  let log: EventLog;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'witseal-p0-2-stale-'));
    log = new EventLog({ root: dataDir, segmentId: 'default' });
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('rejects an event whose previous_event_hash does not match current head', () => {
    // Establish a genesis.
    log.appendDraftEvent((h, s) => makeDraftAt(log, h, s, 0));
    // Build a "second" event but pretend the head is null (stale).
    const stale = finalizeEvent(makeDraftAt(log, null, 1, 1));
    expect(() => log.appendEvent(stale)).toThrow(StaleAppendError);
  });

  it('rejects an event whose sequence does not match next-expected', () => {
    log.appendDraftEvent((h, s) => makeDraftAt(log, h, s, 0));
    const head = log.readChainHead();
    // Correct prev_hash, but wrong sequence (jump to 5 instead of 1).
    const stale = finalizeEvent(makeDraftAt(log, head.head, 5, 1));
    expect(() => log.appendEvent(stale)).toThrow(StaleAppendError);
  });

  it('rejects a re-played first event after the chain has advanced', () => {
    // First append.
    const first = log.appendDraftEvent((h, s) => makeDraftAt(log, h, s, 0));
    // Build another genesis-style event (prev=null, seq=0) — replay of the
    // exact initial state.
    const replayed = finalizeEvent(makeDraftAt(log, null, 0, 99));
    expect(() => log.appendEvent(replayed)).toThrow(StaleAppendError);
    // First event still intact.
    expect(first.sequence).toBe(0);
  });

  it('StaleAppendError carries the field name + expected + actual values', () => {
    log.appendDraftEvent((h, s) => makeDraftAt(log, h, s, 0));
    const stale = finalizeEvent(makeDraftAt(log, null, 1, 1));
    try {
      log.appendEvent(stale);
      throw new Error('should have thrown');
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(StaleAppendError);
      const err = e as StaleAppendError;
      expect(err.field).toBe('previous_event_hash');
      expect(err.actual).toBe('null');
      expect(err.expected).not.toBe('null');
    }
  });
});
