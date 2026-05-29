# ADR-0007: Role Vocabulary — Claimant, Claimer, Witness, Attester, Verifier, Observer

- **Status:** accepted (2026-05-11)
- **Date:** 2026-05-11
- **Deciders:** WitSeal maintainers
- **Affects:** `docs/model.md`, `STYLE.md`, schemas, code identifiers, future RFCs

---

## Context

Phase 1 WitSeal documentation and schemas use ad-hoc terms for the
entities involved in witnessed execution. The current Zod schemas refer
to `principal.id` with values like `"cli-user"` — a single field that
mixes human authority, software identity, and runtime role. Public
documentation occasionally uses "user," "agent," "operator," and similar
terms interchangeably.

This conflation causes two problems:

1. **Semantic ambiguity** when describing what WitSeal does. The phrase
   "WitSeal records what the user did" cannot distinguish between
   (a) the human authorizing the action and (b) the software acting on
   their behalf.

2. **Future schema drift.** As WitSeal extends in Phase 4-6 to multi-
   agent and remote execution, schema fields will multiply unless a
   stable vocabulary anchors them.

We need a canonical role vocabulary before Phase 2 schema work begins
and before public materials lock in informal terms.

---

## Decision

WitSeal adopts a six-role canonical vocabulary:

| Role | Type | Function |
|---|---|---|
| **Claimant** | human or organization | initiates an action; bears ultimate authority |
| **Claimer** | software | acts on Claimant's behalf; produces the claim payload |
| **Witness** | runtime | observes and records execution into the chain |
| **Attester** | cryptographic identity | binds witness records to a verifiable party |
| **Verifier** | downstream party | actively checks evidence integrity |
| **Observer** | passive third party | reads evidence without verification |

Plus seven canonical operations:

- **to claim** — make a verifiable assertion co-emergent with execution
- **to witness** — observe and record execution
- **to stamp** — bind a record into the chain (structural integrity)
- **to seal** — bind a record cryptographically to an Attester (identity integrity)
- **to attest** — bind cryptographic identity to a seal
- **to verify** — actively check evidence integrity
- **to observe** — passively read evidence

Plus three preserved terms from adjacent ecosystems (not replaced):

- **sign** — cryptographic signature operation (preserved from crypto)
- **pick / choose / select** — selection (preserved from English)
- **take** — performance of action (preserved from English)

Full definitions and the three-tier integrity model (semantic claim
+ structural stamp + cryptographic seal) are in
[docs/model.md](../model.md).

---

## Rationale

### Why distinguish Claimant from Claimer

Authorization and execution are operationally distinct. A developer
(Claimant) authorizes an agent (Claimer) to act on their behalf. Without
the distinction, evidence cannot answer the question "did the agent act
within the boundaries the developer set?"

This mirrors the principal/delegate split in capability-based security
and the relying-party/asserting-party split in identity federation.

### Why "claim" rather than "assert" or "log"

- **Assert** is overused in software engineering (assertions in code,
  assertion failures, etc.) and would create constant collision.
- **Log** implies post-hoc record-keeping, missing the co-emergent
  property: in WitSeal, the record cannot exist without the execution
  having occurred.
- **Claim** carries the right semantic load: a verifiable assertion,
  morphologically connected to Claimant and Claimer for model
  coherence.

### Why distinguish stamp from seal

Phase 1 WitSeal provides structural integrity (chain enforces tampering
detection) but not cryptographic identity binding. Phase 5+ adds Sigstore
signing. Without distinct verbs, we conflate two materially different
guarantees and either overpromise (call Phase 1 "sealing") or
underpromise (call Phase 5 "stamping").

The distinction is also potentially original to crypto literature.
Existing verbs (sign, attest, notarize, anchor) all bind identity or
require a trusted timestamping authority. Stamp as we define it — chain
self-integrity without external authority — fills a vocabulary gap.

### Why Verifier and Observer are separate

These are different rights and different intents:
- A Verifier asserts a positive claim ("this evidence is intact").
- An Observer makes no claim ("I read this evidence").

