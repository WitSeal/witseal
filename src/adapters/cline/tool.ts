/**
 * Cline adapter — witnessed shell tool shim (author-the-tool, Level 3).
 *
 * Cline (the open-source, Apache-2.0 VS Code agent) exposes a plugin/tool SDK
 * built around a `createTool()` helper and an `AgentPlugin.setup(api)` entry
 * point that registers tools on the host:
 *
 *   const t = createTool({ name, description, inputSchema, execute });
 *   const plugin: AgentPlugin = { setup(api) { api.registerTool(t); } };
 *
 * `inputSchema` is a zod schema, and `execute` is the tool body the host calls
 * with the validated input (Cline passes a context envelope whose `input` field
 * carries it). `createWitsealClineTool` returns exactly the object that helper
 * consumes, already wired: `execute` is the shared witseal tool body
 * (`runShellTool`) and `inputSchema` is the shared input schema. The only line
 * the integrator writes is the framework binding —
 * `createTool(createWitsealClineTool({ dataDir }))` and `api.registerTool(...)`
 * — so no Cline package is imported here and the witseal runtime keeps its
 * minimal dependency set (commander, zod). Because the body runs the command
 * through witseal's `runExec`, witseal OWNS execution and an allowed call
 * yields a full execution receipt, not merely a witnessed decision.
 *
 * Cline invokes a tool's `execute` with an execution-context envelope whose
 * `input` field carries the validated arguments; the shim accepts that envelope
 * (and a bare input, for a direct call in a test harness) and unwraps it before
 * mediation.
 *
 * Level note: this is Level 3 (author-the-tool). Cline's approval prompts and
 * auto-approve settings sit beside the model and would only observe or gate an
 * already-decided call (Level 2); they are not the target here.
 */

import {
  runShellTool,
  shellToolSchema,
  DEFAULT_SHELL_TOOL_NAME,
  DEFAULT_SHELL_TOOL_DESCRIPTION,
  type ShellToolInput,
  type WitsealShellToolOptions,
} from '../framework/tool.js';

/** Default agent identifier recorded for a Cline-hosted tool call. */
export const DEFAULT_CLINE_AGENT_ID = 'cline';

/**
 * Per-call context Cline passes a registered tool's `execute` as the second
 * argument. It carries the host-assigned task / tool-call identifiers and the
 * abort signal; the witnessed body does not require it. Declared structurally
 * so no Cline type is imported.
 */
export interface ClineToolContext {
  taskId: string;
  toolCallId: string;
  signal?: AbortSignal;
}

/**
 * Cline invokes a tool's `execute` with an execution-context envelope whose
 * `input` field carries the validated input. Accept either the envelope or a
 * bare input (e.g. a direct call in a test harness).
 */
export type ClineToolExecuteArg = ShellToolInput | { input: ShellToolInput };

function unwrapInput(arg: ClineToolExecuteArg): ShellToolInput {
  return arg !== null && typeof arg === 'object' && 'input' in arg
    ? (arg as { input: ShellToolInput }).input
    : (arg as ShellToolInput);
}

/**
 * The tool object accepted by Cline's `createTool({...})` helper and by
 * `api.registerTool(...)` inside `AgentPlugin.setup(api)`. `inputSchema` is the
 * shared zod input schema; `execute` is the witnessed body. Pass straight
 * through:
 *
 *   const witsealShell = createTool(createWitsealClineTool({ dataDir }));
 *   const plugin = { setup(api) { api.registerTool(witsealShell); } };
 */
export interface ClineWitsealShellTool {
  name: string;
  description: string;
  inputSchema: typeof shellToolSchema;
  execute: (arg: ClineToolExecuteArg, context?: ClineToolContext) => Promise<string>;
}

/**
 * Build a witnessed Cline `shell` tool.
 *
 * `execute` mediates every call through witseal (Gate, deny-by-default unless a
 * policy pack allows it); a denial is thrown so the agent sees the action
 * failed. The second `context` argument (task / tool-call ids, abort signal) is
 * accepted to match Cline's tool-body shape but is not needed by the witnessed
 * body. `agentId` defaults to {@link DEFAULT_CLINE_AGENT_ID}. The tool name
 * defaults to {@link DEFAULT_SHELL_TOOL_NAME} (`shell`).
 */
export function createWitsealClineTool(
  opts: WitsealShellToolOptions
): ClineWitsealShellTool {
  const mediateOpts: WitsealShellToolOptions = {
    ...opts,
    agentId: opts.agentId ?? DEFAULT_CLINE_AGENT_ID,
  };
  return {
    name: opts.name ?? DEFAULT_SHELL_TOOL_NAME,
    description: opts.description ?? DEFAULT_SHELL_TOOL_DESCRIPTION,
    inputSchema: shellToolSchema,
    execute: (arg: ClineToolExecuteArg, _context?: ClineToolContext): Promise<string> =>
      runShellTool(unwrapInput(arg), mediateOpts),
  };
}
