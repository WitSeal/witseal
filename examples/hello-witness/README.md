# Hello, witness

The 90-second tour of WitSeal for `@witseal/cli@0.1.2`.

## What this shows

In about 90 seconds this walkthrough demonstrates:

1. WitSeal loads a local policy pack.
2. WitSeal mediates an allowed command and produces a hash-chained receipt.
3. WitSeal denies a destructive command through policy.
4. The denial itself is recorded as evidence.
5. The live chain and exported evidence package can be verified.
6. Tampering with the exported package is reported as `INVALID`.

You will need a working WitSeal install:

```bash
npm install -g @witseal/cli@0.1.2
```

## The walkthrough

### 1. Start with a fresh data directory

```bash
export WITSEAL_DATA_DIR="$(mktemp -d)"
```

This keeps the sequence numbers below reproducible.

### 2. Create a quickstart policy

The npm package may not include reference policy-pack files. Create the policy
used by this walkthrough locally:

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

### 3. Add the policy pack

```bash
witseal policy add ./quickstart-policy.json
```

WitSeal is deny-by-default: without an active policy pack, `exec` refuses to run
the command and records the refusal as evidence.

### 4. Run an allowed command

```bash
witseal exec -- echo "hello, witness"
```

You will see the command output and a WitSeal footer:

```
hello, witness
[witseal: event=evt_<id> receipt=rcpt_<id> risk=C0 outcome=allowed_executed]
```

The allowed execution writes two witness events in this fresh flow: sequence `0`
is `intent_recorded`, and sequence `1` is the completed execution.

### 5. Inspect the execution receipt

```bash
witseal receipt show 1
```

`receipt show` answers "what happened?" for the completed execution receipt.

### 6. Verify the live chain

```bash
witseal verify
```

Expected shape:

```
witseal: VALID ... (chain)
         segment: default
         events:  2
```

### 7. Try a denied command

```bash
witseal exec -- rm -rf /tmp/witseal-test-target
```

You will see a denial diagnostic:

```
witseal: action denied by policy (rule deny-rm-rf-absolute, event evt_<id>)
         reason: rm -rf on absolute paths is denied
```

The command did not execute. The denied attempt is recorded as evidence and
`witseal exec` exits with code `100`.

### 8. Export and verify an evidence package

```bash
witseal evidence export --out ./hello-witness-evidence.json
witseal verify ./hello-witness-evidence.json
```

The exported package is independently verifiable from the package contents.

### 9. Confirm tamper detection

```bash
node -e "const fs=require('node:fs'); const p='hello-witness-evidence.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); j.events[1].agent_identifier='tampered'; fs.writeFileSync('hello-witness-evidence-tampered.json', JSON.stringify(j,null,2));"
witseal verify ./hello-witness-evidence-tampered.json
```

Expected result: `INVALID`.

## What just happened

You produced two pieces of evidence:

- One completed execution receipt for an allowed action you ran
- One denial receipt for an attempt that policy refused

Both are hash-linked. Tampering with the exported evidence package is detectable.

This is the WitSeal Phase 1 wedge: every significant agent action — including the ones policy refuses to allow — becomes a verifiable artifact.

This walkthrough ran in **Gate Mode** — the default, deny-by-default: the denied `rm -rf` did not execute. WitSeal also has **Witness Mode** (`--mode witness`, from `0.1.2`), which does not block — it executes an action the policy would deny and records it as evidence under a distinct `witnessed_executed` outcome, never confused with a blocked `denied_by_policy`. See [`docs/CLAIM_BOUNDARY.md`](../../docs/CLAIM_BOUNDARY.md) for both modes.

## Next

- Read [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) for the full runtime pipeline
- Read [`docs/CLAIM_BOUNDARY.md`](../../docs/CLAIM_BOUNDARY.md) for the public claim boundary
- Read [`docs/adr/`](../../docs/adr/) for the design decisions
- Run an actual coding agent through `witseal exec` (see [`src/adapters/README.md`](../../src/adapters/README.md))
