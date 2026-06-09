# Windsurf adapter (Tool-Scoped via MCP)

Brings **witnessed execution for Windsurf** by registering the `witseal-mcp`
server as a Model Context Protocol server that Windsurf's Cascade agent can call.
Windsurf (Codeium / Cognition) is a closed host: Cascade has its own built-in
executor and does not expose a hook or executor seam an integration could take
over. So WitSeal does not try to own Cascade's native execution. Instead it adds
a **WitSeal-owned `shell` tool over MCP**: when Cascade calls that tool, the
command is own-executed through the WitSeal pipeline (classify -> policy ->
mediate -> witness -> receipt) and recorded as a **full execution receipt**.

This is the *Tool-Scoped via MCP* tier. Cascade is an MCP client, so the same
`witseal-mcp` server that ships for Claude Desktop, Claude Code, and Cursor drops
straight into Windsurf's MCP config — no application code changes. The honest
boundary is exactly the WitSeal `shell` tool: calls routed through it are
witnessed; Cascade's own built-in execution is not.

## Model (Tool-Scoped via MCP — WitSeal owns its own tool)

The `witseal-mcp` server exposes a single tool, `shell`. When Cascade chooses to
call it, WitSeal own-executes the command through `runExec` inside its mediator,
captures the output, and records a full execution receipt — not merely a
witnessed decision. A command denied by policy does not run and is recorded as
`denied_by_policy`. This is the same own-execute core the Claude Desktop / Cursor
MCP path uses; only the host that points at the server differs.

The server is host-independent and has no Windsurf-specific code: the adapter is
the **configuration** that registers it, plus the scoped coverage statement in
[`COVERAGE.md`](./COVERAGE.md).

### Scope (what this is and is not)

- **Is:** a way for Windsurf's Cascade to use WitSeal's own witnessed `shell`
  tool. Every call Cascade makes to that tool is mediated and recorded.
- **Is not:** interception of Cascade's native execution, its file edits, or the
  calls it makes to *other* MCP servers. The `witseal-mcp` server governs only
  its own `shell` tool — it does not see, proxy, or record another server's tool
  traffic, and it does not replace Cascade's built-in executor. First-class
  mediation of arbitrary host or MCP traffic is a separate, later runtime layer.

## Install

1. `npm install -g @witseal/cli` (provides the `witseal` and `witseal-mcp`
   binaries).
2. Register `witseal-mcp` as an MCP server in Windsurf. Cascade reads its MCP
   servers from `mcp_config.json` (open it from Windsurf via *Settings ->
   Cascade -> Model Context Protocol -> Manage / Edit `mcp_config.json`*). Add a
   `witseal` server under `mcpServers`:

```json
{
  "mcpServers": {
    "witseal": {
      "command": "witseal-mcp",
      "env": {
        "WITSEAL_DATA_DIR": "/path/to/your/.witseal",
        "WITSEAL_MODE": "gate",
        "WITSEAL_AGENT_ID": "windsurf-cascade"
      }
    }
  }
}
```

3. Reload the MCP servers in the Cascade panel (the refresh control next to the
   server list). The `witseal` server should appear with one tool, `shell`.
4. Add at least one policy pack under `<WITSEAL_DATA_DIR>/policy-packs/`. With no
   policy pack, Gate mode fails closed (deny-by-default) and every command is
   denied — see the quickstart pack in `examples/policy-packs/`.

To keep coverage meaningful, see [`COVERAGE.md`](./COVERAGE.md): the WitSeal
`shell` tool is the witnessed path; Cascade's own built-in run/terminal action
is not. Direct execution-bearing prompts at the `witseal` `shell` tool when you
want a verifiable receipt.

## Configuration (environment only)

The server takes no flags; the MCP client sets environment in the server config:

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
denial — or a non-zero exit — is returned as an error result so Cascade sees the
command did not succeed. The full captured output (head + tail) and the recorded
evidence are always available via `witseal receipt show`.

## Notes

- **Never bypasses WitSeal**: a command routed to this tool runs only via
  `runExec`. A Gate denial blocks execution and is recorded as `denied_by_policy`.
- **stdout is the protocol channel.** The server writes only JSON-RPC to stdout;
  mediated command output is captured and returned in the tool result, never
  written to the channel. Diagnostics go to stderr.
- **One logical action, one path.** Cascade also has its own built-in execution.
  Route a given logical action through the WitSeal `shell` tool *or* the host
  executor, not both — there is no de-duplication by command string, so doing
  both records the action twice (and only the WitSeal-routed one is witnessed).
- A freeform shell command is opaque to structural classification, so the
  shell-bypass rules correctly elevate its risk; policy can still allow it.
