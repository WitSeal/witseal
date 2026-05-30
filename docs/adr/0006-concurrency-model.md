# ADR-0006: Concurrency model

## Status

accepted (2026-05-08)

## Context

WitSeal Phase 1 may be invoked from multiple processes simultaneously: a developer may run two agents in two terminals; an agent may invoke `witseal exec` recursively; a CI script may parallelize agent operations. The hash chain requires total ordering. Design questions:

1. **Concurrent writers:** allowed, serialized, or forbidden?
2. **Reader concurrency:** can a verifier read the log while a writer appends?
3. **Coordination primitive:** file lock, lockfile, single daemon process, or in-process queue only?
4. **Failure handling:** what happens if a process crashes mid-append?

Phase 1 constraints:
- Single-node, no daemon, no server
- Hash chain integrity must be preserved under all observed concurrency patterns
- Reasonable performance under typical (non-adversarial) workloads
- Crash-safe: no half-written events, no orphaned chain heads

## Decision

**Single-writer per chain segment, enforced by an OS-level advisory file lock (`flock`). Concurrent readers always permitted. No daemon process.**

### Write path

1. WitSeal acquires an exclusive `flock` on `~/.witseal/events/<segment-id>.lock` before any write
2. Lock is held for the duration of: read-current-head → compute-event → append-line → fsync → update-head-cache
3. Lock is released after fsync completes
4. If another process holds the lock, the new process **waits** (blocking `flock` with a 30-second timeout); on timeout, the action fails with `concurrency_timeout`

### Read path

Readers (verification, replay, evidence-package generation) acquire a **shared** `flock` on the same lock file:

- Multiple readers may hold shared locks simultaneously
- A writer waits for all readers to release before acquiring exclusive
- A reader waits for an active writer to release

This is the standard reader-writer lock pattern, implemented via POSIX advisory locking.

### Recursive invocation

If WitSeal is already holding the lock in process A and process A invokes WitSeal again (recursive `exec`), the inner invocation **does not deadlock** because:
- WitSeal checks an environment variable `WITSEAL_LOCK_HELD_BY_PID=$PPID` before acquiring
- If the variable matches the current process tree's lock holder, the inner invocation reuses the held lock (single-threaded continuation)
- The outer invocation's lock holds; only one event is committed per outermost call

This handles the common pattern of agents that themselves invoke shells.

### Crash handling

- If a writer crashes after `write` but before `fsync`, the OS may have buffered the line; on next startup, integrity check (ADR-0002 recovery semantics) catches the mismatch
- If a writer crashes between `fsync` and head-cache update, the head cache is stale; recovery rebuilds the head from the log
- The `flock` is automatically released by the OS when the holding process exits, even on `SIGKILL`. No stale lock files persist.

## Consequences

### Positive

- **No daemon required.** No long-running process to manage. WitSeal remains a CLI that exits after each invocation.
- **OS-level correctness.** `flock` is implemented in the kernel; its semantics are well-understood and not language-specific. A Python script accessing the same chain (Phase 4+) uses the same lock.
- **Chain integrity guaranteed.** Single-writer at any moment ⟹ no interleaved appends ⟹ no chain corruption. The invariant is enforced by the OS, not by WitSeal's code.
- **Concurrent readers never blocked.** Verification, replay, and `witseal events list` work freely while a writer appends.
- **Crash-safe by construction.** OS releases lock on process exit. No cleanup logic needed.
- **Recursive invocations work.** The `WITSEAL_LOCK_HELD_BY_PID` mechanism handles agents-spawning-shells naturally.

### Negative / Limitations

- **Head-of-line blocking under high concurrency.** If 10 agents try to commit simultaneously, they serialize through the lock. Average wait grows with concurrency. Acceptable for Phase 1's single-developer workload (concurrency rarely exceeds 2-3); becomes a real issue at Phase 4+ (MCP gateway servicing multiple agents).
- **No throughput optimization.** No batched writes, no write-ahead log, no group commit. Each event takes one fsync. ~10K events/sec is a reasonable upper bound on modern SSDs; sufficient for Phase 1.
- **30-second timeout is a tunable but not adaptive.** A long-running approval that holds the lock could time out other writers. Mitigation: approval *does not hold the chain lock* — it holds an in-process state, not the file lock. Lock is acquired at append time, not at policy-evaluation time.
- **`flock` semantics on networked filesystems are weak.** NFS, SMB, etc. may not enforce `flock` correctly. Phase 1 documents that the WitSeal data directory must live on a local filesystem (ext4, APFS, NTFS, btrfs, zfs). Networked / shared-volume scenarios are explicitly out of scope.
- **Windows requires a different lock primitive.** `flock` is POSIX-specific. Windows v0.2 uses `LockFileEx` with equivalent semantics; the abstraction is in `src/integrity/lock.ts`.

