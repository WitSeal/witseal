/**
 * `exec --mode` behavior (RFC-0002 Witness Mode path).
 *
 * Witness Mode does not enforce: it executes an action the policy would deny (or
 * require approval for) and records it under a distinct `witnessed_executed`
 * outcome — never `denied_by_policy`. Gate Mode is unchanged (regression).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runExec, type ExecOptions } from '../src/cli/exec.js';
import { EventLog } from '../src/witness/event-log.js';
import { generateReceipt } from '../src/receipts/generate.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'witseal-mode-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function opts(extra: Partial<ExecOptions>): ExecOptions {
  return {
    command: '/bin/echo',
    args: ['hi'],
    agentId: 'mode-test',
    cwd: '/tmp',
    timeoutMs: 0,
    dataDir: dir,
    segmentId: 'default',
    ...extra,
  };
}

/** Write a single-rule policy pack into the data dir. */
function writePack(decision: 'deny' | 'require-approval'): void {
  const packDir = join(dir, 'policy-packs');
  mkdirSync(packDir, { recursive: true });
  writeFileSync(
    join(packDir, 'echo-rule.json'),
    JSON.stringify({
      schema_version: 'witseal.policy.v0.1',
      pack_id: 'echo-rule',
      version: '1.0.0',
      description: 'test: rule on echo',
      rules: [{ id: 'echo-rule', match: { command_matches: 'echo' }, decision, reason: `echo ${decision} (test)` }],
      default_decision: 'allow',
    })
  );
}

async function events() {
  return new EventLog({ root: dir, segmentId: 'default' }).readAllEvents();
}

describe('exec --mode (RFC-0002 Witness Mode)', () => {
  it('8. Witness executes a denied action → witnessed_executed, execution_result != null', async () => {
    writePack('deny');
    const code = await runExec(opts({ mode: 'witness' }));
    expect(code).toBe(0); // executed (echo exits 0)
    const evs = await events();
    const last = evs[evs.length - 1]!;
    expect(last.outcome).toBe('witnessed_executed');
    expect(last.execution_result).not.toBeNull();
    // Invariant: Witness never emits denied_by_policy.
    expect(evs.some((e) => e.outcome === 'denied_by_policy')).toBe(false);
  }, 20_000);

  it('9. Witness executes a require-approval action without prompting → witnessed_executed', async () => {
    writePack('require-approval');
    // No TTY / no approval handler: if approval were invoked this would not
    // resolve to a clean execution. It does → approval was bypassed.
    const code = await runExec(opts({ mode: 'witness' }));
    expect(code).toBe(0);
    const evs = await events();
    expect(evs[evs.length - 1]!.outcome).toBe('witnessed_executed');
  }, 20_000);

  it('10. Witness with no policy pack → no_policy_configured + executed', async () => {
    const code = await runExec(opts({ mode: 'witness' })); // no policy-packs dir
    expect(code).toBe(0);
    const evs = await events();
    const last = evs[evs.length - 1]!;
    expect(last.outcome).toBe('no_policy_configured');
    expect(last.execution_result).not.toBeNull();
  }, 20_000);

  it('11. event → receipt round-trip carries the witnessed_executed outcome', async () => {
    writePack('deny');
    await runExec(opts({ mode: 'witness' }));
    const evs = await events();
    const ev = evs[evs.length - 1]!;
    const receipt = generateReceipt(ev);
    expect(receipt.outcome).toBe('witnessed_executed');
  }, 20_000);

  it('12. Gate still blocks a deny: denied_by_policy, exit 100, not executed (regression)', async () => {
    writePack('deny');
    const code = await runExec(opts({ mode: 'gate' }));
    expect(code).toBe(100);
    const evs = await events();
    const last = evs[evs.length - 1]!;
    expect(last.outcome).toBe('denied_by_policy');
    expect(last.execution_result).toBeNull(); // invariant: denied ⟹ not executed
  }, 20_000);

  it('default mode (unset) equals gate — deny blocks (regression)', async () => {
    writePack('deny');
    expect(await runExec(opts({}))).toBe(100);
  }, 20_000);
});
