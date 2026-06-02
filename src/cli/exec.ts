/**
 * `witseal exec` — mediated execution of a shell command.
 *
 * End-to-end pipeline:
 *   intent → classify → evaluate policy → (optional approval) → execute → witness → receipt → chain advance
 *
 * P0-4 (runtime-boundary audit 2026-05-25): when no policy packs are loaded,
 * the runtime fails closed by default. The operator opts in to advisory-only
 * execution via `WITSEAL_UNSAFE_ALLOW_NO_POLICY=1`; the witness event still
 * carries `outcome=no_policy_configured` so evidence consumers can
 * distinguish "allowed by policy" from "ran without policy mediation".
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
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
import { mediateShell } from '../execution/mediator.js';
import { obtainApproval } from './approval.js';
import type { ClassifiedIntent } from '../../schemas/intent.schema.js';
import type { ExecutionResult } from '../../schemas/execution-result.schema.js';
import type { WitnessOutcome } from '../../schemas/witness-event.schema.js';
import type { PolicyDecision } from '../../schemas/policy.schema.js';

/**
 * Operator opt-in to proceed when no policy packs are loaded. Default
 * behavior is fail-closed; setting this to exactly `"1"` switches to
 * advisory-only mode where the action runs but the witness event still
 * carries `outcome=no_policy_configured` (NOT `allowed_executed`).
 */
export const ENV_UNSAFE_ALLOW_NO_POLICY = 'WITSEAL_UNSAFE_ALLOW_NO_POLICY';

/** Exit code for any denial path (policy, approval, classifier failure,
 *  no-policy fail-closed). Distinct from any plausible subprocess exit code. */
const EXIT_DENIED = 100;

export interface ExecOptions {
  command: string;
  args: string[];
  agentId: string;
  /**
   * Structured identity origin for `agentId`.
   * `'configured'` when the agent ID was explicitly supplied by the
   * operator; `'fallback'` when the CLI used its default value.
   * Optional — omitted when unknown or not applicable.
   */
  identityOrigin?: 'configured' | 'fallback';
  cwd: string;
  timeoutMs: number;
  dataDir: string;
  segmentId: string;
  /**
   * Execution mode. Default `gate` (deny-by-default): a `deny` decision blocks
   * execution. `witness` does not enforce — the policy decision is recorded as
   * evidence and the action executes, under a distinct `witnessed_executed`
   * outcome (never `denied_by_policy`).
   */
  mode?: ExecutionMode;
  /**
   * Optional sink for the mediated command's surfaced stdout (head, and tail
   * when truncated). When provided, `runExec` routes captured stdout here
   * instead of writing to the process's own stdout. Non-CLI adapters whose own
   * stdout is a protocol channel (e.g. the MCP server, where stdout carries
   * newline-delimited JSON-RPC) use this so mediated command output never
   * corrupts the channel. Default (undefined): write to `process.stdout`, as
   * the CLI does. Stderr (the witness footer, denial notices) is unaffected —
   * it is valid out-of-band logging for those callers.
   */
  onStdout?: (chunk: string) => void;
}

