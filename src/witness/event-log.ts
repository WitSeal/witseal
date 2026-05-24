/**
 * Event log — JSONL append-only persistence layer.
 *
 * See ADR-0002 for design rationale.
 *
 * The log is the canonical state of WitSeal evidence. The chain head is
 * derived from the log on demand; a head cache exists for performance but
 * is never authoritative.
 */

import {
  closeSync,
  createReadStream,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import {
  WitnessEventSchema,
  type WitnessEvent,
  type WitnessEventDraft,
} from '../../schemas/witness-event.schema.js';
import { finalizeEvent, verifyChain } from '../integrity/hash-chain.js';
import { ChainLock } from '../integrity/lock.js';

export interface EventLogPaths {
  /** Root directory for WitSeal data (default: ~/.witseal). */
  root: string;
  /** Chain segment ID (default: 'default'). */
  segmentId: string;
}

/**
 * Thrown by `EventLog.appendEvent` / `appendDraftEvent` when the event the
 * caller is trying to append does not match the chain state observed inside
 * the append-time exclusive critical section (P0-2 — runtime-boundary audit
 * 2026-05-25). Indicates that another writer advanced the chain between the
 * caller's head-read and the append, OR that the caller built a draft with
 * stale chain-position fields.
 */
export class StaleAppendError extends Error {
  constructor(
    public readonly field: string,
    public readonly expected: string,
    public readonly actual: string
  ) {
    super(
      `EventLog.appendEvent: stale append rejected — ${field} mismatch ` +
        `(expected ${expected}, got ${actual}). Another writer may have ` +
        `advanced the chain; rebuild the event from the current head.`
    );
    this.name = 'StaleAppendError';
  }
}

export class EventLog {
  private readonly logPath: string;
  private readonly headCachePath: string;
  private readonly lock: ChainLock;
  private readonly _segmentId: string;

  constructor(paths: EventLogPaths) {
    const eventsDir = join(paths.root, 'events');
    if (!existsSync(eventsDir)) {
      mkdirSync(eventsDir, { recursive: true });
    }
    this._segmentId = paths.segmentId;
    this.logPath = join(eventsDir, `${paths.segmentId}.jsonl`);
    this.headCachePath = join(eventsDir, `${paths.segmentId}.head`);
    this.lock = new ChainLock(join(eventsDir, `${paths.segmentId}.lock`));
  }

  /**
   * The chain segment ID this EventLog operates on. Used by the emitter to
   * stamp each WitnessEvent's `chain_segment_id` so segment selection at the
   * CLI / API surface (`--segment`) propagates verbatim to persisted evidence
   * (P0-5 — segment traceability per the 2026-05-25 runtime-boundary audit).
   */
  get segmentId(): string {
    return this._segmentId;
  }

  /**
   * Read the current chain head. Validates the head cache against the log
   * tail; if mismatch, rebuilds from the log (returning the recomputed head).
   *
   * Throws if the log is corrupt (cannot determine head).
   */
  readChainHead(): { head: string | null; sequence: number } {
    if (!existsSync(this.logPath)) {
      return { head: null, sequence: 0 };
    }

    const cached = this.readHeadCache();
    const tailEvent = this.readLastEvent();

    if (tailEvent === null) {
      // Empty log
      return { head: null, sequence: 0 };
    }

    if (cached && cached.head === tailEvent.event_hash && cached.sequence === tailEvent.sequence) {
      return { head: tailEvent.event_hash, sequence: tailEvent.sequence + 1 };
    }

    // Mismatch or no cache. Rebuild (full validation).
    return this.rebuildHead();
  }

  /**
   * Append an already-finalized event to the log.
   *
   * Caller is responsible for:
   *   - Calling this under chain lock (use withWriteLock if not)
   *   - Setting previous_event_hash correctly
   *   - Setting sequence correctly
   *   - Computing event_hash via finalizeEvent before passing in
   */
  appendEventUnsafe(event: WitnessEvent): void {
    const line = JSON.stringify(event) + '\n';
    const fd = openSync(this.logPath, 'a');
    try {
      writeSync(fd, line);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    // Update head cache after fsync
    this.writeHeadCache({ head: event.event_hash, sequence: event.sequence });
  }

  /**
   * Append an event under exclusive chain lock and validate it against the
   * actual chain state observed under the same lock (P0-2 — runtime-boundary
   * audit 2026-05-25).
   *
   * Before the P0-2 fix, the legacy `emitWitnessEvent()` path read the chain
   * head OUTSIDE the lock and then re-entered for the append. A second writer
   * (another process; or, with the lock fail-closed default of P0-3, a
   * misuse of `WITSEAL_UNSAFE_LOCKLESS=1`) could advance the chain between
   * the read and the append; the stale event would silently corrupt the
   * `previous_event_hash` / `sequence` linkage.
   *
   * This method now revalidates `event.previous_event_hash` and
   * `event.sequence` against the chain state read inside the lock and rejects
   * mismatches with a `StaleAppendError` rather than silently committing the
   * stale event. For new code, prefer `appendDraftEvent()` which composes the
   * read + build + finalize + append into one atomic critical section.
   */
  appendEvent(event: WitnessEvent): void {
    this.lock.withExclusive(() => {
      const { head, sequence } = this.readChainHeadUnsafe();
      if (event.previous_event_hash !== head) {
        throw new StaleAppendError(
          `previous_event_hash`,
          String(head),
          String(event.previous_event_hash)
        );
      }
      if (event.sequence !== sequence) {
        throw new StaleAppendError(
          `sequence`,
          String(sequence),
          String(event.sequence)
        );
      }
      this.appendEventUnsafe(event);
    });
  }

  /**
   * Atomic build-and-append (P0-2): under one exclusive critical section,
   *   1. read the chain head and next sequence,
   *   2. invoke `buildDraft(head, sequence)` to produce a draft with those
   *      values bound,
   *   3. compute `event_hash` via `finalizeEvent`,
   *   4. append + fsync,
   *   5. update head cache,
   * and return the finalized event.
   *
   * The caller's `buildDraft` callback must produce a draft whose
   * `previous_event_hash` and `sequence` exactly match the values passed to
   * it (this is enforced by re-checking after finalize); other fields the
   * caller fills as needed. This shape lets emitters bind chain-position
   * fields to the actual state under lock without ever touching a stale
   * snapshot from outside the lock.
   */
  appendDraftEvent(
    buildDraft: (chainHead: string | null, sequence: number) => WitnessEventDraft
  ): WitnessEvent {
    return this.lock.withExclusive(() => {
      const { head, sequence } = this.readChainHeadUnsafe();
      const draft = buildDraft(head, sequence);
      if (draft.previous_event_hash !== head) {
        throw new StaleAppendError(
          `buildDraft must use the provided chain head (previous_event_hash)`,
          String(head),
          String(draft.previous_event_hash)
        );
      }
      if (draft.sequence !== sequence) {
        throw new StaleAppendError(
          `buildDraft must use the provided sequence`,
          String(sequence),
          String(draft.sequence)
        );
      }
      const event = finalizeEvent(draft);
      this.appendEventUnsafe(event);
      return event;
    });
  }

  /**
   * Internal: read the chain head and next-sequence WITHOUT acquiring the
   * lock. Intended for use inside an already-acquired critical section
   * (`appendEvent`, `appendDraftEvent`). External callers should use
   * `readChainHead()` (which is read-only and lock-free, since reads are
   * idempotent).
   */
  private readChainHeadUnsafe(): { head: string | null; sequence: number } {
    return this.readChainHead();
  }

  /**
   * Async iterator over all events in the log, in order.
   * Validates each line against the WitnessEvent schema.
   */
  async *readEvents(): AsyncIterable<WitnessEvent> {
    if (!existsSync(this.logPath)) return;

    const stream = createReadStream(this.logPath, { encoding: 'utf8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parsed = JSON.parse(trimmed);
      yield WitnessEventSchema.parse(parsed);
    }
  }

  /**
   * Read all events into memory. Suitable for verification and short logs.
   */
  async readAllEvents(): Promise<WitnessEvent[]> {
    const events: WitnessEvent[] = [];
    for await (const ev of this.readEvents()) {
      events.push(ev);
    }
    return events;
  }

  /**
   * Verify the entire chain. Returns the result from verifyChain plus the
   * total event count.
   */
  async verifyAll(): Promise<{ valid: boolean; eventCount: number; brokenAt?: number; reason?: string }> {
    const events = await this.readAllEvents();
    const result = verifyChain(events);
    return {
      valid: result.valid,
      eventCount: events.length,
      ...(result.brokenAt !== undefined ? { brokenAt: result.brokenAt } : {}),
      ...(result.reason !== undefined ? { reason: result.reason } : {}),
    };
  }

  /**
   * Read the last event in the log (the tail). Returns null for empty log.
   * Implementation: streams the file once; for v0.1 this is acceptable.
   * Phase 4+ may add a tail-pointer file to avoid the scan.
   */
  private readLastEvent(): WitnessEvent | null {
    if (!existsSync(this.logPath)) return null;
    const content = readFileSync(this.logPath, 'utf8');
    const lines = content.split('\n').filter((l) => l.trim());
    if (lines.length === 0) return null;
    const lastLine = lines[lines.length - 1]!;
    return WitnessEventSchema.parse(JSON.parse(lastLine));
  }

  private readHeadCache(): { head: string; sequence: number } | null {
    if (!existsSync(this.headCachePath)) return null;
    try {
      const content = readFileSync(this.headCachePath, 'utf8');
      const parsed = JSON.parse(content);
      if (
        typeof parsed.head === 'string' &&
        /^[a-f0-9]{64}$/.test(parsed.head) &&
        typeof parsed.sequence === 'number'
      ) {
        return { head: parsed.head, sequence: parsed.sequence };
      }
    } catch {
      // Fall through to null
    }
    return null;
  }

  private writeHeadCache(head: { head: string; sequence: number }): void {
    const dir = dirname(this.headCachePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.headCachePath, JSON.stringify(head), { encoding: 'utf8' });
  }

  private rebuildHead(): { head: string | null; sequence: number } {
    const content = readFileSync(this.logPath, 'utf8');
    const lines = content.split('\n').filter((l) => l.trim());
    if (lines.length === 0) return { head: null, sequence: 0 };

    let head: string | null = null;
    let sequence = 0;
    for (const line of lines) {
      const ev = WitnessEventSchema.parse(JSON.parse(line));
      if (ev.previous_event_hash !== head) {
        throw new Error(
          `Event log integrity error at sequence ${ev.sequence}: ` +
            `previous_event_hash ${ev.previous_event_hash} does not match expected ${head}`
        );
      }
      head = ev.event_hash;
      sequence = ev.sequence + 1;
    }
    this.writeHeadCache({ head: head!, sequence: sequence - 1 });
    return { head, sequence };
  }
}
