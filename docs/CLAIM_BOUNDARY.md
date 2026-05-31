# WitSeal Claim Boundary

Status: Phase 1 public claim boundary
Verified against: `@witseal/cli@0.1.2`

WitSeal Phase 1 makes a narrow claim: the CLI can mediate actions through a
policy pack, record witness events and execution receipts, export an evidence
package, and verify evidence continuity inside the limits below.

Anything outside this document is not a Phase 1 public claim.

## Execution Modes (Gate and Witness)

WitSeal Phase 1 runs in two execution modes selected per invocation with
`--mode`. **Gate is the default.**

**Gate Mode (default, deny-by-default).** WitSeal sits in the action's critical
path. A policy decision of `deny` blocks execution: the action does not run, and
the denial is recorded as execution evidence. This is the deny-by-default
posture.

**Witness Mode (explicit, non-default).** WitSeal sits beside the action path
and does not block. The policy decision is still computed and recorded as
evidence — including a `deny` decision and its policy context — but it is not
enforced, and the action executes. The resulting receipt records both the policy
decision and the fact of execution, under a distinct outcome
(`witnessed_executed`) that is never confused with a blocked `denied_by_policy`
action.

Witness Mode is an explicit operator choice. It does not weaken the default:
with no `--mode`, WitSeal is Gate, deny-by-default.

**The constraint is by policy decision, not authorship.** WitSeal evaluates and
records against the active policy; it does not author the policy or the authority
behind an action. In both modes WitSeal produces evidence; only Gate Mode
applies the constraint.

**Phase 1 boundary (unchanged) — WitSeal does not claim:** sandboxing or
kernel-level containment; prompt-injection defense; protection against a
malicious producer who can rewrite the local chain before export; correctness of
the executed command or its result. In Witness Mode in particular, WitSeal
records what happened and what policy decided — it does not prevent a denied
action from running.

> Witness Mode (`--mode witness`) and the `witnessed_executed` outcome arrive in
> `0.1.2`. The verified flow below is Gate Mode on `0.1.2`; the Witness
> demonstration is marked for `0.1.2` and is verified at that release.

## Demonstrable QA Flow

The positive claims below are bounded by this fresh-package flow:

```bash
set -euo pipefail

npm install -g @witseal/cli@0.1.2
export WITSEAL_DATA_DIR="$(mktemp -d)"

NO_POLICY_DATA_DIR="$(mktemp -d)"
if WITSEAL_DATA_DIR="$NO_POLICY_DATA_DIR" witseal exec -- echo no-policy; then
  echo "expected no-policy execution to fail closed" >&2
  exit 1
else
  exit_code=$?
  test "$exit_code" -eq 100
fi
WITSEAL_DATA_DIR="$NO_POLICY_DATA_DIR" witseal receipt show 0
WITSEAL_DATA_DIR="$NO_POLICY_DATA_DIR" witseal verify

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

witseal policy add ./quickstart-policy.json
witseal exec -- echo hello
witseal receipt show 1
witseal replay 1
witseal verify
if witseal exec -- rm -rf /; then
  echo "expected destructive execution to be denied" >&2
  exit 1
else
  exit_code=$?
  test "$exit_code" -eq 100
fi
witseal evidence export --out ./witseal-evidence.json
witseal verify ./witseal-evidence.json

node -e "const fs=require('node:fs'); const p='witseal-evidence.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); j.events[1].agent_identifier='tampered'; fs.writeFileSync('witseal-evidence-tampered.json', JSON.stringify(j,null,2));"
if witseal verify ./witseal-evidence-tampered.json; then
  echo "expected tampered evidence package to be invalid" >&2
  exit 1
else
  exit_code=$?
  test "$exit_code" -eq 1
fi
```

The expected-failure checks above must exit with the listed codes.

This flow creates its own policy file. It does not rely on policy-pack paths
being present inside the npm package.

### Witness Mode (`--mode witness`, from `0.1.2`)

