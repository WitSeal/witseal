/**
 * Claude Code adapter (Level 2 — witness) + the witness-record core.
 *
 * The defining property of Level 2: witseal OBSERVES, it does not execute. The
 * adapter records the host-reported result as evidence; it must never run the
 * command itself. These tests assert both the recorded evidence and the
 * absence of any execution side effect.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordWitnessedExecution } from '../../src/witness/record.js';
import { witnessClaudeCodePostToolUse } from '../../src/adapters/claude-code/witness.js';
import { EventLog } from '../../src/witness/event-log.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'witseal-claude-code-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writePack(rules: unknown[], defaultDecision: 'allow' | 'deny' = 'allow'): void {
  const packDir = join(dir, 'policy-packs');
  mkdirSync(packDir, { recursive: true });
  writeFileSync(
    join(packDir, 'cc-rule.json'),
    JSON.stringify({
      schema_version: 'witseal.policy.v0.1',
      pack_id: 'cc-rule',
      version: '1.0.0',
      description: 'test: claude-code witness rules',
      rules,
      default_decision: defaultDecision,
    })
  );
}

async function events() {
  return new EventLog({ root: dir, segmentId: 'default' }).readAllEvents();
}

describe('Claude Code — recordWitnessedExecution (Level 2 witness core)', () => {
  it('records an observed success as allowed_executed with the observed result', async () => {
    writePack([], 'allow');
    const res = await recordWitnessedExecution({
      command: 'echo hi',
      cwd: dir,
      exitCode: 0,
      stdout: 'hi\n',
      stderr: '',
      agentId: 'claude-code',
      dataDir: dir,
    });
    expect(res.outcome).toBe('allowed_executed');
    const evs = await events();
    const last = evs[evs.length - 1]!;
    expect(last.outcome).toBe('allowed_executed');
    expect(last.execution_result).not.toBeNull();
    expect(last.execution_result!.exit_code).toBe(0);
    expect(last.execution_result!.stdout.head).toBe('hi\n');
    expect(last.agent_identifier).toBe('claude-code');
  });

  it('OBSERVES, does not execute: a touch command recorded as success creates no file', async () => {
    writePack([], 'allow');
    const target = join(dir, 'must-not-be-created.txt');
    // We report exit 0 as if it ran elsewhere — recordWitnessedExecution must
    // NOT run it. The file must not exist afterward.
    const res = await recordWitnessedExecution({
      command: `touch ${target}`,
      cwd: dir,
      exitCode: 0,
      stdout: '',
      stderr: '',
      agentId: 'claude-code',
      dataDir: dir,
    });
    expect(res.outcome).toBe('allowed_executed');
    expect(existsSync(target)).toBe(false); // never executed
  });

  it('records a non-zero observed exit as allowed_executed_with_error', async () => {
    writePack([], 'allow');
    const res = await recordWitnessedExecution({
      command: 'false', cwd: dir, exitCode: 1, stdout: '', stderr: 'boom\n',
      agentId: 'claude-code', dataDir: dir,
    });
    expect(res.outcome).toBe('allowed_executed_with_error');
  });

  it('records a policy-deny observation as witnessed_executed (never denied_by_policy)', async () => {
    writePack(
      [{ id: 'deny-rm', match: { command_matches: 'rm ' }, decision: 'deny', reason: 'rm denied (test)' }],
      'allow'
    );
    const res = await recordWitnessedExecution({
      command: 'rm -rf /tmp/x', cwd: dir, exitCode: 0, stdout: '', stderr: '',
      agentId: 'claude-code', dataDir: dir,
    });
    // The command ran (Claude Code executed it); we recorded it, not blocked it.
    expect(res.outcome).toBe('witnessed_executed');
    const evs = await events();
    expect(evs.some((e) => e.outcome === 'denied_by_policy')).toBe(false);
  });

  it('records no_policy_configured when no policy pack is present', async () => {
    const res = await recordWitnessedExecution({
      command: 'echo x', cwd: dir, exitCode: 0, stdout: 'x\n', stderr: '',
      agentId: 'claude-code', dataDir: dir,
    });
    expect(res.outcome).toBe('no_policy_configured');
  });
});

describe('Claude Code — witnessClaudeCodePostToolUse (hook shim)', () => {
  it('records a Bash PostToolUse payload', async () => {
    writePack([], 'allow');
    const payload = {
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      cwd: dir,
      tool_input: { command: 'echo from-hook' },
      tool_response: { stdout: 'from-hook\n', stderr: '', interrupted: false, returnCode: 0 },
    };
    const out = await witnessClaudeCodePostToolUse(payload, { dataDir: dir });
    expect(out.recorded).toBe(true);
    if (out.recorded) {
      expect(out.result.outcome).toBe('allowed_executed');
    }
    const evs = await events();
    expect(evs[evs.length - 1]!.execution_result!.stdout.head).toBe('from-hook\n');
  });

  it('skips a non-Bash tool', async () => {
    writePack([], 'allow');
    const out = await witnessClaudeCodePostToolUse(
      { tool_name: 'Read', tool_input: { file_path: '/etc/hosts' }, tool_response: {} },
      { dataDir: dir }
    );
    expect(out.recorded).toBe(false);
    expect((await events()).length).toBe(0);
  });

  it('skips a Bash payload with no command', async () => {
    writePack([], 'allow');
    const out = await witnessClaudeCodePostToolUse(
      { tool_name: 'Bash', tool_input: {}, tool_response: { returnCode: 0 } },
      { dataDir: dir }
    );
    expect(out.recorded).toBe(false);
  });
});
