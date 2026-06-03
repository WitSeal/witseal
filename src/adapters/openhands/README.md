# OpenHands adapter — full execution coverage (Level 3)

Integrates WitSeal with [OpenHands](https://openhands.dev) (the `openhands-sdk`
agent runtime) so the agent's **own** execution runs through WitSeal — every
shell command becomes a full, independently-verifiable execution receipt, not
just the calls routed to a separate witnessed tool.

This is the full-L3 path. It differs from the MCP integration (where WitSeal is
an additional `shell` tool *alongside* the agent's built-in execution): here
WitSeal **replaces the executor** behind the agent's shell tool, so the host's
native execution is inside the witness boundary.

## How it works (executor swap)

OpenHands runs the agent's shell via a `TerminalExecutor` that owns its own
tmux/subprocess session (`openhands.tools.terminal`). That path does **not** go
through `BaseWorkspace.execute_command`, so the only way to put the agent's
*actual* execution under the witness boundary is to swap the tool's executor —
exactly as the shipped OpenCode adapter shadows the built-in shell tool rather
than a workspace.

`WitSealTerminalExecutor` is a real `openhands.sdk.tool.ToolExecutor`:
`__call__(TerminalAction) -> TerminalObservation`. Instead of a raw shell, it
routes the command through WitSeal's pipeline (classify → policy → mediate →
witness → receipt) and surfaces the receipt id in the observation.

Cross-language bridge: `openhands-sdk` is Python; WitSeal's `runExec` is in the
TypeScript `@witseal/cli`. The executor invokes the built CLI as a subprocess
(`node <dist>/src/cli/index.js --data-dir <dir> exec -- /bin/sh -c <command>`) —
the same `runExec` pipeline the OpenCode adapter calls directly. No global CLI
install is required.

## Verified against

`openhands-sdk` / `openhands-tools` **1.21.0** (run via `uvx --python 3.12`).
The shell tool at this version is `openhands.tools.terminal`
(`TerminalTool` / `TerminalExecutor` / `TerminalAction` / `TerminalObservation`).

## Coverage status (honest)

"Full Execution Coverage" means **every** execution-capable tool the agent is
granted is witnessed, with no bypass path.

| Tool (1.21.0) | Stage | Status |
|---|---|---|
| `terminal` (shell) | 1 | executor swap implemented; bridge proven live (receipt → `witseal verify` VALID) |
| `file_editor`, `apply_patch`, `planning_file_editor` | 2 | not yet wrapped |
| `browser_use` (and other state-changing tools) | 2 | not yet wrapped |
| programmatic `BaseWorkspace.execute_command` (SDK/skills/git) | 3 | separate path; optional workspace subclass |

**Do not** advertise OpenHands as "Full Execution Coverage" until every
execution-capable tool in the agent's granted toolset is witnessed (or the
toolset is restricted to witnessed tools). Stage 1 covers the shell path only.

## Use (executor swap into an Agent)

```python
from witseal_openhands import build_witseal_terminal_tool, WitSealBridgeConfig

cfg = WitSealBridgeConfig(
    cli_entry="/abs/path/to/@witseal-cli/dist/src/cli/index.js",
    data_dir="/abs/path/to/witseal-data-dir",  # must contain policy-packs/
    mode="gate",  # deny-by-default
)
terminal_tool = build_witseal_terminal_tool(conv_state, cfg)
# Put `terminal_tool` in Agent(tools=[...]) IN PLACE OF the default TerminalTool.
```

## Notes

- **Never bypasses WitSeal**: the command runs only via `runExec`. A Gate denial
  blocks execution (exit `100`) and is recorded as `denied_by_policy`.
- Interactive stdin / control keys (`C-c`, …) and terminal reset are not modelled
  by the mediated executor — each command is a discrete witnessed execution; the
  observation says so honestly.
- This adapter is Python (OpenHands is Python). It is source under
  `src/adapters/openhands/`; it is not shipped in the npm package (which is the
  TypeScript CLI). Packaging for distribution is a separate, later step.