### What this does NOT provide

- **No multi-node coordination.** Two machines writing to the same shared volume (NFS) cannot serialize correctly with `flock`. Phase 6 introduces a remote witness service for multi-node scenarios; Phase 1 is single-node only.
- **No distributed consensus.** Not Raft, not Paxos, not even RW-locks across machines. Single-node only.
- **No transaction semantics across multiple events.** Each event is its own atomic unit. "Approve a batch of 5 actions atomically" is not supported. Reconsider in Phase 4+.

## Alternatives considered

### Lockfile (no `flock`, just create a file)

Acquire by `O_CREAT | O_EXCL`; release by `unlink`.

**Why rejected:** Stale lockfiles after crashes require pid-checking logic, which is racy. `flock` solves this trivially via OS-managed lifetime.

### Single-writer daemon process

Run a `witseal-daemon` that all CLI invocations connect to.

**Why rejected for Phase 1:** Adds a long-running process, a connection protocol (Unix socket?), startup/shutdown management, and a single point of failure. The CLI-only model is simpler, matches the "no servers in Phase 1" constraint, and avoids state-management bugs. Reconsider for Phase 4+ if MCP gateway use cases demand it.

### In-process queue with rejection on contention

If another process holds the lock, fail immediately with "another action in progress."

**Why rejected:** Surprising failure mode for users running concurrent agents. Blocking with timeout is friendlier; failure is reserved for genuine deadlock or hang.

### SQLite WAL mode

Use SQLite for the event log; rely on its WAL-mode concurrency.

**Why rejected (also in ADR-0002):** Adds a database dependency and changes the canonical format. Concurrency is the same constraint regardless — total ordering of appends — and `flock` solves it without the SQLite tax.

### Single-threaded Node.js event loop "lock"

Rely on Node's single-threaded execution within one process.

**Why rejected:** This only protects against concurrency *within* a process. Multiple WitSeal CLI invocations are separate processes; intra-process serialization does not help.

### Optimistic concurrency with retry

Each writer reads the current head, computes its event, attempts atomic compare-and-swap. On conflict, retry.

**Why rejected:** Append-only file semantics don't naturally support CAS. We'd need a separate state file with atomic-rename semantics. The complexity gain is not worth it; `flock` is simpler and correct.

## Implementation notes

Reference implementation: `src/integrity/lock.ts`.

The lock abstraction:

```typescript
class ChainLock {
  async acquireExclusive(timeoutMs: number = 30_000): Promise<LockHandle> { /* flock(LOCK_EX) */ }
  async acquireShared(timeoutMs: number = 30_000): Promise<LockHandle> { /* flock(LOCK_SH) */ }
}

interface LockHandle {
  release(): Promise<void>;
}
```

The recursive-invocation check:

```typescript
async function withChainLock<T>(fn: () => Promise<T>): Promise<T> {
  const heldBy = process.env.WITSEAL_LOCK_HELD_BY_PID;
  if (heldBy && isAncestorPid(parseInt(heldBy))) {
    return fn(); // already locked by ancestor; reuse
  }
  const handle = await chainLock.acquireExclusive();
  process.env.WITSEAL_LOCK_HELD_BY_PID = String(process.pid);
  try {
    return await fn();
  } finally {
    delete process.env.WITSEAL_LOCK_HELD_BY_PID;
    await handle.release();
  }
}
```

`isAncestorPid` walks the process tree (via `/proc/PID/status` on Linux, `ps -o ppid` elsewhere) — simple and explicit.

## Testing

The concurrency model has property-based tests in `tests/concurrency.test.ts`:

- 100 concurrent writers each commit 10 events; total 1000 events; verify chain integrity afterward
- Recursive invocations: spawn child WitSeal from inside WitSeal; verify single chain advance
- Crash injection: kill writer mid-append; verify recovery rebuilds correct head
- Reader-during-write: 50 concurrent readers + 1 writer; verify readers see consistent prefix

These tests run in CI on every PR.
