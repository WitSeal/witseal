/**
 * Constraint contour unit tests (clean-seam product boundary).
 *
 * `applyConstraint` is the one decision the evidence core does not make:
 * given a policy decision and the execution mode, must execution be blocked?
 * Gate Mode blocks a `deny` (deny-by-default); Witness Mode never blocks.
 */
import { describe, it, expect } from 'vitest';
import { applyConstraint } from '../src/policy/enforcement.js';
import type { PolicyDecision } from '../schemas/policy.schema.js';

function decision(outcome: 'allow' | 'deny' | 'require-approval'): PolicyDecision {
  return {
    schema_version: 'witseal.policy.v0.1',
    outcome,
    matched_rule: null,
    reason: `reason-${outcome}`,
    active_pack_hashes: [],
  };
}

describe('applyConstraint — constraint contour', () => {
  it('Gate Mode blocks a deny decision (deny-by-default)', () => {
    expect(applyConstraint(decision('deny'), 'gate')).toEqual({
      block: true,
      reason: 'reason-deny',
    });
  });

  it('Gate Mode does not block allow or require-approval', () => {
    expect(applyConstraint(decision('allow'), 'gate').block).toBe(false);
    expect(applyConstraint(decision('require-approval'), 'gate').block).toBe(false);
  });

  it('Witness Mode never blocks — records, does not enforce', () => {
    expect(applyConstraint(decision('deny'), 'witness')).toEqual({
      block: false,
      reason: null,
    });
    expect(applyConstraint(decision('allow'), 'witness').block).toBe(false);
    expect(applyConstraint(decision('require-approval'), 'witness').block).toBe(false);
  });
});
