# WitSeal

> A witnessed execution runtime for AI-agent actions.

WitSeal produces execution evidence for agent actions. It records witness events
and execution receipts in an evidence chain so a developer can inspect what was
witnessed and verify the resulting evidence within the documented claim
boundary.

WitSeal Phase 1 is a pre-release. Schemas and CLI surface may change before
`v1.0`.

## Deployment modes

WitSeal Phase 1 has one receipt protocol and two deployment modes.

### Witness Mode

Witness Mode places WitSeal beside the agent's action path. WitSeal observes
actions, witnesses them, and emits execution receipts without gating the action
path. Witness Mode does not claim that an action was permissioned.

Witness Mode is the recommended starting point when the first requirement is
verifiable execution evidence without inserting WitSeal into the critical path.

### Gate Mode

Gate Mode places WitSeal in the agent's critical path. In this mode, WitSeal
classifies the action, evaluates policy, records any approval gate outcome,
witnesses the execution, and emits an execution receipt. Gate Mode is
deny-by-default: the action proceeds only after the pipeline clears.

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
