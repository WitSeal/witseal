/**
 * Temporal adapter — Activity witness interceptor (observe, Level 2).
 *
 * The Level-3 path (`witnessedShell`) is for activities you author: witseal owns
 * execution. But you may want evidence for an Activity you do NOT own — a shell
 * step inside a third-party or pre-existing Activity that runs its own
 * subprocess. There witseal cannot own execution; it OBSERVES. A Temporal
 * `ActivityInboundCallsInterceptor` wraps activity execution: it calls the
 * activity (`next`), sees the arguments and the result (or error), and records a
 * Level-2 witness event — the honest floor of the ladder, a witnessed decision
 * with the observed result, not an own-executed receipt.
 *
 * It witnesses ONLY activities a caller-supplied `extract` mapper recognizes as
 * a shell execution (mirroring the Claude Code adapter, which witnesses only the
 * `Bash` tool). For any other activity the mapper returns `undefined` and
 * nothing is recorded — the activity runs untouched. Recording never alters the
 * activity's result and never swallows its error.
 *
 * Determinism: this records evidence from inside an ACTIVITY interceptor
 * (Activity code may be non-deterministic). It must NOT be registered as a
 * Workflow interceptor — Workflow code must be deterministic and may not perform
 * I/O.
 *
 * No Temporal dependency: this defines the minimal structural shape it needs
 * from `ActivityExecuteInput` (its `args`) and the `next` continuation, and is
 * unit-testable on its own. The real-typed registration
 * (`Worker.create({ interceptors: { activity: [...] } })`) is a thin shim in
 * this directory's README.
 */

import { recordWitnessedExecution } from '../../witness/record.js';
import { temporalAgentId, type TemporalActivityInfoLike } from './activity.js';

/** A shell execution observed from an Activity, normalized for witnessing. */
export interface ActivityShellObservation {
  /** The freeform shell command the activity ran (recorded as `/bin/sh -c <command>`). */
  command: string;
  /** Observed process exit code. */
  exitCode: number;
  /** Observed stdout (may be empty). */
  stdout?: string;
  /** Observed stderr (may be empty). */
  stderr?: string;
  /** Working directory the activity reported. Defaults to the process cwd. */
  cwd?: string;
  /** Whether the activity reported the command was interrupted. */
  interrupted?: boolean;
}

/**
 * Minimal structural mirror of Temporal's `ActivityExecuteInput`. Only `args`
 * is read; `headers` is intentionally omitted. Structurally compatible with the
 * SDK's input for the verified 1.17.x line.
 */
export interface ActivityExecuteInputLike {
  readonly args: readonly unknown[];
}

/** The `next` continuation an interceptor calls to run the activity. */
export type ActivityNext = (input: ActivityExecuteInputLike) => Promise<unknown>;

/**
 * Map an activity's `(args, result, error)` to a shell observation, or
 * `undefined` to skip witnessing this activity. `error` is set when the activity
 * threw (then `result` is `undefined`).
 */
export type ActivityShellExtractor = (
  args: readonly unknown[],
  result: unknown,
  error: unknown
) => ActivityShellObservation | undefined;

/** Options binding witnessing to a witseal data dir / segment / identity. */
export interface RecordActivityWitnessOptions {
  dataDir: string;
  segmentId?: string;
  /** Explicit agent identifier; otherwise derived from `info` (or `temporal-activity`). */
  agentId?: string;
  /** Temporal Activity `Info` for correlation, folded into `agent_identifier`. */
  info?: TemporalActivityInfoLike;
}

/**
 * Record a normalized activity shell observation as a Level-2 witness event.
 * Dependency-free; reuses witseal's witness-record path. Executes nothing.
 */
export async function recordActivityWitness(
  obs: ActivityShellObservation,
  opts: RecordActivityWitnessOptions
): Promise<void> {
  await recordWitnessedExecution({
    command: obs.command,
    cwd: obs.cwd ?? process.cwd(),
    exitCode: obs.exitCode,
    stdout: obs.stdout ?? '',
    stderr: obs.stderr ?? '',
    agentId: opts.agentId ?? temporalAgentId(opts.info),
    dataDir: opts.dataDir,
    ...(obs.interrupted !== undefined ? { interrupted: obs.interrupted } : {}),
    ...(opts.segmentId !== undefined ? { segmentId: opts.segmentId } : {}),
  });
}

/** Options for `WitnessActivityInbound`. */
export interface WitnessActivityOptions {
  dataDir: string;
  segmentId?: string;
  /** Explicit agent identifier; otherwise derived per call from the activity `Info`. */
  agentId?: string;
  /** Map the activity's args/result to a shell observation. Required. */
  extract: ActivityShellExtractor;
}

/**
 * A witseal Level-2 witness interceptor for Temporal activities. Structurally
 * compatible with `ActivityInboundCallsInterceptor`: its `execute(input, next)`
 * runs the activity, observes the outcome, and (when `extract` recognizes a
 * shell execution) records a witness event. It always returns the activity's
 * result and re-throws the activity's error — it never changes behavior, and a
 * recorder failure never breaks the activity.
 */
export class WitnessActivityInbound {
  constructor(private readonly opts: WitnessActivityOptions) {}

  async execute(input: ActivityExecuteInputLike, next: ActivityNext): Promise<unknown> {
    let result: unknown;
    let threw = false;
    let error: unknown;
    try {
      result = await next(input);
      return result;
    } catch (e) {
      threw = true;
      error = e;
      throw e;
    } finally {
      try {
        const obs = this.opts.extract(input.args, threw ? undefined : result, error);
        if (obs) {
          await recordActivityWitness(obs, {
            dataDir: this.opts.dataDir,
            ...(this.opts.segmentId !== undefined ? { segmentId: this.opts.segmentId } : {}),
            ...(this.opts.agentId !== undefined ? { agentId: this.opts.agentId } : {}),
          });
        }
      } catch {
        // Witnessing must never break the activity. A recorder error is swallowed;
        // the activity's own result/error (already in flight) is unaffected.
      }
    }
  }
}
