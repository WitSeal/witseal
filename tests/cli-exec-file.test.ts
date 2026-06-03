/**
 * `runFileExec` — the file_write execution path (src/cli/exec-file.ts).
 *
 * The file analogue of `runExec`: it drives the same pipeline (classify →
 * policy → mediate → witness → receipt) for a `file_write` intent via the
 * existing `mediateFile` primitive and the existing schemas. These tests assert
 * the recorded evidence AND the real filesystem effect (the action is actually
 * executed when allowed, and NOT executed when denied / fail-closed).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runFileExec } from '../src/cli/exec-file.js';
import { EventLog } from '../src/witness/event-log.js';

let dir: string; // witseal data dir (chain + policy packs)
let work: string; // workspace for target files

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'witseal-file-exec-'));
  work = mkdtempSync(join(tmpdir(), 'witseal-file-work-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(work, { recursive: true, force: true });
});

function writePack(rules: unknown[], defaultDecision: 'allow' | 'deny' = 'allow'): void {
  const packDir = join(dir, 'policy-packs');
  mkdirSync(packDir, { recursive: true });
  writeFileSync(
    join(packDir, 'file-rule.json'),
    JSON.stringify({
      schema_version: 'witseal.policy.v0.1',
      pack_id: 'file-rule',
      version: '1.0.0',
      description: 'test: file_write rules',
      rules,
      default_decision: defaultDecision,
    })
  );
}

async function events() {
  return new EventLog({ root: dir, segmentId: 'default' }).readAllEvents();
}

describe('runFileExec (file_write execution path)', () => {
  it('writes the file under allow policy and records allowed_executed with the file_write intent', async () => {
    writePack([], 'allow');
    const target = join(work, 'out.txt');
    const code = await runFileExec({
      path: target,
      content: Buffer.from('hello file\n'),
      writeMode: 'overwrite',
      agentId: 'test-file',
      dataDir: dir,
      segmentId: 'default',
    });
    expect(code).toBe(0);
    // Actually executed: the bytes are on disk.
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe('hello file\n');
    const evs = await events();
    const last = evs[evs.length - 1]!;
    expect(last.outcome).toBe('allowed_executed');
    expect(last.classified_intent.intent.action_type).toBe('file_write');
    expect(last.execution_result).not.toBeNull();
    expect(last.execution_result!.exit_code).toBe(0);
    expect(last.agent_identifier).toBe('test-file');
  });

  it('fails closed with no policy pack (gate): does NOT write, records no_policy_configured', async () => {
    const target = join(work, 'must-not-exist.txt');
    const code = await runFileExec({
      path: target,
      content: Buffer.from('x'),
      writeMode: 'overwrite',
      agentId: 'test-file',
      dataDir: dir,
      segmentId: 'default',
    });
    expect(code).toBe(100);
    expect(existsSync(target)).toBe(false); // never written — blocked before mediateFile
    const evs = await events();
    expect(evs[evs.length - 1]!.outcome).toBe('no_policy_configured');
  });

  it('denies a path-matched write (gate): file NOT written, outcome denied_by_policy', async () => {
    writePack(
      [{ id: 'deny-secret', match: { path_matches: 'secret' }, decision: 'deny', reason: 'no secret files (test)' }],
      'allow'
    );
    const target = join(work, 'secret.txt');
    const code = await runFileExec({
      path: target,
      content: Buffer.from('x'),
      writeMode: 'overwrite',
      agentId: 'test-file',
      dataDir: dir,
      segmentId: 'default',
    });
    expect(code).toBe(100);
    expect(existsSync(target)).toBe(false); // blocked before execution
    const evs = await events();
    expect(evs[evs.length - 1]!.outcome).toBe('denied_by_policy');
  });

  it('records a paired chain (pending → execution_complete) for an allowed write', async () => {
    writePack([], 'allow');
    await runFileExec({
      path: join(work, 'a.txt'),
      content: Buffer.from('a'),
      writeMode: 'overwrite',
      agentId: 'test-file',
      dataDir: dir,
      segmentId: 'default',
    });
    const evs = await events();
    expect(evs.length).toBeGreaterThanOrEqual(2); // intent_recorded(pending) + execution_complete
  });
});
