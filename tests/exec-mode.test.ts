/**
 * `exec --mode` routing tests.
 *
 * Witness Mode is recognized but HELD until the cross-track receipt change
 * lands: `runExec` must refuse it with a clear, non-denial error and must NOT
 * execute or witness anything. Gate Mode (explicit and default) is unchanged —
 * the Gate regression.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runExec, type ExecOptions } from '../src/cli/exec.js';
import { EventLog } from '../src/witness/event-log.js';

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

describe('exec --mode (Witness held until cross-track receipt change)', () => {
  it('mode=witness is recognized, returns a non-zero non-denial code, and does NOT execute or witness', async () => {
    const code = await runExec(opts({ mode: 'witness' }));
    expect(code).not.toBe(0); // not success
    expect(code).not.toBe(100); // not a policy-denial code (would imply it ran the deny path)
    // Witness short-circuits before any work: the chain stays empty.
    const events = await new EventLog({ root: dir, segmentId: 'default' }).readAllEvents();
    expect(events.length).toBe(0);
  });

  it('mode=gate (explicit) keeps Gate behavior: no policy → fail-closed deny (exit 100)', async () => {
    expect(await runExec(opts({ mode: 'gate' }))).toBe(100);
  });

  it('default mode (unset) equals gate — fail-closed deny (regression)', async () => {
    expect(await runExec(opts({}))).toBe(100);
  });
});
