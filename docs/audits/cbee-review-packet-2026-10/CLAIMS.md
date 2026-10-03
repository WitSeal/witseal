# Eight claims, traced

Each entry gives the original wording, where it appeared, what the product
does (files and lines at the audited commit `c80600f`), the evidence in this
packet, the `CLAIM_BOUNDARY.md` lines that bear on it, the rule of the draft
that decides it, the corrected wording, and why the correction is no larger
than it needs to be. Register ids refer to §5.2 of the report.

Claims 1 to 5 test the five hypotheses the audit was asked to test. Claims 6
to 8 are the next most consequential findings: one is text shown to models,
one is a capability the live site claimed, one is a statement about failures.

---

## 1. "A receipt is structured proof of a completed action."

- **Where.** `STYLE.md:35` (W-04); the same sentence in
  `schemas/receipt.schema.ts:4-6`, shipped in the npm package (W-82), and in
  `docs/ARCHITECTURE.md:97` (W-51). Related: `docs/model.md:112-114`, "a claim
  … cannot exist without the execution having occurred" (W-69).
- **What the product does.** Every witness event carries a `receipt_id`,
  whatever its outcome. An executed action first writes a `pending` precursor,
  before anything runs, then the final event (`src/cli/exec.ts:241-287`). A
  denial writes one event with `execution_result: null`
  (`src/cli/exec.ts:220-239`). A v0.1 receipt is derived from its event when it
  is shown or exported (`src/cli/receipt.ts:12-18`,
  `src/receipts/generate.ts:36-52`).
- **Evidence.** `evidence/receipt-0-pending.json` (outcome `pending`) and
  `evidence/receipt-2-denied_by_policy.json` (outcome `denied_by_policy`,
  `execution_result_hash: null`) are receipts for actions that had not run or
  never ran. `repro/expected-output.txt`, steps A4 and A5.
- **`CLAIM_BOUNDARY.md`.** L185-186: a refused command "records a
  `no_policy_configured` receipt". L191-194: the completed receipt is sequence
  `1` because sequence `0` is the precursor.
- **Rule.** Draft §4: the evidence bases "are distinct questions about one
  action", and "evidence relevant to one base does not, merely by being
  assigned to that base, satisfy the evidential criteria relied on for
  another." §6 rule 3: "A receipt, record, or registration is not external
  execution or effect." Two-case test (§3): a relying party holding a receipt
  cannot tell from the receipt's existence whether the action completed; only
  its `outcome` can.
- **Class.** OVERCLAIM.
- **Corrected** (`STYLE.md`). "A receipt is a structured record of one witness
  event's outcome — executed, denied, pending, or lost — that `witseal verify`
  checks against its event's content hashes. It is not proof that an action
  completed: read the `outcome` of its event."
- **Why minimal.** The word *receipt* and the receipt format stay. Only what a
  receipt is said to attest changes, and an executed outcome still evidences
  execution at WitSeal's boundary.

## 2. "Logs can be silently altered. Evidence is … tamper-evident." / "The hash chain breaks at the exact point of any modification."

- **Where.** `STYLE.md:28` (W-01); `docs/FAQ.md:117-119` (W-46);
  `SECURITY.md:121`, "Silent tampering … by a non-producer (chain
  re-verification detects)" (W-21); `docs/threat-model.md:55`, T1
  "Mitigated … detects any modification" (W-29); witseal.com (S-07).
- **What the product does.** `witseal verify` walks the live chain from a
  genesis anchor of `null` (`src/witness/event-log.ts:350-358`), or a
  package's events from the package's own `chain_head_before_range`, and
  checks the package's declared `chain_head_after_range` against the
  recomputed head (`src/verify/verify.ts:222-241`). Every anchor it uses comes
  from the material under test. The hashing rule is public (ADR-0001), and
  v0.1 events and receipts are unsigned.
