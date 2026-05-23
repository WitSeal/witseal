/**
 * M1.4 — Chain lock primitive failure-mode tests.
 *
 * Targets `src/integrity/lock.ts` (`ChainLock`). Pre-M1.4 coverage was 41.53%
 * statements: only the lockless fallback path through `tryFlock` plus a
 * single happy-path `acquireExclusive` traversal (indirect via EventLog
 * append flow). Lines 139–151 (native `fs.flockSync` branch — error handling,
 * EAGAIN retry, non-EAGAIN rethrow), 165–186 (`isAncestorPid` PID walk),
 * 188–193 (`sleepSync` invocation) were uncovered.
 *
 * Strategy:
 *   - Direct happy-path + structural tests cover constructor (parent-dir
 *     creation), acquire/release, `withExclusive` (success + throw), and the
 *     `heldByAncestor` recursive shortcut path via the `WITSEAL_LOCK_HELD_BY_PID`
 *     environment variable.
 *   - The native-flockSync branch is exercised via `vi.mock('node:fs', …)`
 *     with a factory that wraps the real `node:fs` namespace and exposes a
 *     mutable `flockSync` shim + `LOCK_*` constants. On Node 22.22.2 the real
 *     namespace lacks `flockSync` (stabilized in Node 24), so this is the only
 *     way to cover lock.ts lines 138–151 without version-gating the test. The
 *     mediator / event-log integration tests already exercise the lockless
 *     fallback; this file fills the native-branch gap.
 *
 * Failure modes covered:
 *   - timeout when flock returns EAGAIN repeatedly → throws with timeout
 *     message containing the lockPath
 *   - non-EAGAIN errno from flockSync → rethrown (NOT swallowed as a no-op)
 *   - EAGAIN once → retry → success on second attempt (exercises `sleepSync`
 *     between retries)
 *   - shared-lock variant of timeout + EAGAIN-retry
 *   - `withExclusive` releases lock even when the wrapped fn throws
 *   - ancestor shortcut: env var pointing to current pid → acquire becomes
 *     a no-op; release is also a no-op (outer holder is responsible)
 *   - malformed env var (non-numeric / NaN) → shortcut declines, falls through
 *     to normal acquire
 *   - non-ancestor pid in env var → `isAncestorPid` walks the ps tree and
 *     returns false → acquire takes normal path
 *
 * Process invariants enforced:
 *   - `WITSEAL_LOCK_HELD_BY_PID` is set only when this process actually owns
 *     a non-shortcut lock, and is deleted on release.
 *   - The flockSync shim + LOCK_* constants are cleared (afterEach) so the
 *     lockless-fallback test group sees the real namespace state.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

// `vi.hoisted` runs before any imports, so the shim state is available inside
// the `vi.mock` factory (which is itself hoisted above static imports).
const fsShim = vi.hoisted(() => ({
  flockSyncImpl: undefined as ((fd: number, flag: number) => void) | undefined,
  extraConstants: {} as Record<string, number>,
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    get flockSync() {
      return fsShim.flockSyncImpl;
    },
    constants: new Proxy(actual.constants, {
      get(target, prop) {
        if (typeof prop === 'string' && prop in fsShim.extraConstants) {
          return fsShim.extraConstants[prop];
        }
        return (target as unknown as Record<string | symbol, unknown>)[prop];
      },
      has(target, prop) {
        if (typeof prop === 'string' && prop in fsShim.extraConstants) return true;
        return prop in target;
      },
    }),
  };
});

import { mkdtempSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ChainLock } from '../src/integrity/lock.js';

// ---------------------------------------------------------------------------
// Shim helpers
// ---------------------------------------------------------------------------

/**
 * Install a controllable flock stub. The stub honors `behaviors` in order;
 * the last entry is repeated when calls exceed the array length.
 *
 *   'ok'           → returns (acquired)
 *   'eagain'       → throws {code: 'EAGAIN'}
 *   'ewouldblock'  → throws {code: 'EWOULDBLOCK'}
 *   'other'        → throws {code: 'EBADF', message: 'simulated bad fd'}
 */
function installFlockStub(behaviors: Array<'ok' | 'eagain' | 'ewouldblock' | 'other'>): {
  calls: Array<{ flag: number }>;
  reset: () => void;
} {
  const calls: Array<{ flag: number }> = [];
  let i = 0;
  fsShim.extraConstants.LOCK_EX = 2;
  fsShim.extraConstants.LOCK_SH = 1;
  fsShim.extraConstants.LOCK_UN = 8;
  fsShim.extraConstants.LOCK_NB = 4;
  fsShim.flockSyncImpl = (_fd: number, flag: number): void => {
    calls.push({ flag });
    const b = behaviors[Math.min(i, behaviors.length - 1)];
    i++;
    if (b === 'ok') return;
    const err = new Error(b === 'other' ? 'simulated bad fd' : b) as NodeJS.ErrnoException;
    err.code =
      b === 'eagain' ? 'EAGAIN'
      : b === 'ewouldblock' ? 'EWOULDBLOCK'
      : 'EBADF';
    throw err;
  };
  return {
    calls,
    reset: () => {
      i = 0;
      calls.length = 0;
    },
  };
}

