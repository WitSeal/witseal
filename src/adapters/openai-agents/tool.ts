/**
 * OpenAI Agents SDK adapter — witnessed shell tool shim (author-the-tool,
 * Level 3).
 *
 * The OpenAI Agents SDK `tool()` helper (from `@openai/agents`) takes a single
 * config object whose `execute` is the tool body:
 *
 *   tool({ name, description, parameters, execute })   // parameters is a zod schema
 *
 * (Signature verified against the official docs on 2026-06-01:
 * https://openai.github.io/openai-agents-js/guides/tools/.)
 *
 * `createWitsealShellTool` returns exactly that object, already wired: `execute`
 * is the shared witseal tool body (`runShellTool`) and `parameters` is the
 * shared input schema. The only line the integrator writes is the framework
 * binding — `tool(createWitsealShellTool({ dataDir }))` — so no `@openai`
 * package is imported here and the witseal runtime keeps its minimal dependency
 * set. Because the body runs the command through witseal's `runExec`, witseal
 * OWNS execution and an allowed call yields a full execution receipt.
 *
 * Level note: this is Level 3 (author-the-tool). The SDK's input/output
 * validation features sit beside the model and would only constrain an
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

/** Default agent identifier recorded for an OpenAI Agents SDK tool call. */
export const DEFAULT_OPENAI_AGENTS_AGENT_ID = 'openai-agents';

/**
 * The config object accepted by the OpenAI Agents SDK `tool({...})` helper.
 * `parameters` is the shared zod input schema; `execute` is the witnessed body.
 * Pass straight through:
 *
 *   const witsealShell = tool(createWitsealShellTool({ dataDir }));
 */
export interface OpenAIAgentsWitsealShellTool {
  name: string;
  description: string;
  parameters: typeof shellToolSchema;
  execute: (input: ShellToolInput) => Promise<string>;
}

/**
 * Build a witnessed OpenAI Agents SDK `shell` function tool config.
 *
 * `execute` mediates every call through witseal (Gate, deny-by-default unless a
 * policy pack allows it); a denial is thrown so the agent sees the action
 * failed. `agentId` defaults to {@link DEFAULT_OPENAI_AGENTS_AGENT_ID}.
 */
export function createWitsealShellTool(
  opts: WitsealShellToolOptions
): OpenAIAgentsWitsealShellTool {
  const mediateOpts: WitsealShellToolOptions = {
    ...opts,
    agentId: opts.agentId ?? DEFAULT_OPENAI_AGENTS_AGENT_ID,
  };
  return {
    name: opts.name ?? DEFAULT_SHELL_TOOL_NAME,
    description: opts.description ?? DEFAULT_SHELL_TOOL_DESCRIPTION,
    parameters: shellToolSchema,
    execute: (input: ShellToolInput): Promise<string> => runShellTool(input, mediateOpts),
  };
}
