# Frequently Asked Questions

> WitSeal is in Phase 1 (pre-release). This FAQ covers common questions from
> the first wave of evaluators. For deeper material:
>
> - Architecture → [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md)
> - What we protect against (and don't) → [`docs/threat-model.md`](./threat-model.md)
> - Decisions and rationale → [`docs/adr/`](./adr/)
> - How we compare → [`docs/competitive-comparison.md`](./competitive-comparison.md)

---

## How is this different from Microsoft Agent Governance Toolkit?

Different layer. Microsoft AGT is a framework-agnostic agent governance toolkit
focused on policy and guardrails for agents written against LangChain, CrewAI,
LangGraph, and similar orchestration frameworks. It runs adjacent to the agent
orchestration layer.

WitSeal is a **runtime that mediates execution itself**. An agent (Claude Code,
Cursor, OpenCode, etc.) running through `witseal exec` cannot take an action
without WitSeal seeing, classifying, and recording it. The two products cover
different parts of the stack and pair naturally.

If you only run agents inside one of the orchestration frameworks AGT supports,
AGT may be sufficient. If you have agents that take shell or filesystem actions
outside any orchestration framework — most coding agents — WitSeal is the layer
designed for that.

## How does this relate to MCP?

MCP (Model Context Protocol) is a protocol for tool exposure to AI models.
Phase 1 WitSeal does not directly mediate MCP traffic; it mediates the
**actions** that result, regardless of how the agent decided to take them.

Phase 4 (target: 2027) introduces an MCP runtime layer that mediates tool
invocations directly. The decision to start Phase 4 is gated on MCP achieving
protocol stability across vendors — see the strategic roadmap.

If your concern is "I want to govern which MCP tools an agent can call,"
the current pattern is: write a policy pack matching the resulting actions.
For first-class MCP-aware policies, wait for Phase 4 or open an issue
requesting prioritization.

## Does WitSeal block prompt injection?

**No.** Prompt injection is a model-layer concern. WitSeal evaluates *what*
an action does, not *why* the model proposed it.

If a prompt-injected agent proposes `rm -rf /`, WitSeal will deny it (with
the right policy pack loaded). But WitSeal does not detect that the agent was
compromised — it just sees a destructive action and refuses.

Pair WitSeal with a model-layer defense (Pillar Security, Prompt Security,
Microsoft AGT for goal-hijack detection) for full coverage. They address
different threats; they compose.

## Can I use it in CI?

Yes. WitSeal in CI uses a different approval semantics:

- When `process.stderr.isTTY` is false, all `require-approval` actions
  default to **denied** (deny-by-default for unattended environments).
- To selectively allow certain rules in CI, set `WITSEAL_AUTO_APPROVE=<comma-separated-rule-ids>`.
- All such auto-approvals are recorded with `principal.type: "ci"`, distinguishable
  in audit from human approvals.

See [ADR-0004](./adr/0004-approval-prompt-ux.md) for the full design.

## What happens if WitSeal crashes during an agent's flow?

WitSeal is single-process per invocation. If WitSeal itself crashes,
the action does not proceed (the subprocess never spawns). The witness chain
is unaffected — no evidence record is written for an action that didn't run.

If the **subprocess** crashes after WitSeal spawned it, the witness event
records the exit signal/code. The chain advances normally.

If the host machine crashes mid-write, the JSONL log uses `O_APPEND` + `fsync`,
so the chain is consistent up to the last flushed event. On restart, the chain
head is recomputed from the log. See [ADR-0002](./adr/0002-event-log-format.md).

## Can someone with root access on my machine forge an evidence chain?

Phase 1: **yes.** The local user (or anything running as that user) can
recompute the entire chain consistently from genesis. Phase 1 protects
against tampering by *non-producers* (someone modifying an exported
evidence package), not by the producer.

Phase 5 introduces Sigstore Cosign signing + Rekor transparency log inclusion,
which makes a chain rewrite publicly visible and effectively detectable.
Until then, the producer is part of the trust assumption.

This is documented honestly in [`docs/threat-model.md`](./threat-model.md).
We do not claim Phase 1 protects against the local user.

## What does it cost?

Free under the Apache License 2.0. The CLI is and will remain open source.

A commercial layer is planned for Phase 6+ — likely a hosted remote witness
service that pairs with the CLI for cross-machine federation. The CLI will
continue to work standalone forever; commercial features are additive.

## When is v1.0?

Target: end of Phase 5, approximately Q1 2028.

Until v1.0, schemas and CLI surface are unstable. Minor versions may introduce
breaking changes; patch versions will not. CHANGELOG entries are explicit about
breaking changes.

If you need API stability before v1.0, become a design partner — your real
usage will inform the schema-stabilization RFC (the first formal RFC after
launch).

## What production deployments exist?

**None yet.** WitSeal is pre-release. We are recruiting 5 design partners
for Phase 1. If you'd like to pilot, see the
[design partner inquiry template](https://github.com/WitSeal/witseal/issues/new?template=design-partner.yml).

## Can I try it without an AI agent?

Yes. The 90-second [`hello-witness`](../examples/hello-witness/) walkthrough
uses `echo` and `rm -rf` — no AI agent involved. It demonstrates the core
flow: classify, evaluate policy, mediate, witness, hash-chain, replay,
verify, tamper-detect.

The actual integration with an AI coding agent is the same pipeline; the agent
just happens to be the source of intents.

---

## Didn't see your question?

Open a [GitHub Discussion](https://github.com/WitSeal/witseal/discussions).
Common questions get added to this FAQ.
