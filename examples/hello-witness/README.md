# Hello, witness

The 90-second tour of WitSeal.

## What this shows

In about 90 seconds this walkthrough demonstrates:

1. WitSeal mediates a benign command and produces a hash-chained receipt.
2. WitSeal blocks a destructive command via a policy pack.
3. The denial itself is recorded as evidence.
4. The chain can be verified independently.

You will need a working WitSeal install (`npm install -g @witseal/cli`, or `npm link` from a local checkout).

## The walkthrough

### 1. Run a benign command

```bash
witseal exec -- echo "hello, witness"
```

You will see:
```
hello, witness
[witseal: event=evt_<id> receipt=rcpt_<id> risk=C0 outcome=allowed_executed]
```

The `echo` ran. WitSeal classified it as C0 (informational), the default policy allowed it, and an evidence chain entry was written.

### 2. Inspect the witness event log

```bash
witseal events list
```

You should see one event with sequence 0, decision `allow`, outcome `allowed_executed`.

### 3. Verify the chain

```bash
witseal verify
```

Expected output:
```
witseal: chain verified ✓
         segment: default
         events:  1
```

### 4. Add the destructive-block policy pack

```bash
witseal policy add ./examples/policy-packs/block-destructive.json
```

### 5. Try a destructive command

```bash
witseal exec -- rm -rf /tmp/witseal-test-target
```

You will see:
```
witseal: action denied by policy (rule deny-rm-rf-absolute, event evt_<id>)
         reason: rm -rf on absolute paths is denied without exception
```

The command did **not** execute. But the *attempt* is recorded — silence is not consent, and silence about denial is also not acceptable.

### 6. Confirm the denial is in the chain

```bash
witseal events list
```

You will see two events now: the original `echo` (sequence 0, allowed) and the denied `rm -rf` (sequence 1, decision `deny`, outcome `denied_by_policy`).

### 7. Replay the denial event

```bash
witseal replay 1
```

This walks through the recorded event, regenerates its receipt, verifies all hash linkages, and prints a summary.

### 8. Export an evidence package

```bash
witseal evidence export --out ./hello-witness-evidence.json
```

The exported file is independently verifiable. Anyone with the package alone (no access to your `.witseal` directory) can reconstruct and verify the chain head.

## What just happened

You produced two pieces of evidence:

- One receipt for an *allowed* action you actually ran
- One receipt for a *denied* attempt that never ran

Both are hash-linked. Tampering with either is detectable. Both are exportable as evidence.

This is the WitSeal Phase 1 wedge: every significant agent action — including the ones policy refuses to allow — becomes a verifiable artifact.

## Next

- Read [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) for the full runtime pipeline
- Read [`docs/adr/`](../../docs/adr/) for the design decisions
- Try the other policy packs in [`examples/policy-packs/`](../policy-packs/)
- Run an actual coding agent through `witseal exec` (see [`src/adapters/README.md`](../../src/adapters/README.md))
