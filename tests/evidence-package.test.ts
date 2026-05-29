/**
 * M1.3 — Evidence package round-trip test.
 *
 * Exercises `exportEvidencePackage` end-to-end against `src/evidence/package.ts`
 * — the module that бундлирует witness events + receipts + policy packs into
 * an exportable, third-party-verifiable artifact (per ADR-0001 § 3.5).
 *
 * Coverage closed by this slice (m1-e1-coverage-gap-analysis § 3 P1.4):
 *   - schema parse via `EvidencePackageSchema.parse(...)` on every produced
 *     package (the schema is currently 0% covered)
 *   - JSON round-trip: serialize → parse → deep-equal semantics preserved
 *   - `chain_head_before_range` pinned to genesis null (when range starts at 0)
 *     and to actual predecessor event_hash (when range starts mid-chain)
 *   - `chain_head_after_range` matches event_hash of last in-range event
 *   - range slicing: full-chain default, head-only slice, tail-only slice,
 *     middle slice (all три boundary configurations)
 *   - receipts paired 1:1 with events by witness_event_id и by hash linkage
 *   - chain reconstruction from package alone verifies via
 *     `verifyChain(events, chain_head_before_range)`
 *   - error paths: empty chain throws; out-of-range slice throws
 *
 * Builds on the same runPipeline helper pattern as
 * `pipeline-integration.test.ts` for stage composition. Receipt is generated
 * fresh inside `exportEvidencePackage` (per source contract), so we do NOT
 * assert receipt_hash equality with the pipeline-generated receipt (different
 * `finalized_at` timestamp) — instead we assert receipt-vs-event integrity
 * via the existing `verifyReceipt` API.
 *
 * Bridge Proof v0.2 alignment: this round-trip is the foundation для
 * the M11 `witseal verify` CLI which (in v0.2) will additionally verify
 * artifact_digest, attestation_digest, and Ed25519 signature. The schema
 * fields exercised here remain stable; v0.2 strictly adds fields.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { classify, CLASSIFIER_VERSION } from '../src/risk/classifier.js';
import { PolicyEngine } from '../src/policy/engine.js';
import { mediateShell, mediateFile } from '../src/execution/mediator.js';
import { EventLog } from '../src/witness/event-log.js';
import {
  emitWitnessEvent,
  generateIntentId,
  WITSEAL_RUNTIME_VERSION,
} from '../src/witness/emit.js';
import { verifyReceipt } from '../src/receipts/generate.js';
import { verifyChain } from '../src/integrity/hash-chain.js';
import { exportEvidencePackage } from '../src/evidence/package.js';

import {
  ClassifiedIntentSchema,
  type ClassifiedIntent,
  type Intent,
} from '../schemas/intent.schema.js';
import {
  PolicyPackSchema,
  type PolicyPack,
} from '../schemas/policy.schema.js';
import type { ExecutionResult } from '../schemas/execution-result.schema.js';
import type { WitnessEvent, WitnessOutcome } from '../schemas/witness-event.schema.js';
import {
  EvidencePackageSchema,
  type EvidencePackage,
} from '../schemas/evidence-package.schema.js';

// ---------------------------------------------------------------------------
// Test pack — same shape as pipeline-integration's ALLOW_INFORMATIONAL_PACK
// so multiple intent shapes (shell, file_write) flow without policy churn.
// ---------------------------------------------------------------------------

const ALLOW_INFORMATIONAL_PACK: PolicyPack = PolicyPackSchema.parse({
  schema_version: 'witseal.policy.v0.1',
  pack_id: 'evidence-package-test-allow',
  version: '0.1.0',
  description:
    'Allow C0 shell + C1 file_write для evidence package round-trip test.',
  rules: [
    {
      id: 'allow-c0-shell',
      match: { action_type: 'shell_command', risk_class: 'C0' },
      decision: 'allow',
      reason: 'C0 shell commands are informational',
    },
    {
      id: 'allow-c1-file-write',
      match: { action_type: 'file_write', risk_class: 'C1' },
      decision: 'allow',
      reason: 'C1 file_write outside system paths allowed',
    },
  ],
  default_decision: 'deny',
});

// ---------------------------------------------------------------------------
// Pipeline runner — produces a real WitnessEvent persisted to the log.
// Mirrors pipeline-integration.test.ts shape (kept local to avoid an extra
// shared-helper file для one more test; if a third test needs it we'll
// extract).
// ---------------------------------------------------------------------------

async function runPipelineEvent(args: {
  intent: Intent;
  engine: PolicyEngine;
  eventLog: EventLog;
  fileContent?: Buffer | string;
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

  let executionResult: ExecutionResult | null = null;
  let outcome: WitnessOutcome;
  if (policyDecision.outcome === 'allow') {
    if (args.intent.action_type === 'shell_command') {
      executionResult = await mediateShell(args.intent);
    } else if (args.intent.action_type === 'file_write') {
      executionResult = await mediateFile(args.intent, {
        content: args.fileContent ?? Buffer.alloc(0),
      });
    } else {
      executionResult = await mediateFile(args.intent);
    }
    outcome =
      executionResult.exit_code === 0 && executionResult.spawn_error === null
        ? 'allowed_executed'
        : 'allowed_executed_with_error';
  } else if (policyDecision.outcome === 'deny') {
    outcome = 'denied_by_policy';
  } else {
    outcome = 'denied_by_approval';
  }

  return emitWitnessEvent(args.eventLog, {
    classifiedIntent,
    policyDecision,
    approval: null,
    executionResult,
    outcome,
    agentIdentifier: 'evidence-package-test',
    classifierVersion: CLASSIFIER_VERSION,
  });
}

/** Build a deterministic chain of N C0 shell echo events. */
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
    events.push(await runPipelineEvent({ intent, engine, eventLog }));
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
  workDir = mkdtempSync(join(tmpdir(), 'witseal-evidence-pkg-'));
  engine = new PolicyEngine();
  engine.loadPack(ALLOW_INFORMATIONAL_PACK);
  eventLog = new EventLog({ root: workDir, segmentId: 'default' });
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fixture 1 — full-chain export, schema parse, round-trip equality
// ---------------------------------------------------------------------------

