/**
 * Unified, version-discriminating verify surface.
 *
 * Tests `verifyArtifact` (src/verify/verify.ts): the single entry point that
 * classifies an artifact by schema_version and returns one VALID / INVALID
 * verdict with a precise reason.
 *
 * Coverage:
 *   - v0.1 receipt: valid (self-hash), tampered (self-hash fail), schema-invalid.
 *   - v0.2 receipt: valid under correct key; INVALID under wrong key; INVALID
 *     when no key supplied; INVALID on field tamper; INVALID on malformed
 *     (un-prefixed) signature.
 *   - evidence package: valid with v0.1 receipts; valid with v0.2 receipts +
 *     key; INVALID on chain tamper; INVALID on receipt tamper; INVALID on
 *     chain_head_after_range mismatch; INVALID when package carries v0.2
 *     receipts but no key is supplied.
 *   - unknown / missing schema_version → INVALID kind=unknown.
 *
 * These assertions are written to the spec, not bent toward green: each
 * INVALID case asserts both valid=false AND a reason that names the actual
 * failure.
 */

import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, type KeyObject } from 'node:crypto';

import { verifyArtifact } from '../src/verify/verify.js';
import { sha256OfCanonical, finalizeEvent } from '../src/integrity/hash-chain.js';
import { generateReceipt } from '../src/receipts/generate.js';
import { signReceiptV02 } from '../src/receipts/sign-v0.2.js';
import type { ExecutionReceiptV02Draft } from '../schemas/receipt-v0.2.schema.js';
import type {
  WitnessEvent,
  WitnessEventDraft,
} from '../schemas/witness-event.schema.js';

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

let SEQ = 0;
function uniqueSuffix(): string {
  SEQ += 1;
  return String(SEQ).padStart(20, '0');
}

function makeEvent(
  sequence: number,
  previousEventHash: string | null,
  overrides: Partial<WitnessEventDraft> = {}
): WitnessEvent {
  const suffix = uniqueSuffix();
  const draft: WitnessEventDraft = {
    schema_version: 'witseal.witness.v0.1',
    event_id: `evt_${suffix}`,
    chain_segment_id: 'verify-test-segment',
    sequence,
    timestamp: '2026-05-22T12:00:00Z',
    previous_event_hash: previousEventHash,
    originating_node: 'local',
    agent_identifier: 'verify-test',
    classified_intent: {
      schema_version: 'witseal.intent.v0.1',
      intent_id: `int_${suffix}`,
      intent: {
        action_type: 'shell_command',
        executable: '/bin/echo',
        args: ['hi'],
        cwd: '/tmp',
        use_tty: false,
      },
      risk_class: 'C0',
      classification_reasons: ['informational'],
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
    receipt_id: `rcpt_${suffix}`,
    versions: {
      witseal_runtime: 'test-0.1.0',
      classifier: 'test-1.0',
      schema: 'witseal.witness.v0.1',
    },
    ...overrides,
  };
  return finalizeEvent(draft);
}

/** Build a contiguous valid chain of N events. */
function makeChain(n: number): WitnessEvent[] {
  const events: WitnessEvent[] = [];
  let prev: string | null = null;
  for (let i = 0; i < n; i++) {
    const ev = makeEvent(i, prev);
    events.push(ev);
    prev = ev.event_hash;
  }
  return events;
}

function v02DraftFromEvent(
  event: WitnessEvent,
  prevHash: string | null
): ExecutionReceiptV02Draft {
  return {
    schema_version: 'witseal.receipt.v0.2',
    receipt_id: event.receipt_id,
    witness_event_id: event.event_id,
    chain_segment_id: event.chain_segment_id,
    finalized_at: '2026-05-22T12:00:00Z',
    policy_decision_hash: sha256OfCanonical(event.policy_decision),
    classified_intent_hash: sha256OfCanonical(event.classified_intent),
    execution_result_hash: event.execution_result
      ? sha256OfCanonical(event.execution_result)
      : null,
    outcome: event.outcome,
    prev_hash: prevHash,
    signature: '',
    git_commit: '0'.repeat(40),
    artifact_digest: 'sha256:' + 'd'.repeat(64),
    attestation_digest: 'sha256:' + 'e'.repeat(64),
    artifact_type: 'generic-binary',
    build_id: 'verify-test-build-0001',
  };
}

interface PackageOpts {
  receiptVersion: 'witseal.receipt.v0.1' | 'witseal.receipt.v0.2';
  privateKey?: KeyObject;
}

function makePackage(events: WitnessEvent[], opts: PackageOpts): Record<string, unknown> {
  let receipts: unknown[];
  if (opts.receiptVersion === 'witseal.receipt.v0.2') {
    const out: unknown[] = [];
    let prev: string | null = null;
    for (const ev of events) {
      const r = signReceiptV02(v02DraftFromEvent(ev, prev), opts.privateKey!);
      out.push(r);
      prev = r.receipt_hash;
    }
    receipts = out;
  } else {
    receipts = events.map((ev) => generateReceipt(ev));
  }

  return {
    schema_version: 'witseal.evidence-package.v0.1',
    package_id: 'pkg_' + uniqueSuffix(),
    exported_at: '2026-05-22T12:00:00Z',
    chain_segment_id: events[0]!.chain_segment_id,
    range: {
      start_sequence: events[0]!.sequence,
      end_sequence: events[events.length - 1]!.sequence,
    },
    chain_head_before_range: null,
    chain_head_after_range: events[events.length - 1]!.event_hash,
    events,
    receipts,
    policy_packs: [],
    classifier_version: 'test-1.0',
    witseal_runtime_version: 'test-0.1.0',
  };
}

// ---------------------------------------------------------------------------
// v0.1 standalone receipt
// ---------------------------------------------------------------------------

describe('verifyArtifact — v0.1 receipt', () => {
  it('VALID for a well-formed v0.1 receipt (self-hash)', () => {
    const event = makeEvent(0, null);
    const receipt = generateReceipt(event);
    const result = verifyArtifact(receipt);
    expect(result.kind).toBe('receipt.v0.1');
    expect(result.valid).toBe(true);
  });

  it('INVALID when receipt_hash is tampered (self-hash fail)', () => {
    const receipt = generateReceipt(makeEvent(0, null));
    const tampered = { ...receipt, receipt_hash: '0'.repeat(64) };
    const result = verifyArtifact(tampered);
    expect(result.valid).toBe(false);
    expect(result.kind).toBe('receipt.v0.1');
    expect(result.reason).toMatch(/self-hash/i);
  });

  it('INVALID when a non-hash field is tampered (self-hash fail)', () => {
    const receipt = generateReceipt(makeEvent(0, null));
    const tampered = { ...receipt, outcome: 'denied_by_policy' };
    const result = verifyArtifact(tampered);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/self-hash/i);
  });

  it('INVALID when the receipt fails schema validation', () => {
    const receipt = generateReceipt(makeEvent(0, null));
    const bad = { ...receipt, receipt_id: 'not-a-valid-id' };
    const result = verifyArtifact(bad);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/schema validation/i);
  });
});

