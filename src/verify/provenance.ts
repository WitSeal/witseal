/**
 * Provenance re-check — DSSE / in-toto attestation binding (W5).
 *
 * An ADDITIVE, opt-in verification layer for `witseal verify`. It does NOT
 * touch the receipt schema, the receipt canon, or the existing
 * signature/chain verification. The v0.2 receipt already carries the
 * build-provenance fields (`git_commit`, `artifact_digest`,
 * `attestation_digest`, `build_id`, `artifact_type`) as mandatory wire fields;
 * this module re-checks that those recorded digests are actually bound to a
 * supplied DSSE in-toto attestation, signed by the builder's Ed25519 key.
 *
 * What this proves, given a receipt + an attestation file + the builder's
 * public key:
 *
 *   (a) The DSSE envelope's Ed25519 signature over the PAE pre-authentication
 *       encoding verifies under the builder key — the attestation is authentic.
 *   (b) The envelope payload decodes to an in-toto Statement.
 *   (c) The Statement's subject digest (`subject[0].digest.sha256`) equals the
 *       receipt's `artifact_digest` (with the `sha256:` prefix stripped) — the
 *       attestation describes the SAME artifact the receipt vouches for.
 *   (d) `sha256:` + sha256(attestation-bytes) equals the receipt's
 *       `attestation_digest` — the receipt is pinned to THIS exact attestation
 *       file (no substitution).
 *   (e) The Statement's `predicateType` is a provenance type.
 *
 * Pure functions — no file I/O. The CLI layer reads the attestation bytes and
 * supplies the builder public key.
 *
 * ─── DSSE envelope ───────────────────────────────────────────────────────────
 *
 *   { payloadType: "application/vnd.in-toto+json",
 *     payload: base64(statement_json_bytes),
 *     signatures: [ { sig: base64(ed25519_sig) }, ... ] }
 *
 * The signature is Ed25519 over the DSSE Pre-Authentication Encoding (PAE):
 *
 *   PAE = "DSSEv1 " + len(payloadType) + " " + payloadType
 *                   + " " + len(payload_raw_bytes) + " " + payload_raw_bytes
 *
 * where `payload_raw_bytes` is the base64-DECODED payload (the Statement JSON
 * bytes) and the lengths are the byte lengths in ASCII decimal. This mirrors
 * the in-toto / sigstore DSSE PAE construction.
 */

import { createHash, verify as nodeVerify, createPublicKey } from 'node:crypto';
import type { KeyObject } from 'node:crypto';

/** DSSE payloadType for an in-toto Statement. */
export const DSSE_INTOTO_PAYLOAD_TYPE = 'application/vnd.in-toto+json';

/** in-toto Statement `_type` for the v1 statement. */
export const INTOTO_STATEMENT_TYPE = 'https://in-toto.io/Statement/v1';

/**
 * Recognized provenance predicate types. The SLSA provenance predicate is the
 * canonical one; the check (e) accepts any predicateType whose value indicates
 * provenance (contains `provenance`), so future provenance predicate versions
 * are accepted without a code change — mirroring how the receipt schema models
 * open taxonomies by shape rather than a hard-coded closed literal.
 */
export const SLSA_PROVENANCE_PREDICATE_TYPE = 'https://slsa.dev/provenance/v1';

/** Result of a provenance re-check: a single verdict plus a precise reason. */
export interface ProvenanceCheckResult {
  valid: boolean;
  /** Precise human-readable reason on failure. */
  reason?: string;
  /** The artifact digest (with prefix) the attestation+receipt agreed on. */
  artifactDigest?: string;
  /** The predicateType read off the in-toto Statement. */
  predicateType?: string;
}

/** Minimal shape of the inputs the provenance re-check needs off the receipt. */
export interface ReceiptProvenanceFields {
  artifact_digest: string;
  attestation_digest: string;
}

interface DsseEnvelope {
  payloadType: string;
  payload: string;
  signatures: Array<{ sig: string; keyid?: string }>;
}

interface InTotoStatement {
  _type: string;
  subject: Array<{ name?: string; digest: Record<string, string> }>;
  predicateType: string;
  predicate?: unknown;
}

/**
 * Build the DSSE Pre-Authentication Encoding (PAE) bytes.
 *
 *   "DSSEv1 " + len(payloadType) + " " + payloadType
 *             + " " + len(payload) + " " + payload
 *
 * Lengths are ASCII-decimal byte lengths. `payload` is the RAW (base64-decoded)
 * payload bytes — the in-toto Statement JSON bytes.
 */
export function dssePAE(payloadType: string, payload: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(payloadType);
  const header = new TextEncoder().encode(
    `DSSEv1 ${typeBytes.length} ${payloadType} ${payload.length} `
  );
  const out = new Uint8Array(header.length + payload.length);
  out.set(header, 0);
  out.set(payload, header.length);
  return out;
}