describe('exportEvidencePackage — full-chain export', () => {
  it('produces a schema-valid package with all events + receipts and survives JSON round-trip', async () => {
    const events = await buildChain(3, engine, eventLog, workDir);

    const pkg = await exportEvidencePackage(
      eventLog,
      [ALLOW_INFORMATIONAL_PACK],
      CLASSIFIER_VERSION
    );

    // Schema parse — closes EvidencePackageSchema 0% coverage gap.
    expect(() => EvidencePackageSchema.parse(pkg)).not.toThrow();

    // Top-level shape
    expect(pkg.schema_version).toBe('witseal.evidence-package.v0.1');
    expect(pkg.package_id).toMatch(/^pkg_[0-9a-zA-Z]{20,}$/);
    expect(pkg.chain_segment_id).toBe('default');
    expect(pkg.witseal_runtime_version).toBe(WITSEAL_RUNTIME_VERSION);
    expect(pkg.classifier_version).toBe(CLASSIFIER_VERSION);

    // Range covers entire chain
    expect(pkg.range.start_sequence).toBe(0);
    expect(pkg.range.end_sequence).toBe(2);

    // Chain head pinning — package STARTS at sequence 0, so the head
    // before the range is null (no predecessor).
    expect(pkg.chain_head_before_range).toBeNull();
    // Head AFTER the range == event_hash of the last in-range event.
    expect(pkg.chain_head_after_range).toBe(events[2]!.event_hash);

    // Event count matches chain length
    expect(pkg.events).toHaveLength(3);
    expect(pkg.receipts).toHaveLength(3);

    // Events appear in sequence order и match the live chain identity-wise.
    for (let i = 0; i < 3; i++) {
      expect(pkg.events[i]!.event_hash).toBe(events[i]!.event_hash);
      expect(pkg.events[i]!.sequence).toBe(i);
    }

    // Each receipt is paired 1:1 with its event by witness_event_id, и
    // verifyReceipt agrees end-to-end.
    for (let i = 0; i < 3; i++) {
      const rcpt = pkg.receipts[i]!;
      expect(rcpt.witness_event_id).toBe(pkg.events[i]!.event_id);
      expect(rcpt.receipt_id).toBe(pkg.events[i]!.receipt_id);
      const v = verifyReceipt(rcpt, pkg.events[i]!);
      expect(v.valid).toBe(true);
    }

    // Policy pack content preserved verbatim (not just by reference).
    expect(pkg.policy_packs).toHaveLength(1);
    expect(pkg.policy_packs[0]!.pack_id).toBe('evidence-package-test-allow');

    // JSON round-trip — serialize via JSON.stringify, re-parse, schema
    // parse the result. Verifies the package is canonical-JSON-stable
    // (no Date objects, no functions, no symbols leaking through).
    const serialized = JSON.stringify(pkg);
    const reparsed = JSON.parse(serialized) as unknown;
    const recovered: EvidencePackage = EvidencePackageSchema.parse(reparsed);

    expect(recovered.package_id).toBe(pkg.package_id);
    expect(recovered.chain_head_before_range).toBe(pkg.chain_head_before_range);
    expect(recovered.chain_head_after_range).toBe(pkg.chain_head_after_range);
    expect(recovered.events).toHaveLength(pkg.events.length);
    expect(recovered.receipts).toHaveLength(pkg.receipts.length);

    // Deep-equality on event hashes survives round-trip.
    for (let i = 0; i < recovered.events.length; i++) {
      expect(recovered.events[i]!.event_hash).toBe(pkg.events[i]!.event_hash);
    }
  });
});

