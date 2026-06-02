/**
 * Claude Code adapter — Level-2 witness (observe, do not execute).
 *
 * Claude Code is a sealed host: it runs tool calls with its own executor and
 * does not let an integration replace it. So witseal cannot own execution here.
 * What it CAN do is observe: the `PostToolUse` hook fires after a tool runs and
 * carries the real exit code, stdout, and stderr. This adapter consumes that
 * payload and records a Level-2 witness event — evidence of what Claude Code's
 * Bash tool actually did. It is the honest floor of the ladder: a witnessed
 * decision with the observed result, not an own-executed receipt.
 *
 * `witnessClaudeCodePostToolUse` is the framework-agnostic core: it takes a
 * parsed PostToolUse payload and records it. The hook entry (`bin.ts`) is the
 * thin shim that reads the payload from stdin.
 *
 * Scope: this observes after the fact. It does NOT block — `PostToolUse` runs
 * after the command has already executed. Gating Claude Code (refusing a
 * command before it runs) would require a different hook and is not in scope
 * here; this adapter is witness-only.
 */

import { recordWitnessedExecution, type WitnessedExecutionResult } from '../../witness/record.js';

/** Options binding the adapter to a witseal data directory / segment. */
export interface ClaudeCodeWitnessOptions {
  dataDir: string;
  segmentId?: string;
  /** Agent identifier recorded in the witness event. Defaults to `claude-code`. */
  agentId?: string;
}

/** Outcome of handling a PostToolUse payload. */
export type ClaudeCodeWitnessResult =
  | { recorded: true; result: WitnessedExecutionResult }
  | { recorded: false; reason: string };

/**
 * The subset of a Claude Code `PostToolUse` payload this adapter reads. Other
 * fields are ignored. Only the `Bash` tool is witnessed in this version.
 */
export interface PostToolUsePayload {
  tool_name?: unknown;
  cwd?: unknown;
  tool_input?: unknown;
  tool_response?: unknown;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/**
 * Record a Claude Code `PostToolUse` payload as a Level-2 witness event.
 *
 * Only `Bash` tool calls are witnessed (they carry a shell command + real
 * exit/stdout/stderr). Any other tool, or a malformed payload, returns
 * `{ recorded: false, reason }` so the caller can no-op without disrupting
 * Claude Code.
 */
export async function witnessClaudeCodePostToolUse(
  payload: PostToolUsePayload,
  opts: ClaudeCodeWitnessOptions
): Promise<ClaudeCodeWitnessResult> {
  const toolName = asString(payload.tool_name);
  if (toolName !== 'Bash') {
    return { recorded: false, reason: `unsupported tool: ${toolName ?? '<none>'} (only Bash is witnessed)` };
  }

  const input = (typeof payload.tool_input === 'object' && payload.tool_input !== null
    ? payload.tool_input
    : {}) as Record<string, unknown>;
  const response = (typeof payload.tool_response === 'object' && payload.tool_response !== null
    ? payload.tool_response
    : {}) as Record<string, unknown>;

  const command = asString(input['command']);
  if (command === undefined || command.length === 0) {
    return { recorded: false, reason: 'tool_input.command missing or empty' };
  }

  // returnCode is the documented exit code; some payloads use exit_code.
  const rawCode = response['returnCode'] ?? response['exit_code'];
  const exitCode = typeof rawCode === 'number' ? rawCode : 0;
  const stdout = asString(response['stdout']) ?? '';
  const stderr = asString(response['stderr']) ?? '';
  const interrupted = response['interrupted'] === true;
  const cwd = asString(payload.cwd) ?? process.cwd();

  const result = await recordWitnessedExecution({
    command,
    cwd,
    exitCode,
    stdout,
    stderr,
    interrupted,
    agentId: opts.agentId ?? 'claude-code',
    dataDir: opts.dataDir,
    ...(opts.segmentId !== undefined ? { segmentId: opts.segmentId } : {}),
  });

  return { recorded: true, result };
}
