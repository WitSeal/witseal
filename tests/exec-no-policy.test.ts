/**
 * P0-4 — no-policy fail-closed + distinguishable evidence.
 *
 * Runtime-boundary audit 2026-05-25 finding TS-P0-4: when no policy packs
 * are configured, `runExec` previously fell through to the engine's
 * default-allow path, executed the command, and emitted a witness event
 * with outcome `allowed_executed` — visually indistinguishable from a
 * policy-allowed execution.
 *
 * Post-fix:
 *   - Default behavior is fail-closed: no execution, witness event with
 *     `outcome=no_policy_configured` and `execution_result=null`, exit 100.
 *   - Operator opt-in via `WITSEAL_UNSAFE_ALLOW_NO_POLICY=1` enables
 *     advisory-only execution; the witness event still carries
 *     `outcome=no_policy_configured` (not `allowed_executed`), but
 *     `execution_result` is populated. Presence/absence of
 *     `execution_result` distinguishes the two cases.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runExec, ENV_UNSAFE_ALLOW_NO_POLICY } from '../src/cli/exec.js';
import { EventLog } from '../src/witness/event-log.js';

let dataDir: string;

function silenceOutput(): { restore: () => void; stderr: string[]; stdout: string[] } {
  const stderr: string[] = [];
  const stdout: string[] = [];
  const stderrSpy = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation(((chunk: string | Uint8Array) => {
      stderr.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as never);
  const stdoutSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(((chunk: string | Uint8Array) => {
      stdout.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as never);
  return {
    restore: () => {
      stderrSpy.mockRestore();
      stdoutSpy.mockRestore();
    },
    stderr,
    stdout,
  };
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'witseal-exec-nopolicy-'));
  delete process.env[ENV_UNSAFE_ALLOW_NO_POLICY];
});

afterEach(() => {
  delete process.env[ENV_UNSAFE_ALLOW_NO_POLICY];
  rmSync(dataDir, { recursive: true, force: true });
});

describe('runExec — no-policy fail-closed default (P0-4)', () => {
  it('does NOT execute when no policy packs are loaded (default)', async () => {
    const out = silenceOutput();
    try {
      const exit = await runExec({
        command: '/bin/echo',
        args: ['should-never-run'],
        agentId: 'p0-4-test',
        cwd: '/tmp',
        timeoutMs: 0,
        dataDir,
        segmentId: 'default',
      });
      expect(exit).toBe(100); // EXIT_DENIED
      // No stdout from /bin/echo — the command did not run.
      const stdoutJoined = out.stdout.join('');
      expect(stdoutJoined).not.toContain('should-never-run');
    } finally {
      out.restore();
    }
  });

  it('emits a witness event with outcome=no_policy_configured + execution_result=null', async () => {
    const out = silenceOutput();
    try {
      await runExec({
        command: '/bin/echo',
        args: ['blocked'],
        agentId: 'p0-4-test',
        cwd: '/tmp',
        timeoutMs: 0,
        dataDir,
        segmentId: 'default',
      });
    } finally {
      out.restore();
    }
    const log = new EventLog({ root: dataDir, segmentId: 'default' });
    const events = await log.readAllEvents();
    expect(events).toHaveLength(1);
    expect(events[0]!.outcome).toBe('no_policy_configured');
    expect(events[0]!.execution_result).toBeNull();
  });

  it('writes a diagnostic to stderr naming the policy dir and the escape-hatch env var', async () => {
    const out = silenceOutput();
    try {
      await runExec({
        command: '/bin/echo',
        args: ['x'],
        agentId: 'p0-4-test',
        cwd: '/tmp',
        timeoutMs: 0,
        dataDir,
        segmentId: 'default',
      });
    } finally {
      out.restore();
    }
    const stderrJoined = out.stderr.join('');
    expect(stderrJoined).toContain('no policy packs configured');
    expect(stderrJoined).toContain(ENV_UNSAFE_ALLOW_NO_POLICY);
    expect(stderrJoined).toContain('policy-packs'); // policy dir name
  });

  it('persists the policy_decision.reason explaining why the runtime fails closed', async () => {
    const out = silenceOutput();
    try {
      await runExec({
        command: '/bin/echo',
        args: ['x'],
        agentId: 'p0-4-test',
        cwd: '/tmp',
        timeoutMs: 0,
        dataDir,
        segmentId: 'default',
      });
    } finally {
      out.restore();
    }
    const log = new EventLog({ root: dataDir, segmentId: 'default' });
    const events = await log.readAllEvents();
    expect(events[0]!.policy_decision.reason).toMatch(/fails closed|P0-4/);
    expect(events[0]!.policy_decision.reason).toContain(ENV_UNSAFE_ALLOW_NO_POLICY);
  });

  it('value other than "1" on the escape-hatch env var does NOT unblock', async () => {
    process.env[ENV_UNSAFE_ALLOW_NO_POLICY] = 'true';
    const out = silenceOutput();
    try {
      const exit = await runExec({
        command: '/bin/echo',
        args: ['blocked-anyway'],
        agentId: 'p0-4-test',
        cwd: '/tmp',
        timeoutMs: 0,
        dataDir,
        segmentId: 'default',
      });
      expect(exit).toBe(100);
    } finally {
      out.restore();
    }
  });
});

describe('runExec — no-policy escape hatch (WITSEAL_UNSAFE_ALLOW_NO_POLICY=1)', () => {
  beforeEach(() => {
    process.env[ENV_UNSAFE_ALLOW_NO_POLICY] = '1';
  });

  it('executes the command and exits with the subprocess exit code', async () => {
    const out = silenceOutput();
    try {
      const exit = await runExec({
        command: '/usr/bin/true',
        args: [],
        agentId: 'p0-4-test',
        cwd: '/tmp',
        timeoutMs: 0,
        dataDir,
        segmentId: 'default',
      });
      expect(exit).toBe(0);
    } finally {
      out.restore();
    }
  });

  it('emits witness with outcome=no_policy_configured (NOT allowed_executed) + execution_result populated', async () => {
    const out = silenceOutput();
    try {
      await runExec({
        command: '/usr/bin/true',
        args: [],
        agentId: 'p0-4-test',
        cwd: '/tmp',
        timeoutMs: 0,
        dataDir,
        segmentId: 'default',
      });
    } finally {
      out.restore();
    }
    const log = new EventLog({ root: dataDir, segmentId: 'default' });
    const events = await log.readAllEvents();
    // P0-1 two-phase: intent_recorded (pending) then execution_complete.
    expect(events).toHaveLength(2);
    expect(events[0]!.outcome).toBe('pending');
    expect(events[1]!.outcome).toBe('no_policy_configured');
    expect(events[1]!.intent_recorded_event_id).toBe(events[0]!.event_id);
    // KEY DISTINCTION from the fail-closed case: execution_result is set
    // on the second-phase event.
    expect(events[1]!.execution_result).not.toBeNull();
    expect(events[1]!.execution_result?.exit_code).toBe(0);
  });

  it('writes a visible WARNING to stderr before executing', async () => {
    const out = silenceOutput();
    try {
      await runExec({
        command: '/usr/bin/true',
        args: [],
        agentId: 'p0-4-test',
        cwd: '/tmp',
        timeoutMs: 0,
        dataDir,
        segmentId: 'default',
      });
    } finally {
      out.restore();
    }
    const stderrJoined = out.stderr.join('');
    expect(stderrJoined).toContain('WARNING');
    expect(stderrJoined).toContain(ENV_UNSAFE_ALLOW_NO_POLICY);
    expect(stderrJoined).toContain('advisory-only');
  });

  it('preserves outcome=no_policy_configured even when the subprocess exits non-zero', async () => {
    const out = silenceOutput();
    try {
      const exit = await runExec({
        command: '/usr/bin/false',
        args: [],
        agentId: 'p0-4-test',
        cwd: '/tmp',
        timeoutMs: 0,
        dataDir,
        segmentId: 'default',
      });
      expect(exit).toBe(1); // false exits 1
    } finally {
      out.restore();
    }
    const log = new EventLog({ root: dataDir, segmentId: 'default' });
    const events = await log.readAllEvents();
    // events[0] = intent_recorded (pending), events[1] = execution_complete
    expect(events[1]!.outcome).toBe('no_policy_configured');
    expect(events[1]!.execution_result?.exit_code).toBe(1);
  });
});

describe('runExec — policy-allow remains distinguishable from no_policy_configured', () => {
  beforeEach(() => {
    const policyDir = join(dataDir, 'policy-packs');
    mkdirSync(policyDir, { recursive: true });
    writeFileSync(
      join(policyDir, 'allow-echo.json'),
      JSON.stringify({
        schema_version: 'witseal.policy.v0.1',
        pack_id: 'allow-echo',
        version: '1.0.0',
        description: 'Allows /bin/echo for the P0-4 test surface.',
        rules: [
          {
            id: 'allow-echo',
            match: { command_matches: '^/bin/echo' },
            decision: 'allow',
            reason: 'echo is informational',
          },
        ],
        default_decision: 'deny',
      })
    );
  });

  it('with packs loaded, outcome is allowed_executed (NOT no_policy_configured)', async () => {
    const out = silenceOutput();
    try {
      const exit = await runExec({
        command: '/bin/echo',
        args: ['allowed'],
        agentId: 'p0-4-test',
        cwd: '/tmp',
        timeoutMs: 0,
        dataDir,
        segmentId: 'default',
      });
      expect(exit).toBe(0);
    } finally {
      out.restore();
    }
    const log = new EventLog({ root: dataDir, segmentId: 'default' });
    const events = await log.readAllEvents();
    // P0-1: two events — intent_recorded then execution_complete.
    expect(events).toHaveLength(2);
    expect(events[0]!.outcome).toBe('pending');
    expect(events[1]!.outcome).toBe('allowed_executed');
    expect(events[1]!.outcome).not.toBe('no_policy_configured');
  });
});
