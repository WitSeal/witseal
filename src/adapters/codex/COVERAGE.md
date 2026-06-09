# Coverage — Witnessed execution for Codex CLI

**Scope: Tool-Scoped via MCP — witnessed coverage of the `witseal-mcp` `shell`
tool only.**

This integration ships no new code: it registers the shipped `witseal-mcp`
server with Codex CLI so the model can call WitSeal's `shell` tool. That tool's
body routes every command through WitSeal's mediation core (`mediateMcpShell` →
`runExec`: classify → policy → mediate → witness → receipt). When the agent
calls the `shell` tool, the command is a real, independently verifiable witnessed
execution. It reuses the existing execution-result / witness schema (no new
wire-format); the golden receipt is untouched.

This is the same honesty ceiling as the other MCP-routed hosts: the witness
boundary is the WitSeal-owned tool body, not Codex, not the model, and not the
host's own executor.

## What is and is not witnessed

In scope (witnessed):

- Every command the agent runs **through the `witseal-mcp` `shell` tool**. The
  tool body is the execution path for those calls, so the bytes that run are the
  bytes WitSeal mediates, and each call yields a full execution receipt
  (`allowed_executed`, or `denied_by_policy` when a Gate denial blocks it).

Out of scope (NOT witnessed):

- **Codex CLI's own built-in shell / exec path.** Codex ships a native command
  executor; commands the model runs through that path do **not** pass through
  WitSeal and are not witnessed. This is the defining limit of Tool-Scoped via
  MCP: the host keeps its own execution, and only the WitSeal-routed tool is
  covered.
- Codex host internals, the model/LLM, prompt handling, the terminal/host
  process, and agent control flow. This is **not** a claim over all host traffic.
- Calls the agent makes to **other** MCP servers. The `witseal-mcp` server
  governs only its own `shell` tool; it does not proxy or record another
  server's tool traffic.
- Side effects the command itself spawns out of band (e.g. a daemon it launches).

## How to keep coverage tool-scoped-complete

Tool-Scoped via MCP covers only what is routed through the WitSeal tool, so to
make the witnessed `shell` tool the agent's actual execution path:

- Register `witseal-mcp` (`codex mcp add witseal -- witseal-mcp`) and confirm it
  with `codex mcp list` / `codex mcp get witseal`.
- Direct shell work to the WitSeal `shell` tool. Codex's built-in execution
  remains available and is unwitnessed; restrict or avoid it where the
  deployment requires every command to be witnessed.
- Run in `gate` mode (deny-by-default) for enforcement, or `witness` mode for
  observe-only attestation.
- Add a policy pack under `<WITSEAL_DATA_DIR>/policy-packs/`; in Gate mode with
  no pack, WitSeal fails closed and denies every routed command.

## Registration status — honest

- **Source-confirmed (registration surface).** Codex CLI natively hosts stdio
  MCP servers via an `[mcp_servers.<name>]` entry in `~/.codex/config.toml`,
  addable with `codex mcp add <name> -- <command>`. Registering `witseal-mcp`
  this way places WitSeal's `shell` tool in the toolset the model is offered.
- **Execution path live-verified (this build).** The `witseal-mcp` `shell` path
  was exercised directly (see below) and produced a receipt that `witseal
  verify` confirms **VALID**.
- **Full agent loop not run here.** This build did not run a live Codex session
  with an LLM key emitting the tool call; the model-emits-the-call step is
  documented, not executed. The independently verifiable property rests on the
  execution path, which is verified.

## Live verification receipt (this build)

The **execution path** was exercised by driving the `witseal-mcp` `shell` path
**directly** (no LLM, no Codex process) on a real command under a throwaway data
directory with a single allow-rule policy pack — calling `mediateMcpShell`
exactly as the `witseal-mcp` server's `tools/call` handler does. The run produced
a full execution receipt (`outcome=allowed_executed`, `decision=allow`, exit `0`,
`agent_id=codex`) that `witseal verify` confirms **VALID**. The verbatim `witseal
verify` output and the receipt id are recorded with the build that integrates
this adapter.

## Verdict

For the witnessed execution surface (commands the agent sends to the
`witseal-mcp` `shell` tool), coverage is **tool-scoped-complete** by fact: every
command routed through the tool is witnessed with a verifiable receipt, the tool
never bypasses the boundary (the command runs only via `runExec`), a Gate denial
blocks and is recorded rather than silently bypassed, and the live invocation
produced a receipt that `witseal verify` confirms **VALID**. The claim is scoped
to calls routed through the WitSeal MCP `shell` tool — it is **not** a claim over
Codex CLI's own built-in execution, over other MCP servers, nor over Codex host
internals. The golden receipt is untouched and the shipped `witseal-mcp` server
was used unchanged.
