/**
 * Temporal adapter — witnessed shell Activity helper (author-the-activity,
 * Level 3).
 *
 * A Temporal Activity is an ordinary author-controlled function. Side effects,
 * subprocess execution, and other non-deterministic work belong in Activities,
 * not Workflows: Workflow code must be deterministic to support replay, and
 * non-deterministic operations are delegated to Activities (Temporal docs,
 * *Workflow Definition* / *Activities*). That makes an Activity the correct
 * place to own execution: `witnessedShell` runs a shell command through
 * witseal's `runExec`, so WitSeal OWNS execution (classify -> policy -> mediate
 * -> witness -> receipt) and the call yields a full execution receipt, not
 * merely a witnessed decision.
 *
 * This is the cheap Level-3 path for Temporal, identical in spirit to the
 * "author the tool" frameworks (LangGraph, OpenAI Agents SDK): register
 * `witnessedShell` as an Activity and a Workflow gets witnessed execution with
 * no further wiring. It reuses the shared framework mediation core
 * (`../framework/mediate.ts`) — the same primitive those tool shims call.
 *
 * This module has no Temporal dependency and is unit-testable on its own. The
 * Temporal-specific registration (a one-line `activities` export) is a thin
 * shim documented in this directory's README.
 *
 * Canon: correlation with Temporal's own identifiers (workflow id, activity
 * type) is carried in the EXISTING `agent_identifier` field via
 * `temporalAgentId(info)`. No new receipt field is introduced; the wire format
 * and the golden receipt are unchanged.
 */

import {
  mediateShellCommand,
  WITSEAL_DENIED_EXIT,
  type ShellCommandCall,
  type FrameworkMediateOptions,
  type ShellMediationResult,
} from '../framework/mediate.js';

export { WITSEAL_DENIED_EXIT };
export type { ShellCommandCall, ShellMediationResult };

/**
 * The subset of a Temporal Activity `Info` (from `Context.current().info`) this
 * adapter reads, structurally typed so the core needs no Temporal dependency.
 */
export interface TemporalActivityInfoLike {
  activityType?: string;
  workflowType?: string;
  workflowExecution?: { workflowId?: string; runId?: string };
  attempt?: number;
}

/**
 * Build a witseal `agent_identifier` from a Temporal Activity `Info`, so
 * recorded evidence can be correlated back to the workflow/activity that
 * produced it WITHOUT adding a receipt field. Shape:
 * `temporal:<workflowId>/<activityType>` (missing parts omitted).
 */
export function temporalAgentId(info?: TemporalActivityInfoLike): string {
  const tail = [info?.workflowExecution?.workflowId, info?.activityType].filter(
    (s): s is string => typeof s === 'string' && s.length > 0
  );
  return tail.length > 0 ? `temporal:${tail.join('/')}` : 'temporal-activity';
}

/**
 * Options for `witnessedShell`: the shared framework mediation options, with
 * `agentId` replaced by Temporal-aware correlation (explicit `agentId`, or
 * derived from the Activity `info`).
 */
export type WitnessedShellOptions = Omit<FrameworkMediateOptions, 'agentId'> & {
  /** Explicit agent identifier. Takes precedence over `info`-derived correlation. */
  agentId?: string;
  /** Temporal Activity `Info` (from `Context.current().info`) for correlation. */
  info?: TemporalActivityInfoLike;
};

/**
 * Run a shell command as a witnessed Temporal Activity body (Level 3).
 *
 * Never bypasses witseal: the command is executed only via `runExec`. In Gate
 * mode a `deny` decision blocks execution and the result is `denied`. The
 * returned `ShellMediationResult` is plain JSON, safe to return from an Activity
 * to its Workflow.
 */
export async function witnessedShell(
  call: ShellCommandCall,
  opts: WitnessedShellOptions
): Promise<ShellMediationResult> {
  const agentId = opts.agentId ?? temporalAgentId(opts.info);
  return mediateShellCommand(call, {
    dataDir: opts.dataDir,
    agentId,
    ...(opts.segmentId !== undefined ? { segmentId: opts.segmentId } : {}),
    ...(opts.mode !== undefined ? { mode: opts.mode } : {}),
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
  });
}
