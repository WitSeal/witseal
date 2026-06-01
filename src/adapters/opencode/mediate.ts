/**
 * OpenCode adapter — witseal-side mediation core (P2 M1, Level 3).
 *
 * OpenCode invokes shell actions through a `bash` tool whose argument is a
 * freeform shell command string. This adapter is the thin translation layer
 * the adapter contract (src/adapters/README.md) requires: it maps that tool
 * call into a witseal `runExec` invocation and surfaces the result. WitSeal
 * OWNS execution (classify -> policy -> mediate -> witness -> receipt), so the
 * resulting receipt is a full execution receipt, not merely a witnessed
 * decision.
 *
 * The OpenCode `bash` argument is a shell command string, so it is translated
 * faithfully as a shell invocation (`/bin/sh -c "<command>"`). This is honest:
 * a freeform shell command is opaque to structural classification, so the D8
 * shell-bypass rules correctly elevate it. Policy can still allow it.
 *
 * This module has no OpenCode dependency and is unit-testable on its own. The
 * OpenCode-specific registration (a custom `bash` tool that shadows the
 * built-in) is a thin shim documented in this directory's README; it calls
 * `mediateOpenCodeBash` and translates the exit code into the tool result.
 */

import { runExec, type ExecOptions } from '../../cli/exec.js';

/** WitSeal's reserved exit code for a Gate denial (deny-by-default block). */
export const WITSEAL_DENIED_EXIT = 100;

/** An OpenCode `bash` tool call, reduced to what the adapter needs. */
export interface OpenCodeBashCall {
  /** The freeform shell command string from the OpenCode `bash` tool. */
  command: string;
  /** Working directory for the command (defaults to the current process cwd). */
  cwd?: string;
}

/** Options binding the adapter to a witseal data directory / segment / mode. */
export interface MediateOptions {
  dataDir: string;
  segmentId?: string;
  agentId?: string;
  /** Execution mode. Defaults to witseal's default (Gate, deny-by-default). */
  mode?: ExecOptions['mode'];
}

/** Outcome of mediating an OpenCode bash call through witseal. */
export interface MediationResult {
  /** The exit code returned by `runExec`. */
  exitCode: number;
  /** True when the Gate denied the action (exit `WITSEAL_DENIED_EXIT`). */
  denied: boolean;
}

/**
 * Mediate an OpenCode `bash` tool call through the witseal pipeline.
 *
 * Never bypasses witseal: the action is executed only via `runExec`. In Gate
 * mode a `deny` decision blocks execution and returns `WITSEAL_DENIED_EXIT`.
 */
export async function mediateOpenCodeBash(
  call: OpenCodeBashCall,
  opts: MediateOptions
): Promise<MediationResult> {
  const exitCode = await runExec({
    command: '/bin/sh',
    args: ['-c', call.command],
    agentId: opts.agentId ?? 'opencode',
    cwd: call.cwd ?? process.cwd(),
    timeoutMs: 0,
    dataDir: opts.dataDir,
    segmentId: opts.segmentId ?? 'default',
    ...(opts.mode ? { mode: opts.mode } : {}),
  });
  return { exitCode, denied: exitCode === WITSEAL_DENIED_EXIT };
}
