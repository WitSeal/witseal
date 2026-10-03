# WitSeal · STYLE.md

## Canonical Vocabulary & Category Language Discipline

Version: v0.4.0
Status: Repository-binding
Scope: All public artifacts — README, docs, blog posts, conference talks, code comments, commit messages, issue templates, PR descriptions, release notes.

---

## 1. Why This Document Exists

WitSeal is creating a category. Categories are created in code and language, not in marketing.

Every time a public artifact uses a generic term where a canonical term exists, the category dilutes. Every time a competitor's vocabulary is adopted, a piece of semantic moat is conceded.

This document is **enforced by review**: every PR that touches public-facing text is checked against the Use/Avoid table below. Drift is treated as a defect, not a style preference.

---

## 2. The Canonical Term Table

The left column is what WitSeal **uses**. The right column is what WitSeal **does not use** in public artifacts, and why.

The Why column explains a term; it never widens a claim. Every statement made with these terms stays within [`docs/CLAIM_BOUNDARY.md`](./docs/CLAIM_BOUNDARY.md) — see Section 11.

| Use | Avoid | Why |
|---|---|---|
| witnessed execution | AI monitoring, AI observability, AI logging | "Monitoring" implies passive observation. Witnessed execution is active mediation with cryptographic evidence. |
| execution evidence | logs, telemetry, traces | Execution evidence is the hash-chained, replayable record WitSeal's pipeline makes of a mediated action, whatever its outcome — a denial included. An edit to it breaks the chain unless every later hash is recomputed (see *tamper-evident*); a plain log has no such check. It shows that an action executed only when its outcome says so. |
| operational trust | AI safety, AI alignment | Safety/alignment refer to model behavior. Operational trust refers to action accountability — a different layer. |
| authority boundary | permission system, ACL, RBAC | Authority is explicitly declared and inspectable. "Permission" implies opaque rules. |
| evidence chain | audit log, audit trail | Audit trails are passive records. An evidence chain is hash-linked: anyone can re-check its continuity offline with `witseal verify`, with no WitSeal account, server, or cooperation. The records remain the producer's own account. |
| trust runtime | wrapper, middleware, proxy | Wrappers are incidental; runtimes are primary. WitSeal is a runtime that agents pass through, not a wrapper around them. |
| Agentic Trust Infrastructure | AI governance, AI security platform, AI compliance tool | The category is infrastructure, not a governance app. Naming matters. |
| witness event | log entry, monitoring record | Witness events are appended by the runtime and hash-linked to their predecessor, so an edited event fails verification unless the chain is re-hashed from it onward. Log entries carry no such link. |
| execution receipt | execution log, run record | A receipt is a structured record of one witness event's outcome — executed, denied, pending, or lost — that `witseal verify` checks against its event's content hashes. It is not proof that an action completed: read the `outcome` of its event. A log is unstructured narrative. |
| approval gate | manual review, human-in-the-loop check | Approval is an explicit, recorded decision; the record does not establish who gave it or that they had authority. HITL is a UX pattern, not an authority primitive. |
| risk classification | severity tagging, threat scoring | Risk classification drives policy decisions; severity is descriptive. |
| policy decision | rule match, gate result | A policy decision is the structured output of a policy engine, including reasoning. Rule match is binary. |
| deny-by-default | safe mode, restrictive mode | Deny-by-default is a security primitive with formal meaning. In WitSeal it is the Gate Mode posture: a `deny` decision blocks the action, and with no active policy pack every action is refused. An action no rule matches takes the pack's `default_decision` — `allow` in the quickstart and starter packs. The other terms are marketing. |
| hash-chained | linked, sequenced | Hash-chained means cryptographic continuity. The others are loose. |
| replayable | reproducible, re-runnable | Replay implies deterministic reconstruction from evidence. Reproducibility is weaker. |
| provider-independent | vendor-neutral, model-agnostic | WitSeal does not depend on any AI provider. The phrase emphasizes operational sovereignty. |
| evidence package | export bundle, audit dump | Evidence package is a defined artifact with schema. The others are ad hoc. |
| tamper-evident | immutable, secure | Tamper-evident is a precise cryptographic property with a stated anchor: an edit fails `witseal verify` unless every later hash is recomputed, and any edit to the chain's events is detectable against a chain head held outside the writer's reach. It does not stop anyone who can write the data directory — the producer included — from rewriting history before export. Immutability is overclaim. |
| authority declaration | role assignment, configuration | Authority is declared by a human, not configured by an admin. The distinction matters. |
| cross-agent trust | multi-agent governance, agent orchestration | Cross-agent trust is what WitSeal eventually enables; orchestration is a different category. |
| operational integrity | reliability, robustness | Operational integrity means a failure or an edit that breaks the action chain is surfaced, not silently accepted: a crash mid-action leaves a `pending` or `execution_lost` record, and an edit that was not re-hashed fails verification. It does not mean the chain cannot be rewritten. The others are weaker. |
| constraint (by policy decision) | enforcement, gating, compliance control, guard, guardrails | The Gate contour constrains an action per an externally supplied policy decision — it does not author the policy (authoring belongs to an external policy/authority layer; cf. authority boundary). |

