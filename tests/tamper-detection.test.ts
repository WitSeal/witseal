/**
 * Tests for the named tamper-detection component (src/integrity/tamper.ts).
 *
 * The component is a thin, classifying wrapper over verifyChain. These tests
 * assert the headline (`tampered`), the classified `kind`, and the localized
 * `atIndex` for each break class — and that a clean chain reports none.
 */
import { describe, expect, it } from 'vitest';
import { finalizeEvent } from '../src/integrity/hash-chain.js';
import { detectTampering } from '../src/integrity/tamper.js';
import type { WitnessEvent, WitnessEventDraft } from '../schemas/witness-event.schema.js';

// Minimal valid event draft (mirrors the hash-chain test helper).
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

// Build a valid two-event chain.
function validChain(): [WitnessEvent, WitnessEvent] {
  const e0 = finalizeEvent(makeDraft({ event_id: 'evt_test00000000000001', sequence: 0, previous_event_hash: null }));
  const e1 = finalizeEvent(
    makeDraft({ event_id: 'evt_test00000000000002', sequence: 1, previous_event_hash: e0.event_hash }),
  );
  return [e0, e1];
}

describe('detectTampering', () => {
  it('reports no tampering for a valid chain', () => {
    const report = detectTampering(validChain());
    expect(report.tampered).toBe(false);
    expect(report.kind).toBe('none');
    expect(report.atIndex).toBeUndefined();
  });

  it('classifies content tampering (event body altered after witnessing)', () => {
    const [e0, e1] = validChain();
    // Mutate a field without re-finalizing → event_hash no longer matches body.
    const tampered = { ...e0, agent_identifier: 'attacker' };
    const report = detectTampering([tampered, e1]);
    expect(report.tampered).toBe(true);
    expect(report.kind).toBe('content');
    expect(report.atIndex).toBe(0);
  });

  it('classifies linkage tampering (chain re-linked)', () => {
    const [e0, e1] = validChain();
    const relinked = { ...e1, previous_event_hash: 'deadbeef'.repeat(8) };
    const report = detectTampering([e0, relinked]);
    expect(report.tampered).toBe(true);
    expect(report.kind).toBe('linkage');
    expect(report.atIndex).toBe(1);
  });

  it('classifies sequence tampering (event reordered/inserted/removed)', () => {
    const e0 = finalizeEvent(makeDraft({ event_id: 'evt_test00000000000001', sequence: 0, previous_event_hash: null }));
    // Valid linkage + valid self-hash, but sequence jumps 0 → 5.
    const e1 = finalizeEvent(
      makeDraft({ event_id: 'evt_test00000000000002', sequence: 5, previous_event_hash: e0.event_hash }),
    );
    const report = detectTampering([e0, e1]);
    expect(report.tampered).toBe(true);
    expect(report.kind).toBe('sequence');
    expect(report.atIndex).toBe(1);
  });

  it('carries a human-readable detail through from the verifier', () => {
    const [e0, e1] = validChain();
    const tampered = { ...e0, agent_identifier: 'attacker' };
    const report = detectTampering([tampered, e1]);
    expect(report.detail).toBeTypeOf('string');
    expect(report.detail!.length).toBeGreaterThan(0);
  });
});
