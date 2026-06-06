/**
 * GitHub Copilot SDK adapter — witnessed shell tool shim (author-the-tool,
 * Level 3).
 *
 * The GitHub Copilot SDK `defineTool()` helper (from `@github/copilot-sdk`)
 * takes a tool name plus a config object whose `handler` is the tool body:
 *
 *   defineTool(name, { description, parameters, handler })   // parameters is a zod schema
 *
 * and `client.createSession({ tools: [tool] })` registers it. A `Tool` is the
 * plain object `{ name, description, parameters, handler }`, so a tool can also
 * be handed to `createSession` directly without `defineTool` (the helper only
 * adds handler-argument type inference). The `handler` signature is
 * `(args, invocation) => result`.
 *
 * (Signature verified against the installed package `@github/copilot-sdk`
 * `1.0.0` on 2026-06-05: `defineTool<T>(name, { description?, parameters?,
 * handler?, ... }): Tool<T>`; `ToolHandler<TArgs> = (args, invocation) =>
 * Promise<unknown> | unknown`.)
 *
 * `createWitsealCopilotTool` returns exactly that `Tool` object, already wired:
 * `handler` is the shared witseal tool body (`runShellTool`) and `parameters`
 * is the shared input schema. The only line the integrator writes is the
 * framework binding — `defineTool(t.name, t)` or
 * `client.createSession({ tools: [t] })` — so no `@github/copilot-sdk` package
 * is imported here and the witseal runtime keeps its minimal dependency set.
 * Because the body runs the command through witseal's `runExec`, witseal OWNS
 * execution and an allowed call yields a full execution receipt.
 *
 * Level note: this is Level 3 (author-the-tool). The SDK's permission prompts
 * and pre/post tool-use hooks sit beside the model and would only observe or
 * gate an already-decided call (Level 2); they are not the target here.
 */

import {
  runShellTool,
  shellToolSchema,
  DEFAULT_SHELL_TOOL_NAME,
  DEFAULT_SHELL_TOOL_DESCRIPTION,
  type ShellToolInput,
  type WitsealShellToolOptions,
} from '../framework/tool.js';

/** Default agent identifier recorded for a GitHub Copilot SDK tool call. */
export const DEFAULT_COPILOT_AGENT_ID = 'github-copilot-sdk';

/**
 * Per-call context the GitHub Copilot SDK passes as the handler's second
 * argument (`ToolInvocation`). It carries the session and tool-call identifiers
 * the runtime assigned; the witnessed body does not require it. Declared
 * structurally so no `@github/copilot-sdk` type is imported.
 */
export interface CopilotToolInvocation {
  sessionId: string;
  toolCallId: string;
  toolName: string;
  arguments: unknown;
}

/**
 * The `Tool` object accepted by the GitHub Copilot SDK `defineTool(name, ...)`
 * helper and by `client.createSession({ tools })`. `parameters` is the shared
 * zod input schema; `handler` is the witnessed body. Pass straight through:
 *
 *   const t = createWitsealCopilotTool({ dataDir });
 *   const witsealShell = defineTool(t.name, t);
 *   // or: await client.createSession({ tools: [t], ... });
 */
export interface CopilotWitsealShellTool {
  name: string;
  description: string;
  parameters: typeof shellToolSchema;
  handler: (args: ShellToolInput, invocation?: CopilotToolInvocation) => Promise<string>;
}

/**
 * Build a witnessed GitHub Copilot SDK `shell` tool.
 *
 * `handler` mediates every call through witseal (Gate, deny-by-default unless a
 * policy pack allows it); a denial is thrown so the agent sees the action
 * failed. The second `invocation` argument (session / tool-call ids) is accepted
 * to match the SDK's `ToolHandler` shape but is not needed by the witnessed
 * body. `agentId` defaults to {@link DEFAULT_COPILOT_AGENT_ID}.
 */
export function createWitsealCopilotTool(
  opts: WitsealShellToolOptions
): CopilotWitsealShellTool {
  const mediateOpts: WitsealShellToolOptions = {
    ...opts,
    agentId: opts.agentId ?? DEFAULT_COPILOT_AGENT_ID,
  };
  return {
    name: opts.name ?? DEFAULT_SHELL_TOOL_NAME,
    description: opts.description ?? DEFAULT_SHELL_TOOL_DESCRIPTION,
    parameters: shellToolSchema,
    handler: (args: ShellToolInput, _invocation?: CopilotToolInvocation): Promise<string> =>
      runShellTool(args, mediateOpts),
  };
}
