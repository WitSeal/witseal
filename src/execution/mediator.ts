/**
 * Execution mediator.
 *
 * Spawns a subprocess with explicit argv (no shell-string interpolation),
 * captures stdout/stderr with bounded head + tail + streaming hash, and
 * produces an ExecutionResult that the witness layer consumes.
 *
 * See ADR-0005 for design rationale.
 */

import { spawn } from 'node:child_process';
import { createHash, type Hash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, writeFile, appendFile, open } from 'node:fs/promises';
import { dirname, resolve as resolvePath } from 'node:path';
import { Writable } from 'node:stream';
import type { ExecutionResult, StreamCapture } from '../../schemas/execution-result.schema.js';
import type { Intent } from '../../schemas/intent.schema.js';

const HEAD_TAIL_BYTES = 64 * 1024; // 64 KB head, 64 KB tail per ADR-0005
const EXECUTION_SCHEMA = 'witseal.execution.v0.1';

/**
 * Streaming capture: accumulates head + tail + sha256 hash + total size.
 */
class BoundedStreamingCapture extends Writable {
  private hash: Hash = createHash('sha256');
  private headBuf: Buffer = Buffer.alloc(0);
  private tailBuf: Buffer = Buffer.alloc(0);
  private totalBytes: number = 0;

  constructor(private readonly headTailSize: number = HEAD_TAIL_BYTES) {
    super();
  }

  override _write(
    chunk: Buffer,
    _enc: BufferEncoding,
    cb: (err?: Error | null) => void
  ): void {
    this.hash.update(chunk);
    this.totalBytes += chunk.length;

    // Append to head if there's room
    if (this.headBuf.length < this.headTailSize) {
      const room = this.headTailSize - this.headBuf.length;
      const slice = chunk.subarray(0, room);
      this.headBuf = Buffer.concat([this.headBuf, slice]);
    }

    // Maintain tail (rolling buffer of last N bytes)
    this.tailBuf = Buffer.concat([this.tailBuf, chunk]);
    if (this.tailBuf.length > this.headTailSize) {
      this.tailBuf = this.tailBuf.subarray(this.tailBuf.length - this.headTailSize);
    }

    cb();
  }

  summarize(): StreamCapture {
    const totalBytes = this.totalBytes;
    const headBytes = Math.min(this.headBuf.length, totalBytes);
    const tailBytes = Math.min(this.tailBuf.length, Math.max(totalBytes - headBytes, 0));
    const truncated = totalBytes > headBytes + tailBytes;

    return {
      total_bytes: totalBytes,
      content_hash: this.hash.digest('hex'),
      head: headBytes > 0 ? this.headBuf.subarray(0, headBytes).toString('utf8') : null,
      tail:
        tailBytes > 0 && truncated
          ? this.tailBuf.subarray(this.tailBuf.length - tailBytes).toString('utf8')
          : null,
      head_bytes: headBytes,
      tail_bytes: tailBytes,
      truncated,
    };
  }
}

export interface MediateOptions {
  /** Subset of env to pass to the subprocess. Keys only; values from process.env. */
  envKeys?: string[];
  /** Optional timeout in ms; SIGTERM after, SIGKILL 5s later. Default: no timeout. */
  timeoutMs?: number;
}

/**
 * Mediate execution of a shell_command intent. Phase 1: shell only.
 * file_write / file_read are mediated by the higher-level orchestrator
 * (not this function).
 */
