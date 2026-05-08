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
