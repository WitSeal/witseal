# Coverage — Witnessed execution for Antigravity

**Scope: Tool-Scoped Coverage via MCP — the WitSeal `shell` tool only.**

Antigravity is a closed, Google-managed host whose local surface (Desktop / IDE /
CLI) accepts custom stdio MCP servers. This adapter registers the shipped
`witseal-mcp` server there and exposes one WitSeal-owned tool: `shell`. When the
agent calls that tool, WitSeal own-executes the command through its mediation core
(`mediateMcpShell` → `runExec`: classify → policy → mediate → witness → receipt),
so each such call is a real, independently verifiable witnessed execution. It
reuses the existing execution-result / witness schema (no new wire-format); the
golden receipt is untouched and no new code ships for this host.

## What is and is not witnessed

WitSeal witnesses the **calls routed through its own `shell` tool** — and nothing
else. This is the honest ceiling of the Tool-Scoped tier: the witness boundary is
the WitSeal MCP tool, not the host, not the model, and not Antigravity's
Google-managed execution engine.

In scope (witnessed):

- Every command the agent runs by calling the WitSeal `shell` tool. The tool body
  is the execution path, so the bytes that run are the bytes WitSeal mediates, and
  each call yields a full execution receipt (`allowed_executed`, or
  `denied_by_policy` when a Gate denial blocks it).

Out of scope (NOT witnessed):

- **Antigravity's host-native execution.** Google-managed execution — anything
  the agent runs through the host's own built-in tools rather than the WitSeal
  `shell` tool — is not seen, proxied, or recorded by WitSeal. This is **not** a
  claim over all host traffic.
- Host internals, the model/LLM, prompt handling, the editor/host process, and
  agent control flow.
- Calls the agent makes to **other** MCP servers. This server governs only its own
  `shell` tool; it is not a proxy for arbitrary MCP traffic.
- Side effects a witnessed command itself spawns out of band (e.g. a daemon it
  launches).

## How to use the coverage you have

Tool-Scoped means the host still chooses what to run, so you direct evidence by
choosing the tool:

- Route the shell actions you want witnessed through the WitSeal `shell` tool.
  Those produce verifiable receipts.
- Treat host-native execution as unattested: it runs outside the witness
  boundary by design on a closed host.
- Run in `gate` mode (deny-by-default) for enforcement on the witnessed tool, or
  `witness` mode for observe-only attestation.

## Registration status — honest

- **Documentation-level integration.** No host-specific code ships; the adapter
  is a recipe that registers the unchanged `witseal-mcp` server on Antigravity's
  local MCP surface. The execution core is the same `mediateMcpShell` path the
  shipped MCP adapter uses.
- **Full agent-loop NOT run here.** Driving Antigravity's own agent to *emit* the
  `shell` tool call would require the closed Antigravity client and an LLM key; it
  was not exercised in this build. The execution path — the code that runs when
  the `shell` tool is invoked — was live-verified directly (below), which is the
  baseline this tier claims.

## Live verification receipt (this build)

The **execution path** was exercised by invoking the witseal-mcp `shell` path
**directly** (no LLM, no agent loop) on a real command (`echo …`) under a
throwaway data dir with a single policy pack, mediated through `mediateMcpShell`
exactly as the MCP server's `tools/call` handler does. The run produced a full
execution receipt that `witseal verify` confirms **VALID**.

- Receipt id: `rcpt_mq5w90uznjqKUDgkcP6jU7`
- Outcome: `allowed_executed` (mode `gate`, risk `C3`)
- Verbatim `witseal verify`:

```
witseal: VALID ✓ (chain)
         segment: default
         events:  2
```

## Verdict

For the witnessed surface (commands sent to the WitSeal `shell` tool), coverage is
**Tool-Scoped via MCP** by fact: every command routed through the tool is
witnessed with a verifiable receipt, the tool never bypasses the boundary (the
command runs only via `runExec`), a Gate denial blocks and is recorded rather than
silently bypassed, and the live invocation produced a receipt that `witseal
verify` confirms **VALID**. The claim is scoped strictly to calls routed through
the WitSeal `shell` tool — it is **not** a claim over Antigravity's Google-managed
host-native execution, nor over host internals or the model. The golden receipt is
untouched and the CLI was used unchanged.
