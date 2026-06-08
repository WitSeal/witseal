/**
 * Framework adapter — mediateFileWrite (author-the-tool, Level 3).
 *
 * The file analogue of `mediateShellCommand` (tests/adapters/framework.test.ts).
 * It routes a file_write through the SAME pipeline via `runFileExec`, so it must:
 * pass an allowed write through witseal AND actually write the file, block a
 * denied write (Gate, deny-by-default) AND leave NO file on disk, and — like the
 * shell core — fail closed when no policy pack is configured. WitSeal owns
 * execution, so an allowed write yields a full execution receipt (recorded in the
 * witness chain) rather than merely a witnessed decision.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mediateFileWrite, WITSEAL_DENIED_EXIT } from '../../src/adapters/framework/mediate.js';
import {
  fileWriteToolSchema,
  runFileWriteTool,
  DEFAULT_FILE_WRITE_TOOL_NAME,
  DEFAULT_FILE_WRITE_TOOL_DESCRIPTION,
} from '../../src/adapters/framework/tool.js';
import { EventLog } from '../../src/witness/event-log.js';

let dir: string; // witseal data dir (chain + policy packs)
let work: string; // workspace for target files

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'witseal-framework-fw-'));
  work = mkdtempSync(join(tmpdir(), 'witseal-framework-fw-work-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(work, { recursive: true, force: true });
});

function writePack(rules: unknown[], defaultDecision: 'allow' | 'deny' = 'allow'): void {
  const packDir = join(dir, 'policy-packs');
  mkdirSync(packDir, { recursive: true });
  writeFileSync(
    join(packDir, 'framework-file-rule.json'),
    JSON.stringify({
      schema_version: 'witseal.policy.v0.1',
      pack_id: 'framework-file-rule',
      version: '1.0.0',
      description: 'test: framework file_write rules',
      rules,
      default_decision: defaultDecision,
    })
  );
}

async function events() {
  return new EventLog({ root: dir, segmentId: 'default' }).readAllEvents();
}

describe('Framework adapter — mediateFileWrite (Level 3)', () => {
  it('passes an allowed write through witseal and writes the file (allowed_executed)', async () => {
    writePack([], 'allow');
    const target = join(work, 'out.txt');
    const res = await mediateFileWrite(
      { path: target, content: 'hello file\n', writeMode: 'overwrite' },
      { dataDir: dir, agentId: 'langgraph' }
    );
    expect(res.exitCode).toBe(0);
    expect(res.denied).toBe(false);
    // Actually executed: the bytes are on disk.
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe('hello file\n');
    // A verifiable receipt was recorded for the file_write through the chain.
    const evs = await events();
    const last = evs[evs.length - 1]!;
    expect(last.outcome).toBe('allowed_executed');
    expect(last.classified_intent.intent.action_type).toBe('file_write');
    expect(last.execution_result).not.toBeNull();
    expect(last.execution_result!.exit_code).toBe(0);
    expect(last.agent_identifier).toBe('langgraph');
  }, 20_000);

  it('blocks a denied write (Gate) and writes NO file (no-write-on-denial)', async () => {
    const target = join(work, 'secret.txt');
    writePack(
      [
        {
          id: 'deny-secret',
          match: { path_matches: 'secret' },
          decision: 'deny',
          reason: 'no secret files (test)',
        },
      ],
      'allow'
    );
    const res = await mediateFileWrite(
      { path: target, content: 'do not write me', writeMode: 'overwrite' },
      { dataDir: dir, agentId: 'openai-agents' }
    );
    expect(res.exitCode).toBe(WITSEAL_DENIED_EXIT);
    expect(res.denied).toBe(true);
    // No side effect: the file was never written.
    expect(existsSync(target)).toBe(false);
    const evs = await events();
    expect(evs.some((e) => e.outcome === 'denied_by_policy')).toBe(true);
  }, 20_000);

  it('never bypasses witseal: with no policy pack it fails closed (no file written)', async () => {
    const target = join(work, 'no-policy-target.txt');
    const res = await mediateFileWrite(
      { path: target, content: 'x' },
      { dataDir: dir }
    );
    expect(res.exitCode).toBe(WITSEAL_DENIED_EXIT);
    expect(res.denied).toBe(true);
    expect(existsSync(target)).toBe(false);
  }, 20_000);
});

describe('Framework adapter — file-write tool contract', () => {
  it('schema parses path/content and an optional writeMode enum', () => {
    const ok = fileWriteToolSchema.parse({ path: '/tmp/x.txt', content: 'hi', writeMode: 'append' });
    expect(ok.writeMode).toBe('append');
    // writeMode is optional.
    expect(fileWriteToolSchema.parse({ path: '/tmp/x.txt', content: 'hi' }).writeMode).toBeUndefined();
    // Unknown write modes are rejected by the enum.
    expect(fileWriteToolSchema.safeParse({ path: '/tmp/x.txt', content: 'hi', writeMode: 'delete' }).success).toBe(false);
  });

  it('exposes an on-vocabulary, deny-by-default tool name + description', () => {
    expect(DEFAULT_FILE_WRITE_TOOL_NAME).toBe('file_write');
    expect(DEFAULT_FILE_WRITE_TOOL_DESCRIPTION).toMatch(/deny-by-default/);
    expect(DEFAULT_FILE_WRITE_TOOL_DESCRIPTION).toMatch(/receipt/);
  });

  it('tool body returns the witseal summary on an allowed write and writes the file', async () => {
    writePack([], 'allow');
    const target = join(work, 'tool-out.txt');
    const result = await runFileWriteTool(
      { path: target, content: 'tool wrote this\n' },
      { dataDir: dir, agentId: 'framework-tool' }
    );
    expect(result).toMatch(/execution receipt/);
    expect(readFileSync(target, 'utf8')).toBe('tool wrote this\n');
  }, 20_000);

  it('tool body throws on a denied write and writes NO file', async () => {
    const target = join(work, 'denied.txt');
    writePack(
      [{ id: 'deny-all', match: { path_matches: 'denied' }, decision: 'deny', reason: 'denied (test)' }],
      'allow'
    );
    await expect(
      runFileWriteTool({ path: target, content: 'nope' }, { dataDir: dir })
    ).rejects.toThrow(/denied this file write by policy/);
    expect(existsSync(target)).toBe(false);
  }, 20_000);
});
