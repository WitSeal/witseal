# WitSeal public-claim self-audit against `draft-sergeev-claim-boundaries-01`

Case: WitSeal / CBEE Case 000 (candidate)
Date: 2026-10-03
Status: self-audit by the producer — prepared for independent review, not a
certification. Per §14 of the draft, "consistent with the claim-boundary
discipline" is not a property a product can certify by assertion; this report
names the specific claims that were checked and the evidence they were checked
against.

## 1. Summary

WitSeal's public vocabulary said more than WitSeal's evidence supports in five
recurring ways. The audit found them in the product's own style guide, so they
had spread into the README, docs, code comments that ship in the npm package,
the MCP tool description shown to models, three SDK repositories, and the live
witseal.com page.

1. **A receipt was called "structured proof of a completed action".** WitSeal
   issues receipts for denied, pending, and lost actions too; in the default
   flow every executed action produces two receipts, one of them a `pending`
   precursor written before anything ran.
2. **"Logs can be silently altered; evidence is tamper-evident."** Anyone who
   can write the data directory, or who holds a copy of an unsigned exported
   package, can rewrite and re-hash it, and `witseal verify` then reports
   `VALID`. A rewrite is detectable only against a chain head obtained
   separately.
3. **"Independently verifiable", "no trust in the host required".** Anyone can
   *run* the check offline; the records are still the producer's own account.
4. **"Every significant agent action becomes verifiable".** WitSeal sees only
   the actions routed through it.
5. **Capabilities stated beyond the implementation**: per-receipt grading
   ("accept, downgrade, or reject"; a `WL3 → WL2` verify line on witseal.com),
   policy re-evaluation on replay, a read-only recovery mode, "cross-agent trust
   via shared schemas", provenance "of the build that is actually running".

All five were real overclaims. They are corrected in wording only: no runtime,
schema, receipt format, policy behavior, SDK API, or wire format changed.
`docs/CLAIM_BOUNDARY.md` was not changed (byte-identical, §9). Two statements
inside it are listed for the reviewer (§6): one universal tamper claim that the
implementation does not support, and one ambiguous term of art.

Strong claims that the evidence does support were kept and, where useful,
stated more plainly (§8.4): Gate Mode blocks a denied action before it runs;
with no policy pack Gate Mode refuses everything, unless the operator sets an
explicit unsafe override; for an action WitSeal ran itself the record is
WitSeal's own observation, not the host's report; and a chain head obtained at
export makes any later edit to the exported witness events detectable.

| Class | Rows | Wording changed | Left as is | Left as is, and why |
|---|---:|---:|---:|---|
| OVERCLAIM | 94 | 88 | 6 | W-63, N-10, CB-01, H-02, H-03, H-05: a logic change (N-10), an RFC (W-63), the boundary that was not to be changed (CB-01), immutable ADRs (H-02, H-03, H-05) |
| AMBIGUOUS | 28 | 24 | 4 | S-15, CB-02, H-01, H-04: a product naming decision (S-15, Q4), the boundary (CB-02), released history (H-01, H-04) |
| SUPPORTED_WITH_QUALIFICATION | 8 | 3 | 5 | the qualification is already stated where the claim is made |
| SUPPORTED | 11 | 0 | 11 | nothing to correct |
| NOT_EVALUATED | 4 | 0 | 4 | roadmap (W-39, W-48), live deployment state (K-09), governance documents (X-04) |
| no class | 3 | 2 | 1 | W-15 and W-92 are new text; S-16 describes an external specification |
| **All** | **148** | **117** | **31** | |

The counts are computed from the register in §5.2, one row per claim; a row
can cover several identical passages (marked ×N). In all, the corrections
change 228 passages (diff hunks) in 83 files across nine repositories (§5.3).

## 2. Baseline

Captured 2026-10-03T16:19:48Z, before any change. Work branch in every
repository: `claude/witseal-claims-audit-wt0xfa` (the session's designated
branch; the `audit/cbee-public-claims` name in the request was an example). No
commit was made on `main`.

| Repository (visibility) | Commit audited |
|---|---|
| WitSeal/witseal (public) — CLI, docs, `STYLE.md`, `CLAIM_BOUNDARY.md` | `c80600f91c63d1dcee72d510f035133a2cf2f85e` (`@witseal/cli@0.4.2`) |
| WitSeal/witseal-py (public) — Python verifier SDK | `2363bb4a90e0676d79a7e8a418e4c7a0c0f296a1` |
| WitSeal/witseal-dotnet (public) — Microsoft Agent Framework adapter | `4ba3002631899e4278582b3ceaac84d83871fcab` |
| WitSeal/witseal-workers (public) — Cloudflare Workers receipts | `5e2ebcbe573711a822b9f85a1a628272fd679282` |
| witseal.com landing page (private source repository, public page) | `a22fc92faa566302c8d093d73806492dde089294` |
| Four private repositories (unpublished code and an unpublished site revision) | recorded in the private annex |

`docs/CLAIM_BOUNDARY.md` at the baseline:

- SHA-256 `96d24c3b5dd334464af111c45249661226e78f3990b6554c84ac43a43aab728b`
- Git blob `4cc4403ae184c0ce3c09b2aa18d8ba311337e3db`, 10193 bytes