export async function runExec(opts: ExecOptions): Promise<number> {
  // Mode routing (clean-seam product boundary). Default Gate (deny-by-default).
  // Gate enforces the policy decision (a `deny` blocks); Witness records the
  // decision as evidence but never enforces — no block, no approval prompt —
  // and the action executes under a distinct `witnessed_executed` outcome.
  const mode: ExecutionMode = opts.mode ?? 'gate';

  // 0. Recovery: if a prior invocation crashed between intent_recorded
  //    and execution_complete, the chain tail is an unpaired `pending`.
  //    Emit `execution_lost` before any new work so the chain captures
  //    what was abandoned. The check is cheap on healthy
  //    chains (returns null after a single tail read).
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

  // 1. Build intent
  const intent: ClassifiedIntent['intent'] = {
    action_type: 'shell_command',
    executable: opts.command,
    args: opts.args,
    cwd: opts.cwd,
    use_tty: false,
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

  // 3. Load policy packs
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

  // P0-4: fail closed when no policy packs are loaded. Operator may opt
  // in to advisory-only execution via WITSEAL_UNSAFE_ALLOW_NO_POLICY=1;
  // the witness event still carries outcome=no_policy_configured so the
  // distinction from policy-allowed execution remains visible in evidence.
  const noPolicyLoaded = packsLoaded === 0;
  const noPolicyEscapeActive =
    noPolicyLoaded && process.env[ENV_UNSAFE_ALLOW_NO_POLICY] === '1';
  // Q2 (RFC-0002): Witness Mode does not enforce, so a missing policy pack is
  // recorded as evidence (`no_policy_configured`) and the action executes — no
  // env opt-in needed. Gate Mode stays fail-closed (deny-by-default).
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

  // Constraint contour (clean-seam product boundary): does this mode enforce the
  // policy decision? Gate enforces (a `deny` blocks; `require-approval` prompts);
  // Witness records the decision as evidence but never enforces. Computed BEFORE
  // approval so Witness skips the prompt entirely.
  const constraint = applyConstraint(decision, mode);

  // 4. Approval — Gate Mode only. Witness does not enforce, so it does not
  //    prompt; the `require-approval` decision is recorded as evidence and the
  //    action executes.
  let approval = null;
  if (mode === 'gate' && decision.outcome === 'require-approval') {
    approval = await obtainApproval(classifiedIntent, decision);
    if (approval.outcome !== 'approved') {
      // Denied by approval → emit witness, return non-zero
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
      return 100; // exit code for denial
    }
  }

  // 5. Constraint block — Gate Mode blocks a `deny` here. In Witness Mode
  //    constraint.block is always false (recorded as evidence, executed below).
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
    return 100;
  }

  // 6a. Phase A: emit `intent_recorded` BEFORE the
  //     mediator runs. A crash between this emit and the post-execution
  //     emit leaves an unpaired `pending` event at the chain tail that
  //     the next runExec invocation recovers as `execution_lost`.
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

  // 6b. Execute
  const execResult: ExecutionResult = await mediateShell(intent, {
    timeoutMs: opts.timeoutMs > 0 ? opts.timeoutMs : 0,
  });

  // 7. Determine outcome. P0-4: under the no-policy escape hatch the
  //    outcome stays `no_policy_configured` regardless of how mediateShell
  //    fared — evidence consumers MUST be able to tell that this action
  //    ran without policy mediation.
  const outcome: WitnessOutcome = noPolicyProceed
    ? 'no_policy_configured'
    : computeOutcome(decision.outcome, approval !== null, execResult, mode);

  // 8. Phase B: emit `execution_complete` AFTER
  //    the mediator returns, referencing the Phase A intent_recorded so
  //    the pair is independently navigable from receipt → event →
  //    intent_recorded_event_id.
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

  // 9. Surface execution outputs to the user (head + tail). Routed through the
  //    optional onStdout sink so an adapter whose own stdout is a protocol
  //    channel can capture this instead of letting it reach process.stdout.
  const writeStdout = opts.onStdout ?? ((chunk: string): void => void process.stdout.write(chunk));
  if (execResult.stdout.head) writeStdout(execResult.stdout.head);
  if (execResult.stdout.truncated && execResult.stdout.tail) {
    writeStdout(`\n[witseal: stdout truncated; ${execResult.stdout.total_bytes} total bytes]\n`);
    writeStdout(execResult.stdout.tail);
  }
  if (execResult.stderr.head) process.stderr.write(execResult.stderr.head);
  if (execResult.stderr.truncated && execResult.stderr.tail) {
    process.stderr.write(`\n[witseal: stderr truncated; ${execResult.stderr.total_bytes} total bytes]\n`);
    process.stderr.write(execResult.stderr.tail);
  }

  // 10. Print witness footer (to stderr so it doesn't pollute stdout)
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
    // Witness executed a non-allow decision (`deny` or `require-approval`)
    // without enforcing it. Recorded under a distinct outcome — never
    // `denied_by_policy` (which implies the action did not run).
    return hadError ? 'witnessed_executed_with_error' : 'witnessed_executed';
  }
  if (approved) {
    return hadError ? 'approved_executed_with_error' : 'approved_executed';
  }
  // Gate Mode: a `deny` is blocked before execution, so this is unreachable
  // for deny; a safety default.
  return 'denied_by_policy';
}
