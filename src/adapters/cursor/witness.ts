/**
 * Cursor adapter — Level-2 witness (observe, do not execute).
 *
 * Cursor runs tool calls with its own executor and does not let an integration
 * replace it. So witseal cannot own execution here. What it CAN do is observe:
 * the `postToolUse` hook fires after a tool runs and carries the real command
 * and result. For the `Shell` tool, the result (`tool_output`) is a
 * JSON-stringified payload with the exit code and stdout. This adapter consumes
 * that payload and records a Level-2 witness event — evidence of what Cursor's
 * Shell tool actually did. It is the honest floor of the ladder: a witnessed
 * decision with the observed result, not an own-executed receipt.
 *
 * `witnessCursorPostToolUse` is the framework-agnostic core: it takes a parsed
 * postToolUse payload and records it. The hook entry (`bin.ts`) is the thin
 * shim that reads the payload from stdin.
 *
 * Scope: this observes after the fact. It does NOT block — `postToolUse` runs
 * after the command has already executed. Cursor is gate-capable via a
 * pre-execution hook (`beforeShellExecution`), but gating is out of scope here;
 * this adapter is witness-only.
 */

import { recordWitnessedExecution, type WitnessedExecutionResult } from '../../witness/record.js';

/** Options binding the adapter to a witseal data directory / segment. */
export interface CursorWitnessOptions {
  dataDir: string;
  segmentId?: string;
  /** Agent identifier recorded in the witness event. Defaults to `cursor`. */
  agentId?: string;
}

/** Outcome of handling a postToolUse payload. */
export type CursorWitnessResult =
  | { recorded: true; result: WitnessedExecutionResult }
  | { recorded: false; reason: string };

/**
 * The subset of a Cursor `postToolUse` payload this adapter reads. Other fields
 * are ignored. Only the `Shell` tool is witnessed in this version.
 *
 * For the Shell tool, `tool_output` is a JSON-stringified result payload — e.g.
 * `{"exitCode":0,"stdout":"..."}` — per Cursor's hooks documentation.
 */
export interface CursorPostToolUsePayload {
  tool_name?: unknown;
  cwd?: unknown;
  tool_input?: unknown;
  tool_output?: unknown;
  /**
   * Workspace roots reported by Cursor's agent CLI. Used as a `cwd` fallback:
   * the CLI's `postToolUse` payload reports an empty `cwd`, while the workspace
   * root is the accurate working directory.
   */
  workspace_roots?: unknown;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function nonEmptyString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * Extract the observed result from Cursor's `tool_output`. For the Shell tool it
 * is a JSON string carrying the exit code and command output — the agent CLI
 * uses `{"output":"...","exitCode":n}`, the IDE docs show
 * `{"exitCode":n,"stdout":"..."}`; both `output` and `stdout` are accepted. A
 * non-JSON value is tolerated by treating the raw string as stdout (the observed
 * output is still real; the exit code defaults to 0 only in that
 * malformed-payload fallback, matching the Claude Code adapter's robustness).
 */
function parseToolOutput(raw: unknown): { exitCode: number; stdout: string; stderr: string } {
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed === 'object' && parsed !== null) {
        const obj = parsed as Record<string, unknown>;
        const code = obj['exitCode'];
        return {
          exitCode: typeof code === 'number' ? code : 0,
          stdout: asString(obj['output']) ?? asString(obj['stdout']) ?? '',
          stderr: asString(obj['stderr']) ?? '',
        };
      }
    } catch {
      // Not JSON — treat the raw string as observed stdout (best-effort).
      return { exitCode: 0, stdout: raw, stderr: '' };
    }
  }
  // Some payloads may already deliver an object rather than a JSON string.
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, unknown>;
    const code = obj['exitCode'];
    return {
      exitCode: typeof code === 'number' ? code : 0,
      stdout: asString(obj['stdout']) ?? '',
      stderr: asString(obj['stderr']) ?? '',
    };
  }
  return { exitCode: 0, stdout: '', stderr: '' };
}

/**
 * Record a Cursor `postToolUse` payload as a Level-2 witness event.
 *
 * Only `Shell` tool calls are witnessed (they carry a shell command + the real
 * exit code/stdout inside `tool_output`). Any other tool, or a payload with no
 * command, returns `{ recorded: false, reason }` so the caller can no-op
 * without disrupting Cursor.
 */
export async function witnessCursorPostToolUse(
  payload: CursorPostToolUsePayload,
  opts: CursorWitnessOptions
): Promise<CursorWitnessResult> {
  const toolName = asString(payload.tool_name);
  if (toolName !== 'Shell') {
    return { recorded: false, reason: `unsupported tool: ${toolName ?? '<none>'} (only Shell is witnessed)` };
  }

  const input = (typeof payload.tool_input === 'object' && payload.tool_input !== null
    ? payload.tool_input
    : {}) as Record<string, unknown>;

  const command = asString(input['command']);
  if (command === undefined || command.length === 0) {
    return { recorded: false, reason: 'tool_input.command missing or empty' };
  }

  const { exitCode, stdout, stderr } = parseToolOutput(payload.tool_output);
  // Cursor's agent CLI reports an empty `cwd`; fall back to the workspace root,
  // then the process cwd. recordWitnessedExecution requires a non-empty cwd.
  const roots = Array.isArray(payload.workspace_roots) ? payload.workspace_roots : [];
  const cwd = nonEmptyString(payload.cwd) ?? nonEmptyString(roots[0]) ?? process.cwd();

  const result = await recordWitnessedExecution({
    command,
    cwd,
    exitCode,
    stdout,
    stderr,
    agentId: opts.agentId ?? 'cursor',
    dataDir: opts.dataDir,
    ...(opts.segmentId !== undefined ? { segmentId: opts.segmentId } : {}),
  });

  return { recorded: true, result };
}
