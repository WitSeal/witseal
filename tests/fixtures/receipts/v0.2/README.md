# v0.2 receipt positive-fixture corpus

Hand-rolled positive fixtures exercising the v0.2 receipt schema (`witseal.receipt.v0.2`) and the R-3 empty-string-sentinel signing procedure. The corpus targets the surface points enumerated in D6 v0.2 § 4.1 / § 6 and in the M8 plan filed at `~/WitSeal/TS Dev/ts-tech-lead-to-pm-m8-start-confirmation-2026-05-23.md` § 2.

## Contents

| File | Surface coverage |
|---|---|
| `01-genesis-allowed-executed.json` | `prev_hash = null` at chain-segment genesis (Option B); Path-D optionals omitted (serialize-skip); `outcome = allowed_executed` |
| `02-chained-allowed-executed.json` | `prev_hash = receipt_hash` of fixture #01 (chained linkage); Path-D optionals omitted |
| `03-execution-lost.json` | R-5 `outcome = execution_lost`; `receipt_id = null` (Path B); `execution_result_hash = null` |
| `04-path-d-optionals-populated.json` | All three Path-D optionals carried through (`sigstore_signature`, `classifier_version`, `shadow_mode`); `outcome = allowed_executed` |
| `ed25519-publickey.hex` | Raw 32-byte Ed25519 public key, hex-encoded, single line (verification key for all fixtures) |
| `regenerate.ts` | Source-of-truth regenerator. Run with `npx tsx tests/fixtures/receipts/v0.2/regenerate.ts` from repo root. Output is deterministic. |

## Verification (any track)

1. Read the receipt JSON.
2. Rebuild the signing pre-image: take the receipt body, set `signature = ""` (the R-3 empty-string sentinel — do **not** remove the `signature` field), then JCS-canonicalize (RFC 8785). The body must include `receipt_hash` at this point.
3. `ed25519_verify(public_key, base64_decode(signature), pre_image)` — must succeed.
4. Re-derive `receipt_hash`: remove `receipt_hash` from the body (keep `signature = ""`), JCS-canonicalize, SHA-256. Assert equality with the receipt's `receipt_hash`.

The TypeScript companion test (`tests/receipt-v0.2-fixtures.test.ts`) performs all four steps for each fixture.

## Determinism

- Keypair: derived from the fixed 32-byte seed `0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20` (RFC 8032 § 5.1.5 Ed25519 seed). Hardcoded in `regenerate.ts`.
- Timestamps and identifiers: fixed string literals in `regenerate.ts`.
- Ed25519 signatures are deterministic by construction (no nonce input).
- Therefore re-running the regenerator from the same source MUST produce byte-identical JSON output. The companion test does **not** re-run the generator; it only reads the committed JSON and verifies signatures, so any track can use the same JSON without invoking the regenerator.

## Cross-track use

These fixtures are TS-authored. They do **not** yet constitute the M8 item #5 golden-receipt (the three-way byte-identity reference per D6 v0.2 § 8.1). That artifact requires the Rust sub-3 fixed-input-vector to be published first and the three tracks (TS, Rust, Python) to converge on byte-identical output from identical inputs. This corpus is a **positive correctness witness for TS**; cross-track tracks can use it to validate their verifier paths but should not treat the byte form as the binding cross-track reference until the golden-receipt lands.
