/**
 * `witseal exec-file` — mediated execution of a file_write action.
 *
 * The file analogue of `runExec` (src/cli/exec.ts): it drives the SAME
 * end-to-end pipeline for a `file_write` intent —
 *   intent → classify → evaluate policy → (optional approval) → mediateFile →
 *   witness → receipt → chain advance
 * — reusing the existing `ExecutionResult` / witness schemas (no new
 * wire-format). The only differences from `runExec` are (a) the intent is a
 * `file_write` instead of a `shell_command`, and (b) the mediator is
 * `mediateFile` instead of `mediateShell`. Everything downstream (policy,
 * approval, recovery, emit, outcome) is identical.
 *
 * Content is supplied as bytes by the caller; `runFileExec` computes
 * `content_hash` / `content_size_bytes` for the intent, and `mediateFile`
 * re-validates them before any write.
 *
 * Fail-closed semantics (P0-4) and Gate/Witness mode routing match `runExec`.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { classify, CLASSIFIER_VERSION } from '../risk/classifier.js';
import { PolicyEngine } from '../policy/engine.js';
import { applyConstraint, type ExecutionMode } from '../policy/enforcement.js';
import { EventLog } from '../witness/event-log.js';
import {
  emitExecutionComplete,
  emitIntentRecorded,
  emitWitnessEvent,
  generateIntentId,
} from '../witness/emit.js';
import { runRecoveryIfNeeded } from '../witness/recovery.js';
import { mediateFile } from '../execution/mediator.js';
import { obtainApproval } from './approval.js';
import { ENV_UNSAFE_ALLOW_NO_POLICY } from './exec.js';
import type { ClassifiedIntent } from '../../schemas/intent.schema.js';
import type { ExecutionResult } from '../../schemas/execution-result.schema.js';
import type { WitnessOutcome } from '../../schemas/witness-event.schema.js';
import type { PolicyDecision } from '../../schemas/policy.schema.js';

/** Exit code for any denial path. Matches `runExec` (EXIT_DENIED). */
const EXIT_DENIED = 100;

export type FileWriteMode = 'overwrite' | 'append' | 'create_only';

export interface FileExecOptions {
  /** Target file path. */
  path: string;
  /** The exact bytes to write. Hash/size are derived from this. */
  content: Buffer;
  /** Write mode. Default `overwrite`. */
  writeMode?: FileWriteMode;
  agentId: string;
  identityOrigin?: 'configured' | 'fallback';
  dataDir: string;
  segmentId: string;
  /** Gate (default, deny-by-default) or witness. Matches `runExec`. */
  mode?: ExecutionMode;
}

