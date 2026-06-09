/**
 * Pi adapter — witnessed bash tool shim (author-the-tool, Level 3).
 *
 * Pi (`@earendil-works/pi-coding-agent`, MIT) is a minimal, deeply customizable
 * TypeScript terminal coding agent. Its built-in toolset is `read` / `write` /
 * `edit` / `bash`, and an extension registers a custom tool with `registerTool`:
 *
 *   pi.registerTool({
 *     name, label, description,
 *     parameters: Type.Object({ ... }),               // a TypeBox schema
 *     execute(toolCallId, params, signal, onUpdate, ctx) {
 *       return { content: [{ type: 'text', text }], details };
 *     },
 *   });
 *
 * (Shape verified against the project's extension docs and SDK examples on
 * 2026-06-08: a tool is `{ name, label, description, parameters, execute }`,
 * `parameters` is a TypeBox `Type.Object(...)`, and `execute` returns
 * `{ content: [{ type: 'text', text }], details }`.)
 *
 * `createWitsealPiTool` returns exactly that object, already wired: `execute` is
 * the shared witseal tool body (`runShellTool`) and the command is read from the
 * validated `params`. The only line the integrator writes is the framework
 * binding — `pi.registerTool(createWitsealPiTool({ dataDir }))`. Because the body
 * runs the command through witseal's `runExec`, witseal OWNS execution and an
 * allowed call yields a full execution receipt, not merely a witnessed decision.
 *
 * Dependency note: no `@earendil-works/*` and no TypeBox package is imported here
 * — the witseal runtime keeps its minimal dependency set (commander, zod; cf.
 * ADR-0003), exactly as every sibling shim does. Pi requires its `parameters`
 * field to be a TypeBox schema, and a TypeBox `Type.Object(...)` IS a JSON-Schema
 * object at runtime, so the factory emits an equivalent JSON-Schema object
 * literal derived from the shared `shellToolSchema` by default. An integrator who
 * would rather hand in the schema built with their own installed TypeBox can pass
 * a `parameters` override (e.g. `Type.Object({ ... })`).
 *
 * Level note: this is Level 3 (author-the-tool). Pi's bash `spawnHook`
 * (`createBashTool(cwd, { spawnHook })`) is the other own-execute seam — it can
 * rewrite the spawned command — but it is an executor swap on a single built-in,
 * whereas registering this tool gives the agent a witnessed execution path
 * directly. Either way witseal owns the bytes that run; see `COVERAGE.md`.
 */

import {
  runShellTool,
  DEFAULT_SHELL_TOOL_NAME,
  DEFAULT_SHELL_TOOL_DESCRIPTION,
  type ShellToolInput,
  type WitsealShellToolOptions,
} from '../framework/tool.js';

/** Default agent identifier recorded for a Pi-hosted tool call. */
export const DEFAULT_PI_AGENT_ID = 'pi';

/** Default human label Pi shows for the witnessed tool. */
export const DEFAULT_PI_TOOL_LABEL = 'WitSeal Shell';

/**
 * A JSON-Schema object literal describing the witnessed tool's input. A TypeBox
 * `Type.Object(...)` produces an object of exactly this shape at runtime, so Pi
 * accepts this as its `parameters` schema with no TypeBox package imported here.
 * It mirrors the shared `shellToolSchema` (`command` required, `cwd` optional).
 */
export interface PiToolParameters {
  type: 'object';
  properties: {
    command: { type: 'string'; description: string };
    cwd: { type: 'string'; description: string };
  };
  required: ['command'];
  additionalProperties: false;
}

/** The default `parameters` schema, derived from the shared `shellToolSchema`. */
export const DEFAULT_PI_TOOL_PARAMETERS: PiToolParameters = {
  type: 'object',
  properties: {
    command: { type: 'string', description: 'The shell command to run.' },
    cwd: {
      type: 'string',
      description: "Optional working directory. Defaults to the tool host's working directory.",
    },
  },
  required: ['command'],
  additionalProperties: false,
};

/** A single text content block in Pi's tool result. */
export interface PiToolTextContent {
  type: 'text';
  text: string;
}

/** The result object Pi expects back from a tool's `execute`. */
export interface PiToolResult {
  content: PiToolTextContent[];
  details: Record<string, unknown>;
  /** Pi marks a failed tool call with `isError: true`; set on a Gate denial. */
  isError?: boolean;
}

/**
 * The tool-definition object accepted by Pi's `pi.registerTool({...})`.
 * `parameters` is a TypeBox-compatible JSON-Schema object; `execute` is the
 * witnessed body. Pass straight through:
 *
 *   pi.registerTool(createWitsealPiTool({ dataDir }));
 */
export interface PiWitsealShellTool {
  name: string;
  label: string;
  description: string;
  parameters: PiToolParameters | object;
  execute: (
    toolCallId: string,
    params: ShellToolInput,
    signal?: unknown,
    onUpdate?: unknown,
    ctx?: unknown
  ) => Promise<PiToolResult>;
}

/**
 * Options for building a witnessed Pi tool: the witseal mediation binding plus an
 * optional `parameters` override (e.g. a schema built with the integrator's own
 * installed TypeBox) and the `label` Pi displays.
 */
export interface WitsealPiToolOptions extends WitsealShellToolOptions {
  /** Override the TypeBox/JSON-Schema `parameters`. Defaults to {@link DEFAULT_PI_TOOL_PARAMETERS}. */
  parameters?: object;
  /** Human label Pi shows. Defaults to {@link DEFAULT_PI_TOOL_LABEL}. */
  label?: string;
}

/**
 * Build a witnessed Pi `shell` tool definition for `pi.registerTool({...})`.
 *
 * `execute` mediates every call through witseal (Gate, deny-by-default unless a
 * policy pack allows it). `runShellTool` throws on a Gate denial; the shim
 * catches that and returns Pi's error-shaped result (`isError: true`) so the
 * agent sees the action did not run, while witseal still records it as
 * `denied_by_policy`. An allowed command (even a non-zero exit) returns normally
 * — it ran and was witnessed. `agentId` defaults to {@link DEFAULT_PI_AGENT_ID};
 * the tool name defaults to {@link DEFAULT_SHELL_TOOL_NAME} (`shell`).
 */
export function createWitsealPiTool(opts: WitsealPiToolOptions): PiWitsealShellTool {
  const mediateOpts: WitsealShellToolOptions = {
    ...opts,
    agentId: opts.agentId ?? DEFAULT_PI_AGENT_ID,
  };
  return {
    name: opts.name ?? DEFAULT_SHELL_TOOL_NAME,
    label: opts.label ?? DEFAULT_PI_TOOL_LABEL,
    description: opts.description ?? DEFAULT_SHELL_TOOL_DESCRIPTION,
    parameters: opts.parameters ?? DEFAULT_PI_TOOL_PARAMETERS,
    execute: async (
      _toolCallId: string,
      params: ShellToolInput
    ): Promise<PiToolResult> => {
      try {
        const text = await runShellTool(params, mediateOpts);
        return { content: [{ type: 'text', text }], details: {} };
      } catch (err) {
        // A Gate denial (deny-by-default) is thrown by runShellTool. Surface it
        // as a Pi tool error so the model sees the command did not run; witseal
        // already recorded it as denied_by_policy evidence.
        const text = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text }], details: {}, isError: true };
      }
    },
  };
}
