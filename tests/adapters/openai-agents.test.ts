/**
 * OpenAI Agents SDK adapter — witnessed shell tool shim (author-the-tool,
 * Level 3).
 *
 * `createWitsealShellTool` returns the config object the OpenAI Agents SDK
 * `tool({...})` helper expects. The contract under test is the same as every
 * other adapter core, exercised through the produced `execute`: pass an allowed
 * action through witseal, block a denied action (Gate, deny-by-default), never
 * produce a side effect on denial, fail closed with no policy pack, and capture
 * the command's output for the model. WitSeal owns execution, so an allowed
 * action yields a full execution receipt. The config shape (name, description,
 * zod parameters, execute) is asserted so a binding `tool(config)` stays valid.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createWitsealShellTool,
  DEFAULT_OPENAI_AGENTS_AGENT_ID,
} from '../../src/adapters/openai-agents/tool.js';
import { EventLog } from '../../src/witness/event-log.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'witseal-openai-agents-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writePack(rules: unknown[], defaultDecision: 'allow' | 'deny' = 'allow'): void {
  const packDir = join(dir, 'policy-packs');
  mkdirSync(packDir, { recursive: true });
  writeFileSync(
    join(packDir, 'openai-agents-rule.json'),
    JSON.stringify({
      schema_version: 'witseal.policy.v0.1',
      pack_id: 'openai-agents-rule',
      version: '1.0.0',
      description: 'test: openai-agents adapter rules',
      rules,
      default_decision: defaultDecision,
    })
  );
}

async function events() {
  return new EventLog({ root: dir, segmentId: 'default' }).readAllEvents();
}

describe('OpenAI Agents SDK adapter — tool config shape', () => {
  it('produces the { name, description, parameters, execute } object tool() expects', () => {
    const t = createWitsealShellTool({ dataDir: dir });
    expect(t.name).toBe('shell');
    expect(t.description.length).toBeGreaterThan(0);
    expect(typeof t.execute).toBe('function');
    // parameters is a zod schema: it validates the input contract.
    expect(t.parameters.safeParse({ command: 'echo hi' }).success).toBe(true);
    expect(t.parameters.safeParse({ command: 'echo hi', cwd: '/tmp' }).success).toBe(true);
    expect(t.parameters.safeParse({}).success).toBe(false);
    expect(t.parameters.safeParse({ command: 42 }).success).toBe(false);
  });

  it('honors name/description overrides', () => {
    const t = createWitsealShellTool({ dataDir: dir, name: 'run', description: 'custom' });
    expect(t.name).toBe('run');
    expect(t.description).toBe('custom');
  });
});

describe('OpenAI Agents SDK adapter — witnessed tool body (Level 3)', () => {
  it('passes an allowed action through witseal and captures output (allowed_executed)', async () => {
    writePack([], 'allow');
    const t = createWitsealShellTool({ dataDir: dir });
    const result = await t.execute({ command: 'echo hello' });
    expect(result).toContain('hello');
    expect(result).toContain('execution receipt');
    const evs = await events();
    const last = evs[evs.length - 1]!;
    expect(last.outcome).toBe('allowed_executed');
    expect(last.execution_result).not.toBeNull();
    expect(last.agent_identifier).toBe(DEFAULT_OPENAI_AGENTS_AGENT_ID);
  }, 20_000);

  it('blocks a denied action (Gate), throws, and produces no side effect', async () => {
    const target = join(dir, 'should-not-exist.txt');
    writePack(
      [{ id: 'deny-touch', match: { command_matches: 'touch' }, decision: 'deny', reason: 'touch denied (test)' }],
      'allow'
    );
    const t = createWitsealShellTool({ dataDir: dir });
    await expect(t.execute({ command: `touch ${target}` })).rejects.toThrow(/denied/i);
    expect(existsSync(target)).toBe(false);
    const evs = await events();
    expect(evs.some((e) => e.outcome === 'denied_by_policy')).toBe(true);
  }, 20_000);

  it('never bypasses witseal: with no policy pack it fails closed (throws, deny-by-default)', async () => {
    const target = join(dir, 'no-policy-target.txt');
    const t = createWitsealShellTool({ dataDir: dir });
    await expect(t.execute({ command: `touch ${target}` })).rejects.toThrow();
    expect(existsSync(target)).toBe(false);
  }, 20_000);

  it('passes cwd through to the mediated command', async () => {
    writePack([], 'allow');
    const t = createWitsealShellTool({ dataDir: dir });
    await t.execute({ command: 'touch marker.txt', cwd: dir });
    expect(existsSync(join(dir, 'marker.txt'))).toBe(true);
  }, 20_000);

  it('records a caller-supplied agentId', async () => {
    writePack([], 'allow');
    const t = createWitsealShellTool({ dataDir: dir, agentId: 'my-agent' });
    await t.execute({ command: 'echo hi' });
    const evs = await events();
    expect(evs[evs.length - 1]!.agent_identifier).toBe('my-agent');
  }, 20_000);
});
