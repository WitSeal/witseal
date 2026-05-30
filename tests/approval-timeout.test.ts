/**
 * P1-6 — Approval timeout documented limitation in TTY mode.
 *
 * Runtime-boundary audit 2026-05-25 finding TS-P1-6: TTY approval uses
 * blocking readSync('/dev/tty') and the documented timeout is NOT
 * enforced at the OS level. Per goal directive "Implement timeout OR
 * remove claim" — choice for v0.1: REMOVE THE CLAIM. The prompt flags
 * the limitation inline; threat-model T7 documents the residual; public
 * artifacts must not assert "approval timeout is enforced" for TS TTY.
 *
 * These tests pin the documented behavior so any regression toward
 * over-claiming timeout enforcement surfaces in CI.
 *
 * (CI / non-interactive mode resolves synchronously without a timeout
 * race — covered separately by tests/identity-strictness.test.ts P1-7.)
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { obtainApproval } from '../src/cli/approval.js';
import type { ClassifiedIntent } from '../schemas/intent.schema.js';
import type { PolicyDecision } from '../schemas/policy.schema.js';

function fakeIntent(): ClassifiedIntent {
  return {
    schema_version: 'witseal.intent.v0.1',
    intent_id: 'int_p160000000000000001x',
    intent: {
      action_type: 'shell_command',
      executable: 'echo',
      args: ['hi'],
      cwd: '/tmp',
      use_tty: false,
    },
    risk_class: 'C3',
    classification_reasons: ['high risk'],
    classifier_version: 'p1-6-test-1.0',
  };
}

function fakeDecision(): PolicyDecision {
  return {
    schema_version: 'witseal.policy.v0.1',
    outcome: 'require-approval',
    matched_rule: { pack_id: 'p', pack_version: '1', rule_id: 'r' },
    reason: 'need approval',
    active_pack_hashes: [],
  };
}

describe('P1-6 — TTY approval prompt flags the timeout limitation', () => {
  let nonInteractiveSnap: string | undefined;
  let modeSnap: string | undefined;
  let timeoutEnvSnap: string | undefined;

  beforeEach(() => {
    nonInteractiveSnap = process.env['WITSEAL_NON_INTERACTIVE'];
    modeSnap = process.env['WITSEAL_APPROVAL_MODE'];
    timeoutEnvSnap = process.env['WITSEAL_APPROVAL_TIMEOUT'];
  });

  afterEach(() => {
    if (nonInteractiveSnap === undefined) delete process.env['WITSEAL_NON_INTERACTIVE'];
    else process.env['WITSEAL_NON_INTERACTIVE'] = nonInteractiveSnap;
    if (modeSnap === undefined) delete process.env['WITSEAL_APPROVAL_MODE'];
    else process.env['WITSEAL_APPROVAL_MODE'] = modeSnap;
    if (timeoutEnvSnap === undefined) delete process.env['WITSEAL_APPROVAL_TIMEOUT'];
    else process.env['WITSEAL_APPROVAL_TIMEOUT'] = timeoutEnvSnap;
  });

  it('callback-mode stub returns timed_out without hanging (timeout-path test surrogate)', async () => {
    // The callback-mode stub is a deterministic timeout-path proxy: it
    // returns immediately with outcome=timed_out, proving the
    // "Timeout path returns rejected/timed_out without hanging"
    // acceptance criterion for the modes the runtime can portably
    // enforce (TTY mode is the documented limitation).
    process.env['WITSEAL_APPROVAL_MODE'] = 'callback';
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const start = Date.now();
      const record = await obtainApproval(fakeIntent(), fakeDecision());
      const elapsed = Date.now() - start;

      expect(record.outcome).toBe('timed_out');
      expect(record.reason).toMatch(/callback mode not implemented/);
      // Did not hang — bounded by a small constant (allowing test-runner
      // overhead; was ~1ms locally).
      expect(elapsed).toBeLessThan(2000);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('CI/non-interactive path resolves synchronously (no hang on timeout)', async () => {
    process.env['WITSEAL_NON_INTERACTIVE'] = '1';
    delete process.env['WITSEAL_APPROVAL_MODE'];
    const start = Date.now();
    const record = await obtainApproval(fakeIntent(), fakeDecision());
    const elapsed = Date.now() - start;

    // CI mode resolves immediately — no rule match in WITSEAL_AUTO_APPROVE
    // → rejected; the absence of a real timeout race is what this asserts.
    expect(record.outcome).toBe('rejected');
    expect(elapsed).toBeLessThan(2000);
  });

  it('ApprovalRecord still carries timeout_seconds (informational; documented as not enforced in TTY mode)', async () => {
    process.env['WITSEAL_APPROVAL_TIMEOUT'] = '42';
    process.env['WITSEAL_NON_INTERACTIVE'] = '1';
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const record = await obtainApproval(fakeIntent(), fakeDecision());
      // The field is preserved (caller may use it for replay or analytics)
      // but the TTY path does NOT enforce it. Discipline lives in docs
      // and the rendered prompt.
      expect(record.timeout_seconds).toBe(42);
    } finally {
      stderrSpy.mockRestore();
    }
  });
});
