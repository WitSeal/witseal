/**
 * Tamper detection — named `0.1.0` component over the hash chain.
 *
 * The detection logic itself lives in `verifyChain` (integrity/hash-chain):
 * it walks a chain segment and returns the first break with its index and a
 * reason. This module gives that capability a named, tamper-oriented surface
 * for the `0.1.0` five-component release
 * (`exec → receipt → verify → inspect → tamper detection`) and classifies a
 * detected break by kind.
 *
 * It adds NO new verification logic and does not change `verifyChain`'s
 * behaviour — it is a thin, classifying wrapper. The wire/structural checks in
 * the integrity and event-log layers remain the single source of truth.
 */
import { verifyChain, type ChainVerifyResult } from './hash-chain.js';
import type { WitnessEvent } from '../../schemas/witness-event.schema.js';

/**
 * The kind of tampering detected, derived from the chain break:
 *  - `none`      — no tampering; the chain segment verifies.
 *  - `content`   — an event's `event_hash` no longer matches its body: the
 *                  event was altered after it was witnessed.
 *  - `linkage`   — an event's `previous_event_hash` does not match its
 *                  predecessor: the chain was re-linked (an event swapped,
 *                  spliced, or a segment grafted).
 *  - `sequence`  — sequence numbers are non-monotonic: an event was inserted,
 *                  removed, or reordered.
 */
export type TamperKind = 'none' | 'content' | 'linkage' | 'sequence';

/**
 * Tamper report for a chain segment. `tampered` is the headline; `kind`,
 * `atIndex`, and `detail` localize and explain the break when present.
 */
export interface TamperReport {
  tampered: boolean;
  kind: TamperKind;
  /** Index of the first tampered event in the segment, when tampered. */
  atIndex?: number;
  /** Human-readable detail carried through from the chain verifier. */
  detail?: string;
}

/**
 * Detect tampering in a witness-event chain segment.
 *
 * Thin wrapper over `verifyChain`: a valid chain reports no tampering; a break
 * is reported with its kind, index, and detail. `expectedChainHeadBefore`
 * anchors the segment to a known prior head (null for a segment start).
 */
export function detectTampering(
  events: WitnessEvent[],
  expectedChainHeadBefore: string | null = null,
): TamperReport {
  const result: ChainVerifyResult = verifyChain(events, expectedChainHeadBefore);

  if (result.valid) {
    return { tampered: false, kind: 'none' };
  }

  return {
    tampered: true,
    kind: classifyBreak(result.reason),
    ...(result.brokenAt !== undefined ? { atIndex: result.brokenAt } : {}),
    ...(result.reason !== undefined ? { detail: result.reason } : {}),
  };
}

/**
 * Map a `verifyChain` reason string to a `TamperKind`. The reason strings are
 * produced by `verifyChain` and matched here on stable substrings; if the
 * reason is absent or unrecognized we conservatively report `content` (the
 * event body could not be trusted).
 */
function classifyBreak(reason: string | undefined): TamperKind {
  if (!reason) return 'content';
  if (reason.includes('previous_event_hash')) return 'linkage';
  if (reason.includes('event_hash invalid')) return 'content';
  if (reason.includes('sequence')) return 'sequence';
  return 'content';
}
