/**
 * `witseal exec` — mediated execution of a shell command.
 *
 * End-to-end pipeline:
 *   intent → classify → evaluate policy → (optional approval) → execute → witness → receipt → chain advance
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { classify, CLASSIFIER_VERSION } from '../risk/classifier.js';
import { PolicyEngine } from '../policy/engine.js';
import { EventLog } from '../witness/event-log.js';
import { emitWitnessEvent, generateIntentId } from '../witness/emit.js';
import { mediateShell } from '../execution/mediator.js';
import { obtainApproval } from './approval.js';
import type { ClassifiedIntent } from '../../schemas/intent.schema.js';
import type { ExecutionResult } from '../../schemas/execution-result.schema.js';
import type { WitnessOutcome } from '../../schemas/witness-event.schema.js';

export interface ExecOptions {
  command: string;
  args: string[];
  agentId: string;
  cwd: string;
  timeoutMs: number;
  dataDir: string;
  segmentId: string;
}

export async function runExec(opts: ExecOptions): Promise<number> {
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

  // 3. Load policy packs and evaluate
  const engine = new PolicyEngine();
  const policyDir = join(opts.dataDir, 'policy-packs');
  if (existsSync(policyDir)) {
    for (const file of readdirSync(policyDir)) {
      if (file.endsWith('.json')) {
        engine.loadPackFromFile(join(policyDir, file));
      }
    }
  }
  const decision = engine.evaluate(classifiedIntent);

  // 4. Approval if required
  let approval = null;
  if (decision.outcome === 'require-approval') {
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
        classifierVersion: CLASSIFIER_VERSION,
      });
      process.stderr.write(`witseal: action denied by approval (event ${event.event_id})\n`);
      return 100; // exit code for denial
    }
  }

  // 5. Denied by policy
  if (decision.outcome === 'deny') {
    const eventLog = new EventLog({ root: opts.dataDir, segmentId: opts.segmentId });
    const event = await emitWitnessEvent(eventLog, {
      classifiedIntent,
      policyDecision: decision,
      approval: null,
      executionResult: null,
      outcome: 'denied_by_policy',
      agentIdentifier: opts.agentId,
      classifierVersion: CLASSIFIER_VERSION,
    });
    process.stderr.write(
      `witseal: action denied by policy (rule ${decision.matched_rule?.rule_id ?? 'default'}, event ${event.event_id})\n` +
        `         reason: ${decision.reason}\n`
    );
    return 100;
  }

  // 6. Execute
  const execResult: ExecutionResult = await mediateShell(intent, {
    timeoutMs: opts.timeoutMs > 0 ? opts.timeoutMs : 0,
  });

  // 7. Determine outcome
  const outcome: WitnessOutcome = computeOutcome(decision.outcome, approval !== null, execResult);

  // 8. Emit witness event (advances chain)
  const eventLog = new EventLog({ root: opts.dataDir, segmentId: opts.segmentId });
  const event = await emitWitnessEvent(eventLog, {
    classifiedIntent,
    policyDecision: decision,
    approval,
    executionResult: execResult,
    outcome,
    agentIdentifier: opts.agentId,
    classifierVersion: CLASSIFIER_VERSION,
  });

  // 9. Surface execution outputs to the user (head + tail)
  if (execResult.stdout.head) process.stdout.write(execResult.stdout.head);
  if (execResult.stdout.truncated && execResult.stdout.tail) {
    process.stdout.write(`\n[witseal: stdout truncated; ${execResult.stdout.total_bytes} total bytes]\n`);
    process.stdout.write(execResult.stdout.tail);
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
  result: ExecutionResult
): WitnessOutcome {
  const hadError = result.exit_code !== 0 || result.spawn_error !== null;
  if (policyOutcome === 'allow') {
    return hadError ? 'allowed_executed_with_error' : 'allowed_executed';
  }
  if (approved) {
    return hadError ? 'approved_executed_with_error' : 'approved_executed';
  }
  // Should not reach here if denied, but a safety default:
  return 'denied_by_policy';
}
