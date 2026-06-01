/**
 * OpenCode adapter mediation (P2 M1, Level 3).
 *
 * The adapter must: pass an allowed action through the witseal pipeline,
 * block a denied action (Gate, deny-by-default), and never produce a side
 * effect when the action is denied. WitSeal owns execution, so an allowed
 * action yields a full execution receipt.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mediateOpenCodeBash, WITSEAL_DENIED_EXIT } from '../../src/adapters/opencode/mediate.js';
import { EventLog } from '../../src/witness/event-log.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'witseal-opencode-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Write a policy pack into the data dir. */
function writePack(rules: unknown[], defaultDecision: 'allow' | 'deny' = 'allow'): void {
  const packDir = join(dir, 'policy-packs');
  mkdirSync(packDir, { recursive: true });
  writeFileSync(
    join(packDir, 'opencode-rule.json'),
    JSON.stringify({
      schema_version: 'witseal.policy.v0.1',
      pack_id: 'opencode-rule',
      version: '1.0.0',
      description: 'test: opencode adapter rules',
      rules,
      default_decision: defaultDecision,
    })
  );
}

async function events() {
  return new EventLog({ root: dir, segmentId: 'default' }).readAllEvents();
}

describe('OpenCode adapter — mediateOpenCodeBash (Level 3)', () => {
  it('passes an allowed action through witseal and executes it (allowed_executed)', async () => {
    writePack([], 'allow');
    const res = await mediateOpenCodeBash({ command: 'echo hello' }, { dataDir: dir });
    expect(res.exitCode).toBe(0);
    expect(res.denied).toBe(false);
    const evs = await events();
    const last = evs[evs.length - 1]!;
    expect(last.outcome).toBe('allowed_executed');
    expect(last.execution_result).not.toBeNull();
  }, 20_000);

  it('blocks a denied action (Gate) and produces no side effect', async () => {
    const target = join(dir, 'should-not-exist.txt');
    writePack([{ id: 'deny-touch', match: { command_matches: 'touch' }, decision: 'deny', reason: 'touch denied (test)' }], 'allow');
    const res = await mediateOpenCodeBash({ command: `touch ${target}` }, { dataDir: dir });
    expect(res.exitCode).toBe(WITSEAL_DENIED_EXIT);
    expect(res.denied).toBe(true);
    // No side effect: the denied command did not run.
    expect(existsSync(target)).toBe(false);
    const evs = await events();
    expect(evs.some((e) => e.outcome === 'denied_by_policy')).toBe(true);
  }, 20_000);

  it('never bypasses witseal: with no policy pack it fails closed (deny-by-default)', async () => {
    const target = join(dir, 'no-policy-target.txt');
    const res = await mediateOpenCodeBash({ command: `touch ${target}` }, { dataDir: dir });
    expect(res.exitCode).toBe(WITSEAL_DENIED_EXIT);
    expect(existsSync(target)).toBe(false);
  }, 20_000);
});
