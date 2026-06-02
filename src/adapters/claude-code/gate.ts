/**
 * Claude Code adapter — Level-2 PreToolUse gate (decide, do not execute).
 *
 * Companion to the PostToolUse witness (`witness.ts`). Where the witness
 * OBSERVES a Bash tool call after it ran, this gate evaluates policy BEFORE the
 * call runs and tells Claude Code whether to block or escalate it — without ever
 * executing the command. Claude Code's own executor still runs the command (it
 * is a sealed host); witseal only decides. So this stays Level-2 honest: witseal
 * gates the decision and witnesses the result, it never owns execution.
 *
 * The gate is deliberately ADDITIVE and conservative: it can only make Claude
 * Code MORE restrictive, never less.
 *   - policy `deny`            -> block the call and record a `denied_by_policy`
 *                                 witness event (the command never runs;
 *                                 `execution_result` is null).
 *   - policy `require-approval`-> escalate to the user via Claude Code's
 *                                 permission dialog (`ask`). No terminal event
 *                                 yet — the PostToolUse witness records the
 *                                 result if the user approves and it runs.
 *   - policy `allow`           -> NO decision. witseal does not override Claude
 *                                 Code's own permission flow on the permissive
 *                                 side; it stays out of the way and lets the
 *                                 PostToolUse witness record the result.
 *
 * Fail-closed: consistent with the deny-by-default invariant and the CLI Gate
 * (`src/cli/exec.ts`, P0-4), a missing policy pack yields a block, unless the
 * operator sets `WITSEAL_UNSAFE_ALLOW_NO_POLICY=1`. This is the mirror image of
 * the witness shim, which fails OPEN (records nothing, never disrupts) because
 * observation has nothing to enforce.
 *
 * No new wire-format: a block reuses the existing `WitnessEvent` /
 * `PolicyDecision` shapes with `execution_result = null`. Nothing here runs the
 * command.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { classify, CLASSIFIER_VERSION } from '../../risk/classifier.js';
import { PolicyEngine } from '../../policy/engine.js';
import { EventLog } from '../../witness/event-log.js';
import { emitWitnessEvent, generateIntentId } from '../../witness/emit.js';
import type { ClassifiedIntent } from '../../../schemas/intent.schema.js';
import type { PolicyDecision } from '../../../schemas/policy.schema.js';
import type { WitnessEvent } from '../../../schemas/witness-event.schema.js';

/**
 * Operator opt-in to proceed when no policy packs are loaded. Default behavior
 * is fail-closed (block); setting this to exactly `"1"` switches the gate to
 * advisory-only — it makes no decision and lets Claude Code's normal flow
 * proceed. Mirrors the CLI Gate's env of the same name.
 */
export const ENV_UNSAFE_ALLOW_NO_POLICY = 'WITSEAL_UNSAFE_ALLOW_NO_POLICY';

/** The Claude Code PreToolUse permission decisions this gate emits. */
export type PermissionDecision = 'allow' | 'deny' | 'ask';

/** Options binding the gate to a witseal data directory / segment. */
export interface ClaudeCodeGateOptions {
  dataDir: string;
  segmentId?: string;
  /** Agent identifier recorded in any witness event. Defaults to `claude-code`. */
  agentId?: string;
}

/**
 * The subset of a Claude Code `PreToolUse` payload this gate reads. Other fields
 * are ignored. Only the `Bash` tool is gated in this version.
 */
export interface PreToolUsePayload {
  tool_name?: unknown;
  cwd?: unknown;
  tool_input?: unknown;
}

