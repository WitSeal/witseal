/**
 * Branch closure: src/witness/emit.ts:61 — `hostname() || 'local'` fallback.
 *
 * The fallback fires when `os.hostname()` returns a falsy value. On real
 * hosts this is virtually unreachable, so we mock the whole `node:os`
 * module (preserving every other export via `vi.importActual`) and replace
 * `hostname` with one that returns the empty string. The rest of the emit
 * pipeline runs normally; we only assert that `originating_node === 'local'`.
 *
 * Isolated in its own test file so the module-scope mock does not bleed
 * into the main emit suite.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, hostname: () => '' };
});

import { EventLog } from '../src/witness/event-log.js';
import { emitWitnessEvent, generateIntentId } from '../src/witness/emit.js';
import type { ClassifiedIntent } from '../schemas/intent.schema.js';
import type { PolicyDecision } from '../schemas/policy.schema.js';

describe('emitWitnessEvent — originating_node fallback', () => {
  let dataDir: string;
  let eventLog: EventLog;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'witseal-emit-hostname-'));
    eventLog = new EventLog({ root: dataDir, segmentId: 'default' });
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("falls back to 'local' when hostname() returns empty", async () => {
    const classifiedIntent: ClassifiedIntent = {
      schema_version: 'witseal.intent.v0.1',
      intent_id: generateIntentId(),
      intent: {
        action_type: 'shell_command',
        executable: '/bin/echo',
        args: ['x'],
        cwd: '/tmp',
        use_tty: false,
      },
      risk_class: 'C0',
      classification_reasons: ['echo is informational'],
      classifier_version: 'test-1.0',
    };
    const policyDecision: PolicyDecision = {
      schema_version: 'witseal.policy.v0.1',
      outcome: 'allow',
      matched_rule: null,
      reason: 'default allow',
      active_pack_hashes: [],
    };

    const event = await emitWitnessEvent(eventLog, {
      classifiedIntent,
      policyDecision,
      approval: null,
      executionResult: null,
      outcome: 'allowed_executed',
      agentIdentifier: 'test-agent',
      classifierVersion: 'test-1.0',
    });

    expect(event.originating_node).toBe('local');
  });
});
