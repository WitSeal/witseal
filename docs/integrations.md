# Integrations & capability matrix

WitSeal is execution evidence infrastructure. It records what an agent's actions
actually did, so they can be inspected and independently verified.

A given host or framework reaches one or more of three evidence capabilities.
The **category** an integration belongs to is set by the **highest** evidence
level it reaches — not by the full list of capabilities it happens to support.

## The three capabilities

| Capability | What WitSeal does | Source of trust |
|---|---|---|
| **Gate** | Decides *before* the action runs (deny-by-default) and blocks a denied action. The decision is recorded. | The constraint and its policy decision are recorded as evidence. |
| **Witness** | Records the result the **host** reports after the action ran. | The evidence is only as trustworthy as the host's report — WitSeal did not run the action itself. |
| **Witnessed Execution** | WitSeal **runs the action itself**, captures the output, and records a signed, hash-chained execution receipt. | **Independently verifiable** — anyone can check the receipt with `witseal verify` (VALID / INVALID), with no WitSeal account, no server, and **no trust in the host required**. |

The jump from Witness to Witnessed Execution is a jump in the *source of trust*:
Witness asks you to trust the host's account of what happened; Witnessed
Execution produces evidence that stands on its own.

**Gate is a capability, available and measured from launch.** It is documented
here from day one; it is simply not the headline of the public showcase, which
is organized by highest evidence level. Whether Gate is raised into the showcase
later is a data-driven decision.

## Capability matrix

Legend: ✅ capability reachable · ✅ opt-in capability reachable but not the
default · — not applicable. The **WitSeal adapter** column states what ships
today (capability ≠ a shipped turnkey adapter).

| Integration | Gate | Witness | Witnessed Execution | Highest level | WitSeal adapter |
|---|:---:|:---:|:---:|---|---|
| WitSeal MCP | ✅ | ✅ | ✅ | **Witnessed Execution** | shipped |
| OpenCode | ✅ | ✅ | ✅ | **Witnessed Execution** | shipped |
| LangGraph | ✅ | ✅ | ✅ | **Witnessed Execution** | shipped |
| OpenAI Agents SDK | ✅ | ✅ | ✅ | **Witnessed Execution** | shipped |
| Temporal | ✅ | ✅ | ✅ | **Witnessed Execution** | shipped |
| Claude Code | ✅ opt-in¹ | ✅ | — | **Witness** | Witness shipped |
| Cursor | ✅ opt-in¹ | ✅ | — | **Witness** | planned |
| Codex | ✅ opt-in¹ | ✅ | — | **Witness** | planned |

For the own-execute integrations (WitSeal MCP, OpenCode, LangGraph, OpenAI
Agents SDK, and Temporal), WitSeal runs the action through `runExec`, so all three capabilities
are reachable: Gate is the default mode (deny-by-default), Witness Mode is
available (`--mode witness`), and the action's receipt is independently
verifiable — Witnessed Execution.

For the sealed hosts (Claude Code, Cursor, Codex), WitSeal cannot own execution —
the host runs the action with its own executor. Witness is reached by observing
the host's reported result after the fact (e.g. Claude Code's `PostToolUse`
hook). Witnessed Execution is not reachable on a sealed host.

> ¹ **Gate on a sealed host** is reachable opt-in via a pre-execution hook
> (e.g. Claude Code's `PreToolUse`), where WitSeal's policy decides before the
> command runs. WitSeal's shipped Claude Code adapter is the Witness
> (`PostToolUse`) one; a turnkey gate adapter for sealed hosts is not yet
> shipped.

## Why integrate an own-execute path if a sealed host already gives Witness?

Because Witnessed Execution is a stronger record. In a sealed host you get
Witness today — each action's result is recorded as evidence, on the host's
word. Routing the action through an own-execute integration (OpenCode, a
framework tool, or WitSeal MCP) lets WitSeal run it and produce a
receipt that is **independently verifiable** — the next level of evidence, not
the observation you already had.

## Availability today

- **Shipped (own-execute, Witnessed Execution):** WitSeal MCP, OpenCode,
  LangGraph, OpenAI Agents SDK, Temporal.
- **Shipped (Witness):** Claude Code (`PostToolUse`).
- **Planned (Witness-level, sealed hosts):** Cursor, Codex.

See each integration's directory under `src/adapters/` for setup.
