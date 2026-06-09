# Witnessed execution for Codex CLI

Integrates WitSeal with [Codex CLI](https://github.com/openai/codex) — OpenAI's
open-source (Apache-2.0, Rust) terminal coding agent — so that shell commands the
agent routes through the WitSeal MCP tool pass through the WitSeal pipeline
(classify → policy → mediate → witness → receipt) and are recorded as
independently verifiable execution receipts.

## Model (Tool-Scoped via MCP — WitSeal owns the routed tool)

Codex CLI natively hosts MCP servers: it can launch a stdio MCP server and offer
that server's tools to the model alongside its own built-in execution. WitSeal
ships such a server — `witseal-mcp` — exposing a single `shell` tool. When the
model calls that tool, WitSeal **own-executes** the command through its mediator
(`mediateMcpShell` → `runExec`), captures the output, and records a **full
execution receipt** (`allowed_executed`, or `denied_by_policy` when a Gate denial
blocks it) — not merely a witnessed decision.

This is the host-independent surface: nothing is patched inside Codex. You
register the shipped server, and every call the agent makes to the WitSeal
`shell` tool is mediated before it runs. The `command` argument is a freeform
shell string, run faithfully as `/bin/sh -c "<command>"`. A freeform command is
opaque to structural classification, so the shell-bypass rules correctly elevate
its risk; policy can still allow it.

This is a thin layer: it reuses the unchanged shipped `witseal-mcp` server and
the existing execution-result / witness schema (no new wire-format); the golden
receipt is untouched.

**Scope (read this).** Tool-Scoped via MCP means **only the calls routed through
the `witseal-mcp` `shell` tool are witnessed.** Codex CLI's own built-in shell /
exec path is a separate, host-native executor that does **not** pass through
WitSeal and is **not** witnessed. See `COVERAGE.md` for how to keep the witnessed
tool the agent's execution path.

## Install

1. `npm install -g @witseal/cli` (this provides the `witseal-mcp` binary).
2. Register the WitSeal server with Codex. The CLI command is:

   ```sh
   codex mcp add witseal -- witseal-mcp
   ```

   This writes an `[mcp_servers.witseal]` entry into Codex's config
   (`~/.codex/config.toml`). The equivalent manual entry is:

   ```toml
   [mcp_servers.witseal]
   command = "witseal-mcp"

   [mcp_servers.witseal.env]
   WITSEAL_DATA_DIR = "<your data dir>/.witseal"
   WITSEAL_MODE = "gate"
   ```

   `witseal-mcp` takes no flags; it is configured by environment only:

   | Variable | Meaning | Default |
   |---|---|---|
   | `WITSEAL_DATA_DIR` | Data directory (chain, policy packs, receipts) | `~/.witseal` |
   | `WITSEAL_SEGMENT` | Chain segment id | `default` |
   | `WITSEAL_MODE` | `gate` (deny-by-default) or `witness` (record, do not enforce) | `gate` |
   | `WITSEAL_AGENT_ID` | Agent identifier recorded in the witness event | `mcp-client` (set `codex` to attribute receipts) |

3. Load at least one policy pack into `<WITSEAL_DATA_DIR>/policy-packs/`. In Gate
   mode (the default) WitSeal fails closed when no policy pack is present, so
   every command is denied until a pack is added — see `examples/policy-packs/`.

4. Start Codex. The `witseal` server's `shell` tool now appears alongside Codex's
   built-in tools; route shell actions through it to get witnessed execution.

To confirm the server is registered, `codex mcp list` should show `witseal`, and
`codex mcp get witseal` should print the `command = "witseal-mcp"` entry.

## Notes

- **Never bypasses WitSeal**: a command sent to the `shell` tool runs only via
  `runExec`. A Gate denial blocks execution (exit `100`) and is recorded as
  `denied_by_policy` — it is surfaced to the model as an error result, never
  silently caught and retried.
- **stdout is the protocol channel.** `witseal-mcp` writes only JSON-RPC to
  stdout; the mediated command's captured output is returned in the tool result
  and is also available via `witseal receipt show <id>`. Diagnostics go to
  stderr.
- Run in `gate` mode (deny-by-default) for enforcement, or `witness` mode for
  observe-only attestation.
- The WitSeal server witnesses only its own `shell` tool. It does not see, proxy,
  or record the calls Codex makes to *other* MCP servers, nor Codex's built-in
  execution. Honesty ceiling and how to keep coverage tool-scoped-complete: see
  `COVERAGE.md`.
