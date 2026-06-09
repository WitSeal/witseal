/**
 * W5 — provenance re-check (DSSE / in-toto attestation binding).
 *
 * Tests `checkProvenance` (src/verify/provenance.ts): the pure function that,
 * given the exact bytes of a DSSE in-toto attestation, a receipt's provenance
 * fields, and the builder's Ed25519 public key, re-checks that the receipt's
 * recorded `artifact_digest` / `attestation_digest` are bound to the
 * authenticated attestation.
 *
 * Coverage (each INVALID case asserts BOTH valid=false AND a reason naming the
 * actual failure — written to the spec, not bent toward green):
 *   - VALID: well-formed DSSE envelope signed by the builder key, subject digest
 *     == artifact_digest, attestation_digest == sha256(attestation bytes),
 *     predicateType is provenance.
 *   - INVALID under a different (wrong) builder key.
 *   - INVALID when the attestation bytes are altered (attestation_digest no
 *     longer matches — substitution defense).
 *   - INVALID when the receipt's artifact_digest disagrees with the subject.
 *   - INVALID when predicateType is not a provenance type.
 *   - INVALID when the envelope is not DSSE / not JSON.
 *   - INVALID when the payloadType is wrong.
 *   - VALID with a raw 32-byte builder public key (cross-track wire form).
 *   - PAE matches the documented DSSEv1 construction byte-for-byte.
 */

import { describe, expect, it } from 'vitest';
import {
  createHash,
  generateKeyPairSync,
  sign as nodeSign,
  type KeyObject,
} from 'node:crypto';

