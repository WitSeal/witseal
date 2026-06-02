/**
 * MCP server — witseal-side mediation core (own-execute, Level 3).
 *
 * This is the framework-agnostic half of the integration the adapter contract
 * (src/adapters/README.md) requires. It maps a single freeform shell command
 * into a witseal `runExec` invocation and surfaces the result. WitSeal OWNS
 * execution (classify -> policy -> mediate -> witness -> receipt), so the
 * resulting receipt is a full execution receipt, not merely a witnessed
 * decision — the same Level-3 property the OpenCode integration has, but
 * reached from any MCP client rather than one specific agent.
 *
 * This module has NO MCP dependency and is unit-testable on its own. The
 * protocol surface (the newline-delimited JSON-RPC stdio server) lives in
 * `server.ts`; it calls `mediateMcpShell` and renders the result as a tool
 * response. Keeping the two apart mirrors the OpenCode integration's split
 * between `mediate.ts` (core) and its registration shim.
 *
 * Scope note: this integration lets WitSeal expose ITS OWN witnessed shell
 * tool through MCP. It does NOT intercept or mediate calls an agent makes to
 * other MCP servers — that broader tool-call mediation is a separate, later
 * runtime layer. The honest claim here is "use WitSeal's witnessed execution
 * from any MCP client", not "WitSeal sees all your MCP traffic".
 */

import { runExec, type ExecOptions } from '../../cli/exec.js';

/** WitSeal's reserved exit code for a Gate denial (deny-by-default block). */
export const WITSEAL_DENIED_EXIT = 100;

/** A single shell tool call, reduced to what the mediation core needs. */
export interface McpShellCall {
  /** The freeform shell command string from the tool call. */
  command: string;
  /** Working directory for the command (defaults to the server's cwd). */
  cwd?: string;
}

/** Options binding the mediation to a witseal data directory / segment / mode. */
export interface McpMediateOptions {
  dataDir: string;
  segmentId?: string;
  agentId?: string;
  /** Execution mode. Defaults to witseal's default (Gate, deny-by-default). */
  mode?: ExecOptions['mode'];
  /** Optional execution timeout in ms. 0 / omitted means no timeout. */
  timeoutMs?: number;
}

/** Outcome of mediating an MCP shell call through witseal. */
export interface McpMediationResult {
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
 * Mediate a shell tool call through the witseal pipeline.
 *
 * Never bypasses witseal: the action is executed only via `runExec`. In Gate
 * mode a `deny` decision blocks execution and returns `WITSEAL_DENIED_EXIT`.
 * The mediated command's stdout is captured (via the `onStdout` sink) so the
 * caller can return it as the tool result — it never reaches the process's own
 * stdout, which an MCP stdio server reserves for the JSON-RPC channel.
 */
export async function mediateMcpShell(
  call: McpShellCall,
  opts: McpMediateOptions
): Promise<McpMediationResult> {
  let captured = '';
  const exitCode = await runExec({
    command: '/bin/sh',
    args: ['-c', call.command],
    agentId: opts.agentId ?? 'mcp-client',
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
