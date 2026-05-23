/**
 * Tests for v0.2 receipt schema + R-3 signing helper + generate dispatch.
 *
 * Coverage:
 *   - Schema parsing (positive + negative on each new v0.2 field)
 *   - R-3 empty-string-sentinel invariant (sign pre-image, computeReceiptHash)
 *   - Round-trip sign → verify
 *   - Tamper detection on each integrity-bearing field
 *   - prev_hash genesis-null and chained linkage
 *   - generateReceiptV02 happy path + execution_lost (R-5)
 *   - generateReceiptByVersion dispatch (v0.1, v0.2, error paths)
 *   - Path-D serialize-skip optionals
 */

import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
  ExecutionReceiptV02Schema,
  type ExecutionReceiptV02,
  type ExecutionReceiptV02Draft,
} from '../schemas/receipt-v0.2.schema.js';
import {
  SIGNATURE_SENTINEL,
  computeReceiptHash,
  signReceiptV02,
  signingPreImageBytes,
  verifyReceiptV02,
} from '../src/receipts/sign-v0.2.js';
import {
  EXECUTION_LOST_OUTCOME,
  generateReceiptByVersion,
  generateReceiptV02,
  type ReceiptV02ExtraInputs,
} from '../src/receipts/generate.js';
import type { WitnessEvent } from '../schemas/witness-event.schema.js';

function makeKeyPair() {
  return generateKeyPairSync('ed25519');
}

function makeDraft(
  overrides: Partial<ExecutionReceiptV02Draft> = {}
): ExecutionReceiptV02Draft {
  return {
    schema_version: 'witseal.receipt.v0.2',
    receipt_id: 'rcpt_test0000000000000001',
    witness_event_id: 'evt_test0000000000000001',
    chain_segment_id: 'default',
    finalized_at: '2026-05-22T12:00:00Z',
    policy_decision_hash: 'a'.repeat(64),
    classified_intent_hash: 'b'.repeat(64),
    execution_result_hash: 'c'.repeat(64),
    outcome: 'allowed_executed',
    prev_hash: null,
    signature: SIGNATURE_SENTINEL,
    git_commit: '0'.repeat(40),
    artifact_digest: 'sha256:' + 'd'.repeat(64),
    attestation_digest: 'sha256:' + 'e'.repeat(64),
    ...overrides,
  };
}