---

## 3. Term Categories

The vocabulary above falls into four roles. Treat them differently.

### 3.1 Category-defining terms (use aggressively)

These are the words WitSeal owns. Use them in every public artifact:

- Agentic Trust Infrastructure
- witnessed execution
- execution evidence
- evidence chain
- trust runtime
- operational trust
- witness event
- execution receipt
- authority boundary

These should appear in: project tagline, README first paragraph, every blog post, every conference talk title or abstract, every adapter's introductory line.

### 3.2 Technical primitives (use precisely)

These are technical terms with formal meaning. Misuse degrades credibility:

- deny-by-default
- hash-chained
- tamper-evident
- replayable
- provider-independent
- approval gate
- risk classification
- policy decision

If a non-technical reader needs simpler language, link to a glossary entry — do not substitute a softer word.

### 3.3 Operational terms (use consistently)

These describe how WitSeal works at runtime:

- intent
- classification
- policy
- approval
- execution
- witness
- receipt
- hash-chain
- hash chain
- stamp
- evidence package

The runtime pipeline is named in this exact order in `ARCHITECTURE.md`. Do not reorder, rename, or shortcut these terms.

### 3.4 Reserved terms (use sparingly, with care)

These have specific meaning and should not be used loosely:

- sovereign — only when describing the later authority-runtime layer, not WitSeal Phase 1
- constitutional — reserved for an upstream constitutional authority layer
- authorial — broader authority-layer language; not used in WitSeal-only documents
- authority — has a specific meaning (declared, inspectable boundary); not a synonym for "permission"

---

## 4. Avoid List — Expanded Rationale

Some "Avoid" terms deserve explanation because they look harmless.

**"AI safety"**
Owned by alignment research and model-safety communities. Using it positions WitSeal as a competitor to ML research, which is the wrong frame. WitSeal is operational infrastructure, not safety research.

**"AI governance"**
Owned by enterprise GRC vendors and policy think tanks. Connotes dashboards, audits, and committee meetings. WitSeal is a developer-facing runtime; governance is an outcome, not a positioning.

**"AI observability"**
Owned by existing logging/observability platforms. Implies passive metrics and traces. WitSeal does not just observe — it mediates and records.

**"Compliance"**
Compliance is downstream of WitSeal's evidence. Saying "WitSeal helps with compliance" weakens the product to a feature of someone else's category. Compliance buyers are the wrong wedge.

**"Wrapper"**
Implies WitSeal is a thin layer around something more important. WitSeal is the runtime; the agent is the producer of intentions that pass through it.

**"Middleware"**
Generic term that has been used for everything from Express.js to enterprise integration buses. Tells the reader nothing about what WitSeal does.

**"Audit log"**
Audit logs are passive records produced for someone else (auditor, regulator). WitSeal produces evidence chains — active, structured, cryptographically continuous artifacts that the producer themselves verifies.

