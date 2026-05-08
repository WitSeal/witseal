/**
 * Tests for the hash chain implementation (src/integrity/hash-chain.ts).
 *
 * These tests verify the core integrity property: tampering with any
 * field of any event in a chain segment causes verification to fail
 * at the tampered index.
 */

import { describe, expect, it } from 'vitest';
import {
  canonicalize,
  hashEvent,
  finalizeEvent,
  verifyEventHash,
  verifyChain,
  sha256OfCanonical,
} from '../src/integrity/hash-chain.js';
import type { WitnessEvent, WitnessEventDraft } from '../schemas/witness-event.schema.js';

// Helper: build a minimal valid event draft for testing.
function makeDraft(overrides: Partial<WitnessEventDraft> = {}): WitnessEventDraft {
  return {
    schema_version: 'witseal.witness.v0.1',
    event_id: 'evt_test00000000000001',
    chain_segment_id: 'default',
    sequence: 0,
    timestamp: '2026-05-08T12:00:00Z',
    previous_event_hash: null,
    originating_node: 'local',
    agent_identifier: 'test-agent',
    classified_intent: {
      schema_version: 'witseal.intent.v0.1',
      intent_id: 'int_test0000000000000001',
      intent: {
        action_type: 'shell_command',
        executable: '/bin/echo',
        args: ['hello'],
        cwd: '/tmp',
        use_tty: false,
      },
      risk_class: 'C0',
      classification_reasons: ['echo is informational'],
      classifier_version: 'test-1.0',
    },
    policy_decision: {
      schema_version: 'witseal.policy.v0.1',
      outcome: 'allow',
      matched_rule: null,
      reason: 'default allow',
      active_pack_hashes: [],
    },
    approval: null,
    execution_result: null,
    outcome: 'allowed_executed',
    receipt_id: 'rcpt_test0000000000000001',
    versions: {
      witseal_runtime: 'test-0.1.0',
      classifier: 'test-1.0',
      schema: 'witseal.witness.v0.1',
    },
    ...overrides,
  };
}

describe('canonicalize', () => {
  it('sorts object keys lexicographically', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('handles nested objects', () => {
    expect(canonicalize({ x: { z: 1, y: 2 } })).toBe('{"x":{"y":2,"z":1}}');
  });

  it('handles arrays without sorting them', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
  });

  it('omits undefined fields', () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('preserves null values', () => {
    expect(canonicalize({ a: null })).toBe('{"a":null}');
  });

  it('rejects non-finite numbers', () => {
    expect(() => canonicalize(NaN)).toThrow();
    expect(() => canonicalize(Infinity)).toThrow();
  });

  it('produces identical output for equivalent objects with different key orders', () => {
    const a = { foo: { x: 1, y: 2 }, bar: [1, 2, 3] };
    const b = { bar: [1, 2, 3], foo: { y: 2, x: 1 } };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });
});

describe('sha256OfCanonical', () => {
  it('returns 64-character lowercase hex', () => {
    const hash = sha256OfCanonical({ test: 'value' });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is stable across equivalent inputs', () => {
    expect(sha256OfCanonical({ a: 1, b: 2 })).toBe(
      sha256OfCanonical({ b: 2, a: 1 })
    );
  });

  it('differs for different inputs', () => {
    expect(sha256OfCanonical({ a: 1 })).not.toBe(sha256OfCanonical({ a: 2 }));
  });
});

describe('hashEvent / finalizeEvent / verifyEventHash', () => {
  it('finalizes a draft into an event with valid event_hash', () => {
    const draft = makeDraft();
    const event = finalizeEvent(draft);
    expect(event.event_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyEventHash(event)).toBe(true);
  });

  it('detects modification to a regular field', () => {
    const event = finalizeEvent(makeDraft());
    const tampered: WitnessEvent = { ...event, agent_identifier: 'evil-agent' };
    expect(verifyEventHash(tampered)).toBe(false);
  });

  it('detects modification to a nested field', () => {
    const event = finalizeEvent(makeDraft());
    const tampered: WitnessEvent = {
      ...event,
      classified_intent: {
        ...event.classified_intent,
        risk_class: 'C4',
      },
    };
    expect(verifyEventHash(tampered)).toBe(false);
  });

  it('rejects events with manually-set wrong hash', () => {
    const event = finalizeEvent(makeDraft());
    const tampered: WitnessEvent = {
      ...event,
      event_hash: 'a'.repeat(64),
    };
    expect(verifyEventHash(tampered)).toBe(false);
  });
});

describe('verifyChain', () => {
  function buildChain(length: number): WitnessEvent[] {
    const events: WitnessEvent[] = [];
    let prevHash: string | null = null;
    for (let i = 0; i < length; i++) {
      const draft = makeDraft({
        sequence: i,
        previous_event_hash: prevHash,
        event_id: `evt_test0000000000000${(i + 1).toString().padStart(3, '0')}`,
        receipt_id: `rcpt_test000000000000${(i + 1).toString().padStart(4, '0')}`,
      });
      const event = finalizeEvent(draft);
      events.push(event);
      prevHash = event.event_hash;
    }
    return events;
  }

  it('verifies a valid chain', () => {
    const events = buildChain(5);
    const result = verifyChain(events);
    expect(result.valid).toBe(true);
    expect(result.chainHeadAfter).toBe(events[4]!.event_hash);
  });

  it('verifies a single-event chain (genesis only)', () => {
    const events = buildChain(1);
    const result = verifyChain(events);
    expect(result.valid).toBe(true);
  });

  it('detects break when an event is modified', () => {
    const events = buildChain(5);
    // Tamper with event at index 2
    events[2] = { ...events[2]!, agent_identifier: 'evil-agent' };
    const result = verifyChain(events);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(2);
  });

  it('detects break when an event is removed (gap)', () => {
    const events = buildChain(5);
    events.splice(2, 1); // remove index 2; now index 2 is the old index 3
    const result = verifyChain(events);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(2);
  });

  it('detects break when sequence is non-monotonic', () => {
    const events = buildChain(3);
    // Manually corrupt sequence
    const corrupted = finalizeEvent({
      ...makeDraft({
        sequence: 99,
        previous_event_hash: events[2]!.event_hash,
        event_id: 'evt_test0000000000000004',
      }),
    });
    const chain = [...events, corrupted];
    const result = verifyChain(chain);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(3);
  });

  it('detects rewriting attack: tampered event with re-computed hash but wrong previous', () => {
    const events = buildChain(5);
    // Attempt to insert a fabricated event in the middle
    // by creating a valid-looking event that doesn't link properly
    const fabricated = finalizeEvent({
      ...makeDraft({
        sequence: 2,
        previous_event_hash: 'a'.repeat(64), // wrong link
        event_id: 'evt_testFAKE000000000000',
      }),
    });
    events[2] = fabricated;
    const result = verifyChain(events);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(2);
  });
});
