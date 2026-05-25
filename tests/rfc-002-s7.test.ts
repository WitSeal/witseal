/**
 * RFC-002 §7 — schema-additions lockstep test suite.
 *
 * §7.1 placement guard:
 *   `no_policy_configured` is a valid WitnessOutcome but MUST NOT be a
 *   valid policy rule decision or pack default_decision value. The policy
 *   schema enforces this by limiting its decision enum to
 *   ['allow', 'deny', 'require-approval'].
 *
 * §7.2 identity_origin:
 *   `IdentityOriginSchema` ('configured'|'fallback') added to
 *   ApprovalPrincipalSchema and WitnessEventSchema.identity_origin.
 *   Optional, non-nullable. Omitted-when-absent (JCS byte-identity preserved).
 *
 * §7.3 operation_id:
 *   Confirmatory — field already shipped (P1-8). Validates it is still
 *   present and optional on WitnessEventSchema.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  WitnessOutcomeSchema,
  WitnessEventSchema,
} from '../schemas/witness-event.schema.js';
import {
  PolicyDecisionSchema,
  PolicyPackSchema,
  PolicyRuleSchema,
} from '../schemas/policy.schema.js';
import {
  ApprovalPrincipalSchema,
  ApprovalRecordSchema,
  IdentityOriginSchema,
} from '../schemas/approval.schema.js';
import { canonicalize } from '../src/integrity/hash-chain.js';

// ---------------------------------------------------------------------------
// §7.1 — no_policy_configured placement guard
// ---------------------------------------------------------------------------

describe('RFC-002 §7.1 — no_policy_configured placement guard', () => {
  it('WitnessOutcomeSchema accepts no_policy_configured', () => {
    expect(() => WitnessOutcomeSchema.parse('no_policy_configured')).not.toThrow();
    expect(WitnessOutcomeSchema.parse('no_policy_configured')).toBe('no_policy_configured');
  });

  it('PolicyDecisionSchema.outcome does NOT accept no_policy_configured', () => {
    const result = PolicyDecisionSchema.safeParse({
      schema_version: 'witseal.policy.v0.1',
      outcome: 'no_policy_configured',
      matched_rule: null,
      reason: 'should fail',
      active_pack_hashes: [],
    });
    expect(result.success).toBe(false);
  });

  it('PolicyRuleSchema.decision does NOT accept no_policy_configured', () => {
    const result = PolicyRuleSchema.safeParse({
      id: 'r1',
      match: { action_type: 'shell_command' },
      decision: 'no_policy_configured',
      reason: 'should fail',
    });
    expect(result.success).toBe(false);
  });

  it('PolicyPackSchema.default_decision does NOT accept no_policy_configured', () => {
    const result = PolicyPackSchema.safeParse({
      schema_version: 'witseal.policy.v0.1',
      pack_id: 'test-pack',
      version: '1.0.0',
      description: 'guard test',
      rules: [],
      default_decision: 'no_policy_configured',
    });
    expect(result.success).toBe(false);
  });

  it('PolicyDecisionSchema accepts all valid decision values', () => {
    for (const outcome of ['allow', 'deny', 'require-approval'] as const) {
      expect(() =>
        PolicyDecisionSchema.parse({
          schema_version: 'witseal.policy.v0.1',
          outcome,
          matched_rule: null,
          reason: 'ok',
          active_pack_hashes: [],
        })
      ).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// §7.2 — identity_origin schema contract
// ---------------------------------------------------------------------------

describe('RFC-002 §7.2 — IdentityOriginSchema contract', () => {
  it('accepts configured and fallback', () => {
    expect(IdentityOriginSchema.parse('configured')).toBe('configured');
    expect(IdentityOriginSchema.parse('fallback')).toBe('fallback');
  });

  it('rejects unknown values', () => {
    expect(IdentityOriginSchema.safeParse('unknown').success).toBe(false);
    expect(IdentityOriginSchema.safeParse('').success).toBe(false);
    expect(IdentityOriginSchema.safeParse(null).success).toBe(false);
  });
});

describe('RFC-002 §7.2 — ApprovalPrincipalSchema identity_origin', () => {
  it('accepts principal without identity_origin (optional, backward-compat)', () => {
    const result = ApprovalPrincipalSchema.safeParse({
      type: 'ci',
      identifier: 'some-agent',
    });
    expect(result.success).toBe(true);
    expect(result.data?.identity_origin).toBeUndefined();
  });

  it('accepts principal with identity_origin=configured', () => {
    const result = ApprovalPrincipalSchema.parse({
      type: 'ci',
      identifier: 'github-actions-prod',
      identity_origin: 'configured',
    });
    expect(result.identity_origin).toBe('configured');
  });

  it('accepts principal with identity_origin=fallback', () => {
    const result = ApprovalPrincipalSchema.parse({
      type: 'human',
      identifier: 'no-user-env',
      identity_origin: 'fallback',
    });
    expect(result.identity_origin).toBe('fallback');
  });

  it('rejects identity_origin=null (non-nullable by spec)', () => {
    const result = ApprovalPrincipalSchema.safeParse({
      type: 'ci',
      identifier: 'x',
      identity_origin: null,
    });
    expect(result.success).toBe(false);
  });
});

describe('RFC-002 §7.2 — WitnessEventSchema identity_origin', () => {
  // Minimal valid witness event fixture for schema validation.
  function makeEventPayload(extra: Record<string, unknown> = {}): Record<string, unknown> {
    const base = {
      schema_version: 'witseal.witness.v0.1',
      event_id: 'evt_s7testAAAAAAAAAAAAAAAA',
      chain_segment_id: 'default',
      sequence: 0,
      timestamp: '2026-05-26T12:00:00Z',
      previous_event_hash: null,
      event_hash: 'a'.repeat(64),
      originating_node: 'test-node',
      agent_identifier: 'test-agent',
      classified_intent: {
        schema_version: 'witseal.intent.v0.1',
        intent_id: 'int_s7testAAAAAAAAAAAAAAAA',
        intent: {
          action_type: 'shell_command',
          executable: '/bin/echo',
          args: ['hi'],
          cwd: '/tmp',
          use_tty: false,
        },
        risk_class: 'C0',
        classification_reasons: ['informational'],
        classifier_version: 's7-test-1.0',
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
      receipt_id: 'rcpt_s7testAAAAAAAAAAAAAAAA',
      versions: {
        witseal_runtime: '0.1.0-pre',
        classifier: 's7-test-1.0',
        schema: 'witseal.witness.v0.1',
      },
    };
    return { ...base, ...extra };
  }

  it('accepts event without identity_origin (optional, backward-compat)', () => {
    const result = WitnessEventSchema.safeParse(makeEventPayload());
    expect(result.success).toBe(true);
    expect(result.data?.identity_origin).toBeUndefined();
  });

  it('accepts event with identity_origin=configured', () => {
    const result = WitnessEventSchema.safeParse(
      makeEventPayload({ identity_origin: 'configured' })
    );
    expect(result.success).toBe(true);
    expect(result.data?.identity_origin).toBe('configured');
  });

  it('accepts event with identity_origin=fallback', () => {
    const result = WitnessEventSchema.safeParse(
      makeEventPayload({ identity_origin: 'fallback' })
    );
    expect(result.success).toBe(true);
    expect(result.data?.identity_origin).toBe('fallback');
  });

  it('rejects identity_origin=null (non-nullable by spec)', () => {
    const result = WitnessEventSchema.safeParse(
      makeEventPayload({ identity_origin: null })
    );
    expect(result.success).toBe(false);
  });

  it('rejects identity_origin with an unknown value', () => {
    const result = WitnessEventSchema.safeParse(
      makeEventPayload({ identity_origin: 'unknown-origin' })
    );
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §7.2 — JCS byte-identity for identity_origin field
// ---------------------------------------------------------------------------

describe('RFC-002 §7.2 — JCS byte-identity for identity_origin', () => {
  it('event without identity_origin has identical canonical bytes to pre-§7.2 representation', () => {
    // Two events with the same fields, one with identity_origin=undefined
    // (correctly omitted) and one without the key at all, must produce
    // identical canonical bytes. This confirms the omit-when-absent
    // discipline is preserved.
    const withoutField = { agent_identifier: 'agent-a', outcome: 'allowed_executed' };
    const withUndefined = { agent_identifier: 'agent-a', outcome: 'allowed_executed', identity_origin: undefined };
    // identity_origin: undefined must NOT appear in canonical output.
    expect(canonicalize(withoutField)).toEqual(canonicalize(withUndefined));
    const canonical = canonicalize(withUndefined);
    expect(canonical.toString()).not.toContain('identity_origin');
  });

  it('event with identity_origin=fallback serializes the field in JCS key order', () => {
    // JCS sorts keys alphabetically. 'identity_origin' (i) comes after
    // 'agent_identifier' (a) but before 'outcome' (o).
    const obj = {
      agent_identifier: 'agent-a',
      identity_origin: 'fallback',
      outcome: 'allowed_executed',
    };
    const canonical = canonicalize(obj).toString();
    expect(canonical).toContain('"identity_origin":"fallback"');
    // Verify JCS ordering: agent_identifier before identity_origin before outcome.
    const aiPos = canonical.indexOf('"agent_identifier"');
    const ioPos = canonical.indexOf('"identity_origin"');
    const outPos = canonical.indexOf('"outcome"');
    expect(aiPos).toBeLessThan(ioPos);
    expect(ioPos).toBeLessThan(outPos);
  });
});

// ---------------------------------------------------------------------------
// §7.3 — operation_id confirmatory
// ---------------------------------------------------------------------------

describe('RFC-002 §7.3 — operation_id confirmatory (already shipped P1-8)', () => {
  it('WitnessEventSchema has operation_id as optional, non-nullable string field', () => {
    const shape = WitnessEventSchema.shape;
    // Confirm the field exists on the schema.
    expect(shape.operation_id).toBeDefined();
    // Optional — absent is valid.
    const withoutOpId = WitnessEventSchema.safeParse({
      schema_version: 'witseal.witness.v0.1',
      event_id: 'evt_s73testAAAAAAAAAAAABA',
      chain_segment_id: 'default',
      sequence: 0,
      timestamp: '2026-05-26T12:00:00Z',
      previous_event_hash: null,
      event_hash: 'b'.repeat(64),
      originating_node: 'local',
      agent_identifier: 'a',
      classified_intent: {
        schema_version: 'witseal.intent.v0.1',
        intent_id: 'int_s73testAAAAAAAAAAAABA',
        intent: { action_type: 'shell_command', executable: '/bin/echo', args: [], cwd: '/tmp', use_tty: false },
        risk_class: 'C0',
        classification_reasons: [],
        classifier_version: 'x',
      },
      policy_decision: { schema_version: 'witseal.policy.v0.1', outcome: 'allow', matched_rule: null, reason: 'ok', active_pack_hashes: [] },
      approval: null,
      execution_result: null,
      outcome: 'allowed_executed',
      receipt_id: 'rcpt_s73testAAAAAAAAAAAABA',
      versions: { witseal_runtime: '0.1.0-pre', classifier: 'x', schema: 'witseal.witness.v0.1' },
    });
    expect(withoutOpId.success).toBe(true);
    expect(withoutOpId.data?.operation_id).toBeUndefined();
  });

  it('WitnessEventSchema accepts operation_id as a non-empty string', () => {
    // Minimal safe-to-parse via type check on the shape directly.
    const opIdShape = WitnessEventSchema.shape.operation_id;
    // Unwrap optional → should be a ZodString
    const inner = (opIdShape as z.ZodOptional<z.ZodString>).unwrap();
    expect(inner.parse('op-id-value')).toBe('op-id-value');
    expect(inner.safeParse('').success).toBe(false); // min(1)
  });

  it('operation_id is non-nullable (null rejected)', () => {
    const opIdShape = WitnessEventSchema.shape.operation_id;
    // ZodOptional wraps a ZodString; null is not a valid optional-string value.
    expect(opIdShape.safeParse(null).success).toBe(false);
  });
});