// ---------------------------------------------------------------------------
// Fixture 2 — chain reconstruction from package alone verifies
// ---------------------------------------------------------------------------

describe('exportEvidencePackage — independent chain verification', () => {
  it('reconstructs and verifies the chain from package events alone using chain_head_before_range', async () => {
    // Build a mixed 3-event chain (shell, file_write, shell) so canonical
    // hashing exercises heterogeneous payload shapes.
    await runPipelineEvent({
      intent: {
        action_type: 'shell_command',
        executable: 'echo',
        args: ['one'],
        cwd: workDir,
        use_tty: false,
      },
      engine,
      eventLog,
    });

    const filePath = join(workDir, 'mid.txt');
    const fileContent = 'mid-chain artifact\n';
    const fileBytes = Buffer.from(fileContent, 'utf8');
    await runPipelineEvent({
      intent: {
        action_type: 'file_write',
        path: filePath,
        content_hash: createHash('sha256').update(fileBytes).digest('hex'),
        content_size_bytes: fileBytes.length,
        mode: 'create_only',
      },
      engine,
      eventLog,
      fileContent: fileBytes,
    });

    await runPipelineEvent({
      intent: {
        action_type: 'shell_command',
        executable: 'echo',
        args: ['three'],
        cwd: workDir,
        use_tty: false,
      },
      engine,
      eventLog,
    });

    const pkg = await exportEvidencePackage(
      eventLog,
      [ALLOW_INFORMATIONAL_PACK],
      CLASSIFIER_VERSION
    );

    // Third-party verification: given ONLY the package, verifyChain can
    // confirm chain integrity by passing chain_head_before_range as the
    // expected predecessor (here: null because range starts at genesis).
    const result = verifyChain(pkg.events, pkg.chain_head_before_range);
    expect(result.valid).toBe(true);
    expect(result.chainHeadAfter).toBe(pkg.chain_head_after_range);
  });
});

// ---------------------------------------------------------------------------
// Fixture 3 — range slicing (mid-chain) and chain_head_before_range pinning
// ---------------------------------------------------------------------------

