# WitSeal Conceptual Model

This document defines the **role vocabulary** used throughout WitSeal:
the entities that participate in witnessed execution, the operations
they perform, and the artifacts they produce.

This is normative. Code, schemas, documentation, and public communication
should use these terms consistently.

For canonical use/avoid vocabulary in marketing copy, see [STYLE.md](../STYLE.md).
For architectural decisions, see [docs/adr/](adr/).

---

## Roles

WitSeal recognizes six distinct roles in any witnessed execution.

### Claimant

A **human or organization** that initiates an action and bears ultimate
responsibility for it.

- A developer running `witseal exec` is a Claimant
- An organization whose CI system invokes WitSeal-mediated commands is a
  Claimant (with the CI service as Claimer; see below)
- An end user authorizing an agent to act on their behalf is a Claimant

The Claimant is the **principal** in classic authorization terminology.

### Claimer

A **software entity** — agent, runtime component, or CLI process — that
acts on behalf of a Claimant.

- An AI agent invoking commands through WitSeal is a Claimer
- A CI runner executing a build is a Claimer
- A shell wrapping `witseal exec` is a Claimer

The Claimer is **not** the Claimant. The Claimer acts; the Claimant
authorizes. WitSeal records both, distinctly.

> **Note on usage.** In everyday English, "claimer" and "claimant" can
> blur together (especially in legal or insurance contexts). In WitSeal,
> the distinction is strict: Claimant is the human/org authority,
> Claimer is the software acting under that authority. First-time readers
> should not interpret Claimer as a synonym of Claimant.

### Witness

The **WitSeal runtime itself**, observing execution and recording it.

Witness is a software role, not a human one. The Witness:
- Observes the attempted execution before, during, and after
- Records observations into the evidence chain
- Cannot be bypassed if mediation is enabled

> **Distinction from Observer.** The Witness creates evidence during
> execution. The Observer (below) reads evidence after the fact. Different
> roles, different rights.

### Attester

A **cryptographic identity** that binds witness records to a verifiable
party.

The Attester is responsible for cryptographically signing artifacts and
identities such that downstream parties can trace evidence to a specific
key, organization, or system.

In WitSeal Phase 1, attestation is minimal (hash chain integrity only).
In Phase 5+, full Sigstore-based attestation binds GitHub OIDC identity,
keyless signing, and Rekor transparency log inclusion.

### Verifier

A **downstream consumer** of evidence who actively checks integrity.

Verifiers:
- Run `witseal verify` against an evidence chain
- Run `cosign verify-blob` against signed receipts
- Validate that claims match recorded execution
- Detect tampering, omission, or substitution

Verifiers have **active rights**: they perform cryptographic and
structural checks. They are distinct from Observers.

### Observer

A **passive third party** who reads evidence without verifying it.

Observers:
- Read public receipts
- Browse evidence packages
- Use evidence for research, journalism, or compliance review
- Do **not** assert that evidence is valid

Observers have **read rights** only. They do not modify, do not sign,
and do not certify what they read.

---

## Operations (verbs)

WitSeal defines seven canonical operations. Each maps to a role and a
specific responsibility.

### to claim

**To make a verifiable assertion through the WitSeal runtime.**

A claim is co-emergent with execution: it cannot exist without the
execution having occurred, and the execution cannot produce a record
without a claim being formed.

This distinguishes claiming from signing (a post-hoc binding) and from
attesting (a post-hoc binding of identity to a claim).

> **In WitSeal, "to claim" means to make a verifiable assertion,
> not to take ownership.** Claims are evidential, not territorial.

Performed by: Claimant (initiates), Claimer (executes), in concert with
the Witness (records).

### to witness

**To observe execution and record it into the evidence chain.**

Performed by: Witness (the WitSeal runtime).

### to stamp

**To bind a claim irreversibly into the persistent evidence chain such
that removal is detectable.**

A stamp is **structural** integrity: the chain itself enforces detection
of tampering through hash linking. A stamped record may or may not also
be cryptographically signed.

In Phase 1, WitSeal stamps every claim into the local evidence chain.
The chain is self-verifying via hash links; removal of any stamped record
produces a verifiable break in the chain.

Performed by: Witness, automatically as part of recording.

### to seal

**To bind a claim into the chain with cryptographic identity attached.**

A seal is **cryptographic** integrity: signature + structural binding.
Sealing requires an Attester. A sealed record is also stamped (sealing
implies stamping), but not every stamped record is sealed.

In Phase 1, WitSeal performs stamping (chain integrity) but not full
sealing (signature binding). Full sealing arrives in Phase 5 via Sigstore.