/**
 * Re-check that a receipt's recorded provenance digests are bound to a supplied
 * DSSE in-toto attestation, authenticated by the builder's Ed25519 public key.
 *
 * Steps (all must pass):
 *   (a) Parse the DSSE envelope; verify its Ed25519 signature over the PAE
 *       against `builderKey`. At least one signature must verify.
 *   (b) base64-decode the payload to the in-toto Statement; parse it.
 *   (c) `subject[0].digest.sha256` === receipt.artifact_digest (prefix stripped).
 *   (d) `sha256:` + sha256(attestationBytes) === receipt.attestation_digest.
 *   (e) Statement.predicateType is a provenance type.
 *
 * @param attestationBytes the EXACT bytes of the attestation file (these are
 *        what `attestation_digest` is computed over — read them verbatim).
 * @param receipt          the receipt's provenance fields.
 * @param builderKey       the builder's Ed25519 public key (KeyObject, PEM
 *        string, or raw 32-byte key).
 */
export function checkProvenance(
  attestationBytes: Uint8Array,
  receipt: ReceiptProvenanceFields,
  builderKey: KeyObject | string | Uint8Array
): ProvenanceCheckResult {
  // (d') Pin the receipt to THIS exact attestation file FIRST: the
  // attestation_digest must match sha256 of the supplied bytes. This rejects a
  // substituted attestation before any of its (now-untrusted) contents are
  // interpreted.
  const attDigest =
    'sha256:' + createHash('sha256').update(attestationBytes).digest('hex');
  if (attDigest !== receipt.attestation_digest) {
    return {
      valid: false,
      reason: `attestation_digest mismatch: receipt records ${receipt.attestation_digest}, supplied attestation hashes to ${attDigest}`,
    };
  }

  // Parse the DSSE envelope.
  let envelope: DsseEnvelope;
  try {
    const parsed: unknown = JSON.parse(
      new TextDecoder().decode(attestationBytes)
    );
    envelope = asEnvelope(parsed);
  } catch (err: unknown) {
    return {
      valid: false,
      reason: `attestation is not a valid DSSE envelope: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (envelope.payloadType !== DSSE_INTOTO_PAYLOAD_TYPE) {
    return {
      valid: false,
      reason: `unexpected DSSE payloadType '${envelope.payloadType}' (expected '${DSSE_INTOTO_PAYLOAD_TYPE}')`,
    };
  }

  // Decode the payload (raw Statement bytes) and build the PAE.
  let payloadRaw: Buffer;
  try {
    payloadRaw = Buffer.from(envelope.payload, 'base64');
  } catch {
    return { valid: false, reason: 'DSSE payload is not valid base64' };
  }
  const pae = dssePAE(envelope.payloadType, payloadRaw);

  // (a) Verify the Ed25519 signature over the PAE. At least one signature in
  // the envelope must verify under the builder key.
  let key: KeyObject;
  try {
    key = coercePublicKey(builderKey);
  } catch (err: unknown) {
    return {
      valid: false,
      reason: `could not load builder public key: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (envelope.signatures.length === 0) {
    return { valid: false, reason: 'DSSE envelope carries no signatures' };
  }
  let anySigValid = false;
  for (const s of envelope.signatures) {
    let sigBytes: Buffer;
    try {
      sigBytes = Buffer.from(s.sig, 'base64');
    } catch {
      continue;
    }
    if (nodeVerify(null, pae, key, sigBytes)) {
      anySigValid = true;
      break;
    }
  }
  if (!anySigValid) {
    return {
      valid: false,
      reason: 'DSSE signature verification failed (no signature verifies under the builder key)',
    };
  }

  // (b) Parse the in-toto Statement.
  let statement: InTotoStatement;
  try {
    statement = asStatement(JSON.parse(payloadRaw.toString('utf8')));
  } catch (err: unknown) {
    return {
      valid: false,
      reason: `DSSE payload is not a valid in-toto Statement: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (statement._type !== INTOTO_STATEMENT_TYPE) {
    return {
      valid: false,
      reason: `unexpected in-toto Statement _type '${statement._type}' (expected '${INTOTO_STATEMENT_TYPE}')`,
    };
  }

  // (e) predicateType must be a provenance type.
  if (!isProvenancePredicate(statement.predicateType)) {
    return {
      valid: false,
      reason: `predicateType '${statement.predicateType}' is not a provenance type`,
      predicateType: statement.predicateType,
    };
  }

  // (c) subject[0].digest.sha256 must equal the receipt's artifact_digest with
  // the `sha256:` prefix stripped.
  const subject = statement.subject[0];
  if (subject === undefined) {
    return { valid: false, reason: 'in-toto Statement has an empty subject array' };
  }
  const subjectSha256 = subject.digest['sha256'];
  if (typeof subjectSha256 !== 'string') {
    return {
      valid: false,
      reason: 'in-toto Statement subject[0] has no sha256 digest',
    };
  }
  const receiptArtifactHex = stripSha256Prefix(receipt.artifact_digest);
  if (receiptArtifactHex === undefined) {
    return {
      valid: false,
      reason: `receipt artifact_digest '${receipt.artifact_digest}' is not 'sha256:'-prefixed`,
    };
  }
  if (subjectSha256.toLowerCase() !== receiptArtifactHex.toLowerCase()) {
    return {
      valid: false,
      reason: `artifact digest mismatch: receipt records ${receipt.artifact_digest}, attestation subject is sha256:${subjectSha256}`,
    };
  }

  return {
    valid: true,
    artifactDigest: receipt.artifact_digest,
    predicateType: statement.predicateType,
  };
}

/** Strip a leading `sha256:` from a digest string; undefined if not prefixed. */
function stripSha256Prefix(digest: string): string | undefined {
  const prefix = 'sha256:';
  return digest.startsWith(prefix) ? digest.slice(prefix.length) : undefined;
}

/** A predicateType counts as provenance if it names provenance. */
function isProvenancePredicate(predicateType: string): boolean {
  if (predicateType === SLSA_PROVENANCE_PREDICATE_TYPE) return true;
  return /provenance/i.test(predicateType);
}

function asEnvelope(value: unknown): DsseEnvelope {
  if (typeof value !== 'object' || value === null) {
    throw new Error('not a JSON object');
  }
  const v = value as Record<string, unknown>;
  if (typeof v['payloadType'] !== 'string') {
    throw new Error('missing or non-string payloadType');
  }
  if (typeof v['payload'] !== 'string') {
    throw new Error('missing or non-string payload');
  }
  if (!Array.isArray(v['signatures'])) {
    throw new Error('missing or non-array signatures');
  }
  const signatures: Array<{ sig: string; keyid?: string }> = [];
  for (const s of v['signatures']) {
    if (typeof s !== 'object' || s === null) {
      throw new Error('signature entry is not an object');
    }
    const sig = (s as Record<string, unknown>)['sig'];
    if (typeof sig !== 'string') {
      throw new Error('signature entry missing string sig');
    }
    const keyid = (s as Record<string, unknown>)['keyid'];
    signatures.push(
      typeof keyid === 'string' ? { sig, keyid } : { sig }
    );
  }
  return {
    payloadType: v['payloadType'],
    payload: v['payload'],
    signatures,
  };
}

function asStatement(value: unknown): InTotoStatement {
  if (typeof value !== 'object' || value === null) {
    throw new Error('not a JSON object');
  }
  const v = value as Record<string, unknown>;
  if (typeof v['_type'] !== 'string') {
    throw new Error('missing or non-string _type');
  }
  if (typeof v['predicateType'] !== 'string') {
    throw new Error('missing or non-string predicateType');
  }
  if (!Array.isArray(v['subject'])) {
    throw new Error('missing or non-array subject');
  }
  const subject: Array<{ name?: string; digest: Record<string, string> }> = [];
  for (const s of v['subject']) {
    if (typeof s !== 'object' || s === null) {
      throw new Error('subject entry is not an object');
    }
    const digest = (s as Record<string, unknown>)['digest'];
    if (typeof digest !== 'object' || digest === null) {
      throw new Error('subject entry missing digest object');
    }
    const digestMap: Record<string, string> = {};
    for (const [k, val] of Object.entries(digest as Record<string, unknown>)) {
      if (typeof val === 'string') digestMap[k] = val;
    }
    const name = (s as Record<string, unknown>)['name'];
    subject.push(
      typeof name === 'string'
        ? { name, digest: digestMap }
        : { digest: digestMap }
    );
  }
  return {
    _type: v['_type'],
    subject,
    predicateType: v['predicateType'],
    predicate: v['predicate'],
  };
}

/**
 * Coerce builder key material to a Node public KeyObject. Accepts a KeyObject,
 * a PEM string, or a raw 32-byte Ed25519 public key (Uint8Array). Mirrors the
 * key coercion in `sign-v0.2.ts` so the same key families work here.
 */
function coercePublicKey(k: KeyObject | string | Uint8Array): KeyObject {
  if (typeof k === 'object' && k !== null && 'asymmetricKeyType' in k) {
    return k as KeyObject;
  }
  if (typeof k === 'string') {
    return createPublicKey(k);
  }
  if (k instanceof Uint8Array && k.length === 32) {
    const spki = Buffer.concat([
      Buffer.from('302a300506032b6570032100', 'hex'),
      Buffer.from(k),
    ]);
    return createPublicKey({ key: spki, format: 'der', type: 'spki' });
  }
  throw new Error('unsupported builder key material');
}