export async function mediateShell(
  intent: Extract<Intent, { action_type: 'shell_command' }>,
  options: MediateOptions = {}
): Promise<ExecutionResult> {
  const startedAt = new Date();
  const stdoutCap = new BoundedStreamingCapture();
  const stderrCap = new BoundedStreamingCapture();

  // Filter env to only the requested keys
  const requestedKeys = options.envKeys ?? intent.env_keys_passed ?? defaultEnvKeys();
  const env = filterEnv(requestedKeys);
  const envKeysHash = createHash('sha256')
    .update(requestedKeys.slice().sort().join('\n'))
    .digest('hex');

  let spawnError: string | null = null;
  let exitCode = -1;
  let signal: string | null = null;
  let executableResolved = intent.executable;

  try {
    const child = spawn(intent.executable, intent.args, {
      cwd: intent.cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (child.stdout) child.stdout.pipe(stdoutCap);
    if (child.stderr) child.stderr.pipe(stderrCap);

    let timeoutHandle: NodeJS.Timeout | null = null;
    if (options.timeoutMs && options.timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL');
        }, 5_000);
      }, options.timeoutMs);
    }

    const result = await new Promise<{ code: number; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        child.on('error', (err) => reject(err));
        child.on('exit', (code, sig) => resolve({ code: code ?? -1, signal: sig }));
      }
    );

    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (child.spawnfile) executableResolved = child.spawnfile;
    exitCode = result.code;
    signal = result.signal;
  } catch (err: unknown) {
    spawnError = err instanceof Error ? err.message : String(err);
  }

  // Wait for capture streams to finish
  await Promise.all([streamEnd(stdoutCap), streamEnd(stderrCap)]);

  const finishedAt = new Date();

  return {
    schema_version: EXECUTION_SCHEMA,
    started_at: toIsoZ(startedAt),
    finished_at: toIsoZ(finishedAt),
    exit_code: exitCode,
    signal,
    stdout: stdoutCap.summarize(),
    stderr: stderrCap.summarize(),
    executable_resolved: executableResolved,
    env_keys_hash: envKeysHash,
    spawn_error: spawnError,
  };
}

function defaultEnvKeys(): string[] {
  return ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TERM', 'TMPDIR'];
}

function filterEnv(keys: string[]): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const k of keys) {
    if (process.env[k] !== undefined) env[k] = process.env[k];
  }
  return env;
}

function streamEnd(stream: Writable): Promise<void> {
  return new Promise((resolve) => {
    if (stream.writableFinished) {
      resolve();
      return;
    }
    stream.on('finish', () => resolve());
    stream.on('close', () => resolve());
    stream.end();
  });
}