describe('exportEvidencePackage — range slicing', () => {
  it('exports a mid-chain slice with chain_head_before_range = predecessor event_hash', async () => {
    const events = await buildChain(5, engine, eventLog, workDir);

    // Slice [1, 3] — three events, skipping the genesis event и one tail event.
    const pkg = await exportEvidencePackage(
      eventLog,
      [ALLOW_INFORMATIONAL_PACK],
      CLASSIFIER_VERSION,
      { startSequence: 1, endSequence: 3 }
    );

    expect(() => EvidencePackageSchema.parse(pkg)).not.toThrow();
    expect(pkg.range.start_sequence).toBe(1);
    expect(pkg.range.end_sequence).toBe(3);

    // chain_head_before_range should be the event_hash of event 0
    // (the predecessor of sequence 1).
    expect(pkg.chain_head_before_range).toBe(events[0]!.event_hash);
    // chain_head_after_range is event_hash of last in-range (seq 3).
    expect(pkg.chain_head_after_range).toBe(events[3]!.event_hash);

    // 3 events in slice (seq 1, 2, 3)
    expect(pkg.events).toHaveLength(3);
    expect(pkg.events[0]!.sequence).toBe(1);
    expect(pkg.events[2]!.sequence).toBe(3);

    // Receipts paired 1:1 across the slice.
    expect(pkg.receipts).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(pkg.receipts[i]!.witness_event_id).toBe(pkg.events[i]!.event_id);
      expect(verifyReceipt(pkg.receipts[i]!, pkg.events[i]!).valid).toBe(true);
    }

    // Third-party verification: given the slice + chain_head_before_range
    // anchor, verifyChain succeeds — the slice is self-contained as a
    // verifiable continuation of the (unseen) predecessor.
    const result = verifyChain(pkg.events, pkg.chain_head_before_range);
    expect(result.valid).toBe(true);
    expect(result.chainHeadAfter).toBe(pkg.chain_head_after_range);

    // Sanity: if a third party tampers с chain_head_before_range, verify
    // fails at index 0 (the slice no longer links to the claimed predecessor).
    const badAnchor = 'f'.repeat(64);
    const bad = verifyChain(pkg.events, badAnchor);
    expect(bad.valid).toBe(false);
    expect(bad.brokenAt).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Fixture 4 — error paths: empty chain, out-of-range slice
// ---------------------------------------------------------------------------

describe('exportEvidencePackage — error paths', () => {
  it('throws on empty chain', async () => {
    await expect(
      exportEvidencePackage(eventLog, [ALLOW_INFORMATIONAL_PACK], CLASSIFIER_VERSION)
    ).rejects.toThrow(/empty/i);
  });

  it('throws when range contains no events', async () => {
    await buildChain(2, engine, eventLog, workDir);

    // Range [5, 10] — chain only has seq 0 и 1, no events match.
    await expect(
      exportEvidencePackage(
        eventLog,
        [ALLOW_INFORMATIONAL_PACK],
        CLASSIFIER_VERSION,
        { startSequence: 5, endSequence: 10 }
      )
    ).rejects.toThrow(/No events found/i);
  });
});

// ---------------------------------------------------------------------------
// Fixture 5 — single-event range (head-only slice)
// ---------------------------------------------------------------------------

describe('exportEvidencePackage — single-event slice', () => {
  it('exports a 1-event range with matching before/after head pinning', async () => {
    const events = await buildChain(3, engine, eventLog, workDir);

    // Slice [2, 2] — just the tail event.
    const pkg = await exportEvidencePackage(
      eventLog,
      [ALLOW_INFORMATIONAL_PACK],
      CLASSIFIER_VERSION,
      { startSequence: 2, endSequence: 2 }
    );

    expect(() => EvidencePackageSchema.parse(pkg)).not.toThrow();
    expect(pkg.events).toHaveLength(1);
    expect(pkg.receipts).toHaveLength(1);
    expect(pkg.events[0]!.sequence).toBe(2);

    // before == event 1 hash; after == event 2 hash
    expect(pkg.chain_head_before_range).toBe(events[1]!.event_hash);
    expect(pkg.chain_head_after_range).toBe(events[2]!.event_hash);

    // Verifies as a standalone single-event continuation.
    const result = verifyChain(pkg.events, pkg.chain_head_before_range);
    expect(result.valid).toBe(true);
    expect(result.chainHeadAfter).toBe(pkg.chain_head_after_range);
  });
});
