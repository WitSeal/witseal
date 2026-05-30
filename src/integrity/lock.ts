/**
 * Chain lock — file-based exclusive/shared lock for chain operations.
 *
 * See ADR-0006 for design rationale.
 *
 * Phase 1 implementation: POSIX flock(2) via Node's `fs.flockSync` (added
 * in Node 24+). When the host runtime does not expose `fs.flockSync`
 * (current Node 22 LTS), the default behavior is **fail-closed**: any
 * acquire throws `ChainLockUnavailableError`. This prevents silent
 * concurrent-writer corruption of the chain (P0-3, runtime-boundary audit
 * 2026-05-25).
 *
 * Operators who knowingly accept the multi-writer risk (single-process
 * dev/test environments, immutable read-only data dirs, advisory-only
 * tolerance) may opt in by setting the environment variable
 * `WITSEAL_UNSAFE_LOCKLESS=1`. The opt-in is reported to stderr on first
 * acquire so its presence is visible in the operator's logs.
 *
 * Cross-platform: macOS + Linux supported in v0.1; Windows uses a
 * compatibility path with `LockFileEx` planned for v0.2.
 */

import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import * as nodeFs from 'node:fs';
import { dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

export interface LockHandle {
  release(): void;
}

const ENV_LOCK_HOLDER = 'WITSEAL_LOCK_HELD_BY_PID';

/**
 * Environment variable opting into the lockless (advisory-only) fallback
 * when the host Node runtime lacks `fs.flockSync`. Value must be exactly
 * `'1'` to enable. Any other value (including unset) keeps the fail-closed
 * default per P0-3.
 */
export const ENV_UNSAFE_LOCKLESS = 'WITSEAL_UNSAFE_LOCKLESS';

/**
 * Thrown when an exclusive or shared lock cannot be acquired because
 * `fs.flockSync` is unavailable AND the operator has not opted into the
 * advisory-only fallback via `WITSEAL_UNSAFE_LOCKLESS=1` (P0-3).
 */
export class ChainLockUnavailableError extends Error {
  constructor(lockPath: string) {
    super(
      `ChainLock: native fs.flockSync is unavailable on this Node runtime ` +
        `(stabilized in Node 24+). Concurrent writers cannot be mediated, ` +
        `so witseal refuses to acquire a lock on ${lockPath} by default. ` +
        `To accept the multi-writer risk and proceed in advisory-only mode ` +
        `(e.g. single-process dev/test), set the environment variable ` +
        `${ENV_UNSAFE_LOCKLESS}=1. See threat-model T11.`
    );
    this.name = 'ChainLockUnavailableError';
  }
}

export class ChainLock {
  constructor(private readonly lockPath: string) {
    const parent = dirname(lockPath);
    if (!existsSync(parent)) {
      mkdirSync(parent, { recursive: true });
    }
  }

  /**
   * Acquire an exclusive lock, blocking up to timeoutMs.
   * Re-uses lock if already held by this process tree (recursive invocation).
   */
  acquireExclusive(timeoutMs: number = 30_000): LockHandle {
    if (this.heldByAncestor()) {
      // No-op release; the outer holder will release.
      return { release: () => {} };
    }

    const fd = openSync(this.lockPath, 'a+');
    const start = Date.now();

    while (true) {
      if (tryFlock(fd, 'exclusive', this.lockPath)) {
        process.env[ENV_LOCK_HOLDER] = String(process.pid);
        return {
          release: () => {
            try {
              tryFlock(fd, 'unlock', this.lockPath);
            } finally {
              closeSync(fd);
              if (process.env[ENV_LOCK_HOLDER] === String(process.pid)) {
                delete process.env[ENV_LOCK_HOLDER];
              }
            }
          },
        };
      }

      if (Date.now() - start > timeoutMs) {
        closeSync(fd);
        throw new Error(
          `ChainLock: timeout (${timeoutMs}ms) waiting for exclusive lock on ${this.lockPath}`
        );
      }

      // Sleep briefly before retry. Synchronous sleep via shell avoids
      // requiring async machinery for what is conceptually a blocking call.
      sleepSync(50);
    }
  }

  acquireShared(timeoutMs: number = 30_000): LockHandle {
    const fd = openSync(this.lockPath, 'a+');
    const start = Date.now();

    while (true) {
      if (tryFlock(fd, 'shared', this.lockPath)) {
        return {
          release: () => {
            try {
              tryFlock(fd, 'unlock', this.lockPath);
            } finally {
              closeSync(fd);
            }
          },
        };
      }

      if (Date.now() - start > timeoutMs) {
        closeSync(fd);
        throw new Error(
          `ChainLock: timeout (${timeoutMs}ms) waiting for shared lock on ${this.lockPath}`
        );
      }
      sleepSync(50);
    }
  }

  /**
   * Synchronous helper: run fn while holding an exclusive lock.
   */
  withExclusive<T>(fn: () => T, timeoutMs: number = 30_000): T {
    const handle = this.acquireExclusive(timeoutMs);
    try {
      return fn();
    } finally {
      handle.release();
    }
  }

  private heldByAncestor(): boolean {
    const holder = process.env[ENV_LOCK_HOLDER];
    if (!holder) return false;
    const holderPid = parseInt(holder, 10);
    if (!Number.isFinite(holderPid)) return false;
    return holderPid === process.pid || isAncestorPid(holderPid);
  }
}

/**
 * Try to acquire/release a flock-style lock on a fd.
 *
 * Native path: `fs.flockSync` (Node 24+) — exclusive / shared / unlock.
 * Returns false on EAGAIN/EWOULDBLOCK so the caller can retry.
 *
 * Fallback path (P0-3 — runtime-boundary audit 2026-05-25): when
 * `fs.flockSync` is unavailable, throws `ChainLockUnavailableError` UNLESS
 * `WITSEAL_UNSAFE_LOCKLESS=1` is set in the environment. With the opt-in
 * set, returns true (advisory-only) and emits a visible warning to stderr
 * on first acquire so the operator sees the unsafe mode is in effect.
 *
 * `lockPath` is included only for the error message; it has no other use.
 */
function tryFlock(
  fd: number,
  mode: 'exclusive' | 'shared' | 'unlock',
  lockPath: string
): boolean {
  // Prefer native fs.flockSync (Node 24+).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fs = nodeFs as any;
  if (typeof fs.flockSync === 'function') {
    const flag =
      mode === 'exclusive' ? fs.constants.LOCK_EX | fs.constants.LOCK_NB
      : mode === 'shared' ? fs.constants.LOCK_SH | fs.constants.LOCK_NB
      : fs.constants.LOCK_UN;
    try {
      fs.flockSync(fd, flag);
      return true;
    } catch (e: unknown) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'EAGAIN' || code === 'EWOULDBLOCK') return false;
      throw e;
    }
  }

  // Native unavailable. Default: fail closed (P0-3). Opt-in lockless via
  // explicit env var; unlock path is always permitted (it would be a no-op
  // anyway, and throwing on release would mask the original acquire error).
  if (mode === 'unlock') {
    return true;
  }
  if (process.env[ENV_UNSAFE_LOCKLESS] !== '1') {
    throw new ChainLockUnavailableError(lockPath);
  }
  if (!warnedUnsafeLockless) {
    process.stderr.write(
      `witseal: WARNING: ${ENV_UNSAFE_LOCKLESS}=1 — operating in advisory-only ` +
        `lockless mode (native fs.flockSync unavailable). Concurrent writers ` +
        `are not mediated; chain integrity is the operator's responsibility ` +
        `until the runtime gains fs.flockSync (Node 24+).\n`
    );
    warnedUnsafeLockless = true;
  }
  return true;
}

let warnedUnsafeLockless = false;

function isAncestorPid(targetPid: number): boolean {
  // Walk up the process tree from current pid; return true if targetPid found.
  if (targetPid <= 0) return false;
  let pid = process.pid;
  for (let i = 0; i < 50; i++) {
    if (pid === targetPid) return true;
    if (pid <= 1) return false;
    try {
      // Cross-platform-ish: `ps -o ppid= -p PID`
      const out = execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      const ppid = parseInt(out, 10);
      if (!Number.isFinite(ppid) || ppid === pid) return false;
      pid = ppid;
    } catch {
      return false;
    }
  }
  return false;
}

function sleepSync(ms: number): void {
  // Synchronous sleep via Atomics.wait — POSIX-portable.
  const sab = new SharedArrayBuffer(4);
  const view = new Int32Array(sab);
  Atomics.wait(view, 0, 0, ms);
}
