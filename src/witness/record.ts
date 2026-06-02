/**
 * Witness-record path — record an externally-observed execution as evidence
 * (Level 2), without executing anything.
 *
 * `runExec` is the Level-3 own-execute path: witseal runs the action inside its
 * mediator and records a full receipt. But some hosts are sealed — they run the
 * action themselves and only let an integration *observe* the result after the
 * fact (e.g. a coding agent's post-tool hook carrying the real exit code,
 * stdout, and stderr). For those, witseal cannot own execution; it records what
 * it observed.
 *
 * `recordWitnessedExecution` is that path. It classifies the observed command,
 * evaluates policy for annotation (it does NOT enforce — the action already
 * ran), builds an `ExecutionResult` from the observed output, and emits a single
 * witness event. The outcome follows the RFC-0002 Witness model: a policy
 * decision that is not `allow` yields `witnessed_executed` (the action ran and
 * was recorded, never `denied_by_policy`, which would imply it did not run).
 *
 * No new wire-format: this populates the existing `ExecutionResult` /
 * `WitnessEvent` fields. Nothing here re-executes the command.
 */

import { existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { classify } from '../risk/classifier.js';
import { PolicyEngine } from '../policy/engine.js';
import { EventLog } from './event-log.js';
import { emitWitnessEvent, generateIntentId } from './emit.js';
import { CLASSIFIER_VERSION } from '../risk/classifier.js';
import type { ClassifiedIntent } from '../../schemas/intent.schema.js';
import type { PolicyDecision } from '../../schemas/policy.schema.js';
import type {
  ExecutionResult,
  StreamCapture,
} from '../../schemas/execution-result.schema.js';
import type { WitnessOutcome } from '../../schemas/witness-event.schema.js';

const HEAD_TAIL_BYTES = 64 * 1024; // mirror the mediator's capture bound (ADR-0005)
const EXECUTION_SCHEMA = 'witseal.execution.v0.1';

/** An execution witseal observed but did not run. */
export interface WitnessedExecutionInput {
  /** The freeform shell command that was run, represented as `/bin/sh -c <command>`. */
  command: string;
  /** Working directory the host reported for the command. */
  cwd: string;
  /** Observed process exit code. */
  exitCode: number;
  /** Observed stdout (full text the host surfaced). */
  stdout: string;
  /** Observed stderr (full text the host surfaced). */
  stderr: string;
  /** Whether the host reported the command was interrupted. Treated as an error. */
  interrupted?: boolean;
  /** Agent identifier recorded in the witness event (e.g. the host name). */
  agentId: string;
  /** WitSeal data directory (chain, policy packs). */
  dataDir: string;
  /** Chain segment id. Defaults to `default`. */
  segmentId?: string;
  /** Observed start/finish timestamps. Default: now for both. */
  startedAt?: Date;
  finishedAt?: Date;
}

/** Result of recording an observed execution. */
export interface WitnessedExecutionResult {
  eventId: string;
  receiptId: string;
  outcome: WitnessOutcome;
  riskClass: string;
}

/**
 * Record an externally-observed execution as a Level-2 witness event. Does not
 * execute anything. Returns the emitted event's identifiers and outcome.
 */
export async function recordWitnessedExecution(
  input: WitnessedExecutionInput
): Promise<WitnessedExecutionResult> {
  const segmentId = input.segmentId ?? 'default';

  // 1. Represent the observed freeform command structurally (same convention as
  //    the own-execute shell adapters): /bin/sh -c "<command>".
  const intent: ClassifiedIntent['intent'] = {
    action_type: 'shell_command',
    executable: '/bin/sh',
    args: ['-c', input.command],
    cwd: input.cwd,
    use_tty: false,
  };

  // 2. Classify.
  const { risk_class, reasons } = classify(intent);
  const classifiedIntent: ClassifiedIntent = {
    schema_version: 'witseal.intent.v0.1',
    intent_id: generateIntentId(),
    intent,
    risk_class,
    classification_reasons: reasons,
    classifier_version: CLASSIFIER_VERSION,
  };

  // 3. Load policy packs for annotation (NOT enforcement — the action already
  //    ran). With no packs, the event is marked no_policy_configured.
  const engine = new PolicyEngine();
  const policyDir = join(input.dataDir, 'policy-packs');
  let packsLoaded = 0;
  if (existsSync(policyDir)) {
    for (const file of readdirSync(policyDir)) {
      if (file.endsWith('.json')) {
        engine.loadPackFromFile(join(policyDir, file));
        packsLoaded++;
      }
    }
  }

  const hadError = input.exitCode !== 0 || input.interrupted === true;

  let policyDecision: PolicyDecision;
  let outcome: WitnessOutcome;
  if (packsLoaded === 0) {
    policyDecision = {
      schema_version: 'witseal.policy.v0.1',
      outcome: 'deny',
      matched_rule: null,
      reason:
        'no policy packs configured; action observed under Level-2 witness ' +
        '(recorded as evidence, not enforced)',
      active_pack_hashes: [],
    };
    outcome = 'no_policy_configured';
  } else {
    policyDecision = engine.evaluate(classifiedIntent);
    if (policyDecision.outcome === 'allow') {
      outcome = hadError ? 'allowed_executed_with_error' : 'allowed_executed';
    } else {
      // Witness model (RFC-0002): a non-allow decision that nonetheless ran is
      // recorded as witnessed_executed — never denied_by_policy (which implies
      // the action did not run).
      outcome = hadError ? 'witnessed_executed_with_error' : 'witnessed_executed';
    }
  }

  // 4. Build the ExecutionResult from observed output. No re-execution.
  const startedAt = input.startedAt ?? new Date();
  const finishedAt = input.finishedAt ?? startedAt;
  const executionResult: ExecutionResult = {
    schema_version: EXECUTION_SCHEMA,
    started_at: toIsoZ(startedAt),
    finished_at: toIsoZ(finishedAt),
    exit_code: input.exitCode,
    signal: null,
    stdout: captureFromString(input.stdout),
    stderr: captureFromString(input.stderr),
    executable_resolved: '/bin/sh',
    // The host did not report which environment keys it passed; record the
    // empty-set hash rather than fabricate one.
    env_keys_hash: sha256(''),
    spawn_error: null,
  };

  // 5. Emit a single witness event carrying the observed result.
  const eventLog = new EventLog({ root: input.dataDir, segmentId });
  const event = await emitWitnessEvent(eventLog, {
    classifiedIntent,
    policyDecision,
    approval: null,
    executionResult,
    outcome,
    agentIdentifier: input.agentId,
    classifierVersion: CLASSIFIER_VERSION,
  });

  return {
    eventId: event.event_id,
    receiptId: event.receipt_id,
    outcome,
    riskClass: risk_class,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function toIsoZ(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Build a bounded StreamCapture from a complete observed string, matching the
 * mediator's head/tail/hash semantics (ADR-0005).
 */
function captureFromString(s: string): StreamCapture {
  const buf = Buffer.from(s, 'utf8');
  const total = buf.length;
  const headBytes = Math.min(total, HEAD_TAIL_BYTES);
  const tailWindow = total > HEAD_TAIL_BYTES ? buf.subarray(total - HEAD_TAIL_BYTES) : buf;
  const tailBytes = Math.min(tailWindow.length, Math.max(total - headBytes, 0));
  const truncated = total > headBytes + tailBytes;
  return {
    total_bytes: total,
    content_hash: sha256(s),
    head: headBytes > 0 ? buf.subarray(0, headBytes).toString('utf8') : null,
    tail:
      tailBytes > 0 && truncated
        ? buf.subarray(buf.length - tailBytes).toString('utf8')
        : null,
    head_bytes: headBytes,
    tail_bytes: tailBytes,
    truncated,
  };
}