export async function runFileExec(opts: FileExecOptions): Promise<number> {
  const mode: ExecutionMode = opts.mode ?? 'gate';
  const writeMode: FileWriteMode = opts.writeMode ?? 'overwrite';
  const bytes = opts.content;

  // 0. Recovery (identical to runExec): heal an abandoned `pending` tail.
  {
    const recoveryLog = new EventLog({ root: opts.dataDir, segmentId: opts.segmentId });
    const recovered = await runRecoveryIfNeeded(recoveryLog);
    if (recovered) {
      process.stderr.write(
        `witseal: recovered abandoned intent_recorded event ` +
          `${recovered.intent_recorded_event_id ?? '<unknown>'} as ` +
          `execution_lost ${recovered.event_id}\n`
      );
    }
  }

  // 1. Build the file_write intent (existing schema; no new wire-format).
  const intent: ClassifiedIntent['intent'] = {
    action_type: 'file_write',
    path: opts.path,
    content_hash: createHash('sha256').update(bytes).digest('hex'),
    content_size_bytes: bytes.length,
    mode: writeMode,
  };

  // 2. Classify
  const { risk_class, reasons } = classify(intent);
  const classifiedIntent: ClassifiedIntent = {
    schema_version: 'witseal.intent.v0.1',
    intent_id: generateIntentId(),
    intent,
    risk_class,
    classification_reasons: reasons,
    classifier_version: CLASSIFIER_VERSION,
  };

  // 3. Load policy packs (identical fail-closed logic to runExec/P0-4).
  const engine = new PolicyEngine();
  const policyDir = join(opts.dataDir, 'policy-packs');
  let packsLoaded = 0;
  if (existsSync(policyDir)) {
    for (const file of readdirSync(policyDir)) {
      if (file.endsWith('.json')) {
        engine.loadPackFromFile(join(policyDir, file));
        packsLoaded++;
      }
    }
  }

  const noPolicyLoaded = packsLoaded === 0;
  const noPolicyEscapeActive =
    noPolicyLoaded && process.env[ENV_UNSAFE_ALLOW_NO_POLICY] === '1';
  const noPolicyWitness = noPolicyLoaded && mode === 'witness';
  const noPolicyProceed = noPolicyEscapeActive || noPolicyWitness;

  if (noPolicyLoaded && !noPolicyProceed) {
    const eventLog = new EventLog({ root: opts.dataDir, segmentId: opts.segmentId });
    const noPolicyDecision: PolicyDecision = {
      schema_version: 'witseal.policy.v0.1',
      outcome: 'deny',
      matched_rule: null,
      reason:
        `no policy packs configured at ${policyDir}; runtime fails closed (P0-4). ` +
        `Set ${ENV_UNSAFE_ALLOW_NO_POLICY}=1 to proceed in advisory-only mode.`,
      active_pack_hashes: [],
    };
    const event = await emitWitnessEvent(eventLog, {
      classifiedIntent,
      policyDecision: noPolicyDecision,
      approval: null,
      executionResult: null,
      outcome: 'no_policy_configured',
      agentIdentifier: opts.agentId,
      ...(opts.identityOrigin !== undefined ? { identityOrigin: opts.identityOrigin } : {}),
      classifierVersion: CLASSIFIER_VERSION,
    });
    process.stderr.write(
      `witseal: no policy packs configured at ${policyDir}; runtime fails closed. ` +
        `Set ${ENV_UNSAFE_ALLOW_NO_POLICY}=1 to proceed in advisory-only mode. ` +
        `(event ${event.event_id})\n`
    );
    return EXIT_DENIED;
  }

  if (noPolicyEscapeActive) {
    process.stderr.write(
      `witseal: WARNING: ${ENV_UNSAFE_ALLOW_NO_POLICY}=1 — no policy packs ` +
        `configured at ${policyDir}; proceeding in advisory-only mode. ` +
        `Witness event will be marked outcome=no_policy_configured.\n`
    );
  }

  const decision = engine.evaluate(classifiedIntent);
  const constraint = applyConstraint(decision, mode);

  // 4. Approval — Gate Mode only (identical to runExec).
  let approval = null;
  if (mode === 'gate' && decision.outcome === 'require-approval') {
    approval = await obtainApproval(classifiedIntent, decision);
    if (approval.outcome !== 'approved') {
      const eventLog = new EventLog({ root: opts.dataDir, segmentId: opts.segmentId });
      const event = await emitWitnessEvent(eventLog, {
        classifiedIntent,
        policyDecision: decision,
        approval,
        executionResult: null,
        outcome: 'denied_by_approval',
        agentIdentifier: opts.agentId,
        ...(opts.identityOrigin !== undefined ? { identityOrigin: opts.identityOrigin } : {}),
        classifierVersion: CLASSIFIER_VERSION,
      });
      process.stderr.write(`witseal: action denied by approval (event ${event.event_id})\n`);
      return EXIT_DENIED;
    }
  }

  // 5. Constraint block — Gate blocks a `deny` here (identical to runExec).
  if (constraint.block) {
    const eventLog = new EventLog({ root: opts.dataDir, segmentId: opts.segmentId });
    const event = await emitWitnessEvent(eventLog, {
      classifiedIntent,
      policyDecision: decision,
      approval: null,
      executionResult: null,
      outcome: 'denied_by_policy',
      agentIdentifier: opts.agentId,
      ...(opts.identityOrigin !== undefined ? { identityOrigin: opts.identityOrigin } : {}),
      classifierVersion: CLASSIFIER_VERSION,
    });
    process.stderr.write(
      `witseal: action denied by policy (rule ${decision.matched_rule?.rule_id ?? 'default'}, event ${event.event_id})\n` +
        `         reason: ${decision.reason}\n`
    );
    return EXIT_DENIED;
  }

  // 6a. Phase A: emit `intent_recorded` (pending) before the mediator runs.
  const eventLog = new EventLog({ root: opts.dataDir, segmentId: opts.segmentId });
  const intentRecorded = await emitIntentRecorded(eventLog, {
    classifiedIntent,
    policyDecision: decision,
    approval,
    executionResult: null,
    outcome: 'pending',
    agentIdentifier: opts.agentId,
    ...(opts.identityOrigin !== undefined ? { identityOrigin: opts.identityOrigin } : {}),
    classifierVersion: CLASSIFIER_VERSION,
  });

  // 6b. Execute the file write via the existing mediateFile primitive.
  const execResult: ExecutionResult = await mediateFile(
    intent as Extract<ClassifiedIntent['intent'], { action_type: 'file_write' }>,
    { content: bytes }
  );

  // 7. Determine outcome (identical logic to runExec).
  const outcome: WitnessOutcome = noPolicyProceed
    ? 'no_policy_configured'
    : computeOutcome(decision.outcome, approval !== null, execResult, mode);

  // 8. Phase B: emit `execution_complete`, referencing the Phase A pending.
  const event = await emitExecutionComplete(
    eventLog,
    {
      classifiedIntent,
      policyDecision: decision,
      approval,
      executionResult: execResult,
      outcome,
      agentIdentifier: opts.agentId,
      ...(opts.identityOrigin !== undefined ? { identityOrigin: opts.identityOrigin } : {}),
      classifierVersion: CLASSIFIER_VERSION,
    },
    intentRecorded.event_id
  );

  // 9. Surface the mediator's summary (head) + any spawn_error to stderr.
  if (execResult.stdout.head) process.stderr.write(execResult.stdout.head);
  if (execResult.spawn_error) {
    process.stderr.write(`witseal: file write failed: ${execResult.spawn_error}\n`);
  }

  // 10. Witness footer (stderr).
  process.stderr.write(
    `\n[witseal: event=${event.event_id} receipt=${event.receipt_id} risk=${classifiedIntent.risk_class} outcome=${outcome}]\n`
  );

  return execResult.exit_code === -1 ? 1 : execResult.exit_code;
}

function computeOutcome(
  policyOutcome: 'allow' | 'deny' | 'require-approval',
  approved: boolean,
  result: ExecutionResult,
  mode: ExecutionMode
): WitnessOutcome {
  const hadError = result.exit_code !== 0 || result.spawn_error !== null;
  if (policyOutcome === 'allow') {
    return hadError ? 'allowed_executed_with_error' : 'allowed_executed';
  }
  if (mode === 'witness') {
    return hadError ? 'witnessed_executed_with_error' : 'witnessed_executed';
  }
  if (approved) {
    return hadError ? 'approved_executed_with_error' : 'approved_executed';
  }
  return 'denied_by_policy';
}
