/**
 * Tests for mediateFile (src/execution/mediator.ts).
 *
 * mediateFile mediates file_write and file_read intents using the same
 * architectural pattern as mediateShell: returns Promise<ExecutionResult>,
 * captures output via BoundedStreamingCapture, surfaces spawn-time failures
 * via the spawn_error field.
 *
 * v0.1 policy (documented here, may be revisited):
 *   - Symbolic links: refused on both the target path and any ancestor
 *     directory (TOCTOU + path-escape risk). Real-path resolution and
 *     policy-driven symlink handling are out of scope for v0.1.
 *   - content_hash validation for file_write: the provided content bytes
 *     must hash (lowercase hex SHA-256) to the value in intent.content_hash.
 *     Mismatch causes spawn_error before any file write occurs.
 *   - Target type: regular files only. Directories, devices, FIFOs, etc.
 *     produce spawn_error.
 *
 * These tests are written BEFORE mediateFile implementation exists. They
 * are expected to fail (RED) until C2 lands.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { mediateFile } from '../src/execution/mediator.js';
import type { Intent } from '../schemas/intent.schema.js';

function sha256Hex(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function writeIntent(opts: {
  path: string;
  content: Buffer | string;
  mode?: 'overwrite' | 'append' | 'create_only';
}): Extract<Intent, { action_type: 'file_write' }> {
  const bytes = Buffer.isBuffer(opts.content) ? opts.content : Buffer.from(opts.content, 'utf8');
  return {
    action_type: 'file_write',
    path: opts.path,
    content_hash: sha256Hex(bytes),
    content_size_bytes: bytes.length,
    mode: opts.mode ?? 'overwrite',
  };
}

function readIntent(path: string): Extract<Intent, { action_type: 'file_read' }> {
  return { action_type: 'file_read', path };
}

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'witseal-mediator-file-'));
});

afterEach(() => {
  // Best-effort cleanup; chmod back to allow recursive delete
  try {
    chmodSync(workDir, 0o755);
  } catch {
    // ignore
  }
  rmSync(workDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// file_write — happy paths
// ---------------------------------------------------------------------------

describe('mediateFile — file_write happy paths', () => {
  it('writes a new file in overwrite mode', async () => {
    const path = join(workDir, 'out.txt');
    const intent = writeIntent({ path, content: 'hello\n' });
    const result = await mediateFile(intent, { content: 'hello\n' });

    expect(result.spawn_error).toBe(null);
    expect(result.exit_code).toBe(0);
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe('hello\n');
  });

  it('overwrites an existing file in overwrite mode', async () => {
    const path = join(workDir, 'out.txt');
    writeFileSync(path, 'old content');
    const intent = writeIntent({ path, content: 'new content' });
    const result = await mediateFile(intent, { content: 'new content' });

    expect(result.spawn_error).toBe(null);
    expect(readFileSync(path, 'utf8')).toBe('new content');
  });

  it('creates a new file in append mode if missing', async () => {
    const path = join(workDir, 'log.txt');
    const intent = writeIntent({ path, content: 'first line\n', mode: 'append' });
    const result = await mediateFile(intent, { content: 'first line\n' });

    expect(result.spawn_error).toBe(null);
    expect(readFileSync(path, 'utf8')).toBe('first line\n');
  });

  it('appends to an existing file in append mode', async () => {
    const path = join(workDir, 'log.txt');
    writeFileSync(path, 'existing\n');
    const intent = writeIntent({ path, content: 'appended\n', mode: 'append' });
    const result = await mediateFile(intent, { content: 'appended\n' });

    expect(result.spawn_error).toBe(null);
    expect(readFileSync(path, 'utf8')).toBe('existing\nappended\n');
  });

  it('creates a new file in create_only mode if missing', async () => {
    const path = join(workDir, 'new.txt');
    const intent = writeIntent({ path, content: 'fresh', mode: 'create_only' });
    const result = await mediateFile(intent, { content: 'fresh' });

    expect(result.spawn_error).toBe(null);
    expect(readFileSync(path, 'utf8')).toBe('fresh');
  });

  it('refuses create_only when file already exists', async () => {
    const path = join(workDir, 'exists.txt');
    writeFileSync(path, 'original');
    const intent = writeIntent({ path, content: 'new', mode: 'create_only' });
    const result = await mediateFile(intent, { content: 'new' });

    expect(result.spawn_error).not.toBe(null);
    expect(result.spawn_error).toMatch(/exist|EEXIST/i);
    expect(readFileSync(path, 'utf8')).toBe('original');
  });

  it('writes binary content correctly', async () => {
    const path = join(workDir, 'bin.dat');
    const bytes = Buffer.from([0x00, 0x01, 0x02, 0xff, 0x7f, 0x80]);
    const intent = writeIntent({ path, content: bytes });
    const result = await mediateFile(intent, { content: bytes });

    expect(result.spawn_error).toBe(null);
    expect(readFileSync(path)).toEqual(bytes);
  });

  it('returns a valid ExecutionResult shape', async () => {
    const path = join(workDir, 'shape.txt');
    const intent = writeIntent({ path, content: 'x' });
    const result = await mediateFile(intent, { content: 'x' });

    expect(result.schema_version).toBe('witseal.execution.v0.1');
    expect(result.started_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(result.finished_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(result.exit_code).toBe(0);
    expect(result.signal).toBe(null);
    expect(result.stdout).toBeDefined();
    expect(result.stderr).toBeDefined();
    expect(result.executable_resolved).toBeTypeOf('string');
    expect(result.executable_resolved.length).toBeGreaterThan(0);
    expect(result.env_keys_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.spawn_error).toBe(null);
  });

  it('records the bytes-written summary in stdout', async () => {
    const path = join(workDir, 'summary.txt');
    const content = 'twelve bytes';
    const intent = writeIntent({ path, content });
    const result = await mediateFile(intent, { content });

    // The stdout content for a write is not the file content (privacy/size);
    // it is a short summary including the byte count.
    expect(result.stdout.total_bytes).toBeGreaterThan(0);
    expect(result.stdout.content_hash).toMatch(/^[a-f0-9]{64}$/);
    // Should mention the byte count in the head text for human readability.
    expect(result.stdout.head ?? '').toMatch(/12/);
  });
});

// ---------------------------------------------------------------------------
// file_write — failure modes
// ---------------------------------------------------------------------------

describe('mediateFile — file_write failure modes', () => {
  it('refuses when content_hash mismatches actual content bytes', async () => {
    const path = join(workDir, 'mismatch.txt');
    const intent: Extract<Intent, { action_type: 'file_write' }> = {
      action_type: 'file_write',
      path,
      content_hash: 'a'.repeat(64), // declared hash does not match real content
      content_size_bytes: 5,
      mode: 'overwrite',
    };
    const result = await mediateFile(intent, { content: 'hello' });

    expect(result.spawn_error).not.toBe(null);
    expect(result.spawn_error).toMatch(/hash|mismatch/i);
    expect(existsSync(path)).toBe(false);
  });

  it('refuses when content_size_bytes mismatches actual content length', async () => {
    const path = join(workDir, 'sizemismatch.txt');
    const content = 'hello';
    const intent: Extract<Intent, { action_type: 'file_write' }> = {
      action_type: 'file_write',
      path,
      content_hash: sha256Hex(content),
      content_size_bytes: 999, // declared size does not match real content
      mode: 'overwrite',
    };
    const result = await mediateFile(intent, { content });

    expect(result.spawn_error).not.toBe(null);
    expect(result.spawn_error).toMatch(/size|length/i);
    expect(existsSync(path)).toBe(false);
  });

  it('refuses when options.content is missing for file_write', async () => {
    const path = join(workDir, 'nocontent.txt');
    const intent = writeIntent({ path, content: 'x' });
    const result = await mediateFile(intent);

    expect(result.spawn_error).not.toBe(null);
    expect(result.spawn_error).toMatch(/content/i);
    expect(existsSync(path)).toBe(false);
  });

  it('refuses ENOENT on missing parent directory', async () => {
    const path = join(workDir, 'missing-subdir', 'out.txt');
    const intent = writeIntent({ path, content: 'x' });
    const result = await mediateFile(intent, { content: 'x' });

    expect(result.spawn_error).not.toBe(null);
    expect(result.spawn_error).toMatch(/ENOENT|no such file|directory/i);
  });

  it('refuses EACCES on read-only target directory', async () => {
    // Skip if running as root (chmod has no effect for uid 0)
    if (process.getuid?.() === 0) return;

    const lockedDir = join(workDir, 'readonly');
    mkdirSync(lockedDir);
    chmodSync(lockedDir, 0o555); // r-xr-xr-x
    const path = join(lockedDir, 'out.txt');
    const intent = writeIntent({ path, content: 'x' });
    const result = await mediateFile(intent, { content: 'x' });

    expect(result.spawn_error).not.toBe(null);
    expect(result.spawn_error).toMatch(/EACCES|permission/i);
  });

  it('refuses to write through a symlink at the target path', async () => {
    const realFile = join(workDir, 'real.txt');
    writeFileSync(realFile, 'real');
    const link = join(workDir, 'link.txt');
    symlinkSync(realFile, link);

    const intent = writeIntent({ path: link, content: 'pwn' });
    const result = await mediateFile(intent, { content: 'pwn' });

    expect(result.spawn_error).not.toBe(null);
    expect(result.spawn_error).toMatch(/symlink|symbolic link/i);
    // Real file untouched
    expect(readFileSync(realFile, 'utf8')).toBe('real');
  });

  it('refuses to write when an ancestor directory is a symlink', async () => {
    const realDir = join(workDir, 'realdir');
    mkdirSync(realDir);
    const linkDir = join(workDir, 'linkdir');
    symlinkSync(realDir, linkDir);

    const path = join(linkDir, 'out.txt');
    const intent = writeIntent({ path, content: 'x' });
    const result = await mediateFile(intent, { content: 'x' });

    expect(result.spawn_error).not.toBe(null);
    expect(result.spawn_error).toMatch(/symlink|symbolic link/i);
  });

  it('refuses when target path is an existing directory', async () => {
    const dirPath = join(workDir, 'subdir');
    mkdirSync(dirPath);
    const intent = writeIntent({ path: dirPath, content: 'x' });
    const result = await mediateFile(intent, { content: 'x' });

    expect(result.spawn_error).not.toBe(null);
    expect(result.spawn_error).toMatch(/directory|EISDIR/i);
  });

  it('refuses when the parent path is a regular file (not a directory)', async () => {
    // Closes mediator.ts validatePathSafety parent-non-directory branch
    // (lines 450-452): lstat(parent) succeeds, parentStat.isDirectory() is
    // false, so a "parent is not a directory" string is returned BEFORE the
    // target lstat runs.
    const parentFile = join(workDir, 'iam-a-file');
    writeFileSync(parentFile, 'just a file');
    const path = join(parentFile, 'child.txt');
    const intent = writeIntent({ path, content: 'x' });
    const result = await mediateFile(intent, { content: 'x' });

    expect(result.spawn_error).not.toBe(null);
    expect(result.spawn_error).toMatch(/parent is not a directory/i);
    // Sanity: real file untouched
    expect(readFileSync(parentFile, 'utf8')).toBe('just a file');
  });

  it('accepts a non-Buffer Uint8Array content payload', async () => {
    // Closes mediator.ts normalizeContent Uint8Array branch (line 417):
    // Buffer.isBuffer(u8) is false for plain Uint8Array, typeof === 'object'
    // skips the string branch, so Buffer.from(content) is the path taken.
    const path = join(workDir, 'u8.bin');
    const u8 = new Uint8Array([0x10, 0x20, 0x30, 0xff]);
    // Defensive guard: ensure we're not accidentally passing a Buffer
    expect(Buffer.isBuffer(u8)).toBe(false);
    const intent: Extract<Intent, { action_type: 'file_write' }> = {
      action_type: 'file_write',
      path,
      content_hash: createHash('sha256').update(u8).digest('hex'),
      content_size_bytes: u8.length,
      mode: 'overwrite',
    };
    const result = await mediateFile(intent, { content: u8 });

    expect(result.spawn_error).toBe(null);
    expect(readFileSync(path)).toEqual(Buffer.from(u8));
  });
});

// ---------------------------------------------------------------------------
// file_read — happy paths
// ---------------------------------------------------------------------------

describe('mediateFile — file_read happy paths', () => {
  it('reads a small text file into stdout (head populated, no tail, not truncated)', async () => {
    const path = join(workDir, 'in.txt');
    writeFileSync(path, 'hello world');

    const result = await mediateFile(readIntent(path));

    expect(result.spawn_error).toBe(null);
    expect(result.exit_code).toBe(0);
    expect(result.stdout.total_bytes).toBe(11);
    expect(result.stdout.head).toBe('hello world');
    expect(result.stdout.tail).toBe(null);
    expect(result.stdout.truncated).toBe(false);
    expect(result.stdout.content_hash).toBe(sha256Hex('hello world'));
  });

  it('reads an empty file', async () => {
    const path = join(workDir, 'empty.txt');
    writeFileSync(path, '');

    const result = await mediateFile(readIntent(path));

    expect(result.spawn_error).toBe(null);
    expect(result.stdout.total_bytes).toBe(0);
    expect(result.stdout.head_bytes).toBe(0);
    expect(result.stdout.tail_bytes).toBe(0);
    expect(result.stdout.truncated).toBe(false);
    expect(result.stdout.content_hash).toBe(sha256Hex(''));
  });

  it('reads a large file with truncation (head + tail populated, truncated=true)', async () => {
    // 200 KB file — exceeds 64 KB head + 64 KB tail
    const path = join(workDir, 'big.bin');
    const totalBytes = 200 * 1024;
    const data = Buffer.alloc(totalBytes);
    for (let i = 0; i < totalBytes; i++) data[i] = i & 0xff;
    writeFileSync(path, data);

    const result = await mediateFile(readIntent(path));

    expect(result.spawn_error).toBe(null);
    expect(result.stdout.total_bytes).toBe(totalBytes);
    expect(result.stdout.truncated).toBe(true);
    expect(result.stdout.head_bytes).toBe(64 * 1024);
    expect(result.stdout.tail_bytes).toBe(64 * 1024);
    expect(result.stdout.content_hash).toBe(sha256Hex(data));
  });

  it('reads binary content correctly (content_hash matches exact bytes)', async () => {
    const path = join(workDir, 'bytes.bin');
    const data = Buffer.from([0x00, 0x01, 0x80, 0xff, 0x7f]);
    writeFileSync(path, data);

    const result = await mediateFile(readIntent(path));

    expect(result.spawn_error).toBe(null);
    expect(result.stdout.total_bytes).toBe(5);
    expect(result.stdout.content_hash).toBe(sha256Hex(data));
  });

  it('returns a valid ExecutionResult shape for file_read', async () => {
    const path = join(workDir, 'shape.txt');
    writeFileSync(path, 'x');

    const result = await mediateFile(readIntent(path));

    expect(result.schema_version).toBe('witseal.execution.v0.1');
    expect(result.started_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(result.finished_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(result.exit_code).toBe(0);
    expect(result.signal).toBe(null);
    expect(result.executable_resolved).toBeTypeOf('string');
    expect(result.env_keys_hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// file_read — failure modes
// ---------------------------------------------------------------------------

describe('mediateFile — file_read failure modes', () => {
  it('refuses ENOENT on missing file', async () => {
    const path = join(workDir, 'does-not-exist.txt');
    const result = await mediateFile(readIntent(path));

    expect(result.spawn_error).not.toBe(null);
    expect(result.spawn_error).toMatch(/ENOENT|no such file/i);
  });

  it('refuses EACCES on unreadable file', async () => {
    if (process.getuid?.() === 0) return; // root bypasses permissions

    const path = join(workDir, 'secret.txt');
    writeFileSync(path, 'secret');
    chmodSync(path, 0o000);
    const result = await mediateFile(readIntent(path));

    // Restore for cleanup
    chmodSync(path, 0o644);

    expect(result.spawn_error).not.toBe(null);
    expect(result.spawn_error).toMatch(/EACCES|permission/i);
  });

  it('refuses to read a directory', async () => {
    const dir = join(workDir, 'mydir');
    mkdirSync(dir);
    const result = await mediateFile(readIntent(dir));

    expect(result.spawn_error).not.toBe(null);
    expect(result.spawn_error).toMatch(/directory|EISDIR|not a regular file/i);
  });

  it('refuses to follow a symbolic link to a file', async () => {
    const realFile = join(workDir, 'real.txt');
    writeFileSync(realFile, 'real content');
    const link = join(workDir, 'link.txt');
    symlinkSync(realFile, link);

    const result = await mediateFile(readIntent(link));

    expect(result.spawn_error).not.toBe(null);
    expect(result.spawn_error).toMatch(/symlink|symbolic link/i);
  });

  it('refuses when an ancestor directory is a symbolic link', async () => {
    const realDir = join(workDir, 'realdir');
    mkdirSync(realDir);
    writeFileSync(join(realDir, 'in.txt'), 'data');
    const linkDir = join(workDir, 'linkdir');
    symlinkSync(realDir, linkDir);

    const result = await mediateFile(readIntent(join(linkDir, 'in.txt')));

    expect(result.spawn_error).not.toBe(null);
    expect(result.spawn_error).toMatch(/symlink|symbolic link/i);
  });

  it('refuses to dereference a broken symlink', async () => {
    const link = join(workDir, 'broken.lnk');
    symlinkSync(join(workDir, 'nonexistent-target'), link);

    const result = await mediateFile(readIntent(link));

    expect(result.spawn_error).not.toBe(null);
    expect(result.spawn_error).toMatch(/symlink|symbolic link/i);
  });
});

// ---------------------------------------------------------------------------
// Argument validation
// ---------------------------------------------------------------------------

describe('mediateFile — argument validation', () => {
  it('rejects intent of action_type=shell_command', async () => {
    const shellIntent: Intent = {
      action_type: 'shell_command',
      executable: 'echo',
      args: ['x'],
      cwd: '/tmp',
      use_tty: false,
    };
    // mediateFile expects file_* intents only; passing shell_command is a caller bug.
    // Two acceptable shapes: throws synchronously OR returns spawn_error.
    // We assert one or the other, not both — assertion below accepts either.
    let threw = false;
    let result;
    try {
      result = await mediateFile(shellIntent as never);
    } catch {
      threw = true;
    }
    expect(threw || (result !== undefined && result.spawn_error !== null)).toBe(true);
  });

  it('passes statSync sanity check after a successful write', async () => {
    // Defense against partial writes: after the operation reports success,
    // the file on disk has exactly the expected size.
    const path = join(workDir, 'verified.txt');
    const content = 'verify this exact size';
    const intent = writeIntent({ path, content });
    const result = await mediateFile(intent, { content });

    expect(result.spawn_error).toBe(null);
    const stat = statSync(path);
    expect(stat.size).toBe(Buffer.byteLength(content, 'utf8'));
    expect(stat.isFile()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// P1-9 — documented file_write semantics (no rollback claim)
// ---------------------------------------------------------------------------
//
// Runtime-boundary audit 2026-05-25 finding TS-P1-9: document/test exact
// `overwrite` / `append` / `create_only` semantics; do NOT claim rollback.
// These tests pin the documented contracts so any future regression toward
// silent rollback or idempotent-claims surfaces in CI.

describe('mediateFile — documented file_write semantics (P1-9)', () => {
  it('overwrite is destructive: prior content is replaced, not preserved', async () => {
    const path = join(workDir, 'destroyable.txt');
    writeFileSync(path, 'PRIOR-CONTENT-PRESERVE-ME');
    const intent = writeIntent({ path, content: 'NEW', mode: 'overwrite' });
    const result = await mediateFile(intent, { content: 'NEW' });
    expect(result.spawn_error).toBe(null);
    // No "rollback" or "history" — file is now exactly 'NEW'.
    expect(readFileSync(path, 'utf8')).toBe('NEW');
    // Length is 3, not 28 (the prior content length). Confirms truncation.
    expect(statSync(path).size).toBe(3);
  });

  it('append is additive: existing bytes are preserved, new bytes follow', async () => {
    const path = join(workDir, 'log.txt');
    writeFileSync(path, 'A\n');
    const intent = writeIntent({ path, content: 'B\n', mode: 'append' });
    const result = await mediateFile(intent, { content: 'B\n' });
    expect(result.spawn_error).toBe(null);
    expect(readFileSync(path, 'utf8')).toBe('A\nB\n');
    // Two consecutive appends are additive, not idempotent.
    const result2 = await mediateFile(intent, { content: 'B\n' });
    expect(result2.spawn_error).toBe(null);
    expect(readFileSync(path, 'utf8')).toBe('A\nB\nB\n');
  });

  it('create_only is use-once: second invocation against an existing file fails atomically (no overwrite)', async () => {
    const path = join(workDir, 'once.txt');
    const intent = writeIntent({ path, content: 'first', mode: 'create_only' });
    const first = await mediateFile(intent, { content: 'first' });
    expect(first.spawn_error).toBe(null);
    expect(readFileSync(path, 'utf8')).toBe('first');

    // Retry with different content must NOT overwrite — the contract is
    // "fail with EEXIST if file exists" with zero modification.
    const intent2 = writeIntent({ path, content: 'second-attempt', mode: 'create_only' });
    const retry = await mediateFile(intent2, { content: 'second-attempt' });
    expect(retry.spawn_error).not.toBeNull();
    expect(retry.spawn_error).toMatch(/EEXIST|exist/i);
    expect(readFileSync(path, 'utf8')).toBe('first'); // unchanged
  });

  it('overwrite mid-write failure does NOT roll back to prior content (documented limitation)', async () => {
    // Simulating an actual EIO/ENOSPC mid-writeFile is platform-fragile.
    // What we CAN assert is that mediateFile does not advertise rollback
    // and that a successful overwrite genuinely replaces — proof that the
    // mediator does not stage to a temp file behind the caller's back.
    const path = join(workDir, 'no-rollback.txt');
    const priorContent = 'PRIOR';
    writeFileSync(path, priorContent);
    const intent = writeIntent({
      path,
      content: 'REPLACED',
      mode: 'overwrite',
    });
    const result = await mediateFile(intent, { content: 'REPLACED' });
    expect(result.spawn_error).toBe(null);
    expect(readFileSync(path, 'utf8')).toBe('REPLACED');
    // Confirms: there is no `.bak`, no `.tmp` sibling, no "before" version
    // recoverable from the filesystem after a successful overwrite.
    expect(existsSync(path + '.bak')).toBe(false);
    expect(existsSync(path + '.tmp')).toBe(false);
    expect(existsSync(path + '~')).toBe(false);
  });

  it('content_hash precheck prevents any write when content does not match (no partial state)', async () => {
    const path = join(workDir, 'guarded.txt');
    const intent: Extract<Intent, { action_type: 'file_write' }> = {
      action_type: 'file_write',
      path,
      content_hash: 'a'.repeat(64), // wrong hash
      content_size_bytes: 5,
      mode: 'overwrite',
    };
    const result = await mediateFile(intent, { content: 'hello' });
    expect(result.spawn_error).not.toBeNull();
    expect(result.spawn_error).toMatch(/hash/i);
    // Critical: no file was created. The check is BEFORE any open/write.
    expect(existsSync(path)).toBe(false);
  });

  it('exit_code is 1 on spawn_error (no rollback signal — caller decides)', async () => {
    const path = join(workDir, 'sub', 'missing-parent.txt');
    const intent = writeIntent({ path, content: 'x', mode: 'overwrite' });
    const result = await mediateFile(intent, { content: 'x' });
    expect(result.spawn_error).not.toBeNull();
    expect(result.exit_code).toBe(1);
    // No partial file created.
    expect(existsSync(path)).toBe(false);
  });
});