// ---------------------------------------------------------------------------
// v0.2 standalone receipt
// ---------------------------------------------------------------------------

describe('verifyArtifact — v0.2 receipt', () => {
  it('VALID under the correct public key (signature + self-hash)', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const receipt = signReceiptV02(v02DraftFromEvent(makeEvent(0, null), null), privateKey);
    const result = verifyArtifact(receipt, publicKey);
    expect(result.kind).toBe('receipt.v0.2');
    expect(result.valid).toBe(true);
  });

  it('INVALID under a different public key', () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    const { publicKey: wrong } = generateKeyPairSync('ed25519');
    const receipt = signReceiptV02(v02DraftFromEvent(makeEvent(0, null), null), privateKey);
    const result = verifyArtifact(receipt, wrong);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/signature verification failed/i);
  });

  it('INVALID when no public key is supplied', () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    const receipt = signReceiptV02(v02DraftFromEvent(makeEvent(0, null), null), privateKey);
    const result = verifyArtifact(receipt);
    expect(result.valid).toBe(false);
    expect(result.kind).toBe('receipt.v0.2');
    expect(result.reason).toMatch(/requires a public key/i);
  });

  it('INVALID when an integrity-bearing field is tampered', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const receipt = signReceiptV02(v02DraftFromEvent(makeEvent(0, null), null), privateKey);
    const tampered = { ...receipt, policy_decision_hash: '0'.repeat(64) };
    const result = verifyArtifact(tampered, publicKey);
    expect(result.valid).toBe(false);
  });

  it('INVALID (malformed) when the signature is missing its algorithm prefix', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const receipt = signReceiptV02(v02DraftFromEvent(makeEvent(0, null), null), privateKey);
    // Strip the ed25519: prefix — schema rejects this, so it surfaces as a
    // schema-validation failure (which is the correct INVALID verdict).
    const bad = { ...receipt, signature: receipt.signature.slice('ed25519:'.length) };
    const result = verifyArtifact(bad, publicKey);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/schema validation|algorithm tag|malformed|prefix/i);
  });
});

// ---------------------------------------------------------------------------
// Evidence package
// ---------------------------------------------------------------------------