function clearFlockStub(): void {
  fsShim.flockSyncImpl = undefined;
  for (const k of Object.keys(fsShim.extraConstants)) {
    delete fsShim.extraConstants[k];
  }
}

// ---------------------------------------------------------------------------
// Shared scaffolding
// ---------------------------------------------------------------------------

const ENV_LOCK_HOLDER = 'WITSEAL_LOCK_HELD_BY_PID';

let tmpRoot: string;
let envSnap: string | undefined;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'witseal-lock-test-'));
  clearFlockStub();
  envSnap = process.env[ENV_LOCK_HOLDER];
  delete process.env[ENV_LOCK_HOLDER];
});

afterEach(() => {
  clearFlockStub();
  if (envSnap === undefined) delete process.env[ENV_LOCK_HOLDER];
  else process.env[ENV_LOCK_HOLDER] = envSnap;
  rmSync(tmpRoot, { recursive: true, force: true });
});

function freshLockPath(name = 'chain.lock'): string {
  return join(tmpRoot, 'nested', 'deep', name);
}

// ---------------------------------------------------------------------------
// Constructor + parent-dir behavior
// ---------------------------------------------------------------------------

describe('ChainLock — constructor', () => {
  it('creates missing parent directories', () => {
    const lockPath = freshLockPath();
    expect(existsSync(join(tmpRoot, 'nested'))).toBe(false);
    new ChainLock(lockPath);
    expect(existsSync(join(tmpRoot, 'nested', 'deep'))).toBe(true);
    expect(statSync(join(tmpRoot, 'nested', 'deep')).isDirectory()).toBe(true);
  });

  it('tolerates pre-existing parent directory', () => {
    const lockPath = freshLockPath();
    new ChainLock(lockPath); // creates parent
    expect(() => new ChainLock(lockPath)).not.toThrow(); // second time: parent exists
  });
});

// ---------------------------------------------------------------------------
// Public surface — lockless fallback path (no flockSync stub installed)
// ---------------------------------------------------------------------------

