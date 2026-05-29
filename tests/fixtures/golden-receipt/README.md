# Golden-receipt fixed-input-vector — v0.2 conformance

**Purpose:** establish a deterministic fixed-input-vector that, when fed through each track's (Rust, Python, TypeScript) Receipt v0.2 construction pipeline + RFC 8785 canonicalization + Ed25519 sign, produces **byte-identical canonical wire bytes** on all three tracks. This is the cross-track conformance deliverable for v0.2 receipts.

---

## Files

| File | Description |
|------|-------------|
| `inputs.json` | Fixed input-vector spec: literal field values + sentinel-hash derivation rules + construction procedure. |
| `test-only-do-not-use-in-prod.key.json` | Fixed Ed25519 test-only signing key derivation rule + cross-track equivalents. |
| `README.md` | This file: procedure, invariants, cross-track contract, reproduction instructions. |
| `rust-golden.json` | Populated receipt JSON view (after construction + canonicalize + sign), pretty-printed. |
| `rust-golden.canonical` | Raw RFC 8785 canonical bytes of the final wire-form receipt. Source-of-truth blob for cross-track byte-identity comparison. |
| `rust-golden.sig` | Detached base64-standard-padded Ed25519 signature over the pre-finalize canonical bytes (step 4 of construction). |

---

## Cross-track contract

1. **Input-vector source of truth:** `inputs.json` (this directory). Each track reproduces the input vector independently following the construction procedure (`inputs.json` `_construction_procedure`).

2. **Sentinel-hash determinism:** every hash-typed receipt field whose value is a `<derive: ...>` placeholder in `inputs.json` `receipt_inputs` is computed deterministically per `inputs.json` `_sentinel_seeds`. All tracks MUST produce byte-identical resolved values.

3. **Canonical-bytes source of truth:** `rust-golden.canonical` is the byte-identity comparison target. The Python and TypeScript tracks each compute their own canonical bytes independently, then `cmp` against this blob. Pass = byte-identical. Fail = surface immediately as a cross-track wire-form divergence.

4. **Key derivation determinism:** the test-only signing key is derived deterministically from a seed string per `test-only-do-not-use-in-prod.key.json` `derivation`. All tracks MUST produce byte-identical seed bytes, private-key bytes, and public-key bytes.

5. **Signature verification cross-check:** each track verifies the signature using its own Ed25519 primitives over its own computed canonical bytes. Pass = valid signature. (Note: Ed25519 is a deterministic signing scheme over a fixed message + key, so the signature byte sequence itself MUST also be byte-identical across tracks.)

6. **Serialize-skip omission contract:** `sigstore_signature`, `classifier_version`, `shadow_mode` MUST NOT appear in canonical bytes. Any track emitting one of these keys breaks parity.

7. **Explicit-null contract:** `prev_hash` MUST emit explicit `null`, not be skipped. `receipt_id` baseline uses a populated value so the null-emission rule isn't exercised by THIS baseline (a follow-on extension fixture is suggested to cover the explicit-`null` path for the nullable-mandatory `receipt_id`).

---

## Construction procedure (S1 clear-defaults)

Each track follows this sequence exactly.

### Step 1 — construct
Build the receipt struct:
- Load all literal scalar fields from `inputs.json` `receipt_inputs`.
- Derive sentinel-hash fields per `inputs.json` `_sentinel_seeds` rules.
- `signature = ""` (empty-string sentinel).
- `receipt_hash =` 32 zero bytes (the all-zeros placeholder).
- `prev_hash = null`.
- Serialize-skip optional fields all absent.

### Step 2 — canonicalize for hash + sign
Serialize the struct per RFC 8785:
- Sorted object keys (lexicographic on UTF-8 bytes).
- No whitespace.
- Serialize-skip optional fields omitted (skip-when-absent).
- `prev_hash = null` emits explicit `null`.
- `receipt_id` baseline is populated → emits the string literal directly.
- Hash fields use the wire form specified in `inputs.json` `_invariant_axes_under_test.sha256_hash_wire_form`.

The resulting byte sequence is the **canonical-bytes blob** for the hash/sign step. (Persisted to `rust-golden.canonical` after step 5 populates the final fields and re-canonicalizes; the **step-2 intermediate** bytes are NOT persisted separately because they can be re-derived from the final receipt by zeroing `receipt_hash` + emptying `signature` + re-canonicalizing.)

