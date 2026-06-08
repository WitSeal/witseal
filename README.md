# WitSeal

> A witnessed execution runtime for AI-agent actions.

WitSeal produces execution evidence for agent actions. It classifies each action
against an explicit authority boundary, then records witness events and execution
receipts in an evidence chain so a developer can inspect what was witnessed and
verify the resulting evidence within the documented claim boundary.

WitSeal Phase 1 is a pre-release. Schemas and CLI surface may change before
`v1.0`.

## Recommended path: Witness → Understand → Enforce

The fastest way to adopt WitSeal is to **start in Witness Mode**, learn what your
agent actually does, and only then turn on enforcement. The CLI default stays
**Gate Mode (deny-by-default)** — Witness is the recommended on-ramp, not a
change to the default.

1. **Witness** — run real actions through WitSeal with `--mode witness`. Nothing
   is blocked: WitSeal records the policy decision — including a `deny` — and the
   fact of execution, as evidence. You observe what your agent does, and what a
   policy *would* decide, on real actions.
2. **Understand** — inspect the receipts and verify the chain. See which actions
   a policy would deny, where the risk concentrates, and refine the pack until
   the policy matches what you observed.
3. **Enforce** — drop `--mode witness`. **Gate Mode is the CLI default**
   (deny-by-default): a `deny` now blocks execution, and the denial is recorded
   as evidence.

> Witness Mode executes the action — including one the policy would deny. Only
> witness commands you are willing to actually run.

## Install

Install the `0.4.1` CLI from npm:

```bash
npm install -g @witseal/cli@0.4.1
```

## Connect an MCP client (one command)

Wire WitSeal into your MCP client — **Claude Desktop**, **Claude Code**, or
**Cursor** — so the agent gets a witnessed `shell` tool. One command, idempotent,
safe by default (witness mode records without blocking):

```bash
witseal connect                 # auto-detect + configure all supported clients
# or target one:
witseal connect claude-desktop
witseal connect claude-code
witseal connect cursor
# preview the changes without writing:
witseal connect --print
# enforce instead of record:
witseal connect --mode gate
```

It adds a `witseal` entry to the client's MCP config (never clobbering your other
servers) and scaffolds a starter policy pack under `~/.witseal/`. Restart the
client, ask it to run a shell command through WitSeal, then `witseal receipt
show` and `witseal verify`.

> **Scope:** the WitSeal MCP server witnesses commands run through its own
> `shell` tool — not the client's other tools or native actions. See
> [`src/adapters/mcp/README.md`](src/adapters/mcp/README.md).

## Execution modes

WitSeal Phase 1 has one receipt protocol and two execution modes, selected per
invocation with `--mode`. **Gate is the default.** Witness Mode is described
first below because it is the recommended starting point; at runtime, with no
`--mode`, WitSeal is Gate.

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

### Gate Mode (default, deny-by-default)

Gate Mode places WitSeal in the agent's critical path. WitSeal classifies the
action, evaluates policy, records any approval-gate outcome, and — when the
policy decision is `deny` — the constraint blocks execution: the action does
not run, and the denial is recorded as execution evidence. The action proceeds
only after the pipeline clears. This is the deny-by-default posture, and the
default with no `--mode`.

## Walkthrough: Witness → Understand → Enforce

This reproducible walkthrough uses a tiny demo policy that denies a harmless
command (`echo`) so the Witness/Gate difference is visible and safe to run.

Create the demo policy (allow by default; deny `echo`):

```bash
export WITSEAL_DATA_DIR="$(mktemp -d)"
cat > deny-echo-policy.json <<'EOF'
{
  "schema_version": "witseal.policy.v0.1",
  "pack_id": "deny-echo-demo",
  "version": "1.0.0",
  "description": "Demo: deny echo, to show the Witness/Gate difference safely.",
  "rules": [
    {
      "id": "deny-echo",
      "match": { "command_matches": "^echo\\b" },
      "decision": "deny",
      "reason": "echo denied (demo)"
    }
  ],
  "default_decision": "allow"
}
EOF
witseal policy add ./deny-echo-policy.json
```

**1. Witness** — observe a would-be-denied action without blocking it:

```bash
witseal exec --mode witness -- echo hello   # prints "hello"
```

The command runs even though the policy decides `deny`. WitSeal records the
decision and the execution under the outcome `witnessed_executed` — distinct
from a blocked `denied_by_policy`.

**2. Understand** — inspect the evidence and verify the chain:

```bash
witseal receipt show 1   # outcome: witnessed_executed
witseal verify           # VALID (live chain)
witseal evidence export --out ./walkthrough-evidence.json
witseal verify ./walkthrough-evidence.json
```

Sequence `1` is the completed Witness execution; sequence `0` is its
`intent_recorded` precursor. Reading these receipts is how you learn which
actions a policy would deny on real traffic, and refine the pack to match.

**3. Enforce** — drop `--mode witness` and let the CLI default (Gate,
deny-by-default) enforce the same policy:

```bash
witseal exec -- echo hello   # denied by policy; does not run; exits 100
witseal verify               # VALID (the denial is recorded as evidence)
```

The same `deny` that Witness merely recorded now blocks execution. The two runs
are distinguishable by outcome: `witnessed_executed` (Witness, executed) versus
`denied_by_policy` (Gate, not executed).

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
