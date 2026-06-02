/**
 * MCP server — protocol surface for witseal's own witnessed shell tool.
 *
 * A minimal, dependency-free Model Context Protocol server over the stdio
 * transport. MCP stdio framing is newline-delimited JSON-RPC 2.0 (UTF-8, no
 * embedded newlines), per the MCP specification (2025-06-18 §Transports). The
 * server surface witseal needs is small and stable — `initialize`,
 * `tools/list`, `tools/call`, `ping`, and the `initialized` notification — so
 * it is implemented directly rather than pulling a protocol SDK into the trust
 * runtime. Keeping the dependency set minimal (commander, zod) is a deliberate
 * project property (see ADR-0003): the fewer moving parts inside the runtime
 * that produces evidence, the easier that runtime is to audit.
 *
 * `handleMessage` is a pure async function from one JSON-RPC message to its
 * response (or `null` for notifications), independent of stdio — so the whole
 * protocol surface is unit-testable without spawning a process. `startMcpServer`
 * is the thin stdio loop around it.
 *
 * The single tool exposed is `shell`: a freeform shell command, mediated and
 * witnessed by witseal. Because witseal own-executes the command, every call
 * yields a full execution receipt (Level 3), not merely a witnessed decision.
 */

import { createInterface } from 'node:readline';
import { mediateMcpShell, type McpMediateOptions, type McpMediationResult } from './mediate.js';
import { WITSEAL_VERSION } from '../../version.js';

/** Protocol versions this server recognizes; newest first. */
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;
/** Reported when the client requests a version we do not recognize. */
export const DEFAULT_PROTOCOL_VERSION = '2025-06-18';

/** The single tool this server exposes. */
export const SHELL_TOOL = {
  name: 'shell',
  description:
    'Run a shell command, mediated and witnessed by WitSeal. The command is ' +
    'classified, checked against policy (deny-by-default), executed by ' +
    "WitSeal's mediator, and recorded as a full execution receipt in an " +
    'evidence chain. A command denied by policy does not run.',
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to run.',
      },
      cwd: {
        type: 'string',
        description: "Optional working directory. Defaults to the server's working directory.",
      },
    },
    required: ['command'],
    additionalProperties: false,
  },
} as const;

/** JSON-RPC 2.0 id: string, number, or null. Absent on notifications. */
type JsonRpcId = string | number | null;

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** Context the message handler needs. The mediate function is injectable for tests. */
export interface ServerContext {
  serverOptions: McpMediateOptions;
  mediate?: (call: { command: string; cwd?: string }, opts: McpMediateOptions) => Promise<McpMediationResult>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function ok(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function err(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/**
 * Handle one parsed JSON-RPC message. Returns the response object, or `null`
 * when the message is a notification (no `id`) that takes no reply.
 */
export async function handleMessage(
  msg: unknown,
  ctx: ServerContext
): Promise<JsonRpcResponse | null> {
  if (!isRecord(msg) || msg['jsonrpc'] !== '2.0' || typeof msg['method'] !== 'string') {
    // Malformed; reply only if we can see an id, else stay silent.
    const id = isRecord(msg) && isJsonRpcId(msg['id']) ? msg['id'] : null;
    return err(id, -32600, 'Invalid Request');
  }

  const method = msg['method'];
  const hasId = 'id' in msg && isJsonRpcId(msg['id']);
  const id: JsonRpcId = hasId ? (msg['id'] as JsonRpcId) : null;
  const params = isRecord(msg['params']) ? msg['params'] : {};

  // Notifications (no id) take no response.
  if (!hasId) {
    // initialized / cancelled / progress — nothing to do for this server.
    return null;
  }

  switch (method) {
    case 'initialize': {
      const requested = params['protocolVersion'];
      const protocolVersion =
        typeof requested === 'string' &&
        (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
          ? requested
          : DEFAULT_PROTOCOL_VERSION;
      return ok(id, {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'witseal', version: WITSEAL_VERSION },
      });
    }

    case 'tools/list':
      return ok(id, { tools: [SHELL_TOOL] });

    case 'tools/call':
      return handleToolsCall(id, params, ctx);

    case 'ping':
      return ok(id, {});

    default:
      return err(id, -32601, `Method not found: ${method}`);
  }
}

async function handleToolsCall(
  id: JsonRpcId,
  params: Record<string, unknown>,
  ctx: ServerContext
): Promise<JsonRpcResponse> {
  const name = params['name'];
  if (name !== SHELL_TOOL.name) {
    return err(id, -32602, `Unknown tool: ${String(name)}`);
  }
  const args = isRecord(params['arguments']) ? params['arguments'] : {};
  const command = args['command'];
  if (typeof command !== 'string' || command.length === 0) {
    return err(id, -32602, 'Invalid params: "command" must be a non-empty string');
  }
  const cwd = typeof args['cwd'] === 'string' ? args['cwd'] : undefined;

  const mediate = ctx.mediate ?? mediateMcpShell;
  const result = await mediate(
    { command, ...(cwd !== undefined ? { cwd } : {}) },
    ctx.serverOptions
  );

  const text = result.output.length > 0 ? `${result.summary}\n\n${result.output}` : result.summary;
  return ok(id, {
    content: [{ type: 'text', text }],
    // A policy denial, or a non-zero exit, is surfaced as an error result so
    // the calling model sees the command did not succeed.
    isError: result.denied || result.exitCode !== 0,
  });
}

function isJsonRpcId(v: unknown): v is JsonRpcId {
  return typeof v === 'string' || typeof v === 'number' || v === null;
}

/**
 * Start the stdio MCP server: read newline-delimited JSON-RPC from stdin,
 * dispatch through `handleMessage`, write newline-delimited responses to
 * stdout. Messages are processed strictly in order so a tool call's captured
 * output cannot interleave with the protocol stream. Diagnostics go to stderr,
 * which the transport reserves for logging.
 */
export function startMcpServer(ctx: ServerContext): void {
  const rl = createInterface({ input: process.stdin });
  let chain: Promise<void> = Promise.resolve();

  rl.on('line', (line: string) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    chain = chain
      .then(async () => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          writeMessage({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
          return;
        }
        const response = await handleMessage(parsed, ctx);
        if (response !== null) writeMessage(response);
      })
      .catch((e: unknown) => {
        process.stderr.write(`witseal-mcp: handler error: ${e instanceof Error ? e.message : String(e)}\n`);
      });
  });

  rl.on('close', () => {
    // stdin closed — but a tool call may still be in flight (it awaits a real
    // subprocess). Drain the pending chain so its response is written before
    // the process exits; otherwise the last reply is truncated.
    chain.finally(() => process.exit(0));
  });
}

function writeMessage(obj: JsonRpcResponse): void {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}
