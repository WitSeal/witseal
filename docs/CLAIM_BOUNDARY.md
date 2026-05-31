# WitSeal Claim Boundary

Status: Phase 1 public claim boundary
Verified against: `@witseal/cli@0.1.1`

WitSeal Phase 1 makes a narrow claim: the CLI can mediate actions through a
policy pack, record witness events and execution receipts, export an evidence
package, and verify evidence continuity inside the limits below.

Anything outside this document is not a Phase 1 public claim.

## Demonstrable QA Flow

The positive claims below are bounded by this fresh-package flow:

```bash
set -euo pipefail

npm install -g @witseal/cli@0.1.1
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

## Positive Claims

For the verified `@witseal/cli@0.1.1` flow, WitSeal Phase 1 claims:

- `npm install -g @witseal/cli@0.1.1` installs the CLI.
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