**"Permission system"**
Permissions are configured by admins and apply to user roles. Authority boundaries are declared by principals and apply to actions. The distinction is the entire reason WitSeal exists.

---

## 5. Naming Conventions for Code

Code identifiers are public artifacts. They appear in API surface, error messages, log output, and developer documentation.

**Use canonical names for primary types:**

```typescript
// Good
class WitnessEvent { /* ... */ }
class ExecutionReceipt { /* ... */ }
class PolicyDecision { /* ... */ }
class AuthorityDeclaration { /* ... */ }
class EvidencePackage { /* ... */ }

// Bad
class LogEntry { /* ... */ }
class RunRecord { /* ... */ }
class RuleMatch { /* ... */ }
class RoleConfig { /* ... */ }
class AuditDump { /* ... */ }
```

**Use canonical verbs for primary operations:**

```typescript
// Good
witseal.classify(intent)
witseal.evaluate(policy, intent)
witseal.approve(decision)
witseal.execute(action)
witseal.witness(event)
witseal.receipt(execution)
witseal.replay(receiptId)
witseal.verify(evidencePackage)

// Bad
witseal.check(intent)
witseal.process(action)
witseal.log(event)
witseal.record(execution)
```

**CLI subcommands follow the runtime pipeline:**

```bash
witseal classify <intent>
witseal evaluate <intent>
witseal exec <command>          # primary command
witseal witness list
witseal receipt show <id>       # primary display command — "what happened?"
witseal replay <receipt-id>
witseal verify <evidence-package>   # truth judgement — VALID / INVALID
```

Three commands answer three distinct questions; none takes on another's role
(noun-plus-verb grammar; one responsibility per command):

| Command | Question | Role |
|---|---|---|
| `receipt show` | "What happened?" | present a `receipt` artifact to a human |
| `verify` | "Can this be trusted?" | truth judgement — `VALID` / `INVALID` |
| `inspect` | "Why did it happen this way? What is inside the evidence?" | expert forensic analysis |

`inspect` is a **reserved** top-level verb for a debug / evidence-forensic mode
(e.g. `inspect receipt.json`, `inspect trace.json`, `inspect evidence/`). It is
**out of scope for `0.1.0`** — the name is reserved now; the forensic layer is a
later-maturity surface (v0.3–v1.0). Do not overload `receipt show` (display) or
`verify` (judgement) with forensic responsibilities.

**Schema names are versioned canonical types:**

```
witseal.witness.v0.1
witseal.receipt.v0.1
witseal.policy.v0.1
witseal.approval.v0.1
witseal.evidence-package.v0.1
witseal.authority.v0.1
```

---

## 6. Examples — Right and Wrong

### 6.1 README first paragraph

✅ **Right:**

> WitSeal is a witnessed execution runtime for AI agents. It classifies actions, enforces authority boundaries in Gate Mode, records witness events and receipts, and maintains tamper-evident evidence chains. Route an AI coding agent's actions through WitSeal and each one, executed or denied, leaves a hash-chained record that anyone can check.

❌ **Wrong:**

> WitSeal is an AI governance platform that helps developers monitor and audit what their AI agents do. It logs agent activity, applies safety rules, and creates audit trails for compliance.

The wrong version uses six avoided terms (governance platform, monitor, audit, logs, safety rules, audit trails, compliance). It also positions WitSeal in three different categories simultaneously — none of which are the right one.

### 6.2 Blog post intro

✅ **Right:**

> When an AI coding agent runs `rm -rf` on your project, three questions matter. What did it do? Was it allowed to do it? What evidence is left afterwards? For every action routed through it, WitSeal answers all three: the action is classified, mediated, receipted, and hash-linked into an evidence chain.

❌ **Wrong:**

> AI agents are getting more powerful, and that means we need better security tools. WitSeal is an AI safety wrapper that monitors agent behavior and creates audit logs so you can review what your AI is doing.

### 6.3 Conference talk abstract

✅ **Right:**