function toIsoZ(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// ---------------------------------------------------------------------------
// File mediation
// ---------------------------------------------------------------------------

export interface MediateFileOptions {
  /**
   * For file_write intents: the actual bytes to write. Required for file_write.
   * Ignored for file_read.
   *
   * The mediator verifies that sha256(content) == intent.content_hash and that
   * Buffer.byteLength(content) == intent.content_size_bytes BEFORE any write
   * occurs. Mismatch causes spawn_error with no file modification.
   */
  content?: Buffer | Uint8Array | string;
  /** Reserved for future use (parity with MediateOptions). Not yet enforced. */
  timeoutMs?: number;
}

const FILE_WRITE_EXECUTABLE = 'witseal:file-write';
const FILE_READ_EXECUTABLE = 'witseal:file-read';

/**
 * Mediate a file_write or file_read intent.
 *
 * v0.1 policy:
 *   - Symbolic links anywhere in the path are refused (TOCTOU + escape risk).
 *   - Regular files only — directories, devices, FIFOs produce spawn_error.
 *   - file_write: content_hash and content_size_bytes are validated against the
 *     provided bytes before any I/O; mismatch produces spawn_error with no
 *     file modification.
 *
 * Returns an ExecutionResult with the same schema as mediateShell. Failures
 * surface via spawn_error; the exit_code is 0 on success and 1 on spawn_error.
 */
export async function mediateFile(
  intent: Extract<Intent, { action_type: 'file_write' | 'file_read' }>,
  options: MediateFileOptions = {}
): Promise<ExecutionResult> {
  if (intent.action_type === 'file_write') {
    return mediateFileWrite(intent, options);
  }
  if (intent.action_type === 'file_read') {
    return mediateFileRead(intent);
  }
  // Defensive: caller passed an intent of the wrong action_type.
  const startedAt = new Date();
  return fileResult({
    executable: 'witseal:file-mediator',
    startedAt,
    finishedAt: new Date(),
    spawnError: `mediateFile invoked with unsupported action_type=${(intent as { action_type: string }).action_type}`,
    stdoutSummary: '',
  });
}

async function mediateFileWrite(
  intent: Extract<Intent, { action_type: 'file_write' }>,
  options: MediateFileOptions
): Promise<ExecutionResult> {
  const startedAt = new Date();
  const absPath = resolvePath(intent.path);

  // Precondition: content must be provided
  if (options.content === undefined || options.content === null) {
    return fileResult({
      executable: FILE_WRITE_EXECUTABLE,
      startedAt,
      finishedAt: new Date(),
      spawnError: 'file_write requires options.content',
      stdoutSummary: '',
    });
  }
  const bytes = normalizeContent(options.content);

  // Precondition: declared size matches actual
  if (bytes.length !== intent.content_size_bytes) {
    return fileResult({
      executable: FILE_WRITE_EXECUTABLE,
      startedAt,
      finishedAt: new Date(),
      spawnError: `content size mismatch: declared ${intent.content_size_bytes} bytes, actual ${bytes.length} bytes`,
      stdoutSummary: '',
    });
  }

  // Precondition: declared hash matches actual
  const actualHash = createHash('sha256').update(bytes).digest('hex');
  if (actualHash !== intent.content_hash.toLowerCase()) {
    return fileResult({
      executable: FILE_WRITE_EXECUTABLE,
      startedAt,
      finishedAt: new Date(),
      spawnError: `content hash mismatch: declared ${intent.content_hash}, actual ${actualHash}`,
      stdoutSummary: '',
    });
  }

  // Symlink + path safety (parent must exist; target may or may not)
  const safety = await validatePathSafety(absPath, { requireTargetExists: false });
  if (safety !== null) {
    return fileResult({
      executable: FILE_WRITE_EXECUTABLE,
      startedAt,
      finishedAt: new Date(),
      spawnError: safety,
      stdoutSummary: '',
    });
  }

  // Perform the write under the selected mode
  let spawnError: string | null = null;
  try {
    switch (intent.mode) {
      case 'overwrite': {
        // O_WRONLY | O_CREAT | O_TRUNC (writeFile default behavior)
        await writeFile(absPath, bytes);
        break;
      }
      case 'append': {
        await appendFile(absPath, bytes);
        break;
      }
      case 'create_only': {
        // O_WRONLY | O_CREAT | O_EXCL
        const fh = await open(absPath, 'wx');
        try {
          await fh.write(bytes);
        } finally {
          await fh.close();
        }
        break;
      }
    }
  } catch (e: unknown) {
    spawnError = formatNodeError(e);
  }

  const finishedAt = new Date();
  if (spawnError) {
    return fileResult({
      executable: FILE_WRITE_EXECUTABLE,
      startedAt,
      finishedAt,
      spawnError,
      stdoutSummary: '',
    });
  }

  const summary = `wrote ${bytes.length} bytes to ${absPath}\n`;
  return fileResult({
    executable: FILE_WRITE_EXECUTABLE,
    startedAt,
    finishedAt,
    spawnError: null,
    stdoutSummary: summary,
  });
}

async function mediateFileRead(
  intent: Extract<Intent, { action_type: 'file_read' }>
): Promise<ExecutionResult> {
  const startedAt = new Date();
  const absPath = resolvePath(intent.path);

  const safety = await validatePathSafety(absPath, { requireTargetExists: true });
  if (safety !== null) {
    return fileResult({
      executable: FILE_READ_EXECUTABLE,
      startedAt,
      finishedAt: new Date(),
      spawnError: safety,
      stdoutSummary: '',
    });
  }

  const capture = new BoundedStreamingCapture();
  let spawnError: string | null = null;

  try {
    await new Promise<void>((resolveStream, reject) => {
      const rs = createReadStream(absPath);
      rs.on('error', reject);
      rs.pipe(capture);
      capture.on('finish', () => resolveStream());
      capture.on('error', reject);
    });
  } catch (e: unknown) {
    spawnError = formatNodeError(e);
  }

  const finishedAt = new Date();
  if (spawnError) {
    return fileResult({
      executable: FILE_READ_EXECUTABLE,
      startedAt,
      finishedAt,
      spawnError,
      stdoutSummary: '',
    });
  }

  return {
    schema_version: EXECUTION_SCHEMA,
    started_at: toIsoZ(startedAt),
    finished_at: toIsoZ(finishedAt),
    exit_code: 0,
    signal: null,
    stdout: capture.summarize(),
    stderr: emptyStreamCapture(),
    executable_resolved: FILE_READ_EXECUTABLE,
    env_keys_hash: emptyEnvKeysHash(),
    spawn_error: null,
  };
}

// ---------------------------------------------------------------------------
// File mediation helpers
// ---------------------------------------------------------------------------

function normalizeContent(content: Buffer | Uint8Array | string): Buffer {
  if (Buffer.isBuffer(content)) return content;
  if (typeof content === 'string') return Buffer.from(content, 'utf8');
  return Buffer.from(content);
}

interface ValidateOpts {
  requireTargetExists: boolean;
}

/**
 * Refuses a path if:
 *   - the immediate parent directory is a symbolic link
 *   - the target itself is a symbolic link
 *   - the target exists but is not a regular file (directory, device, ...)
 *   - the target does not exist and requireTargetExists=true (ENOENT)
 *
 * Scope note: this v0.1 check covers the most common agent-attack patterns
 * (planted symlink at the target, planted symlink at the parent directory).
 * It deliberately does NOT walk the full ancestor chain because some systems
 * use symbolic links for canonical system paths (e.g., macOS /tmp → /private/tmp)
 * and walking the chain would conflate system topology with agent intent.
 * Deeper defense lives at the policy layer (path allow-lists) and at a
 * future canonicalization step.
 *
 * Returns null on success; a human-readable error string on refusal.
 */
async function validatePathSafety(absPath: string, opts: ValidateOpts): Promise<string | null> {
  const parent = dirname(absPath);

  // Check immediate parent (does NOT follow symlinks)
  try {
    const parentStat = await lstat(parent);
    if (parentStat.isSymbolicLink()) {
      return `path contains a symbolic link at parent: ${parent}`;
    }
    if (!parentStat.isDirectory()) {
      return `parent is not a directory: ${parent}`;
    }
  } catch (e: unknown) {
    if (isNodeErrnoCode(e, 'ENOENT')) {
      return `ENOENT: parent directory does not exist: ${parent}`;
    }
    return formatNodeError(e);
  }

  // lstat the target itself (does NOT follow symlinks at the leaf)
  try {
    const st = await lstat(absPath);
    if (st.isSymbolicLink()) {
      return 'target path is a symbolic link';
    }
    if (st.isDirectory()) {
      return `EISDIR: target path is a directory: ${absPath}`;
    }
    if (!st.isFile()) {
      return `target path is not a regular file: ${absPath}`;
    }
    return null;
  } catch (e: unknown) {
    if (isNodeErrnoCode(e, 'ENOENT')) {
      if (opts.requireTargetExists) {
        return `ENOENT: no such file: ${absPath}`;
      }
      return null;
    }
    return formatNodeError(e);
  }
}

function isNodeErrnoCode(e: unknown, code: string): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && (e as { code: unknown }).code === code;
}

