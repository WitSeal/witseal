/**
 * W5 — `witseal verify --check-provenance` CLI end-to-end.
 *
 * Drives the BUILT CLI binary (dist/src/cli/index.js) as a subprocess against
 * a REAL signed v0.2 receipt + a REAL DSSE in-toto attestation, asserting:
 *
 *   1. Backward-compat: `witseal verify <receipt> --public-key <pub>` WITHOUT
 *      --check-provenance behaves exactly as before (sig+chain VALID, exit 0,
 *      and emits NO `provenance:` line).
 *   2. Opt-in pass: adding `--check-provenance --attestation <att>
 *      --builder-key <pub>` keeps exit 0 and prints `provenance: VALID …`.
 *   3. Opt-in fail (wrong builder key): exit non-zero, reason names the
 *      signature failure, and the line is `provenance` not the sig path.
 *   4. Opt-in fail (substituted attestation): exit non-zero,
 *      attestation_digest mismatch.
 *   5. --check-provenance without --attestation: clean non-zero error.
 *
 * The receipt is produced via the product evidence-package export path
 * (exportEvidencePackage → generateReceiptByVersion → signReceiptV02) with REAL
 * provenance: git_commit is a real 40-hex, artifact_digest is the sha256 of an
 * actual artifact file, attestation_digest is the sha256 of the actual
 * attestation file, artifact_type=generic-binary.
 *
 * Requires `npm run build` (dist/) — asserts the CLI bundle exists.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { execSync, spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createHash,
  generateKeyPairSync,
  sign as nodeSign,
  type KeyObject,
} from 'node:crypto';

import { classify, CLASSIFIER_VERSION } from '../src/risk/classifier.js';
import { PolicyEngine } from '../src/policy/engine.js';
import { mediateShell } from '../src/execution/mediator.js';
import { EventLog } from '../src/witness/event-log.js';
import { emitWitnessEvent, generateIntentId } from '../src/witness/emit.js';
import { exportEvidencePackage } from '../src/evidence/package.js';

import {
  ClassifiedIntentSchema,
  type ClassifiedIntent,
  type Intent,
} from '../schemas/intent.schema.js';
import { PolicyPackSchema, type PolicyPack } from '../schemas/policy.schema.js';
import type {
  WitnessEvent,
  WitnessOutcome,
} from '../schemas/witness-event.schema.js';
import type { ExecutionReceiptV02 } from '../schemas/receipt-v0.2.schema.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'dist', 'src', 'cli', 'index.js');

const ALLOW_C0_PACK: PolicyPack = PolicyPackSchema.parse({
  schema_version: 'witseal.policy.v0.1',
  pack_id: 'cli-verify-prov-allow',
  version: '0.1.0',
  description: 'Allow C0 shell for provenance CLI test.',
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

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Build a DSSE in-toto provenance attestation file over `artifactBytes`. */
function buildAttestationBytes(
  artifactBytes: Buffer,
  signingKey: KeyObject
): Buffer {
  const statement = {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [
      { name: 'artifact.bin', digest: { sha256: sha256Hex(artifactBytes) } },
    ],
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: {
      builder: { id: 'https://witseal.example/builders/github-actions' },
      buildType: 'https://witseal.example/build/v1',
    },
  };
  const payloadRaw = Buffer.from(JSON.stringify(statement), 'utf8');
  // DSSE PAE: "DSSEv1 " + len(type) + " " + type + " " + len(payload) + " " + payload
  const payloadType = 'application/vnd.in-toto+json';
  const header = Buffer.from(
    `DSSEv1 ${payloadType.length} ${payloadType} ${payloadRaw.length} `,
    'utf8'
  );
  const pae = Buffer.concat([header, payloadRaw]);
  const sig = nodeSign(null, pae, signingKey);
  const envelope = {
    payloadType,
    payload: payloadRaw.toString('base64'),
    signatures: [{ sig: Buffer.from(sig).toString('base64') }],
  };
  return Buffer.from(JSON.stringify(envelope, null, 2), 'utf8');
}

