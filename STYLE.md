# WitSeal · STYLE.md

## Canonical Vocabulary & Category Language Discipline

Version: v0.3.0
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

| Use | Avoid | Why |
|---|---|---|
| witnessed execution | AI monitoring, AI observability, AI logging | "Monitoring" implies passive observation. Witnessed execution is active mediation with cryptographic evidence. |
| execution evidence | logs, telemetry, traces | Logs can be silently altered. Evidence is hash-chained, replayable, and tamper-evident. |
| operational trust | AI safety, AI alignment | Safety/alignment refer to model behavior. Operational trust refers to action accountability — a different layer. |
| authority boundary | permission system, ACL, RBAC | Authority is explicitly declared and inspectable. "Permission" implies opaque rules. |
| evidence chain | audit log, audit trail | Audit trails are passive records. Evidence chain is hash-linked and independently verifiable. |
| trust runtime | wrapper, middleware, proxy | Wrappers are incidental; runtimes are primary. WitSeal is a runtime that agents pass through, not a wrapper around them. |
| Agentic Trust Infrastructure | AI governance, AI security platform, AI compliance tool | The category is infrastructure, not a governance app. Naming matters. |
| witness event | log entry, monitoring record | Witness events are append-only and hash-linked. Log entries are not. |
| execution receipt | execution log, run record | A receipt is structured proof of a completed action. A log is unstructured narrative. |
| approval gate | manual review, human-in-the-loop check | Approval is an explicit, recorded authorization. HITL is a UX pattern, not an authority primitive. |
| risk classification | severity tagging, threat scoring | Risk classification drives policy decisions; severity is descriptive. |
| policy decision | rule match, gate result | A policy decision is the structured output of a policy engine, including reasoning. Rule match is binary. |
| deny-by-default | safe mode, restrictive mode | Deny-by-default is a security primitive with formal meaning. The other terms are marketing. |
| hash-chained | linked, sequenced | Hash-chained means cryptographic continuity. The others are loose. |
| replayable | reproducible, re-runnable | Replay implies deterministic reconstruction from evidence. Reproducibility is weaker. |
| provider-independent | vendor-neutral, model-agnostic | WitSeal does not depend on any AI provider. The phrase emphasizes operational sovereignty. |
| evidence package | export bundle, audit dump | Evidence package is a defined artifact with schema. The others are ad hoc. |
| tamper-evident | immutable, secure | Tamper-evident is a precise cryptographic property. Immutability is overclaim. |
| authority declaration | role assignment, configuration | Authority is declared by a human, not configured by an admin. The distinction matters. |
| cross-agent trust | multi-agent governance, agent orchestration | Cross-agent trust is what WitSeal eventually enables; orchestration is a different category. |
| operational integrity | reliability, robustness | Operational integrity means the action chain remains intact under attack and failure. The others are weaker. |
| constraint (by policy decision) | enforcement, gating, compliance control, guard, guardrails | The Gate contour constrains an action per an externally supplied policy decision — it does not author the policy (authoring is PAI-Kernel territory; cf. authority boundary). |

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

- sovereign — only when describing the long-term PAI-Native runtime, not WitSeal Phase 1
- constitutional — reserved for PAI-Kernel; WitSeal does not have a constitution
- authorial — reserved for PAI ecosystem language; not used in WitSeal-only documents
- authority — has a specific meaning (declared, inspectable boundary); not a synonym for "permission"

---

## 4. Avoid List — Expanded Rationale

Some "Avoid" terms deserve explanation because they look harmless.

**"AI safety"**
Owned by alignment research community (Anthropic, DeepMind, OpenAI safety teams). Using it positions WitSeal as a competitor to ML research, which is the wrong frame. WitSeal is operational infrastructure, not safety research.

**"AI governance"**
Owned by enterprise GRC vendors and policy think tanks. Connotes dashboards, audits, and committee meetings. WitSeal is a developer-facing runtime; governance is an outcome, not a positioning.

**"AI observability"**
Owned by Datadog, New Relic, Honeycomb, Arize. Implies passive metrics and traces. WitSeal does not observe — it mediates and proves.

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

