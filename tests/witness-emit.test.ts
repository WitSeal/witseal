/**
 * Tests for src/witness/emit.ts.
 *
 * Verifies witness event construction, ID generation, chain advancement
 * (sequence, previous_event_hash), self-hash validity, and that successive
 * emits produce a chain that passes verifyChain.
 *
 * These tests exercise the emit layer in isolation by writing to a fresh
 * tmpdir-backed EventLog per test; no subprocess or mediator involvement.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLog } from '../src/witness/event-log.js';
import {
  emitWitnessEvent,
  generateApprovalId,
  generateEventId,
  generateIntentId,
  generateReceiptId,
  WITNESS_SCHEMA_VERSION,
  WITSEAL_RUNTIME_VERSION,
  type EmitInput,
} from '../src/witness/emit.js';
import { verifyChain, verifyEventHash } from '../src/integrity/hash-chain.js';
import type { ClassifiedIntent } from '../schemas/intent.schema.js';
import type { PolicyDecision } from '../schemas/policy.schema.js';
import type { ExecutionResult } from '../schemas/execution-result.schema.js';
import type { ApprovalRecord } from '../schemas/approval.schema.js';

function makeClassifiedIntent(overrides: Partial<ClassifiedIntent> = {}): ClassifiedIntent {
  return {
    schema_version: 'witseal.intent.v0.1',
    intent_id: generateIntentId(),
    intent: {
      action_type: 'shell_command',
      executable: '/bin/echo',
      args: ['hello'],
      cwd: '/tmp',
      use_tty: false,
    },
    risk_class: 'C0',
    classification_reasons: ['echo is informational'],
    classifier_version: 'test-1.0',
    ...overrides,
  };
}

function makePolicyDecision(overrides: Partial<PolicyDecision> = {}): PolicyDecision {
  return {
    schema_version: 'witseal.policy.v0.1',
    outcome: 'allow',
    matched_rule: null,
    reason: 'default allow',
    active_pack_hashes: [],
    ...overrides,
  };
}

function makeExecutionResult(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    schema_version: 'witseal.execution.v0.1',
    started_at: '2026-05-18T09:00:00Z',
    finished_at: '2026-05-18T09:00:01Z',
    exit_code: 0,
    signal: null,
    stdout: {
      total_bytes: 6,
      content_hash: 'a'.repeat(64),
      head: 'hello\n',
      tail: null,
      head_bytes: 6,
      tail_bytes: 0,
      truncated: false,
    },
    stderr: {
      total_bytes: 0,
      content_hash: 'b'.repeat(64),
      head: null,
      tail: null,
      head_bytes: 0,
      tail_bytes: 0,
      truncated: false,
    },
    executable_resolved: '/bin/echo',
    env_keys_hash: 'c'.repeat(64),
    spawn_error: null,
    ...overrides,
  };
}

function makeApproval(overrides: Partial<ApprovalRecord> = {}): ApprovalRecord {
  return {
    schema_version: 'witseal.approval.v0.1',
    approval_id: generateApprovalId(),
    intent_id: generateIntentId(),
    prompted_at: '2026-05-18T09:00:00Z',
    resolved_at: '2026-05-18T09:00:05Z',
    outcome: 'approved',
    principal: { type: 'human', identifier: 'tester' },
    timeout_seconds: 300,
    ...overrides,
  };
}

function makeEmitInput(overrides: Partial<EmitInput> = {}): EmitInput {
  return {
    classifiedIntent: makeClassifiedIntent(),
    policyDecision: makePolicyDecision(),
    approval: null,
    executionResult: makeExecutionResult(),
    outcome: 'allowed_executed',
    agentIdentifier: 'test-agent',
    classifierVersion: 'test-1.0',
    ...overrides,
  };
}

describe('emitWitnessEvent — construction', () => {
  let dataDir: string;
  let eventLog: EventLog;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'witseal-emit-test-'));
    eventLog = new EventLog({ root: dataDir, segmentId: 'default' });
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('returns a witness event with all required fields populated', async () => {
    const event = await emitWitnessEvent(eventLog, makeEmitInput());

    expect(event.schema_version).toBe(WITNESS_SCHEMA_VERSION);
    expect(event.event_id).toMatch(/^evt_[0-9a-zA-Z]{20,}$/);
    expect(event.receipt_id).toMatch(/^rcpt_[0-9a-zA-Z]{20,}$/);
    expect(event.event_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(event.chain_segment_id).toBe('default');
    expect(event.sequence).toBe(0);
    expect(event.previous_event_hash).toBe(null);
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(event.outcome).toBe('allowed_executed');
    expect(event.agent_identifier).toBe('test-agent');
  });

  it('preserves classified_intent verbatim', async () => {
    const classifiedIntent = makeClassifiedIntent({ risk_class: 'C3' });
    const event = await emitWitnessEvent(eventLog, makeEmitInput({ classifiedIntent }));
    expect(event.classified_intent).toEqual(classifiedIntent);
  });

  it('preserves policy_decision verbatim', async () => {
    const policyDecision = makePolicyDecision({
      outcome: 'require-approval',
      reason: 'high-risk action',
    });
    const event = await emitWitnessEvent(eventLog, makeEmitInput({ policyDecision }));
    expect(event.policy_decision).toEqual(policyDecision);
  });

  it('preserves approval record when provided', async () => {
    const approval = makeApproval({ outcome: 'approved' });
    const event = await emitWitnessEvent(
      eventLog,
      makeEmitInput({ approval, outcome: 'approved_executed' })
    );
    expect(event.approval).toEqual(approval);
  });

  it('records null approval when none provided', async () => {
    const event = await emitWitnessEvent(eventLog, makeEmitInput({ approval: null }));
    expect(event.approval).toBe(null);
  });

  it('preserves execution_result when execution proceeded', async () => {
    const executionResult = makeExecutionResult({ exit_code: 42 });
    const event = await emitWitnessEvent(
      eventLog,
      makeEmitInput({ executionResult, outcome: 'allowed_executed_with_error' })
    );
    expect(event.execution_result).toEqual(executionResult);
  });

  it('records null execution_result for denial paths', async () => {
    const event = await emitWitnessEvent(
      eventLog,
      makeEmitInput({ executionResult: null, outcome: 'denied_by_policy' })
    );
    expect(event.execution_result).toBe(null);
  });

  it('populates versions block with runtime + classifier + schema', async () => {
    const event = await emitWitnessEvent(
      eventLog,
      makeEmitInput({ classifierVersion: 'classifier-v9' })
    );
    expect(event.versions).toEqual({
      witseal_runtime: WITSEAL_RUNTIME_VERSION,
      classifier: 'classifier-v9',
      schema: WITNESS_SCHEMA_VERSION,
    });
  });

  it('sets originating_node to a non-empty string (hostname or "local")', async () => {
    const event = await emitWitnessEvent(eventLog, makeEmitInput());
    expect(event.originating_node).toBeTypeOf('string');
    expect(event.originating_node.length).toBeGreaterThan(0);
  });

  it('produces a self-consistent event_hash', async () => {
    const event = await emitWitnessEvent(eventLog, makeEmitInput());
    expect(verifyEventHash(event)).toBe(true);
  });
});

describe('emitWitnessEvent — chain advancement', () => {
  let dataDir: string;
  let eventLog: EventLog;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'witseal-emit-chain-'));
    eventLog = new EventLog({ root: dataDir, segmentId: 'default' });
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('first emit has sequence=0 and previous_event_hash=null', async () => {
    const event = await emitWitnessEvent(eventLog, makeEmitInput());
    expect(event.sequence).toBe(0);
    expect(event.previous_event_hash).toBe(null);
  });

  it('second emit has sequence=1 and previous_event_hash=first.event_hash', async () => {
    const first = await emitWitnessEvent(eventLog, makeEmitInput());
    const second = await emitWitnessEvent(eventLog, makeEmitInput());
    expect(second.sequence).toBe(1);
    expect(second.previous_event_hash).toBe(first.event_hash);
  });

  it('builds a valid chain across multiple emits', async () => {
    const emitted = [];
    for (let i = 0; i < 5; i++) {
      emitted.push(await emitWitnessEvent(eventLog, makeEmitInput()));
    }
    const persisted = await eventLog.readAllEvents();
    expect(persisted).toHaveLength(5);
    expect(persisted.map((e) => e.event_hash)).toEqual(emitted.map((e) => e.event_hash));
    const result = verifyChain(persisted);
    expect(result.valid).toBe(true);
    expect(result.chainHeadAfter).toBe(emitted[4]!.event_hash);
  });

  it('persists each emitted event to disk under exclusive lock', async () => {
    const event = await emitWitnessEvent(eventLog, makeEmitInput());
    const fresh = new EventLog({ root: dataDir, segmentId: 'default' });
    const readBack = await fresh.readAllEvents();
    expect(readBack).toHaveLength(1);
    expect(readBack[0]).toEqual(event);
  });

  it('updates chain head sequence after each emit', async () => {
    expect(eventLog.readChainHead()).toEqual({ head: null, sequence: 0 });
    const first = await emitWitnessEvent(eventLog, makeEmitInput());
    expect(eventLog.readChainHead()).toEqual({ head: first.event_hash, sequence: 1 });
    const second = await emitWitnessEvent(eventLog, makeEmitInput());
    expect(eventLog.readChainHead()).toEqual({ head: second.event_hash, sequence: 2 });
  });
});

describe('emitWitnessEvent — outcome coverage', () => {
  let dataDir: string;
  let eventLog: EventLog;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'witseal-emit-outcomes-'));
    eventLog = new EventLog({ root: dataDir, segmentId: 'default' });
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it.each([
    'allowed_executed',
    'allowed_executed_with_error',
    'approved_executed',
    'approved_executed_with_error',
    'denied_by_policy',
    'denied_by_approval',
    'denied_by_classification_failure',
  ] as const)('accepts outcome=%s', async (outcome) => {
    const isDenial = outcome.startsWith('denied_');
    const event = await emitWitnessEvent(
      eventLog,
      makeEmitInput({
        outcome,
        executionResult: isDenial ? null : makeExecutionResult(),
        approval: outcome.startsWith('approved_') ? makeApproval() : null,
      })
    );
    expect(event.outcome).toBe(outcome);
    expect(verifyEventHash(event)).toBe(true);
  });
});

describe('id generators', () => {
  it('generateEventId produces evt_ prefixed IDs matching the schema regex', () => {
    for (let i = 0; i < 10; i++) {
      const id = generateEventId();
      expect(id).toMatch(/^evt_[0-9a-zA-Z]{20,}$/);
    }
  });

  it('generateReceiptId produces rcpt_ prefixed IDs matching the schema regex', () => {
    for (let i = 0; i < 10; i++) {
      const id = generateReceiptId();
      expect(id).toMatch(/^rcpt_[0-9a-zA-Z]{20,}$/);
    }
  });

  it('generateIntentId produces int_ prefixed IDs matching the schema regex', () => {
    for (let i = 0; i < 10; i++) {
      const id = generateIntentId();
      expect(id).toMatch(/^int_[0-9a-zA-Z]{20,}$/);
    }
  });

  it('generateApprovalId produces apr_ prefixed IDs matching the schema regex', () => {
    for (let i = 0; i < 10; i++) {
      const id = generateApprovalId();
      expect(id).toMatch(/^apr_[0-9a-zA-Z]{20,}$/);
    }
  });

  it('generates unique IDs across many invocations', () => {
    const eventIds = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      eventIds.add(generateEventId());
    }
    expect(eventIds.size).toBe(1000);
  });
});

describe('emitWitnessEvent — chain segment isolation', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'witseal-emit-segments-'));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('events written to one segment do not appear in another', async () => {
    const segA = new EventLog({ root: dataDir, segmentId: 'default' });
    const segB = new EventLog({ root: dataDir, segmentId: 'other' });

    await emitWitnessEvent(segA, makeEmitInput());
    await emitWitnessEvent(segA, makeEmitInput());
    await emitWitnessEvent(segB, makeEmitInput());

    const eventsA = await segA.readAllEvents();
    const eventsB = await segB.readAllEvents();
    expect(eventsA).toHaveLength(2);
    expect(eventsB).toHaveLength(1);
  });

  it('both segments start with sequence=0 independently', async () => {
    const segA = new EventLog({ root: dataDir, segmentId: 'default' });
    const segB = new EventLog({ root: dataDir, segmentId: 'other' });

    const a = await emitWitnessEvent(segA, makeEmitInput());
    const b = await emitWitnessEvent(segB, makeEmitInput());

    expect(a.sequence).toBe(0);
    expect(b.sequence).toBe(0);
  });

  // P0-5 (runtime-boundary audit 2026-05-25): the CLI `--segment` flag must
  // propagate into the persisted WitnessEvent's `chain_segment_id`. Before the
  // fix, emit.ts hardcoded `chain_segment_id: 'default'` so any non-default
  // segment was silently mis-stamped.

  it('stamps chain_segment_id from the EventLog instance (default segment)', async () => {
    const log = new EventLog({ root: dataDir, segmentId: 'default' });
    const ev = await emitWitnessEvent(log, makeEmitInput());
    expect(ev.chain_segment_id).toBe('default');
  });

  it('stamps chain_segment_id from a non-default segment (P0-5 traceability)', async () => {
    const log = new EventLog({ root: dataDir, segmentId: 'forensic-2026-05-25' });
    const ev = await emitWitnessEvent(log, makeEmitInput());
    expect(ev.chain_segment_id).toBe('forensic-2026-05-25');
  });

  it('persisted events carry the segment id verbatim across read-back', async () => {
    const segC = new EventLog({ root: dataDir, segmentId: 'incident-abc' });
    await emitWitnessEvent(segC, makeEmitInput());
    await emitWitnessEvent(segC, makeEmitInput());
    const fresh = new EventLog({ root: dataDir, segmentId: 'incident-abc' });
    const back = await fresh.readAllEvents();
    expect(back).toHaveLength(2);
    expect(back.every((e) => e.chain_segment_id === 'incident-abc')).toBe(true);
  });

  it('EventLog.segmentId getter exposes the segment for emitter use', () => {
    const log = new EventLog({ root: dataDir, segmentId: 'getter-test' });
    expect(log.segmentId).toBe('getter-test');
  });
});
