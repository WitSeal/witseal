# Witnessed execution for Replit Agent

Integrates WitSeal with [Replit](https://replit.com)'s Agent by exposing
WitSeal's witnessed `shell` tool as a **custom MCP server**, so commands the
agent sends to that tool pass through the WitSeal pipeline (classify → policy →
mediate → witness → receipt) before they run.

## Model (Tool-Scoped via MCP — WitSeal owns only its own tool)

Replit Agent is a **closed host**: it runs its own tools with its own cloud
executor and does not let an integration replace that executor. What it *does*
allow is registering an **external MCP server** as an extra tool source. WitSeal
plugs in there: the agent calls WitSeal's `shell` tool, WitSeal own-executes the
command through `runExec`, and the call yields a **full execution receipt** — not
merely a witnessed decision. Commands the agent runs through Replit's own
built-in execution are **not** witnessed; only the calls routed to the WitSeal
`shell` tool are. This is the *Tool-Scoped via MCP* boundary — see `COVERAGE.md`.

The single tool exposed is `shell` (from the shipped `witseal-mcp` server): a
freeform shell command, translated faithfully as `/bin/sh -c "<command>"`. A
freeform shell command is opaque to structural classification, so the
shell-bypass rules correctly elevate its risk; policy can still allow it. This is
a thin integration surface: it reuses the unchanged execution-result / witness
schema (no new wire-format) and the golden receipt is untouched.

## Transport: Replit needs a remote HTTPS endpoint

The shipped `witseal-mcp` binary speaks MCP over **stdio** (a local subprocess).
Replit Agent's custom-MCP support is **remote-only**: it connects to an MCP
server over **HTTPS** (Streamable HTTP), not to a local stdio process. So the
stdio `witseal-mcp` server cannot be registered with Replit directly — it must be
reachable as a **remote HTTPS MCP endpoint**.

To bridge stdio → remote HTTPS you run `witseal-mcp` behind a small HTTPS MCP
front that speaks Streamable HTTP to Replit and forwards to the local stdio
server. Host it where your evidence chain and policy packs live (your own
infrastructure or a managed box), terminate TLS, and require an auth token. That
remote front is a deployment step, documented here; it is **not** shipped in the
npm package, and this adapter does not deploy it for you.

> Run the WitSeal data directory (chain, policy packs, receipts) on the host that
> backs the remote endpoint — that host is where execution and witnessing happen.
> Replit's cloud only sends the tool call over HTTPS; it never sees your chain.

## Install

1. `npm install -g @witseal/cli` on the host that will back the remote endpoint.
2. Stand up a **remote HTTPS MCP endpoint** in front of `witseal-mcp`
   (Streamable HTTP transport, TLS terminated, auth-token protected). Point its
   environment at your WitSeal data directory and choose the mode:

   | Variable | Meaning | Default |
   |---|---|---|
   | `WITSEAL_DATA_DIR` | Data directory (chain, policy packs, receipts) | `~/.witseal` |
   | `WITSEAL_SEGMENT` | Chain segment id | `default` |
   | `WITSEAL_MODE` | `gate` (deny-by-default) or `witness` (record, do not enforce) | `gate` |
   | `WITSEAL_AGENT_ID` | Agent identifier recorded in the witness event | `mcp-client` |

3. Register that endpoint with Replit Agent as a custom MCP server. Replit reads
   MCP server entries from a workspace config; give it the **remote HTTPS URL**
   and the auth header, e.g.:

   ```json
   {
     "mcpServers": {
       "witseal": {
         "url": "https://mcp.your-domain.example/witseal",
         "headers": {
           "Authorization": "Bearer ${WITSEAL_MCP_TOKEN}"
         }
       }
     }
   }
   ```

   Set `WITSEAL_MCP_TOKEN` as a Replit secret so the token is not committed. The
   `shell` tool then appears in the agent's tool list; calls to it are witnessed.
4. Add at least one policy pack under `<WITSEAL_DATA_DIR>/policy-packs/` on the
   endpoint host. With no policy pack, Gate mode fails closed (deny-by-default)
   and every command is denied — see the quickstart pack in
   `examples/policy-packs/`.

## The `shell` tool

| Field | Type | Notes |
|---|---|---|
| `command` | string (required) | The shell command to run. Run as `/bin/sh -c "<command>"`. |
| `cwd` | string (optional) | Working directory. Defaults to the server's working directory. |

The tool result is a text summary plus the command's captured output. A policy
denial — or a non-zero exit — is returned as an error result so the agent sees
the command did not succeed. The full captured output and the recorded evidence
are always available via `witseal receipt show`.

## Notes

- **Never bypasses WitSeal**: the command runs only via `runExec`. A Gate denial
  blocks execution (exit `100`) and is recorded as `denied_by_policy` — never
  silently caught and retried.
- **Tool-Scoped, not host-wide.** Only calls the agent routes to the WitSeal
  `shell` tool are witnessed. Replit's own cloud executor — the Agent's built-in
  file edits, package installs, and shell — stays outside the witness boundary.
  See `COVERAGE.md` for the exact scope and how to read it honestly.
- Run in `gate` mode (deny-by-default) for enforcement, or `witness` mode for
  observe-only attestation.
