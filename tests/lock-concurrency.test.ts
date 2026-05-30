/**
 * Cross-process ChainLock tests — real OS processes contending for the lockfile
 * shim (ADR-0006 / threat-model T11). The in-process unit tests in
 * `integrity-lock.test.ts` prove the decision logic (steal-if-dead, no-steal,
 * PID-reuse via start-time); these prove it holds across separate processes.
 *
 * Workers run via `tsx` against `src/` (no build step needed). On Node 22.x the
 * shim is the active backend; on Node 24+ the same scenarios are served by the
 * native flock backend (these tests still pass there — they assert behavior,
 * not the mechanism).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChainLock } from '../src/integrity/lock.js';

const WORKER = join(process.cwd(), 'tests', 'fixtures', 'lock-worker.ts');

let dir: string;
const children: ChildProcess[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'witseal-xproc-'));
});

afterEach(async () => {
  for (const c of children.splice(0)) {
    if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL');
  }
  rmSync(dir, { recursive: true, force: true });
});

function spawnWorker(args: string[]): ChildProcess {
  // `node --import tsx <worker.ts>` runs the worker in the DIRECT child process
  // (no wrapper / grandchild), so the spawned pid is the actual lock holder and
  // killing it tests true crash recovery.
  const c = spawn(process.execPath, ['--import', 'tsx', WORKER, ...args], { stdio: 'ignore' });
  children.push(c);
  return c;
}

function onExit(c: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    c.on('exit', (code) => resolve(code ?? -1));
    c.on('error', reject);
  });
}

async function waitFor(pred: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: condition not met in time');
    await new Promise((r) => setTimeout(r, 20));
  }
}

const shimFileOf = (lockPath: string): string =>
  lockPath.endsWith('.lock') ? `${lockPath.slice(0, -'.lock'.length)}.lockfile` : `${lockPath}.lockfile`;

describe('ChainLock — cross-process (lockfile shim)', () => {
  it('serializes N concurrent processes × M increments with zero lost updates', async () => {
    const N = 10;
    const M = 100;
    const lockPath = join(dir, 'chain.lock');
    const counter = join(dir, 'counter');
    writeFileSync(counter, '0');

    const procs = Array.from({ length: N }, () =>
      spawnWorker([lockPath, counter, 'increment', String(M)])
    );
    const codes = await Promise.all(procs.map(onExit));
    expect(codes.every((c) => c === 0)).toBe(true);

    // Read-modify-write under a correct mutual-exclusion lock loses no updates:
    // a single interleaving anywhere would make this < N*M.
    const final = parseInt(readFileSync(counter, 'utf8'), 10);
    expect(final).toBe(N * M);
  }, 60_000);

  it('steals an orphaned lock after the holder is SIGKILLed (crash recovery)', async () => {
    const lockPath = join(dir, 'chain.lock');
    const ready = join(dir, 'ready');
    const holder = spawnWorker([lockPath, ready, 'hold']);

    await waitFor(() => existsSync(ready) && readFileSync(ready, 'utf8') === 'HELD', 15_000);
    expect(existsSync(shimFileOf(lockPath))).toBe(true); // holder owns the shim lock

    holder.kill('SIGKILL'); // crash while holding → orphaned lockfile (dead pid)
    await onExit(holder);

    // The recorded holder pid is now dead → a fresh acquirer must steal + succeed.
    const lock = new ChainLock(lockPath);
    const handle = lock.acquireExclusive(8_000); // throws on timeout if not stolen
    expect(typeof handle.release).toBe('function');
    handle.release();
  }, 40_000);

  it('does NOT steal a lock held by a live process (cross-process mutual exclusion)', async () => {
    const lockPath = join(dir, 'chain.lock');
    const ready = join(dir, 'ready');
    const holder = spawnWorker([lockPath, ready, 'hold']);

    await waitFor(() => existsSync(ready) && readFileSync(ready, 'utf8') === 'HELD', 15_000);

    const lock = new ChainLock(lockPath);
    // Holder is alive → start-time matches → must NOT be stolen → times out.
    expect(() => lock.acquireExclusive(600)).toThrow(/timeout/);

    holder.kill('SIGKILL');
    await onExit(holder);
  }, 40_000);

  it('N×M real witness events across processes → exact count, contiguous sequence, valid hash-chain, consistent head-cache', async () => {
    const N = 10;
    const M = 50;
    const root = join(dir, 'data');
    const procs = Array.from({ length: N }, () =>
      spawnWorker([root, root, 'chain', String(M)])
    );
    const codes = await Promise.all(procs.map(onExit));
    expect(codes.every((c) => c === 0)).toBe(true);

    const { EventLog } = await import('../src/witness/event-log.js');
    const log = new EventLog({ root, segmentId: 'default' });

    // Exact count + valid hash-chain: any interleaved/lost append breaks one.
    const report = await log.verifyAll();
    expect(report.eventCount).toBe(N * M);
    expect(report.valid).toBe(true);

    // Sequence is contiguous 0..N*M-1 (no gaps, no duplicates).
    const events = await log.readAllEvents();
    const seqs = events.map((e) => e.sequence).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: N * M }, (_, i) => i));

    // Head-cache is consistent: it points at the actual chain head.
    const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
    expect(log.readChainHead().head).toBe(sorted[sorted.length - 1]!.event_hash);
  }, 60_000);
});