async function emitOneEvent(
  eventLog: EventLog,
  engine: PolicyEngine,
  workDir: string
): Promise<WitnessEvent> {
  const intent: Intent = {
    action_type: 'shell_command',
    executable: 'echo',
    args: ['provenance-smoke'],
    cwd: workDir,
    use_tty: false,
  };
  const classification = classify(intent);
  const classifiedIntent: ClassifiedIntent = ClassifiedIntentSchema.parse({
    schema_version: 'witseal.intent.v0.1',
    intent_id: generateIntentId(),
    intent,
    risk_class: classification.risk_class,
    classification_reasons: classification.reasons,
    classifier_version: CLASSIFIER_VERSION,
  });
  const policyDecision = engine.evaluate(classifiedIntent);
  const executionResult = await mediateShell(intent);
  const outcome: WitnessOutcome =
    executionResult.exit_code === 0 && executionResult.spawn_error === null
      ? 'allowed_executed'
      : 'allowed_executed_with_error';
  return emitWitnessEvent(eventLog, {
    classifiedIntent,
    policyDecision,
    approval: null,
    executionResult,
    outcome,
    agentIdentifier: 'cli-verify-prov-test',
    classifierVersion: CLASSIFIER_VERSION,
  });
}

interface SmokeArtifacts {
  receiptPath: string;
  attestationPath: string;
  builderPubPath: string;
  receipt: ExecutionReceiptV02;
  gitCommit: string;
}

let workDir: string;
let smoke: SmokeArtifacts;