### Step 3 — compute receipt_hash
`receipt_hash = SHA-256(canonical_bytes_from_step_2)`. Wire-form bare 64-hex lowercase.

### Step 4 — compute signature
`signature = Ed25519_sign(signing_key, canonical_bytes_from_step_2)`.

**Critical:** the message-bytes signed are the **step-2 bytes** (with `signature = ""` and `receipt_hash =` all zeros), NOT the post-hash bytes. This is the clear-defaults procedure.

Wire-form: `"ed25519:"`-prefixed base64 standard-padded matching `^ed25519:[A-Za-z0-9+/]{86}==$` (96 chars total). Persisted detached in `rust-golden.sig`.

### Step 5 — finalize for wire
Populate `signature` (step 4 result) and `receipt_hash` (step 3 result) on the struct; re-canonicalize per RFC 8785. The resulting bytes are the **final canonical wire-form receipt**. Persisted to `rust-golden.canonical`. The pretty-printed JSON view is also persisted to `rust-golden.json` for human inspection.

### Step 6 — verify (optional self-check)
Independently re-derive:
- Re-canonicalize the final receipt with `signature = ""` and `receipt_hash =` all zeros; assert `SHA-256(...)` equals the stored `receipt_hash`.
- Assert `Ed25519_verify(public_key, those_canonical_bytes, signature)` returns true.

---

## Invariants summary

| Axis | Rule |
|------|------|
| RFC 8785 canonicalization | Sorted keys, no whitespace, RFC 8785 escape rules |
| Hash field wire form | Bare 64-hex lowercase |
| Digest field wire form | `"sha256:<64-hex lowercase>"` (prefixed) |
| `prev_hash` wire form | `"sha256:<64-hex lowercase>"` or explicit `null` |
| Ed25519 signature wire form | `"ed25519:"`-prefixed base64 standard-padded `^ed25519:[A-Za-z0-9+/]{86}==$` (96 chars total) |
| `git_commit` wire form | Bare 40-char lowercase SHA-1 hex |
| `artifact_type` wire form | Kebab-case taxonomy literal (e.g. `"generic-binary"`); closed enum |
| `outcome` wire form | Snake-case (e.g. `"allowed_executed"`) |
| Serialize-skip fields | Skip-when-absent (NOT emit key) |
| `prev_hash` when absent | Explicit `null` (NOT skip) |
| `receipt_id` when absent | Explicit `null` (NOT skip) — nullable-mandatory |
| `finalized_at` precision | RFC 3339 UTC `.000Z` millisecond suffix |

---

## Reproduction

### Rust (authoritative)
Run the reference testkit's golden-receipt generator from the Rust repo. It emits `rust-golden.json`, `rust-golden.canonical`, and `rust-golden.sig`, and also runs an internal byte-identity self-check (step 6).

### Python
- Read this README + `inputs.json` + `test-only-do-not-use-in-prod.key.json`.
- Construct an equivalent receipt instance in the Python schema.
- Apply the construction procedure (steps 1-6).
- Compare own canonical bytes against `rust-golden.canonical` byte-by-byte.
- Report a Python-track match (or divergence) by opening an issue or pull request.

### TypeScript
- Same procedure as Python.
- Compare own canonical bytes against `rust-golden.canonical` byte-by-byte.
- Report a TypeScript-track match (or divergence) by opening an issue or pull request.

### Three-way byte-identity gate
After all three tracks have published their canonical bytes:
- `cmp rust-golden.canonical python-golden.canonical` returns 0.
- `cmp rust-golden.canonical typescript-golden.canonical` returns 0.
- Gate green → v0.2 cross-track conformance closure.

---

## Risks surfaced

1. **Wire-form re-check** — the reproduction generator is the first end-to-end byte-identity exercise. If anything surfaces (sentinel-hash drift, canonicalization edge-case, signature mismatch), surface it immediately as a potential wire-form divergence.

2. **`finalized_at` precision** — `.000Z` millisecond suffix established as ground truth here. Tracks normalizing to different precision (e.g. plain `Z`, or `.000000Z`) break parity and MUST surface.

3. **Three SHA-256-derived wire forms** — the bare-hash, prefixed-digest, and `prev_hash` shapes are three different wire forms for SHA-256-derived fields. The invariants summary table above is the authoritative reference.

4. **`receipt_id` absent baseline NOT exercised** — baseline uses a populated `receipt_id`; the explicit-`null` path for the nullable-mandatory `receipt_id` requires a separate follow-on fixture. Non-gating.
