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

**Same receipts. Different execution boundaries.** Witnessed Execution spans two
execution boundaries that produce the *same* independently-verifiable receipt;
they differ only in how much of the host's execution falls inside the witness
boundary — *Full Execution Coverage* (WitSeal owns the action end to end) and
*Tool-Scoped Coverage via MCP* (WitSeal witnesses the calls routed through its
own MCP tool). That boundary is detailed in *Multiple surfaces, one evidence
core* below.

### Witnessed Execution — Full Execution Coverage

**Who executes: WitSeal-mediated executor.** WitSeal runs the action itself
through `runExec`, so all three capabilities are reachable: Gate is the default
mode (deny-by-default), Witness Mode is available (`--mode witness`), and the
action's receipt is independently verifiable.

| Integration | Gate | Witness | Witnessed Execution | WitSeal adapter |
|---|:---:|:---:|:---:|---|
| WitSeal MCP | ✅ | ✅ | ✅ | shipped |
| OpenCode | ✅ | ✅ | ✅ | shipped |
| LangGraph | ✅ | ✅ | ✅ | shipped |
| OpenAI Agents SDK | ✅ | ✅ | ✅ | shipped |
| Temporal | ✅ | ✅ | ✅ | shipped |
| OpenHands | ✅ | ✅ | ✅ | available¹ |

¹ OpenHands reaches Full Execution Coverage of its **default witnessed toolset**
(terminal + file editing) by swapping the agent's tool executors to route through
`witseal exec` / `witseal exec-file` and restricting the granted toolset to
witnessed tools via `build_witnessed_toolset`. `browser` and `task_tracker` are
excluded from the granted set; `file_editor` undo and `apply_patch` DELETE/MOVE
are refused (not silently bypassed). The adapter is Python source under
`src/adapters/openhands/` (see its `COVERAGE.md`); it is not shipped in the npm
package. A configuration that grants unwitnessed tools (browser/task_tracker) is
not Full.

### Witnessed Execution — Tool-Scoped Coverage via MCP

**Who executes: the host agent/runtime.** Witnessed execution via the WitSeal MCP
tool. Receipts are generated for operations executed through the WitSeal MCP
tool; host-native execution remains outside the witness boundary. These hosts
call the WitSeal `shell` tool alongside their own built-in execution — the
WitSeal tool is witnessed; the host's native executor is not.

| Integration | Witnessed Execution (via the WitSeal MCP tool) | WitSeal adapter |
|---|:---:|---|
| OpenClaw | ✅ | available |
| Hermes | ✅ | available |

### Witness

WitSeal records the result the **host** reports after the action ran: the host
runs the action with its own executor, so Witnessed Execution is not reachable.
Witness is reached by observing the host's reported result (e.g. Claude Code's
`PostToolUse` hook).

| Integration | Gate | Witness | WitSeal adapter |
|---|:---:|:---:|---|
| Claude Code | ✅ opt-in¹ | ✅ | Witness shipped |
| Cursor | ✅ opt-in¹ | ✅ | Witness shipped |
| Codex | ✅ opt-in¹ | ✅ | planned |

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

## Multiple surfaces, one evidence core

WitSeal exposes more than one integration surface over a single evidence core:
every surface runs through `runExec` and produces the same witness event →
receipt → hash chain. The proof model is identical across surfaces; only the
connection surface differs.

- **Use the WitSeal MCP server** for MCP-hosted workflows — configure the
  `witseal` MCP server in the host; no application code changes.
- **Use the direct factories** for code-native frameworks — import the WitSeal
  factory and register the tool or activity in your own code (LangGraph, OpenAI
  Agents SDK, Temporal, and the generic framework shim).

### What each surface witnesses

A surface witnesses only what it actually runs — nothing more:

- The **WitSeal MCP server** witnesses only calls to its own `shell` tool. It is
  not a proxy for all MCP traffic: calls the agent makes to *other* MCP servers
  are not witnessed. This shipped adapter is an *integration surface* — WitSeal's
  own tool exposed over MCP — not the *MCP runtime layer* in
  [`ARCHITECTURE.md`](./ARCHITECTURE.md) (native mediation of arbitrary MCP
  traffic), which is Phase 4 and not built.
- The **direct factories** witness only the tools you wrap with the WitSeal
  factory and register in your code. Other, unwrapped tools in the same graph or
  agent are not witnessed.
- The **observe-level adapters** (e.g. the Claude Code `PostToolUse` hook)
  witness the result the host reports; they do not own execution and do not
  block.

### One logical action → one witness path → one receipt

Route each logical action through exactly one witness path. Do not stack an
observe-level path and an own-execute path over the same physical action: there
is no de-duplication by command string, so the action would be recorded twice.

- For Temporal, do not wrap an authored Level-3 `witnessedShell` Activity with
  the Level-2 `ActivityInboundCallsInterceptor` — the same action is recorded by
  both.
- If an agent has both an MCP path and a direct tool configured for the shell,
  send a given logical action through one of them, not both.

## Availability today

- **Shipped (own-execute, Full Execution Coverage):** WitSeal MCP, OpenCode,
  LangGraph, OpenAI Agents SDK, Temporal.
- **Available (own-execute, Full Execution Coverage of the witnessed toolset):**
  OpenHands — executor swap; `browser`/`task_tracker` excluded, delete/rename
  refused (see the OpenHands footnote above).
- **Available (Tool-Scoped Coverage via MCP, via the WitSeal MCP tool):**
  OpenClaw, Hermes.
- **Shipped (Witness):** Claude Code (`PostToolUse`), Cursor.
- **Planned (Witness-level, sealed hosts):** Codex.

See each integration's directory under `src/adapters/` for setup.