Reference text: `draft-sergeev-claim-boundaries-01` ("Claim Boundaries for
Execution Evidence", published 23 September 2026), 111543 bytes, SHA-256
`0d90638366325bbacb368e9d1fd256f7a6117831ff31e10cb49d1b40e8446d35`, Git blob
`8f3d08c0481285be43394ea6073d95f6bdfdc17d`. The copy used is an archival copy
recorded as byte-identical to <https://www.ietf.org/archive/id/draft-sergeev-claim-boundaries-01.txt>;
the IETF site was not reachable from the audit environment, so the identity
was not re-fetched (§10).

Files that can carry public product claims (enumerated before editing):

- Core repository: `README.md`, `STYLE.md`, `SECURITY.md`, `SECURITY.txt`,
  `CHANGELOG.md`, `CONTRIBUTING.md`, `docs/*.md` (ARCHITECTURE, CLAIM_BOUNDARY,
  FAQ, integrations, model, threat-model, RFCS, security/disclosures),
  `docs/adr/*`, `docs/rfcs/*`, `examples/**/README.md`, `examples/policy-packs/*`,
  `src/adapters/**/README.md` and `COVERAGE.md`, adapter Python sources
  (docstrings), `schemas/*.ts` (shipped in the npm package), JSDoc on exported
  modules, CLI help strings (`src/cli/index.ts`), the MCP tool description
  (`src/adapters/mcp/server.ts`), `package.json` metadata, `.github` issue and
  PR templates.
- Python SDK: `README.md`, `STYLE.md`, `SECURITY.md`, `CHANGELOG.md`,
  `pyproject.toml`, module and API docstrings, the MCP tool description, CLI
  output.
- .NET adapter: `README.md`, `COVERAGE.md`, `SECURITY.md`, `.csproj` NuGet
  description, XML doc comments, model-facing strings, the release-notes body.
- Workers: `README.md`, `COVERAGE.md`, `SECURITY.md`, `package.json`, the
  Worker's banner text, source and generated-module comments.
- witseal.com: `index.html` (meta tags, hero terminal, every section).

## 3. Method

**Order of authority** (from the request): (1) the implementation at the
baseline commit; (2) `docs/CLAIM_BOUNDARY.md`; (3) receipt, schema, and SDK
semantics; (4) the draft; (5) supporting conceptual material; (6) public copy
as the object of the audit, never as a source of truth.

**Finding claims.** A tracked-file search for the terms proof, prove, evidence,
verify, independent, offline, third party, tamper, immutable, append-only,
execution, executed, completed, receipt, every/each/all action, outcome,
effect, guarantee, audit, trust, chain, integrity, signed, attestation,
provenance, deny, block, bypass, coverage; then a reading of the hits and of
the main documents' headlines, tables, and diagrams for semantic variants. The
search is line-based, so a phrase wrapped across two lines can be missed; the
second search in §9 found six such passages. Three read-only inventories of
the other repositories produced 1,374 candidate statements (website 198,
public SDKs 509, private repositories 669). They were triaged by claim family;
the register in §5.2 lists the claims then checked against the code, with
identical passages merged into one row (×N).

**Establishing what the product does.** By reading the code paths named in §4
and by running the baseline CLI build in a scratch directory. The commands and
their output are in `cbee-review-packet-2026-10/repro/` and can be re-run by a
reviewer with `npm install -g @witseal/cli@0.4.2` (§4.3).

**Classifying.** Each claim is reduced to a proposition and checked with the
review lens of §7 of the draft: exact claim; producing boundary; who controls
it; the ceiling for that kind of claim; positive evidence at the claim's own
base; prevention or detection coverage; completeness and absence; widening in
the pipeline. The §3 two-case test was applied directly: where two cases give
the relying party the same evidence while the claim is true in one and false
in the other, the claim is not supported as stated. Classes:

- **SUPPORTED** — the claim follows from the evidence under the premises the
  text states.
- **SUPPORTED_WITH_QUALIFICATION** — supported, but only under a premise the
  text states nearby or that the style guide now defines.
- **OVERCLAIM** — the implementation does not establish it, or a reproduced case
  refutes it.
- **AMBIGUOUS** — a reasonable reading overclaims and another does not; fixed
  only where the stronger reading is the likely one.
- **NOT_EVALUATED** — no evaluation was possible (future roadmap, live
  deployment state); this supplies no finding either way (§11 of the draft).

**Correcting.** One rule: the corrected sentence may claim exactly the ceiling
established in §4 — no less where the evidence is strong, no more anywhere. A
qualifier goes into the sentence or table cell it bounds, never into a later
footnote (`STYLE.md` §11.3). Historical records (release notes of shipped
versions, accepted ADRs) and governance documents were not rewritten (§7).

## 4. What the implementation establishes

### 4.1 Producing boundary and coverage

- WitSeal mediates only what is submitted to it: `witseal exec` (explicit
  argv), `witseal exec-file`, its own MCP `shell` tool (run as
  `/bin/sh -c "<command>"`), and adapter tools that call `runExec` /
  `runFileExec` (`src/cli/exec.ts`, `src/adapters/mcp/mediate.ts`,
  `src/adapters/framework/mediate.ts`).
- Observe-level adapters (Claude Code and Cursor `PostToolUse`) record the
  result the host reports; they do not execute (`src/witness/record.ts`).
- Nothing detects actions taken by other paths. An agent with any other tool —
  or with write access to the data directory — is outside the boundary.
  Completeness is not established anywhere in the product.

### 4.2 Records, outcomes, and what a receipt is

- Every mediated action writes witness events (`src/witness/emit.ts`). For an
  executed action there are two: a `pending` precursor written *before*
  execution, then the final event (`src/cli/exec.ts:241-287`). Denials and
  fail-closed refusals write one event with `execution_result: null`.
- Every event carries a `receipt_id`. A v0.1 receipt is not stored; it is
  derived from its event whenever it is shown or exported, with `finalized_at`
  set to the time of derivation, so its `receipt_hash` changes between
  derivations (`src/cli/receipt.ts:12-18`, `src/receipts/generate.ts:36-52`).
- Outcomes and their meaning at WitSeal's boundary:

  | Outcome | Did WitSeal run the action? |
  |---|---|
  | `allowed_executed`, `approved_executed`, `witnessed_executed` | yes, for an action WitSeal ran (Level 3): it spawned the command and recorded exit code and bounded output |
  | `*_executed_with_error` | spawned and failed, **or never started**: with `spawn_error` set, no process ran (`evidence/event-4-spawn-error.json`) |
  | `denied_by_policy`, `denied_by_approval` (the schema also lists `denied_by_classification_failure`, which 0.4.2 never emits) | no (Gate Mode block) |
  | `no_policy_configured` | no when `execution_result` is null (fail-closed); yes under the explicit opt-in or in Witness Mode |
  | `pending` | not yet, when written; if WitSeal then crashed, unknown |
  | `execution_lost` | unknown — a later run recorded that the result was lost |

- Level-2 (host-reported) records use the same outcome labels as records of
  actions WitSeal ran itself, and a missing host exit code is recorded as `0`;
  a receipt does not say which boundary produced it (IMPL-2, §10.1).
- An executed record is WitSeal's own account, at its boundary, of: the exact
  argv and working directory, the policy decision with the content hashes of
  the packs it was made under, any approval record, the spawn, exit code or
  signal, and stdout/stderr content hashes with bounded head and tail. It does
  not establish what the command changed outside its output, that the command
  was correct, that the policy or approval was legitimate, or anything to a
  party who does not trust the machine that produced it.

### 4.3 Integrity and what `witseal verify` checks

- Live chain: `verifyChain` from a genesis anchor of `null`
  (`src/witness/event-log.ts:350-358`). Evidence package: the same walk,
  anchored at the package's own `chain_head_before_range`, plus a check that
  the declared `chain_head_after_range` equals the recomputed head, plus
  per-receipt self-hash and content-hash cross-checks
  (`src/verify/verify.ts:197-291`). Nothing is compared with anything outside
  the material presented.
- Reproduced with the baseline CLI (`repro/run.sh`, output in
  `repro/expected-output.txt`):

  | Change to an exported v0.1 package or the live chain | `witseal verify` | Against the head printed at export |
  |---|---|---|
  | edit one event field, no re-hash (the CLAIM_BOUNDARY QA edit) | INVALID | differs |
  | same edit, every later hash recomputed with the public rule | **VALID** | differs → detected |
  | drop the newest two events, re-hash | **VALID** | differs → detected |
  | export a sub-range that omits a denial | **VALID** | n/a |
  | same edit applied to the live chain in the data directory | **VALID** | n/a |

- Signed v0.2 receipts are opt-in at export, signed with a key the operator
  supplies (`src/cli/evidence.ts:82-127`); the default path holds no key
  (`SECURITY.md`). A v0.2 signature protects the receipt's own fields against
  parties without that key, given an authentically obtained public key; it does
  not protect against the key holder, and witness-event fields that a receipt
  does not bind are protected only by the unsigned chain.
- `witseal verify` outputs VALID or INVALID. It does not grade a claim, does not
  re-run policy, does not observe execution, and does not establish
  completeness. No WitSeal verifier, published or unpublished, implements
  WEXP-style grading.
- Two further gaps with security relevance were found, in the verifier and in
  policy matching. Per `SECURITY.md` (coordinated disclosure) they are
  described in a private annex for the maintainer, not here (S-1, S-2). Their public-claim
  consequences are applied in §5.

### 4.4 Policy enforcement

- Gate Mode is the CLI default: a `deny` blocks the submitted action before it
  runs; with no active pack every action is refused, exit 100,
  `no_policy_configured` (`src/cli/exec.ts:151-178`). Only the explicit
  operator override `WITSEAL_UNSAFE_ALLOW_NO_POLICY=1` runs it then, and the
  record carries the execution result.
- An action no rule matches takes the pack's `default_decision`; the quickstart
  and starter packs use `allow`. "Deny-by-default" in WitSeal therefore means
  the Gate Mode posture above, not default-deny for unmatched actions.
- Witness Mode records the decision and runs the action. `witseal connect`
  configures MCP clients in Witness Mode by default
  (`src/cli/index.ts:263`, `src/cli/connect.ts:60-64`), so a denied command
  runs on that path.
- The policy decision is recorded as the producer's own record; a v0.1 receipt
  hashes it but nothing re-evaluates it later. An evidence package embeds the
  packs active **at export**, not at decision time (`src/cli/evidence.ts:40`).

## 5. Claim register

### 5.1 Claim families and their ceilings

Each register row belongs to a family. The family gives the trace the request
asks for — proposition, producing boundary, source, what the evidence
establishes, premises, what it does not establish, the rule of the draft, and
the supported ceiling. The row gives the instance and the corrected wording.

**A — Receipt semantics.** Proposition: a receipt attests that an action
completed. Boundary: the WitSeal runtime on the producer's machine; receipts
are derived from its witness events. Establishes: the runtime recorded outcome
X for that event; for `*_executed` at Level 3 with no `spawn_error`, that
WitSeal ran the command and saw its exit status and output. Premises: runtime
integrity; data directory not rewritten. Does not establish: execution for
denied, pending, lost, or fail-closed outcomes (refuted: receipts exist for
them, `evidence/receipt-0-pending.json`, `evidence/receipt-2-denied_by_policy.json`);
external effects; correctness. Rules: §4 (the bases are distinct questions);
§6 rule 3 (a receipt or record is not execution or effect); rule 6 (authority
is not action). **Ceiling:** "a receipt records one witness event's outcome;
only an executed outcome evidences execution at WitSeal's boundary."

**B — Integrity and tamper-evidence.** Proposition: any modification of
WitSeal evidence is detected; WitSeal evidence, unlike logs, cannot be altered
silently. Boundary: `witseal verify` over the material presented, anchored at
material the same material declares. Establishes: hash continuity of what was
presented; an edit that was not re-hashed is found and located. Premise for the
stronger claim: a chain head obtained over a channel the modifier does not
control. Does not establish: absence of a consistent rewrite before or after
export, absence of truncation, or completeness of an exported range. Rules:
§3 two-case test (§4.3 table); §8 detection coverage requires delivery and
omission controls; §8.1 forgery and concealment; §6 rules 4 and 5; §13 (the
tamper-evident lineage makes alteration *externally* detectable). **Ceiling:**
"an edit that is not re-hashed fails verification; any edit to the chain's
events is detectable against a chain head held outside the writer's reach."

**C — Independence.** Proposition: a third party can rely on the evidence
without trusting its producer or host. Boundary: the producer's runtime,
storage, and (for v0.2) key; the verifier is independent code. Establishes:
anyone can run the check offline, with no WitSeal account, server, or
cooperation. Does not establish: independent production or observation of the
evidence. Rules: §2 (independence is a property of control; "a label, a field
value, a distinct key ... does not by itself establish independence"); §4
("verification reach ... is orthogonal to claim strength"); §5 (a record that
needs no later cooperation from its producer is not thereby independent of
it); §8.1 ("an independent evaluator can verify the interested party's own
account, but the account does not become an independent observation"); rule
12. WitSeal's own ADR-0001 already says "No third-party verifiability".
**Ceiling:** "anyone can check its integrity offline with `witseal verify`;
the record remains the producer's own account."

**D — Coverage.** Proposition: WitSeal records (or mediates) all of an agent's
actions. Boundary: WitSeal's entry points (§4.1). Establishes: each action
routed through them is recorded, and in Gate Mode mediated. Does not
establish: absence of other action paths, completeness, or effects. Rules: §6
rules 4 and 5; §8 (a prevention claim needs an enforcement point the party
cannot bypass); §8.1 concealment. **Ceiling:** "every action an agent routes
through WitSeal is recorded."

**E — Denials and "execution evidence".** Proposition (as read): a denial is
evidence of execution. Establishes: a `deny` decision was recorded and WitSeal
did not run the submitted action. Rule: §4 ("evidence relevant to one base does
not, merely by being assigned to that base, satisfy the evidential criteria
relied on for another"). **Ceiling:** "in Gate Mode, a deny blocks the
submitted action before it runs, and the denial is recorded as evidence."
"Execution evidence" stays as WitSeal's name for everything the pipeline
records; `STYLE.md` §11.1 now says it names the record, not the outcome.

**F — Prevention and policy.** Proposition: WitSeal prevents denied or
dangerous actions. Establishes: §4.4. Rules: §8 prevention (the enforcement
point must be required for the action); §8.1 circumvention. **Ceiling:** "for
actions routed through WitSeal in Gate Mode, a deny decision blocks the action;
with no policy pack every action is refused; an unmatched action takes the
pack's default."

**G — Verification semantics and implemented capability.** Proposition:
`VALID` (or WitSeal) establishes more than hash consistency — truth, policy
compliance, a grade, completeness. Establishes: §4.3. Rules: §3 (receipt and
signature validity do not raise either bound); §9 (verification establishes
the predicate it checks and no more); rule 11 (a test run establishes behavior
under its own conditions). **Ceiling:** "`VALID` means the records presented
are hash-consistent (and, for v0.2, signed under the key supplied)."

**H — Signatures, attestation, provenance.** Proposition: a signature or
attestation establishes the event, the signer's identity, or the artifact in
use. Rules: §6 rule 1 (a signature authenticates bytes under a key, not the
truth of their content or control of a boundary); rule 2 (attribution is not
actorship: a public test seed lets anyone sign); §8.1 (two endpoints of one
origin are one source); §9 (an observation must be bound to the exact thing
claimed). **Ceiling:** "the signature shows these bytes were signed with this
key; the attestation names an artifact digest under a key served by the same
operator."

**I — Execution labels and crash semantics.** Proposition: an `*_executed`
label means the process ran; no record means nothing ran. Establishes: §4.2.
Rules: §6 rule 5 (absence is not non-occurrence); §11 (an unknown outcome is
not a reason to assume either result). **Ceiling:** "with `spawn_error` set
the process never started; after a crash the evidence says the outcome is
unknown."

**J — Attribution and approval.** Proposition: the record identifies who
acted or approved, or tells careful approvals from careless ones. Establishes:
the declared agent identifier and, for approvals, the `$USER`-derived
principal (`src/cli/approval.ts:115-131`), unauthenticated. Rules: §6 rule 2;
rule 6; §3 (evidence that only makes a claim more likely does not support it).
**Ceiling:** "the record carries the declared identities; it does not
authenticate them."

### 5.2 Register

Locations are baseline line numbers. "Changed" rows quote the baseline text
and summarize the correction; the exact before/after is in the branch diff.
Surfaces: **W** core repository, **S** witseal.com, **P** Python SDK, **N**
.NET adapter, **K** Workers, **X** private repositories (summary rows; detail
in the private annex), **CB** `CLAIM_BOUNDARY.md`, **H** historical or
immutable documents.

<!-- register:start -->
| ID | Location | Baseline wording (excerpt) | Fam. | Class | Action | Corrected to (excerpt) |
|---|---|---|---|---|---|---|
| W-01 | STYLE.md:28 | "Logs can be silently altered. Evidence is hash-chained, replayable, and tamper-evident." | B,E | OVERCLAIM | changed | record of a mediated action "whatever its outcome — a denial included"; "an edit breaks the chain unless every later hash is recomputed" |
| W-02 | STYLE.md:31 | "Evidence chain is hash-linked and independently verifiable." | C | OVERCLAIM | changed | "anyone can re-check its continuity offline … the records remain the producer's own account" |
| W-03 | STYLE.md:34 | "Witness events are append-only and hash-linked. Log entries are not." | B | OVERCLAIM | changed | "appended by the runtime and hash-linked … fails verification unless the chain is re-hashed from it onward" |
| W-04 | STYLE.md:35 | "A receipt is structured proof of a completed action." | A | OVERCLAIM | changed | "a structured record of one witness event's outcome — executed, denied, pending, or lost … not proof that an action completed" |
| W-05 | STYLE.md:36 | "Approval is an explicit, recorded authorization." | J | AMBIGUOUS | changed | "an explicit, recorded decision; the record does not establish who gave it or that they had authority" |
| W-06 | STYLE.md:39 | "Deny-by-default is a security primitive with formal meaning." | F | AMBIGUOUS | changed | states the Gate Mode meaning and that unmatched actions take `default_decision` (`allow` in shipped packs) |
| W-07 | STYLE.md:44 | "Tamper-evident is a precise cryptographic property." | B | AMBIGUOUS | changed | "… with a stated anchor"; producer can rewrite before export |
| W-08 | STYLE.md:47 | "the action chain remains intact under attack and failure" | B | OVERCLAIM | changed | "a failure or an edit that breaks the action chain is surfaced … does not mean the chain cannot be rewritten" |
| W-09 | STYLE.md:127 | "WitSeal does not observe — it mediates and proves." | G | OVERCLAIM | changed | "does not just observe — it mediates and records" |
| W-10 | STYLE.md:234 | "Run any AI coding agent through `witseal exec` and every significant action becomes verifiable." | D | OVERCLAIM | changed | "Route an AI coding agent's actions through WitSeal and each one, executed or denied, leaves a hash-chained record that anyone can check." |
| W-11 | STYLE.md:246 | "Can you prove what happened? WitSeal answers all three by making every agent action a witnessed execution" | D,G | OVERCLAIM | changed | "What evidence is left afterwards? For every action routed through it, WitSeal answers all three" |
| W-12 | STYLE.md:258 | "hash-chained receipts that any third party can verify offline" | C | AMBIGUOUS | changed | "whose integrity any third party can check offline" |
| W-13 | STYLE.md:27 | "Witnessed execution is active mediation with cryptographic evidence." | — | SUPPORTED_WITH_QUALIFICATION | kept | — |
| W-14 | STYLE.md:40-41 | "Hash-chained means cryptographic continuity." / "Replay implies deterministic reconstruction from evidence." | B,G | SUPPORTED | kept | — |
| W-15 | STYLE.md (new §11) | — | all | — | added | terms, preferred/prohibited formulations, bound-in-the-claim rule, strong claims to keep |
| W-16 | README.md:5-6 | "WitSeal produces execution evidence for agent actions. It classifies each action" | D | OVERCLAIM | changed | "for the agent actions routed through it" |
| W-17 | README.md:46 | "safe by default (witness mode records without blocking)" | F | AMBIGUOUS | changed | "non-blocking by default" |
| W-18 | README.md:97 | "the denial is recorded as execution evidence" | E | AMBIGUOUS | changed | "the denial is recorded as evidence" |
| W-19 | README.md:165-167 | "`witseal verify` surfaces tampering with a recorded receipt or event … within the documented claim boundary" | B | OVERCLAIM | changed | reports an event edited without re-hashing; "A chain rewritten and re-hashed consistently … still verifies" |
| W-20 | README.md:65-67, 94-99, 176-180 | MCP scope note; Gate/Witness descriptions; "Verification is about evidence continuity" | D,F,G | SUPPORTED | kept | — |
| W-21 | SECURITY.md:121 | "Silent tampering of the evidence chain by a non-producer (chain re-verification detects)" | B | OVERCLAIM | changed | edits not re-hashed are detected; "a consistent rewrite is detectable only against a chain head obtained separately" |
| W-22 | SECURITY.md:122 | "Accidental execution of denied-by-policy actions" | F | SUPPORTED_WITH_QUALIFICATION | changed | scope added: "routed through WitSeal in Gate Mode" |
| W-23 | SECURITY.md:127 | "A malicious producer rewriting the entire chain" (not protected) | B | AMBIGUOUS | changed | also anyone who can write the data directory or holds an unsigned package; truncation |
| W-24 | SECURITY.md:80, 123 | default path holds no key; every approval recorded | H,J | SUPPORTED | kept | — |
| W-25 | threat-model.md:14 | "makes AI-coding-agent actions verifiable … Tampering by a non-producer is detectable." | D,B | OVERCLAIM | changed | "records the … actions routed through it"; detection bounded by anchor |
| W-26 | threat-model.md:33 | A2 "Strong: chain re-verification detects modification" | B | OVERCLAIM | changed | "Partial: … a consistent re-hash of the events is detected only against the head recorded at export" |
| W-27 | threat-model.md:37 | "is denied by the destructive-block policy pack; … the producer's machine is unharmed" | F | OVERCLAIM | changed | "through `witseal exec` in Gate Mode … the command does not run" |
| W-28 | threat-model.md:39 | "The hash chain ensures that an evidence package cannot be modified silently in transit." | B | OVERCLAIM | changed | caught only against the head recorded at export, over a channel the tamperer does not control |
| W-29 | threat-model.md:55 | T1 "Mitigated. … detects any modification" | B | OVERCLAIM | changed | "Partially mitigated" with the anchor condition |
| W-30 | threat-model.md:67 | T3 "both are denied … fully recorded as evidence" | F,A | OVERCLAIM | changed | `curl` requires approval, `rm -rf /` denied, via `witseal exec` in Gate Mode; "recorded as evidence (argv, exit code, bounded output)" |
| W-31 | threat-model.md:85 | "Auditors can distinguish careless click-through from explicit confirmation by examining timestamps" | J | OVERCLAIM | changed | "can flag likely careless click-through" |
| W-32 | threat-model.md:103 | T8 forged receipt "Mitigated" | B | SUPPORTED_WITH_QUALIFICATION | changed | bound added: a receipt forged with a matching event in a re-hashed chain is not detected |
| W-33 | threat-model.md:109 | T9 "Mitigated. … packs active at chain time. Replay uses those" | G | OVERCLAIM | changed | "Partially mitigated": events record pack hashes; packages embed packs active at export; replay and verify do not re-evaluate policy |
| W-34 | threat-model.md:133 | T12 "the runtime starts in read-only mode" | B | OVERCLAIM | changed | "refuses to append and surfaces the integrity error" |
| W-35 | threat-model.md:156, 159 | ASI02 / ASI05 "Mitigated … deny-by-default for high-risk tools / destructive shells" | F | OVERCLAIM | changed | "for … routed through WitSeal in Gate Mode"; "blocked when an active pack's rule denies it"; "policy denial of destructive commands" (unmatched calls take the pack's default, `allow` in shipped packs) |
| W-36 | threat-model.md:161 | ASI07 "Mitigated for receipt-passing. Cross-agent trust via shared schemas" | C,H | OVERCLAIM | changed | "Not addressed in Phase 1 … a shared format does not authenticate the sender" |
| W-37 | threat-model.md:164, 166 | ASI10 "A rogue agent cannot bypass WitSeal"; honest claim lists ASI07 | F,D | OVERCLAIM | changed | scoped to routed actions; ASI07 moved to "does not address" |
| W-38 | threat-model.md:41-43, 79, 95-97 | A3/A4 limits; T5; T7 claim-discipline note | — | SUPPORTED | kept | — |
| W-39 | threat-model.md:61, 174 | Phase 5 Sigstore + Rekor will make rewrites visible | B | NOT_EVALUATED | kept | roadmap; see reviewer question Q6 |
| W-40 | FAQ.md:14-15 | "verifiable runtime evidence of what actually executed … gives them stronger evidence" | D,G | AMBIGUOUS | changed | "… for the actions routed through it"; "hash-chained evidence to work from" |
| W-41 | FAQ.md:20-21 | "it mediates the **actions** that result" | D | OVERCLAIM | changed | the actions routed through it; other MCP servers and client tools not mediated |
| W-42 | FAQ.md:37-38 | "WitSeal will deny it (with the right policy pack loaded)" | F | SUPPORTED_WITH_QUALIFICATION | changed | "sends `rm -rf /` through `witseal exec` in Gate Mode" (the path the claim boundary verifies) |
| W-43 | FAQ.md:58-60 | "If WitSeal itself crashes, the action does not proceed … no evidence record is written for an action that didn't run" | I | OVERCLAIM | changed | `pending` precursor, `execution_lost`, "the outcome is unknown" |
| W-44 | FAQ.md:72-74 | "Phase 1 protects against tampering by *non-producers*" | B | OVERCLAIM | changed | `verify` alone catches only edits not re-hashed; head comparison catches re-hashed events, not a producer's pre-export rewrite |
| W-45 | FAQ.md:113 | "something a third party can verify" | C | AMBIGUOUS | changed | "check for integrity" |
| W-46 | FAQ.md:117-119 | "WitSeal's hash chain breaks at the exact point of any modification." | B | OVERCLAIM | changed | breaks at an edit not re-hashed; rewrite or dropped events detectable only against a head held elsewhere |
| W-47 | FAQ.md:126-127, 133 | "reconstruct the action history"; "cryptographic guarantees" | D,B | AMBIGUOUS | changed | "the recorded history of the actions WitSeal mediated"; "cryptographic integrity checks" |
| W-48 | FAQ.md:76-78 | Phase 5 "makes a chain rewrite publicly visible" | B | NOT_EVALUATED | kept | roadmap |
| W-49 | FAQ.md:121-124 | "WitSeal can deny an action *before* it runs" | F | SUPPORTED | kept | — |
| W-50 | ARCHITECTURE.md:91 | "Captures stdout, stderr, exit code, side effects." | A | OVERCLAIM | changed | "(not other side effects)" — the same document says so in §5.2 and §8 |
| W-51 | ARCHITECTURE.md:97 | "structured proof of completed action … Verifiable independently of producer." | A,C | OVERCLAIM | changed | "structured record of the outcome … Integrity checkable by anyone." |
| W-52 | ARCHITECTURE.md:103 | evidence package "Independently verifiable." | C | OVERCLAIM | changed | "Integrity checkable offline." |
| W-53 | ARCHITECTURE.md:257-259, 278 | FINALIZED "immutable (no further edits)" | B | OVERCLAIM | changed | "any later edit breaks the hash" (STYLE already lists "immutable" as overclaim) |
| W-54 | ARCHITECTURE.md:287-288 | "this action passed WitSeal Phase 1 evaluation" | E,G | AMBIGUOUS | changed | "went through … evaluation … with the recorded decision" |
| W-55 | ARCHITECTURE.md:325 | "strictly append-only at the file system level … tampering is detectable … by simple log replay (Phase 1)" | B | OVERCLAIM | changed | runtime only appends; the file system does not enforce it; anchor condition |
| W-56 | ARCHITECTURE.md:415, 486-487 | "shell-induced ops observed only" | A,D | OVERCLAIM | changed | "not observed: WitSeal sees only the command's stdout/stderr and exit code" |
| W-57 | ARCHITECTURE.md:469-471 | "This subprocess was spawned with these exact arguments, exited with this code" | I | AMBIGUOUS | changed | "— or, when `spawn_error` is set, failed to start" |
| W-58 | ARCHITECTURE.md:475-476 | "WitSeal proves what was attempted and what happened" | A,G | OVERCLAIM | changed | "records … at its boundary" |
| W-59 | ARCHITECTURE.md:530-533 | "If the reconstruction differs … evidence has been tampered with … make tampering detectable through replay" | B | OVERCLAIM | changed | a rewrite that also replaces the recorded head is detectable only against a head held elsewhere |
| W-60 | ARCHITECTURE.md:598 | "The verification claim is 'this action was allowed by policies in effect at the time'" | G | OVERCLAIM | changed | "this decision was made under …"; `witseal verify` does not re-run that evaluation |
| W-61 | ARCHITECTURE.md:606 | "A producer with full filesystem access can rewrite the entire chain consistently." | B | AMBIGUOUS | changed | anyone with write access, and anyone holding an unsigned package |
| W-62 | ARCHITECTURE.md:294, 452-454 | producer-tamper non-claim; tool-boundary evidence claim | B,A | SUPPORTED_WITH_QUALIFICATION | kept | — |
| W-63 | ARCHITECTURE.md:100, 279, 374, 580 | receipt hash "appended to chain root"; a CHAINED receipt: "given chain head and receipt, anyone can prove the receipt is in the chain"; one execution → one event; "read-only mode" | A,B | OVERCLAIM | not changed | the runtime chains events, not receipts, writes two events per executed action, and has no read-only mode; the document is a frozen pre-implementation contract whose deviations need an RFC (L32); IMPL-7, IMPL-11 |
| W-64 | model.md:41 | "WitSeal records both, distinctly." | J | OVERCLAIM | changed | Claimer identifier on every event, approver when required, "as declared, not authenticated" |
| W-65 | model.md:56 | Witness "Cannot be bypassed if mediation is enabled" | D,F | OVERCLAIM | changed | "Sees only the actions routed through it … does not detect it" |
| W-66 | model.md:71 | "attestation is minimal (hash chain integrity only)" | H | OVERCLAIM | changed | no Attester identity by default; v0.2 key ties a receipt to a key, not a verified party |
| W-67 | model.md:81, 298-303 | "Run `cosign verify-blob` against signed receipts"; `witseal verify` "confirms that the Receipt is intact" | H | OVERCLAIM | changed | `witseal verify --public-key`; cosign marked Phase 5+; "confirms that the chain holding the Receipt's witness event is unbroken" (the live check does not read receipts) |
| W-68 | model.md:83 | Verifiers "Detect tampering, omission, or substitution" | B | OVERCLAIM | changed | breaks in hash continuity; rewrite or dropped tail only against a head held elsewhere |
| W-69 | model.md:112-114 | "A claim is co-emergent with execution: it cannot exist without the execution having occurred" | A,E | OVERCLAIM | changed | formed for every outcome — executed, denied, pending, or lost; "the runtime's own account" |
| W-70 | model.md:133-142 | to stamp "irreversibly … removal of any stamped record produces a verifiable break" | B | OVERCLAIM | changed | edit, removal, or insertion inside the chain fails unless re-hashed; newest records or consistent rewrite only against a head held elsewhere |
| W-71 | model.md:207-212 | "Guarantee" column: "claim co-emerges with execution"; "tampering is detectable through hash links" | A,B | OVERCLAIM | changed | "Property": "formed … for every outcome"; "an edit that is not re-hashed fails verification" |
| W-72 | model.md:229-230 | Receipt "The persisted record of a claim. Stored as a chain entry." | A | OVERCLAIM | changed | "derived from its witness event (the chain entry); exported evidence packages carry receipts" |
| W-73 | integrations.md:3-4 | "It records what an agent's actions actually did, so they can be … independently verified." | A,C,D | OVERCLAIM | changed | decision and, for actions it ran, what they returned; "integrity checked by anyone" |
| W-74 | integrations.md:16 | "records a signed, hash-chained execution receipt \| Independently verifiable … no trust in the host required" | H,C | OVERCLAIM | changed | signed only when exported as v0.2; "WitSeal's own record of the action it ran … its truth still rests on that machine and its operator" |
| W-75 | integrations.md:18-20 | "Witnessed Execution produces evidence that stands on its own." | C | OVERCLAIM | changed | "replaces it with WitSeal's own record of an action WitSeal ran itself" |
| W-76 | integrations.md:34, 46, 81, 166 | "independently(-)verifiable receipt" ×4 | C | AMBIGUOUS | changed | "the same receipt"; "anyone can check … with `witseal verify`"; "from its own observation" |
| W-77 | integrations.md:87, 173 | "proven live"; "The proof model" | G | AMBIGUOUS | changed | "live-verified"; "The evidence model" |
| W-78 | integrations.md:15, 184-197 | Witness "only as trustworthy as the host's report"; "A surface witnesses only what it actually runs" | C,D | SUPPORTED | kept | — |
| W-79 | hello-witness/README.md:14 | "Tampering with the exported package is reported as `INVALID`." | B | OVERCLAIM | changed | "An edit … made without re-hashing" (rule 11: one demonstrated edit) |
| W-80 | hello-witness/README.md:127, 145 | "independently verifiable from the package contents"; "Tampering … is detectable." | C,B | OVERCLAIM | changed | checkable from contents; re-hashed events caught against the `head:` printed at export |
| W-81 | hello-witness/README.md:147 | "every significant agent action … becomes a verifiable artifact" | D | OVERCLAIM | changed | "every agent action routed through WitSeal" |
| W-82 | schemas/receipt.schema.ts:4-6 (npm) | "structured proof of a completed action … verifiable independently of the producing system" | A,C | OVERCLAIM | changed | "structured record of one witness event's outcome — executed, denied, pending, or lost"; integrity checkable without the producing system |
| W-83 | schemas/evidence-package.schema.ts:5-7 (npm) | "It is independently verifiable — a third party with the package alone can reconstruct and verify the chain head" | C,B | OVERCLAIM | changed | checks against the head the package declares; a re-hashed copy needs a separately obtained head |
| W-84 | src/evidence/package.ts:4-6 | "policy packs in effect … independently-verifiable artifact" | C,G | OVERCLAIM | changed | "packs active at export … whose integrity anyone can check offline" |
| W-85 | src/adapters/mcp/server.ts:36-40 (shown to models) | "checked against policy (deny-by-default) … A command denied by policy does not run." | F,E | OVERCLAIM | changed | false in Witness Mode, the `witseal connect` default; now states both modes |
| W-86 | src/adapters/mcp/README.md:16-19 | "A command denied by policy does not run" | F | OVERCLAIM | changed | Gate vs Witness Mode stated |
| W-87 | src/adapters/** (33 files, framework/mediate.ts included) | "independently(-)verifiable … receipt / witnessed execution" ×35, three of them wrapped across lines; the Strands tool docstring is shown to models | C | AMBIGUOUS | changed | "verifiable" (defined in STYLE §11.1); codex COVERAGE "the receipt's verifiability" |
| W-88 | src/adapters/** (13 files) + aws_strands config row | "`witness` mode for observe-only attestation" ×13, "(observe-only)" ×1 | H,F | OVERCLAIM | changed | "recording without enforcement" / "(record, do not enforce)" — Witness Mode executes and its records are unsigned |
| W-89 | swe_agent/COVERAGE.md:74; pi/COVERAGE.md:56 | "baseline guarantee"; "own-execute guarantee" | G | AMBIGUOUS | changed | "baseline evidence"; "own-execute property" |
| W-90 | adapters COVERAGE/README (≈12) | "live-proven", "This proves the execution path …" | G | SUPPORTED_WITH_QUALIFICATION | kept | dated test runs; rule 11 limits them to the tested configuration |
| W-91 | src/cli/replay.ts:5; src/verify/provenance.ts:12-24 | "proves the recorded evidence is internally consistent"; provenance predicates (a)–(e) | G,H | SUPPORTED | kept | verification-established predicates (§9) |
| W-92 | CHANGELOG.md [Unreleased] | — | — | — | added | entry describing this correction |
| W-93 | src/adapters/maf/maf_witseal.py:137-141 (default tool description shown to the model) | "mediated by a deny-by-default policy and recorded as an independently verifiable execution receipt" | F,C | OVERCLAIM | changed | "checked against policy (deny-by-default in Gate mode) and recorded as a verifiable execution receipt" — Witness mode is configurable and does not block |
| W-94 | swe_agent/README.md:40-44; witseal_swe_agent.py:25-28 | "The deny-by-default guarantee … comes from WitSeal Gate mode: a `deny` decision (or … the fail-closed default) blocks the command before it runs" | F | SUPPORTED_WITH_QUALIFICATION | kept | the guarantee is stated as its mechanism, for commands routed through the adapter in Gate mode |
| S-01 | index.html:7 meta description | "It grades how strongly each agent action can be claimed … tamper-evident execution receipts." | G,D,B | OVERCLAIM | changed | records routed actions as hash-chained receipts; "grades its integrations by the boundary that witnesses those actions" |
| S-02 | index.html:9, 14 og/twitter | "Graded execution evidence for AI-agent actions — how strongly each action can be claimed" ×2 | G,D | OVERCLAIM | changed | "… for the AI-agent actions routed through WitSeal … each integration graded by the boundary" |
| S-03 | index.html:689 hero terminal | "[verify] claim WL3 · boundary WL2 → downgrade to WL2" | G | OVERCLAIM | changed | line removed: `witseal verify` never prints it |
| S-04 | index.html:698 tagline | "Graded evidence for what your agents did." | D | OVERCLAIM | changed | "Graded evidence for the agent actions it witnesses." |
| S-05 | index.html:744-747 | "can you prove it later? WitSeal turns each significant agent action into …" | D,G | OVERCLAIM | changed | "what evidence of it will you have later? … each agent action routed through it" |
| S-06 | index.html:750-753 | "checked offline … for evidence-chain integrity and whether its claimed level holds for the declared boundary" | G | OVERCLAIM | changed | "… for evidence-chain integrity." |
| S-07 | index.html:777-778 | "Silent modification of execution history is detectable." | B | OVERCLAIM | changed | edit not re-hashed fails; consistent rewrite shows only against a head kept elsewhere |
| S-08 | index.html:789-790 | "confirms … whether the claimed level holds for the declared boundary: accept, downgrade, or reject" | G | OVERCLAIM | changed | "checks the evidence chain's integrity and reports VALID or INVALID" |
| S-09 | index.html:821-822, 984 | "lets WitSeal observe the result"; "records the host's execution as evidence" | C | AMBIGUOUS | changed | "reports the result to WitSeal … records that report"; "the host's report of the execution" |
| S-10 | index.html:1006 | "Verify tests the receipt against the boundary it declares" | G | OVERCLAIM | changed | "Verify checks the receipt's integrity; it does not independently confirm the boundary it came from." |
| S-11 | index.html:1020, 1024 | "Deny-by-default is the safe default." ×2 | F | AMBIGUOUS | changed | "the stricter default" |
| S-12 | index.html:1039 | "See what your agent actually does." | D | OVERCLAIM | changed | "… through WitSeal." |
| S-13 | index.html:1058 | "WitSeal is a production-oriented implementation" (of WEXP) | G | OVERCLAIM | changed | records evidence WEXP can classify; `witseal verify` does not perform WEXP classification |
| S-14 | index.html:742-743, 1001-1005, 1025, 1029 | "verifiable evidence … within the witnessed execution boundary"; Witness vs Witnessed Execution; mode cards | C,F | SUPPORTED | kept | — |
| S-15 | index.html:823-838 (and docs) | "Full Execution Coverage" category label | D | AMBIGUOUS | not changed | label stronger than its own scope note; product naming decision (Q4) |
| S-16 | index.html:1056-1058 | "WEXP is an open specification …" | — | — | not changed | describes an external specification (request constraint 10) |
| P-01 | README.md:17-19 | "byte-identical … — proven against the three-track golden receipt" | G | AMBIGUOUS | changed | "checked against" (one vector; rule 11) |
| P-02 | README.md:24; verify/__init__.py:8; verify/receipt.py:1, 49 | "independent v0.2 receipt verification"; "independent check"; "Independent verification"; "Independently verify" | C | AMBIGUOUS | changed | "offline" (receipt.py:3 kept: it means a check by a separate implementation of a receipt another track produced) |
| P-03 | README.md:28-31 | "verify a full evidence package" | G | OVERCLAIM | changed | known limitation added: current CLI packages fail schema validation and are reported INVALID (reproduced; IMPL-9) |
| P-04 | integrations/__init__.py:13; mcp.py:158 (shown to models) | "return whether it is genuine"; "Returns whether the supplied artifact is genuine." | G,H | OVERCLAIM | changed | "whether it verifies (hash consistency, and for v0.2 the signature under the given key) — not whether its contents are true" |
| P-05 | STYLE.md | vocabulary without a claim bound | — | AMBIGUOUS | changed | pointer to the claim boundary and core STYLE §11 |
| P-06 | README.md:111-114; witness_event.py:57 | integrations do not observe or record host activity; "append-only entry" | D,B | SUPPORTED_WITH_QUALIFICATION | kept | "append-only" as defined in core STYLE (runtime appends) |
| N-01 | README.md:7-8; SECURITY.md:86; WitSealBridge.cs:12; WitSealTool.cs:79 | "independently verifiable execution receipt(s)" ×4 | C | AMBIGUOUS | changed | "verifiable"; "checked with witseal verify" |
| N-02 | README.md:33-34 | "every command yields a full execution receipt that anyone can re-verify" | A,E | OVERCLAIM | changed | executed command → execution receipt; blocked command → denial record; re-check the chain |
| N-03 | README.md:74; COVERAGE.md:21; SECURITY.md:90; WitSealBridge.cs:29 | "a command with no allowing policy is blocked" ×4 | F | OVERCLAIM | changed | "a command the policy denies — or any command when no policy pack is loaded" |
| N-04 | README.md:132-133 | "Every witnessed command writes a receipt into the WitSeal data dir. Verify … a single receipt" | A,G | OVERCLAIM | changed | recorded as a witness event from which the receipt is derived; "show a single receipt" |
| N-05 | COVERAGE.md:24-26 | "anyone can independently re-verify … no trust in this adapter, the host, or the model is required to check what ran" | C | OVERCLAIM | changed | integrity re-check without trusting the adapter or model; "their truth rests on the host and on whoever can write that directory" |
| N-06 | .csproj Description (NuGet) | "an independently verifiable execution receipt for every command the agent runs" | C,D | OVERCLAIM | changed | "a verifiable execution receipt for every command routed through WitSeal" |
| N-07 | WitSealTool.cs:31-34 (shown to models); :19-22 | "recorded as an independently verifiable execution receipt"; "every invocation is executed by WitSeal" | C,A | OVERCLAIM | changed | "recorded in the WitSeal evidence chain"; "goes through WitSeal and is recorded as evidence" |
| N-08 | WitSealBridge.cs:116 | `Denied`: "True when the command was blocked by policy … and did not run" | E,I | OVERCLAIM | changed | exit code 100 is normally a Gate block; a command exiting 100 is not distinguished |
| N-09 | release.yml:174-177 (release notes) | "All artifacts in this release are signed with Sigstore Cosign" | H | OVERCLAIM | changed | the `.nupkg` and its SBOM are signed (the workflow signs only those) |
| N-10 | WitSealTool.cs:87-88, 97-100 (model-facing results) | "DENIED by policy …; it did not run" on any exit 100; "full execution receipt recorded" when none parsed | E,A | OVERCLAIM | not changed | needs a logic change (IMPL-10) |
| N-11 | COVERAGE.md:30-43 | out-of-scope list | D | SUPPORTED | kept | — |
| K-01 | README.md:69, 166-170; index.ts:30, 74; provenance.gen.ts:80-82 (+ generator template) | "the trusted `--builder-key`"; "the trusted `/attestation/pubkey` channel" ×5 | C,H | OVERCLAIM | changed | the key and the attestation come from the same Worker; the check does not establish who built the bundle |
| K-02 | README.md:102; COVERAGE.md:27, 33; provenance.gen.ts:16-18 (+ template) | "real build provenance in every receipt"; "the provenance of the build that is actually running" ×4 | H | OVERCLAIM | changed | the attested bundle is built before `provenance.gen.ts` is rewritten, so it is not byte-identical to the deployed bundle (by construction) |
| K-03 | README.md:145; index.ts:81 | "(independent re-check)" ×2 | C | AMBIGUOUS | changed | "re-check by anyone" |
| K-04 | COVERAGE.md:24 | "tampering any witnessed field … → INVALID" | B,H | OVERCLAIM | changed | "(for anyone without the signing key)" |
| K-05 | COVERAGE.md:28-29 | "independently verifies with `crypto.verify`"; "serves the trusted builder key" | C | OVERCLAIM | changed | "verifies"; "(same origin as the envelope)" |
| K-06 | SECURITY.md:36-37 | "every receipt this Worker emits is independently verifiable offline" | C,H | OVERCLAIM | changed | checkable under the Worker's key; a receipt signed with the public TEST-ONLY seed (the fallback) can be forged by anyone |
| K-07 | index-receipt-factory.ts:82-83 | "deny-by-default runtime allowed this … computation" | F | OVERCLAIM | changed | "a fixed `allow` … no policy engine runs here" |
| K-08 | README.md:4, 19-33; COVERAGE.md:199-200 | "proves the receipt is accepted as VALID"; scope ceiling; signature binding shown by a negative test | G,D,H | SUPPORTED | kept | — |
| K-09 | deployed `receipts.witseal.com` | which signing key and attestation the live Worker uses | H | NOT_EVALUATED | — | not reachable from the audit environment (Q7) |
| X-01 | private: unpublished site revision | "proves what … happened" ×3; "independently verifiable" ×5; "no trust in the host required"; tamper-evidence stated without its anchor; "safe default" | G,C,B,D,F | OVERCLAIM | changed | aligned to the live site's corrected wording (20 changed lines in one page) |
| X-02 | private: unpublished SDK | "receipts *prove*"; "never required for the truth"; "independently verifies" ×4; a helper said to emit "a signed execution receipt" | G,C,H | OVERCLAIM | changed | 8 statements in 3 files; `witseal exec` produces no signed receipt until an export with a key |
| X-03 | private: unpublished verifier code | "… proves"; "without trusting the runtime that produced them" ×2; "Tampering with any field … causes verification to fail"; "this corpus proves implementations actually agree" | G,C,B | OVERCLAIM | changed | 5 statements in 4 files, and the same crate-doc correction mirrored byte-identically in a second private repository |
| X-04 | private: RFCs and internal design documents | implementation-status statements ("Ratified and implemented"), reason codes, design contracts | G | NOT_EVALUATED | not changed | governance and internal design documents; listed in the private annex |
| CB-01 | CLAIM_BOUNDARY.md:204-205 | "If an exported evidence package is modified after export, `witseal verify` reports `INVALID` for the modified package." | B | OVERCLAIM | not changed | request constraint; see §6 |
| CB-02 | CLAIM_BOUNDARY.md:29-31, 199-200 | "the denial is recorded as execution evidence" | E | AMBIGUOUS | not changed | term of art; defined in STYLE §11.1; see §6 |
| CB-03 | CLAIM_BOUNDARY.md:6-8, 23-54, 182-203, 207-244 | modes, positive claims, "What Verification Means", non-claims | — | SUPPORTED | — | the ceiling the rest of the corrections follow (one sentence affected by S-1 is noted in the private annex) |
| H-01 | CHANGELOG.md:44, 93, 313 (released 0.4.2, 0.4.0, 0.1.0) | "independently verifiable" ×3 | C | AMBIGUOUS | not changed | historical release notes; superseded by the [Unreleased] entry |
| H-02 | docs/adr/0001-hash-chain-construction.md:38, 49 | "every event from N onward fails verification"; "Phase 1's chain only protects against *non-producer* tampering of evidence packages in transit" | B | OVERCLAIM | not changed | accepted ADRs are immutable; a superseding ADR is recommended |
| H-03 | docs/adr/0007-role-vocabulary.md:50 | "to claim — make a verifiable assertion co-emergent with execution" | A | OVERCLAIM | not changed | immutable ADR; `model.md` corrected (W-69) |
| H-04 | Python SDK CHANGELOG.md:67-69 (0.1.0) | "independent v0.2 receipt verification" | C | AMBIGUOUS | not changed | historical release notes |
| H-05 | docs/adr/0002-event-log-format.md:9 | "Every action produces exactly one event" | A | OVERCLAIM | not changed | accepted ADR (immutable); an executed action now writes a `pending` precursor and a final event |
<!-- register:end -->

### 5.3 Totals

<!-- totals:start -->
Rows by surface and class:

| Surface | OVERCLAIM | AMBIGUOUS | SUPPORTED_WITH_QUALIFICATION | SUPPORTED | NOT_EVALUATED | no class | Rows |
|---|---:|---:|---:|---:|---:|---:|---:|
| Core repository (W) | 59 | 17 | 7 | 7 | 2 | 2 | 94 |
| witseal.com (S) | 11 | 3 | 0 | 1 | 0 | 1 | 16 |
| Python SDK (P) | 2 | 3 | 1 | 0 | 0 | 0 | 6 |
| .NET adapter (N) | 9 | 1 | 0 | 1 | 0 | 0 | 11 |
| Workers (K) | 6 | 1 | 0 | 1 | 1 | 0 | 9 |
| Private repositories (X) | 3 | 0 | 0 | 0 | 1 | 0 | 4 |
| `CLAIM_BOUNDARY.md` (CB) | 1 | 1 | 0 | 1 | 0 | 0 | 3 |
| Historical or immutable (H) | 3 | 2 | 0 | 0 | 0 | 0 | 5 |
| **All** | **94** | **28** | **8** | **11** | **4** | **3** | **148** |

Size of the textual change (from `git diff`; this report and the review
packet excluded):

| Repository | Files changed | Passages changed (diff hunks) |
|---|---:|---:|
| Core repository | 53 | 145 |
| witseal.com source | 1 | 16 |
| Python SDK | 6 | 9 |
| .NET adapter | 7 | 15 |
| Workers | 7 | 16 |
| Private repositories (4) | 9 | 27 |
| **All** | **83** | **228** |
<!-- totals:end -->

## 6. Findings inside `CLAIM_BOUNDARY.md` (not changed)

The file is the authoritative statement and was left byte-identical, as
required. Two statements in it do not meet the standard applied to everything
else; they are reported, not rationalized.

**CB-01 — universal tamper claim (OVERCLAIM).** "If an exported evidence
package is modified after export, `witseal verify` reports `INVALID` for the
modified package." The QA flow demonstrates one modification — a field edited
without re-hashing — and that case holds. The sentence states all
modifications. The §3 two-case test fails: a package edited and re-hashed with
the public hashing rule and an unmodified package both receive `VALID`
(`repro/run.sh` B3, B4). Rule 11 applies: a test result describes its own
conditions. Supported ceiling, for a future revision of the boundary: "If an
exported evidence package is modified after export without recomputing the
dependent hashes — as in the QA flow — `witseal verify` reports `INVALID`. A
copy whose events were re-hashed is detected only by comparing its
`chain_head_after_range` with the head printed at export." Public text no
longer repeats the universal form.

**CB-02 — "the denial is recorded as execution evidence" (AMBIGUOUS).** In
the same sentence the boundary says the action does not run, so the intended
reading — "recorded by the execution pipeline as evidence" — is recoverable.
Read on its own, the phrase assigns a denial to the execution base (draft §4).
`STYLE.md` §11.1 now defines *execution evidence* as the name of the record,
not of the outcome, and public text outside the boundary says "recorded as
evidence". Suggested for the next boundary revision: "recorded as evidence".

The boundary's non-claim "protection against a malicious producer who can
rewrite the local chain before export" is accurate but narrower than the
exposure: anyone who can write the data directory — which, on a single
machine, can include the agent through its other tools — and anyone holding an
unsigned exported package can re-hash it. Public text now says so.

## 7. Left unchanged on purpose

- `docs/CLAIM_BOUNDARY.md` — request constraint (§9 confirms byte identity).
- Released history: `CHANGELOG.md` entries for 0.4.2, 0.4.0, 0.1.0 and the
  Python SDK 0.1.0 entry. Rewriting them would hide that the claims were made;
  the [Unreleased] entry records the correction instead.
- Accepted ADRs (`docs/adr/0001`, `0002`, `0007`) — immutable by
  `docs/adr/README.md`. A superseding ADR is recommended for ADR-0001's
  "protects against non-producer tampering", ADR-0002's "exactly one event"
  per action, and ADR-0007's "co-emergent with execution".
- Roadmap statements about Phase 5 (Sigstore, Rekor) — NOT_EVALUATED; nothing
  to check today. See Q6.
- Descriptions of external specifications and papers (WEXP, OWASP list, the
  reading list) — request constraint 10.
- Mechanism statements in the frozen pre-implementation contract
  `ARCHITECTURE.md` that the runtime does not implement: chained receipts with
  an inclusion proof, one event per execution, a read-only recovery mode (W-63,
  an overclaim left in place). The document requires an RFC for deviations
  (L32), so the fix is an RFC or an implementation change, not a wording edit;
  IMPL-7 and IMPL-11 record them.
- Test reports that say "live-proven" or "this proves" about a dated, described
  run (W-90) — they state a test result and its conditions.
- The "Full Execution Coverage" category label (S-15) — product naming; see Q4.
- Runtime strings whose truth depends on logic (N-10) and the starter policy
  pack's description string — changing them is a behavior or policy-content
  change.
- CLI help strings (`src/cli/index.ts`) — reviewed; neutral.

## 8. Before and after — the corrections that matter most

### 8.1 What a receipt is (W-04, W-69, W-82)

Before (`STYLE.md`): "A receipt is structured proof of a completed action."
After: "A receipt is a structured record of one witness event's outcome —
executed, denied, pending, or lost — that `witseal verify` checks against its
event's content hashes. It is not proof that an action completed: read the
`outcome` of its event."
Before (`docs/model.md`): "A claim is co-emergent with execution: it cannot
exist without the execution having occurred."
After: "A claim is formed by the runtime as it mediates an action, for every
outcome: an executed action, and also a denied, pending, or lost one, where
nothing ran or the result is unknown."

### 8.2 Tamper-evidence with its anchor (W-01, W-46, W-21, W-29)

Before (`docs/FAQ.md`): "WitSeal's hash chain breaks at the exact point of any
modification. A single changed byte is detectable."
After: "WitSeal's hash chain breaks at the exact point of an edit that is not
re-hashed — a single changed byte is enough. A consistent rewrite, or dropping
the newest events, is detectable only against a chain head held elsewhere,
such as the one printed at export."
Before (`SECURITY.md`): "Silent tampering of the evidence chain by a
non-producer (chain re-verification detects)."
After: "Edits to the evidence chain or an exported package that are not
re-hashed (chain re-verification detects them); a consistent rewrite is
detectable only against a chain head obtained separately, such as the head
printed at export."

### 8.3 Independence (W-74, W-75, N-05)

Before (`docs/integrations.md`): "Independently verifiable — anyone can check
the receipt with `witseal verify` (VALID / INVALID), with no WitSeal account,
no server, and no trust in the host required." and "Witnessed Execution
produces evidence that stands on its own."
After: "WitSeal's own record of the action it ran, not the host's report.
Anyone can check its integrity with `witseal verify` (VALID / INVALID), with no
WitSeal account or server; the record is produced on the machine that ran the
action, so its truth still rests on that machine and its operator." and
"Witnessed Execution replaces it with WitSeal's own record of an action WitSeal
ran itself."

### 8.4 Strong claims kept and sharpened

- Gate Mode: "a `deny` decision blocks the submitted action before it runs,
  and the denial is recorded" — kept everywhere (CLAIM_BOUNDARY L28-31).
- No policy pack: refuse, exit 100, `no_policy_configured` — kept; `STYLE.md`
  §11.4 also names the explicit override that disables it.
- Witnessed Execution is a stronger record than a host's report *for the same
  kind of claim* (execution at WitSeal's boundary) — kept, now said directly:
  "WitSeal's own observation of the command it spawned".
- New, and supported: comparing `chain_head_after_range` with the head printed
  at export makes any edit to the exported witness events detectable
  (`repro/run.sh` B5). This is the positive half of the tamper-evidence claim,
  previously unstated.

### 8.5 Capabilities the live site claimed (S-03, S-08, S-13)

Before (witseal.com hero terminal): "[verify] claim WL3 · boundary WL2 →
downgrade to WL2" and "It confirms the evidence chain's integrity and whether
the claimed level holds for the declared boundary: accept, downgrade, or
reject."
After: the WL line is removed; "It checks the evidence chain's integrity and
reports VALID or INVALID." No WitSeal verifier implements the grading.

### 8.6 Coverage (W-10, W-81, S-05)

Before (`STYLE.md` model README paragraph): "Run any AI coding agent through
`witseal exec` and every significant action becomes verifiable."
After: "Route an AI coding agent's actions through WitSeal and each one,
executed or denied, leaves a hash-chained record that anyone can check."

### 8.7 Model-facing text (W-85)

Before (MCP `shell` tool description, sent to every connected model): "…
checked against policy (deny-by-default) … A command denied by policy does not
run." `witseal connect` configures Witness Mode, where it does run.
After: "In Gate Mode (deny-by-default) a command denied by policy does not run;
in Witness Mode it runs and the decision is recorded."

## 9. Verification after the changes

- `docs/CLAIM_BOUNDARY.md`: SHA-256 and Git blob recomputed after all edits
  are identical to §2 (`96d24c3b…728b`, `4cc4403a…e3db`), and `git diff`
  against the baseline is empty for that path.
- Strong terms were searched again in every changed repository after the
  edits (independent\*, proof of completion, immutable, cannot be bypassed,
  any modification, silent(ly) altered, every action, guarantee, proves what,
  stands on its own, safe default). Every remaining hit is one of: a quoted
  prohibited formulation in `STYLE.md` §11.2 or this report; released history
  or an accepted ADR (§7); a statement about something other than evidence
  strength (file locking, write modes, RFC status, a separate implementation
  re-deriving test vectors, "host-independent"); a dated test report (W-90);
  a mechanism stated precisely (W-94); or the title of an external paper. The
  second search found six wrapped or model-facing passages the first pass
  had missed (W-87, W-93, P-02); they are corrected.
- Consistency: every corrected sentence was checked against §4, and the same
  ceiling wording is used for the same family across repositories.

### 9.1 Checks run

| Repository | Check, as in its CI | Result |
|---|---|---|
| Core | `npm run typecheck`; `npm run lint` | pass |
| Core | `vitest run` | 599 tests passed (47 files) |
| Core | `npm run style-check`, new files included | no avoided terms |
| Core | `npm run check:versions` | all anchors agree on 0.4.2 |
| Core | `repro/run.sh` with the baseline build | the output in `repro/expected-output.txt` |
| Python SDK | `pytest -q` | 202 passed, 1 skipped |
| Python SDK | `ruff check .`; `scripts/style_check.py`; `scripts/check_version_consistency.py` | pass |
| Python SDK | `mypy src` | 3 errors in `integrations/mcp.py`, the same at the baseline commit: the audit environment resolved `mcp` 2.3.0, while the lock file pins 1.27.2 |
| Workers | `tsc --noEmit`; `wrangler deploy --dry-run`; `node --check` on the generator | pass |
| witseal.com source | sanitary scan; version pins | pass (Cyrillic only, see below); pins unchanged at 0.4.2 |
| .NET adapter | not built: no .NET SDK in the audit environment | the changes are comments, XML documentation, one model-facing string constant, NuGet metadata, and release-note text |
| Private repositories | their own vet, test, and doc builds where the toolchain was available | pass |
| All changed repositories | Cyrillic scan of tracked files (first half of the sanitary barrier) | none found |
| All changed repositories | `SANITARY_DENYLIST` scan (second half) | not run: the denylist is a repository variable the audit cannot see; it must pass in CI before merge |

## 10. Residual limitations of this audit

- **Producer self-audit.** The auditor works for the producer; nothing here is
  independent review (draft §8.1). This report is input for one.
- **Evaluator correctness** is a premise of every finding (draft §14).
- **The live site was not fetched**; the audit read its source repository at
  the commit recorded in §2, which a CI job compares byte-for-byte with the
  deployed page.
- **The live Worker was not reachable**, so which signing key and attestation
  `receipts.witseal.com` uses is NOT_EVALUATED (K-09).
- **The reference draft was not re-fetched** from the IETF; its identity rests
  on the recorded hash of the archival copy.
- **The sanitary denylist** of the repositories' CI is a repository variable
  not visible to the audit; it must pass in CI before merge.
- **Private repositories** are summarized (X-01..X-04); their hundreds of
  inventory items were not each classified in this public report.
- **No implementation change was made**, so the implementation findings below
  remain true of the product.

### 10.1 Implementation findings outside the wording scope

| ID | Finding | Where public text now accounts for it |
|---|---|---|
| IMPL-1 | `*_executed_with_error` also covers a spawn failure in which no process started | STYLE §11.1; ARCHITECTURE §5.3 |
| IMPL-2 | Host-reported (Level-2) records use the same outcome labels as actions WitSeal ran; receipts do not record their boundary; a missing host exit code is recorded as 0 | site grading claims removed (S-01..S-13); reviewer question Q3 |
| IMPL-3 | v0.1 receipts are derived on demand with a new `finalized_at`, so their hash differs between derivations | model.md W-72; STYLE §11.1 |
| IMPL-4 | Evidence packages embed policy packs active at export, not at decision time | threat-model T9 (W-33); package.ts (W-84) |
| IMPL-5 | `witseal verify` takes no anchor input; the head comparison is manual | STYLE §11.4; hello-witness; FAQ; threat-model |
| IMPL-6 | No verifier implements WEXP grading | witseal.com S-03, S-06, S-08, S-13 |
| IMPL-7 | The runtime still emits `pending` under `witseal.witness.v0.1`, which RFC-0003 marks deprecated-for-emission; `ARCHITECTURE.md` describes a read-only recovery mode that does not exist | CLAIM_BOUNDARY already describes the precursor; threat-model T12 (W-34) |
| IMPL-8 | Workers: the attested bundle can never be the deployed bundle; receipts fall back to the public TEST seed when the secret is unset; every receipt carries the same ids and timestamp; the policy decision is a constant | K-01..K-07 |
| IMPL-9 | Python SDK reports INVALID for evidence packages from the default `@witseal/cli@0.4.2` flow (schema drift: `pending`, `intent_recorded_event_id`, later outcomes) | P-03 |
| IMPL-10 | .NET: `Denied` is "exit code 100", indistinguishable from a command exiting 100; the event id is not parsed on real denials; the success text says a receipt was recorded even when none was parsed; the `Terminate` default is documented as true but is false | N-08 (doc); N-10 (not changed) |
| IMPL-11 | Receipts are not chained: the chain links witness events, and a receipt is tied to its event by id and content hashes, not by a hash in the chain | W-63 (not changed); `STYLE.md` §11.1 receipt row |
| S-1, S-2 | Two security-relevant verifier and policy-matching gaps | described privately to the maintainer per `SECURITY.md`; public wording bounded accordingly |

## 11. Questions for an external reviewer

- **Q1.** CB-01: is the suggested restatement the right ceiling, or should the
  boundary also name the head-comparison procedure as a positive claim?
- **Q2.** Is "execution evidence" acceptable as a category name that includes
  denials (CB-02), given `STYLE.md` §11.1, or should the vocabulary change?
- **Q3.** Since receipts do not record their producing boundary (IMPL-2), is any
  public use of "graded evidence" supportable today beyond grading
  *integrations* in documentation (S-01, S-04)?
- **Q4.** Does the label "Full Execution Coverage" overclaim even with its scope
  note (S-15), under STYLE §11.3's bound-in-the-claim rule?
- **Q5.** Is "verifiable" (defined in STYLE §11.1 as "integrity can be
  re-checked") an adequate replacement for "independently verifiable", or does
  the bare word still invite the stronger reading?
- **Q6.** The Phase 5 roadmap says Rekor inclusion will make a rewrite
  "publicly visible". Under draft §6 rules 3 and 5, what further condition
  (for example, an expected cadence watched outside the producer) should that
  roadmap claim carry before it is made?
- **Q7.** Which key and attestation does the deployed Worker use (K-09)?
- **Q8.** Are the register's class assignments for W-22, W-32 and W-42
  (supported with qualification, yet tightened) consistent with the method in §3?
- **Q9.** `ARCHITECTURE.md` is a frozen pre-implementation contract that the
  runtime deviates from (W-63). Is a status note that points readers to
  `CLAIM_BOUNDARY.md` enough until an RFC revises it, or should the deviating
  statements be marked where they stand?

## 12. Review packet

`docs/audits/cbee-review-packet-2026-10/` lets a reviewer check the main
corrections without reading the repository: `README.md` (how to review, about
thirty minutes), `CLAIMS.md` (eight claims, each with the original wording,
the product semantics with file references, a receipt or command output, the
`CLAIM_BOUNDARY.md` lines, the rule of the draft, and the corrected wording),
`evidence/` (an evidence package exported by the baseline CLI, a re-hashed
copy that still verifies, and single receipts and events taken from the
package), and `repro/` (the script behind §4.3 and its output).

## 13. Process notes

- `STYLE.md` §9 requires an RFC and founder sign-off for changes to its
  Sections 2 and 3; `docs/model.md` requires an ADR for vocabulary changes.
  The corrections here change explanatory text, not the term set, but the
  branch should not be merged until that sign-off is given.
- `docs/ARCHITECTURE.md` is frozen for Phase 1 and requires an RFC for
  deviations (L32). The wording corrections made there (W-50 to W-61) do not
  change the architecture; the maintainer should confirm that they may land
  without an RFC.
- The core repository's authorship guard requires the project's commit
  identity; the audit commits there use it, and every commit names the
  session that produced it.
- Nothing was merged, published, or sent to anyone.
