# Coverage — Witnessed execution for Replit Agent

**Scope: Tool-Scoped via MCP. WitSeal witnesses only the calls routed to its own
`shell` tool; Replit's cloud executor is not witnessed.**

Replit Agent is a closed host that runs its own tools with its own cloud
executor and does not let an integration replace that executor. WitSeal cannot
own the host's execution here, so this is **not** Full Execution Coverage. What
WitSeal owns is its own tool: the agent registers the WitSeal `shell` tool (the
shipped `witseal-mcp` server, fronted by a remote HTTPS endpoint), and every call
the agent sends to *that* tool routes through WitSeal's mediation core
(`mediateMcpShell` → `runExec`: classify → policy → mediate → witness → receipt),
producing a full execution receipt. It reuses the existing execution-result /
witness schema (no new wire-format); the golden receipt is untouched.

## What is and is not witnessed

WitSeal witnesses the **calls routed to the `shell` tool it owns and executes**.
The witness boundary is that tool, not the host, not the model, and not Replit's
cloud executor.

In scope (witnessed):

- Every command the agent runs by calling the WitSeal `shell` tool. The tool
  body is the execution path, so the bytes that run are the bytes WitSeal
  mediates, and each call yields a full execution receipt (`allowed_executed`, or
  `denied_by_policy` when a Gate denial blocks it).

Out of scope (NOT witnessed):

- **Replit's own cloud execution.** The Agent's built-in shell, file edits,
  package installs, and any command it runs through its native executor never
  reach WitSeal. They are outside the witness boundary entirely. This is **not** a
  claim over Replit host execution.
- Replit host internals, the model/LLM, prompt handling, and agent control flow.
- Side effects a witnessed command itself spawns out of band (e.g. a daemon it
  launches).

## How to read the Tool-Scoped boundary honestly

- The honest claim is "use WitSeal's witnessed `shell` tool from Replit Agent",
  **not** "WitSeal sees everything Replit runs". A closed host keeps its own
  executor; the WitSeal tool sits alongside it.
- To maximize what is witnessed, route execution-bearing steps through the
  WitSeal `shell` tool rather than the Agent's built-in shell. There is no way to
  force a closed host to send every action through the tool, so coverage is
  scoped to the calls that actually go through it.
- Run in `gate` mode (deny-by-default) for enforcement on the witnessed tool, or
  `witness` mode for observe-only attestation.

## Deployment status — honest

- **Documented, not deployed.** Replit Agent's custom-MCP support is
  **remote-HTTPS only** (Streamable HTTP); the shipped `witseal-mcp` server
  speaks **stdio**. Registering it with Replit therefore requires a remote HTTPS
  endpoint in front of `witseal-mcp` (TLS-terminated, auth-token protected),
  hosted where your chain and policy packs live. `README.md` documents that
  deployment; this build does **not** stand up a public Replit-reachable endpoint
  and does not exercise a live Replit Agent session.
- **No end-to-end agent-loop run.** The full loop — a real Replit Agent emitting
  the tool call over a remote MCP connection — was not run (it needs a hosted
  endpoint plus the Replit Agent and an LLM key). What is proven is the
  **execution path** that such a call lands in.

## Live verification receipt (this build)

The **execution path** was exercised by driving the `witseal-mcp` `shell` path
**locally** (no LLM, no remote endpoint) on a real command under a throwaway
data directory with a single allow-rule policy pack — calling `mediateMcpShell`
exactly as the server's `tools/call` handler does. The run produced a full
execution receipt that `witseal verify` confirms **VALID**. The verbatim
`witseal verify` output and the receipt id are recorded with the build that
integrates this adapter.

## Verdict

For the witnessed surface (commands the agent sends to the WitSeal `shell`
tool), coverage is **Tool-Scoped via MCP** by fact: every command routed to that
tool is witnessed with a verifiable receipt, the tool never bypasses the boundary
(the command runs only via `runExec`), a Gate denial blocks and is recorded
rather than silently bypassed, and the live invocation of the `witseal-mcp`
`shell` path produced a receipt that `witseal verify` confirms **VALID**. The
claim is explicitly **not** over Replit's own cloud executor or host internals —
those stay outside the boundary. The remote HTTPS deployment that lets a real
Replit Agent reach the tool is documented, not deployed. The golden receipt is
untouched and the CLI was used unchanged.