/** Outcome of gating a PreToolUse payload. */
export interface ClaudeCodeGateResult {
  /**
   * The decision to return to Claude Code, or `null` to make NO decision (let
   * Claude Code's normal permission flow proceed). `null` is used for non-Bash
   * tools and for a policy `allow` — witseal only speaks up to block or
   * escalate, never to auto-approve.
   */
  permissionDecision: PermissionDecision | null;
  /** Human-readable reason, surfaced to Claude Code / the user when blocking. */
  reason: string;
  /** Witness event id + outcome, when the gate recorded one (the block path). */
  recorded?: { eventId: string; outcome: string };
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/**
 * Evaluate a Claude Code `PreToolUse` payload and decide whether to allow,
 * block, or escalate the tool call — without executing anything.
 *
 * Only `Bash` tool calls are gated. Any other tool, a malformed payload, or a
 * policy `allow` returns `{ permissionDecision: null }` so Claude Code's normal
 * permission flow proceeds unchanged.
 */
export async function gateClaudeCodePreToolUse(
  payload: PreToolUsePayload,
  opts: ClaudeCodeGateOptions
): Promise<ClaudeCodeGateResult> {
  const toolName = asString(payload.tool_name);
  // Only Bash carries a shell command we can classify. Other tools are not
  // gated here — make no decision so Claude Code's normal flow applies.
  if (toolName !== 'Bash') {
    return { permissionDecision: null, reason: `tool ${toolName ?? '<none>'} not gated (only Bash)` };
  }

  const input = (typeof payload.tool_input === 'object' && payload.tool_input !== null
    ? payload.tool_input
    : {}) as Record<string, unknown>;
  const command = asString(input['command']);
  if (command === undefined || command.length === 0) {
    // Nothing to evaluate; do not block.
    return { permissionDecision: null, reason: 'tool_input.command missing or empty' };
  }

  const cwd = asString(payload.cwd) ?? process.cwd();
  const agentId = opts.agentId ?? 'claude-code';
  const segmentId = opts.segmentId ?? 'default';

  // 1. Build + classify the intent (same convention as the witness path and the
  //    CLI Gate): a freeform shell command is represented as /bin/sh -c "<cmd>".
  const intent: ClassifiedIntent['intent'] = {
    action_type: 'shell_command',
    executable: '/bin/sh',
    args: ['-c', command],
    cwd,
    use_tty: false,
  };
  const { risk_class, reasons } = classify(intent);
  const classifiedIntent: ClassifiedIntent = {
    schema_version: 'witseal.intent.v0.1',
    intent_id: generateIntentId(),
    intent,
    risk_class,
    classification_reasons: reasons,
    classifier_version: CLASSIFIER_VERSION,
  };

  // 2. Load policy packs.
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

  // 3. No policy pack -> fail closed (block), mirroring the CLI Gate (exec.ts
  //    P0-4). Operator opt-in WITSEAL_UNSAFE_ALLOW_NO_POLICY=1 -> no decision.
  if (packsLoaded === 0) {
    if (process.env[ENV_UNSAFE_ALLOW_NO_POLICY] === '1') {
      return {
        permissionDecision: null,
        reason: `no policy packs at ${policyDir}; ${ENV_UNSAFE_ALLOW_NO_POLICY}=1 advisory-only`,
      };
    }
    const noPolicyDecision: PolicyDecision = {
      schema_version: 'witseal.policy.v0.1',
      outcome: 'deny',
      matched_rule: null,
      reason:
        `no policy packs configured at ${policyDir}; gate fails closed. ` +
        `Set ${ENV_UNSAFE_ALLOW_NO_POLICY}=1 to proceed in advisory-only mode.`,
      active_pack_hashes: [],
    };
    const event = await emitBlock(opts, segmentId, classifiedIntent, noPolicyDecision, 'no_policy_configured', agentId);
    return {
      permissionDecision: 'deny',
      reason: noPolicyDecision.reason,
      recorded: { eventId: event.event_id, outcome: 'no_policy_configured' },
    };
  }

  // 4. Evaluate policy.
  const decision = engine.evaluate(classifiedIntent);

  if (decision.outcome === 'allow') {
    // Conservative: witseal does not override Claude Code's own permission flow
    // on the permissive side. No decision; the PostToolUse witness records the
    // result when the command runs.
    return { permissionDecision: null, reason: 'allowed by policy' };
  }

  if (decision.outcome === 'require-approval') {
    // Escalate to the user via Claude Code's permission dialog. No terminal
    // event here — the outcome is not yet decided; if the user approves and the
    // command runs, the PostToolUse witness records it.
    return { permissionDecision: 'ask', reason: decision.reason };
  }

  // decision.outcome === 'deny' -> block and record denied_by_policy. The
  // command never runs, so execution_result stays null (witness-grade honesty:
  // a denied action did not execute).
  const event = await emitBlock(opts, segmentId, classifiedIntent, decision, 'denied_by_policy', agentId);
  return {
    permissionDecision: 'deny',
    reason: decision.reason,
    recorded: { eventId: event.event_id, outcome: 'denied_by_policy' },
  };
}

/**
 * Emit a block as a witness event with `execution_result = null`. Reuses the
 * existing emit path — no new wire-format. Used for both a policy `deny`
 * (`denied_by_policy`) and the no-policy fail-closed case
 * (`no_policy_configured`).
 */
async function emitBlock(
  opts: ClaudeCodeGateOptions,
  segmentId: string,
  classifiedIntent: ClassifiedIntent,
  policyDecision: PolicyDecision,
  outcome: 'denied_by_policy' | 'no_policy_configured',
  agentId: string
): Promise<WitnessEvent> {
  const eventLog = new EventLog({ root: opts.dataDir, segmentId });
  return emitWitnessEvent(eventLog, {
    classifiedIntent,
    policyDecision,
    approval: null,
    executionResult: null,
    outcome,
    agentIdentifier: agentId,
    classifierVersion: CLASSIFIER_VERSION,
  });
}
