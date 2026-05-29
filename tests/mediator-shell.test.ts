/**
 * Tests for mediateShell (src/execution/mediator.ts).
 *
 * mediateShell spawns a real subprocess via Node's child_process.spawn with
 * explicit argv (no shell interpolation), captures stdout/stderr through a
 * bounded streaming capture, applies optional timeout (SIGTERM then SIGKILL),
 * and produces an ExecutionResult.
 *
 * Tests use absolute system binaries on POSIX (/bin, /usr/bin) to avoid
 * PATH variability across CI environments.
 *
 * This file also rounds out mediateFile coverage with edge cases beyond
 * those in tests/mediator-file.test.ts (empty content, single-byte read,
 * boundary-size read, special characters in filenames).
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mediateShell, mediateFile } from '../src/execution/mediator.js';
import type { Intent } from '../schemas/intent.schema.js';

function shell(executable: string, args: string[] = [], cwd = '/tmp'): Extract<Intent, { action_type: 'shell_command' }> {
  return { action_type: 'shell_command', executable, args, cwd, use_tty: false };
}

// ---------------------------------------------------------------------------
// mediateShell — happy paths
// ---------------------------------------------------------------------------

describe('mediateShell — happy paths', () => {
  it('runs /bin/echo and captures stdout', async () => {
    const result = await mediateShell(shell('/bin/echo', ['hello']));

    expect(result.spawn_error).toBe(null);
    expect(result.exit_code).toBe(0);
    expect(result.signal).toBe(null);
    expect(result.stdout.head).toBe('hello\n');
    expect(result.stdout.total_bytes).toBe(6);
    expect(result.stderr.total_bytes).toBe(0);
  });

  it('reports non-zero exit via exit_code', async () => {
    const result = await mediateShell(shell('/usr/bin/false'));

    expect(result.spawn_error).toBe(null);
    expect(result.exit_code).toBe(1);
    expect(result.signal).toBe(null);
  });

  it('reports zero exit for /usr/bin/true', async () => {
    const result = await mediateShell(shell('/usr/bin/true'));

    expect(result.spawn_error).toBe(null);
    expect(result.exit_code).toBe(0);
  });

  it('returns a valid ExecutionResult shape', async () => {
    const result = await mediateShell(shell('/bin/echo', ['shape']));

    expect(result.schema_version).toBe('witseal.execution.v0.1');
    expect(result.started_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(result.finished_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(result.executable_resolved).toBe('/bin/echo');
    expect(result.env_keys_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('does NOT interpret shell metacharacters in argv', async () => {
    // Passing "$HOME" as an argument to echo should print the literal
    // string "$HOME", not the value of the variable. This proves there
    // is no shell-string expansion in mediateShell.
    const result = await mediateShell(shell('/bin/echo', ['$HOME']));

    expect(result.spawn_error).toBe(null);
    expect(result.stdout.head).toBe('$HOME\n');
  });
});

// ---------------------------------------------------------------------------
// mediateShell — stream capture
// ---------------------------------------------------------------------------

describe('mediateShell — stdout/stderr capture', () => {
  it('captures stderr separately from stdout', async () => {
    const result = await mediateShell(
      shell('/bin/sh', ['-c', 'echo to-stdout; echo to-stderr 1>&2'])
    );

    expect(result.spawn_error).toBe(null);
    expect(result.stdout.head).toMatch(/to-stdout/);
    expect(result.stderr.head).toMatch(/to-stderr/);
  });

  it('captures small output without truncation', async () => {
    const result = await mediateShell(shell('/bin/echo', ['short']));

    expect(result.stdout.truncated).toBe(false);
    expect(result.stdout.tail).toBe(null);
    expect(result.stdout.head_bytes).toBe(6);
    expect(result.stdout.tail_bytes).toBe(0);
  });

  it('truncates large stdout with head + tail when exceeding 128 KB', async () => {
    // Generate 200 KB of output via node so we don't depend on yes/seq.
    const script = "let n=0; while(n<200*1024){process.stdout.write('x'); n++;}";
    const result = await mediateShell(shell(process.execPath, ['-e', script]));

    expect(result.spawn_error).toBe(null);
    expect(result.stdout.total_bytes).toBe(200 * 1024);
    expect(result.stdout.truncated).toBe(true);
    expect(result.stdout.head_bytes).toBe(64 * 1024);
    expect(result.stdout.tail_bytes).toBe(64 * 1024);
  });

  it('computes content_hash over the FULL stream, not the truncated portion', async () => {
    const totalBytes = 200 * 1024;
    const script = `let n=0; while(n<${totalBytes}){process.stdout.write('x'); n++;}`;
    const result = await mediateShell(shell(process.execPath, ['-e', script]));

    const expectedHash = createHash('sha256').update('x'.repeat(totalBytes)).digest('hex');
    expect(result.stdout.content_hash).toBe(expectedHash);
  });

  it('handles binary (non-UTF8) output bytes', async () => {
    const script = 'process.stdout.write(Buffer.from([0,1,127,128,255]))';
    const result = await mediateShell(shell(process.execPath, ['-e', script]));

    expect(result.spawn_error).toBe(null);
    expect(result.stdout.total_bytes).toBe(5);
    const expectedHash = createHash('sha256').update(Buffer.from([0, 1, 127, 128, 255])).digest('hex');
    expect(result.stdout.content_hash).toBe(expectedHash);
  });
});

// ---------------------------------------------------------------------------
// mediateShell — spawn failures
// ---------------------------------------------------------------------------

describe('mediateShell — spawn failures', () => {
  it('captures spawn_error for nonexistent executable (ENOENT)', async () => {
    const result = await mediateShell(shell('/no/such/binary/here'));

    expect(result.spawn_error).not.toBe(null);
    expect(result.spawn_error).toMatch(/ENOENT|no such/i);
    expect(result.exit_code).toBe(-1);
  });

  it('captures spawn_error for non-executable file', async () => {
    // /etc/hosts is a regular file but not executable on macOS/Linux
    const result = await mediateShell(shell('/etc/hosts'));

    expect(result.spawn_error).not.toBe(null);
    // Permission/format error — accept either flavor
    expect(result.spawn_error).toMatch(/EACCES|permission|ENOEXEC|exec format/i);
  });
});

// ---------------------------------------------------------------------------
// mediateShell — timeout
// ---------------------------------------------------------------------------

describe('mediateShell — timeout', () => {
  it('SIGTERMs a long-running process when timeoutMs elapses', async () => {
    const result = await mediateShell(
      shell('/bin/sh', ['-c', 'sleep 10']),
      { timeoutMs: 100 }
    );

    // After SIGTERM, the process exits with a signal. We expect signal to
    // be populated and exit_code to be -1 (killed by signal).
    expect(result.signal).not.toBe(null);
    expect(['SIGTERM', 'SIGKILL']).toContain(result.signal);
  }, 15000);

  it('does NOT kill a process that completes within timeout', async () => {
    const result = await mediateShell(
      shell('/bin/echo', ['fast']),
      { timeoutMs: 5_000 }
    );

    expect(result.spawn_error).toBe(null);
    expect(result.signal).toBe(null);
    expect(result.exit_code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// mediateShell — environment filtering
// ---------------------------------------------------------------------------

describe('mediateShell — environment filtering', () => {
  it('passes only the requested env keys to the subprocess', async () => {
    // Stage: set a known marker on this process, request only that key,
    // then inspect what the subprocess saw.
    process.env.WITSEAL_TEST_MARKER = 'present';
    process.env.WITSEAL_TEST_SECRET = 'should-not-leak';

    try {
      const result = await mediateShell({
        ...shell(process.execPath, ['-e', 'console.log(JSON.stringify(Object.keys(process.env).sort()))']),
        env_keys_passed: ['WITSEAL_TEST_MARKER', 'PATH'],
      });

      expect(result.spawn_error).toBe(null);
      const keys = JSON.parse(result.stdout.head ?? '[]');
      expect(keys).toContain('WITSEAL_TEST_MARKER');
      expect(keys).not.toContain('WITSEAL_TEST_SECRET');
    } finally {
      delete process.env.WITSEAL_TEST_MARKER;
      delete process.env.WITSEAL_TEST_SECRET;
    }
  });

  it('env_keys_hash is deterministic and order-independent for the same key set', async () => {
    const r1 = await mediateShell({
      ...shell('/bin/echo', ['a']),
      env_keys_passed: ['PATH', 'HOME'],
    });
    const r2 = await mediateShell({
      ...shell('/bin/echo', ['a']),
      env_keys_passed: ['HOME', 'PATH'], // reverse order
    });
    expect(r1.env_keys_hash).toBe(r2.env_keys_hash);
  });

  it('env_keys_hash differs for different key sets', async () => {
    const r1 = await mediateShell({
      ...shell('/bin/echo', ['a']),
      env_keys_passed: ['PATH'],
    });
    const r2 = await mediateShell({
      ...shell('/bin/echo', ['a']),
      env_keys_passed: ['HOME'],
    });
    expect(r1.env_keys_hash).not.toBe(r2.env_keys_hash);
  });

  it('options.envKeys overrides intent.env_keys_passed', async () => {
    const r = await mediateShell(
      {
        ...shell('/bin/echo', ['x']),
        env_keys_passed: ['HOME'],
      },
      { envKeys: ['PATH'] }
    );
    const reference = await mediateShell({
      ...shell('/bin/echo', ['x']),
      env_keys_passed: ['PATH'],
    });
    expect(r.env_keys_hash).toBe(reference.env_keys_hash);
  });
});

// ---------------------------------------------------------------------------
// mediateShell — cwd
// ---------------------------------------------------------------------------

describe('mediateShell — cwd', () => {
  it('runs the subprocess in the requested working directory', async () => {
    const result = await mediateShell({
      ...shell('/bin/pwd'),
      cwd: '/tmp',
    });

    expect(result.spawn_error).toBe(null);
    // macOS resolves /tmp → /private/tmp; accept either.
    expect((result.stdout.head ?? '').trim()).toMatch(/\/tmp$|\/private\/tmp$/);
  });
});

// ---------------------------------------------------------------------------
// mediateFile — round-out edge cases
// ---------------------------------------------------------------------------

describe('mediateFile — file_write edge cases (round-out)', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'witseal-mediator-write-edges-'));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('writes empty content (0 bytes) successfully in overwrite mode', async () => {
    const path = join(workDir, 'empty.txt');
    const result = await mediateFile(
      {
        action_type: 'file_write',
        path,
        content_hash: createHash('sha256').digest('hex'), // sha256('')
        content_size_bytes: 0,
        mode: 'overwrite',
      },
      { content: Buffer.alloc(0) }
    );

    expect(result.spawn_error).toBe(null);
    expect(readFileSync(path)).toEqual(Buffer.alloc(0));
  });

  it('accepts string content (UTF-8 encoded) for file_write', async () => {
    const path = join(workDir, 'utf8.txt');
    const content = 'café ☕ über';
    const bytes = Buffer.from(content, 'utf8');
    const result = await mediateFile(
      {
        action_type: 'file_write',
        path,
        content_hash: createHash('sha256').update(bytes).digest('hex'),
        content_size_bytes: bytes.length,
        mode: 'overwrite',
      },
      { content }
    );

    expect(result.spawn_error).toBe(null);
    expect(readFileSync(path, 'utf8')).toBe(content);
  });

  it('writes a file with special characters in the filename', async () => {
    const path = join(workDir, 'spaces and ünicode 漢字.txt');
    const content = 'ok';
    const bytes = Buffer.from(content, 'utf8');
    const result = await mediateFile(
      {
        action_type: 'file_write',
        path,
        content_hash: createHash('sha256').update(bytes).digest('hex'),
        content_size_bytes: bytes.length,
        mode: 'overwrite',
      },
      { content }
    );
    expect(result.spawn_error).toBe(null);
    expect(readFileSync(path, 'utf8')).toBe(content);
  });
});

describe('mediateFile — file_read edge cases (round-out)', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'witseal-mediator-read-edges-'));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('reads a single-byte file correctly', async () => {
    const path = join(workDir, 'one.bin');
    writeFileSync(path, Buffer.from([0x42]));
    const result = await mediateFile({ action_type: 'file_read', path });

    expect(result.spawn_error).toBe(null);
    expect(result.stdout.total_bytes).toBe(1);
    expect(result.stdout.content_hash).toBe(
      createHash('sha256').update(Buffer.from([0x42])).digest('hex')
    );
  });

  it('reads file at exactly the head boundary (64 KB) without truncation', async () => {
    const path = join(workDir, 'boundary.bin');
    const data = Buffer.alloc(64 * 1024, 0x61); // 64 KB of 'a'
    writeFileSync(path, data);
    const result = await mediateFile({ action_type: 'file_read', path });

    expect(result.spawn_error).toBe(null);
    expect(result.stdout.total_bytes).toBe(64 * 1024);
    expect(result.stdout.truncated).toBe(false);
    expect(result.stdout.head_bytes).toBe(64 * 1024);
    expect(result.stdout.tail_bytes).toBe(0);
  });
});
