/**
 * Execution Receipt schema — v0.2.
 *
 * Discriminant: `witseal.receipt.v0.2`.
 *
 * Adds to v0.1:
 *   - `signature`            Ed25519 signature over the canonical receipt
 *                            with `signature = ""` (empty-string sentinel,
 *                            NOT field-removal). Algorithm-prefixed: the final
 *                            populated value is `ed25519:` + base64 RFC 4648
 *                            § 4 standard alphabet, padded. The prefix is
 *                            present only in the final wire value; during
 *                            pre-image construction `signature = ""`.
 *   - `git_commit`           Bare 40-char lowercase SHA-1 hex (no `git:` prefix).
 *   - `artifact_digest`      `sha256:` prefix + 64-hex.
 *   - `attestation_digest`   `sha256:` prefix + 64-hex.
 *   - `artifact_type`        Closed kebab-case artifact taxonomy literal;
 *                            e.g. `generic-binary`.
 *   - `build_id`             Free-form build-context identifier.
 *   - `prev_hash`            Nullable-mandatory chain-segment linkage:
 *                            `receipt_hash` of the immediately preceding
 *                            receipt in the same segment, or `null` at
 *                            chain-segment genesis (genesis-null convention).
 *   - `receipt_id` is nullable-mandatory: `null` for the
 *                            `execution_lost` outcome, else
 *                            `^rcpt_[0-9a-zA-Z]{20,}$`.
 *
 * Serialize-skip optionals (omit when absent — must NOT serialize as
 * `null`):
 *   - `sigstore_signature`   Reserved for keyless signing in later milestone.
 *   - `classifier_version`   Optional provenance pointer.
 *   - `shadow_mode`          Optional boolean.
 *
 * Cross-track parity: this schema mirrors the canonical receipt struct of the
 * reference Rust implementation. The field set is a closed 17-field canon
 * (mandatory wire fields plus the serialize-skip optionals above) with the
 * genesis-null chain linkage convention.
 *
 * Schema-alignment note: `artifact_type` and `build_id` are mandatory wire
 * fields. They are present in the canonical receipt and in the golden receipt
 * fixture (`tests/fixtures/golden-receipt/rust-golden.json`); both are
 * validated here so the TS schema covers all 17 canonical fields.
 */

import { z } from 'zod';

const Sha256Hex = z.string().regex(/^[a-f0-9]{64}$/);
const Sha1HexLower = z.string().regex(/^[a-f0-9]{40}$/);
const Sha256Prefixed = z.string().regex(/^sha256:[a-f0-9]{64}$/);
/**
 * `artifact_type` — closed artifact taxonomy.
 *
 * Wire form: a kebab-case taxonomy literal (e.g. `generic-binary`). In the
 * authoritative Rust struct this is a closed enum whose variants serialize to
 * lowercase kebab-case strings (NOT snake_case — `outcome` uses snake_case,
 * `artifact_type` uses kebab-case; each enum emits per its own scheme).
 *
 * The authoritative closed variant set is not published in this reference
 * repo, so — mirroring how `outcome` models its enum as a constrained string
 * rather than hard-coding an incomplete `z.enum([...])` — this validates the
 * kebab-case SHAPE of the taxonomy literal. That accepts every present +
 * future variant without over-narrowing to the single `generic-binary` value
 * observable in this repo (which would risk a fresh cross-track parity defect
 * on a valid receipt).
 */
const ArtifactType = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
/**
 * Algorithm-prefixed Ed25519 signature.
 *
 * Form: `ed25519:` + base64(64 raw signature bytes), standard alphabet, padded.
 * Total length: 8 (prefix) + 88 (base64) = 96 chars.
 *
 * The prefix mirrors the digest prefix (`sha256:<hex>`). In schema version
 * 0.2 the only permitted algorithm tag is `ed25519`; any other prefix is a
 * schema-level violation (v0.2 verifiers MUST treat such a receipt as
 * malformed, distinct from "invalid signature").
 *
 * The prefix appears only in the final, populated `signature` field value.
 * During pre-image construction `signature` is the empty-string sentinel,
 * unaffected by this prefix.
 */
const Ed25519PrefixedSignature = z
  .string()
  .regex(/^ed25519:[A-Za-z0-9+/]{86}==$/);
const ReceiptId = z.string().regex(/^rcpt_[0-9a-zA-Z]{20,}$/);
const WitnessEventId = z.string().regex(/^evt_[0-9a-zA-Z]{20,}$/);

export const ExecutionReceiptV02Schema = z.object({
  schema_version: z.literal('witseal.receipt.v0.2'),

  /** Nullable-mandatory. `null` for the `execution_lost` outcome. */
  receipt_id: ReceiptId.nullable(),

  witness_event_id: WitnessEventId,
  chain_segment_id: z.string().min(1),
  finalized_at: z.string().datetime({ offset: false }),

  /** Self-hash over canonical body minus `{receipt_hash}`, with
   *  `signature = ""` (empty-string sentinel during pre-image build). */
  receipt_hash: Sha256Hex,

  policy_decision_hash: Sha256Hex,
  classified_intent_hash: Sha256Hex,
  /** Null for denied actions (no execution to hash). */
  execution_result_hash: Sha256Hex.nullable(),

  outcome: z.string(),

  /** Receipt-level chain-segment linkage. `null` at chain-segment genesis
   *  (genesis-null convention). */
  prev_hash: Sha256Hex.nullable(),

  /** Algorithm-prefixed Ed25519 signature:
   *  `ed25519:` + base64 std-padded 64 raw signature bytes (88 base64 chars →
   *  96 chars total). The prefix mirrors the digest prefix and exists so future
   *  algorithm changes are v0.2-compatible extensions rather than wire breaks. */
  signature: Ed25519PrefixedSignature,

  /** Build provenance (M9 populates from real build context). */
  git_commit: Sha1HexLower,
  artifact_digest: Sha256Prefixed,
  attestation_digest: Sha256Prefixed,

  /** Artifact taxonomy. Closed kebab-case enum in the Rust authority; modeled
   *  here as the kebab-case taxonomy shape. Mandatory wire field (present +
   *  non-null in the canonical receipt; not a serialize-skip optional). */
  artifact_type: ArtifactType,

  /** Build identifier. Free-form build-context string,
   *  e.g. `github-actions-<run_id>-<run_attempt>` in CI or
   *  `local-dev-<user>-<host>-<unix>` for local builds. Mandatory wire field
   *  (present + non-null in the canonical receipt; not a serialize-skip optional). */
  build_id: z.string().min(1),

  /** Serialize-skip: omit field entirely if absent (do not emit `null`). */
  sigstore_signature: z.string().min(1).optional(),
  classifier_version: z.string().min(1).optional(),
  shadow_mode: z.boolean().optional(),
});

export type ExecutionReceiptV02 = z.infer<typeof ExecutionReceiptV02Schema>;

/** Receipt draft prior to `receipt_hash` computation. The signing pre-image
 *  is constructed from this draft with `signature` set to the empty string
 *  (empty-string sentinel). */
export type ExecutionReceiptV02Draft = Omit<ExecutionReceiptV02, 'receipt_hash'>;
