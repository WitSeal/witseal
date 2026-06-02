/**
 * LangGraph adapter — witnessed shell tool shim (author-the-tool, Level 3).
 *
 * `createWitsealShellTool` returns the two arguments LangChain's
 * `tool(func, config)` expects. The contract under test is the same as every
 * other adapter core, exercised through the produced `func`: pass an allowed
 * action through witseal, block a denied action (Gate, deny-by-default), never
 * produce a side effect on denial, fail closed with no policy pack, and capture
 * the command's output for the model. WitSeal owns execution, so an allowed
 * action yields a full execution receipt. The `config` shape (name, description,
 * zod schema) is asserted so a binding `tool(func, config)` stays valid.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createWitsealShellTool,
  DEFAULT_LANGGRAPH_AGENT_ID,
} from '../../src/adapters/langgraph/tool.js';
import { EventLog } from '../../src/witness/event-log.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'witseal-langgraph-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writePack(rules: unknown[], defaultDecision: 'allow' | 'deny' = 'allow'): void {
  const packDir = join(dir, 'policy-packs');
  mkdirSync(packDir, { recursive: true });
  writeFileSync(
    join(packDir, 'langgraph-rule.json'),
    JSON.stringify({
      schema_version: 'witseal.policy.v0.1',
      pack_id: 'langgraph-rule',
      version: '1.0.0',
      description: 'test: langgraph adapter rules',
      rules,
      default_decision: defaultDecision,
    })
  );
}

async function events() {
  return new EventLog({ root: dir, segmentId: 'default' }).readAllEvents();
}

describe('LangGraph adapter — tool config shape', () => {
  it('produces the (func, config) pair LangChain tool() expects', () => {
    const { func, config } = createWitsealShellTool({ dataDir: dir });
    expect(typeof func).toBe('function');
    expect(config.name).toBe('shell');
    expect(config.description.length).toBeGreaterThan(0);
    // schema is a zod schema: it validates the input contract.
    expect(config.schema.safeParse({ command: 'echo hi' }).success).toBe(true);
    expect(config.schema.safeParse({ command: 'echo hi', cwd: '/tmp' }).success).toBe(true);
    expect(config.schema.safeParse({}).success).toBe(false);
    expect(config.schema.safeParse({ command: 42 }).success).toBe(false);
  });

  it('honors name/description overrides', () => {
    const { config } = createWitsealShellTool({ dataDir: dir, name: 'run', description: 'custom' });
    expect(config.name).toBe('run');
    expect(config.description).toBe('custom');
  });
});

describe('LangGraph adapter — witnessed tool body (Level 3)', () => {
  it('passes an allowed action through witseal and captures output (allowed_executed)', async () => {
    writePack([], 'allow');
    const { func } = createWitsealShellTool({ dataDir: dir });
    const result = await func({ command: 'echo hello' });
    expect(result).toContain('hello');
    expect(result).toContain('execution receipt');
    const evs = await events();
    const last = evs[evs.length - 1]!;
    expect(last.outcome).toBe('allowed_executed');
    expect(last.execution_result).not.toBeNull();
    expect(last.agent_identifier).toBe(DEFAULT_LANGGRAPH_AGENT_ID);
  }, 20_000);

  it('blocks a denied action (Gate), throws, and produces no side effect', async () => {
    const target = join(dir, 'should-not-exist.txt');
    writePack(
      [{ id: 'deny-touch', match: { command_matches: 'touch' }, decision: 'deny', reason: 'touch denied (test)' }],
      'allow'
    );
    const { func } = createWitsealShellTool({ dataDir: dir });
    await expect(func({ command: `touch ${target}` })).rejects.toThrow(/denied/i);
    expect(existsSync(target)).toBe(false);
    const evs = await events();
    expect(evs.some((e) => e.outcome === 'denied_by_policy')).toBe(true);
  }, 20_000);

  it('never bypasses witseal: with no policy pack it fails closed (throws, deny-by-default)', async () => {
    const target = join(dir, 'no-policy-target.txt');
    const { func } = createWitsealShellTool({ dataDir: dir });
    await expect(func({ command: `touch ${target}` })).rejects.toThrow();
    expect(existsSync(target)).toBe(false);
  }, 20_000);

  it('passes cwd through to the mediated command', async () => {
    writePack([], 'allow');
    const { func } = createWitsealShellTool({ dataDir: dir });
    await func({ command: 'touch marker.txt', cwd: dir });
    expect(existsSync(join(dir, 'marker.txt'))).toBe(true);
  }, 20_000);

  it('records a caller-supplied agentId', async () => {
    writePack([], 'allow');
    const { func } = createWitsealShellTool({ dataDir: dir, agentId: 'my-graph' });
    await func({ command: 'echo hi' });
    const evs = await events();
    expect(evs[evs.length - 1]!.agent_identifier).toBe('my-graph');
  }, 20_000);
});
