# MCP server (`witseal-mcp`)

Exposes WitSeal's witnessed execution as a [Model Context
Protocol](https://modelcontextprotocol.io) server, so **any MCP client** —
Claude Desktop, Claude Code, Cursor, and others — can run shell commands that
pass through the WitSeal pipeline (classify → policy → mediate → witness →
receipt) before they run.

This is the host-independent integration: instead of one adapter per agent, an
MCP client points at `witseal-mcp` and gets witnessed execution from whatever
model it drives.

## Model (Level 3 — WitSeal owns execution)

The server exposes a single tool, `shell`. When the model calls it, WitSeal
own-executes the command through `runExec` inside its mediator, captures the
output, and records a **full execution receipt** — not merely a witnessed
decision. A command denied by policy does not run and is recorded as
`denied_by_policy`.

`mediateMcpShell` (in `mediate.ts`) is the framework-agnostic core; `server.ts`
is the protocol surface (newline-delimited JSON-RPC 2.0 over stdio, per the MCP
specification). The server has no protocol-SDK dependency — the surface WitSeal
needs (`initialize`, `tools/list`, `tools/call`, `ping`) is small and stable,
and a minimal dependency set keeps the trust runtime easy to inspect.

### Scope (what this is and is not)

- **Is:** a way to use WitSeal's own witnessed `shell` tool from any MCP
  client. Every call is mediated and recorded.
- **Is not:** interception of the calls an agent makes to *other* MCP servers.
  This server does not see, proxy, or record another server's tool traffic —
  it only governs its own `shell` tool. First-class mediation of arbitrary MCP
  tool calls is a separate, later runtime layer (see `docs/FAQ.md`).

## Install

1. `npm install -g @witseal/cli`
2. Register the server with your MCP client. The exact file differs per client;
   the server entry is the same. Example (Claude Desktop
   `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "witseal": {
      "command": "witseal-mcp",
      "env": {
        "WITSEAL_DATA_DIR": "/home/you/.witseal",
        "WITSEAL_MODE": "gate"
      }
    }
  }
}
```

3. Add at least one policy pack under `<WITSEAL_DATA_DIR>/policy-packs/`. With no
   policy pack, Gate mode fails closed (deny-by-default) and every command is
   denied — see the quickstart pack in `examples/policy-packs/`.

## Configuration (environment only)

The server takes no flags; MCP clients set environment in the server config:

| Variable | Meaning | Default |
|---|---|---|
| `WITSEAL_DATA_DIR` | Data directory (chain, policy packs, receipts) | `~/.witseal` |
| `WITSEAL_SEGMENT` | Chain segment id | `default` |
| `WITSEAL_MODE` | `gate` (deny-by-default) or `witness` (record, do not enforce) | `gate` |
| `WITSEAL_AGENT_ID` | Agent identifier recorded in the witness event | `mcp-client` |

## The `shell` tool

| Field | Type | Notes |
|---|---|---|
| `command` | string (required) | The shell command to run. Run as `/bin/sh -c "<command>"`. |
| `cwd` | string (optional) | Working directory. Defaults to the server's working directory. |

The tool result is a text summary plus the command's captured output. A policy
denial — or a non-zero exit — is returned as an error result so the model sees
the command did not succeed. The full captured output (head + tail) and the
recorded evidence are always available via `witseal receipt show`.

## Notes

- **Never bypasses WitSeal**: the command runs only via `runExec`. A Gate
  denial blocks execution and is recorded as `denied_by_policy`.
- **stdout is the protocol channel.** The server writes only JSON-RPC to
  stdout; mediated command output is captured and returned in the tool result,
  never written to the channel. Diagnostics go to stderr.
- A freeform shell command is opaque to structural classification, so the
  shell-bypass rules correctly elevate its risk; policy can still allow it.