- **Evidence.** `evidence/package-rehashed.json` verifies `VALID`.
  `repro/expected-output.txt`: B2, an edit without re-hashing, `INVALID`; B3,
  the same edit re-hashed, `VALID`; B4, the two newest events dropped and
  re-hashed, `VALID`; C1, the live chain rewritten in the data directory,
  `VALID`; B5, comparing `chain_head_after_range` with the head printed at
  export, detects both B3 and B4.
- **`CLAIM_BOUNDARY.md`.** L236-237 does not claim "protection against a
  malicious producer who can rewrite the local chain before export". L204-205
  says a modified package is reported `INVALID`, without the re-hashing
  condition; the report lists this as finding CB-01 and leaves the file
  unchanged.
- **Rule.** Draft §3, two-case test: `evidence/package.json` and
  `evidence/package-rehashed.json` give the same verdict while "this package is
  as exported" is true of one and false of the other. §8, detection coverage:
  a claim that misbehavior "cannot be concealed by B" requires "delivery or
  omission controls that prevent B from hiding it without an observable
  indication". §6 rule 4: "Presence of records is not completeness of
  coverage."
- **Class.** OVERCLAIM.
- **Corrected** (`docs/FAQ.md`). "WitSeal's hash chain breaks at the exact
  point of an edit that is not re-hashed — a single changed byte is enough. A
  consistent rewrite, or dropping the newest events, is detectable only against
  a chain head held elsewhere, such as the one printed at export."
- **Why minimal.** The edit-detection claim stays as strong as the code
  supports. The anchor condition is added in the same sentence (`STYLE.md`
  §11.3), and the positive half, that the head printed at export catches a
  re-hashed copy, is now stated as a claim (`STYLE.md` §11.4).

## 3. "Independently verifiable … with no trust in the host required."

- **Where.** `docs/integrations.md:16` (W-74) and :18-20, "evidence that stands
  on its own" (W-75); `STYLE.md:31` (W-02); the receipt and package schemas
  (W-82, W-83); 32 adapter docs and docstrings (W-87); the .NET adapter's
  `COVERAGE.md:24-26` (N-05).
- **What the product does.** The verifier is code that anyone can run
  offline, with no WitSeal account, server, or cooperation. The records are
  produced and stored on the machine that ran the action. A v0.2 receipt is
  signed at export with a key the operator supplies
  (`src/cli/evidence.ts:82-127`); the default path signs nothing. ADR-0001 line
  50 already says: "No third-party verifiability."
- **Evidence.** As in claim 2: whoever can write the data directory or holds
  an unsigned package can re-hash it (B3, C1). The holder of a v0.2 key can
  re-sign.
- **`CLAIM_BOUNDARY.md`.** L243-244 does not claim "third-party signatures or
  public transparency-log inclusion for local execution receipts".
- **Rule.** Draft §2: independence is "a property of deployment and control",
  and "a label, a field value, a distinct key, an organizational name, or a
  count of components does not by itself establish independence." §4:
  "Verification reach (who can check a record) is orthogonal to claim
  strength." §8.1: "An independent evaluator can verify the interested
  party's own account, but the account does not become an independent
  observation."
- **Class.** OVERCLAIM where the text says no trust is required or the
  evidence stands on its own; AMBIGUOUS for the bare "independently
  verifiable".
