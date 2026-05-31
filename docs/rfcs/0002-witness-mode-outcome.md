# RFC-0002 — Witness Mode outcome: `witnessed_executed`

**Status:** Draft — open questions resolved by founder 2026-05-31. Awaiting
TS + Rust signatures and tested support (DR-0008 D3) before release.

**Tracks:** TypeScript (`@witseal/cli`) · Rust (reference implementation)

---

## Context

WitSeal runs in two execution modes, selected per invocation with `--mode`:

- **Gate Mode** (default, deny-by-default): a `deny` policy decision blocks
  execution; the denial is recorded as evidence.
- **Witness Mode** (explicit, non-default): the policy decision is recorded as
  evidence but **not enforced** — the action executes even when the policy
  decision is `deny`.

The evidence core and the constraint contour are now separated by a clean seam
(`src/policy/enforcement.ts::applyConstraint`); the CLI `--mode` flag exists and
Gate Mode is unchanged. The one remaining piece that touches the wire format is
the **outcome** recorded when Witness Mode executes a would-be-denied action.

The current witness-event outcome enum has no value for "executed even though
the policy decided `deny`". Reusing `denied_by_policy` would be wrong: that
outcome carries the invariant **`denied_by_policy` ⇒ `execution_result = null`**
(denied ⇒ not executed). A Witness execution has a non-null `execution_result`.

## Decision

Add two **additive** values to the witness-event outcome enum
(`witseal.witness.v0.1` `WitnessOutcomeSchema`):

- `witnessed_executed` — Witness Mode executed an action whose policy decision
  was not `allow` (i.e. `deny` or `require-approval`); the policy decision is
  recorded as evidence, the constraint was not enforced, and
  `execution_result` is non-null.
- `witnessed_executed_with_error` — as above, where the executed action exited
  non-zero or failed to spawn.

The mode marker is **outcome only**. No boolean mode flag (`shadow_mode` or an
`enforcement_mode` field) is introduced — the new outcome value, together with
the recorded `policy_decision`, fully expresses the Witness case. This keeps the
receipt schema unmoved.

`computeOutcome` map (Witness Mode):

| policy decision | executed | outcome |
|---|---|---|
| `allow` | yes | `allowed_executed` / `allowed_executed_with_error` (unchanged) |
| `deny` / `require-approval` | yes | `witnessed_executed` / `witnessed_executed_with_error` (new) |

Gate Mode is unchanged: `deny` ⇒ blocked ⇒ `denied_by_policy`,
`execution_result = null`.

## Wire-format impact

- **Witness event** (`witseal.witness.v0.1`): additive enum values only. No
  field removed, renamed, or made required.
- **Execution receipt** (`witseal.receipt.v0.2`): **unchanged**. The receipt's
  `outcome` is already an open string, so the new value flows through with no
  schema change. The closed receipt field set, the signing pre-image, and the
  golden receipt fixture are untouched.
- **Golden receipt**: byte-identical. The fixture's outcome is `allowed_executed`
  and carries no mode marker; an additive enum value does not change it. No
  golden-anchor regeneration.

## Backward-compatibility strategy

- Additive enum values are forward-compatible for readers that pass through
  unknown outcome strings. Existing fixtures and chains are unaffected.
- Existing cross-track compatibility chains are **not modified** (wire-format
  immutability). A **new** Witness-Mode chain is **added** to the shared
  compatibility corpus and verified by both implementations' CI.
- The invariant `denied_by_policy` ⇒ `execution_result = null` is preserved:
  `denied_by_policy` is emitted only on the Gate block path; Witness emits
  `witnessed_executed` instead, never `denied_by_policy`.

## Migration path

1. Both implementations add the two outcome values to their witness-event
   outcome enum.
2. Both implementations wire the Witness execution path + `computeOutcome` map.
3. A new Witness-Mode chain is added to the shared compatibility corpus; both
   CIs verify it; existing chains remain unchanged and green.
4. Released as a **new version** (next is `0.1.2`), not a re-release of an
   existing published version, and only after both implementations have tested
   support.

## Founder decisions (resolved 2026-05-31)

The following questions were open in the circulated draft and are now closed by
the founder. Neither question is subject to re-open in TS or Rust sign-off.

1. **Witness-event schema version literal — ADDITIVE within `witseal.witness.v0.1`,
   no bump.** The two new outcome values are backward-compatible enum additions.
   Readers that pass through unknown outcome strings remain compatible; the
   schema literal stays `witseal.witness.v0.1`; the golden receipt is byte-for-byte
   intact. Bumping to `v0.2` is explicitly rejected.

2. **Witness Mode with no policy pack — emit `no_policy_configured`, execute,
   no enforcement.** When Witness Mode runs and no policy pack is configured,
   the witness event records `no_policy_configured` as the outcome and the
   action executes; the absence of a policy pack is not treated as a block.
   Gate Mode behavior is unchanged and remains fail-closed (deny-by-default):
   no policy pack in Gate Mode is a hard deny.
