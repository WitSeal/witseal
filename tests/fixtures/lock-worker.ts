/**
 * Cross-process ChainLock test worker — NOT a test file (no `.test` suffix, so
 * vitest does not collect it). Spawned by `tests/lock-concurrency.test.ts` to
 * exercise the lockfile shim across real OS processes.
 *
 * Modes:
 *   <lockPath> <dataPath> increment <M>
 *     — M times: under the chain lock, read-modify-write an integer counter at
 *       <dataPath> (+1). Lost updates ⟹ final count < N*M ⟹ broken exclusion.
 *
 *   <lockPath> <dataPath> hold
 *     — acquire the exclusive lock, write "HELD" to <dataPath>, then block
 *       (~60s) holding it until killed. Tests crash recovery + live no-steal.
 *
 *   <rootDir> <rootDir> chain <M>
 *     — emit M real witness events into the EventLog rooted at <rootDir>
 *       (segment "default"). N such workers prove the chain stays intact under
 *       cross-process contention (exact count, contiguous sequence, valid
 *       hash-chain, consistent head-cache).
 */
import { ChainLock } from '../../src/integrity/lock.js';
import { EventLog } from '../../src/witness/event-log.js';
import { emitWitnessEvent, generateIntentId } from '../../src/witness/emit.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { ClassifiedIntent } from '../../schemas/intent.schema.js';
import type { PolicyDecision } from '../../schemas/policy.schema.js';

const lockPath = process.argv[2]!;
const dataPath = process.argv[3]!;
const mode = process.argv[4]!;

function makeIntent(): ClassifiedIntent {
  return {
    schema_version: 'witseal.intent.v0.1',
    intent_id: generateIntentId(),
    intent: { action_type: 'shell_command', executable: '/bin/echo', args: ['x'], cwd: '/tmp', use_tty: false },
    risk_class: 'C0',
    classification_reasons: ['informational'],
    classifier_version: 'test-1.0',
  };
}

function makePolicy(): PolicyDecision {
  return {
    schema_version: 'witseal.policy.v0.1',
    outcome: 'deny',
    matched_rule: null,
    reason: 'test deny (no execution)',
    active_pack_hashes: [],
  };
}

if (mode === 'increment') {
  const m = parseInt(process.argv[5]!, 10);
  const lock = new ChainLock(lockPath);
  for (let i = 0; i < m; i++) {
    lock.withExclusive(() => {
      const n = existsSync(dataPath) ? parseInt(readFileSync(dataPath, 'utf8') || '0', 10) : 0;
      writeFileSync(dataPath, String(n + 1));
    });
  }
} else if (mode === 'hold') {
  const lock = new ChainLock(lockPath);
  lock.acquireExclusive();
  writeFileSync(dataPath, 'HELD'); // signal: lock acquired
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, 60_000); // hold until SIGKILLed
} else if (mode === 'chain') {
  const m = parseInt(process.argv[5]!, 10);
  const eventLog = new EventLog({ root: dataPath, segmentId: 'default' });
  await (async () => {
    for (let i = 0; i < m; i++) {
      await emitWitnessEvent(eventLog, {
        classifiedIntent: makeIntent(),
        policyDecision: makePolicy(),
        approval: null,
        executionResult: null,
        outcome: 'denied_by_policy',
        agentIdentifier: `worker-${process.pid}`,
        classifierVersion: 'test-1.0',
      });
    }
  })();
} else {
  process.stderr.write(`lock-worker: unknown mode '${mode}'\n`);
  process.exit(2);
}