> WitSeal is a witnessed execution runtime for AI agents. It classifies actions, enforces authority boundaries, records witness events, generates hash-chained receipts, and maintains tamper-evident evidence chains. Run any AI coding agent through `witseal exec` and every significant action becomes verifiable.

❌ **Wrong:**

> WitSeal is an AI governance platform that helps developers monitor and audit what their AI agents do. It logs agent activity, applies safety rules, and creates audit trails for compliance.

The wrong version uses six avoided terms (governance platform, monitor, audit, logs, safety rules, audit trails, compliance). It also positions WitSeal in three different categories simultaneously — none of which are the right one.

### 6.2 Blog post intro

✅ **Right:**

> When an AI coding agent runs `rm -rf` on your project, three questions matter. What did it do? Was it allowed to do it? Can you prove what happened? WitSeal answers all three by making every agent action a witnessed execution — classified, mediated, receipted, and hash-linked into an evidence chain.

❌ **Wrong:**

> AI agents are getting more powerful, and that means we need better security tools. WitSeal is an AI safety wrapper that monitors agent behavior and creates audit logs so you can review what your AI is doing.

### 6.3 Conference talk abstract

✅ **Right:**

> Title: *Witnessed Execution: A Deny-by-Default Runtime for AI Coding Agents*
>
> When AI coding agents gain shell, filesystem, and deployment access, the operational trust gap widens. We present WitSeal, a single-node trust runtime that mediates agent execution through explicit authority boundaries and produces hash-chained receipts that any third party can verify offline.

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

## 8. Terms NOT Yet Owned (Watchlist)

Other vendors have introduced terms that may converge with WitSeal's category. Track these; do not adopt them as primary terminology, but understand them:

| External Term | Used By | WitSeal Position |
|---|---|---|
| receipt chain | Authensor, Aegon (arXiv 2604.06693), NABAOS (arXiv 2603.10060) | Adjacent. Use *evidence chain* as primary; mention *receipt chain* in comparison contexts. |
| Cross-Model Verification Kernel | Microsoft Agent Governance Toolkit | Different concept (model-output verification). Do not adopt. |
| AI Identity Gateway | Strata | Different layer (token minting, not action mediation). Do not adopt. |
| AI Security Fabric | Pillar Security | Marketing term; no precise meaning. Do not adopt. |
| Structured Decision Records | Oracle governance taxonomy | Adjacent to *policy decision*. Use *policy decision* as primary. |
| fail-closed SDK | Authensor | Useful concept but already covered by *deny-by-default*. Use deny-by-default. |
| ephemeral, task-scoped tokens | Strata | Identity layer concept. Out of WitSeal scope until Phase 6+. |

Reassess this list quarterly. If a term gains industry-wide adoption (cited by analysts, used by 3+ vendors), reconsider whether to adopt or explicitly distinguish.

---

## 9. Enforcement

This style guide is enforced through three mechanisms.

**Pre-commit hook (optional but recommended).**
A `style-check` script that scans staged Markdown files for terms in the Avoid column and warns. Not a hard block — false positives are inevitable — but a friction layer that catches drift.

**PR review.**
Reviewers explicitly check public-facing text against this document. A "vocabulary drift" comment is grounds for revision before merge. This applies especially to README, blog posts, release notes, and external docs.

**Quarterly vocabulary audit.**
Once per quarter, run a simple grep across the repository for the top five Avoid terms. If any have crept in, file a PR to fix. Track the count over time as a vocabulary-drift metric.

---

## 10. When This Document Changes

The Use column is **stable** — terms only leave it under exceptional circumstances (e.g., a term becomes overloaded by an industry shift).

The Avoid column is **growing** — as competitors introduce vocabulary that WitSeal explicitly distances from, new entries are added.

The Watchlist (Section 8) is **active** — reassess every quarter.

Changes to Sections 2 and 3 require an RFC and founder sign-off. Changes to Sections 8 and 10 require a PR with rationale.

---

## 11. The One-Line Summary

If anyone asks why WitSeal cares this much about words:

> Categories are created in language. Every artifact is either reinforcing the category or eroding it. There is no neutral ground.
