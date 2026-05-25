# Golden-receipt fixed-input-vector — RFC-001 v0.2 / D6 § 8.1 conformance

**Status:** cycle 69 publication (sub-3 track-owner). Inputs spec landed cycle 68; populated Rust-canonical output (`rust-golden.json` + `rust-golden.canonical` + `rust-golden.sig`) landed cycle 69 alongside reproduction-binary `crates/witseal-testkit/src/bin/generate_golden_receipt.rs` и library function `witseal_testkit::golden_receipt::generate_artifacts`. Cycle-69 байт-identity gate (cargo-test-driven) is а passing self-check.

**Purpose:** establish а deterministic fixed-input-vector that, when fed through each track's (rust, python, typescript) Receipt v0.2 construction pipeline + RFC 8785 canonicalization + Ed25519 sign, produces **byte-identical canonical wire bytes** on all three tracks. This is the D6 § 8.1 conformance deliverable for the bridge-proof v0.2 cascade.

---

## Files

| File | Cycle | Description |
|------|-------|-------------|
| `inputs.json` | 68 | Fixed input-vector spec: literal field values + sentinel-hash derivation rules + construction procedure. |
| `test-only-do-not-use-in-prod.key.json` | 68 | Fixed Ed25519 test-only signing key derivation rule + cross-track equivalents. |
| `README.md` | 68 | This file: procedure, invariants, cross-track contract, reproduction instructions. |
| `rust-golden.json` | 69 | Populated `ReceiptV0_2` JSON view (after construction + canonicalize + sign), pretty-printed. |
| `rust-golden.canonical` | 69 | Raw RFC 8785 canonical bytes of the final wire-form receipt. Source-of-truth blob для cross-track byte-identity comparison. |
| `rust-golden.sig` | 69 | Detached base64-standard-padded Ed25519 signature over the pre-finalize canonical bytes (step 4 of construction). |

---

## Cross-track contract

1. **Input-vector source of truth:** `inputs.json` (this directory). Cross-tracks reproduce the input vector independently following the construction procedure (`inputs.json` `_construction_procedure`).

2. **Sentinel-hash determinism:** every hash-typed receipt field whose value is а `<derive: ...>` placeholder в `inputs.json` `receipt_inputs` is computed deterministically per `inputs.json` `_sentinel_seeds`. All tracks MUST produce byte-identical resolved values.

3. **Canonical-bytes source of truth:** `rust-golden.canonical` (cycle 69) is the byte-identity comparison target. Python и TypeScript tracks each compute their own canonical bytes independently, then `cmp` against this blob. Pass = byte-identical. Fail = surface immediately к Rust Tech Lead coordinator (B-4-axis reopen candidate).

4. **Key derivation determinism:** the test-only signing key is derived deterministically from а seed string per `test-only-do-not-use-in-prod.key.json` `derivation`. All tracks MUST produce byte-identical seed bytes, private-key bytes, и public-key bytes.

5. **Signature verification cross-check:** each track verifies the signature using its own Ed25519 primitives over its own computed canonical bytes. Pass = valid signature. (Note: Ed25519 is а deterministic signing scheme over а fixed message + key, so the signature byte sequence itself MUST also be byte-identical across tracks.)

6. **Path D omission contract:** `sigstore_signature`, `classifier_version`, `shadow_mode` MUST NOT appear in canonical bytes. Any track emitting one of these keys breaks parity.

7. **Explicit-null contract:** `prev_hash` MUST emit explicit `null`, not be skipped. Decision A invariant. `receipt_id` baseline uses `Some(...)` so the null-emission rule isn't exercised by THIS baseline (а follow-on extension fixture is suggested к cover the `None`-with-explicit-`null` path для RFC-001 § 7.1 v0.2 discriminated-union strict-on-`Some` complement).

---

## Construction procedure (S1 clear-defaults per F-2 / cascade § 2.2)

Each track follows this sequence exactly. Reference reproduction binary: `crates/witseal-testkit/src/bin/generate_golden_receipt.rs` (cycle 69 deliverable).