function formatNodeError(e: unknown): string {
  if (typeof e === 'object' && e !== null) {
    const err = e as { code?: string; message?: string };
    if (err.code) return `${err.code}: ${err.message ?? ''}`.trim();
    if (err.message) return err.message;
  }
  return String(e);
}

function emptyStreamCapture(): StreamCapture {
  return {
    total_bytes: 0,
    content_hash: createHash('sha256').digest('hex'),
    head: null,
    tail: null,
    head_bytes: 0,
    tail_bytes: 0,
    truncated: false,
  };
}

function emptyEnvKeysHash(): string {
  // sha256 of empty string — file mediator passes no environment
  return createHash('sha256').update('').digest('hex');
}

interface FileResultInput {
  executable: string;
  startedAt: Date;
  finishedAt: Date;
  spawnError: string | null;
  stdoutSummary: string;
}

function fileResult(input: FileResultInput): ExecutionResult {
  const summary = input.stdoutSummary;
  const summaryHash = createHash('sha256').update(summary).digest('hex');
  const stdout: StreamCapture =
    summary.length > 0
      ? {
          total_bytes: Buffer.byteLength(summary, 'utf8'),
          content_hash: summaryHash,
          head: summary,
          tail: null,
          head_bytes: Buffer.byteLength(summary, 'utf8'),
          tail_bytes: 0,
          truncated: false,
        }
      : emptyStreamCapture();

  return {
    schema_version: EXECUTION_SCHEMA,
    started_at: toIsoZ(input.startedAt),
    finished_at: toIsoZ(input.finishedAt),
    exit_code: input.spawnError === null ? 0 : 1,
    signal: null,
    stdout,
    stderr: emptyStreamCapture(),
    executable_resolved: input.executable,
    env_keys_hash: emptyEnvKeysHash(),
    spawn_error: input.spawnError,
  };
}
