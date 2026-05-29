/**
 * D1 — `witseal receipt show <id>` (src/cli/receipt.ts).
 *
 * `receipt show` is the human-readable PRESENTATION of a receipt:
 * noun+verb grammar, like `events list` / `evidence export`). It answers
 * "What happened?" — it does NOT verify (that is `witseal verify` / D2) and
 * is NOT forensics (`inspect`, reserved, out of 0.1.0).
 *
 * Coverage:
 *   - v0.1 receipt reconstructed from the event journal, looked up by
 *     receipt_id, witness event_id, sequence, and unique prefix.
 *   - v0.1 human rendering carries the 9 receipt fields + the action block.
 *   - --json emits the raw receipt JSON (round-trips through the v0.1 schema).
 *   - v0.2 receipt read from an exported evidence package (--from): the
 *     rendering dispatches on schema_version and shows the 17-field receipt
 *     (prev_hash, signature, build-provenance block).
 *   - not-found returns exit 1 with a diagnostic on stderr.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, type KeyObject } from 'node:crypto';

import { classify, CLASSIFIER_VERSION } from '../src/risk/classifier.js';
import { PolicyEngine } from '../src/policy/engine.js';
import { mediateShell } from '../src/execution/mediator.js';
import { EventLog } from '../src/witness/event-log.js';
import { emitWitnessEvent, generateIntentId } from '../src/witness/emit.js';
import { exportEvidencePackage } from '../src/evidence/package.js';
import { runReceiptShow } from '../src/cli/receipt.js';
import { generateReceipt } from '../src/receipts/generate.js';

import {
  ClassifiedIntentSchema,
  type ClassifiedIntent,
  type Intent,
} from '../schemas/intent.schema.js';
import { PolicyPackSchema, type PolicyPack } from '../schemas/policy.schema.js';
import { ExecutionReceiptSchema } from '../schemas/receipt.schema.js';
import type { WitnessEvent, WitnessOutcome } from '../schemas/witness-event.schema.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALLOW_C0_PACK: PolicyPack = PolicyPackSchema.parse({
  schema_version: 'witseal.policy.v0.1',
  pack_id: 'receipt-show-test-allow',
  version: '0.1.0',
  description: 'Allow C0 shell for receipt show test.',
  rules: [
    {
      id: 'allow-c0-shell',
      match: { action_type: 'shell_command', risk_class: 'C0' },
      decision: 'allow',
      reason: 'C0 shell commands are informational',
    },
  ],
  default_decision: 'deny',
});

/** Capture process.stdout / process.stderr writes for assertions. */
function captureOutput(): { restore: () => void; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const stdoutSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(((chunk: string | Uint8Array) => {
      stdout.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as never);
  const stderrSpy = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation(((chunk: string | Uint8Array) => {
      stderr.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as never);
  return {
    restore: () => {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    },
    stdout,
    stderr,
  };
}

async function runEvent(args: {
  intent: Intent;
  engine: PolicyEngine;
  eventLog: EventLog;
}): Promise<WitnessEvent> {
  const classification = classify(args.intent);
  const classifiedIntent: ClassifiedIntent = ClassifiedIntentSchema.parse({
    schema_version: 'witseal.intent.v0.1',
    intent_id: generateIntentId(),
    intent: args.intent,
    risk_class: classification.risk_class,
    classification_reasons: classification.reasons,
    classifier_version: CLASSIFIER_VERSION,
  });
  const policyDecision = args.engine.evaluate(classifiedIntent);
  const executionResult = await mediateShell(args.intent);
  const outcome: WitnessOutcome =
    executionResult.exit_code === 0 && executionResult.spawn_error === null
      ? 'allowed_executed'
      : 'allowed_executed_with_error';
  return emitWitnessEvent(args.eventLog, {
    classifiedIntent,
    policyDecision,
    approval: null,
    executionResult,
    outcome,
    agentIdentifier: 'receipt-show-test',
    classifierVersion: CLASSIFIER_VERSION,
  });
}

async function buildChain(
  n: number,
  engine: PolicyEngine,
  eventLog: EventLog,
  workDir: string
): Promise<WitnessEvent[]> {
  const events: WitnessEvent[] = [];
  for (let i = 0; i < n; i++) {
    const intent: Intent = {
      action_type: 'shell_command',
      executable: 'echo',
      args: [`event-${i}`],
      cwd: workDir,
      use_tty: false,
    };
    events.push(await runEvent({ intent, engine, eventLog }));
  }
  return events;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let workDir: string;
let engine: PolicyEngine;
let eventLog: EventLog;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'witseal-receipt-show-'));
  engine = new PolicyEngine();
  engine.loadPack(ALLOW_C0_PACK);
  eventLog = new EventLog({ root: workDir, segmentId: 'default' });
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// v0.1 — reconstructed from the event journal
// ---------------------------------------------------------------------------

describe('receipt show — v0.1 from event journal', () => {
  it('shows the receipt looked up by receipt_id', async () => {
    const [event] = await buildChain(1, engine, eventLog, workDir);
    const cap = captureOutput();
    let code: number;
    try {
      code = await runReceiptShow({
        identifier: event!.receipt_id,
        dataDir: workDir,
        segmentId: 'default',
      });
    } finally {
      cap.restore();
    }
    expect(code).toBe(0);
    const out = cap.stdout.join('');
    // Schema-version dispatch landed on v0.1 and the core fields are present.
    expect(out).toContain('witseal.receipt.v0.1');
    expect(out).toContain(event!.receipt_id);
    expect(out).toContain(event!.event_id);
    expect(out).toContain('chain segment:   default');
    expect(out).toContain('outcome:         allowed_executed');
    // The reconstructed receipt_hash matches generateReceipt's derivation
    // (modulo finalized_at, which differs per-call) — assert the field label
    // is rendered with a 64-hex value.
    expect(out).toMatch(/receipt_hash:\s+[a-f0-9]{64}/);
  });

  it('shows the receipt looked up by witness event_id', async () => {
    const [event] = await buildChain(1, engine, eventLog, workDir);
    const cap = captureOutput();
    let code: number;
    try {
      code = await runReceiptShow({
        identifier: event!.event_id,
        dataDir: workDir,
        segmentId: 'default',
      });
    } finally {
      cap.restore();
    }
    expect(code).toBe(0);
    expect(cap.stdout.join('')).toContain(event!.receipt_id);
  });

  it('shows the receipt looked up by sequence number', async () => {
    const events = await buildChain(3, engine, eventLog, workDir);
    const target = events[1]!;
    const cap = captureOutput();
    let code: number;
    try {
      code = await runReceiptShow({
        identifier: String(target.sequence),
        dataDir: workDir,
        segmentId: 'default',
      });
    } finally {
      cap.restore();
    }
    expect(code).toBe(0);
    expect(cap.stdout.join('')).toContain(target.receipt_id);
  });

  it('shows the receipt looked up by a unique receipt_id prefix', async () => {
    const [event] = await buildChain(1, engine, eventLog, workDir);
    const prefix = event!.receipt_id.slice(0, 12);
    const cap = captureOutput();
    let code: number;
    try {
      code = await runReceiptShow({
        identifier: prefix,
        dataDir: workDir,
        segmentId: 'default',
      });
    } finally {
      cap.restore();
    }
    expect(code).toBe(0);
    expect(cap.stdout.join('')).toContain(event!.receipt_id);
  });

  it('renders the action block describing what happened', async () => {
    const [event] = await buildChain(1, engine, eventLog, workDir);
    const cap = captureOutput();
    try {
      await runReceiptShow({
        identifier: event!.receipt_id,
        dataDir: workDir,
        segmentId: 'default',
      });
    } finally {
      cap.restore();
    }
    const out = cap.stdout.join('');
    expect(out).toContain('Action:');
    expect(out).toContain('shell: echo event-0');
    expect(out).toContain('risk:      C0');
    expect(out).toContain('exit:      0');
  });

  it('--json emits raw receipt JSON that round-trips through the v0.1 schema', async () => {
    const [event] = await buildChain(1, engine, eventLog, workDir);
    const cap = captureOutput();
    let code: number;
    try {
      code = await runReceiptShow({
        identifier: event!.receipt_id,
        dataDir: workDir,
        segmentId: 'default',
        json: true,
      });
    } finally {
      cap.restore();
    }
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.stdout.join(''));
    expect(() => ExecutionReceiptSchema.parse(parsed)).not.toThrow();
    expect(parsed.schema_version).toBe('witseal.receipt.v0.1');
    expect(parsed.receipt_id).toBe(event!.receipt_id);
    expect(parsed.witness_event_id).toBe(event!.event_id);
    // The shown receipt is the same derivation generateReceipt produces.
    const direct = generateReceipt(event!);
    expect(parsed.policy_decision_hash).toBe(direct.policy_decision_hash);
    expect(parsed.classified_intent_hash).toBe(direct.classified_intent_hash);
  });

  it('returns exit 1 with a diagnostic when no receipt matches', async () => {
    await buildChain(1, engine, eventLog, workDir);
    const cap = captureOutput();
    let code: number;
    try {
      code = await runReceiptShow({
        identifier: 'rcpt_doesnotexist00000000',
        dataDir: workDir,
        segmentId: 'default',
      });
    } finally {
      cap.restore();
    }
    expect(code).toBe(1);
    expect(cap.stderr.join('')).toMatch(/no receipt found/);
  });
});

// ---------------------------------------------------------------------------
// v0.2 — read from an exported evidence package (--from)
// ---------------------------------------------------------------------------

describe('receipt show — v0.2 from evidence package', () => {
  let privateKey: KeyObject;
  let pkgPath: string;
  let events: WitnessEvent[];

  beforeEach(async () => {
    ({ privateKey } = generateKeyPairSync('ed25519'));
    events = await buildChain(2, engine, eventLog, workDir);
    const pkg = await exportEvidencePackage(eventLog, [ALLOW_C0_PACK], CLASSIFIER_VERSION, {
      receiptVersion: 'witseal.receipt.v0.2',
      signingKey: privateKey,
      gitCommit: 'a'.repeat(40),
      artifactDigest: 'sha256:' + 'b'.repeat(64),
      attestationDigest: 'sha256:' + 'c'.repeat(64),
      artifactType: 'generic-binary',
      buildId: 'receipt-show-test-build',
    });
    pkgPath = join(workDir, 'package-v0.2.json');
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  });

  it('dispatches on schema_version and renders the v0.2 17-field receipt', async () => {
    const target = events[0]!;
    const cap = captureOutput();
    let code: number;
    try {
      code = await runReceiptShow({
        identifier: target.receipt_id,
        dataDir: workDir,
        segmentId: 'default',
        fromPackage: pkgPath,
      });
    } finally {
      cap.restore();
    }
    expect(code).toBe(0);
    const out = cap.stdout.join('');
    expect(out).toContain('witseal.receipt.v0.2');
    // v0.2-only fields are surfaced.
    expect(out).toContain('Build provenance:');
    expect(out).toContain('git_commit:        ' + 'a'.repeat(40));
    expect(out).toContain('artifact_type:     generic-binary');
    expect(out).toContain('build_id:          receipt-show-test-build');
    expect(out).toContain('Signature:');
    expect(out).toMatch(/ed25519:[A-Za-z0-9+/]{86}==/);
    // prev_hash for the genesis-of-range receipt is null.
    expect(out).toContain('prev_hash:             (none — chain-segment genesis)');
  });

  it('shows the second (chained) v0.2 receipt with a non-null prev_hash', async () => {
    const target = events[1]!;
    const cap = captureOutput();
    let code: number;
    try {
      code = await runReceiptShow({
        identifier: target.receipt_id,
        dataDir: workDir,
        segmentId: 'default',
        fromPackage: pkgPath,
      });
    } finally {
      cap.restore();
    }
    expect(code).toBe(0);
    const out = cap.stdout.join('');
    expect(out).toContain('witseal.receipt.v0.2');
    expect(out).toMatch(/prev_hash:\s+[a-f0-9]{64}/);
  });

  it('--json emits the raw v0.2 receipt from the package', async () => {
    const target = events[0]!;
    const cap = captureOutput();
    let code: number;
    try {
      code = await runReceiptShow({
        identifier: target.receipt_id,
        dataDir: workDir,
        segmentId: 'default',
        fromPackage: pkgPath,
        json: true,
      });
    } finally {
      cap.restore();
    }
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.stdout.join(''));
    expect(parsed.schema_version).toBe('witseal.receipt.v0.2');
    expect(parsed.signature).toMatch(/^ed25519:/);
    expect(parsed.git_commit).toBe('a'.repeat(40));
  });

  it('returns exit 1 when the package file is missing', async () => {
    const cap = captureOutput();
    let code: number;
    try {
      code = await runReceiptShow({
        identifier: events[0]!.receipt_id,
        dataDir: workDir,
        segmentId: 'default',
        fromPackage: join(workDir, 'nonexistent.json'),
      });
    } finally {
      cap.restore();
    }
    expect(code).toBe(1);
    expect(cap.stderr.join('')).toMatch(/not found/);
  });

  it('returns exit 1 when the id is absent from the package', async () => {
    const cap = captureOutput();
    let code: number;
    try {
      code = await runReceiptShow({
        identifier: 'rcpt_absent000000000000001',
        dataDir: workDir,
        segmentId: 'default',
        fromPackage: pkgPath,
      });
    } finally {
      cap.restore();
    }
    expect(code).toBe(1);
    expect(cap.stderr.join('')).toMatch(/no receipt found/);
  });
});
