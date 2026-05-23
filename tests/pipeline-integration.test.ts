/**
 * M1.1 — Pipeline integration test.
 *
 * Exercises the full WitSeal pipeline end-to-end for a single classified
 * intent:
 *
 *   Intent → classify (risk class) → policy.evaluate (decision) →
 *   mediate{Shell,File} (ExecutionResult) → emitWitnessEvent (chain append) →
 *   generateReceipt (hash-addressable) → ReceiptSchema.parse (canonical
 *   schema parse) → verifyReceipt + EventLog.verifyAll (chain integrity).
 *
 * Unlike the per-stage unit tests (classifier.test.ts, policy.test.ts,
 * mediator-*.test.ts, receipts.test.ts, witness-emit.test.ts), this suite
 * verifies that the stages compose correctly: outputs flow without
 * shape mismatch, hashes line up, and the persisted chain reproduces the
 * in-memory state.
 *
 * M1 gap-analysis (ts-tech-lead-to-pm m1-e1-coverage-gap-analysis-2026-05-19)
 * § 3 P1 — closes "end-to-end pipeline integration" and "receipt-schema
 * parsing" gaps for the allow-path. Deny / approval / file_read fixtures
 * land in subsequent M1.1 sub-runs.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  WITNESS_SCHEMA_VERSION,
  WITSEAL_RUNTIME_VERSION,
} from '../src/witness/emit.js';
import { generateReceipt, verifyReceipt } from '../src/receipts/generate.js';
import { sha256OfCanonical, verifyChain } from '../src/integrity/hash-chain.js';

import {
  ClassifiedIntentSchema,
  type ClassifiedIntent,
  type Intent,
} from '../schemas/intent.schema.js';
import { PolicyPackSchema, type PolicyPack } from '../schemas/policy.schema.js';
import {
  WitnessEventSchema,
  type WitnessEvent,
  type WitnessOutcome,
} from '../schemas/witness-event.schema.js';
import { ExecutionReceiptSchema } from '../schemas/receipt.schema.js';
import type { ExecutionResult } from '../schemas/execution-result.schema.js';

// ---------------------------------------------------------------------------
// Test fixtures: a minimal "allow informational" policy pack.
// ---------------------------------------------------------------------------

const ALLOW_INFORMATIONAL_PACK: PolicyPack = PolicyPackSchema.parse({
  schema_version: 'witseal.policy.v0.1',
  pack_id: 'pipeline-integration-allow',
  version: '0.1.0',
  description:
    'Allows informational shell commands (C0), non-system file writes (C1), and informational file reads (C0). Deny everything else.',
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
      reason: 'C1 file writes (append/create_only outside system paths) are allowed',
    },
    {
      id: 'allow-c0-file-read',
      match: { action_type: 'file_read', risk_class: 'C0' },
      decision: 'allow',
      reason: 'C0 file reads (non-credential) are informational',
    },
  ],
  default_decision: 'deny',
});

// ---------------------------------------------------------------------------
// Pipeline runner — single composable helper that drives Intent through every
// stage and returns the produced WitnessEvent + ExecutionReceipt.
// ---------------------------------------------------------------------------

interface PipelineRunResult {
  classifiedIntent: ClassifiedIntent;
  policyOutcome: 'allow' | 'deny' | 'require-approval';
  executionResult: ExecutionResult | null;
  witnessEvent: WitnessEvent;
  receipt: ReturnType<typeof generateReceipt>;
}

async function runPipeline(args: {
  intent: Intent;
  engine: PolicyEngine;
  eventLog: EventLog;
  /** Optional file_write content bytes — passed to mediateFile. */
  fileContent?: Buffer | string;
  agentIdentifier?: string;
}): Promise<PipelineRunResult> {
  // 1. Classify
  const classification = classify(args.intent);
  const classifiedIntent: ClassifiedIntent = ClassifiedIntentSchema.parse({
    schema_version: 'witseal.intent.v0.1',
    intent_id: generateIntentId(),
    intent: args.intent,
    risk_class: classification.risk_class,
    classification_reasons: classification.reasons,
    classifier_version: CLASSIFIER_VERSION,
  });

  // 2. Policy evaluate
  const policyDecision = args.engine.evaluate(classifiedIntent);

  // 3. Mediate execution iff policy allows. Approval flow not exercised in
  // this slice; require-approval paths land in a subsequent fixture.
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
    // require-approval: approval flow stubbed for this slice
    outcome = 'denied_by_approval';
  }

  // 4. Emit witness event
  const witnessEvent = await emitWitnessEvent(args.eventLog, {
    classifiedIntent,
    policyDecision,
    approval: null,
    executionResult,
    outcome,
    agentIdentifier: args.agentIdentifier ?? 'pipeline-integration-test',
    classifierVersion: CLASSIFIER_VERSION,
  });

  // 5. Receipt
  const receipt = generateReceipt(witnessEvent);

  return {
    classifiedIntent,
    policyOutcome: policyDecision.outcome,
    executionResult,
    witnessEvent,
    receipt,
  };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let workDir: string;
