/**
 * Version source-of-truth regression guard.
 *
 * The CLI `--version` output and the `witseal_runtime` witness stamp were each
 * a hardcoded '0.1.0-pre' literal that silently drifted from package.json on
 * the 0.1.0 release. Both now derive from a single source (`src/version.ts`,
 * which reads package.json). This test fails CI if either ever drifts again.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WITSEAL_VERSION } from '../src/version.js';
import {
  WITSEAL_RUNTIME_VERSION,
  emitWitnessEvent,
  generateIntentId,
} from '../src/witness/emit.js';
import { EventLog } from '../src/witness/event-log.js';
import type { ClassifiedIntent } from '../schemas/intent.schema.js';
import type { PolicyDecision } from '../schemas/policy.schema.js';

// The package version, read directly from package.json — the value every
// other surface must equal.
const PKG_VERSION = (
  JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8')
  ) as { version: string }
).version;

function makeIntent(): ClassifiedIntent {
  return {
    schema_version: 'witseal.intent.v0.1',
    intent_id: generateIntentId(),
    intent: {
      action_type: 'shell_command',
      executable: '/bin/echo',
      args: ['x'],
      cwd: '/tmp',
      use_tty: false,
    },
    risk_class: 'C0',
    classification_reasons: ['informational'],
    classifier_version: 'test-1.0',
  };
}

function makePolicy(): PolicyDecision {
  return {
    schema_version: 'witseal.policy.v0.1',
    outcome: 'deny',
    matched_rule: null,
    reason: 'version-test (no execution)',
    active_pack_hashes: [],
  };
}

describe('version source of truth — no drift from package.json', () => {
  it('WITSEAL_VERSION equals package.json version', () => {
    expect(WITSEAL_VERSION).toBe(PKG_VERSION);
  });

  it('witness runtime stamp equals package.json version', () => {
    expect(WITSEAL_RUNTIME_VERSION).toBe(PKG_VERSION);
  });

  it('a freshly emitted witness event stamps versions.witseal_runtime = package.json version', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'witseal-ver-'));
    try {
      const log = new EventLog({ root: dir, segmentId: 'default' });
      const event = await emitWitnessEvent(log, {
        classifiedIntent: makeIntent(),
        policyDecision: makePolicy(),
        approval: null,
        executionResult: null,
        outcome: 'denied_by_policy',
        agentIdentifier: 'version-test',
        classifierVersion: 'test-1.0',
      });
      expect(event.versions.witseal_runtime).toBe(PKG_VERSION);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);

  it('CLI --version prints the package.json version', () => {
    // Run the CLI entry as a direct child via the tsx loader (no build needed).
    const cliEntry = fileURLToPath(new URL('../src/cli/index.ts', import.meta.url));
    const out = execFileSync(
      process.execPath,
      ['--import', 'tsx', cliEntry, '--version'],
      { encoding: 'utf8' }
    );
    expect(out.trim()).toBe(PKG_VERSION);
  }, 20_000);
});
