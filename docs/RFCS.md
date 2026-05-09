# RFC Process

> **Note:** WitSeal is in Phase 1 (pre-release). The RFC process is documented
> and infrastructure is in place, but **active RFCs do not begin until week 7-10
> of Phase 1** (target: 2026-07). Until then, this document is for forward
> reference. The first RFC reserved is `RFC-0001 — Receipt schema stabilization`.

---

## What is an RFC

An RFC (Request for Comments) is a formal proposal for a substantive change to
WitSeal. RFCs document the change in detail, give the community time to comment,
and produce a written record of why a decision was made.

This is distinct from an [ADR](./adr/README.md):

| ADR (Architectural Decision Record) | RFC (Request for Comments) |
|---|---|
| Backward-looking — records a decision already made | Forward-looking — proposes a change to be decided |
| Single author writes; not commented on | Public comment period; multiple participants |
| Status: usually `accepted` immediately | Status: `draft` → `open for comment` → `final comment period` → `accepted`/`rejected`/`withdrawn` |
| Cannot be revised once accepted (immutable) | Can be revised by author during comment periods; can be withdrawn |
| Protects the record of past decisions | Coordinates a future change with the community |

In practice: **ADRs are how we explain why things are the way they are. RFCs are
how we change them.**

---

## When an RFC is required

An RFC is **required** for any change that affects:

- **Schemas** — `WitnessEvent`, `Receipt`, `Policy`, `Approval`, `ExecutionResult`,
  `EvidencePackage`, or any of their subfields. New required fields, removed
  fields, type changes, semantic changes.
- **Cryptographic primitives** — hash algorithm, canonicalization scheme,
  signing scheme, transparency log integration.
- **CLI surface** — new commands, removed commands, breaking changes to
  arguments or output format.
- **Policy DSL** — new match conditions, new decisions, new evaluation
  semantics, changes to default behavior (e.g., default deny).
- **Process** — changes to this RFC process, the ADR process, the contributor
  workflow, or the release / signing process.

An RFC is **not** required for:

- Bug fixes (open an issue + PR)
- Documentation improvements
- Refactoring without behavior change
- Test additions
- Performance improvements (unless they require API changes)
- New adapter packages (follow [`src/adapters/README.md`](../src/adapters/README.md))
- New reference policy packs (open a PR with examples)

When in doubt: **open an issue first** and ask whether an RFC is needed. We'd
rather have a quick "no, just submit a PR" than have you spend a week on an
RFC that wasn't needed, or write code that should have been an RFC.

---

## Stages

```
  ┌──────────┐    ┌──────────┐    ┌────────────────┐    ┌──────────────────┐
  │  Draft   │ →  │   Open   │ →  │  Final Comment │ →  │   Accepted /     │
  │  (PR)    │    │ for Comm.│    │  Period (1 wk) │    │   Rejected /     │
  └──────────┘    └──────────┘    └────────────────┘    │   Withdrawn      │
                                                        └──────────────────┘
```

### 1. Draft

Author opens a PR adding a file `docs/rfcs/NNNN-short-title.md`, where
`NNNN` is the next available number. Use `0000-template.md` as the starting
point. The PR title is `RFC: <short title>`.

The author may iterate on the draft within the PR. Reviewers comment to
help shape the proposal before it's "open for comment."

### 2. Open for comment

When the author considers the draft ready, they request transition by adding
a comment "Ready for comment period."

A maintainer transitions by:

1. Tagging the PR with the `rfc-open-for-comment` label
2. Setting the comment-period start date in a comment

The minimum comment period is **two calendar weeks**. Longer is fine; many
RFCs sit open for a month or more.

During this period:

- Anyone can comment on the PR
- The author responds to comments and revises the proposal
- The author maintains a running "Unresolved questions" section in the RFC

### 3. Final Comment Period (FCP)

When discussion has converged (or has stalled productively), a maintainer
proposes the FCP with a recommended disposition: **accept** or **reject**.

The FCP lasts **one week**. During this week:

- The disposition can still be changed if someone surfaces a new objection
- Late commenters are explicitly welcomed (the FCP exists to catch them)
- The proposal cannot be substantively revised — substantive changes reset
  back to "open for comment"

### 4. Accepted, Rejected, or Withdrawn

After the FCP:

- **Accepted** — the maintainer merges the PR. The RFC file lives in
  `docs/rfcs/` permanently. The accepted RFC may now be implemented.
- **Rejected** — the PR is closed with a final comment explaining the
  reasoning. The author may re-open a revised RFC after substantive change.
- **Withdrawn** — the author closes the PR. May be re-opened later.

After acceptance, **implementation is a separate PR or set of PRs**.
RFC acceptance does not require implementation by the author — the community
can pick up implementation. The RFC file remains the source of truth for
intended behavior.

---

## Authorship and decision authority

**Anyone with a GitHub account can author an RFC.** Maintainers are not
gatekeepers of the proposal stage; we welcome proposals from anyone.

**Decision authority for accept/reject** sits with the founder during Phase 1.
This will expand to a maintainer team in Phase 3+. The expansion will itself
be done via RFC.

---

## What makes a good RFC

The bar is "would another maintainer be able to implement this in 6 months
based on this document alone?" This means:

- **Concrete examples.** Schemas with sample JSON. Code with sample invocations.
  CLI with sample sessions including expected output.
- **Migration path.** If breaking, what is the deprecation timeline? What is
  the version cut-over?
- **Drawbacks.** Every change has tradeoffs. Don't pretend yours doesn't.
- **Alternatives.** What did you consider and reject? Why?
- **Scope clarity.** What is not part of this RFC?

A good test: print your RFC, hand it to someone unfamiliar with the project,
and ask "what would change in WitSeal if this is accepted?" If they can answer
in two minutes, the RFC is well-scoped.

---

## Numbering

RFCs are numbered sequentially, never reused. Numbering starts at `0001`.
`0000-template.md` is reserved permanently and is not an RFC.

If a PR for `RFC-0042` is rejected or withdrawn, that number is **retired**.
The next RFC opens as `0043`.

---

## Index

See [`docs/rfcs/README.md`](./rfcs/README.md) for the index of RFCs.

---

## Pre-launch state (Phase 1, weeks 0-7)

The RFC process is documented and infrastructure is in place. **Active RFCs
will not be opened until week 7-10**, when the first design partners are
expected. The first reserved RFC is:

- `RFC-0001 — Receipt schema stabilization` — see [stub](./rfcs/0001-receipt-schema-stabilization.md)

If you have an idea that you believe needs an RFC before week 7, **open an
issue first** to discuss whether to advance the timeline.