### Step 1 — construct
Build the `ReceiptV0_2` struct (per receipt.rs:105-159):
- Load all literal scalar fields from `inputs.json` `receipt_inputs`.
- Derive sentinel-hash fields per `inputs.json` `_sentinel_seeds` rules.
- `signature = ""` (empty-string sentinel per F-2).
- `receipt_hash = Sha256Hash::zero()` (32 zero bytes; raw `[u8; 32]`).
- `prev_hash = None`.
- Path D optional fields all `None`.

### Step 2 — canonicalize for hash + sign
Serialize the struct per RFC 8785:
- Sorted object keys (lexicographic on UTF-8 bytes).
- No whitespace.
- Path D optional fields omitted (`skip_serializing_if = "Option::is_none"`).
- `prev_hash = None` emits explicit `null`.
- `receipt_id` baseline uses `Some` → emits the string literal directly.
- Hash fields use the wire form specified в `inputs.json` `_invariant_axes_under_test.sha256_hash_wire_form`.

The resulting byte sequence is the **canonical-bytes blob** for the hash/sign step. (Persisted к `rust-golden.canonical` after step 5 populates the final fields and re-canonicalizes; the **step-2 intermediate** bytes are NOT persisted separately because they can be re-derived from the final receipt by zeroing `receipt_hash` + emptying `signature` + re-canonicalizing.)

### Step 3 — compute receipt_hash
`receipt_hash = SHA-256(canonical_bytes_from_step_2)`. Stored on the struct as `Sha256Hash` (raw `[u8; 32]`); wire-form bare 64-hex lowercase.

### Step 4 — compute signature
`signature = Ed25519_sign(signing_key, canonical_bytes_from_step_2)`.

**Critical:** the message-bytes signed are the **step-2 bytes** (with `signature = ""` and `receipt_hash = Sha256Hash::zero()`), NOT the post-hash bytes. This is the F-2 / cascade § 2.2 clear-defaults procedure.

Wire-form: `"ed25519:"`-prefixed base64 standard-padded matching `^ed25519:[A-Za-z0-9+/]{86}==$` (96 chars total) per RFC-002 §6 algorithm-prefix amendment (concurred 2026-05-24). Persisted detached в `rust-golden.sig`.

### Step 5 — finalize for wire
Populate `signature` (step 4 result) и `receipt_hash` (step 3 result) on the struct; re-canonicalize per RFC 8785. The resulting bytes are the **final canonical wire-form receipt**. Persisted к `rust-golden.canonical`. The pretty-printed JSON view is also persisted к `rust-golden.json` for human inspection.

### Step 6 — verify (optional self-check)
Independently re-derive:
- Re-canonicalize the final receipt с `signature = ""` and `receipt_hash = Sha256Hash::zero()`; assert `SHA-256(...)` equals the stored `receipt_hash`.
- Assert `Ed25519_verify(public_key, those_canonical_bytes, signature)` returns true.

---

## Invariants summary

| Axis | Rule | Witseal-rs reference |
|------|------|----------------------|
| RFC 8785 canonicalization | Sorted keys, no whitespace, RFC 8785 escape rules | `witseal-canonical-json` crate |
| `Sha256Hash` wire form | Bare 64-hex lowercase | `Sha256Hash` Serialize impl |
| `Sha256DigestField` wire form | `"sha256:<64-hex lowercase>"` (prefixed) | `Sha256DigestField` Serialize impl |
| `prev_hash` wire form | `"sha256:<64-hex lowercase>"` или explicit `null` | `receipt_hash_to_prev_hash_string` |
| Ed25519 signature wire form | `"ed25519:"`-prefixed base64 standard-padded `^ed25519:[A-Za-z0-9+/]{86}==$` (96 chars total) per RFC-002 §6 algorithm-prefix amendment (concurred 2026-05-24) | R-2 + RFC-002 §6 |
| `git_commit` wire form | Bare 40-char lowercase SHA-1 hex | R-4 / RFC-002 v0.1 § 7.2 |
| `artifact_type` wire form | Kebab-case taxonomy literal (e.g. `"generic-binary"`); RFC-002 v0.1 § 3 closed enum | `#[serde(rename = "...")]` on `ArtifactType` variants |
| `outcome` wire form | Snake-case (e.g. `"allowed_executed"`); WitnessOutcome via `rename_all = "snake_case"` | `WitnessOutcome` enum |
| Path D fields | Skip-when-None (NOT emit key) | `#[serde(skip_serializing_if = "Option::is_none")]` |
| `prev_hash` when `None` | Explicit `null` (NOT skip) | Decision A; `receipt_v0_2_emits_explicit_null_for_receipt_id_and_prev_hash` test |
| `receipt_id` when `None` | Explicit `null` (NOT skip) — Path B per RFC-001 § 7.1 | Same test as above |
| `finalized_at` precision | RFC 3339 UTC `.000Z` millisecond suffix | Sub-3 convention per receipt.rs:172 |

