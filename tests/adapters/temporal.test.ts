/**
 * Temporal adapter — Level 3 (witnessedShell Activity) + Level 2 (witness
 * interceptor).
 *
 * Level 3: an Activity that own-executes through witseal. It must pass an
 * allowed action through the pipeline, block a denied action (Gate,
 * deny-by-default), never produce a side effect on denial, and capture output —
 * yielding a full execution receipt. Correlation with Temporal identifiers is
 * carried in `agent_identifier`, not a new receipt field.
 *
 * Level 2: an interceptor that OBSERVES an Activity it does not own. It must
 * record the observed result, never execute the command itself, always return
 * the activity's result, and re-throw the activity's error.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  witnessedShell,
  temporalAgentId,
  recordActivityWitness,
  WitnessActivityInbound,
  WITSEAL_DENIED_EXIT,
} from '../../src/adapters/temporal/index.js';
import { EventLog } from '../../src/witness/event-log.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'witseal-temporal-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writePack(rules: unknown[], defaultDecision: 'allow' | 'deny' = 'allow'): void {
  const packDir = join(dir, 'policy-packs');
  mkdirSync(packDir, { recursive: true });
  writeFileSync(
    join(packDir, 'temporal-rule.json'),
    JSON.stringify({
      schema_version: 'witseal.policy.v0.1',
      pack_id: 'temporal-rule',
      version: '1.0.0',
      description: 'test: temporal adapter rules',
      rules,
      default_decision: defaultDecision,
    })
  );
}

async function events() {
  return new EventLog({ root: dir, segmentId: 'default' }).readAllEvents();
}

describe('Temporal adapter — witnessedShell (Level 3)', () => {
  it('passes an allowed action through witseal and captures output (allowed_executed)', async () => {
    writePack([], 'allow');
    const res = await witnessedShell({ command: 'echo hello' }, { dataDir: dir });
    expect(res.exitCode).toBe(0);
    expect(res.denied).toBe(false);
    expect(res.output).toContain('hello');
    const evs = await events();
    const last = evs[evs.length - 1]!;
    expect(last.outcome).toBe('allowed_executed');
    expect(last.execution_result).not.toBeNull();
    // Default identity when no info/agentId supplied.
    expect(last.agent_identifier).toBe('temporal-activity');
  }, 20_000);

  it('blocks a denied action (Gate) and produces no side effect', async () => {
    const target = join(dir, 'should-not-exist.txt');
    writePack(
      [{ id: 'deny-touch', match: { command_matches: 'touch' }, decision: 'deny', reason: 'touch denied (test)' }],
      'allow'
    );
    const res = await witnessedShell({ command: `touch ${target}` }, { dataDir: dir });
    expect(res.exitCode).toBe(WITSEAL_DENIED_EXIT);
    expect(res.denied).toBe(true);
    expect(existsSync(target)).toBe(false);
    const evs = await events();
    expect(evs.some((e) => e.outcome === 'denied_by_policy')).toBe(true);
  }, 20_000);

  it('never bypasses witseal: with no policy pack it fails closed (deny-by-default)', async () => {
    const target = join(dir, 'no-policy-target.txt');
    const res = await witnessedShell({ command: `touch ${target}` }, { dataDir: dir });
    expect(res.exitCode).toBe(WITSEAL_DENIED_EXIT);
    expect(res.denied).toBe(true);
    expect(existsSync(target)).toBe(false);
  }, 20_000);

  it('correlates via agent_identifier from Activity info (no new receipt field)', async () => {
    writePack([], 'allow');
    await witnessedShell(
      { command: 'echo correlated' },
      { dataDir: dir, info: { workflowExecution: { workflowId: 'wf-1' }, activityType: 'shell' } }
    );
    const evs = await events();
    expect(evs[evs.length - 1]!.agent_identifier).toBe('temporal:wf-1/shell');
  }, 20_000);
});

describe('Temporal adapter — temporalAgentId', () => {
  it('defaults to temporal-activity when no info', () => {
    expect(temporalAgentId()).toBe('temporal-activity');
    expect(temporalAgentId({})).toBe('temporal-activity');
  });
  it('builds temporal:<workflowId>/<activityType>', () => {
    expect(
      temporalAgentId({ workflowExecution: { workflowId: 'wf-9' }, activityType: 'runJob' })
    ).toBe('temporal:wf-9/runJob');
  });
  it('omits missing parts', () => {
    expect(temporalAgentId({ activityType: 'runJob' })).toBe('temporal:runJob');
    expect(temporalAgentId({ workflowExecution: { workflowId: 'wf-9' } })).toBe('temporal:wf-9');
  });
});

describe('Temporal adapter — recordActivityWitness (Level 2 core)', () => {
  it('records an observed success as allowed_executed with the observed result', async () => {
    writePack([], 'allow');
    await recordActivityWitness(
      { command: 'echo hi', exitCode: 0, stdout: 'hi\n' },
      { dataDir: dir, agentId: 'temporal-test' }
    );
    const evs = await events();
    const last = evs[evs.length - 1]!;
    expect(last.outcome).toBe('allowed_executed');
    expect(last.execution_result).not.toBeNull();
    expect(last.execution_result!.exit_code).toBe(0);
    expect(last.execution_result!.stdout.head).toBe('hi\n');
    expect(last.agent_identifier).toBe('temporal-test');
  });

  it('OBSERVES, does not execute: a touch observation creates no file', async () => {
    writePack([], 'allow');
    const target = join(dir, 'must-not-be-created.txt');
    await recordActivityWitness({ command: `touch ${target}`, exitCode: 0 }, { dataDir: dir });
    expect(existsSync(target)).toBe(false);
  });

  it('records a policy-deny observation as witnessed_executed (never denied_by_policy)', async () => {
    writePack(
      [{ id: 'deny-rm', match: { command_matches: 'rm ' }, decision: 'deny', reason: 'rm denied (test)' }],
      'allow'
    );
    await recordActivityWitness({ command: 'rm -rf /tmp/x', exitCode: 0 }, { dataDir: dir });
    const evs = await events();
    expect(evs[evs.length - 1]!.outcome).toBe('witnessed_executed');
    expect(evs.some((e) => e.outcome === 'denied_by_policy')).toBe(false);
  });

  it('folds Activity info into agent_identifier', async () => {
    writePack([], 'allow');
    await recordActivityWitness(
      { command: 'echo x', exitCode: 0 },
      { dataDir: dir, info: { workflowExecution: { workflowId: 'wf-2' }, activityType: 'obs' } }
    );
    expect((await events())[0]!.agent_identifier).toBe('temporal:wf-2/obs');
  });
});

describe('Temporal adapter — WitnessActivityInbound (interceptor)', () => {
  it('calls next, returns the activity result, and records the observed outcome', async () => {
    writePack([], 'allow');
    const interceptor = new WitnessActivityInbound({
      dataDir: dir,
      extract: (args, result) => {
        const r = (result ?? {}) as { exitCode?: number; stdout?: string };
        return { command: String(args[0] ?? ''), exitCode: r.exitCode ?? 0, stdout: r.stdout };
      },
    });
    let ran = false;
    const next = async (): Promise<unknown> => {
      ran = true;
      return { exitCode: 0, stdout: 'observed\n' };
    };
    const result = (await interceptor.execute({ args: ['echo observed'] }, next)) as {
      exitCode: number;
    };
    expect(ran).toBe(true);
    expect(result.exitCode).toBe(0);
    const evs = await events();
    expect(evs.length).toBe(1);
    expect(evs[0]!.execution_result!.stdout.head).toBe('observed\n');
    expect(evs[0]!.outcome).toBe('allowed_executed');
  });

  it('records nothing when the extractor returns undefined', async () => {
    writePack([], 'allow');
    const interceptor = new WitnessActivityInbound({ dataDir: dir, extract: () => undefined });
    const result = (await interceptor.execute({ args: ['anything'] }, async () => 'ok')) as string;
    expect(result).toBe('ok');
    expect((await events()).length).toBe(0);
  });

  it('re-throws the activity error AND records the failure', async () => {
    writePack([], 'allow');
    const interceptor = new WitnessActivityInbound({
      dataDir: dir,
      extract: (args, _result, error) =>
        error ? { command: String(args[0] ?? ''), exitCode: 1, stderr: String(error) } : undefined,
    });
    const next = async (): Promise<unknown> => {
      throw new Error('activity boom');
    };
    await expect(interceptor.execute({ args: ['failing-cmd'] }, next)).rejects.toThrow('activity boom');
    const evs = await events();
    expect(evs.length).toBe(1);
    expect(evs[0]!.outcome).toBe('allowed_executed_with_error');
    expect(evs[0]!.execution_result!.exit_code).toBe(1);
  });

  it('never lets a recorder failure break the activity (result still returned)', async () => {
    // No policy dir creation issues here; force a recorder error via a bad extractor
    // that throws. The activity result must still come back.
    writePack([], 'allow');
    const interceptor = new WitnessActivityInbound({
      dataDir: dir,
      extract: () => {
        throw new Error('extractor blew up');
      },
    });
    const result = (await interceptor.execute({ args: ['x'] }, async () => 'still-ok')) as string;
    expect(result).toBe('still-ok');
  });
});