describe('ChainLock — lockless fallback (no flockSync stub)', () => {
  it('acquireExclusive returns a releasable handle without throwing', () => {
    const lock = new ChainLock(freshLockPath());
    const handle = lock.acquireExclusive();
    expect(typeof handle.release).toBe('function');
    expect(() => handle.release()).not.toThrow();
  });

  it('acquireShared returns a releasable handle without throwing', () => {
    const lock = new ChainLock(freshLockPath());
    const handle = lock.acquireShared();
    expect(typeof handle.release).toBe('function');
    expect(() => handle.release()).not.toThrow();
  });

  it('withExclusive returns the wrapped fn result', () => {
    const lock = new ChainLock(freshLockPath());
    const result = lock.withExclusive(() => 42);
    expect(result).toBe(42);
  });

  it('withExclusive releases the lock even when fn throws', () => {
    const lock = new ChainLock(freshLockPath());
    expect(() => lock.withExclusive(() => { throw new Error('boom'); })).toThrow('boom');
    // Should be able to re-acquire immediately (no lingering handle).
    expect(() => lock.withExclusive(() => 'ok')).not.toThrow();
  });

  it('sets and clears WITSEAL_LOCK_HELD_BY_PID around exclusive acquire/release', () => {
    expect(process.env[ENV_LOCK_HOLDER]).toBeUndefined();
    const lock = new ChainLock(freshLockPath());
    const handle = lock.acquireExclusive();
    expect(process.env[ENV_LOCK_HOLDER]).toBe(String(process.pid));
    handle.release();
    expect(process.env[ENV_LOCK_HOLDER]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// heldByAncestor / isAncestorPid shortcut
// ---------------------------------------------------------------------------

describe('ChainLock — heldByAncestor shortcut', () => {
  it('skips real acquire when env var points to current process pid', () => {
    process.env[ENV_LOCK_HOLDER] = String(process.pid);
    // Install a flock stub that would record if invoked; the shortcut must
    // bypass it entirely.
    const stub = installFlockStub(['ok']);
    const lock = new ChainLock(freshLockPath());

    const handle = lock.acquireExclusive();
    expect(stub.calls.length).toBe(0);
    expect(() => handle.release()).not.toThrow();
    // Env var preserved because the shortcut release is a no-op.
    expect(process.env[ENV_LOCK_HOLDER]).toBe(String(process.pid));
  });

  it('falls through normal path when env var is non-numeric', () => {
    process.env[ENV_LOCK_HOLDER] = 'not-a-number';
    const lock = new ChainLock(freshLockPath());
    const handle = lock.acquireExclusive();
    // Normal acquire happened → env var now reflects current pid
    expect(process.env[ENV_LOCK_HOLDER]).toBe(String(process.pid));
    handle.release();
    expect(process.env[ENV_LOCK_HOLDER]).toBeUndefined();
  });

  it('falls through normal path when env var is a non-ancestor pid', () => {
    // 0 is explicitly rejected by `isAncestorPid` (`<= 0` guard).
    process.env[ENV_LOCK_HOLDER] = '0';
    const lock = new ChainLock(freshLockPath());
    const handle = lock.acquireExclusive();
    expect(process.env[ENV_LOCK_HOLDER]).toBe(String(process.pid));
    handle.release();
    expect(process.env[ENV_LOCK_HOLDER]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Native flockSync branch (shimmed via vi.mock)
// ---------------------------------------------------------------------------

describe('ChainLock — flockSync branch (shimmed)', () => {
  it('acquires exclusive lock via flockSync with LOCK_EX|LOCK_NB', () => {
    const stub = installFlockStub(['ok', 'ok']); // acquire + release
    const lock = new ChainLock(freshLockPath());
    const handle = lock.acquireExclusive();
    expect(stub.calls[0].flag).toBe(6); // LOCK_EX(2) | LOCK_NB(4)
    handle.release();
    expect(stub.calls[1].flag).toBe(8); // LOCK_UN
  });

  it('acquires shared lock via flockSync with LOCK_SH|LOCK_NB', () => {
    const stub = installFlockStub(['ok', 'ok']);
    const lock = new ChainLock(freshLockPath());
    const handle = lock.acquireShared();
    expect(stub.calls[0].flag).toBe(5); // LOCK_SH(1) | LOCK_NB(4)
    handle.release();
    expect(stub.calls[1].flag).toBe(8);
  });

  it('retries on EAGAIN then succeeds (exercises sleepSync between attempts)', () => {
    const stub = installFlockStub(['eagain', 'ok', 'ok']);
    const lock = new ChainLock(freshLockPath());
    const t0 = Date.now();
    const handle = lock.acquireExclusive(2_000);
    const elapsed = Date.now() - t0;
    // At least one 50ms sleep between EAGAIN retry and success.
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(stub.calls.length).toBe(2);
    handle.release();
  });

  it('also retries on EWOULDBLOCK (BSD synonym for EAGAIN)', () => {
    const stub = installFlockStub(['ewouldblock', 'ok', 'ok']);
    const lock = new ChainLock(freshLockPath());
    const handle = lock.acquireExclusive(2_000);
    expect(stub.calls.length).toBe(2);
    handle.release();
  });

  it('rethrows non-EAGAIN/EWOULDBLOCK errors from flockSync (exclusive)', () => {
    installFlockStub(['other']);
    const lock = new ChainLock(freshLockPath());
    expect(() => lock.acquireExclusive(1_000)).toThrow(/simulated bad fd|EBADF/);
  });

  it('rethrows non-EAGAIN errors from flockSync (shared)', () => {
    installFlockStub(['other']);
    const lock = new ChainLock(freshLockPath());
    expect(() => lock.acquireShared(1_000)).toThrow(/simulated bad fd|EBADF/);
  });

  it('throws timeout error containing lockPath when EAGAIN persists past deadline', () => {
    installFlockStub(['eagain']); // permanently EAGAIN
    const lockPath = freshLockPath('contended.lock');
    const lock = new ChainLock(lockPath);
    const t0 = Date.now();
    expect(() => lock.acquireExclusive(120)).toThrow(/timeout.*contended\.lock/);
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(100);
  });

  it('throws timeout error from acquireShared when EAGAIN persists', () => {
    installFlockStub(['eagain']);
    const lockPath = freshLockPath('shared-contended.lock');
    const lock = new ChainLock(lockPath);
    expect(() => lock.acquireShared(120)).toThrow(/timeout.*shared-contended\.lock/);
  });
});

// ---------------------------------------------------------------------------
// withExclusive interaction with the env-var holder protocol
// ---------------------------------------------------------------------------

describe('ChainLock — withExclusive + env-holder interaction', () => {
  it('nested withExclusive on same process re-uses outer holder (shortcut)', () => {
    const stub = installFlockStub(['ok', 'ok']); // only outer acquire+release
    const lock = new ChainLock(freshLockPath());

    const outerResult = lock.withExclusive(() => {
      // At this point env var is set; nested call must shortcut.
      expect(process.env[ENV_LOCK_HOLDER]).toBe(String(process.pid));
      return lock.withExclusive(() => 'inner');
    });

    expect(outerResult).toBe('inner');
    // Exactly two flock calls (outer acquire + outer release); inner is no-op.
    expect(stub.calls.length).toBe(2);
    // Env var deleted after outer release.
    expect(process.env[ENV_LOCK_HOLDER]).toBeUndefined();
  });
});