---

## Reproduction (cycle 69+)

### Rust (sub-3, authoritative)
```bash
cd /Users/pai/WitSeal/witseal-rs-3
cargo run -p witseal-testkit --bin generate_golden_receipt
# emits:
#   crates/witseal-testkit/corpus/v0.2/golden_receipt/rust-golden.json
#   crates/witseal-testkit/corpus/v0.2/golden_receipt/rust-golden.canonical
#   crates/witseal-testkit/corpus/v0.2/golden_receipt/rust-golden.sig
# also runs internal byte-identity self-check (step 6).
```

### Python (cycle 71+)
- Read this README + `inputs.json` + `test-only-do-not-use-in-prod.key.json`.
- Construct equivalent `ReceiptV0_2` instance in the Python schema.
- Apply the construction procedure (steps 1-6).
- Compare own canonical bytes against `rust-golden.canonical` byte-by-byte.
- File a Python-track concurrence (or divergence) к PdM via Python Dev channel.

### TypeScript (cycle 71+ / post M8 ~2026-05-26)
- Same procedure as Python.
- Compare own canonical bytes against `rust-golden.canonical` byte-by-byte.
- File а TypeScript-track concurrence (or divergence) к PdM via TS Dev channel.

### Three-way byte-identity gate
After all three tracks have published their canonical bytes:
- `cmp rust-golden.canonical python-golden.canonical` returns 0.
- `cmp rust-golden.canonical typescript-golden.canonical` returns 0.
- Gate green → D6 § 8.1 conformance closure.

---

## Risks surfaced (per sub-3 cycle-67 ack § 3.6)

1. **Decision A wire-form re-check** — cycle 69's reproduction binary is the first end-to-end byte-identity exercise on sub-3 branch. If anything surfaces (sentinel-hash drift, canonicalization edge-case, signature mismatch), file coordinator-bound surface immediately. Potential B-4-axis reopen.

2. **`finalized_at` precision** — `.000Z` millisecond suffix established as ground truth here. Tracks normalizing к different precision (e.g. plain `Z`, или `.000000Z`) break parity и MUST surface.

3. **`Sha256Hash` vs `Sha256DigestField` vs `prev_hash` wire-form confusion** — three different shapes for SHA-256-derived wire-form fields. README invariants summary table is the authoritative reference.

4. **`receipt_id = None` baseline NOT exercised** — baseline uses `Some(...)` for `receipt_id`; the `None`-with-explicit-`null` path (RFC-001 § 7.1 v0.2 discriminated-union strict-on-`Some` complement) requires а separate follow-on fixture. Non-gating.

---

## Vocabulary compliance

This document uses only locked DR-0005 vocabulary: witnessed execution, evidence chain, execution receipt, hash chain, witness event, policy decision, authority boundary, risk classification, approval gate, trust runtime, policy pack, deny-by-default, claim, stamp, seal, attest, witness, claimant, verifier, observer, wire-format, canonicalization. No marketing language. No deferred terms.

---

*Filed 2026-05-23 cycle 68 by rust-sub-3 (scheduled run 20260523015236-65131) on branch `phase1/rfc001-v0.2-receipts` following coordinator green-light dispatch `rust-tech-lead-to-sub3-golden-receipt-cycle-68-greenlight-2026-05-23.md`. Reproduction-binary publication (cycle 69) follows next coordinator-bound surface.*
