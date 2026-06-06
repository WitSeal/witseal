/**
 * Mastra adapter — witnessed shell tool shim (author-the-tool, Level 3).
 *
 * Mastra's `createTool()` helper (from `@mastra/core/tools`) takes a single
 * config object whose `execute` is the tool body:
 *
 *   createTool({ id, description, inputSchema, execute })   // inputSchema is a zod schema
 *
 * (Signature verified against the installed package `@mastra/core` `1.41.0`:
 * `createTool` accepts the config object verbatim — `inputSchema` is a Zod
 * schema and `execute` is the local async fn the tool runs.)
 *
 * `createWitsealMastraTool` returns exactly that object, already wired:
 * `execute` is the shared witseal tool body (`runShellTool`) and `inputSchema`
 * is the shared input schema. The only line the integrator writes is the
 * framework binding — `createTool(createWitsealMastraTool({ dataDir }))` — so no
 * `@mastra` package is imported here and the witseal runtime keeps its minimal
 * dependency set (commander, zod; cf. ADR-0003). Because the body runs the
 * command through witseal's `runExec`, witseal OWNS execution and an allowed
 * call yields a full execution receipt.
 *
 * Mastra passes its tool body a single `{ context, ... }` argument whose
 * `context` is the validated input. The shim accepts that envelope (and a bare
 * input, for a direct call) and unwraps it before mediation.
 *
 * Level note: this is Level 3 (author-the-tool). Mastra's input/output schema
 * validation sits beside the model and would only constrain an already-decided
 * call (Level 2); it is not the target here.
 */

import {
  runShellTool,
  shellToolSchema,
  DEFAULT_SHELL_TOOL_NAME,
  DEFAULT_SHELL_TOOL_DESCRIPTION,
  type ShellToolInput,
  type WitsealShellToolOptions,
} from '../framework/tool.js';

/** Default agent identifier recorded for a Mastra tool call. */
export const DEFAULT_MASTRA_AGENT_ID = 'mastra';

/**
 * Mastra invokes a tool's `execute` with an execution context envelope whose
 * `context` field carries the validated input. Accept either the envelope or a
 * bare input (e.g. a direct call in a test harness).
 */
export type MastraToolExecuteArg = ShellToolInput | { context: ShellToolInput };

function unwrapInput(arg: MastraToolExecuteArg): ShellToolInput {
  return arg !== null && typeof arg === 'object' && 'context' in arg
    ? (arg as { context: ShellToolInput }).context
    : (arg as ShellToolInput);
}

/**
 * The config object accepted by the Mastra `createTool({...})` helper.
 * `inputSchema` is the shared zod input schema; `execute` is the witnessed body.
 * Pass straight through:
 *
 *   const witsealShell = createTool(createWitsealMastraTool({ dataDir }));
 */
export interface MastraWitsealShellTool {
  id: string;
  description: string;
  inputSchema: typeof shellToolSchema;
  execute: (arg: MastraToolExecuteArg) => Promise<string>;
}

/**
 * Build a witnessed Mastra `shell` tool config.
 *
 * `execute` mediates every call through witseal (Gate, deny-by-default unless a
 * policy pack allows it); a denial is thrown so the agent sees the action
 * failed. `agentId` defaults to {@link DEFAULT_MASTRA_AGENT_ID}. The tool id
 * defaults to {@link DEFAULT_SHELL_TOOL_NAME} (`shell`).
 */
export function createWitsealMastraTool(
  opts: WitsealShellToolOptions
): MastraWitsealShellTool {
  const mediateOpts: WitsealShellToolOptions = {
    ...opts,
    agentId: opts.agentId ?? DEFAULT_MASTRA_AGENT_ID,
  };
  return {
    id: opts.name ?? DEFAULT_SHELL_TOOL_NAME,
    description: opts.description ?? DEFAULT_SHELL_TOOL_DESCRIPTION,
    inputSchema: shellToolSchema,
    execute: (arg: MastraToolExecuteArg): Promise<string> =>
      runShellTool(unwrapInput(arg), mediateOpts),
  };
}
