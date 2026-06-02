/**
 * Framework adapter — shared witnessed-shell tool contract (author-the-tool,
 * Level 3).
 *
 * `mediate.ts` is the witseal-side mediation core (`mediateShellCommand`). This
 * module is its tool-shaped companion: the single input contract (a zod schema),
 * the tool name/description, and the tool *body* every per-framework shim wraps.
 *
 * The body — `runShellTool` — mediates the command through witseal and renders
 * the result the way a model-facing tool returns. Because witseal own-executes
 * the command (classify -> policy -> mediate -> witness -> receipt), an allowed
 * call yields a full execution receipt, not merely a witnessed decision.
 *
 * Keeping the schema and body here means each per-framework shim
 * (`langgraph/tool.ts`, `openai-agents/tool.ts`) is only the framework-shaped
 * registration: it arranges these shared pieces into the exact object that
 * framework's `tool()` helper expects. No framework is imported here or in the
 * shims — the witseal runtime keeps its dependency set minimal (commander, zod;
 * cf. ADR-0003), exactly as the MCP server hand-rolls its protocol rather than
 * pull in an SDK. This module has no framework dependency and is unit-testable
 * on its own.
 */

import { z } from 'zod';
import {
  mediateShellCommand,
  type FrameworkMediateOptions,
  type ShellCommandCall,
} from './mediate.js';

/** Default name the framework shims register the witnessed shell tool under. */
export const DEFAULT_SHELL_TOOL_NAME = 'shell';

/** Default model-facing description (on-vocabulary), shared by the shims. */
export const DEFAULT_SHELL_TOOL_DESCRIPTION =
  'Run a shell command, mediated and witnessed by WitSeal. The command is ' +
  'classified, checked against policy (deny-by-default), executed by ' +
  "WitSeal's mediator, and recorded as a full execution receipt in an " +
  'evidence chain. A command denied by policy does not run.';

/**
 * Input contract for the witnessed shell tool. A zod schema is exactly what
 * both target SDKs accept: LangChain's `tool(func, { schema })` and the OpenAI
 * Agents SDK's `tool({ parameters })`.
 */
export const shellToolSchema = z.object({
  command: z.string().describe('The shell command to run.'),
  cwd: z
    .string()
    .optional()
    .describe("Optional working directory. Defaults to the tool host's working directory."),
});

/** Parsed input of the witnessed shell tool. */
export type ShellToolInput = z.infer<typeof shellToolSchema>;

/**
 * Options for building a witnessed shell tool: the witseal mediation binding
 * (data directory / segment / agent id / mode / timeout) plus optional
 * overrides for the registered tool name and description.
 */
export interface WitsealShellToolOptions extends FrameworkMediateOptions {
  /** Tool name to register. Defaults to {@link DEFAULT_SHELL_TOOL_NAME}. */
  name?: string;
  /** Tool description shown to the model. Defaults to {@link DEFAULT_SHELL_TOOL_DESCRIPTION}. */
  description?: string;
}

/**
 * The witnessed shell tool body: mediate `input` through witseal and return a
 * model-facing result string.
 *
 * Never bypasses witseal — the command runs only via `runExec` inside
 * `mediateShellCommand`. A Gate denial (deny-by-default) is surfaced as a thrown
 * error so the framework records the tool call as failed and the model sees the
 * action did not run; it is recorded as `denied_by_policy` regardless. Otherwise
 * the captured stdout is appended to the witseal status summary. A non-zero exit
 * from an *allowed* command is a normal result (the command ran and was
 * witnessed), so it is returned, not thrown.
 */
export async function runShellTool(
  input: ShellToolInput,
  opts: FrameworkMediateOptions
): Promise<string> {
  const call: ShellCommandCall = {
    command: input.command,
    ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
  };
  const { summary, output, denied } = await mediateShellCommand(call, opts);
  if (denied) throw new Error(summary);
  return output.length > 0 ? `${summary}\n\n${output}` : summary;
}