Conflating them creates confusion about authority: a journalist
inspecting public receipts is not certifying their validity.

### Why preserve sign, pick, take

These are established meanings in adjacent communities. Replacing them
creates vocabulary debt without benefit:
- Sign collides with cryptographic literature (Sigstore, OpenSSL, PGP)
- Pick / choose are common English; replacing them with "claim a policy"
  reads as taking ownership of the policy, not selecting it
- Take is common English; "claim an action" sounds like asserting it
  exists, not performing it

---

## Consequences

### Positive

- Schemas can use distinct fields for `claimant`, `claimer`, `witness`,
  `attester` without overloading `principal.id`
- Future RFCs (e.g., RFC-0002 on identity attribution) can reference
  these terms without redefining them
- Public communication gains precision: "WitSeal makes Claimer actions
  verifiable against Claimant authority" is unambiguous
- Three-tier integrity model creates a clean Phase escalation path:
  Phase 1 = stamping; Phase 5 = stamping + sealing
- Polymorphic claim semantics (claim-as-family-of-operations) creates a
  potentially publishable concept (see internal DR-0006)
- Vocabulary is internally consistent and morphologically connected

### Negative

- Code refactoring required to align Phase 1 schemas with new terms
  (mostly renames in TypeScript types; minor)
- Existing documentation needs updating to use canonical roles
  consistently (one-time cost)
- Adoption requires explanation to first-time readers (mitigated by
  this document and model.md)
- Risk of premature lock-in if real-world use surfaces unforeseen role
  distinctions (mitigated by ADR amendment process)

### Migration

- Schemas refactored in Phase 2 work, not blocking launch
- Documentation updates in `docs/` and `STYLE.md` as ADR-0007 lands
- `STYLE.md` does not duplicate; it adds a pointer: "For role vocabulary,
  see `docs/model.md`"

---

## Alternatives considered

### Continue with informal vocabulary

Rejected. Scaling Phase 4-6 (multi-agent, remote) without anchored
vocabulary leads to schema sprawl and documentation contradictions.

### Adopt existing standards verbatim (Sigstore, in-toto, SPIFFE)

Rejected as primary. Those standards address related but distinct
problems (artifact signing, software supply chain attestation, workload
identity). WitSeal addresses witnessed execution, which has its own
semantic structure. We use Sigstore terms (sign, attest) where they
apply and add new terms (claim, stamp, seal, witness as runtime role)
where they don't.

### Use Sigstore-only vocabulary

Rejected. Sigstore's vocabulary is artifact-centric (sign this binary,
verify this artifact), not execution-centric. WitSeal records the act
of execution, not just outputs. Different concept, different vocabulary.

### Use principal/delegate from capability literature

Rejected as primary names. Principal and delegate are accurate but
generic; they appear in dozens of unrelated systems. Claimant and
Claimer are distinctive to WitSeal and morphologically connected to
Claim.

---

## Implementation plan

1. **Phase 1 (now, pre-launch):** Publish `docs/model.md` and this ADR.
   Update README to reference model.md. No code changes blocking launch.

2. **Phase 2 (post-launch, week 2-4):** Refactor Zod schemas to use
   canonical terms (`claimant`, `claimer` distinct fields). Update
   public-facing FAQ if it currently uses ambiguous terms.

3. **Phase 3-4:** First adapter (OpenCode) wired to use new schema
   fields. Documentation updates accumulate.

4. **Phase 5+:** Sealing implemented via Sigstore. Three-tier integrity
   model becomes operationally visible.

5. **Phase 6-7:** Polymorphic claim semantics potentially published
   as academic paper (see internal DR-0006 deferred publication targets).

---

## Related decisions

- **DR-0003 v2** (internal) — analogy palette and vocabulary discipline
- **DR-0006** (internal) — claim/stamp/seal canonical, deferred
  publication targets, PAI synergy reservation
- **STYLE.md** (public) — use/avoid lock for public copy
- **Future RFC-0002** (planned) — identity attribution in evidence
  schema
