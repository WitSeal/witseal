# Architectural Decision Records

This directory contains the ADRs (Architectural Decision Records) for WitSeal.

An ADR documents a single architectural decision: the context, the decision, the consequences, and the alternatives considered. ADRs are immutable once accepted — superseding decisions are documented in new ADRs that reference the old one.

## Format

Every ADR follows the same structure:

1. **Status** — proposed | accepted | superseded by ADR-NNNN | deprecated
2. **Context** — the problem being decided, including constraints
3. **Decision** — what was decided, in concrete terms
4. **Consequences** — positive and negative outcomes, including known limitations
5. **Alternatives considered** — options rejected, with explicit rationale

## Index

| ID | Title | Status |
|---|---|---|
| [ADR-0001](./0001-hash-chain-construction.md) | Hash-chain construction | accepted |
| [ADR-0002](./0002-event-log-format.md) | Event log format | accepted |
| [ADR-0003](./0003-policy-pack-format.md) | Policy pack format | accepted |
| [ADR-0004](./0004-approval-prompt-ux.md) | Approval prompt UX | accepted |
| [ADR-0005](./0005-subprocess-capture.md) | Subprocess capture mechanism | accepted |
| [ADR-0006](./0006-concurrency-model.md) | Concurrency model | accepted |

## When to write a new ADR

Write an ADR when the decision:

- Affects more than one module
- Has more than one reasonable answer
- Will be hard to change later without breaking compatibility
- Will be questioned by a future contributor who lacks the context

Do not write an ADR for code-style choices, library version pins, or local refactors.

## When to supersede an ADR

If a new decision invalidates an old one, write a new ADR with status "accepted" that explicitly references the old one. Update the old ADR's status to "superseded by ADR-NNNN" and link forward. Never edit the original decision text — the historical record matters.