let engine: PolicyEngine;
let eventLog: EventLog;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'witseal-pipeline-int-'));
  engine = new PolicyEngine();
  engine.loadPack(ALLOW_INFORMATIONAL_PACK);
  eventLog = new EventLog({ root: workDir, segmentId: 'default' });
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fixture 1 — allow-path shell command (C0 echo)
// ---------------------------------------------------------------------------

describe('pipeline-integration — allow-path shell_command (C0)', () => {
  it('produces a schema-valid receipt and an append-only chain entry', async () => {
    // Bare 'echo' (not '/bin/echo') so the classifier's C0 informational
    // pattern (/^\s*(echo|...)\b/ over fullCommand) matches; spawn resolves
    // via PATH.
    const intent: Intent = {
      action_type: 'shell_command',
      executable: 'echo',
      args: ['hello', 'pipeline'],
      cwd: workDir,
      use_tty: false,
    };

    const result = await runPipeline({ intent, engine, eventLog });

    // Stage outputs ----------------------------------------------------------
    expect(result.classifiedIntent.risk_class).toBe('C0');
    expect(result.classifiedIntent.classifier_version).toBe(CLASSIFIER_VERSION);

    expect(result.policyOutcome).toBe('allow');

    expect(result.executionResult).not.toBeNull();
    expect(result.executionResult!.spawn_error).toBe(null);
    expect(result.executionResult!.exit_code).toBe(0);
    expect(result.executionResult!.stdout.head).toMatch(/hello pipeline/);

    // Witness event ----------------------------------------------------------
    // sequence 0 — first event in segment, previous_event_hash null
    expect(result.witnessEvent.sequence).toBe(0);
    expect(result.witnessEvent.previous_event_hash).toBe(null);
    expect(result.witnessEvent.outcome).toBe('allowed_executed');
    expect(result.witnessEvent.versions.witseal_runtime).toBe(WITSEAL_RUNTIME_VERSION);
    expect(result.witnessEvent.versions.schema).toBe(WITNESS_SCHEMA_VERSION);
    // event_hash is self-consistent — re-parse with the canonical schema
    expect(() => WitnessEventSchema.parse(result.witnessEvent)).not.toThrow();

    // Receipt ---------------------------------------------------------------
    // Canonical schema parse — closes the receipt-schema parsing gap
    // (m1-e1-coverage-gap-analysis § 3 P1.2).
    expect(() => ExecutionReceiptSchema.parse(result.receipt)).not.toThrow();
    expect(result.receipt.witness_event_id).toBe(result.witnessEvent.event_id);
    expect(result.receipt.receipt_id).toBe(result.witnessEvent.receipt_id);
    expect(result.receipt.outcome).toBe(result.witnessEvent.outcome);

    // Hash linkages — receipt references must match the witness event's content.
    expect(result.receipt.classified_intent_hash).toBe(
      sha256OfCanonical(result.witnessEvent.classified_intent)
    );
    expect(result.receipt.policy_decision_hash).toBe(
      sha256OfCanonical(result.witnessEvent.policy_decision)
    );
    expect(result.receipt.execution_result_hash).toBe(
      sha256OfCanonical(result.witnessEvent.execution_result!)
    );

    // verifyReceipt agrees
    const v = verifyReceipt(result.receipt, result.witnessEvent);
    expect(v.valid).toBe(true);

    // Persisted chain ------------------------------------------------------
    // The append-only log on disk reproduces the in-memory event.
    const all = await eventLog.readAllEvents();
    expect(all).toHaveLength(1);
    expect(all[0]!.event_hash).toBe(result.witnessEvent.event_hash);

    // The chain (length 1) verifies.
    const chainResult = verifyChain(all);
    expect(chainResult.valid).toBe(true);

    // EventLog.verifyAll() agrees.
    const verifyAll = await eventLog.verifyAll();
    expect(verifyAll.valid).toBe(true);
    expect(verifyAll.eventCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Fixture 2 — allow-path file_write (C1, create_only into a fresh path)
// ---------------------------------------------------------------------------

describe('pipeline-integration — allow-path file_write (C1)', () => {
  it('chains two events (shell then file_write) and the chain verifies as a whole', async () => {
    // --- Event 0: shell echo (also exercised in fixture 1 — repeated here so
    //     this test is self-contained and asserts chain ADVANCEMENT between
    //     two heterogeneous intents) ---
    const shellIntent: Intent = {
      action_type: 'shell_command',
      executable: 'echo',
      args: ['warming-the-chain'],
      cwd: workDir,
      use_tty: false,
    };
    const r0 = await runPipeline({ intent: shellIntent, engine, eventLog });
    expect(r0.witnessEvent.sequence).toBe(0);
    expect(r0.witnessEvent.previous_event_hash).toBe(null);

    // --- Event 1: file_write (create_only — C1 per classifier rules) ---
    const targetPath = join(workDir, 'artifact.txt');
    const content = 'witseal pipeline integration artifact\n';
    const contentBytes = Buffer.from(content, 'utf8');
    const fileIntent: Intent = {
      action_type: 'file_write',
      path: targetPath,
      content_hash: createHash('sha256').update(contentBytes).digest('hex'),
      content_size_bytes: contentBytes.length,
      mode: 'create_only',
    };

    const r1 = await runPipeline({
      intent: fileIntent,
      engine,
      eventLog,
      fileContent: contentBytes,
    });

    // Classifier classifies create_only into a fresh non-system path as C1.
    expect(r1.classifiedIntent.risk_class).toBe('C1');
    expect(r1.policyOutcome).toBe('allow');
    expect(r1.executionResult).not.toBeNull();
    expect(r1.executionResult!.spawn_error).toBe(null);
    expect(r1.witnessEvent.outcome).toBe('allowed_executed');

    // The file was actually written on disk.
    expect(readFileSync(targetPath, 'utf8')).toBe(content);

    // Chain advancement -----------------------------------------------------
    expect(r1.witnessEvent.sequence).toBe(1);
    expect(r1.witnessEvent.previous_event_hash).toBe(r0.witnessEvent.event_hash);
    expect(r1.witnessEvent.event_hash).not.toBe(r0.witnessEvent.event_hash);

    // Receipt canonical schema parse + cross-link integrity.
    expect(() => ExecutionReceiptSchema.parse(r1.receipt)).not.toThrow();
    expect(verifyReceipt(r1.receipt, r1.witnessEvent).valid).toBe(true);

    // Full-chain verify covers both events.
    const all = await eventLog.readAllEvents();
    expect(all).toHaveLength(2);
    expect(all[0]!.event_id).toBe(r0.witnessEvent.event_id);
    expect(all[1]!.event_id).toBe(r1.witnessEvent.event_id);

    const verifyAll = await eventLog.verifyAll();
    expect(verifyAll.valid).toBe(true);
    expect(verifyAll.eventCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Fixture 3 — deny-by-policy path (C2 shell_command rejected by default deny)
// ---------------------------------------------------------------------------
//
// Closes m1-e1-coverage-gap-analysis § 3 P1.1 "deny path" — verifies that a
// classified intent which matches no allow rule:
//   - never reaches the mediator (execution_result remains null)
//   - still produces a fully-formed, schema-valid witness event + receipt
//   - records outcome='denied_by_policy'
//   - participates in the hash chain just like an allowed event
//
// Intent: `chmod 644 /tmp/somefile` — classifier C2 (permissions modification),
// no matching allow rule, default_decision='deny' fires.

describe('pipeline-integration — deny-by-policy (C2 shell_command)', () => {
  it('emits a witness event with execution_result=null and outcome=denied_by_policy', async () => {
    const intent: Intent = {
      action_type: 'shell_command',
      executable: 'chmod',
      args: ['644', join(workDir, 'nope')],
      cwd: workDir,
      use_tty: false,
    };

    const result = await runPipeline({ intent, engine, eventLog });

    // Classification — C2 (permissions modification regex)
    expect(result.classifiedIntent.risk_class).toBe('C2');

    // Policy — no rule matched → default deny
    expect(result.policyOutcome).toBe('deny');

    // No mediation occurred
    expect(result.executionResult).toBeNull();

    // Witness event ----------------------------------------------------------
    expect(result.witnessEvent.outcome).toBe('denied_by_policy');
    expect(result.witnessEvent.execution_result).toBeNull();
    expect(result.witnessEvent.approval).toBeNull();
    expect(result.witnessEvent.sequence).toBe(0);
    expect(result.witnessEvent.previous_event_hash).toBe(null);
    // Schema-valid even with execution_result=null
    expect(() => WitnessEventSchema.parse(result.witnessEvent)).not.toThrow();

    // Receipt — execution_result_hash must be null in the deny path
    expect(() => ExecutionReceiptSchema.parse(result.receipt)).not.toThrow();
    expect(result.receipt.outcome).toBe('denied_by_policy');
    expect(result.receipt.execution_result_hash).toBeNull();
    expect(result.receipt.classified_intent_hash).toBe(
      sha256OfCanonical(result.witnessEvent.classified_intent)
    );
    expect(result.receipt.policy_decision_hash).toBe(
      sha256OfCanonical(result.witnessEvent.policy_decision)
    );

    // verifyReceipt agrees in the null-exec path
    expect(verifyReceipt(result.receipt, result.witnessEvent).valid).toBe(true);

    // Chain integrity unaffected by deny path
    const all = await eventLog.readAllEvents();
    expect(all).toHaveLength(1);
    const verifyAll = await eventLog.verifyAll();
    expect(verifyAll.valid).toBe(true);
    expect(verifyAll.eventCount).toBe(1);

    // No file was created — chmod never spawned
    expect(() => readFileSync(join(workDir, 'nope'))).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Fixture 4 — allow-path file_read (C0, non-credential path)
// ---------------------------------------------------------------------------
//
// Closes m1-e1-coverage-gap-analysis § 3 P1 "file_read C0" — exercises the
// mediateFile read branch end-to-end. Confirms:
//   - classifier returns C0 for a non-credential read
//   - the read content surfaces through StreamCapture (head + content_hash)
//   - receipt is schema-valid и hash-cross-references match

describe('pipeline-integration — allow-path file_read (C0)', () => {
  it('returns captured content and a schema-valid receipt', async () => {
    const targetPath = join(workDir, 'readable.txt');
    const content = 'pipeline integration — file_read fixture\n';
    writeFileSync(targetPath, content, 'utf8');

    const intent: Intent = {
      action_type: 'file_read',
      path: targetPath,
    };

    const result = await runPipeline({ intent, engine, eventLog });

    // Classification — C0 (non-credential)
    expect(result.classifiedIntent.risk_class).toBe('C0');

    // Policy — allow-c0-file-read rule matched
    expect(result.policyOutcome).toBe('allow');

    // Execution — content read from disk, no spawn error
    expect(result.executionResult).not.toBeNull();
    expect(result.executionResult!.spawn_error).toBe(null);
    expect(result.executionResult!.exit_code).toBe(0);
    expect(result.executionResult!.stdout.total_bytes).toBe(
      Buffer.byteLength(content, 'utf8')
    );
    expect(result.executionResult!.stdout.head).toBe(content);
    expect(result.executionResult!.stdout.content_hash).toBe(
      createHash('sha256').update(content, 'utf8').digest('hex')
    );

    // Witness event ----------------------------------------------------------
    expect(result.witnessEvent.outcome).toBe('allowed_executed');
    expect(result.witnessEvent.execution_result).not.toBeNull();
    expect(() => WitnessEventSchema.parse(result.witnessEvent)).not.toThrow();

    // Receipt ---------------------------------------------------------------
    expect(() => ExecutionReceiptSchema.parse(result.receipt)).not.toThrow();
    expect(result.receipt.execution_result_hash).toBe(
      sha256OfCanonical(result.witnessEvent.execution_result!)
    );
    expect(verifyReceipt(result.receipt, result.witnessEvent).valid).toBe(true);

    // Chain integrity
    const verifyAll = await eventLog.verifyAll();
    expect(verifyAll.valid).toBe(true);
    expect(verifyAll.eventCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Fixture 5 — require-approval path (denied_by_approval stub)
// ---------------------------------------------------------------------------
//
// Closes m1-e1-coverage-gap-analysis § 3 P1 "require-approval stub". The
// full interactive approval flow is out of M1 scope (lands в M3). This
// fixture pins the pipeline shape for the rejected-/missing-approval path:
//
//   - Rule matched with decision='require-approval'
//   - No approval was supplied (approval=null), no mediation occurred
//     (execution_result=null), outcome='denied_by_approval'
//   - Receipt schema-valid с null exec hash
//
// Intent: `printf "%s\n" hi` — classifier C0 (informational). A dedicated
// pack maps C0 printf to require-approval so that the require-approval
// branch fires deterministically without depending on classifier escalation.

describe('pipeline-integration — require-approval (denied_by_approval stub)', () => {
  it('emits a witness event with execution_result=null, approval=null, outcome=denied_by_approval', async () => {
    // Replace the default permissive engine with one that demands approval
    // for our specific intent shape.
    const approvalEngine = new PolicyEngine();
    approvalEngine.loadPack(
      PolicyPackSchema.parse({
        schema_version: 'witseal.policy.v0.1',
        pack_id: 'pipeline-integration-require-approval',
        version: '0.1.0',
        description:
          'Require approval for printf invocations (stub for M1.1 fixture 5).',
        rules: [
          {
            id: 'require-approval-printf',
            match: { action_type: 'shell_command', executable_matches: '^printf$' },
            decision: 'require-approval',
            reason: 'printf demands approval (M1.1 stub)',
          },
        ],
        default_decision: 'deny',
      })
    );

    const intent: Intent = {
      action_type: 'shell_command',
      executable: 'printf',
      args: ['%s\n', 'hi'],
      cwd: workDir,
      use_tty: false,
    };

    const result = await runPipeline({ intent, engine: approvalEngine, eventLog });

    // Classification — C0 (printf is informational per classifier rules)
    expect(result.classifiedIntent.risk_class).toBe('C0');

    // Policy — require-approval rule matched
    expect(result.policyOutcome).toBe('require-approval');

    // No mediation in this M1.1 stub — approval flow lands in M3.
    expect(result.executionResult).toBeNull();

    // Witness event ----------------------------------------------------------
    expect(result.witnessEvent.outcome).toBe('denied_by_approval');
    expect(result.witnessEvent.execution_result).toBeNull();
    expect(result.witnessEvent.approval).toBeNull();
    expect(result.witnessEvent.sequence).toBe(0);
    expect(result.witnessEvent.previous_event_hash).toBe(null);
    expect(() => WitnessEventSchema.parse(result.witnessEvent)).not.toThrow();

    // Receipt — execution_result_hash must be null on the require-approval
    // / denied_by_approval branch just like the deny branch.
    expect(() => ExecutionReceiptSchema.parse(result.receipt)).not.toThrow();
    expect(result.receipt.outcome).toBe('denied_by_approval');
    expect(result.receipt.execution_result_hash).toBeNull();
    expect(result.receipt.classified_intent_hash).toBe(
      sha256OfCanonical(result.witnessEvent.classified_intent)
    );
    expect(result.receipt.policy_decision_hash).toBe(
      sha256OfCanonical(result.witnessEvent.policy_decision)
    );

    // verifyReceipt agrees on the require-approval branch.
    expect(verifyReceipt(result.receipt, result.witnessEvent).valid).toBe(true);

    // Chain integrity unaffected.
    const verifyAll = await eventLog.verifyAll();
    expect(verifyAll.valid).toBe(true);
    expect(verifyAll.eventCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Fixture 6 — large-stdout truncation (chain-of-custody preserved)
// ---------------------------------------------------------------------------
//
// Closes m1-e1-coverage-gap-analysis § 3 P1 "large-stdout truncation" — pins
// the BoundedStreamingCapture contract (ADR-0005) end-to-end:
//   - total_bytes equals the underlying file size (>128 KB)
//   - head_bytes = HEAD_TAIL_BYTES (64 KB), tail_bytes = HEAD_TAIL_BYTES (64 KB)
//   - truncated=true, head !== null, tail !== null
//   - content_hash matches sha256 of the full underlying content
//     (so verifiable replay against the source artifact remains possible
//     even though only the head/tail are surfaced)
//   - witness event + receipt remain schema-valid и hash-aligned

describe('pipeline-integration — large-stdout truncation (cat C0, >128 KB)', () => {
  it('captures bounded head/tail с truncated=true и full-content hash', async () => {
    // Build a deterministic >128 KB payload. The BoundedStreamingCapture
    // head+tail budget is 64 KB + 64 KB. Use 256 KB so truncation is
    // unambiguous и tail does not overlap head.
    const HEAD_TAIL_BYTES = 64 * 1024;
    const PAYLOAD_BYTES = 256 * 1024;
    const payload = Buffer.alloc(PAYLOAD_BYTES);
    for (let i = 0; i < PAYLOAD_BYTES; i++) {
      // Printable ASCII so head/tail remain valid UTF-8 (no replacement chars).
      payload[i] = 0x41 + (i % 26); // 'A'..'Z'
    }
    const targetPath = join(workDir, 'big.txt');
    writeFileSync(targetPath, payload);
    const expectedHash = createHash('sha256').update(payload).digest('hex');

    const intent: Intent = {
      action_type: 'shell_command',
      executable: 'cat',
      args: [targetPath],
      cwd: workDir,
      use_tty: false,
    };

    const result = await runPipeline({ intent, engine, eventLog });

    // Stage outputs ----------------------------------------------------------
    expect(result.classifiedIntent.risk_class).toBe('C0');
    expect(result.policyOutcome).toBe('allow');

    expect(result.executionResult).not.toBeNull();
    expect(result.executionResult!.spawn_error).toBe(null);
    expect(result.executionResult!.exit_code).toBe(0);

    // Truncation contract ----------------------------------------------------
    const stdout = result.executionResult!.stdout;
    expect(stdout.total_bytes).toBe(PAYLOAD_BYTES);
    expect(stdout.truncated).toBe(true);
    expect(stdout.head_bytes).toBe(HEAD_TAIL_BYTES);
    expect(stdout.tail_bytes).toBe(HEAD_TAIL_BYTES);
    expect(stdout.head).not.toBeNull();
    expect(stdout.tail).not.toBeNull();
    expect(Buffer.byteLength(stdout.head!, 'utf8')).toBe(HEAD_TAIL_BYTES);
    expect(Buffer.byteLength(stdout.tail!, 'utf8')).toBe(HEAD_TAIL_BYTES);

    // head should be the first HEAD_TAIL_BYTES bytes of the payload, и
    // tail should be the last HEAD_TAIL_BYTES bytes — verify byte-exact.
    expect(stdout.head).toBe(
      payload.subarray(0, HEAD_TAIL_BYTES).toString('utf8')
    );
    expect(stdout.tail).toBe(
      payload.subarray(PAYLOAD_BYTES - HEAD_TAIL_BYTES).toString('utf8')
    );

    // Full-content hash (NOT head+tail concat) — guarantees verifiable
    // replay against the source artifact.
    expect(stdout.content_hash).toBe(expectedHash);

    // Witness event + receipt remain schema-valid and hash-aligned.
    expect(() => WitnessEventSchema.parse(result.witnessEvent)).not.toThrow();
    expect(result.witnessEvent.outcome).toBe('allowed_executed');
    expect(() => ExecutionReceiptSchema.parse(result.receipt)).not.toThrow();
    expect(result.receipt.execution_result_hash).toBe(
      sha256OfCanonical(result.witnessEvent.execution_result!)
    );
    expect(verifyReceipt(result.receipt, result.witnessEvent).valid).toBe(true);

    // Chain integrity preserved over a truncated-stdout event.
    const verifyAll = await eventLog.verifyAll();
    expect(verifyAll.valid).toBe(true);
    expect(verifyAll.eventCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Fixture 7 — deny-by-policy file_read (C3, credentials path)
// ---------------------------------------------------------------------------
//
// Closes m1-e1-coverage-gap-analysis § 3 P1 "deny path" parity for file_read
// (fixture 3 covered shell_command deny). Verifies that:
//   - classifier detects C3 for credential-shaped paths (regex match on
//     `/\.(ssh\/|gnupg\/|aws\/credentials|netrc)`) without the path having to
//     exist on disk
//   - no allow rule in ALLOW_INFORMATIONAL_PACK matches → default_decision='deny'
//   - mediateFileRead is never called (execution_result=null)
//   - witness event и receipt remain schema-valid с null exec hash
//
// Intent: read `${workDir}/.ssh/id_rsa` — credentials-like path; classifier
// regex matches; file existence не нужно потому что policy denies first.

describe('pipeline-integration — deny-by-policy file_read (C3 credentials path)', () => {
  it('classifies C3, denies before mediator, emits schema-valid receipt с null exec hash', async () => {
    const intent: Intent = {
      action_type: 'file_read',
      path: join(workDir, '.ssh', 'id_rsa'),
    };

    const result = await runPipeline({ intent, engine, eventLog });

    // Classification — C3 (credentials-file regex)
    expect(result.classifiedIntent.risk_class).toBe('C3');
    expect(result.classifiedIntent.classification_reasons).toContain(
      'read from credentials file'
    );

    // Policy — no allow rule matched (allow-c0-file-read requires C0) →
    // default_decision='deny' fires.
    expect(result.policyOutcome).toBe('deny');

    // Mediator never invoked.
    expect(result.executionResult).toBeNull();

    // Witness event ----------------------------------------------------------
    expect(result.witnessEvent.outcome).toBe('denied_by_policy');
    expect(result.witnessEvent.execution_result).toBeNull();
    expect(result.witnessEvent.approval).toBeNull();
    expect(result.witnessEvent.sequence).toBe(0);
    expect(result.witnessEvent.previous_event_hash).toBe(null);
    expect(() => WitnessEventSchema.parse(result.witnessEvent)).not.toThrow();

    // Receipt — execution_result_hash null on the deny branch.
    expect(() => ExecutionReceiptSchema.parse(result.receipt)).not.toThrow();
    expect(result.receipt.outcome).toBe('denied_by_policy');
    expect(result.receipt.execution_result_hash).toBeNull();
    expect(result.receipt.classified_intent_hash).toBe(
      sha256OfCanonical(result.witnessEvent.classified_intent)
    );
    expect(result.receipt.policy_decision_hash).toBe(
      sha256OfCanonical(result.witnessEvent.policy_decision)
    );
    expect(verifyReceipt(result.receipt, result.witnessEvent).valid).toBe(true);

    // Chain integrity holds across deny-on-file_read.
    const verifyAll = await eventLog.verifyAll();
    expect(verifyAll.valid).toBe(true);
    expect(verifyAll.eventCount).toBe(1);
  });
});
