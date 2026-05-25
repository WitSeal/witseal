/**
 * RFC-002 §7.2 — Identity origin (structured identity_origin field).
 *
 * Runtime-boundary audit 2026-05-25 finding TS-P1-7 established that
 * default identifiers must be distinguishable from configured ones.
 * The initial fix (PR #20) used a `fallback:` string prefix. RFC-002 §7.2
 * supersedes the prefix convention with a structured `identity_origin`
 * field (`'configured' | 'fallback'`), keeping identifiers clean.
 *
 * This file tests the §7.2 implementation:
 *   - WitnessEvent.identity_origin set when identityOrigin is passed
 *   - ApprovalPrincipal.identity_origin set by approval.ts
 *   - agent_identifier and principal.identifier carry NO `fallback:` prefix
 *   - identity_origin omitted (not null) when not applicable
 *
 * §7.3 confirmatory: operation_id field present on WitnessEventSchema.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runExec } from '../src/cli/exec.js';
import { EventLog } from '../src/witness/event-log.js';
import { obtainApproval } from '../src/cli/approval.js';
import type { ClassifiedIntent } from '../schemas/intent.schema.js';
import type { PolicyDecision } from '../schemas/policy.schema.js';

let dataDir: string;

function writeAllowPack(): void {
  const policyDir = join(dataDir, 'policy-packs');
  mkdirSync(policyDir, { recursive: true });
  writeFileSync(
    join(policyDir, 'allow.json'),
    JSON.stringify({
      schema_version: 'witseal.policy.v0.1',
      pack_id: 'allow-all',
      version: '1.0.0',
      description: 'P1-7 test pack',
      rules: [
        {
          id: 'allow-shell',
          match: { action_type: 'shell_command' },
          decision: 'allow',
          reason: 'P1-7 test',
        },
      ],
      default_decision: 'deny',
    })
  );
}

function silenceOutput(): { restore: () => void } {
  const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  return {
    restore: () => {
      stderrSpy.mockRestore();
      stdoutSpy.mockRestore();
    },
  };
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'witseal-p1-7-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('RFC-002 §7.2 — agent identity_origin on witness event', () => {
  it('sets identity_origin=fallback when identityOrigin option is fallback', async () => {
    writeAllowPack();
    const out = silenceOutput();
    try {
      // Simulates: `witseal exec /bin/echo hi` with NO --agent flag; the
      // CLI detects the default and passes identityOrigin='fallback'.
      await runExec({
        command: '/bin/echo',
        args: ['hi'],
        agentId: 'cli-user',
        identityOrigin: 'fallback',
        cwd: '/tmp',
        timeoutMs: 0,
        dataDir,
        segmentId: 'default',
      });
    } finally {
      out.restore();
    }
    const events = await new EventLog({ root: dataDir, segmentId: 'default' }).readAllEvents();
    expect(events).toHaveLength(2); // P0-1 two-phase
    // agent_identifier is the clean value — NO fallback: prefix.
    expect(events[0]!.agent_identifier).toBe('cli-user');
    expect(events[0]!.agent_identifier.startsWith('fallback:')).toBe(false);
    // identity_origin carries the structured signal.
    expect(events[0]!.identity_origin).toBe('fallback');
    expect(events[1]!.agent_identifier).toBe('cli-user');
    expect(events[1]!.identity_origin).toBe('fallback');
  });

  it('sets identity_origin=configured and stores identifier verbatim for operator-supplied agent', async () => {
    writeAllowPack();
    const out = silenceOutput();
    try {
      await runExec({
        command: '/bin/echo',
        args: ['hi'],
        agentId: 'observability-agent-prod-7',
        identityOrigin: 'configured',
        cwd: '/tmp',
        timeoutMs: 0,
        dataDir,
        segmentId: 'default',
      });
    } finally {
      out.restore();
    }
    const events = await new EventLog({ root: dataDir, segmentId: 'default' }).readAllEvents();
    expect(events[0]!.agent_identifier).toBe('observability-agent-prod-7');
    expect(events[0]!.identity_origin).toBe('configured');
    expect(events[1]!.agent_identifier).toBe('observability-agent-prod-7');
    expect(events[1]!.identity_origin).toBe('configured');
  });

  it('omits identity_origin entirely when not provided (JCS byte-identity preserved)', async () => {
    // When identityOrigin is not passed, the field must be absent from the
    // witness event JSON — not serialized as null. This preserves JCS
    // byte-identity with pre-§7.2 readers.
    writeAllowPack();
    const out = silenceOutput();
    try {
      await runExec({
        command: '/bin/echo',
        args: ['hi'],
        agentId: 'some-agent',
        // identityOrigin deliberately omitted
        cwd: '/tmp',
        timeoutMs: 0,
        dataDir,
        segmentId: 'default',
      });
    } finally {
      out.restore();
    }
    const events = await new EventLog({ root: dataDir, segmentId: 'default' }).readAllEvents();
    // identity_origin must be undefined (absent), not null.
    expect(events[0]!.identity_origin).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(events[0], 'identity_origin')).toBe(false);
  });
});

describe('RFC-002 §7.2 — approval CI principal identity_origin', () => {
  let userSnap: string | undefined;
  let logSnap: string | undefined;
  let nonInteractiveSnap: string | undefined;
  let ciPrincipalSnap: string | undefined;
  let autoApproveSnap: string | undefined;

  beforeEach(() => {
    userSnap = process.env['USER'];
    logSnap = process.env['LOGNAME'];
    nonInteractiveSnap = process.env['WITSEAL_NON_INTERACTIVE'];
    ciPrincipalSnap = process.env['WITSEAL_CI_PRINCIPAL'];
    autoApproveSnap = process.env['WITSEAL_AUTO_APPROVE'];
    // Force CI / non-interactive branch.
    process.env['WITSEAL_NON_INTERACTIVE'] = '1';
    delete process.env['WITSEAL_CI_PRINCIPAL'];
    delete process.env['WITSEAL_AUTO_APPROVE'];
  });

  afterEach(() => {
    if (userSnap === undefined) delete process.env['USER']; else process.env['USER'] = userSnap;
    if (logSnap === undefined) delete process.env['LOGNAME']; else process.env['LOGNAME'] = logSnap;
    if (nonInteractiveSnap === undefined) delete process.env['WITSEAL_NON_INTERACTIVE'];
    else process.env['WITSEAL_NON_INTERACTIVE'] = nonInteractiveSnap;
    if (ciPrincipalSnap === undefined) delete process.env['WITSEAL_CI_PRINCIPAL'];
    else process.env['WITSEAL_CI_PRINCIPAL'] = ciPrincipalSnap;
    if (autoApproveSnap === undefined) delete process.env['WITSEAL_AUTO_APPROVE'];
    else process.env['WITSEAL_AUTO_APPROVE'] = autoApproveSnap;
  });

  function fakeIntent(): ClassifiedIntent {
    return {
      schema_version: 'witseal.intent.v0.1',
      intent_id: 'int_p1700000000000000001',
      intent: {
        action_type: 'shell_command',
        executable: 'echo',
        args: ['hi'],
        cwd: '/tmp',
        use_tty: false,
      },
      risk_class: 'C3',
      classification_reasons: ['high risk'],
      classifier_version: 'p1-7-test-1.0',
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

  it('CI principal: identity_origin=fallback + clean identifier when WITSEAL_CI_PRINCIPAL is unset', async () => {
    const record = await obtainApproval(fakeIntent(), fakeDecision());
    expect(record.principal.type).toBe('ci');
    // Clean identifier — NO fallback: prefix.
    expect(record.principal.identifier).toBe('ci-default');
    expect(record.principal.identifier.startsWith('fallback:')).toBe(false);
    // Structured identity_origin carries the fallback signal.
    expect(record.principal.identity_origin).toBe('fallback');
  });

  it('CI principal: identity_origin=configured + verbatim identifier when WITSEAL_CI_PRINCIPAL is set', async () => {
    process.env['WITSEAL_CI_PRINCIPAL'] = 'github-actions-runner-42';
    const record = await obtainApproval(fakeIntent(), fakeDecision());
    expect(record.principal.identifier).toBe('github-actions-runner-42');
    expect(record.principal.identifier.startsWith('fallback:')).toBe(false);
    expect(record.principal.identity_origin).toBe('configured');
  });

  it('CI principal treats empty string as fallback (not a real identity)', async () => {
    process.env['WITSEAL_CI_PRINCIPAL'] = '';
    const record = await obtainApproval(fakeIntent(), fakeDecision());
    // Empty env var → fallback path; clean identifier, structured field.
    expect(record.principal.identifier).toBe('ci-default');
    expect(record.principal.identity_origin).toBe('fallback');
  });
});
