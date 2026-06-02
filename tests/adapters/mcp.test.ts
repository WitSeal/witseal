/**
 * MCP server integration (own-execute, Level 3).
 *
 * Two surfaces under test:
 *   1. `mediateMcpShell` — the framework-agnostic core. Like the OpenCode
 *      core, it must pass an allowed action through witseal, block a denied
 *      action (Gate, deny-by-default), and never produce a side effect on
 *      denial. WitSeal owns execution, so an allowed action yields a full
 *      execution receipt.
 *   2. `handleMessage` — the JSON-RPC protocol surface, tested as a pure
 *      function with an injected mediate so no subprocess is spawned.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mediateMcpShell, WITSEAL_DENIED_EXIT } from '../../src/adapters/mcp/mediate.js';
import {
  handleMessage,
  SHELL_TOOL,
  DEFAULT_PROTOCOL_VERSION,
  type ServerContext,
} from '../../src/adapters/mcp/server.js';
import { EventLog } from '../../src/witness/event-log.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'witseal-mcp-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writePack(rules: unknown[], defaultDecision: 'allow' | 'deny' = 'allow'): void {
  const packDir = join(dir, 'policy-packs');
  mkdirSync(packDir, { recursive: true });
  writeFileSync(
    join(packDir, 'mcp-rule.json'),
    JSON.stringify({
      schema_version: 'witseal.policy.v0.1',
      pack_id: 'mcp-rule',
      version: '1.0.0',
      description: 'test: mcp server rules',
      rules,
      default_decision: defaultDecision,
    })
  );
}

async function events() {
  return new EventLog({ root: dir, segmentId: 'default' }).readAllEvents();
}

describe('MCP server — mediateMcpShell (Level 3)', () => {
  it('passes an allowed action through witseal and executes it (allowed_executed)', async () => {
    writePack([], 'allow');
    const res = await mediateMcpShell({ command: 'echo hello' }, { dataDir: dir });
    expect(res.exitCode).toBe(0);
    expect(res.denied).toBe(false);
    expect(res.output).toContain('hello');
    const evs = await events();
    const last = evs[evs.length - 1]!;
    expect(last.outcome).toBe('allowed_executed');
    expect(last.execution_result).not.toBeNull();
  }, 20_000);

  it('blocks a denied action (Gate) and produces no side effect', async () => {
    const target = join(dir, 'should-not-exist.txt');
    writePack(
      [{ id: 'deny-touch', match: { command_matches: 'touch' }, decision: 'deny', reason: 'touch denied (test)' }],
      'allow'
    );
    const res = await mediateMcpShell({ command: `touch ${target}` }, { dataDir: dir });
    expect(res.exitCode).toBe(WITSEAL_DENIED_EXIT);
    expect(res.denied).toBe(true);
    expect(existsSync(target)).toBe(false);
    const evs = await events();
    expect(evs.some((e) => e.outcome === 'denied_by_policy')).toBe(true);
  }, 20_000);

  it('never bypasses witseal: with no policy pack it fails closed (deny-by-default)', async () => {
    const target = join(dir, 'no-policy-target.txt');
    const res = await mediateMcpShell({ command: `touch ${target}` }, { dataDir: dir });
    expect(res.exitCode).toBe(WITSEAL_DENIED_EXIT);
    expect(res.denied).toBe(true);
    expect(existsSync(target)).toBe(false);
  }, 20_000);

  it('captured output never reaches process.stdout (channel stays clean)', async () => {
    writePack([], 'allow');
    const chunks: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    // Capture anything the mediation might leak to the real stdout.
    (process.stdout.write as unknown) = (chunk: string | Uint8Array): boolean => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    };
    try {
      const res = await mediateMcpShell({ command: 'echo channel-safe' }, { dataDir: dir });
      expect(res.output).toContain('channel-safe');
    } finally {
      (process.stdout.write as unknown) = orig;
    }
    expect(chunks.join('')).not.toContain('channel-safe');
  }, 20_000);
});

describe('MCP server — handleMessage (protocol surface)', () => {
  const ctx: ServerContext = {
    serverOptions: { dataDir: '/tmp/unused' },
    // Injected mediate — no subprocess, deterministic.
    mediate: async (call) => {
      if (call.command === 'DENY') {
        return { exitCode: WITSEAL_DENIED_EXIT, denied: true, output: '', summary: 'denied' };
      }
      return { exitCode: 0, denied: false, output: 'out: ' + call.command, summary: 'ok' };
    },
  };

  it('initialize returns serverInfo + capabilities and echoes a known protocol version', async () => {
    const r = await handleMessage(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
      ctx
    );
    expect(r).not.toBeNull();
    const result = r!.result as { protocolVersion: string; capabilities: Record<string, unknown>; serverInfo: { name: string } };
    expect(result.protocolVersion).toBe('2025-06-18');
    expect(result.serverInfo.name).toBe('witseal');
    expect(result.capabilities).toHaveProperty('tools');
  });

  it('initialize falls back to the default protocol version for an unknown request', async () => {
    const r = await handleMessage(
      { jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } },
      ctx
    );
    const result = r!.result as { protocolVersion: string };
    expect(result.protocolVersion).toBe(DEFAULT_PROTOCOL_VERSION);
  });

  it('tools/list returns the shell tool', async () => {
    const r = await handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, ctx);
    const result = r!.result as { tools: Array<{ name: string }> };
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0]!.name).toBe(SHELL_TOOL.name);
  });

  it('tools/call (allowed) returns a non-error text result with captured output', async () => {
    const r = await handleMessage(
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'shell', arguments: { command: 'echo hi' } } },
      ctx
    );
    const result = r!.result as { content: Array<{ type: string; text: string }>; isError: boolean };
    expect(result.isError).toBe(false);
    expect(result.content[0]!.text).toContain('out: echo hi');
  });

  it('tools/call (denied) returns isError true', async () => {
    const r = await handleMessage(
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'shell', arguments: { command: 'DENY' } } },
      ctx
    );
    const result = r!.result as { isError: boolean };
    expect(result.isError).toBe(true);
  });

  it('tools/call with an unknown tool is an invalid-params error', async () => {
    const r = await handleMessage(
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'rm', arguments: {} } },
      ctx
    );
    expect(r!.error?.code).toBe(-32602);
  });

  it('tools/call with a missing command is an invalid-params error', async () => {
    const r = await handleMessage(
      { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'shell', arguments: {} } },
      ctx
    );
    expect(r!.error?.code).toBe(-32602);
  });

  it('a notification (no id) yields no response', async () => {
    const r = await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, ctx);
    expect(r).toBeNull();
  });

  it('an unknown method is method-not-found', async () => {
    const r = await handleMessage({ jsonrpc: '2.0', id: 8, method: 'no/such' }, ctx);
    expect(r!.error?.code).toBe(-32601);
  });

  it('ping returns an empty result', async () => {
    const r = await handleMessage({ jsonrpc: '2.0', id: 9, method: 'ping' }, ctx);
    expect(r!.result).toEqual({});
  });
});