> Title: *Witnessed Execution: A Deny-by-Default Runtime for AI Coding Agents*
>
> When AI coding agents gain shell, filesystem, and deployment access, the operational trust gap widens. We present WitSeal, a single-node trust runtime that mediates agent execution through explicit authority boundaries and produces hash-chained receipts whose integrity any third party can check offline.

❌ **Wrong:**

> Title: *AI Governance for the Modern Developer*
>
> Learn how WitSeal helps you monitor AI agent activity, enforce security policies, and stay compliant with emerging AI regulations.

---

## 7. The "Mention Map" Rule

Every public artifact should reinforce category vocabulary. Apply the mention map:

- **Tagline / first sentence:** must contain "witnessed execution" or "trust runtime"
- **First three paragraphs:** must contain "evidence chain" and "authority boundary"
- **Every demo:** must show a hash-chained receipt and a deny-by-default decision
- **Every conference talk:** must contain "Agentic Trust Infrastructure" at least once

Repetition is the price of category creation. Linguists call this lexical priming. Marketers call it "owning the words." Either way, it works.

---

## 8. Enforcement

This style guide is enforced through three mechanisms.

**Pre-commit hook (optional but recommended).**
A `style-check` script that scans staged Markdown files for terms in the Avoid column and warns. Not a hard block — false positives are inevitable — but a friction layer that catches drift.

**PR review.**
Reviewers explicitly check public-facing text against this document, including every claim against Section 11. A "vocabulary drift" comment is grounds for revision before merge. This applies especially to README, blog posts, release notes, and external docs.

**Quarterly vocabulary audit.**
Once per quarter, run a simple grep across the repository for the top five Avoid terms. If any have crept in, file a PR to fix. Track the count over time as a vocabulary-drift metric.

---

## 9. When This Document Changes

The Use column is **stable** — terms only leave it under exceptional circumstances (e.g., a term becomes overloaded by an industry shift).

The Avoid column is **growing** — as external vocabulary creates ambiguity with WitSeal's terms, new entries are added.

Changes to Sections 2 and 3 require an RFC and founder sign-off. Other changes require a PR with rationale.

---

## 10. The One-Line Summary

If anyone asks why WitSeal cares this much about words:

> Categories are created in language. Every artifact is either reinforcing the category or eroding it. There is no neutral ground.

---

## 11. Claim Discipline

The vocabulary above names things; it never upgrades them. Every public statement about what WitSeal evidence shows stays within [`docs/CLAIM_BOUNDARY.md`](./docs/CLAIM_BOUNDARY.md), the authoritative statement of what WitSeal claims. If this guide and the claim boundary ever differ, the claim boundary wins and this guide is the one to fix. Claims are reviewed with the non-inference rules of `draft-sergeev-claim-boundaries-01` (CBEE): a record's strength is limited by what the boundary that produced it could observe, and by who controls that boundary.

### 11.1 Say which of these you mean

| Term | What it is | What it does not establish |
|---|---|---|
| receipt | A structured record of one witness event, for every outcome: `allowed_executed`, `denied_by_policy`, `pending`, `execution_lost`, and the rest. | That the action ran. Read the event's `outcome` first. |
| policy decision record | The recorded `allow` / `deny` / `require-approval`, with the hashes of the packs it was made under. | That the policy, its author, or an approval was legitimate. |
| denial record | A `denied_by_policy` or `denied_by_approval` record, or `no_policy_configured` with no execution result: in Gate Mode, WitSeal refused to run the submitted action. | That the agent did not reach the same effect by another path. |
| execution evidence | WitSeal's term for everything its pipeline records about a mediated action, denials included. It names the record, not the outcome. | That the action executed; only an executed outcome says that. |
| execution result | For an action WitSeal ran: exit code, signal, stdout/stderr content hashes with bounded head/tail, `spawn_error`. | What the command changed beyond its output, or that it was correct. A `*_with_error` outcome with `spawn_error` set means the process never started. |
| host-reported result | What a sealed host's hook reported after the host ran the action (Witness integrations, e.g. Claude Code `PostToolUse`). | That WitSeal observed the execution. Witness Mode (`--mode witness`) is different: there WitSeal runs the action itself. |
| external effect | Anything a command changed outside its output, such as files it wrote or network calls it made. | Not observed by WitSeal in Phase 1 (no syscall mediation). |
| integrity | Hash continuity of the records presented: no edit without re-hashing. | Completeness, truth of the content, or absence of a consistent rewrite before export. |
| verifiable | Its integrity can be re-checked with `witseal verify`: hash continuity, and for v0.2 receipts the signature under a given public key. | That its content is true, that the action ran, or that nothing is missing. |
| completeness | That the records are all the actions that happened. | Not established: WitSeal records only what is routed through it, and an exported range is whatever range was exported. |
| independent checkability | Anyone can run `witseal verify` offline, with no WitSeal account, server, or cooperation. | That the evidence is independent of its producer. |
| independent evidence | A record from a party the producer does not control. | Not provided in Phase 1: no third-party signature, no transparency log. |

