# Review packet: WitSeal public-claim self-audit, 2026-10

This packet lets a reviewer check the main corrections of
[`../CBEE-SELF-AUDIT-2026-10.md`](../CBEE-SELF-AUDIT-2026-10.md) in about
thirty minutes, without reading the whole repository. The producer prepared it;
it is input for an independent review, not the result of one. It has not been
sent to anyone.

- Audited commit: `WitSeal/witseal@c80600f91c63d1dcee72d510f035133a2cf2f85e`
  (`@witseal/cli@0.4.2`).
- Claim boundary: [`docs/CLAIM_BOUNDARY.md`](../../CLAIM_BOUNDARY.md), not
  changed by the audit (SHA-256 `96d24c3b…728b`). `CLAIMS.md` cites its lines.
- Reference text: `draft-sergeev-claim-boundaries-01` (SHA-256
  `0d906383…6d35`), cited below as "the draft".

## Contents

| Path | What it is |
|---|---|
| `CLAIMS.md` | Eight claims, each traced from the original wording through product semantics (files and lines at the audited commit), a receipt or command output, the `CLAIM_BOUNDARY.md` lines, and the rule of the draft, to the corrected wording |
| `evidence/package.json` | An unmodified evidence package exported by `@witseal/cli@0.4.2` in Gate Mode with the quickstart policy: an allowed command, a denied command, and a command whose executable does not exist |
| `evidence/package-rehashed.json` | The same package after changing event 1's `agent_identifier` to `tampered` and recomputing every later hash with the public rule |
| `evidence/receipt-*.json`, `evidence/event-*.json` | Single receipts and events copied verbatim out of `evidence/package.json`, for reading |
| `repro/run.sh` | The script that produced `evidence/` and the output below; it works in a fresh temporary directory and uses no network |
| `repro/rehash.mjs` | Re-derives every hash of a v0.1 package or live event log after an edit (JCS + SHA-256, as in ADR-0001) |
| `repro/expected-output.txt` | The output of `repro/run.sh` for the run that produced `evidence/` |

## How to review

1. Read §1 (summary) and §3 (method) of the report. About five minutes.
2. Work through `CLAIMS.md`. For each claim, ask whether the corrected wording
   is the ceiling the evidence supports: not lower where the evidence is
   strong, not higher anywhere. About fifteen minutes.
3. Check the evidence offline. About five minutes; needs Node.js 20 or later.

   ```bash
   npm install -g @witseal/cli@0.4.2
   cd docs/audits/cbee-review-packet-2026-10
   witseal verify evidence/package.json            # VALID
   witseal verify evidence/package-rehashed.json   # VALID: the edit is not caught
   node -e "for (const f of ['package.json', 'package-rehashed.json']) console.log(f, require('./evidence/' + f).chain_head_after_range)"
   ```

   The head printed when `evidence/package.json` was exported is
   `390c90462c5bcdeabf070c86cbdf2dde63a37cd5f876058820e9d1a2dd28b11a`
   (`repro/expected-output.txt`, step B1). The re-hashed copy declares
   `c33c48538f0e616c991e4036a446260fbf13bec40799e8dcfbce1a5885672694`. Only
   that comparison reveals the edit.
4. Optionally run `repro/run.sh` and compare its output with
   `repro/expected-output.txt`. Ids, timestamps, and hashes differ from run to
   run; the verdicts do not. About five minutes.
5. Answer the questions in §11 of the report, or add your own.

## What the evidence files show

- `receipt-0-pending.json`: a receipt whose outcome is `pending`, the
  precursor written before the command ran.
- `receipt-1-allowed_executed.json`: the receipt of an action WitSeal ran.
- `receipt-2-denied_by_policy.json` with `event-2-denied_by_policy.json`: a
  receipt for an action that did not run (`execution_result: null`).
- `event-4-spawn-error.json`: outcome `allowed_executed_with_error` with
  `spawn_error` set and `exit_code: -1`; no process started.

Each file recomputes on its own: an event's `event_hash` is SHA-256 over the
JCS form of the event without `event_hash`, and a receipt's `receipt_hash` is
the same over the receipt without `receipt_hash`. The events record the run's
temporary working directory as `cwd`.

## Not in this packet

- Two security-relevant findings (S-1 and S-2 in the report). Per
  `SECURITY.md` they are reported to the maintainer in a private annex outside
  this branch; the report applies their consequences for public wording.
- Findings in private repositories, summarized in the report as X-01 to X-04.
