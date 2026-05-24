/**
 * P1-7 — Identity strictness (fallback identifier is marked in evidence).
 *
 * Runtime-boundary audit 2026-05-25 finding TS-P1-7: default `--agent`
 * value `cli-user` and approval principal default `unknown` were
 * indistinguishable from a real configured identity. Per PdM decision
 * 2026-05-25, fallback identity is allowed only if visibly marked in
 * evidence/receipt; CI/agent integrations require stable configured IDs.
 *
 * Fix landed in src/cli/index.ts and src/cli/approval.ts:
 *   - CLI `--agent` default → `'fallback:cli-default'`
 *   - approval CI principal default → `'fallback:ci-default'`
 *   - approval TTY principal default (no $USER/$LOGNAME) →
 *     `'fallback:no-user-env'`
 *
 * Convention: any identifier with the literal `fallback:` prefix
 * indicates the runtime fell back to a default rather than carrying a
 * configured identity. Evidence consumers can grep on the prefix.
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

describe('P1-7 — agent identifier fallback marker (witness event)', () => {
  it('persists the fallback marker when runExec is called with the CLI default agentId', async () => {
    writeAllowPack();
    const out = silenceOutput();
    try {
      // Simulates: `witseal exec /bin/echo hi` with NO --agent flag (CLI
      // parser would pass the default literal `fallback:cli-default`).
      await runExec({
        command: '/bin/echo',
        args: ['hi'],
        agentId: 'fallback:cli-default',
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
    expect(events[0]!.agent_identifier).toBe('fallback:cli-default');
    expect(events[0]!.agent_identifier.startsWith('fallback:')).toBe(true);
    expect(events[1]!.agent_identifier).toBe('fallback:cli-default');
  });

  it('persists the operator-configured agentId verbatim (no fallback marker)', async () => {
    writeAllowPack();
    const out = silenceOutput();
    try {
      await runExec({
        command: '/bin/echo',
        args: ['hi'],
        agentId: 'observability-agent-prod-7',
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
    expect(events[0]!.agent_identifier.startsWith('fallback:')).toBe(false);
    expect(events[1]!.agent_identifier).toBe('observability-agent-prod-7');
  });
});

describe('P1-7 — approval CI principal fallback', () => {
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

  it('CI principal carries fallback marker when WITSEAL_CI_PRINCIPAL is unset', async () => {
    const record = await obtainApproval(fakeIntent(), fakeDecision());
    expect(record.principal.type).toBe('ci');
    expect(record.principal.identifier).toBe('fallback:ci-default');
    expect(record.principal.identifier.startsWith('fallback:')).toBe(true);
  });

  it('CI principal carries the configured value verbatim when WITSEAL_CI_PRINCIPAL is set', async () => {
    process.env['WITSEAL_CI_PRINCIPAL'] = 'github-actions-runner-42';
    const record = await obtainApproval(fakeIntent(), fakeDecision());
    expect(record.principal.identifier).toBe('github-actions-runner-42');
    expect(record.principal.identifier.startsWith('fallback:')).toBe(false);
  });

  it('CI principal treats empty string as fallback (not a real identity)', async () => {
    process.env['WITSEAL_CI_PRINCIPAL'] = '';
    const record = await obtainApproval(fakeIntent(), fakeDecision());
    expect(record.principal.identifier).toBe('fallback:ci-default');
  });
});