Performed by: Witness, in cooperation with Attester.

### to attest

**To bind a cryptographic identity to a seal.**

Attestation is the act of an Attester confirming, by signature, that a
specific identity vouches for a seal. In Sigstore terminology, this is
keyless signing via OIDC.

Performed by: Attester.

### to verify

**To check the integrity of a claim, a stamp, a seal, or a chain.**

Verification is **active**: it computes hashes, validates signatures,
checks chain continuity, and reports pass/fail with reasons.

Performed by: Verifier.

### to observe

**To read evidence without performing verification.**

Observation is **passive**: read access without integrity assertion.

Performed by: Observer.

---

## Distinction from existing terms

WitSeal preserves the canonical meanings of three related verbs from
adjacent ecosystems:

| Term | Source | Meaning preserved by WitSeal |
|---|---|---|
| **sign** | crypto (RFC 5280, PKCS, JWS, Sigstore) | Cryptographic operation: produce a signature over a blob. WitSeal uses "sign" only for low-level cryptographic operations. |
| **pick / choose / select** | general English | Selection from a set (e.g., "pick a policy pack"). WitSeal does not replace these with "claim." |
| **take** | general English | Performance of an action (e.g., "take a decision"). WitSeal does not replace this with "claim." |

The WitSeal verbs (claim, stamp, seal, attest, witness, verify, observe)
**complement** these established terms; they do not replace them.

---

## Three-tier integrity model

WitSeal organizes integrity into three distinct layers, each with its
own verb and its own guarantee:

| Layer | Verb | Guarantee | Phase |
|---|---|---|---|
| Semantic | claim | Verifiable assertion: claim co-emerges with execution | 1 |
| Structural | stamp | Chain integrity: tampering is detectable through hash links | 1 |
| Cryptographic | seal | Identity binding: signature ties claim to verifiable identity | 5+ |

A Phase 1 receipt is **claimed and stamped**. A Phase 5+ receipt is
**claimed, stamped, and sealed**. The three-tier model allows independent
strength escalation: a deployment can choose chain-only integrity
(stamping) or full cryptographic integrity (sealing) based on threat
model.

---

## Artifacts

WitSeal produces several distinct artifacts during witnessed execution:

| Artifact | Definition |
|---|---|
| **Claim** | The verifiable assertion (the unit of recorded execution). A noun. |
| **Receipt** | The persisted record of a claim. Stored as a chain entry. |
| **Stamp** | The structural binding of a receipt into the chain (hash link). |
| **Seal** | The cryptographic binding of a receipt to an Attester identity. |
| **Evidence chain** | The cumulative sequence of receipts. |
| **Evidence package** | An exported subset of the evidence chain for sharing or audit. |

A receipt **contains** a claim. A claim **produces** a receipt. The chain
**stamps** receipts together. The Attester **seals** receipts cryptographically.

---

## Relationships diagram

```
Claimant
  │
  │ authorizes
  ▼
Claimer ──executes──► Action
                        │
                        │ co-emerges with
                        ▼
                      Claim
                        │
                        │ witnessed by
                        ▼
                      Witness
                        │
                        │ records as
                        ▼
                      Receipt
                        │
                  ┌─────┴─────┐
                  │           │
            stamped by   sealed by
                  │           │
                  ▼           ▼
              [chain]    [Attester]
                  │
                  └────► Evidence chain
                              │
                              │ inspected by
                              ▼
                       Verifier (active)
                       Observer (passive)
```

---

## Example: a single witnessed execution

A developer (Claimant) runs:

```
witseal exec -- npm test
```

The shell (Claimer) invokes `npm test`. WitSeal (Witness) observes the
attempted execution, classifies it, evaluates policy, and — assuming
allowed — executes it. WitSeal then creates a Claim describing the
execution, produces a Receipt, stamps the Receipt into the chain
(structural integrity), and in Phase 5+ would also seal it with the
developer's Sigstore identity (cryptographic integrity).

Later, a code reviewer (Verifier) runs:

```
witseal verify
cosign verify-blob …
```

…and confirms that the Receipt is intact, the chain is unbroken, and
(in Phase 5+) the signature is valid against the developer's published
identity.

A security researcher (Observer) reading public evidence packages
inspects receipts to study patterns of denied actions. They do not
re-verify; they read.

---

## Stability of this vocabulary

The role and operation vocabulary defined here is **canonical** for
WitSeal as of the version of this document. Changes require an
Architectural Decision Record (ADR) and a vocabulary migration plan.

See [ADR-0007: Role Vocabulary](adr/0007-role-vocabulary.md) for the
decision that established this model.
