/**
 * Framework adapter — shared witseal-side mediation core (author-the-tool,
 * Level 3).
 *
 * Agent frameworks that let you *author the tool* (LangGraph, the OpenAI Agents
 * SDK, and similar) reach Level 3 the cheap way: the tool you register is your
 * own code, so its body can run the action through witseal's `runExec`. WitSeal
 * then OWNS execution (classify -> policy -> mediate -> witness -> receipt) and
 * the call yields a full execution receipt, not merely a witnessed decision.
 *
 * Because "author the tool" is the same shape across these frameworks, the
 * mediation primitive is shared: `mediateShellCommand` maps a freeform shell
 * command into a `runExec` invocation, captures the command's stdout, and
 * returns a result a framework tool can hand straight back to the model. The
 * tool-shaped half — the shared input schema and the tool body — lives in
 * `tool.ts`; the per-framework shims (`langgraph/tool.ts`, `openai-agents/tool.ts`)
 * arrange those shared pieces into the exact object each framework's `tool()`
 * helper expects, so the only line an integrator writes is the framework binding.
 *
 * This module has no framework dependency and is unit-testable on its own.
 */

import { runExec, type ExecOptions } from '../../cli/exec.js';
import { runFileExec, type FileWriteMode } from '../../cli/exec-file.js';

/** WitSeal's reserved exit code for a Gate denial (deny-by-default block). */
export const WITSEAL_DENIED_EXIT = 100;

/** A shell command tool call, reduced to what the mediation core needs. */
export interface ShellCommandCall {
  /** The freeform shell command string from the tool call. */
  command: string;
  /** Working directory for the command (defaults to the process cwd). */
  cwd?: string;
}

/** A file_write tool call, reduced to what the mediation core needs. */
export interface FileWriteCall {
  /** Target file path. */
  path: string;
  /** The exact text to write (encoded as UTF-8 bytes by the mediator). */
  content: string;
  /**
   * Write mode. Defaults to `overwrite`. `create_only` refuses an existing
   * file (use-once); `append` adds to the end.
   */
  writeMode?: FileWriteMode;
}

/** Options binding the mediation to a witseal data directory / segment / mode. */
export interface FrameworkMediateOptions {
  dataDir: string;
  segmentId?: string;
  /** Recorded agent identifier (e.g. the framework name). */
  agentId?: string;
  /** Execution mode. Defaults to witseal's default (Gate, deny-by-default). */
  mode?: ExecOptions['mode'];
  /** Optional execution timeout in ms. 0 / omitted means no timeout. */
  timeoutMs?: number;
}

/** Outcome of mediating a framework shell tool call through witseal. */
export interface ShellMediationResult {
  /** The exit code returned by `runExec`. */
  exitCode: number;
  /** True when the Gate denied the action (exit `WITSEAL_DENIED_EXIT`). */
  denied: boolean;
  /** Captured command stdout (head, plus tail when truncated). May be empty. */
  output: string;
  /** Human-readable status line describing the mediation outcome. */
  summary: string;
}

/**
 * Mediate a shell command through the witseal pipeline, for use inside a
 * framework tool's body.
 *
 * Never bypasses witseal: the action is executed only via `runExec`. In Gate
 * mode a `deny` decision blocks execution and returns `WITSEAL_DENIED_EXIT`.
 * The command's stdout is captured so the tool can return it to the model; it
 * is not written to the process's own stdout.
 */
export async function mediateShellCommand(
  call: ShellCommandCall,
  opts: FrameworkMediateOptions
): Promise<ShellMediationResult> {
  let captured = '';
  const exitCode = await runExec({
    command: '/bin/sh',
    args: ['-c', call.command],
    agentId: opts.agentId ?? 'framework-tool',
    cwd: call.cwd ?? process.cwd(),
    timeoutMs: opts.timeoutMs ?? 0,
    dataDir: opts.dataDir,
    segmentId: opts.segmentId ?? 'default',
    onStdout: (chunk: string): void => {
      captured += chunk;
    },
    ...(opts.mode ? { mode: opts.mode } : {}),
  });

  const denied = exitCode === WITSEAL_DENIED_EXIT;
  const summary = denied
    ? `WitSeal denied this command by policy (exit ${exitCode}). It was recorded as evidence and did not run.`
    : `WitSeal-mediated execution finished with exit ${exitCode}. ` +
      `A full execution receipt was recorded (see "witseal receipt show").`;

  return { exitCode, denied, output: captured, summary };
}

/** Outcome of mediating a framework file_write tool call through witseal. */
export interface FileMediationResult {
  /** The exit code returned by `runFileExec`. */
  exitCode: number;
  /** True when the Gate denied the action (exit `WITSEAL_DENIED_EXIT`). */
  denied: boolean;
  /** Human-readable status line describing the mediation outcome. */
  summary: string;
}

/**
 * Mediate a file_write through the witseal pipeline, for use inside a framework
 * tool's body.
 *
 * The file analogue of {@link mediateShellCommand}: it routes the write through
 * the SAME end-to-end pipeline (classify -> policy -> mediate -> witness ->
 * receipt -> chain) via `runFileExec`, so an allowed write yields the same kind
 * of independently verifiable execution receipt as the shell path — no new
 * wire-format. Content is handed over as UTF-8 bytes; `runFileExec` derives
 * `content_hash` / `content_size_bytes`, and the mediator re-validates both
 * against the bytes BEFORE any write occurs. Never bypasses witseal: the write
 * happens only via `runFileExec`. In Gate mode (deny-by-default) a `deny`
 * decision blocks the write and returns `WITSEAL_DENIED_EXIT` with no file
 * created.
 */
export async function mediateFileWrite(
  call: FileWriteCall,
  opts: FrameworkMediateOptions
): Promise<FileMediationResult> {
  const exitCode = await runFileExec({
    path: call.path,
    content: Buffer.from(call.content, 'utf8'),
    ...(call.writeMode ? { writeMode: call.writeMode } : {}),
    agentId: opts.agentId ?? 'framework-tool',
    dataDir: opts.dataDir,
    segmentId: opts.segmentId ?? 'default',
    ...(opts.mode ? { mode: opts.mode } : {}),
  });

  const denied = exitCode === WITSEAL_DENIED_EXIT;
  const summary = denied
    ? `WitSeal denied this file write by policy (exit ${exitCode}). It was recorded as evidence and no file was written.`
    : `WitSeal-mediated file write finished with exit ${exitCode}. ` +
      `A full execution receipt was recorded (see "witseal receipt show").`;

  return { exitCode, denied, summary };
}
