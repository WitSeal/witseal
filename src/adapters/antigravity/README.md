# Witnessed execution for Antigravity

Integrates WitSeal with [Antigravity](https://antigravity.google) — Google's
agentic development surface — by registering the **WitSeal MCP server**
(`witseal-mcp`) as a custom tool the agent can call. Antigravity is a closed,
Google-managed host: its own execution engine is not open to replacement, so
WitSeal cannot own the host's native actions here. What it can do is expose its
**own** witnessed `shell` tool over the [Model Context
Protocol](https://modelcontextprotocol.io), which Antigravity's local surface
(its Desktop / IDE / CLI) accepts as a custom stdio MCP server. Every command the
agent routes through that tool passes the WitSeal pipeline (classify → policy →
mediate → witness → receipt) and yields an independently verifiable execution
receipt.

## Model (Tool-Scoped Coverage via MCP)

This is the **Tool-Scoped** tier: the host agent/runtime is still the one
deciding *which* actions to run, and Google-managed (host-native) execution stays
outside the witness boundary. WitSeal witnesses exactly the calls the agent makes
to the WitSeal `shell` tool — and for those, WitSeal **own-executes** the command
through `runExec` (the `mediateMcpShell` core in the shipped MCP server), captures
the output, and records a **full execution receipt**, not merely a witnessed
decision. A command denied by policy does not run and is recorded as
`denied_by_policy`.

No new code ships for Antigravity: it reuses the unchanged `witseal-mcp` binary
and the existing execution-result / witness schema (no new wire-format). The
adapter is a registration recipe plus its honest coverage statement.

### Scope (what this is and is not)

- **Is:** a way to use WitSeal's own witnessed `shell` tool from inside
  Antigravity. Each call to that tool is mediated and recorded as a verifiable
  receipt.
- **Is not:** witnessing of Antigravity's own built-in execution. Commands the
  agent runs through Google-managed, host-native execution are **not** seen,
  proxied, or recorded by WitSeal. This server governs only its own `shell`
  tool — it is not a proxy for all of the host's tool traffic, and not the
  broader MCP-runtime mediation layer (a separate, later capability).

## Install

1. `npm install -g @witseal/cli` (provides the `witseal-mcp` binary).
2. Register `witseal-mcp` as a custom MCP server on Antigravity's local surface.
   Antigravity accepts custom stdio MCP servers; add an entry to its MCP server
   configuration. The server is launched as a subprocess and speaks
   newline-delimited JSON-RPC over stdin/stdout:

```json
{
  "mcpServers": {
    "witseal": {
      "command": "witseal-mcp",
      "env": {
        "WITSEAL_DATA_DIR": "/home/you/.witseal",
        "WITSEAL_MODE": "gate",
        "WITSEAL_AGENT_ID": "antigravity"
      }
    }
  }
}
```

3. Add at least one policy pack under `<WITSEAL_DATA_DIR>/policy-packs/`. In Gate
   mode (default) WitSeal fails closed when no policy pack is loaded — every
   command is denied. See the quickstart pack in `examples/policy-packs/`.
4. In Antigravity, prefer the WitSeal `shell` tool for shell actions you want
   witnessed. Only the calls routed through it are covered (see COVERAGE.md).

## Configuration (environment only)

The server takes no flags; the MCP server config sets environment:

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
denial — or a non-zero exit — is returned as an error result so the agent sees
the command did not succeed. The full captured output (head + tail) and the
recorded evidence are always available via `witseal receipt show`.

## Notes

- **Never bypasses WitSeal**: a command sent to the `shell` tool runs only via
  `runExec`. A Gate denial blocks execution and is recorded as
  `denied_by_policy`.
- **stdout is the protocol channel.** The server writes only JSON-RPC to stdout;
  mediated command output is captured and returned in the tool result, never
  written to the channel. Diagnostics go to stderr.
- **Tool-Scoped, by design.** Antigravity's host-native execution is
  Google-managed and stays outside the witness boundary. To witness an action,
  route it through the WitSeal `shell` tool. Reaching for Full Execution Coverage
  would require owning the host's executor, which a closed host does not allow.
