# RFC-0003 — Witness outcome model reconciliation + schema-version policy

**Status:** Draft — founder decisions fixed 2026-05-31 (A=YES, B=Option 2).
Awaiting TS + Rust sign-off and tested support (cross-track wire-format
coordination process) before release.

**Tracks:** TypeScript (`@witseal/cli`) · Rust (reference implementation)

---

## Context

Post-0.1.2 review surfaced a `WitnessOutcome` model divergence between the TS
and Rust tracks:

1. **`no_policy_configured` placement differs.** TS emits it as a
   `WitnessOutcome` value; Rust implemented it as a `PolicyOutcome` value.
   This breaks cross-track event exchange: a Rust `PolicyDecision.outcome =
   "no_policy_configured"` is rejected by the TS verifier.

2. **`pending` / `execution_lost` version-semantics conflict.** TS emits both
   values under `witseal.witness.v0.1`; the Rust reference tracks
   two-phase-commit (2PC) semantics to `witseal.witness.v0.2`. Both values
   shipped in `@witseal/cli@0.1.2`, so historical receipts already exist in the
   wild.

---

## Decisions

Both decisions are fixed by the founder (2026-05-31) and are not open for
renegotiation in track sign-off.

### Decision A — `no_policy_configured` is a `WitnessOutcome`, not a `PolicyOutcome`

**YES.**

`no_policy_configured` belongs to the witness-event outcome set, not to the
policy-decision outcome set.

- **TS:** unchanged — already emitted as `WitnessOutcome`.
- **Rust:** remove `PolicyOutcome::NoPolicyConfigured`; the `PolicyOutcome`
  value set becomes `{allow, deny, require-approval}` (the three authored
  policy decision outcomes).

**Rationale.** "No policy pack loaded" is a witness-path runtime state, not an
authored policy decision. A policy decision describes what an explicit policy
configuration instructs; it cannot express the absence of any policy
configuration. The evidence record (the witness event) is the correct place to
capture the runtime condition that no policy was configured. This is consistent
with the principle that policy yields `allow | deny | require-approval` and that
witness-path evidence captures what actually happened at runtime.

### Decision B — `pending` / `execution_lost`: forward-deprecate, no history break (Option 2)

**Option 2 selected.**

1. **v0.1 verifiers MUST continue to accept and verify `pending` /
   `execution_lost`.** Both values shipped in 0.1.2; receipts bearing them are
   valid historical evidence and must remain verifiable indefinitely.

2. **New runtimes STOP emitting `pending` / `execution_lost` under
   `witseal.witness.v0.1`.** Both are marked deprecated-for-emission in v0.1.
   They are retained in the verifier acceptance set.

3. **2PC semantics develop under `witseal.witness.v0.2`**, introduced separately
   by a forthcoming RFC. That RFC is out of scope here.

4. **Both tracks:** mark `pending` and `execution_lost` as
   deprecated-for-emission in v0.1 documentation. Do not remove them from the
   v0.1 read/verify path.

**Governing principle (founder, verbatim):**
> "Historical receipts remain verifiable. Future runtimes may stop emitting
> deprecated outcomes."

This follows from the evidence-portability principle: a receipt issued by a
public runtime must stay verifiable regardless of later model evolution.

---

## Wire-format impact

| Change | Impact |
|---|---|
| Decision A: Rust `PolicyOutcome` shrinks (removes `no_policy_configured`) | Additive-safe for readers — existing `allow \| deny \| require-approval` consumers are unaffected. |
| Decision B: `pending` / `execution_lost` deprecated-for-emission | No removal from the v0.1 verifier acceptance set; emission set narrows (forward-only). |
| Receipt v0.2 | Untouched. Field set unchanged. |
| Golden receipt | Byte-identical — `no_policy_configured` / `pending` / `execution_lost` do not appear in the golden receipt fixture. |

---

## Backward compatibility

- All `@witseal/cli@0.1.2`-issued receipts, including those bearing
  `pending` or `execution_lost`, remain valid under v0.1 verifiers. This
  invariant is unconditional.
- Cross-track exchange is repaired by Decision A: once Rust removes
  `PolicyOutcome::NoPolicyConfigured`, the Rust runtime emits
  `no_policy_configured` as a `WitnessOutcome`, which the TS verifier already
  accepts.

---

## Migration

| Track | Required action |
|---|---|
| TS | No schema change. Stop emitting `pending` / `execution_lost` in new runtimes. Mark deprecated in docs. |
| Rust | Remove `PolicyOutcome::NoPolicyConfigured`. Add `WitnessOutcome::NoPolicyConfigured`. Mark `WitnessOutcome::Pending` / `ExecutionLost` deprecated-for-emission (retain for read/verify). |
| Both | Produce and verify a new Witness compat-corpus chain before releasing. |

Released only after both tracks have sign-off **and** tested support.

---

## Open items (resolve in joint review)

1. **Deprecation annotation form.** Doc-level (`/// Deprecated: do not emit
   under v0.1`) vs schema-level marker (e.g. a separate `deprecated_outcomes`
   list). Joint decision between tracks.

2. **Rust version note for `PolicyOutcome` shrink.** Whether to record a
   crate-level changelog entry noting that `NoPolicyConfigured` moved from
   `PolicyOutcome` to `WitnessOutcome`. Rust internal decision.

3. **`witseal.witness.v0.2` scope.** Deferred entirely to its own RFC (out of
   scope here). The only decision here is that 2PC semantics develop there.

---

## Unresolved

None — the two open items above are annotation/process choices, not
normative blockers.
