/**
 * Tests for src/receipts/generate.ts.
 *
 * Verifies receipt construction (field derivation from witness event,
 * self-hash) and tamper detection in verifyReceipt.
 */

import { describe, expect, it } from 'vitest';
import { generateReceipt, verifyReceipt } from '../src/receipts/generate.js';
import { finalizeEvent, sha256OfCanonical } from '../src/integrity/hash-chain.js';
import type {
  WitnessEvent,
  WitnessEventDraft,
} from '../schemas/witness-event.schema.js';

function makeDraft(overrides: Partial<WitnessEventDraft> = {}): WitnessEventDraft {
  return {
    schema_version: 'witseal.witness.v0.1',
    event_id: 'evt_test00000000000001',
    chain_segment_id: 'default',
    sequence: 0,
    timestamp: '2026-05-18T12:00:00Z',
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
    execution_result: {
      schema_version: 'witseal.execution.v0.1',
      started_at: '2026-05-18T12:00:00Z',
      finished_at: '2026-05-18T12:00:01Z',
      exit_code: 0,
      signal: null,
      stdout: {
        total_bytes: 6,
        content_hash: 'a'.repeat(64),
        head: 'hello\n',
        tail: null,
        head_bytes: 6,
        tail_bytes: 0,
        truncated: false,
      },
      stderr: {
        total_bytes: 0,
        content_hash: 'b'.repeat(64),
        head: null,
        tail: null,
        head_bytes: 0,
        tail_bytes: 0,
        truncated: false,
      },
      executable_resolved: '/bin/echo',
      env_keys_hash: 'c'.repeat(64),
      spawn_error: null,
    },
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

function makeEvent(overrides: Partial<WitnessEventDraft> = {}): WitnessEvent {
  return finalizeEvent(makeDraft(overrides));
}

describe('generateReceipt — field derivation', () => {
  it('returns a receipt with all required fields populated', () => {
    const event = makeEvent();
    const receipt = generateReceipt(event);

    expect(receipt.schema_version).toBe('witseal.receipt.v0.1');
    expect(receipt.receipt_id).toBe(event.receipt_id);
    expect(receipt.witness_event_id).toBe(event.event_id);
    expect(receipt.chain_segment_id).toBe(event.chain_segment_id);
    expect(receipt.outcome).toBe(event.outcome);
    expect(receipt.receipt_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.finalized_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it('derives policy_decision_hash from event.policy_decision', () => {
    const event = makeEvent();
    const receipt = generateReceipt(event);
    expect(receipt.policy_decision_hash).toBe(sha256OfCanonical(event.policy_decision));
  });

  it('derives classified_intent_hash from event.classified_intent', () => {
    const event = makeEvent();
    const receipt = generateReceipt(event);
    expect(receipt.classified_intent_hash).toBe(sha256OfCanonical(event.classified_intent));
  });

  it('derives execution_result_hash when execution_result is present', () => {
    const event = makeEvent();
    const receipt = generateReceipt(event);
    expect(receipt.execution_result_hash).toBe(sha256OfCanonical(event.execution_result));
  });

  it('sets execution_result_hash to null when execution_result is null (denial)', () => {
    const event = makeEvent({ execution_result: null, outcome: 'denied_by_policy' });
    const receipt = generateReceipt(event);
    expect(receipt.execution_result_hash).toBe(null);
  });

  it('mirrors outcome from the witness event', () => {
    const denial = generateReceipt(makeEvent({ outcome: 'denied_by_policy', execution_result: null }));
    expect(denial.outcome).toBe('denied_by_policy');

    const success = generateReceipt(makeEvent({ outcome: 'allowed_executed' }));
    expect(success.outcome).toBe('allowed_executed');
  });

  it('uses the receipt_id assigned by the witness event (1:1 pairing)', () => {
    const event = makeEvent({ receipt_id: 'rcpt_specifictest12345678' });
    const receipt = generateReceipt(event);
    expect(receipt.receipt_id).toBe('rcpt_specifictest12345678');
  });

  it('uses the chain_segment_id of the witness event', () => {
    const event = makeEvent({ chain_segment_id: 'forensic' });
    const receipt = generateReceipt(event);
    expect(receipt.chain_segment_id).toBe('forensic');
  });
});

describe('generateReceipt — self-hash', () => {
  it('computes receipt_hash over the canonical receipt with receipt_hash field excluded', () => {
    const event = makeEvent();
    const receipt = generateReceipt(event);
    const { receipt_hash, ...draft } = receipt;
    expect(sha256OfCanonical(draft)).toBe(receipt_hash);
  });

  it('produces different hashes for receipts of different witness events', () => {
    const eventA = makeEvent({
      event_id: 'evt_test00000000000001',
      receipt_id: 'rcpt_test0000000000000001',
      agent_identifier: 'agent-a',
    });
    const eventB = makeEvent({
      event_id: 'evt_test00000000000002',
      receipt_id: 'rcpt_test0000000000000002',
      agent_identifier: 'agent-b',
    });
    const a = generateReceipt(eventA);
    const b = generateReceipt(eventB);
    expect(a.receipt_hash).not.toBe(b.receipt_hash);
  });
});

describe('verifyReceipt — happy path', () => {
  it('returns valid=true for a freshly generated receipt against its event', () => {
    const event = makeEvent();
    const receipt = generateReceipt(event);
    expect(verifyReceipt(receipt, event)).toEqual({ valid: true });
  });

  it('verifies a receipt for a denial event (execution_result null)', () => {
    const event = makeEvent({ execution_result: null, outcome: 'denied_by_policy' });
    const receipt = generateReceipt(event);
    expect(verifyReceipt(receipt, event)).toEqual({ valid: true });
  });
});

describe('verifyReceipt — tamper detection', () => {
  it('detects witness_event_id mismatch', () => {
    const event = makeEvent();
    const receipt = generateReceipt(event);
    const tampered = { ...receipt, witness_event_id: 'evt_other000000000000001' };
    const result = verifyReceipt(tampered, event);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/witness_event_id/);
  });

  it('detects receipt_id mismatch with the event', () => {
    const event = makeEvent();
    const receipt = generateReceipt(event);
    const tampered = { ...receipt, receipt_id: 'rcpt_other00000000000001' };
    const result = verifyReceipt(tampered, event);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/receipt_id/);
  });

  it('detects classified_intent tampering (hash mismatch)', () => {
    const event = makeEvent();
    const receipt = generateReceipt(event);
    const tamperedEvent: WitnessEvent = {
      ...event,
      classified_intent: { ...event.classified_intent, risk_class: 'C4' },
    };
    const result = verifyReceipt(receipt, tamperedEvent);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/classified_intent_hash/);
  });

  it('detects policy_decision tampering (hash mismatch)', () => {
    const event = makeEvent();
    const receipt = generateReceipt(event);
    const tamperedEvent: WitnessEvent = {
      ...event,
      policy_decision: { ...event.policy_decision, reason: 'tampered reason' },
    };
    const result = verifyReceipt(receipt, tamperedEvent);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/policy_decision_hash/);
  });

  it('detects execution_result tampering (hash mismatch)', () => {
    const event = makeEvent();
    const receipt = generateReceipt(event);
    const tamperedEvent: WitnessEvent = {
      ...event,
      execution_result: { ...event.execution_result!, exit_code: 999 },
    };
    const result = verifyReceipt(receipt, tamperedEvent);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/execution_result_hash/);
  });

  it('detects execution_result presence mismatch (receipt expects null, event has it)', () => {
    const denialEvent = makeEvent({ execution_result: null, outcome: 'denied_by_policy' });
    const receipt = generateReceipt(denialEvent);
    // Now swap to an event that DOES have an execution_result
    const eventWithExec = makeEvent({ outcome: 'denied_by_policy' });
    const result = verifyReceipt(receipt, eventWithExec);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/execution_result_hash/);
  });

  it('detects receipt_hash self-hash invalidation', () => {
    const event = makeEvent();
    const receipt = generateReceipt(event);
    const tampered = { ...receipt, receipt_hash: 'f'.repeat(64) };
    const result = verifyReceipt(tampered, event);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/receipt_hash/);
  });

  it('detects tampering of any non-hash receipt field via self-hash check', () => {
    const event = makeEvent();
    const receipt = generateReceipt(event);
    // Change finalized_at without recomputing receipt_hash
    const tampered = { ...receipt, finalized_at: '2099-01-01T00:00:00Z' };
    const result = verifyReceipt(tampered, event);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/receipt_hash/);
  });
});
