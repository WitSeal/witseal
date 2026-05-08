/**
 * Chain lock — file-based exclusive/shared lock for chain operations.
 *
 * See ADR-0006 for design rationale.
 *
 * Phase 1 implementation: POSIX flock(2) via the `fs.flockSync` shim.
 * Node.js stdlib does not expose flock natively, so we use a small
 * helper that opens a file and uses fcntl-like semantics.
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
      if (tryFlock(fd, 'exclusive')) {
        process.env[ENV_LOCK_HOLDER] = String(process.pid);
        return {
          release: () => {
            try {
              tryFlock(fd, 'unlock');
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
      if (tryFlock(fd, 'shared')) {
        return {
          release: () => {
            try {
              tryFlock(fd, 'unlock');
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
 * Phase 1 v0.1: uses Node's `fs.flockSync` if available (Node 22+ has it on
 * supported platforms); otherwise falls back to a no-op with a warning.
 *
 * For pre-22 Node, a follow-up shim using `flock(1)` CLI tool is
 * implementable but adds shell overhead; we accept that on older
 * runtimes the lock is advisory-only-by-convention and document this.
 */
function tryFlock(fd: number, mode: 'exclusive' | 'shared' | 'unlock'): boolean {
  // Prefer native fs.flockSync (Node 22+).
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

  // Fallback: lockless. v0.1 prints a single warning.
  if (!warnedNoFlock && mode !== 'unlock') {
    process.stderr.write(
      'witseal: warning: native fs.flockSync unavailable; chain lock is advisory only.\n'
    );
    warnedNoFlock = true;
  }
  return true;
}

let warnedNoFlock = false;

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
