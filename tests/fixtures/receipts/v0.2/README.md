# v0.2 receipt positive-fixture corpus

Hand-rolled positive fixtures exercising the v0.2 receipt schema (`witseal.receipt.v0.2`) and the S1 clear-to-defaults signing procedure (`signature = ""` AND `receipt_hash = <64 zeros>` in the pre-image; one pre-image for both signature and hash). The corpus targets the v0.2 receipt surface points: chain-segment linkage, the execution_lost outcome, and serialize-skip optionals.

## Contents

| File | Surface coverage |
|---|---|
| `01-genesis-allowed-executed.json` | `prev_hash = null` at chain-segment genesis (genesis-null); serialize-skip optionals omitted; `outcome = allowed_executed` |
| `02-chained-allowed-executed.json` | `prev_hash = receipt_hash` of fixture #01 (chained linkage); serialize-skip optionals omitted |
| `03-execution-lost.json` | `outcome = execution_lost`; `receipt_id = null` (nullable-mandatory); `execution_result_hash = null` |
| `04-path-d-optionals-populated.json` | All three serialize-skip optionals carried through (`sigstore_signature`, `classifier_version`, `shadow_mode`); `outcome = allowed_executed` |
| `ed25519-publickey.hex` | Raw 32-byte Ed25519 public key, hex-encoded, single line (verification key for all fixtures) |
| `regenerate.ts` | Source-of-truth regenerator. Run with `npx tsx tests/fixtures/receipts/v0.2/regenerate.ts` from repo root. Output is deterministic. |

## Verification (any track)

1. Read the receipt JSON.
2. Rebuild the signing pre-image (S1 clear-to-defaults): take the receipt body, set `signature = ""` (the empty-string sentinel — do **not** remove the `signature` field) **and** set `receipt_hash = "0000…0000"` (the 64-char all-zeros placeholder — do **not** remove the `receipt_hash` field), then JCS-canonicalize (RFC 8785). This is the **one** pre-image used for both the signature and the hash.
3. `ed25519_verify(public_key, base64_decode(signature), pre_image)` — must succeed.
4. Re-derive `receipt_hash = SHA-256(pre_image)` over the **same** canonical bytes from step 2. Assert equality with the receipt's `receipt_hash`.

The TypeScript companion test (`tests/receipt-v0.2-fixtures.test.ts`) performs all four steps for each fixture.

## Determinism

- Keypair: derived from the fixed 32-byte seed `0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20` (RFC 8032 § 5.1.5 Ed25519 seed). Hardcoded in `regenerate.ts`.
- Timestamps and identifiers: fixed string literals in `regenerate.ts`.
- Ed25519 signatures are deterministic by construction (no nonce input).
- Therefore re-running the regenerator from the same source MUST produce byte-identical JSON output. The companion test does **not** re-run the generator; it only reads the committed JSON and verifies signatures, so any track can use the same JSON without invoking the regenerator.

## Cross-track use

These fixtures are TS-authored. They do **not** by themselves constitute the three-way byte-identity golden-receipt reference. That artifact requires the authoritative Rust fixed-input-vector to be published first and the three tracks (TS, Rust, Python) to converge on byte-identical output from identical inputs. This corpus is a **positive correctness witness for TS**; cross-track tracks can use it to validate their verifier paths but should not treat the byte form as the binding cross-track reference until the golden-receipt lands.
