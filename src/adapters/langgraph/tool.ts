/**
 * LangGraph adapter — witnessed shell tool shim (author-the-tool, Level 3).
 *
 * LangChain's `tool()` helper (from `@langchain/core/tools`, used throughout
 * LangGraph) takes the implementation function first, then a config object:
 *
 *   tool(func, { name, description, schema })   // schema is a zod schema
 *
 * (Signature verified against the official docs on 2026-06-01:
 * https://docs.langchain.com/oss/javascript/langchain/tools.)
 *
 * `createWitsealShellTool` returns exactly those two arguments, already wired:
 * `func` is the shared witseal tool body (`runShellTool`), and `config` carries
 * the shared input schema, name, and description. The only line the integrator
 * writes is the framework binding — `tool(func, config)` — so no `@langchain`
 * package is imported here and the witseal runtime keeps its minimal dependency
 * set. Because the body runs the command through witseal's `runExec`, witseal
 * OWNS execution and an allowed call yields a full execution receipt.
 *
 * Level note: this is Level 3 (author-the-tool). LangGraph callbacks /
 * `on_tool_end` would only observe an already-decided tool call (Level 2); they
 * are not the target here.
 */

import {
  runShellTool,
  shellToolSchema,
  DEFAULT_SHELL_TOOL_NAME,
  DEFAULT_SHELL_TOOL_DESCRIPTION,
  type ShellToolInput,
  type WitsealShellToolOptions,
} from '../framework/tool.js';

/** Default agent identifier recorded for a LangGraph-hosted tool call. */
export const DEFAULT_LANGGRAPH_AGENT_ID = 'langgraph';

/**
 * The config object passed as the second argument of LangChain's
 * `tool(func, config)`. `schema` is the shared zod input schema.
 */
export interface LangGraphToolConfig {
  name: string;
  description: string;
  schema: typeof shellToolSchema;
}

/**
 * A witnessed shell tool ready to register with LangChain's
 * `tool(func, config)`. Destructure and pass straight through:
 *
 *   const { func, config } = createWitsealShellTool({ dataDir });
 *   const witsealShell = tool(func, config);
 */
export interface LangGraphWitsealShellTool {
  func: (input: ShellToolInput) => Promise<string>;
  config: LangGraphToolConfig;
}

/**
 * Build the arguments for a witnessed LangGraph `shell` tool.
 *
 * The returned `func` mediates every call through witseal (Gate, deny-by-default
 * unless a policy pack allows it); a denial is thrown so the graph sees the
 * action failed. `agentId` defaults to {@link DEFAULT_LANGGRAPH_AGENT_ID}.
 */
export function createWitsealShellTool(
  opts: WitsealShellToolOptions
): LangGraphWitsealShellTool {
  const mediateOpts: WitsealShellToolOptions = {
    ...opts,
    agentId: opts.agentId ?? DEFAULT_LANGGRAPH_AGENT_ID,
  };
  return {
    func: (input: ShellToolInput): Promise<string> => runShellTool(input, mediateOpts),
    config: {
      name: opts.name ?? DEFAULT_SHELL_TOOL_NAME,
      description: opts.description ?? DEFAULT_SHELL_TOOL_DESCRIPTION,
      schema: shellToolSchema,
    },
  };
}