function makeWitnessEvent(
  overrides: Partial<WitnessEvent> = {}
): WitnessEvent {
  return {
    schema_version: 'witseal.witness.v0.1',
    event_id: 'evt_test0000000000000001',
    chain_segment_id: 'default',
    sequence: 0,
    timestamp: '2026-05-22T12:00:00Z',
    previous_event_hash: null,
    event_hash: 'f'.repeat(64),
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

function makeExtras(
  overrides: Partial<ReceiptV02ExtraInputs> = {}
): ReceiptV02ExtraInputs {
  return {
    prev_hash: null,
    git_commit: '0'.repeat(40),
    artifact_digest: 'sha256:' + 'd'.repeat(64),
    attestation_digest: 'sha256:' + 'e'.repeat(64),
    finalized_at: '2026-05-22T12:00:00Z',
    ...overrides,
  };
}

describe('R-3 empty-string-sentinel invariant', () => {
  it('SIGNATURE_SENTINEL is the empty string', () => {
    expect(SIGNATURE_SENTINEL).toBe('');
  });

  it('signingPreImageBytes refuses bodies without the empty sentinel', () => {
    const draft = makeDraft({ signature: 'something-non-empty' });
    expect(() =>
      signingPreImageBytes(draft as unknown as Record<string, unknown>)
    ).toThrow(/empty-string sentinel/);
  });

  it('computeReceiptHash refuses drafts without the empty sentinel', () => {
    const draft = makeDraft({ signature: 'x' });
    expect(() => computeReceiptHash(draft)).toThrow(/empty-string sentinel/);
  });

  it('signingPreImageBytes accepts bodies with signature = ""', () => {
    const draft = makeDraft();
    const bytes = signingPreImageBytes(
      draft as unknown as Record<string, unknown>
    );
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
  });
});

describe('sign / verify round-trip', () => {
  it('signs a draft and verifies the finalized receipt', () => {
    const { privateKey, publicKey } = makeKeyPair();
    const draft = makeDraft();
    const receipt = signReceiptV02(draft, privateKey);

    expect(receipt.receipt_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.signature).toMatch(/^[A-Za-z0-9+/]{86}==$/);

    expect(verifyReceiptV02(receipt, publicKey)).toEqual({ valid: true });
  });

  it('parses the finalized receipt against the v0.2 zod schema', () => {
    const { privateKey } = makeKeyPair();
    const receipt = signReceiptV02(makeDraft(), privateKey);
    expect(() => ExecutionReceiptV02Schema.parse(receipt)).not.toThrow();
  });

  it('accepts a 32-byte raw Ed25519 seed as private key material', () => {
    const seed = randomBytes(32);
    const receipt = signReceiptV02(makeDraft(), seed);
    expect(receipt.signature).toMatch(/^[A-Za-z0-9+/]{86}==$/);
  });

  it('verification fails under a different public key', () => {
    const { privateKey } = makeKeyPair();
    const { publicKey: otherPublic } = makeKeyPair();
    const receipt = signReceiptV02(makeDraft(), privateKey);
    const result = verifyReceiptV02(receipt, otherPublic);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/signature verification failed/);
  });
});

describe('tamper detection', () => {
  function corrupt<K extends keyof ExecutionReceiptV02>(
    receipt: ExecutionReceiptV02,
    field: K,
    value: ExecutionReceiptV02[K]
  ): ExecutionReceiptV02 {
    return { ...receipt, [field]: value };
  }

  it('flipping outcome fails verification', () => {
    const { privateKey, publicKey } = makeKeyPair();
    const receipt = signReceiptV02(makeDraft(), privateKey);
    const tampered = corrupt(receipt, 'outcome', 'denied_by_policy');
    expect(verifyReceiptV02(tampered, publicKey).valid).toBe(false);
  });

  it('flipping policy_decision_hash fails verification', () => {
    const { privateKey, publicKey } = makeKeyPair();
    const receipt = signReceiptV02(makeDraft(), privateKey);
    const tampered = corrupt(receipt, 'policy_decision_hash', '0'.repeat(64));
    expect(verifyReceiptV02(tampered, publicKey).valid).toBe(false);
  });

  it('flipping git_commit fails verification', () => {
    const { privateKey, publicKey } = makeKeyPair();
    const receipt = signReceiptV02(makeDraft(), privateKey);
    const tampered = corrupt(receipt, 'git_commit', '1'.repeat(40));
    expect(verifyReceiptV02(tampered, publicKey).valid).toBe(false);
  });

  it('flipping artifact_digest fails verification', () => {
    const { privateKey, publicKey } = makeKeyPair();
    const receipt = signReceiptV02(makeDraft(), privateKey);
    const tampered = corrupt(
      receipt,
      'artifact_digest',
      'sha256:' + '1'.repeat(64)
    );
    expect(verifyReceiptV02(tampered, publicKey).valid).toBe(false);
  });

  it('flipping prev_hash from null → non-null fails verification', () => {
    const { privateKey, publicKey } = makeKeyPair();
    const receipt = signReceiptV02(makeDraft({ prev_hash: null }), privateKey);
    const tampered = corrupt(receipt, 'prev_hash', '9'.repeat(64));
    expect(verifyReceiptV02(tampered, publicKey).valid).toBe(false);
  });

  it('mutating receipt_hash alone fails the self-hash check', () => {
    const { privateKey, publicKey } = makeKeyPair();
    const receipt = signReceiptV02(makeDraft(), privateKey);
    const tampered = corrupt(receipt, 'receipt_hash', '1'.repeat(64));
    const result = verifyReceiptV02(tampered, publicKey);
    expect(result.valid).toBe(false);
  });
});

describe('prev_hash chain linkage', () => {
  it('genesis receipts carry prev_hash = null (Option B)', () => {
    const { privateKey, publicKey } = makeKeyPair();
    const receipt = signReceiptV02(makeDraft({ prev_hash: null }), privateKey);
    expect(receipt.prev_hash).toBeNull();
    expect(verifyReceiptV02(receipt, publicKey).valid).toBe(true);
  });

  it('chained receipts carry the predecessor receipt_hash', () => {
    const { privateKey, publicKey } = makeKeyPair();
    const r1 = signReceiptV02(makeDraft({ prev_hash: null }), privateKey);
    const r2 = signReceiptV02(
      makeDraft({
        receipt_id: 'rcpt_test0000000000000002',
        witness_event_id: 'evt_test0000000000000002',
        prev_hash: r1.receipt_hash,
      }),
      privateKey
    );
    expect(r2.prev_hash).toBe(r1.receipt_hash);
    expect(verifyReceiptV02(r2, publicKey).valid).toBe(true);
  });
});

describe('schema validation — negative cases', () => {
  it('rejects unpadded base64 signatures', () => {
    const receipt = signReceiptV02(makeDraft(), makeKeyPair().privateKey);
    const bad = { ...receipt, signature: 'abc' };
    expect(() => ExecutionReceiptV02Schema.parse(bad)).toThrow();
  });

  it('rejects git_commit with "git:" prefix (RFC-002 §7.2 bare 40-hex)', () => {
    const receipt = signReceiptV02(makeDraft(), makeKeyPair().privateKey);
    const bad = { ...receipt, git_commit: 'git:' + '0'.repeat(40) };
    expect(() => ExecutionReceiptV02Schema.parse(bad)).toThrow();
  });

  it('rejects artifact_digest without sha256: prefix', () => {
    const receipt = signReceiptV02(makeDraft(), makeKeyPair().privateKey);
    const bad = { ...receipt, artifact_digest: 'd'.repeat(64) };
    expect(() => ExecutionReceiptV02Schema.parse(bad)).toThrow();
  });

  it('rejects wrong schema_version literal', () => {
    const receipt = signReceiptV02(makeDraft(), makeKeyPair().privateKey);
    const bad = { ...receipt, schema_version: 'witseal.receipt.v0.1' as const };
    expect(() => ExecutionReceiptV02Schema.parse(bad)).toThrow();
  });
});

describe('generateReceiptV02 from witness event', () => {
  it('produces a finalized signed v0.2 receipt for a happy-path event', () => {
    const { privateKey, publicKey } = makeKeyPair();
    const event = makeWitnessEvent();
    const receipt = generateReceiptV02(event, makeExtras(), privateKey);

    expect(receipt.schema_version).toBe('witseal.receipt.v0.2');
    expect(receipt.receipt_id).toBe(event.receipt_id);
    expect(receipt.witness_event_id).toBe(event.event_id);
    expect(receipt.outcome).toBe(event.outcome);
    expect(receipt.execution_result_hash).toBeNull();
    expect(receipt.prev_hash).toBeNull();
    expect(verifyReceiptV02(receipt, publicKey).valid).toBe(true);
  });

  it('execution_lost: receipt_id null, outcome execution_lost, exec hash null', () => {
    const { privateKey, publicKey } = makeKeyPair();
    const event = makeWitnessEvent({
      execution_result: {
        schema_version: 'witseal.execution.v0.1',
        execution_id: 'exec_test0000000000000001',
        started_at: '2026-05-22T12:00:00Z',
        ended_at: '2026-05-22T12:00:01Z',
        success: true,
        exit_code: 0,
        stdout_digest: 'sha256:' + '1'.repeat(64),
        stderr_digest: 'sha256:' + '2'.repeat(64),
        truncated: false,
        signal: null,
      } as unknown as WitnessEvent['execution_result'],
    });
    const receipt = generateReceiptV02(
      event,
      makeExtras({ executionLost: true }),
      privateKey
    );

    expect(receipt.receipt_id).toBeNull();
    expect(receipt.outcome).toBe(EXECUTION_LOST_OUTCOME);
    expect(receipt.execution_result_hash).toBeNull();
    expect(verifyReceiptV02(receipt, publicKey).valid).toBe(true);
  });

  it('Path-D optionals omitted when absent (serialize-skip)', () => {
    const { privateKey } = makeKeyPair();
    const receipt = generateReceiptV02(
      makeWitnessEvent(),
      makeExtras(),
      privateKey
    );
    expect('sigstore_signature' in receipt).toBe(false);
    expect('classifier_version' in receipt).toBe(false);
    expect('shadow_mode' in receipt).toBe(false);
  });

  it('Path-D optionals carried through when provided', () => {
    const { privateKey, publicKey } = makeKeyPair();
    const receipt = generateReceiptV02(
      makeWitnessEvent(),
      makeExtras({
        sigstore_signature: 'sigstore-blob',
        classifier_version: 'cls-1.2.3',
        shadow_mode: true,
      }),
      privateKey
    );
    expect(receipt.sigstore_signature).toBe('sigstore-blob');
    expect(receipt.classifier_version).toBe('cls-1.2.3');
    expect(receipt.shadow_mode).toBe(true);
    expect(verifyReceiptV02(receipt, publicKey).valid).toBe(true);
  });
});

describe('generateReceiptByVersion dispatch', () => {
  it('routes v0.1 to the legacy generator', () => {
    const event = makeWitnessEvent();
    const r = generateReceiptByVersion(event, 'witseal.receipt.v0.1');
    expect(r.schema_version).toBe('witseal.receipt.v0.1');
    expect((r as { signature?: unknown }).signature).toBeUndefined();
  });

  it('routes v0.2 to the signed generator', () => {
    const { privateKey, publicKey } = makeKeyPair();
    const event = makeWitnessEvent();
    const r = generateReceiptByVersion(
      event,
      'witseal.receipt.v0.2',
      makeExtras(),
      privateKey
    );
    expect(r.schema_version).toBe('witseal.receipt.v0.2');
    expect(verifyReceiptV02(r, publicKey).valid).toBe(true);
  });

  it('v0.2 dispatch throws if extras/privateKey missing', () => {
    const event = makeWitnessEvent();
    expect(() =>
      (
        generateReceiptByVersion as unknown as (
          e: WitnessEvent,
          v: 'witseal.receipt.v0.2'
        ) => unknown
      )(event, 'witseal.receipt.v0.2')
    ).toThrow(/requires `extra` and `privateKey`/);
  });
});

describe('signature format invariant', () => {
  it('produces 88-char base64 std-padded signatures across many keys', () => {
    const re = /^[A-Za-z0-9+/]{86}==$/;
    for (let i = 0; i < 8; i++) {
      const { privateKey } = makeKeyPair();
      const r = signReceiptV02(makeDraft(), privateKey);
      expect(r.signature).toMatch(re);
    }
  });
});

// Z type is referenced indirectly via schema usage; importing avoids unused-import
// lint failures if zod is locally introduced later.
void z;