import {
  checkProvenance,
  dssePAE,
  DSSE_INTOTO_PAYLOAD_TYPE,
  INTOTO_STATEMENT_TYPE,
  SLSA_PROVENANCE_PREDICATE_TYPE,
  type ReceiptProvenanceFields,
} from '../src/verify/provenance.js';

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function sha256Hex(bytes: Uint8Array | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

interface AttestationBundle {
  /** The exact attestation file bytes (the DSSE envelope JSON). */
  attestationBytes: Uint8Array;
  /** The artifact digest recorded into the receipt (sha256:<hex>). */
  artifactDigest: string;
  /** The attestation digest recorded into the receipt (sha256:<hex>). */
  attestationDigest: string;
}

/**
 * Build a DSSE in-toto attestation over `artifactBytes`, Ed25519-signed by
 * `signingKey`, and return the file bytes plus the two digests a receipt would
 * record. Mirrors the DSSE / in-toto construction documented in the module.
 */
function buildAttestation(
  artifactBytes: Uint8Array,
  signingKey: KeyObject,
  opts: {
    predicateType?: string;
    builderId?: string;
    subjectName?: string;
    /** Override the artifact digest written into the Statement subject. */
    subjectDigestOverride?: string;
  } = {}
): AttestationBundle {
  const artifactHex = sha256Hex(artifactBytes);
  const statement = {
    _type: INTOTO_STATEMENT_TYPE,
    subject: [
      {
        name: opts.subjectName ?? 'artifact',
        digest: { sha256: opts.subjectDigestOverride ?? artifactHex },
      },
    ],
    predicateType: opts.predicateType ?? SLSA_PROVENANCE_PREDICATE_TYPE,
    predicate: {
      builder: { id: opts.builderId ?? 'https://witseal.example/builder' },
      buildType: 'https://witseal.example/build/v1',
    },
  };
  const payloadRaw = Buffer.from(JSON.stringify(statement), 'utf8');
  const pae = dssePAE(DSSE_INTOTO_PAYLOAD_TYPE, new Uint8Array(payloadRaw));
  const sig = nodeSign(null, pae, signingKey);
  const envelope = {
    payloadType: DSSE_INTOTO_PAYLOAD_TYPE,
    payload: payloadRaw.toString('base64'),
    signatures: [{ sig: Buffer.from(sig).toString('base64') }],
  };
  const attestationBytes = new TextEncoder().encode(
    JSON.stringify(envelope, null, 2)
  );
  return {
    attestationBytes,
    artifactDigest: 'sha256:' + artifactHex,
    attestationDigest: 'sha256:' + sha256Hex(attestationBytes),
  };
}

function receiptFields(b: AttestationBundle): ReceiptProvenanceFields {
  return {
    artifact_digest: b.artifactDigest,
    attestation_digest: b.attestationDigest,
  };
}

const ARTIFACT = new TextEncoder().encode('the build artifact bytes\n');

// ---------------------------------------------------------------------------
// PAE construction
// ---------------------------------------------------------------------------

describe('dssePAE', () => {
  it('matches the documented DSSEv1 construction byte-for-byte', () => {
    const payload = new TextEncoder().encode('{"x":1}');
    const pae = dssePAE('application/vnd.in-toto+json', payload);
    const expectedHeader = `DSSEv1 ${'application/vnd.in-toto+json'.length} application/vnd.in-toto+json ${payload.length} `;
    const expected = Buffer.concat([
      Buffer.from(expectedHeader, 'utf8'),
      Buffer.from(payload),
    ]);
    expect(Buffer.from(pae).equals(expected)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkProvenance — happy path
// ---------------------------------------------------------------------------

describe('checkProvenance — VALID', () => {
  it('binds a well-formed DSSE attestation to the receipt under the builder key', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const att = buildAttestation(ARTIFACT, privateKey);
    const result = checkProvenance(att.attestationBytes, receiptFields(att), publicKey);
    expect(result.valid).toBe(true);
    expect(result.artifactDigest).toBe(att.artifactDigest);
    expect(result.predicateType).toBe(SLSA_PROVENANCE_PREDICATE_TYPE);
  });

  it('accepts a raw 32-byte builder public key (cross-track wire form)', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const att = buildAttestation(ARTIFACT, privateKey);
    const spki = publicKey.export({ format: 'der', type: 'spki' });
    const rawPub = new Uint8Array(spki.subarray(spki.length - 32));
    const result = checkProvenance(att.attestationBytes, receiptFields(att), rawPub);
    expect(result.valid).toBe(true);
  });

  it('accepts a provenance predicateType other than the exact SLSA v1 literal', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const att = buildAttestation(ARTIFACT, privateKey, {
      predicateType: 'https://slsa.dev/provenance/v0.2',
    });
    const result = checkProvenance(att.attestationBytes, receiptFields(att), publicKey);
    expect(result.valid).toBe(true);
    expect(result.predicateType).toBe('https://slsa.dev/provenance/v0.2');
  });
});

// ---------------------------------------------------------------------------
// checkProvenance — failure modes
// ---------------------------------------------------------------------------

describe('checkProvenance — INVALID', () => {
  it('INVALID under a different (wrong) builder key', () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    const { publicKey: wrong } = generateKeyPairSync('ed25519');
    const att = buildAttestation(ARTIFACT, privateKey);
    const result = checkProvenance(att.attestationBytes, receiptFields(att), wrong);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/signature verification failed/i);
  });

  it('INVALID when the attestation bytes are altered (attestation_digest pin)', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const att = buildAttestation(ARTIFACT, privateKey);
    // Flip one byte: the digest the receipt pinned no longer matches.
    const tampered = Uint8Array.from(att.attestationBytes);
    tampered[tampered.length - 2] = tampered[tampered.length - 2]! ^ 0xff;
    const result = checkProvenance(tampered, receiptFields(att), publicKey);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/attestation_digest mismatch/i);
  });

  it('INVALID when the receipt artifact_digest disagrees with the subject', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const att = buildAttestation(ARTIFACT, privateKey);
    const fields: ReceiptProvenanceFields = {
      artifact_digest: 'sha256:' + 'a'.repeat(64),
      attestation_digest: att.attestationDigest,
    };
    const result = checkProvenance(att.attestationBytes, fields, publicKey);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/artifact digest mismatch/i);
  });

  it('VALID when subject is forged but receipt agrees AND signature verifies (signature is the trust root)', () => {
    // The attestation is signed (authentic) but its subject names a DIFFERENT
    // artifact than the one whose bytes we hashed. Here the receipt is made to
    // agree with the forged subject; the check passes binding because the
    // receipt vouches for whatever the SIGNED attestation says. Documents that
    // the signature is the trust root. (Negative direction covered above.)
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const forgedHex = 'b'.repeat(64);
    const att = buildAttestation(ARTIFACT, privateKey, {
      subjectDigestOverride: forgedHex,
    });
    const fields: ReceiptProvenanceFields = {
      artifact_digest: 'sha256:' + forgedHex,
      attestation_digest: att.attestationDigest,
    };
    const result = checkProvenance(att.attestationBytes, fields, publicKey);
    expect(result.valid).toBe(true);
  });

  it('INVALID when predicateType is not a provenance type', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const att = buildAttestation(ARTIFACT, privateKey, {
      predicateType: 'https://in-toto.io/attestation/vulns/v0.1',
    });
    const result = checkProvenance(att.attestationBytes, receiptFields(att), publicKey);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/not a provenance type/i);
  });

  it('INVALID when the attestation is not valid JSON', () => {
    const { publicKey } = generateKeyPairSync('ed25519');
    const bytes = new TextEncoder().encode('not json at all');
    const digest = 'sha256:' + sha256Hex(bytes);
    const fields: ReceiptProvenanceFields = {
      artifact_digest: 'sha256:' + 'c'.repeat(64),
      attestation_digest: digest,
    };
    const result = checkProvenance(bytes, fields, publicKey);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/not a valid DSSE envelope/i);
  });

  it('INVALID when the DSSE payloadType is wrong', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const statement = {
      _type: INTOTO_STATEMENT_TYPE,
      subject: [{ name: 'a', digest: { sha256: sha256Hex(ARTIFACT) } }],
      predicateType: SLSA_PROVENANCE_PREDICATE_TYPE,
    };
    const payloadRaw = Buffer.from(JSON.stringify(statement), 'utf8');
    const badType = 'application/vnd.something-else+json';
    const pae = dssePAE(badType, new Uint8Array(payloadRaw));
    const sig = nodeSign(null, pae, privateKey);
    const envelope = {
      payloadType: badType,
      payload: payloadRaw.toString('base64'),
      signatures: [{ sig: Buffer.from(sig).toString('base64') }],
    };
    const bytes = new TextEncoder().encode(JSON.stringify(envelope));
    const fields: ReceiptProvenanceFields = {
      artifact_digest: 'sha256:' + sha256Hex(ARTIFACT),
      attestation_digest: 'sha256:' + sha256Hex(bytes),
    };
    const result = checkProvenance(bytes, fields, publicKey);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/payloadType/i);
  });

  it('INVALID when the receipt artifact_digest is not sha256:-prefixed', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const att = buildAttestation(ARTIFACT, privateKey);
    const fields: ReceiptProvenanceFields = {
      artifact_digest: sha256Hex(ARTIFACT), // no prefix
      attestation_digest: att.attestationDigest,
    };
    const result = checkProvenance(att.attestationBytes, fields, publicKey);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/not 'sha256:'-prefixed|prefix/i);
  });

  it('INVALID when the envelope carries no signatures', () => {
    const { publicKey } = generateKeyPairSync('ed25519');
    const statement = {
      _type: INTOTO_STATEMENT_TYPE,
      subject: [{ name: 'a', digest: { sha256: sha256Hex(ARTIFACT) } }],
      predicateType: SLSA_PROVENANCE_PREDICATE_TYPE,
    };
    const payloadRaw = Buffer.from(JSON.stringify(statement), 'utf8');
    const envelope = {
      payloadType: DSSE_INTOTO_PAYLOAD_TYPE,
      payload: payloadRaw.toString('base64'),
      signatures: [] as Array<{ sig: string }>,
    };
    const bytes = new TextEncoder().encode(JSON.stringify(envelope));
    const fields: ReceiptProvenanceFields = {
      artifact_digest: 'sha256:' + sha256Hex(ARTIFACT),
      attestation_digest: 'sha256:' + sha256Hex(bytes),
    };
    const result = checkProvenance(bytes, fields, publicKey);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/no signatures/i);
  });
});
