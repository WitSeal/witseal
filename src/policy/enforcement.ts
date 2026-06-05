/**
 * Constraint contour — the separable enforcement layer over the witnessed-
 * execution core (the clean-seam product boundary).
 *
 * The evidence core (classify -> policy decision -> witness -> receipt ->
 * verify) runs in every mode and never blocks on its own. This module holds
 * the one decision the core does not make: given a recorded policy decision
 * and the execution mode, must execution be blocked?
 *
 * Constraint is by policy decision, not authorship: WitSeal blocks per an
 * externally-supplied policy decision; it does not author the policy or the
 * authority behind an action.
 *
 *   - Gate Mode (default, deny-by-default): a `deny` decision blocks execution.
 *   - Witness Mode: never blocks; the policy decision is recorded as evidence
 *     but not enforced.
 *
 * Pure function, no I/O. The `require-approval` interactive flow and the
 * no-policy fail-closed path remain in `runExec` (pre-evaluation / interactive
 * concerns); this contour covers the policy-decision -> block mapping that
 * distinguishes Gate from Witness.
 *
 * The Witness execution path (acting on `block: false` to run an action the
 * policy would deny, recording a distinct `witnessed_executed` outcome) is
 * wired into `runExec` — see `computeOutcome` in `src/cli/exec.ts`, the
 * `mode === 'witness'` branch. This function stays the pure, mode-complete
 * policy-decision -> block mapping that the executor consumes.
 */

import type { PolicyDecision } from '../../schemas/policy.schema.js';

/** Execution mode selected per invocation. Gate is the default. */
export type ExecutionMode = 'gate' | 'witness';

export interface ConstraintResult {
  /** Whether execution must be blocked. Only Gate Mode blocks. */
  block: boolean;
  /** Reason for blocking; `null` when not blocking. */
  reason: string | null;
}

/**
 * Decide whether a policy decision blocks execution under the given mode.
 *
 * Gate Mode blocks a `deny` decision (deny-by-default). Witness Mode never
 * blocks — the decision is still recorded as evidence by the core, but the
 * constraint is not enforced.
 */
export function applyConstraint(
  decision: PolicyDecision,
  mode: ExecutionMode
): ConstraintResult {
  if (mode === 'witness') {
    // Witness Mode does not enforce: record, do not block.
    return { block: false, reason: null };
  }
  // Gate Mode (default).
  if (decision.outcome === 'deny') {
    return { block: true, reason: decision.reason };
  }
  return { block: false, reason: null };
}