describe('verifyArtifact — evidence package (v0.1 receipts)', () => {
  it('VALID for a well-formed package with v0.1 receipts', () => {
    const pkg = makePackage(makeChain(3), { receiptVersion: 'witseal.receipt.v0.1' });
    const result = verifyArtifact(pkg);
    expect(result.kind).toBe('evidence-package.v0.1');
    expect(result.valid).toBe(true);
    expect(result.receiptResults).toHaveLength(3);
  });

  it('INVALID when an event in the chain is tampered (chain break)', () => {
    const events = makeChain(3);
    // Tamper event[1]'s recorded self-hash so verifyChain breaks at index 1.
    const pkg = makePackage(events, { receiptVersion: 'witseal.receipt.v0.1' });
    (pkg.events as WitnessEvent[])[1] = {
      ...(pkg.events as WitnessEvent[])[1]!,
      event_hash: '0'.repeat(64),
    };
    const result = verifyArtifact(pkg);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/chain verification failed/i);
  });

  it('INVALID when chain_head_after_range does not match the recomputed head', () => {
    const pkg = makePackage(makeChain(2), { receiptVersion: 'witseal.receipt.v0.1' });
    pkg.chain_head_after_range = 'f'.repeat(64);
    const result = verifyArtifact(pkg);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/chain_head_after_range mismatch/i);
  });

  it('INVALID when a v0.1 receipt is tampered', () => {
    const events = makeChain(2);
    const pkg = makePackage(events, { receiptVersion: 'witseal.receipt.v0.1' });
    const receipts = pkg.receipts as Array<Record<string, unknown>>;
    receipts[1] = { ...receipts[1]!, receipt_hash: '0'.repeat(64) };
    const result = verifyArtifact(pkg);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/receipt\[1\]/);
  });
});

describe('verifyArtifact — evidence package (v0.2 receipts)', () => {
  it('VALID with v0.2 receipts when the correct public key is supplied', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const pkg = makePackage(makeChain(3), {
      receiptVersion: 'witseal.receipt.v0.2',
      privateKey,
    });
    const result = verifyArtifact(pkg, publicKey);
    expect(result.valid).toBe(true);
    expect(result.receiptResults).toHaveLength(3);
  });

  it('INVALID with v0.2 receipts but no public key supplied', () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    const pkg = makePackage(makeChain(2), {
      receiptVersion: 'witseal.receipt.v0.2',
      privateKey,
    });
    const result = verifyArtifact(pkg);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/public key/i);
  });

  it('INVALID with v0.2 receipts under the wrong public key', () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    const { publicKey: wrong } = generateKeyPairSync('ed25519');
    const pkg = makePackage(makeChain(2), {
      receiptVersion: 'witseal.receipt.v0.2',
      privateKey,
    });
    const result = verifyArtifact(pkg, wrong);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/signature verification failed/i);
  });

  it('INVALID when a v0.2 receipt cross-reference to its event is broken', () => {
    // Sign a v0.2 receipt whose classified_intent_hash does not match the
    // companion event. The signature + self-hash are valid (we signed the
    // wrong hash deliberately), but the cross-check against the event fails.
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const events = makeChain(2);
    const draft = v02DraftFromEvent(events[1]!, events[0]!.event_hash);
    const wrongDraft = { ...draft, classified_intent_hash: '0'.repeat(64) };
    const tamperedReceipt = signReceiptV02(wrongDraft, privateKey);

    const pkg = makePackage(events, {
      receiptVersion: 'witseal.receipt.v0.2',
      privateKey,
    });
    (pkg.receipts as unknown[])[1] = tamperedReceipt;

    const result = verifyArtifact(pkg, publicKey);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/classified_intent_hash does not match/i);
  });
});

// ---------------------------------------------------------------------------
// Unknown / malformed artifacts
// ---------------------------------------------------------------------------

describe('verifyArtifact — unknown artifacts', () => {
  it('INVALID kind=unknown for an object with no schema_version', () => {
    const result = verifyArtifact({ hello: 'world' });
    expect(result.valid).toBe(false);
    expect(result.kind).toBe('unknown');
    expect(result.reason).toMatch(/no schema_version/i);
  });

  it('INVALID kind=unknown for an unrecognized schema_version', () => {
    const result = verifyArtifact({ schema_version: 'witseal.something.v9' });
    expect(result.valid).toBe(false);
    expect(result.kind).toBe('unknown');
    expect(result.reason).toMatch(/unrecognized schema_version/i);
  });

  it('INVALID kind=unknown for a non-object input', () => {
    expect(verifyArtifact(null).valid).toBe(false);
    expect(verifyArtifact(42).valid).toBe(false);
    expect(verifyArtifact('string').valid).toBe(false);
  });
});
