/**
 * C2 — v0.2 receipt export path.
 *
 * Exercises `exportEvidencePackage(..., { receiptVersion: 'witseal.receipt.v0.2', ... })`
 * — the C2 wiring that emits signed v0.2 receipts (S1 clear-to-defaults
 * pre-image + Ed25519 signature via `generateReceiptByVersion` →
 * `signReceiptV02`) in the product export path.
 *
 * Coverage:
 *   - v0.1 remains the default (no opts / explicit v0.1 → unsigned receipts,
 *     package parses against EvidencePackageSchema unchanged).
 *   - v0.2 opt-in produces receipts that all carry schema_version v0.2 and
 *     verify under the export signing key (signature + self-hash).
 *   - prev_hash chaining across the exported range: first = null
 *     (Option B genesis-of-range), each subsequent = predecessor receipt_hash.
 *   - the package wire discriminant stays witseal.evidence-package.v0.1
 *     (only the receipt element schema is versioned independently).
 *   - 1:1 event↔receipt pairing by witness_event_id is preserved.
 *   - range slicing still works under v0.2.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
} from 'node:crypto';

import { classify, CLASSIFIER_VERSION } from '../src/risk/classifier.js';
import { PolicyEngine } from '../src/policy/engine.js';
import { mediateShell } from '../src/execution/mediator.js';
import { EventLog } from '../src/witness/event-log.js';
import { emitWitnessEvent, generateIntentId } from '../src/witness/emit.js';
import { exportEvidencePackage } from '../src/evidence/package.js';
import { verifyReceiptV02 } from '../src/receipts/sign-v0.2.js';
import { EvidencePackageSchema } from '../schemas/evidence-package.schema.js';

import {
  ClassifiedIntentSchema,
  type ClassifiedIntent,
  type Intent,
} from '../schemas/intent.schema.js';
import { PolicyPackSchema, type PolicyPack } from '../schemas/policy.schema.js';
import type { WitnessEvent, WitnessOutcome } from '../schemas/witness-event.schema.js';

const ALLOW_C0_PACK: PolicyPack = PolicyPackSchema.parse({
  schema_version: 'witseal.policy.v0.1',
  pack_id: 'evidence-v02-test-allow',
  version: '0.1.0',
  description: 'Allow C0 shell for v0.2 export test.',
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
    agentIdentifier: 'evidence-v0.2-test',
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

let workDir: string;
let engine: PolicyEngine;
let eventLog: EventLog;
let privateKey: KeyObject;
let publicKey: KeyObject;
let pubRaw: Buffer;

const V02_PROVENANCE = {
  gitCommit: '0'.repeat(40),
  artifactDigest: 'sha256:' + 'a'.repeat(64),
  attestationDigest: 'sha256:' + 'b'.repeat(64),
  artifactType: 'generic-binary',
  buildId: 'witseal-export-test-0001',
} as const;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'witseal-evidence-v0.2-'));
  engine = new PolicyEngine();
  engine.loadPack(ALLOW_C0_PACK);
  eventLog = new EventLog({ root: workDir, segmentId: 'default' });
  const kp = generateKeyPairSync('ed25519');
  privateKey = kp.privateKey;
  publicKey = kp.publicKey;
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  pubRaw = Buffer.from(spki.subarray(spki.length - 32));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('exportEvidencePackage — v0.1 default (backward-compat)', () => {
  it('omitting receiptVersion yields v0.1 receipts and a schema-valid package', async () => {
    await buildChain(2, engine, eventLog, workDir);
    const pkg = await exportEvidencePackage(eventLog, [ALLOW_C0_PACK], CLASSIFIER_VERSION);
    expect(() => EvidencePackageSchema.parse(pkg)).not.toThrow();
    for (const r of pkg.receipts) {
      expect(r.schema_version).toBe('witseal.receipt.v0.1');
      expect((r as { signature?: unknown }).signature).toBeUndefined();
    }
  });

  it('explicit receiptVersion v0.1 behaves identically to the default', async () => {
    await buildChain(2, engine, eventLog, workDir);
    const pkg = await exportEvidencePackage(eventLog, [ALLOW_C0_PACK], CLASSIFIER_VERSION, {
      receiptVersion: 'witseal.receipt.v0.1',
    });
    expect(() => EvidencePackageSchema.parse(pkg)).not.toThrow();
    expect(pkg.receipts.every((r) => r.schema_version === 'witseal.receipt.v0.1')).toBe(true);
  });
});

describe('exportEvidencePackage — v0.2 signed receipts', () => {
  it('emits v0.2 receipts that all verify under the export signing key', async () => {
    const events = await buildChain(3, engine, eventLog, workDir);
    const pkg = await exportEvidencePackage(eventLog, [ALLOW_C0_PACK], CLASSIFIER_VERSION, {
      receiptVersion: 'witseal.receipt.v0.2',
      signingKey: privateKey,
      ...V02_PROVENANCE,
    });

    // Package discriminant unchanged (only the receipt schema is versioned).
    expect(pkg.schema_version).toBe('witseal.evidence-package.v0.1');
    expect(pkg.receipts).toHaveLength(events.length);

    for (const r of pkg.receipts) {
      expect(r.schema_version).toBe('witseal.receipt.v0.2');
      expect(r.signature).toMatch(/^ed25519:[A-Za-z0-9+/]{86}==$/);
      expect(verifyReceiptV02(r, publicKey)).toEqual({ valid: true });
    }
  });

  it('also verifies under the raw 32-byte public key (cross-track wire form)', async () => {
    await buildChain(2, engine, eventLog, workDir);
    const pkg = await exportEvidencePackage(eventLog, [ALLOW_C0_PACK], CLASSIFIER_VERSION, {
      receiptVersion: 'witseal.receipt.v0.2',
      signingKey: privateKey,
      ...V02_PROVENANCE,
    });
    const spki = Buffer.concat([
      Buffer.from('302a300506032b6570032100', 'hex'),
      pubRaw,
    ]);
    const rawPub = createPublicKey({ key: spki, format: 'der', type: 'spki' });
    for (const r of pkg.receipts) {
      expect(verifyReceiptV02(r, rawPub).valid).toBe(true);
    }
  });

  it('chains receipts via prev_hash (genesis null, then predecessor receipt_hash)', async () => {
    await buildChain(3, engine, eventLog, workDir);
    const pkg = await exportEvidencePackage(eventLog, [ALLOW_C0_PACK], CLASSIFIER_VERSION, {
      receiptVersion: 'witseal.receipt.v0.2',
      signingKey: privateKey,
      ...V02_PROVENANCE,
    });
    const r = pkg.receipts;
    expect(r[0]!.prev_hash).toBeNull();
    for (let i = 1; i < r.length; i++) {
      expect(r[i]!.prev_hash).toBe(r[i - 1]!.receipt_hash);
    }
  });

  it('pairs each receipt 1:1 with its witness event by witness_event_id', async () => {
    const events = await buildChain(3, engine, eventLog, workDir);
    const pkg = await exportEvidencePackage(eventLog, [ALLOW_C0_PACK], CLASSIFIER_VERSION, {
      receiptVersion: 'witseal.receipt.v0.2',
      signingKey: privateKey,
      ...V02_PROVENANCE,
    });
    for (let i = 0; i < events.length; i++) {
      expect(pkg.receipts[i]!.witness_event_id).toBe(events[i]!.event_id);
      expect(pkg.receipts[i]!.receipt_id).toBe(events[i]!.receipt_id);
    }
  });

  it('honors range slicing under v0.2 (tail slice resets prev_hash to null)', async () => {
    await buildChain(4, engine, eventLog, workDir);
    const pkg = await exportEvidencePackage(eventLog, [ALLOW_C0_PACK], CLASSIFIER_VERSION, {
      startSequence: 2,
      endSequence: 3,
      receiptVersion: 'witseal.receipt.v0.2',
      signingKey: privateKey,
      ...V02_PROVENANCE,
    });
    expect(pkg.range.start_sequence).toBe(2);
    expect(pkg.range.end_sequence).toBe(3);
    expect(pkg.receipts).toHaveLength(2);
    // First receipt in the exported slice carries prev_hash = null.
    expect(pkg.receipts[0]!.prev_hash).toBeNull();
    expect(pkg.receipts[1]!.prev_hash).toBe(pkg.receipts[0]!.receipt_hash);
    for (const r of pkg.receipts) {
      expect(verifyReceiptV02(r, publicKey).valid).toBe(true);
    }
  });
});