- **Corrected** (`docs/integrations.md`). "WitSeal's own record of the action
  it ran, not the host's report. Anyone can check its integrity with `witseal
  verify` (VALID / INVALID), with no WitSeal account or server; the record is
  produced on the machine that ran the action, so its truth still rests on that
  machine and its operator."
- **Why minimal.** The two real strengths stay: the record is WitSeal's own
  observation rather than the host's report, and anyone can check it offline.
  Only the independence of the record from its producer is withdrawn.

## 4. "Run any AI coding agent through `witseal exec` and every significant action becomes verifiable."

- **Where.** `STYLE.md:234` (W-10); `examples/hello-witness/README.md:147`
  (W-81); `README.md:5` (W-16); `docs/model.md:56`, the Witness "Cannot be
  bypassed if mediation is enabled" (W-65); witseal.com (S-05, S-12).
- **What the product does.** WitSeal sees what is submitted to its entry
  points: `witseal exec`, `witseal exec-file`, its own MCP `shell` tool, and
  adapter tools that call `runExec` or `runFileExec` (`src/cli/exec.ts`,
  `src/adapters/mcp/mediate.ts`, `src/adapters/framework/mediate.ts`). An
  agent's other tools, and writes to the data directory, are outside that
  boundary, and nothing in WitSeal detects them.
- **Evidence.** By construction of the entry points above; the repository's
  own scope notes agree (`docs/integrations.md`, "A surface witnesses only
  what it actually runs", W-78).
- **`CLAIM_BOUNDARY.md`.** L6-10: WitSeal "makes a narrow claim … Anything
  outside this document is not a Phase 1 public claim."
- **Rule.** Draft §6 rule 4: detecting omission requires "an independently
  grounded expectation of the complete population … or a recording boundary
  that cannot be bypassed." §8.1: concealment, "the party can act outside the
  recording boundary".
- **Class.** OVERCLAIM.
- **Corrected** (`STYLE.md`). "Route an AI coding agent's actions through
  WitSeal and each one, executed or denied, leaves a hash-chained record that
  anyone can check."
- **Why minimal.** "Each one" keeps the per-action claim, which holds; only
  the coverage implied by "every significant action" goes.

## 5. "The denial is recorded as execution evidence."

- **Where.** `README.md:97` (W-18); `CLAIM_BOUNDARY.md` L29-31 and L199-200
  (CB-02, not changed).
- **What the product does.** A Gate Mode denial writes one event with outcome
  `denied_by_policy` and `execution_result: null`, and `witseal exec` exits
  with code `100` (`src/cli/exec.ts:220-239`). Nothing is spawned.
- **Evidence.** `evidence/event-2-denied_by_policy.json`;
  `repro/expected-output.txt`, step A2.
- **`CLAIM_BOUNDARY.md`.** L28-31: "the action does not run, and the denial is
  recorded as execution evidence."
- **Rule.** Draft §4: a record of a decision is intent-base evidence; "evidence
  relevant to one base does not, merely by being assigned to that base,
  satisfy the evidential criteria relied on for another." Read alone, the
  phrase assigns the denial to the execution base.
- **Class.** AMBIGUOUS. In the boundary's own sentence the action is said not
  to run, so the intended reading, "recorded by the execution pipeline", can be
  recovered.
- **Corrected** (`README.md`). "The action does not run, and the denial is
  recorded as evidence." `STYLE.md` §11.1 now defines *execution evidence* as
  the name of the record, not of the outcome, and §11.2 prohibits wording that
  lets it read as *executed*.
- **Why minimal.** One word removed. The strong claim stays: in Gate Mode, a
  `deny` blocks the submitted action before it runs.

## 6. MCP `shell` tool description: "checked against policy (deny-by-default) … A command denied by policy does not run."

- **Where.** `src/adapters/mcp/server.ts:36-40`, the description sent to every
  connected model (W-85); `src/adapters/mcp/README.md:16-19` (W-86).
- **What the product does.** `witseal connect` writes `WITSEAL_MODE=witness`
  unless told otherwise (`src/cli/index.ts:263`, `src/cli/connect.ts:60-64`).
  In Witness Mode a `deny` is recorded and the command runs, under outcome
  `witnessed_executed` (`src/cli/exec.ts:312-334`). The MCP server falls back
  to Gate only when `WITSEAL_MODE` is unset (`src/adapters/mcp/bin.ts:27`).
- **Evidence.** `CLAIM_BOUNDARY.md`'s own Witness demonstration (L132-136): a
  command denied by a demo policy executes.
- **`CLAIM_BOUNDARY.md`.** L33-39: Witness Mode "does not block"; L52-54: "it
  does not prevent a denied action from running."
- **Rule.** Draft §8, prevention: a prevention claim "requires an enforcement
  point … positioned so that the action cannot complete without it." In the
  configuration `witseal connect` writes by default, there is none. Two-case
  test: the model receives the same description in both modes, and the
  statement is false in one of them.
- **Class.** OVERCLAIM.
- **Corrected** (`src/adapters/mcp/server.ts`). "… The command is classified,
  checked against policy, executed by WitSeal's mediator, and recorded with a
  receipt in an evidence chain. In Gate Mode (deny-by-default) a command denied
  by policy does not run; in Witness Mode it runs and the decision is
  recorded."
- **Why minimal.** One string constant. The tool's name, input schema, and
  behavior are unchanged.

## 7. witseal.com: "[verify] claim WL3 · boundary WL2 → downgrade to WL2"; "It confirms … whether the claimed level holds for the declared boundary: accept, downgrade, or reject."

- **Where.** The witseal.com hero terminal (S-03), primitives section (S-08),
  and meta description (S-01), in the site's source at the commit recorded in
  report §2.
- **What the product does.** `witseal verify` prints `VALID` or `INVALID`
  (`src/cli/verify.ts:16`, `src/verify/verify.ts`). No WitSeal verifier, published
  or unpublished, reads or computes a level, and receipts
  carry no field naming their producing boundary.
- **Evidence.** Every verdict in `repro/expected-output.txt` is `VALID` or
  `INVALID`.
- **`CLAIM_BOUNDARY.md`.** L209-216: "Verification means evidence continuity
  … Verification does not extend beyond those evidence relationships."
- **Rule.** Draft §9: "Successful verification establishes the proved
  predicate, under the premises of the verification … A claim that does not
  follow from that predicate needs its own evidentiary grounds." §3: "receipt
  validity … do[es] not raise either bound."
- **Class.** OVERCLAIM: a capability the implementation does not have.
- **Corrected.** The `WL` line is removed from the terminal. "It checks the
  evidence chain's integrity and reports VALID or INVALID." The meta
  description now grades integrations, not actions.
- **Why minimal.** The site keeps its integration grading (Gate, Witness,
  Witnessed Execution), which is a documented classification of integrations.
  Only the per-receipt verdict that no verifier produces is removed.

## 8. "If WitSeal itself crashes, the action does not proceed … no evidence record is written for an action that didn't run."

- **Where.** `docs/FAQ.md:58-60` (W-43).
- **What the product does.** `witseal exec` writes a `pending` event before it
  spawns the command (`src/cli/exec.ts:241-255`). After a crash, the next run
  records the unpaired `pending` as `execution_lost`
  (`src/cli/exec.ts:93-103`, `src/witness/recovery.ts`). A crash after the
  spawn can leave the command running or finished with no result recorded.
  Separately, an `*_executed_with_error` outcome also covers a command that
  never started (`spawn_error` set).
- **Evidence.** `evidence/receipt-0-pending.json`, a record written before
  the action ran; `evidence/event-4-spawn-error.json`, an `_executed_with_error`
  outcome with no process.
- **`CLAIM_BOUNDARY.md`.** L191-194 describe the precursor.
- **Rule.** Draft §6 rule 5: "Absence of a record is not non-occurrence,
  unless the observation regime supports that inference." §11: an unknown
  outcome "is also not a reason to repeat an action whose outcome is unknown,
  since the first attempt may have completed."
- **Class.** OVERCLAIM.
- **Corrected** (`docs/FAQ.md`). "If WitSeal crashes before it spawns the
  subprocess, the action does not run. WitSeal records a `pending` intent
  before execution, so a crash between that record and the result leaves an
  unpaired `pending` event; the next `witseal exec` records it as
  `execution_lost`. The evidence then says the outcome is unknown: the
  subprocess may or may not have run."
- **Why minimal.** It describes the mechanism the runtime already has, and
  that mechanism is stronger than the old text admitted: a crash leaves a
  marked record instead of silence.
