/**
 * Chain lock — single-writer-per-segment exclusion for chain operations.
 *
 * See ADR-0006 for design rationale.
 *
 * Two correct backends, selected at runtime:
 *
 *   1. **flock backend (Node 24+)** — POSIX `flock(2)` via `fs.flockSync`.
 *      The OS owns the lock's lifetime: it is released automatically when the
 *      holding process exits (even on SIGKILL), so there is no stale-lock
 *      problem. This is the cleanest implementation and is used whenever the
 *      runtime exposes `fs.flockSync`.
 *
 *   2. **lockfile shim (Node 20–23, no `fs.flockSync`)** — an atomic
 *      `O_CREAT | O_EXCL` lockfile holding `{pid, startTime}`. Exclusive
 *      creation is the mutual-exclusion primitive: only one process can create
 *      the lockfile, so the single-writer invariant (T11) holds identically to
 *      flock during normal operation. The only difference from flock is crash
 *      recovery: there is no OS auto-release, so a crashed holder leaves the
 *      lockfile behind. A waiter steals it **only if the holder is provably
 *      dead** — the recorded `pid` is gone, or it is live but its process
 *      start-time differs from the recorded one (PID reuse). On ANY
 *      uncertainty the waiter does NOT steal (fail-closed): it never permits
 *      two concurrent writers. An orphaned lockfile is cleared by
 *      `witseal unlock` (which applies the same provably-dead test).
 *
 * The shim is the **correct default** on pre-Node-24 runtimes — it provides
 * real mutual exclusion, not advisory tolerance. `WITSEAL_UNSAFE_LOCKLESS=1`
 * remains only as an explicit operator opt-out (advisory, no locking) for
 * environments where a lockfile cannot or should not be created (read-only or
 * networked data dirs accepted at the operator's own risk). It is NOT required
 * for normal operation on Node 20–23.
 *
 * Cross-platform: macOS + Linux supported in v0.1; Windows uses a
 * compatibility path with `LockFileEx` planned for v0.2.
 *
 * Limitation: the flock and lockfile backends do not coordinate with each
 * other. Concurrent writers against ONE chain segment must run under the same
 * lock backend (i.e. the same Node major). Mixing Node 24+ and <24 processes
 * writing the same segment at the same instant is unsupported — the same class
 * of constraint as networked filesystems (ADR-0006).
 */

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import * as nodeFs from 'node:fs';
import { dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

export interface LockHandle {
  release(): void;
}

const ENV_LOCK_HOLDER = 'WITSEAL_LOCK_HELD_BY_PID';

/**
 * Environment variable opting OUT of locking entirely (advisory-only) on
 * runtimes without native `fs.flockSync`. Value must be exactly `'1'`. This is
 * an explicit operator escape for read-only / networked data dirs; it is NOT
 * needed for normal operation — the lockfile shim is the correct default.
 */
export const ENV_UNSAFE_LOCKLESS = 'WITSEAL_UNSAFE_LOCKLESS';

/**
 * Thrown when no correct lock can be acquired: the lockfile cannot be created
 * (e.g. read-only or permission-denied data dir) AND the operator has not
 * opted into advisory-only mode via `WITSEAL_UNSAFE_LOCKLESS=1`. The
 * single-writer invariant (T11) cannot be guaranteed, so witseal refuses
 * rather than risk silent concurrent-writer corruption.
 */
export class ChainLockUnavailableError extends Error {
  constructor(lockPath: string, cause?: unknown) {
    super(
      `ChainLock: cannot create the lock file at ${lockPath} ` +
        `(${(cause as NodeJS.ErrnoException)?.code ?? 'unknown error'}). ` +
        `The data directory may be read-only or not writable. witseal refuses ` +
        `to proceed without a lock to avoid concurrent-writer corruption. If ` +
        `you knowingly accept the multi-writer risk (single-process dev/test, ` +
        `or an immutable data dir), set ${ENV_UNSAFE_LOCKLESS}=1. See ` +
        `threat-model T11.`
    );
    this.name = 'ChainLockUnavailableError';
  }
}

/** True when the runtime exposes native POSIX flock (Node 24+). */
function flockSyncAvailable(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return typeof (nodeFs as any).flockSync === 'function';
}

export class ChainLock {
  /** Path of the O_EXCL lockfile used by the shim backend. Distinct from
   *  `lockPath` (the flock target) so a leftover empty flock file never
   *  collides with the shim's existence test. */
  private readonly shimPath: string;

  constructor(private readonly lockPath: string) {
    const parent = dirname(lockPath);
    if (!existsSync(parent)) {
      mkdirSync(parent, { recursive: true });
    }
    this.shimPath = lockPath.endsWith('.lock')
      ? `${lockPath.slice(0, -'.lock'.length)}.lockfile`
      : `${lockPath}.lockfile`;
  }

  /**
   * Acquire an exclusive lock, blocking up to timeoutMs.
   * Re-uses the lock if already held by this process tree (recursive call).
   */
  acquireExclusive(timeoutMs: number = 30_000): LockHandle {
    if (this.heldByAncestor()) {
      return { release: () => {} };
    }
    if (flockSyncAvailable()) return this.acquireFlock('exclusive', timeoutMs);
    if (process.env[ENV_UNSAFE_LOCKLESS] === '1') return this.acquireAdvisory();
    return this.acquireShim(timeoutMs);
  }

  /**
   * Acquire a shared lock. Note: chain READS in EventLog are lock-free (reads
   * of an append-only log are idempotent — a reader sees a consistent prefix).
   * `acquireShared` is retained for API completeness and external callers. The
   * flock backend uses a real shared (`LOCK_SH`) lock; the lockfile shim has no
   * shared mode, so it conservatively takes the exclusive lockfile (readers
   * serialize — safe, since the only correctness requirement is that a reader
   * never overlaps a writer, which holding the exclusive lockfile guarantees).
   */
  acquireShared(timeoutMs: number = 30_000): LockHandle {
    if (this.heldByAncestor()) {
      return { release: () => {} };
    }
    if (flockSyncAvailable()) return this.acquireFlock('shared', timeoutMs);
    if (process.env[ENV_UNSAFE_LOCKLESS] === '1') return this.acquireAdvisory();
    return this.acquireShim(timeoutMs);
  }

  /** Run fn while holding an exclusive lock. */
  withExclusive<T>(fn: () => T, timeoutMs: number = 30_000): T {
    const handle = this.acquireExclusive(timeoutMs);
    try {
      return fn();
    } finally {
      handle.release();
    }
  }

  // -------------------------------------------------------------------------
  // flock backend (Node 24+) — preserved behavior
  // -------------------------------------------------------------------------

  private acquireFlock(mode: 'exclusive' | 'shared', timeoutMs: number): LockHandle {
    const fd = openSync(this.lockPath, 'a+');
    const start = Date.now();

    while (true) {
      if (flockOnce(fd, mode)) {
        if (mode === 'exclusive') process.env[ENV_LOCK_HOLDER] = String(process.pid);
        return {
          release: () => {
            try {
              flockOnce(fd, 'unlock');
            } finally {
              closeSync(fd);
              if (mode === 'exclusive' && process.env[ENV_LOCK_HOLDER] === String(process.pid)) {
                delete process.env[ENV_LOCK_HOLDER];
              }
            }
          },
        };
      }
      if (Date.now() - start > timeoutMs) {
        closeSync(fd);
        throw new Error(
          `ChainLock: timeout (${timeoutMs}ms) waiting for ${mode} lock on ${this.lockPath}`
        );
      }
      sleepSync(50);
    }
  }

  // -------------------------------------------------------------------------
  // lockfile shim backend (Node 20–23) — fail-closed exclusive lock
  // -------------------------------------------------------------------------

  private acquireShim(timeoutMs: number): LockHandle {
    const start = Date.now();

    while (true) {
      const result = shimTryCreate(this.shimPath);
      if (result === 'acquired') {
        process.env[ENV_LOCK_HOLDER] = String(process.pid);
        return {
          release: () => {
            shimRelease(this.shimPath);
            if (process.env[ENV_LOCK_HOLDER] === String(process.pid)) {
              delete process.env[ENV_LOCK_HOLDER];
            }
          },
        };
      }

      // result === 'exists' — someone holds (or held) the lock.
      if (shimHolderProvablyDead(this.shimPath)) {
        // Atomic steal: only the rename-winner removes the corpse; everyone
        // else loops back and contends for a fresh O_EXCL create.
        shimTrySteal(this.shimPath);
        continue;
      }

      if (Date.now() - start > timeoutMs) {
        throw new Error(
          `ChainLock: timeout (${timeoutMs}ms) waiting for exclusive lock on ` +
            `${this.shimPath}. The holder appears to be a live process. If you ` +
            `believe the lock is orphaned, run 'witseal unlock'.`
        );
      }
      // A lockfile re-check is cheap; poll faster than the flock path for lower
      // writer latency under contention.
      sleepSync(15);
    }
  }

  private acquireAdvisory(): LockHandle {
    warnUnsafeOnce();
    return { release: () => {} };
  }

  // -------------------------------------------------------------------------
  // Recovery helper for `witseal unlock`
  // -------------------------------------------------------------------------

  /**
   * Remove an orphaned shim lockfile IFF its holder is provably dead.
   * Returns:
   *   - 'absent'  — no shim lockfile present (nothing to do; on Node 24+ flock
   *                 auto-releases and there is no lockfile)
   *   - 'removed' — the lockfile's holder was provably dead; it was removed
   *   - 'held'    — the holder appears live (or cannot be proven dead); the
   *                 lockfile was left in place
   */
  forceUnlockIfDead(): {
    status: 'absent' | 'removed' | 'held';
    holder?: { pid: number; startTime: string | null };
    lockfile: string;
  } {
    if (!existsSync(this.shimPath)) return { status: 'absent', lockfile: this.shimPath };
    const holder = shimReadHolder(this.shimPath);
    if (shimHolderProvablyDead(this.shimPath)) {
      try {
        unlinkSync(this.shimPath);
      } catch {
        /* concurrent removal — fine */
      }
      return { status: 'removed', lockfile: this.shimPath, ...(holder ? { holder } : {}) };
    }
    return { status: 'held', lockfile: this.shimPath, ...(holder ? { holder } : {}) };
  }

  private heldByAncestor(): boolean {
    const holder = process.env[ENV_LOCK_HOLDER];
    if (!holder) return false;
    const holderPid = parseInt(holder, 10);
    if (!Number.isFinite(holderPid)) return false;
    return holderPid === process.pid || isAncestorPid(holderPid);
  }
}

// ---------------------------------------------------------------------------
// flock primitive
// ---------------------------------------------------------------------------

/**
 * One non-blocking flock attempt via `fs.flockSync` (Node 24+).
 * Returns false on EAGAIN/EWOULDBLOCK so the caller can retry; rethrows other
 * errors. Only reached when `flockSyncAvailable()` is true.
 */
function flockOnce(fd: number, mode: 'exclusive' | 'shared' | 'unlock'): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fs = nodeFs as any;
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

// ---------------------------------------------------------------------------
// lockfile shim primitives
// ---------------------------------------------------------------------------

interface ShimHolder {
  pid: number;
  startTime: string | null;
}

/**
 * Atomically create the lockfile with our holder identity.
 * Returns 'acquired' on success, 'exists' if another holder already created it
 * (EEXIST). Any other error (read-only FS, permissions) is fatal — throws
 * `ChainLockUnavailableError`, since we cannot guarantee exclusion.
 */
function shimTryCreate(path: string): 'acquired' | 'exists' {
  let fd: number;
  try {
    // 'wx' = O_CREAT | O_EXCL | O_WRONLY — atomic exclusive create.
    fd = openSync(path, 'wx');
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return 'exists';
    throw new ChainLockUnavailableError(path, e);
  }
  try {
    const holder: ShimHolder & { acquiredAt: string } = {
      pid: process.pid,
      startTime: myStartTime(),
      acquiredAt: new Date().toISOString(),
    };
    writeSync(fd, JSON.stringify(holder));
  } finally {
    closeSync(fd);
  }
  return 'acquired';
}

function shimReadHolder(path: string): ShimHolder | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<ShimHolder>;
    if (typeof parsed.pid === 'number') {
      return { pid: parsed.pid, startTime: typeof parsed.startTime === 'string' ? parsed.startTime : null };
    }
  } catch {
    /* unreadable / mid-write / empty / garbage → caller treats as NOT dead */
  }
  return null;
}

