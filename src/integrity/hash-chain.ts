/**
 * Hash chain construction and verification.
 *
 * Implements the linear hash chain described in ADR-0001:
 *   - Each event references the SHA-256 of the previous event
 *   - Hashing uses RFC 8785 (JSON Canonicalization Scheme)
 *   - Chain head is derived from the event log (the log is canonical)
 *
 * Pure functions. No I/O. The event log layer (src/witness/event-log.ts)
 * handles persistence.
 */

import { createHash } from 'node:crypto';
import type {
  WitnessEvent,
  WitnessEventDraft,
} from '../../schemas/witness-event.schema.js';

/**
 * RFC 8785 (JSON Canonicalization Scheme) implementation.
 *
 * This is a minimal implementation sufficient for WitSeal's needs:
 *   - Object keys sorted lexicographically (UTF-16 code unit order)
 *   - No whitespace
 *   - Numbers: integers as integers; floats per ECMA-262 7.1.12.1
 *   - Strings: minimal escaping per JSON spec
 *
 * For Phase 1 this is internal. If a third-party canonicalization
 * library proves more robust under fuzzing, we'll switch (this is
 * not a public API).
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('canonicalize: non-finite number cannot be serialized');
    }
    return canonicalizeNumber(value);
  }

  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return (
      '{' +
      keys
        .map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k]))
        .join(',') +
      '}'
    );
  }

  throw new Error(`canonicalize: unsupported value type ${typeof value}`);
}

function canonicalizeNumber(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < Number.MAX_SAFE_INTEGER) {
    return String(n);
  }
  // Defer to ECMA-262 ToString for floats; this matches RFC 8785 for the
  // common cases. For very large or very small floats, results may differ
  // from strict JCS — acceptable in Phase 1 because schemas avoid such values.
  return String(n);
}

/**
 * Compute the SHA-256 hash of an arbitrary JSON-serializable value.
 * Returns lowercase hex.
 */
export function sha256OfCanonical(value: unknown): string {
  const canonical = canonicalize(value);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Compute the event_hash for a WitnessEventDraft.
 *
 * The hash is computed over the canonicalized draft (no event_hash field).
 * Returns lowercase hex.
 */
export function hashEvent(draft: WitnessEventDraft): string {
  return sha256OfCanonical(draft);
}

/**
 * Finalize a draft event by computing and attaching its hash.
 */
export function finalizeEvent(draft: WitnessEventDraft): WitnessEvent {
  const event_hash = hashEvent(draft);
  return { ...draft, event_hash };
}

/**
 * Verify a single event's self-hash.
 */
export function verifyEventHash(event: WitnessEvent): boolean {
  // Reconstruct draft by stripping event_hash, recompute, compare
  const { event_hash: actualHash, ...draft } = event;
  const expectedHash = hashEvent(draft as WitnessEventDraft);
  return constantTimeEquals(actualHash, expectedHash);
}

/**
 * Verify a chain segment.
 *
 * Returns:
 *   - { valid: true, chainHeadAfter } if all events verify
 *   - { valid: false, brokenAt: index, reason } at the first failure
 */
export interface ChainVerifyResult {
  valid: boolean;
  brokenAt?: number;
  reason?: string;
  chainHeadAfter?: string;
}

export function verifyChain(
  events: WitnessEvent[],
  expectedChainHeadBefore: string | null = null
): ChainVerifyResult {
  let prevHash: string | null = expectedChainHeadBefore;

  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;

    // 1. Verify previous_event_hash linkage
    if (event.previous_event_hash !== prevHash) {
      return {
        valid: false,
        brokenAt: i,
        reason: `previous_event_hash mismatch at index ${i}: expected ${prevHash}, got ${event.previous_event_hash}`,
      };
    }

    // 2. Verify self-hash
    if (!verifyEventHash(event)) {
      return {
        valid: false,
        brokenAt: i,
        reason: `event_hash invalid at index ${i} (event_id=${event.event_id})`,
      };
    }

    // 3. Verify sequence monotonicity
    const expectedSeq = i === 0
      ? events[i]!.sequence
      : (events[i - 1]!.sequence + 1);
    if (event.sequence !== expectedSeq) {
      return {
        valid: false,
        brokenAt: i,
        reason: `sequence non-monotonic at index ${i}: expected ${expectedSeq}, got ${event.sequence}`,
      };
    }

    prevHash = event.event_hash;
  }

  return {
    valid: true,
    ...(prevHash !== null ? { chainHeadAfter: prevHash } : {}),
  };
}

/**
 * Constant-time string equality, hex-string-friendly.
 *
 * Prevents timing oracles when comparing hashes. Strings of different
 * lengths return false immediately (length is not secret).
 */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