Witness Mode does not block: it executes an action the policy would deny and
records it under `witnessed_executed`, distinct from a blocked `denied_by_policy`
action. Shown on a harmless command (`echo`) denied by a demo policy, so the
example is safe to run, and in its own data directory:

```bash
export WITSEAL_DATA_DIR="$(mktemp -d)"
cat > deny-echo.json <<'EOF'
{
  "schema_version": "witseal.policy.v0.1",
  "pack_id": "deny-echo-demo",
  "version": "1.0.0",
  "description": "Demo: deny echo, to show the Gate/Witness difference safely.",
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
witseal policy add ./deny-echo.json

# Gate (default): the deny blocks execution.
if witseal exec -- echo hi; then
  echo "expected Gate to block the denied command" >&2
  exit 1
else
  test "$?" -eq 100
fi

# Witness: the same deny is recorded, but the action executes.
witseal exec --mode witness -- echo hi   # prints "hi"; outcome witnessed_executed
witseal receipt show 1                   # outcome witnessed_executed
```

The two runs are distinguishable by outcome: `denied_by_policy` (Gate, not
executed) versus `witnessed_executed` (Witness, executed). This Witness run is
verified at the `0.1.2` release.

## Positive Claims

For the verified `@witseal/cli@0.1.2` flow, WitSeal Phase 1 claims:

- `npm install -g @witseal/cli@0.1.2` installs the CLI.
- With no active policy pack, `witseal exec -- <command>` fails closed, exits
  with code `100`, and records a `no_policy_configured` receipt.
- `witseal policy add <file>` registers a local JSON policy pack that conforms
  to the Phase 1 policy schema.
- `witseal exec -- echo hello`, with the quickstart policy active, executes the
  allowed command and records execution evidence.
- A completed allowed execution is represented by witness events and an
  execution receipt. In the fresh-package QA flow, `receipt show 1` displays the
  completed `allowed_executed` receipt because sequence `0` is the
  `intent_recorded` precursor and sequence `1` is the completed execution.
- `witseal replay 1` reconstructs the recorded evidence relationships for the
  completed execution without re-running the command.
- `witseal verify` verifies the live evidence chain and reports an invalid
  chain if event continuity is broken.
- `witseal exec -- rm -rf /`, with the quickstart policy active, is denied by
  policy, exits with code `100`, and records the denial as execution evidence.
- `witseal evidence export --out <file>` exports an evidence package containing
  the recorded witness events and receipts.
- `witseal verify <evidence-package.json>` verifies an exported evidence package.
- If an exported evidence package is modified after export, `witseal verify`
  reports `INVALID` for the modified package.

## What Verification Means

Verification means evidence continuity inside the local Phase 1 boundary:

- witness event hashes match their event content;
- event sequence and previous-hash links are continuous;
- execution receipts match the witness events they reference;
- exported evidence packages preserve those relationships.

Verification does not extend beyond those evidence relationships.

## Schema Evolution and Receipt Portability

WitSeal's witness-event and receipt schemas evolve additively, and that
evolution does not retroactively invalidate evidence already produced:

> Historical receipts remain verifiable. Future runtimes may stop emitting
> deprecated outcomes.

A newer runtime may stop *emitting* an outcome value it has deprecated, but it
continues to *verify* receipts that carry it. Evidence produced by an earlier
runtime stays checkable within the documented boundary.

## Explicit Non-Claims

WitSeal Phase 1 does not claim:

- sandboxing or kernel-level containment;
- prompt-injection defense;
- protection against a malicious producer who can rewrite the local chain before
  export;
- correctness of the executed command, subprocess, model output, or result;
- legitimacy of the policy, authority declaration, or human authorization behind
  an allowed action;
- that every repository document or reference policy path is present in every
  previously published npm package;
- third-party signatures or public transparency-log inclusion for local
  execution receipts.

## Reading Order

- [`README.md`](../README.md) for the shortest install and quickstart path.
- [`docs/threat-model.md`](./threat-model.md) for the adversary model.
- [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) for the Phase 1 runtime model.
