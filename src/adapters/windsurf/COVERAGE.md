# Coverage — Witnessed execution for Windsurf

**Scope: Tool-Scoped via MCP — only calls routed through the WitSeal `shell`
tool are witnessed; Windsurf Cascade's host-native execution is not.**

Windsurf (Codeium / Cognition) is a closed host. Its Cascade agent is a Model
Context Protocol client that reads MCP servers from `mcp_config.json`. This
adapter registers the shipped `witseal-mcp` server there. WitSeal does not own,
replace, or intercept Cascade's built-in executor; it adds its **own** witnessed
`shell` tool over MCP. When Cascade calls that tool, the command is own-executed
through WitSeal's mediation core (`mediateMcpShell` -> `runExec`: classify ->
policy -> mediate -> witness -> receipt) and recorded as a full execution
receipt. It reuses the existing execution-result / witness schema (no new
wire-format); the golden receipt is untouched.

## What is and is not witnessed

WitSeal witnesses the **`shell` tool it owns and executes** over MCP
(own-execute). The witness boundary is that tool body — not Cascade, not the
Windsurf host, not the model.

In scope (witnessed):

- Every command Cascade runs **through the WitSeal `shell` tool**. The tool body
  is the execution path, so the bytes that run are the bytes WitSeal mediates,
  and each call yields a full execution receipt (`allowed_executed`, or
  `denied_by_policy` when a Gate denial blocks it).

Out of scope (NOT witnessed):

- **Cascade's host-native execution** — its built-in run / terminal action, file
  edits, and any command it runs with its own executor instead of the WitSeal
  tool. This is a closed host: that path has no integration seam and is not
  witnessed. This is the central limit of the Tool-Scoped via MCP tier.
- Windsurf host internals, the model / LLM, prompt handling, and the editor
  process. This is **not** a claim over all host traffic.
- Calls Cascade makes to **other** MCP servers. The `witseal-mcp` server governs
  only its own `shell` tool; it does not proxy or record another server's tool
  traffic.
- Side effects the command itself spawns out of band (e.g. a daemon it launches).

## How to keep coverage meaningful

The WitSeal tool covers only what is routed to it, so compose the workflow so it
**is** the execution path for what you want witnessed:

- Register `witseal-mcp` in `mcp_config.json` and confirm the `witseal` server
  lists its `shell` tool in the Cascade panel.
- Direct execution-bearing steps at the WitSeal `shell` tool when you want a
  verifiable receipt, rather than the host's built-in run action.
- Run in `gate` mode (deny-by-default) for enforcement, or `witness` mode for
  observe-only attestation.
- Send a given logical action through one path only — the WitSeal tool or the
  host executor, never both (there is no de-duplication by command string).

## MCP-client status — honest

- **Source-confirmed.** Windsurf's Cascade is an MCP client configured via
  `mcp_config.json`; an MCP server registered there is offered to Cascade as a
  callable tool. The shipped `witseal-mcp` server is host-independent and the
  same one used by other MCP clients, so registering it under `mcpServers`
  exposes its `shell` tool to Cascade with no Windsurf-specific code.
- **The full agent loop was not exercised here.** Driving Cascade itself to emit
  the tool call needs the Windsurf host plus a model key; that end-to-end host
  run was not performed for this build. What was live-verified is the
  **execution path** of the tool Cascade would call — the shipped `witseal-mcp`
  `shell` server, driven over its real JSON-RPC stdio transport.

## Live verification receipt (this build)

The **execution path** was exercised by driving the shipped `witseal-mcp` server
over its real stdio JSON-RPC transport (the exact transport a Windsurf MCP server
entry uses): an `initialize` handshake, then a `tools/call` for the `shell` tool
on a real command, under a throwaway data dir with a single allow-rule policy
pack in `gate` mode — the same `mediateMcpShell` -> `runExec` core the server
runs in production. The call own-executed the command and produced a full
execution receipt that `witseal verify` confirms **VALID**. The verbatim
`witseal verify` output and the receipt id are recorded with the build that
integrates this adapter.

## Verdict

For the witnessed execution surface (commands Cascade routes through the WitSeal
`shell` tool over MCP), coverage is **Tool-Scoped via MCP** by fact: every
command sent to that tool is own-executed and witnessed with a verifiable
receipt, the tool never bypasses the boundary (the command runs only via
`runExec`), a Gate denial blocks and is recorded rather than silently bypassed,
and the live invocation of the shipped server produced a receipt that `witseal
verify` confirms **VALID**. The claim is explicitly scoped to calls routed
through the WitSeal `shell` tool — it is **not** a claim over Cascade's
host-native execution, over other MCP servers, or over Windsurf host internals.
The golden receipt is untouched and the CLI was used unchanged.
