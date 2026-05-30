# How WitSeal Compares

WitSeal is one of several products in the emerging "AI agent runtime" space. This page describes what WitSeal does that other products don't, and where other products are stronger.

This is intentionally short. For full technical detail, see [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md). For threats addressed and not addressed, see [`docs/threat-model.md`](./threat-model.md).

---

## Capability comparison

Five capabilities × six product categories. Cells are: **yes** / **partial** / **no**.

| | Witnessed actions | Hash-chained evidence | Replay from evidence | Local-first CLI | Provider-independent |
|---|---|---|---|---|---|
| Coding-agent runtimes (Claude Code, Cursor, OpenCode, Gemini CLI) | no | no | no | partial | no |
| Microsoft Agent Governance Toolkit | yes | no | no | yes | yes |
| Receipt-chain SDKs (e.g., Authensor) | yes | yes | no | partial | yes |
| SaaS agent governance (Zenity, Pillar Security) | yes | partial | no | no | yes |
| Identity gateways (Strata, Tetrate Agent Router) | partial | no | no | no | yes |
| **WitSeal** | **yes** | **yes** | **yes** | **yes** | **yes** |

### Capability definitions

- **Witnessed actions.** Actions are recorded as structured, append-only events as they happen — not after the fact via log scraping.
- **Hash-chained evidence.** Each evidence record cryptographically references the previous record. Tampering is detectable.
- **Replay from evidence.** Given the evidence chain alone, the action history can be deterministically reconstructed. Stronger than checkpointing.
- **Local-first CLI.** The product runs and produces value on a single developer machine without requiring a SaaS backend.
- **Provider-independent.** Does not depend on any single AI model provider for its core function.

---

## Where other products are stronger

WitSeal is honest about scope. Phase 1 (the current phase) explicitly does not cover several capabilities that other products do. This is by design — we're choosing depth over breadth.

**Microsoft Agent Governance Toolkit** ships with framework-agnostic adapters for LangChain, CrewAI, Google ADK, Haystack, LangGraph, and PydanticAI on day one. WitSeal Phase 1 covers OpenCode plus one stretch adapter. Breadth comes later (Phase 7).

**Zenity** and **Pillar Security** cover SaaS-native agents (Microsoft Copilot Studio, Salesforce Agentforce, ServiceNow). WitSeal does not, and probably never will — that's a different product category.

**Strata's AI Identity Gateway** mints task-scoped tokens for MCP servers. WitSeal does not have an identity layer. These are complementary; pair them.

**OpenAI Agents SDK** and **LangGraph** orchestrate multi-step agent workflows. WitSeal does not orchestrate — agents tell WitSeal what they want to do, and WitSeal mediates. The two layers stack.

---

## What this means for product choice

Three honest positioning statements:

**Against coding-agent runtimes.** WitSeal is not a coding agent. It is the runtime that any coding agent passes through to make its actions witnessed and verifiable. Use Claude Code, Cursor, or OpenCode to generate intent; use WitSeal to govern execution.

**Against agent governance products.** Most agent governance products operate above the developer's machine — in SaaS dashboards, identity gateways, or enterprise control planes. WitSeal operates *at* the developer's machine, where coding agents actually execute. The evidence chain starts there or it does not start at all.

**Against orchestration frameworks.** Orchestration frameworks decide what agents should *do next*. WitSeal proves what they *actually did*. Different layers, naturally complementary.

The canonical phrasing:

> Agents generate intentions. WitSeal governs execution.

---

## What WitSeal explicitly does not do

For honesty and to avoid wasted evaluation cycles:

- WitSeal does not detect prompt injection at the model layer. Pair with a model-layer defense (Pillar Security, Prompt Security, Microsoft AGT for goal-hijack detection).
- WitSeal does not authenticate agents or mint tokens. Pair with an identity gateway (Strata) if identity is required.
- WitSeal does not orchestrate multi-step agent flows. Use a framework (LangGraph, CrewAI, OpenAI Agents SDK) for that and pass each step through WitSeal.
- WitSeal does not currently produce third-party-attestable receipts. That's coming in a later phase via Sigstore + Rekor; until then, the chain is locally verifiable but producer-trusted.
- WitSeal does not run inside a sandbox or kernel-level mediator in Phase 1. Subprocess outputs are captured at the boundary; what a subprocess does internally is not directly observed. Kernel-level mediation is planned for a later phase on supported platforms (eBPF/ptrace).

These limitations are not weaknesses — they are honest scope boundaries. See [`docs/threat-model.md`](./threat-model.md) for the full picture of what Phase 1 protects against and what it doesn't.

---

## Where to start

The 90-second walkthrough at [`examples/hello-witness/`](../examples/hello-witness/) demonstrates a full flow: an allowed action, a denied action recorded as evidence, replay verification, and tamper detection. Twelve commands; fewer than two minutes from `npm install` to a verified evidence package.