beforeAll(async () => {
  // CI runs `vitest run` without a prior `npm run build`; this test drives the
  // built dist CLI, so build it on demand when the bundle is missing.
  if (!existsSync(CLI)) {
    execSync('npm run build', { cwd: join(HERE, '..'), stdio: 'ignore' });
  }

  workDir = mkdtempSync(join(tmpdir(), 'witseal-cli-prov-'));

  // 1. A real artifact file + its sha256.
  const artifactBytes = Buffer.from('W5 generic-binary artifact payload\n');
  const artifactPath = join(workDir, 'artifact.bin');
  writeFileSync(artifactPath, artifactBytes);
  const artifactDigest = 'sha256:' + sha256Hex(artifactBytes);

  // 2. Builder key + a DSSE in-toto attestation of the artifact.
  const builder = generateKeyPairSync('ed25519');
  const attestationBytes = buildAttestationBytes(artifactBytes, builder.privateKey);
  const attestationPath = join(workDir, 'attestation.json');
  writeFileSync(attestationPath, attestationBytes);
  const attestationDigest = 'sha256:' + sha256Hex(attestationBytes);

  // Write the builder public key as raw 32-byte hex (a supported CLI form).
  const spki = builder.publicKey.export({ format: 'der', type: 'spki' });
  const rawPubHex = Buffer.from(spki.subarray(spki.length - 32)).toString('hex');
  const builderPubPath = join(workDir, 'builder.pub.hex');
  writeFileSync(builderPubPath, rawPubHex);

  // 3. A REAL v0.2 receipt via the evidence-package export path, signed by the
  //    builder key, carrying the real provenance digests + a real git commit.
  const gitCommit = createHash('sha1')
    .update('W5 commit ' + Date.now())
    .digest('hex'); // 40-hex, NOT all-zeros
  const eventLog = new EventLog({ root: workDir, segmentId: 'default' });
  const engine = new PolicyEngine();
  engine.loadPack(ALLOW_C0_PACK);
  await emitOneEvent(eventLog, engine, workDir);

  const pkg = await exportEvidencePackage(eventLog, [ALLOW_C0_PACK], CLASSIFIER_VERSION, {
    receiptVersion: 'witseal.receipt.v0.2',
    signingKey: builder.privateKey,
    gitCommit,
    artifactDigest,
    attestationDigest,
    artifactType: 'generic-binary',
    buildId: 'witseal-w5-smoke-0001',
  });
  const receipt = pkg.receipts[0]!;
  const receiptPath = join(workDir, 'receipt.v0.2.json');
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');

  smoke = { receiptPath, attestationPath, builderPubPath, receipt, gitCommit };
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

describe('witseal verify --check-provenance (CLI)', () => {
  it('the receipt carries REAL provenance (git_commit != all-zeros)', () => {
    expect(existsSync(CLI)).toBe(true);
    expect(smoke.receipt.schema_version).toBe('witseal.receipt.v0.2');
    expect(smoke.receipt.git_commit).toBe(smoke.gitCommit);
    expect(smoke.receipt.git_commit).not.toBe('0'.repeat(40));
    expect(smoke.receipt.artifact_type).toBe('generic-binary');
    expect(smoke.receipt.artifact_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(smoke.receipt.attestation_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('WITHOUT --check-provenance: sig+chain VALID, exit 0, no provenance line (backward-compat)', () => {
    const r = runCli(['verify', smoke.receiptPath, '--public-key', smoke.builderPubPath]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/VALID ✓ \(receipt\.v0\.2\)/);
    expect(r.stdout).not.toMatch(/provenance:/);
  });

  it('WITH --check-provenance: sig+chain VALID AND provenance VALID, exit 0', () => {
    // --public-key is required for the receipt's OWN v0.2 signature (existing,
    // unchanged behavior); --builder-key authenticates the DSSE envelope. Here
    // the same Ed25519 key signed both the receipt and the attestation, so one
    // key satisfies both. The provenance check is strictly additive on top.
    const r = runCli([
      'verify',
      smoke.receiptPath,
      '--public-key',
      smoke.builderPubPath,
      '--check-provenance',
      '--attestation',
      smoke.attestationPath,
      '--builder-key',
      smoke.builderPubPath,
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/VALID ✓ \(receipt\.v0\.2\)/);
    expect(r.stdout).toMatch(/provenance: VALID \(artifact ↔ attestation bound\)/);
  });

  it('reuses --public-key as the builder key when --builder-key is omitted', () => {
    const r = runCli([
      'verify',
      smoke.receiptPath,
      '--public-key',
      smoke.builderPubPath,
      '--check-provenance',
      '--attestation',
      smoke.attestationPath,
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/provenance: VALID/);
  });

  it('INVALID (exit != 0) under a wrong builder key', () => {
    const { publicKey: wrong } = generateKeyPairSync('ed25519');
    const wrongSpki = wrong.export({ format: 'der', type: 'spki' });
    const wrongHex = Buffer.from(wrongSpki.subarray(wrongSpki.length - 32)).toString('hex');
    const wrongPath = join(workDir, 'wrong.pub.hex');
    writeFileSync(wrongPath, wrongHex);
    const r = runCli([
      'verify',
      smoke.receiptPath,
      '--public-key',
      smoke.builderPubPath,
      '--check-provenance',
      '--attestation',
      smoke.attestationPath,
      '--builder-key',
      wrongPath,
    ]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/provenance/i);
    expect(r.stderr).toMatch(/signature verification failed/i);
  });

  it('INVALID (exit != 0) when the attestation file is substituted', () => {
    const otherArtifact = Buffer.from('a different artifact\n');
    const builder2 = generateKeyPairSync('ed25519');
    const otherAtt = buildAttestationBytes(otherArtifact, builder2.privateKey);
    const otherAttPath = join(workDir, 'other-attestation.json');
    writeFileSync(otherAttPath, otherAtt);
    const r = runCli([
      'verify',
      smoke.receiptPath,
      '--public-key',
      smoke.builderPubPath,
      '--check-provenance',
      '--attestation',
      otherAttPath,
    ]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/attestation_digest mismatch/i);
  });

  it('--check-provenance without --attestation is a clean non-zero error', () => {
    const r = runCli([
      'verify',
      smoke.receiptPath,
      '--public-key',
      smoke.builderPubPath,
      '--check-provenance',
    ]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/--attestation/);
  });
});
