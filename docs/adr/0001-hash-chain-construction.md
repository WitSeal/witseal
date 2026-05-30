# ADR-0001: Hash-chain construction

## Status

accepted (2026-05-08)

## Context

WitSeal's evidence chain must make tampering detectable. Two design questions:

1. **Per-event linkage vs Merkle tree:** does each receipt reference the previous receipt's hash (linear chain), or is the chain a Merkle tree with periodic roots?
2. **Hash algorithm:** which hash function?

Phase 1 constraints:
- Single-node, single-writer (see ADR-0006)
- Append-only event log (see ADR-0002)
- Verifier must reconstruct chain head from event log alone
- p99 mediation overhead < 100 ms (Phase 1 budget)
- No third-party signatures yet (those come in Phase 5)

## Decision

**Linear hash chain. SHA-256.**

Each `WitnessEvent` includes a `previous_event_hash` field that references the SHA-256 hash of the previous canonicalized event. The first event in a chain has `previous_event_hash: null`. The "chain head" at any moment is the SHA-256 hash of the most recent event.

Canonicalization for hashing uses RFC 8785 (JSON Canonicalization Scheme) to ensure cross-implementation reproducibility. Hash is computed over the canonicalized event with `event_hash` field omitted, then `event_hash` is set to the result.

Receipt hashes are computed identically and referenced from the witness event that pairs with them.

## Consequences

### Positive

- **Trivially verifiable.** A verifier replays the event log and checks each `previous_event_hash` against the actual hash of the previous event. ~30 lines of code.
- **No tree maintenance.** No Merkle root recomputation, no balanced-tree concerns, no proof-path generation.
- **Deterministic chain head.** Given the event log, the chain head is a pure function — there is exactly one valid chain head for a given log.
- **Tampering detection is local.** If event N is modified, every event from N onward fails verification. A verifier identifies the exact tampering point.
- **SHA-256 is universally available** in Node.js stdlib (`crypto.createHash`), in every language's stdlib, and in CLI tools. No dependency on cryptographic libraries.

### Negative / Limitations

- **No efficient inclusion proofs.** To prove "receipt R is in the chain at head H," a verifier must replay the chain from genesis. Merkle trees would allow O(log n) proofs. **Acceptable for Phase 1** because evidence packages are small (single developer, single chain segment) and verification runs locally. Revisit in Phase 6 if remote verification with bandwidth constraints becomes a real workload.
- **Linear append constraint.** Cannot insert events out of order. This is intentional — out-of-order insertion would defeat tamper-evidence — but it means concurrent writers are forbidden (see ADR-0006).
- **Single-chain limitation.** Phase 1 assumes one chain per WitSeal installation. Multi-tenant or multi-agent isolation requires multiple installations or a wrapping layer (deferred to Phase 4+).

### What this does NOT provide (honest)

- **No protection against producer tampering.** The producer can rewrite the entire chain consistently — recompute every hash from genesis. Phase 5 addresses this with Sigstore signing + Rekor transparency log inclusion. Phase 1's chain only protects against *non-producer* tampering of evidence packages in transit.
- **No third-party verifiability.** Anyone with the same event log produces the same chain head, but that does not prove the producer didn't fabricate the entire log.

These limitations are documented in `THREAT_MODEL.md` and in the public messaging.

## Alternatives considered

### Merkle tree with periodic roots

Each event is a leaf; the tree is rebalanced periodically; the chain is the sequence of root hashes.

**Why rejected:** Phase 1 does not need O(log n) inclusion proofs. The tree adds implementation complexity (rebalancing, proof generation, snapshot semantics) that pays off only when verifying large segments under bandwidth constraints — not the Phase 1 workload. Reconsider for Phase 6.

### BLAKE3 instead of SHA-256

BLAKE3 is faster and parallelizable.

**Why rejected:** SHA-256 is sufficient for Phase 1 throughput targets (~10 ms p99 for hash + I/O combined per event). BLAKE3 requires an additional dependency and is unfamiliar to most security reviewers. SHA-256 is the default choice for Sigstore (Phase 5 integration), so using it here keeps the cryptographic stack consistent. Reconsider if hashing becomes a measured bottleneck.

### Signatures from genesis (anticipating Phase 5)

Use Ed25519 from day one with a generated keypair stored locally.

**Why rejected:** Local-key signatures don't add tamper-evidence (the producer holds the key and can rewrite freely). They add complexity (key management, rotation, loss recovery) without trust gains until paired with a transparency log. Defer to Phase 5 when Sigstore + Rekor provide the actual trust property.

### No canonicalization (raw JSON.stringify)

Simpler but produces non-reproducible hashes across JSON serializers.

**Why rejected:** The verifier must produce the same hash from the same content. Without canonicalization, key ordering and number formatting differences silently break verification. RFC 8785 is a small library dependency that eliminates an entire class of bugs.

## Implementation notes

The reference implementation lives in `src/integrity/hash-chain.ts`. It is ~80 lines. The core operations:

```typescript
// Compute event hash (canonicalize, omit event_hash, sha256)
hashEvent(event: Omit<WitnessEvent, 'event_hash'>): string

// Append a new event to the chain
appendEvent(prevHash: string | null, event: WitnessEventWithoutHash): WitnessEvent

// Verify a chain segment from a starting point
verifyChain(events: WitnessEvent[]): { valid: boolean; brokenAt?: number }
```

These operations are pure functions. They have no I/O. I/O is the responsibility of the event log layer (ADR-0002).
