# RFC-0001: Receipt schema stabilization

- **Status:** reserved (target: Phase 1 week 7-10)
- **Type:** schema
- **Author:** TBD
- **Created:** TBD
- **Implementation:** N/A (RFC not yet authored)

---

## Reservation

This number is reserved for the Phase 1 RFC stabilizing the receipt schema
ahead of v0.2. The full RFC will be authored once active design partners
exist (target: 2026-07).

## Why this is reserved

The receipt schema (`ExecutionReceipt` per
[`schemas/receipt.schema.ts`](../../schemas/receipt.schema.ts)) is currently
at version `witseal.receipt.v0.1`. By the end of Phase 1, real-world usage
will surface fields that need to be added, renamed, or constrained
differently.

Reserving this number now serves two purposes:

1. Signals to contributors that schema-stabilization work is the first
   formal RFC, so parallel proposals don't compete for the slot.
2. Locks in the scope: this RFC is **only** about receipt schema. Adjacent
   schemas (witness event, policy, evidence package) will get separate RFCs
   if they need stabilization.

## Out of scope for this RFC

To be confirmed when authored, but the intent is to exclude:

- Cryptographic primitive changes (separate RFC)
- CLI surface changes (separate RFC)
- New action types (separate RFC)
- Cross-schema federation semantics (Phase 6 work)

## When this opens for comment

Triggers for advancing this from "reserved" to "draft":

- ≥3 active design partners producing receipts in real workflows
- ≥1000 receipts/week aggregate
- At least one identified incompatibility between current schema and a
  real use case

If these triggers are met before week 7, the RFC may open earlier.
If they are not met by week 10, schema stabilization is deferred to Phase 2.

## How to provide input before this opens

If you have feedback on the current receipt schema based on actual usage,
open an issue with the label `schema-feedback`. Comments there will be
incorporated into this RFC when authored.
