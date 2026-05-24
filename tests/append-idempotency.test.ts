/**
 * P1-8 — Append retry idempotency via `operation_id`.
 *
 * Runtime-boundary audit 2026-05-25 finding TS-P1-8: append retry needs
 * an idempotency key so caller-side retries (network-driven exec, queue
 * redelivery, partial-failure resume) do not double-record the same
 * logical operation.
 *
 * Fix: optional `operation_id` field on WitnessEvent + dedupe in
 * EventLog.appendDraftEvent (sync scan inside the exclusive critical
 * section — same lock that bounds the chain-state read).
 *
 * Scope: append-only. Full file-write rollback/idempotency remains
 * Phase 2+ (temp-file staging + rename outside mediator scope).
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { EventLog } from '../src/witness/event-log.js';
import { emitWitnessEvent } from '../src/witness/emit.js';
import type { ClassifiedIntent } from '../schemas/intent.schema.js';
import type { PolicyDecision } from '../schemas/policy.schema.js';

let dataDir: string;
let log: EventLog;

const intent: ClassifiedIntent = {
  schema_version: 'witseal.intent.v0.1',
  intent_id: 'int_p180000000000000001x',
  intent: {
    action_type: 'shell_command',
    executable: 'echo',
    args: ['x'],
    cwd: '/tmp',
    use_tty: false,
  },
  risk_class: 'C0',
  classification_reasons: ['informational'],
  classifier_version: 'p1-8-test-1.0',
};

const decision: PolicyDecision = {
  schema_version: 'witseal.policy.v0.1',
  outcome: 'allow',
  matched_rule: null,
  reason: 'default allow',
  active_pack_hashes: [],
};

const baseInput = {
  classifiedIntent: intent,
  policyDecision: decision,
  approval: null,
  executionResult: null,
  outcome: 'denied_by_policy' as const,
  agentIdentifier: 'p1-8-test',
  classifierVersion: 'p1-8-test-1.0',
};

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'witseal-p1-8-'));
  log = new EventLog({ root: dataDir, segmentId: 'default' });
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('P1-8 — operation_id append-retry idempotency', () => {
  it('first emit with operation_id persists the event and stamps the key', async () => {
    const ev = await emitWitnessEvent(log, { ...baseInput, operationId: 'op-001' });
    expect(ev.operation_id).toBe('op-001');
    const all = await log.readAllEvents();
    expect(all).toHaveLength(1);
    expect(all[0]!.event_id).toBe(ev.event_id);
  });

  it('second emit with the SAME operation_id returns the FIRST event_id (no duplicate append)', async () => {
    const first = await emitWitnessEvent(log, { ...baseInput, operationId: 'op-retry' });
    const second = await emitWitnessEvent(log, { ...baseInput, operationId: 'op-retry' });
    expect(second.event_id).toBe(first.event_id);
    expect(second.event_hash).toBe(first.event_hash);
    expect(second.sequence).toBe(first.sequence);
    // Chain contains a SINGLE event.
    const all = await log.readAllEvents();
    expect(all).toHaveLength(1);
  });

  it('two emits with DIFFERENT operation_id values produce two distinct events', async () => {
    const a = await emitWitnessEvent(log, { ...baseInput, operationId: 'op-a' });
    const b = await emitWitnessEvent(log, { ...baseInput, operationId: 'op-b' });
    expect(a.event_id).not.toBe(b.event_id);
    expect(a.sequence).toBe(0);
    expect(b.sequence).toBe(1);
    const all = await log.readAllEvents();
    expect(all).toHaveLength(2);
    expect(all[0]!.operation_id).toBe('op-a');
    expect(all[1]!.operation_id).toBe('op-b');
  });

  it('emit WITHOUT operation_id never dedupes (legacy non-idempotent path)', async () => {
    const a = await emitWitnessEvent(log, baseInput);
    const b = await emitWitnessEvent(log, baseInput);
    expect(a.event_id).not.toBe(b.event_id);
    const all = await log.readAllEvents();
    expect(all).toHaveLength(2);
    // Neither event carries the field (omitted under JCS).
    const raw = readFileSync(join(dataDir, 'events', 'default.jsonl'), 'utf8');
    expect(raw).not.toContain('operation_id');
  });

  it('mixing keyed and unkeyed emits behaves correctly', async () => {
    const a = await emitWitnessEvent(log, { ...baseInput, operationId: 'mix-1' });
    const unkeyed = await emitWitnessEvent(log, baseInput);
    const aRetry = await emitWitnessEvent(log, { ...baseInput, operationId: 'mix-1' });
    const c = await emitWitnessEvent(log, { ...baseInput, operationId: 'mix-2' });

    // First keyed appended; unkeyed appended; retry dedupes to first;
    // second keyed appended → chain has 3 events.
    expect(aRetry.event_id).toBe(a.event_id);
    const all = await log.readAllEvents();
    expect(all).toHaveLength(3);
    expect(all[0]!.event_id).toBe(a.event_id);
    expect(all[1]!.event_id).toBe(unkeyed.event_id);
    expect(all[2]!.event_id).toBe(c.event_id);
  });

  it('operation_id with the same value across DIFFERENT segments does NOT cross-dedupe', async () => {
    const logB = new EventLog({ root: dataDir, segmentId: 'other' });
    const a = await emitWitnessEvent(log, { ...baseInput, operationId: 'cross-seg' });
    const b = await emitWitnessEvent(logB, { ...baseInput, operationId: 'cross-seg' });
    // Each segment is its own chain; dedupe is segment-scoped.
    expect(a.event_id).not.toBe(b.event_id);
    expect(a.chain_segment_id).toBe('default');
    expect(b.chain_segment_id).toBe('other');
  });

  it('persisted JSONL contains operation_id only when set (skip when absent)', async () => {
    await emitWitnessEvent(log, baseInput); // no key
    await emitWitnessEvent(log, { ...baseInput, operationId: 'persisted-key' });
    const lines = readFileSync(join(dataDir, 'events', 'default.jsonl'), 'utf8')
      .split('\n')
      .filter((l) => l.trim());
    expect(lines).toHaveLength(2);
    const e0 = JSON.parse(lines[0]!) as { operation_id?: string };
    const e1 = JSON.parse(lines[1]!) as { operation_id?: string };
    expect('operation_id' in e0).toBe(false);
    expect('operation_id' in e1).toBe(true);
    expect(e1.operation_id).toBe('persisted-key');
  });
});