/**
 * Conservative liveness test. Returns true ONLY if the recorded holder is
 * provably gone. Any uncertainty returns false (fail-closed: never steal a
 * lock we cannot prove is dead).
 */
function shimHolderProvablyDead(path: string): boolean {
  const holder = shimReadHolder(path);
  if (!holder) return false; // unreadable/empty/mid-write → not provably dead
  // Note: we do NOT special-case holder.pid === process.pid. The start-time
  // comparison below handles it correctly — a matching start-time means it is
  // genuinely our own live lock (not dead), while a mismatch means our pid was
  // reused and the original holder is gone (dead → safe to steal).

  let alive: boolean;
  try {
    process.kill(holder.pid, 0); // signal 0: existence check, sends nothing
    alive = true;
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return true; // no such process → dead
    if (code === 'EPERM') alive = true; // exists but owned by another user
    else return false; // unexpected → fail-closed
  }
  if (!alive) return true;

  // PID is live — defeat PID reuse by comparing process start-times.
  const liveStart = processStartTime(holder.pid);
  if (liveStart === null || holder.startTime === null) return false; // can't compare → fail-closed
  return liveStart !== holder.startTime; // different start-time ⟹ reused PID ⟹ original holder is dead
}

/**
 * Atomic steal of a provably-dead lockfile. Renames the corpse to a unique
 * name (only one racer's rename of a given inode succeeds); the winner unlinks
 * it. Losers see ENOENT and simply loop back to contend for a fresh O_EXCL
 * create. This guarantees that removing a dead lock never races into two live
 * holders — the O_EXCL create remains the single source of "who holds".
 */
