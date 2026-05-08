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
} from '../../schemas/witness-event.schema.js';
import { verifyChain } from '../integrity/hash-chain.js';
import { ChainLock } from '../integrity/lock.js';

export interface EventLogPaths {
  /** Root directory for WitSeal data (default: ~/.witseal). */
  root: string;
  /** Chain segment ID (default: 'default'). */
  segmentId: string;
}

export class EventLog {
  private readonly logPath: string;
  private readonly headCachePath: string;
  private readonly lock: ChainLock;

  constructor(paths: EventLogPaths) {
    const eventsDir = join(paths.root, 'events');
    if (!existsSync(eventsDir)) {
      mkdirSync(eventsDir, { recursive: true });
    }
    this.logPath = join(eventsDir, `${paths.segmentId}.jsonl`);
    this.headCachePath = join(eventsDir, `${paths.segmentId}.head`);
    this.lock = new ChainLock(join(eventsDir, `${paths.segmentId}.lock`));
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
   * Append an event under exclusive chain lock. Recommended path.
   */
  appendEvent(event: WitnessEvent): void {
    this.lock.withExclusive(() => this.appendEventUnsafe(event));
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
