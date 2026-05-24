/**
 * Execution Receipt schema — v0.2.
 *
 * Discriminant: `witseal.receipt.v0.2`.
 *
 * Adds to v0.1:
 *   - `signature`            Ed25519 signature over the canonical receipt
 *                            with `signature = ""` (R-3 empty-string sentinel,
 *                            NOT field-removal). Algorithm-prefixed per
 *                            RFC-002 §6 amendment (2026-05-23): the final
 *                            populated value is `ed25519:` + base64 RFC 4648
 *                            § 4 standard alphabet, padded. The prefix is
 *                            present only in the final wire value; during
 *                            pre-image construction `signature = ""`.
 *   - `git_commit`           Bare 40-char lowercase SHA-1 hex (no `git:` prefix).
 *   - `artifact_digest`      `sha256:` prefix + 64-hex.
 *   - `attestation_digest`   `sha256:` prefix + 64-hex.
 *   - `prev_hash`            Nullable-mandatory chain-segment linkage:
 *                            `receipt_hash` of the immediately preceding
 *                            receipt in the same segment, or `null` at
 *                            chain-segment genesis (Option B, founder-ratified).
 *   - `receipt_id` is nullable-mandatory (Path B): `null` for the
 *                            `execution_lost` outcome (R-5), else
 *                            `^rcpt_[0-9a-zA-Z]{20,}$`.
 *
 * Path D serialize-skip optionals (omit when absent — must NOT serialize as
 * `null`):
 *   - `sigstore_signature`   Reserved for keyless signing in later milestone.
 *   - `classifier_version`   Optional provenance pointer.
 *   - `shadow_mode`          Optional boolean.
 *
 * Cross-track parity: this schema mirrors the Rust sub-3 canonical struct
 * landed on `phase1/rfc001-v0.2-receipts` (C1–C5 + C3+). The field set is
 * closed per ratifications R-1..R-7 + F-1 + R-4-correction + Option B
 * genesis-null. See `ts-tech-lead-to-pm-e3-b4-receipt-v0.2-parity-concurrence-state-2026-05-23.md`
 * §2 for the audited contract surface.
 */

import { z } from 'zod';

const Sha256Hex = z.string().regex(/^[a-f0-9]{64}$/);
const Sha1HexLower = z.string().regex(/^[a-f0-9]{40}$/);
const Sha256Prefixed = z.string().regex(/^sha256:[a-f0-9]{64}$/);
/**
 * Algorithm-prefixed Ed25519 signature per RFC-002 §6 (post-amendment 2026-05-23).
 *
 * Form: `ed25519:` + base64(64 raw signature bytes), standard alphabet, padded.
 * Total length: 8 (prefix) + 88 (base64) = 96 chars.
 *
 * The prefix mirrors the §5 digest prefix (`sha256:<hex>`). In schema version
 * 0.2 the only permitted algorithm tag is `ed25519`; any other prefix is a
 * schema-level violation (v0.2 verifiers MUST treat such a receipt as
 * malformed, distinct from "invalid signature").
 *
 * The prefix appears only in the final, populated `signature` field value.
 * During pre-image construction `signature` is the empty string (R-3
 * sentinel), unaffected by this prefix.
 */
const Ed25519PrefixedSignature = z
  .string()
  .regex(/^ed25519:[A-Za-z0-9+/]{86}==$/);
const ReceiptId = z.string().regex(/^rcpt_[0-9a-zA-Z]{20,}$/);
const WitnessEventId = z.string().regex(/^evt_[0-9a-zA-Z]{20,}$/);

export const ExecutionReceiptV02Schema = z.object({
  schema_version: z.literal('witseal.receipt.v0.2'),

  /** Path B nullable-mandatory. `null` for `execution_lost` (R-5). */
  receipt_id: ReceiptId.nullable(),

  witness_event_id: WitnessEventId,
  chain_segment_id: z.string().min(1),
  finalized_at: z.string().datetime({ offset: false }),

  /** Self-hash over canonical body minus `{receipt_hash}`, with
   *  `signature = ""` (R-3 empty-string sentinel during pre-image build). */
  receipt_hash: Sha256Hex,

  policy_decision_hash: Sha256Hex,
  classified_intent_hash: Sha256Hex,
  /** Null for denied actions (no execution to hash). */
  execution_result_hash: Sha256Hex.nullable(),

  outcome: z.string(),

  /** Reading B (R-4 correction): receipt-level chain-segment linkage.
   *  `null` at chain-segment genesis (Option B). */
  prev_hash: Sha256Hex.nullable(),

  /** Algorithm-prefixed Ed25519 signature per RFC-002 §6 (amendment 2026-05-23):
   *  `ed25519:` + base64 std-padded 64 raw signature bytes (88 base64 chars →
   *  96 chars total). The prefix mirrors §5 digest prefix and exists so future
   *  algorithm changes are v0.2-compatible extensions rather than wire breaks. */
  signature: Ed25519PrefixedSignature,

  /** Build provenance (M9 populates from real build context). */
  git_commit: Sha1HexLower,
  artifact_digest: Sha256Prefixed,
  attestation_digest: Sha256Prefixed,

  /** Path D serialize-skip: omit field entirely if absent (do not emit `null`). */
  sigstore_signature: z.string().min(1).optional(),
  classifier_version: z.string().min(1).optional(),
  shadow_mode: z.boolean().optional(),
});

export type ExecutionReceiptV02 = z.infer<typeof ExecutionReceiptV02Schema>;

/** Receipt draft prior to `receipt_hash` computation. The signing pre-image
 *  is constructed from this draft with `signature` set to the empty string,
 *  per R-3 (artifact A §2.2 as adjusted). */
export type ExecutionReceiptV02Draft = Omit<ExecutionReceiptV02, 'receipt_hash'>;