function shimTrySteal(path: string): void {
  const corpse = `${path}.stale.${process.pid}.${Date.now()}`;
  try {
    renameSync(path, corpse);
  } catch {
    return; // ENOENT — another racer moved it; loop and retry create
  }
  try {
    unlinkSync(corpse);
  } catch {
    /* best effort */
  }
}

function shimRelease(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    /* already gone (e.g. stolen after a wrongful liveness verdict — which
       fail-closed prevents) — nothing to do */
  }
}

/**
 * Process start-time, used to distinguish a live original holder from a reused
 * PID. Linux: field 22 of /proc/<pid>/stat (jiffies since boot). Other (macOS):
 * `ps -o lstart=` (absolute start timestamp string). Returns null if it cannot
 * be determined (caller then fails closed).
 */
function processStartTime(pid: number): string | null {
  if (pid <= 0) return null;
  try {
    const statPath = `/proc/${pid}/stat`;
    if (existsSync(statPath)) {
      const stat = readFileSync(statPath, 'utf8');
      // comm (field 2) is parenthesized and may contain spaces/parens; the
      // numeric fields start after the LAST ')'. field 22 (starttime) is the
      // 20th whitespace token after that (state is field 3 → index 0).
      const after = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/);
      const starttime = after[19];
      return starttime ?? null;
    }
  } catch {
    /* fall through to ps */
  }
  try {
    const out = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

let _myStartTime: string | null | undefined;
function myStartTime(): string | null {
  if (_myStartTime === undefined) _myStartTime = processStartTime(process.pid);
  return _myStartTime;
}

let warnedUnsafeLockless = false;
function warnUnsafeOnce(): void {
  if (warnedUnsafeLockless) return;
  process.stderr.write(
    `witseal: WARNING: ${ENV_UNSAFE_LOCKLESS}=1 — operating in advisory-only ` +
      `lockless mode (locking disabled by operator opt-out). Concurrent writers ` +
      `are NOT mediated; chain integrity is the operator's responsibility. The ` +
      `lockfile shim is the correct default on this runtime — unset ` +
      `${ENV_UNSAFE_LOCKLESS} to use it.\n`
  );
  warnedUnsafeLockless = true;
}

function isAncestorPid(targetPid: number): boolean {
  if (targetPid <= 0) return false;
  let pid = process.pid;
  for (let i = 0; i < 50; i++) {
    if (pid === targetPid) return true;
    if (pid <= 1) return false;
    try {
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
  const sab = new SharedArrayBuffer(4);
  const view = new Int32Array(sab);
  Atomics.wait(view, 0, 0, ms);
}