### 11.2 Preferred and prohibited formulations

| Do not write | Write instead, when the evidence supports it | Why |
|---|---|---|
| "A receipt is proof of a completed action." | "A receipt records one action's outcome. For an action WitSeal ran itself, `allowed_executed` means the command ran and exited 0." | Receipts also exist for denied, pending, and lost actions. |
| "WitSeal proves what happened." | "WitSeal records what it decided and, for actions it ran, what the command returned." | A record is its producer's own account; a hash or signature does not make it true. |
| "The denial is evidence the action executed" — or any wording that lets *execution evidence* read as *executed*. | "The denied action did not run; the denial is recorded as evidence." | A `deny` record evidences a decision and non-execution at WitSeal's boundary only. |
| "Logs can be altered; WitSeal evidence cannot." / "Any modification is detected." | "An edit breaks the hash chain unless every later hash is recomputed; a consistent rewrite is detectable only against a chain head held elsewhere." | Anyone who can write the data directory, or who holds a copy of an unsigned package, can re-hash it. |
| "independently verifiable" / "no trust in the host required" | "Anyone can check its integrity offline with `witseal verify` — no WitSeal account or server." | An independent check of the producer's record does not make the record independent. |
| "Every agent action becomes verifiable." | "Every action an agent routes through WitSeal is recorded." | Actions outside the WitSeal boundary are not seen, and completeness is not established. |
| "WitSeal cannot be bypassed." | "In Gate Mode, WitSeal blocks a routed action that policy denies." | Other tool paths bypass WitSeal, and WitSeal does not detect that. |
| "`VALID` means the action happened / was allowed / nothing is missing." | "`VALID` means the records presented are hash-consistent." | `witseal verify` does not observe execution, re-run policy, or establish completeness. |
| "Signed receipts prove …" | "A v0.2 signature shows the receipt was signed at export with the operator's key." | The operator holds the key; a signature authenticates bytes, not events. |

### 11.3 Put the bound in the claim

A qualifier belongs in the same sentence, table cell, or headline as the claim it bounds. A footnote, tooltip, or later section does not bound a headline. If the bounded headline is too long, shorten the claim, not the bound.

### 11.4 Keep the strong claims that hold

Say these plainly; the claim boundary supports them:

- In Gate Mode, a `deny` decision blocks the submitted action before it runs, and the denial is recorded.
- With no active policy pack, Gate Mode refuses the action, exits with code `100`, and records `no_policy_configured`. Only the explicit operator override `WITSEAL_UNSAFE_ALLOW_NO_POLICY=1` lets it run, and the record then carries the execution result.
- For an action WitSeal ran itself, the record is WitSeal's own observation of the command it spawned, not the host's report.
- `witseal verify` reports `INVALID` for a witness event edited without re-hashing. For an exported package, also comparing its `chain_head_after_range` with the head printed at export — obtained over a channel the editor does not control — makes any edit to the exported witness events detectable.

### 11.5 No conformance labels

Do not call WitSeal, a receipt, or a document "CBEE-compliant", "conformant", or "certified". Name the specific claims that were checked, and against what evidence.
