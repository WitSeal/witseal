/**
 * Cursor adapter (Level 2 — witness). Cursor OBSERVES via the `postToolUse`
 * hook; it must never execute the command. These tests assert the recorded
 * evidence (including parsing the exit code/stdout out of `tool_output`) and the
 * absence of any execution side effect. The witness-record core is reused
 * unchanged — its own behavior is covered in claude-code.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { witnessCursorPostToolUse } from '../../src/adapters/cursor/witness.js';
import { EventLog } from '../../src/witness/event-log.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'witseal-cursor-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writePack(rules: unknown[], defaultDecision: 'allow' | 'deny' = 'allow'): void {
  const packDir = join(dir, 'policy-packs');
  mkdirSync(packDir, { recursive: true });
  writeFileSync(
    join(packDir, 'cursor-rule.json'),
    JSON.stringify({
      schema_version: 'witseal.policy.v0.1',
      pack_id: 'cursor-rule',
      version: '1.0.0',
      description: 'test: cursor witness rules',
      rules,
      default_decision: defaultDecision,
    })
  );
}

async function events() {
  return new EventLog({ root: dir, segmentId: 'default' }).readAllEvents();
}

describe('Cursor — witnessCursorPostToolUse (postToolUse hook shim)', () => {
  it('records a Shell payload, parsing tool_output JSON for exit code and stdout', async () => {
    writePack([], 'allow');
    const payload = {
      hook_event_name: 'postToolUse',
      tool_name: 'Shell',
      cwd: dir,
      tool_input: { command: 'echo from-cursor' },
      tool_output: JSON.stringify({ exitCode: 0, stdout: 'from-cursor\n' }),
    };
    const out = await witnessCursorPostToolUse(payload, { dataDir: dir });
    expect(out.recorded).toBe(true);
    if (out.recorded) {
      expect(out.result.outcome).toBe('allowed_executed');
    }
    const evs = await events();
    const last = evs[evs.length - 1]!;
    expect(last.execution_result!.exit_code).toBe(0);
    expect(last.execution_result!.stdout.head).toBe('from-cursor\n');
    expect(last.agent_identifier).toBe('cursor');
  });

  it('OBSERVES, does not execute: a touch reported as success creates no file', async () => {
    writePack([], 'allow');
    const target = join(dir, 'must-not-be-created.txt');
    const out = await witnessCursorPostToolUse(
      {
        tool_name: 'Shell',
        cwd: dir,
        tool_input: { command: `touch ${target}` },
        tool_output: JSON.stringify({ exitCode: 0, stdout: '' }),
      },
      { dataDir: dir }
    );
    expect(out.recorded).toBe(true);
    expect(existsSync(target)).toBe(false); // never executed
  });

  it('records a non-zero exit (from tool_output) as allowed_executed_with_error', async () => {
    writePack([], 'allow');
    const out = await witnessCursorPostToolUse(
      {
        tool_name: 'Shell',
        cwd: dir,
        tool_input: { command: 'false' },
        tool_output: JSON.stringify({ exitCode: 1, stdout: '' }),
      },
      { dataDir: dir }
    );
    expect(out.recorded).toBe(true);
    if (out.recorded) {
      expect(out.result.outcome).toBe('allowed_executed_with_error');
    }
  });

  it('tolerates a non-JSON tool_output by treating it as raw stdout', async () => {
    writePack([], 'allow');
    const out = await witnessCursorPostToolUse(
      {
        tool_name: 'Shell',
        cwd: dir,
        tool_input: { command: 'echo x' },
        tool_output: 'plain text output',
      },
      { dataDir: dir }
    );
    expect(out.recorded).toBe(true);
    const evs = await events();
    expect(evs[evs.length - 1]!.execution_result!.stdout.head).toBe('plain text output');
  });

  it('skips a non-Shell tool', async () => {
    writePack([], 'allow');
    const out = await witnessCursorPostToolUse(
      { tool_name: 'Read', tool_input: { file_path: '/etc/hosts' }, tool_output: '{}' },
      { dataDir: dir }
    );
    expect(out.recorded).toBe(false);
    expect((await events()).length).toBe(0);
  });

  it('skips a Shell payload with no command', async () => {
    writePack([], 'allow');
    const out = await witnessCursorPostToolUse(
      { tool_name: 'Shell', tool_input: {}, tool_output: JSON.stringify({ exitCode: 0 }) },
      { dataDir: dir }
    );
    expect(out.recorded).toBe(false);
  });
});
