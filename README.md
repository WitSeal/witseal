# WitSeal

> A witnessed execution runtime for AI-agent actions.

WitSeal produces execution evidence for agent actions. It records witness events
and execution receipts in an evidence chain so a developer can inspect what was
witnessed and verify the resulting evidence within the documented claim
boundary.

WitSeal Phase 1 is a pre-release. Schemas and CLI surface may change before
`v1.0`.

## Execution modes

WitSeal Phase 1 has one receipt protocol and two execution modes, selected per
invocation with `--mode`. **Gate is the default.**

### Gate Mode (default, deny-by-default)

Gate Mode places WitSeal in the agent's critical path. WitSeal classifies the
action, evaluates policy, records any approval-gate outcome, and — when the
policy decision is `deny` — the constraint blocks execution: the action does
not run, and the denial is recorded as execution evidence. The action proceeds
only after the pipeline clears. This is the deny-by-default posture, and the
default with no `--mode`.

### Witness Mode (explicit, non-default)

Witness Mode places WitSeal beside the agent's action path and **does not
block**. WitSeal still classifies the action and evaluates policy, and records
the policy decision — including a `deny` — as evidence, **but it does not
enforce that decision: the action executes**. The receipt records both the
policy decision and the fact of execution, under a distinct outcome
(`witnessed_executed`) that is never conflated with a blocked `denied_by_policy`
action.

Witness Mode is an explicit operator choice; it does not weaken the default. The
constraint is by policy decision, not authorship: WitSeal evaluates and records
against the active policy; it does not author the policy or the authority behind
an action. In Witness Mode in particular, WitSeal records what happened and what
policy decided — it does not prevent a denied action from running.

## Install

Install the `0.1.1` CLI from npm:

```bash
npm install -g @witseal/cli@0.1.1
```

## Run

WitSeal is **deny-by-default**: with no active policy pack it refuses to run a
command, and the refusal is itself recorded as evidence. You run an action
*through* a policy pack. The core command is:

```bash
witseal exec -- <command> [args...]
```

See the complete, reproducible flow under **Minimal example** below.

## Minimal example

Add a policy pack, run a benign command through it, inspect the receipt, and
verify the chain. This runs as-is.

Create a minimal pack (allow by default; deny `rm -rf` on absolute paths):

```bash
cat > quickstart-policy.json <<'EOF'
{
  "schema_version": "witseal.policy.v0.1",
  "pack_id": "quickstart",
  "version": "1.0.0",
  "description": "Quickstart: allow by default; deny rm -rf on absolute paths.",
  "rules": [
    {
      "id": "deny-rm-rf-absolute",
      "match": { "command_matches": "^rm\\s+(-[rRf]+\\s+)+(/|\\$HOME|~)" },
      "decision": "deny",
      "reason": "rm -rf on absolute paths is denied"
    }
  ],
  "default_decision": "allow"
}
EOF
```

Then add it, run a command, inspect the receipt, and verify:

```bash
export WITSEAL_DATA_DIR="$(mktemp -d)"
witseal policy add ./quickstart-policy.json
witseal exec -- echo hello
witseal receipt show 1
witseal verify
witseal evidence export --out ./quickstart-evidence.json
witseal verify ./quickstart-evidence.json
```

`policy add` registers the pack — without an active pack, deny-by-default refuses
the action (and records the refusal as evidence). `exec` runs the action through
the pack: `echo` is risk class C0, the pack allows it, it executes, and an
execution receipt is written; `exec` prints the paired event and receipt ids.
`receipt show` renders a receipt for inspection, addressed by its receipt id, the
paired event id, a sequence number, or a unique prefix — here sequence `1` is the
completed execution (`allowed_executed`) and sequence `0` is its
`intent_recorded` precursor. `verify` checks the live evidence chain, and
`evidence export` writes an evidence package that `verify` can check offline.

A command the pack denies (e.g. `witseal exec -- rm -rf /`) is refused — and the
denial is recorded as evidence too.

Because the chain is hash-linked, `witseal verify` surfaces tampering with a
recorded receipt or event — and any break in the chain — as an evidence-
continuity failure, within the documented claim boundary.

## Claim boundary

WitSeal documents what Phase 1 claims and what it does not claim in
[`docs/CLAIM_BOUNDARY.md`](./docs/CLAIM_BOUNDARY.md).

In particular:

- Witness Mode witnesses actions and emits verifiable receipts without gating.
- Permissioned execution is a Gate-Mode claim.
- Verification is about evidence continuity within the documented boundary; it
  does not claim execution correctness, model correctness, truthfulness,
  authorization legitimacy, or absence of compromise.

## Further reading

- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for the runtime architecture.
- [`STYLE.md`](./STYLE.md) for WitSeal vocabulary discipline.
- [`SECURITY.md`](./SECURITY.md) for vulnerability reporting and release
  verification guidance.

## License

Apache License 2.0. See [`LICENSE`](./LICENSE).
