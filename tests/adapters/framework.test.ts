/**
 * Framework adapter core (author-the-tool, Level 3).
 *
 * `mediateShellCommand` is the shared primitive the LangGraph and OpenAI Agents
 * SDK tool shims call. Like the other adapter cores it must: pass an allowed
 * action through witseal, block a denied action (Gate, deny-by-default), never
 * produce a side effect on denial, and capture the command's output for the
 * tool result. WitSeal owns execution, so an allowed action yields a full
 * execution receipt.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mediateShellCommand, WITSEAL_DENIED_EXIT } from '../../src/adapters/framework/mediate.js';
import { EventLog } from '../../src/witness/event-log.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'witseal-framework-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writePack(rules: unknown[], defaultDecision: 'allow' | 'deny' = 'allow'): void {
  const packDir = join(dir, 'policy-packs');
  mkdirSync(packDir, { recursive: true });
  writeFileSync(
    join(packDir, 'framework-rule.json'),
    JSON.stringify({
      schema_version: 'witseal.policy.v0.1',
      pack_id: 'framework-rule',
      version: '1.0.0',
      description: 'test: framework adapter rules',
      rules,
      default_decision: defaultDecision,
    })
  );
}

async function events() {
  return new EventLog({ root: dir, segmentId: 'default' }).readAllEvents();
}

describe('Framework adapter — mediateShellCommand (Level 3)', () => {
  it('passes an allowed action through witseal and captures output (allowed_executed)', async () => {
    writePack([], 'allow');
    const res = await mediateShellCommand({ command: 'echo hello' }, { dataDir: dir, agentId: 'langgraph' });
    expect(res.exitCode).toBe(0);
    expect(res.denied).toBe(false);
    expect(res.output).toContain('hello');
    const evs = await events();
    const last = evs[evs.length - 1]!;
    expect(last.outcome).toBe('allowed_executed');
    expect(last.execution_result).not.toBeNull();
    expect(last.agent_identifier).toBe('langgraph');
  }, 20_000);

  it('blocks a denied action (Gate) and produces no side effect', async () => {
    const target = join(dir, 'should-not-exist.txt');
    writePack(
      [{ id: 'deny-touch', match: { command_matches: 'touch' }, decision: 'deny', reason: 'touch denied (test)' }],
      'allow'
    );
    const res = await mediateShellCommand({ command: `touch ${target}` }, { dataDir: dir, agentId: 'openai-agents' });
    expect(res.exitCode).toBe(WITSEAL_DENIED_EXIT);
    expect(res.denied).toBe(true);
    expect(existsSync(target)).toBe(false);
    const evs = await events();
    expect(evs.some((e) => e.outcome === 'denied_by_policy')).toBe(true);
  }, 20_000);

  it('never bypasses witseal: with no policy pack it fails closed (deny-by-default)', async () => {
    const target = join(dir, 'no-policy-target.txt');
    const res = await mediateShellCommand({ command: `touch ${target}` }, { dataDir: dir });
    expect(res.exitCode).toBe(WITSEAL_DENIED_EXIT);
    expect(res.denied).toBe(true);
    expect(existsSync(target)).toBe(false);
  }, 20_000);
});
