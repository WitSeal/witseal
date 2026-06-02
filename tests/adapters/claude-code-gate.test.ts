/**
 * Claude Code adapter (Level 2 — PreToolUse gate).
 *
 * The gate decides BEFORE the command runs: block a policy `deny`, escalate a
 * `require-approval`, and stay out of the way for an `allow`. Its defining
 * property, like the witness, is that witseal NEVER executes — it only decides.
 * A block is recorded as a witness event with `execution_result = null` (a
 * denied action did not run). These tests assert the decision, the recorded
 * evidence, and the absence of any execution side effect.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  gateClaudeCodePreToolUse,
  ENV_UNSAFE_ALLOW_NO_POLICY,
} from '../../src/adapters/claude-code/gate.js';
import { EventLog } from '../../src/witness/event-log.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'witseal-claude-code-gate-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env[ENV_UNSAFE_ALLOW_NO_POLICY];
});

function writePack(rules: unknown[], defaultDecision: 'allow' | 'deny' = 'allow'): void {
  const packDir = join(dir, 'policy-packs');
  mkdirSync(packDir, { recursive: true });
  writeFileSync(
    join(packDir, 'cc-gate-rule.json'),
    JSON.stringify({
      schema_version: 'witseal.policy.v0.1',
      pack_id: 'cc-gate-rule',
      version: '1.0.0',
      description: 'test: claude-code gate rules',
      rules,
      default_decision: defaultDecision,
    })
  );
}

async function events() {
  return new EventLog({ root: dir, segmentId: 'default' }).readAllEvents();
}

describe('Claude Code — gateClaudeCodePreToolUse (Level 2 PreToolUse gate)', () => {
  it('makes NO decision for a policy allow (lets Claude Code proceed), records nothing', async () => {
    writePack([], 'allow');
    const out = await gateClaudeCodePreToolUse(
      { tool_name: 'Bash', cwd: dir, tool_input: { command: 'echo hi' } },
      { dataDir: dir }
    );
    expect(out.permissionDecision).toBeNull();
    expect(out.recorded).toBeUndefined();
    expect((await events()).length).toBe(0);
  });

  it('blocks a policy deny and records denied_by_policy with a null execution_result', async () => {
    writePack(
      [{ id: 'deny-rm', match: { command_matches: 'rm ' }, decision: 'deny', reason: 'rm denied (test)' }],
      'allow'
    );
    const out = await gateClaudeCodePreToolUse(
      { tool_name: 'Bash', cwd: dir, tool_input: { command: 'rm -rf /tmp/x' } },
      { dataDir: dir }
    );
    expect(out.permissionDecision).toBe('deny');
    expect(out.recorded?.outcome).toBe('denied_by_policy');
    const evs = await events();
    const last = evs[evs.length - 1]!;
    expect(last.outcome).toBe('denied_by_policy');
    // Witness-grade honesty: a denied action did not run.
    expect(last.execution_result).toBeNull();
  });

  it('DECIDES, does not execute: gating a touch command never creates the file', async () => {
    writePack(
      [{ id: 'deny-touch', match: { command_matches: 'touch' }, decision: 'deny', reason: 'touch denied (test)' }],
      'allow'
    );
    const target = join(dir, 'must-not-be-created.txt');
    const out = await gateClaudeCodePreToolUse(
      { tool_name: 'Bash', cwd: dir, tool_input: { command: `touch ${target}` } },
      { dataDir: dir }
    );
    expect(out.permissionDecision).toBe('deny');
    expect(existsSync(target)).toBe(false); // never executed
  });

  it('escalates a require-approval to ask, recording no terminal event', async () => {
    writePack(
      [{ id: 'ask-curl', match: { command_matches: 'curl' }, decision: 'require-approval', reason: 'curl needs approval (test)' }],
      'allow'
    );
    const out = await gateClaudeCodePreToolUse(
      { tool_name: 'Bash', cwd: dir, tool_input: { command: 'curl https://example.com' } },
      { dataDir: dir }
    );
    expect(out.permissionDecision).toBe('ask');
    expect(out.recorded).toBeUndefined();
    expect((await events()).length).toBe(0);
  });

  it('fails closed (deny) when no policy pack is present, recording no_policy_configured', async () => {
    const out = await gateClaudeCodePreToolUse(
      { tool_name: 'Bash', cwd: dir, tool_input: { command: 'echo x' } },
      { dataDir: dir }
    );
    expect(out.permissionDecision).toBe('deny');
    expect(out.recorded?.outcome).toBe('no_policy_configured');
    const evs = await events();
    expect(evs[evs.length - 1]!.outcome).toBe('no_policy_configured');
    expect(evs[evs.length - 1]!.execution_result).toBeNull();
  });

  it('makes no decision with no policy pack when WITSEAL_UNSAFE_ALLOW_NO_POLICY=1 (advisory)', async () => {
    process.env[ENV_UNSAFE_ALLOW_NO_POLICY] = '1';
    const out = await gateClaudeCodePreToolUse(
      { tool_name: 'Bash', cwd: dir, tool_input: { command: 'echo x' } },
      { dataDir: dir }
    );
    expect(out.permissionDecision).toBeNull();
    expect((await events()).length).toBe(0);
  });

  it('does not gate a non-Bash tool (no decision, no event)', async () => {
    writePack([], 'allow');
    const out = await gateClaudeCodePreToolUse(
      { tool_name: 'Read', tool_input: { file_path: '/etc/hosts' } },
      { dataDir: dir }
    );
    expect(out.permissionDecision).toBeNull();
    expect((await events()).length).toBe(0);
  });

  it('makes no decision for a Bash payload with no command', async () => {
    writePack([], 'allow');
    const out = await gateClaudeCodePreToolUse(
      { tool_name: 'Bash', tool_input: {} },
      { dataDir: dir }
    );
    expect(out.permissionDecision).toBeNull();
    expect((await events()).length).toBe(0);
  });
});
