import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, afterEach, vi } from 'vitest';

import { PolicyPackSchema } from '../schemas/policy.schema.js';
import { runExec } from '../src/cli/exec.js';
import { runPolicyAdd, runPolicyList } from '../src/cli/policy.js';
import { EventLog } from '../src/witness/event-log.js';

const REPO_ROOT = process.cwd();
const STARTER_PACKS = [
  'examples/policy-packs/block-destructive.json',
  'examples/policy-packs/no-network-egress.json',
  'examples/policy-packs/read-only-fs.json',
];

let dataDir: string | undefined;

function silenceOutput(): { restore: () => void; stderr: string[]; stdout: string[] } {
  const stderr: string[] = [];
  const stdout: string[] = [];
  const stderrSpy = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation(((chunk: string | Uint8Array) => {
      stderr.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as never);
  const stdoutSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(((chunk: string | Uint8Array) => {
      stdout.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as never);
  return {
    restore: () => {
      stderrSpy.mockRestore();
      stdoutSpy.mockRestore();
    },
    stderr,
    stdout,
  };
}

afterEach(() => {
  if (dataDir !== undefined) {
    rmSync(dataDir, { recursive: true, force: true });
    dataDir = undefined;
  }
});

describe('starter policy pack packaging', () => {
  it('includes all starter policy packs in the npm tarball', () => {
    const output = execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    const [pack] = JSON.parse(output) as Array<{ files: Array<{ path: string }> }>;
    const packagedPaths = new Set(pack?.files.map((file) => file.path));

    for (const packPath of STARTER_PACKS) {
      expect(packagedPaths.has(packPath)).toBe(true);
    }
  });

  it('keeps starter policy packs valid against the active schema', async () => {
    for (const packPath of STARTER_PACKS) {
      const content = await readFile(join(REPO_ROOT, packPath), 'utf8');
      expect(() => PolicyPackSchema.parse(JSON.parse(content))).not.toThrow();
    }
  });

  it('adds a starter pack, lists it, and still denies destructive commands', async () => {
    const tempDataDir = mkdtempSync(join(tmpdir(), 'witseal-policy-packaging-'));
    dataDir = tempDataDir;
    const blockDestructivePath = join(REPO_ROOT, 'examples/policy-packs/block-destructive.json');
    const out = silenceOutput();
    try {
      await expect(runPolicyAdd({ path: blockDestructivePath, dataDir: tempDataDir })).resolves.toBe(0);
      await expect(runPolicyList({ dataDir: tempDataDir })).resolves.toBe(0);
      expect(out.stdout.join('')).toContain('block-destructive@1.0.0');

      const exit = await runExec({
        command: 'rm',
        args: ['-rf', '/tmp/witseal-policy-packaging-never-run'],
        agentId: 'policy-packaging-test',
        cwd: '/tmp',
        timeoutMs: 0,
        dataDir: tempDataDir,
        segmentId: 'default',
      });
      expect(exit).toBe(100);
    } finally {
      out.restore();
    }

    const events = await new EventLog({ root: tempDataDir, segmentId: 'default' }).readAllEvents();
    expect(events).toHaveLength(1);
    expect(events[0]!.outcome).toBe('denied_by_policy');
    expect(events[0]!.policy_decision.matched_rule?.pack_id).toBe('block-destructive');
    expect(events[0]!.policy_decision.matched_rule?.rule_id).toBe('deny-rm-rf-absolute');
  });
});
