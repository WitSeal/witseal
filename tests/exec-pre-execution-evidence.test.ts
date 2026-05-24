/**
 * P0-1 — pre-execution evidence + execution_lost recovery.
 *
 * Runtime-boundary audit 2026-05-25 finding TS-P0-1: prior pipeline emitted
 * a single witness event AFTER mediateShell returned. A crash between the
 * spawn and the post-exec emit left no chain entry for an action that
 * actually ran. The two-phase fix (RFC-001 §6.3a/§9.2) emits
 * `intent_recorded` (outcome=pending) BEFORE the mediator runs and
 * `execution_complete` AFTER; an unpaired `pending` at the chain tail is
 * recovered as `execution_lost` on the next runExec invocation.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runExec } from '../src/cli/exec.js';
import { EventLog } from '../src/witness/event-log.js';
import {
  emitIntentRecorded,
  generateIntentId,
  WITSEAL_RUNTIME_VERSION,
} from '../src/witness/emit.js';
import { runRecoveryIfNeeded } from '../src/witness/recovery.js';
import type { ClassifiedIntent } from '../schemas/intent.schema.js';
import type { PolicyDecision } from '../schemas/policy.schema.js';
import type { WitnessEvent } from '../schemas/witness-event.schema.js';

let dataDir: string;

function writeAllowPack(): void {
  const policyDir = join(dataDir, 'policy-packs');
  mkdirSync(policyDir, { recursive: true });
  writeFileSync(
    join(policyDir, 'allow-pack.json'),
    JSON.stringify({
      schema_version: 'witseal.policy.v0.1',
      pack_id: 'allow-everything',
      version: '1.0.0',
      description: 'P0-1 test pack: allow informational shell',
      rules: [
        {
          id: 'allow-all-shell',
          match: { action_type: 'shell_command' },
          decision: 'allow',
          reason: 'allow for P0-1 test',
        },
      ],
      default_decision: 'deny',
    })
  );
}

function writeDenyPack(): void {
  const policyDir = join(dataDir, 'policy-packs');
  mkdirSync(policyDir, { recursive: true });
  writeFileSync(
    join(policyDir, 'deny-pack.json'),
    JSON.stringify({
      schema_version: 'witseal.policy.v0.1',
      pack_id: 'deny-everything',
      version: '1.0.0',
      description: 'P0-1 test pack: deny all shell',
      rules: [
        {
          id: 'deny-all-shell',
          match: { action_type: 'shell_command' },
          decision: 'deny',
          reason: 'deny for P0-1 test',
        },
      ],
      default_decision: 'deny',
    })
  );
}

function silenceOutput(): { restore: () => void } {
  const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  return {
    restore: () => {
      stderrSpy.mockRestore();
      stdoutSpy.mockRestore();
    },
  };
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'witseal-pre-exec-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Pre-execution evidence persistence (the core P0-1 contract)
// ---------------------------------------------------------------------------

describe('runExec — two-phase pre-execution evidence (P0-1)', () => {
  it('persists intent_recorded BEFORE execution_complete', async () => {
    writeAllowPack();
    const out = silenceOutput();
    try {
      await runExec({
        command: '/bin/echo',
        args: ['p0-1-happy'],
        agentId: 'p0-1-test',
        cwd: '/tmp',
        timeoutMs: 0,
        dataDir,
        segmentId: 'default',
      });
    } finally {
      out.restore();
    }
    const log = new EventLog({ root: dataDir, segmentId: 'default' });
    const events = await log.readAllEvents();
    expect(events).toHaveLength(2);
    expect(events[0]!.outcome).toBe('pending');
    expect(events[0]!.execution_result).toBeNull();
    expect(events[1]!.outcome).toBe('allowed_executed');
    expect(events[1]!.execution_result).not.toBeNull();
    // Sequence + linkage hold.
    expect(events[0]!.sequence).toBe(0);
    expect(events[1]!.sequence).toBe(1);
    expect(events[1]!.previous_event_hash).toBe(events[0]!.event_hash);
    expect(events[1]!.intent_recorded_event_id).toBe(events[0]!.event_id);
  });

  it('intent_recorded copies classified_intent + policy_decision verbatim', async () => {
    writeAllowPack();
    const out = silenceOutput();
    try {
      await runExec({
        command: '/bin/echo',
        args: ['fixture'],
        agentId: 'p0-1-test',
        cwd: '/tmp',
        timeoutMs: 0,
        dataDir,
        segmentId: 'default',
      });
    } finally {
      out.restore();
    }
    const events = await new EventLog({ root: dataDir, segmentId: 'default' }).readAllEvents();
    // intent_recorded captures what the mediator was about to attempt.
    expect(events[0]!.classified_intent.intent.action_type).toBe('shell_command');
    expect(events[1]!.classified_intent.intent.action_type).toBe('shell_command');
    expect(events[0]!.classified_intent).toEqual(events[1]!.classified_intent);
    expect(events[0]!.policy_decision).toEqual(events[1]!.policy_decision);
  });
});

// ---------------------------------------------------------------------------
// Denial paths do NOT trip the two-phase split (action never executed)
// ---------------------------------------------------------------------------

describe('runExec — denial paths do not execute and do not emit intent_recorded', () => {
  it('policy deny → single denied_by_policy event, no intent_recorded', async () => {
    writeDenyPack();
    const out = silenceOutput();
    try {
      const exit = await runExec({
        command: '/bin/echo',
        args: ['should-not-run'],
        agentId: 'p0-1-test',
        cwd: '/tmp',
        timeoutMs: 0,
        dataDir,
        segmentId: 'default',
      });
      expect(exit).toBe(100);
    } finally {
      out.restore();
    }
    const events = await new EventLog({ root: dataDir, segmentId: 'default' }).readAllEvents();
    // Denial does not go through the two-phase split: a single witness event
    // records the deny decision. No pending event exists for the chain.
    expect(events).toHaveLength(1);
    expect(events[0]!.outcome).toBe('denied_by_policy');
    expect(events.some((e) => e.outcome === 'pending')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Spawn-error / failed execution is captured
// ---------------------------------------------------------------------------

describe('runExec — spawn errors are recorded under the two-phase split', () => {
  it('intent_recorded persists even when mediateShell hits ENOENT', async () => {
    writeAllowPack();
    const out = silenceOutput();
    try {
      await runExec({
        command: '/no/such/binary',
        args: [],
        agentId: 'p0-1-test',
        cwd: '/tmp',
        timeoutMs: 0,
        dataDir,
        segmentId: 'default',
      });
    } finally {
      out.restore();
    }
    const events = await new EventLog({ root: dataDir, segmentId: 'default' }).readAllEvents();
    // The intent_recorded is committed BEFORE the spawn attempt — its
    // presence proves the chain captured the action regardless of whether
    // the executable existed.
    expect(events).toHaveLength(2);
    expect(events[0]!.outcome).toBe('pending');
    expect(events[1]!.execution_result?.spawn_error).not.toBeNull();
    expect(events[1]!.outcome).toMatch(/allowed_executed_with_error|allowed_executed/);
    expect(events[1]!.intent_recorded_event_id).toBe(events[0]!.event_id);
  });
});

// ---------------------------------------------------------------------------
// Recovery: unpaired pending tail → execution_lost on next runExec
// ---------------------------------------------------------------------------

describe('runExec — execution_lost recovery (P0-1 / RFC-001 §9.2)', () => {
  function makeClassifiedIntent(): ClassifiedIntent {
    return {
      schema_version: 'witseal.intent.v0.1',
      intent_id: generateIntentId(),
      intent: {
        action_type: 'shell_command',
        executable: '/bin/echo',
        args: ['abandoned'],
        cwd: '/tmp',
        use_tty: false,
      },
      risk_class: 'C0',
      classification_reasons: ['informational'],
      classifier_version: 'p0-1-test-1.0',
    };
  }

  function makeAllowDecision(): PolicyDecision {
    return {
      schema_version: 'witseal.policy.v0.1',
      outcome: 'allow',
      matched_rule: null,
      reason: 'allow for recovery test',
      active_pack_hashes: [],
    };
  }

  it('writes an unpaired pending → next runExec emits execution_lost referencing it', async () => {
    // Stage an abandoned pending event directly through emitIntentRecorded.
    const log = new EventLog({ root: dataDir, segmentId: 'default' });
    const abandoned: WitnessEvent = await emitIntentRecorded(log, {
      classifiedIntent: makeClassifiedIntent(),
      policyDecision: makeAllowDecision(),
      approval: null,
      executionResult: null,
      outcome: 'pending',
      agentIdentifier: 'p0-1-recovery',
      classifierVersion: 'p0-1-test-1.0',
    });
    // Chain tail is now a `pending` event with no successor — exactly the
    // mid-flight crash signature.

    writeAllowPack();
    const out = silenceOutput();
    try {
      await runExec({
        command: '/bin/echo',
        args: ['post-recovery'],
        agentId: 'p0-1-next-run',
        cwd: '/tmp',
        timeoutMs: 0,
        dataDir,
        segmentId: 'default',
      });
    } finally {
      out.restore();
    }
    const events = await new EventLog({ root: dataDir, segmentId: 'default' }).readAllEvents();
    // Expect:
    //   0 — abandoned pending (already there)
    //   1 — execution_lost referencing abandoned
    //   2 — fresh pending for the new runExec
    //   3 — fresh execution_complete (allowed_executed)
    expect(events).toHaveLength(4);
    expect(events[0]!.event_id).toBe(abandoned.event_id);
    expect(events[0]!.outcome).toBe('pending');
    expect(events[1]!.outcome).toBe('execution_lost');
    expect(events[1]!.intent_recorded_event_id).toBe(abandoned.event_id);
    expect(events[1]!.execution_result).toBeNull();
    expect(events[2]!.outcome).toBe('pending');
    expect(events[3]!.outcome).toBe('allowed_executed');
    expect(events[3]!.intent_recorded_event_id).toBe(events[2]!.event_id);
  });

  it('execution_lost copies classified_intent and policy_decision from the abandoned pending', async () => {
    const log = new EventLog({ root: dataDir, segmentId: 'default' });
    const intent = makeClassifiedIntent();
    const decision = makeAllowDecision();
    const abandoned = await emitIntentRecorded(log, {
      classifiedIntent: intent,
      policyDecision: decision,
      approval: null,
      executionResult: null,
      outcome: 'pending',
      agentIdentifier: 'p0-1-recovery',
      classifierVersion: 'p0-1-test-1.0',
    });
    void abandoned;

    const recovered = await runRecoveryIfNeeded(log);
    expect(recovered).not.toBeNull();
    expect(recovered!.outcome).toBe('execution_lost');
    expect(recovered!.classified_intent).toEqual(intent);
    expect(recovered!.policy_decision).toEqual(decision);
    expect(recovered!.execution_result).toBeNull();
  });

  it('runRecoveryIfNeeded is a no-op on healthy chains', async () => {
    // Chain with a pending+complete pair (healthy) — recovery must not emit.
    writeAllowPack();
    const out = silenceOutput();
    try {
      await runExec({
        command: '/bin/echo',
        args: ['ok'],
        agentId: 'p0-1-test',
        cwd: '/tmp',
        timeoutMs: 0,
        dataDir,
        segmentId: 'default',
      });
    } finally {
      out.restore();
    }
    const log = new EventLog({ root: dataDir, segmentId: 'default' });
    const before = await log.readAllEvents();
    expect(before).toHaveLength(2);

    const recovered = await runRecoveryIfNeeded(log);
    expect(recovered).toBeNull();

    const after = await log.readAllEvents();
    expect(after).toHaveLength(2);
  });

  it('runRecoveryIfNeeded is a no-op on an empty chain', async () => {
    const log = new EventLog({ root: dataDir, segmentId: 'default' });
    const recovered = await runRecoveryIfNeeded(log);
    expect(recovered).toBeNull();
    const events = await log.readAllEvents();
    expect(events).toHaveLength(0);
  });

  it('a second runRecoveryIfNeeded does not emit a duplicate execution_lost', async () => {
    // First recovery emits; second sees a non-pending tail and bails.
    const log = new EventLog({ root: dataDir, segmentId: 'default' });
    await emitIntentRecorded(log, {
      classifiedIntent: makeClassifiedIntent(),
      policyDecision: makeAllowDecision(),
      approval: null,
      executionResult: null,
      outcome: 'pending',
      agentIdentifier: 'p0-1-recovery',
      classifierVersion: 'p0-1-test-1.0',
    });
    const first = await runRecoveryIfNeeded(log);
    expect(first).not.toBeNull();
    const second = await runRecoveryIfNeeded(log);
    expect(second).toBeNull();
    const events = await log.readAllEvents();
    expect(events.filter((e) => e.outcome === 'execution_lost')).toHaveLength(1);
  });
});

// Avoid unused-import warnings when constants are referenced indirectly.
void WITSEAL_RUNTIME_VERSION;
