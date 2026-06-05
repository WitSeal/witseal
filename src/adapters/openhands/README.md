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

"Full Execution Coverage" means **every** execution-capable tool in the agent's
granted toolset is witnessed, with no bypass path — reached here by *restricting
the granted toolset to witnessed tools* via `build_witnessed_toolset`.

| Tool (1.21.0) | Status |
|---|---|
| `terminal` (shell) | **wrapped** — executor swap → `witseal exec`; live-proven (receipt → `witseal verify` VALID) |
| `file_editor` | **wrapped** — create / str_replace / insert → `witseal exec-file`; `view` read-only; `undo_edit` refused |
| `apply_patch` | **wrapped** — ADD / UPDATE → `witseal exec-file`; DELETE / MOVE refused (atomic) |
| `planning_file_editor` | **wrapped** — plan write → `witseal exec-file`; off-plan refused |
| `task_tracker` | **excluded** from the granted set (writes only its internal `TASKS.json`) |
| `browser_use` / `browser_tool_set` | **excluded** (`cli_mode` ⇒ no browser) |
| programmatic `BaseWorkspace.execute_command` (SDK / skills / git) | separate surface; no tool-layer bypass (Stage D analysis) |

`build_witnessed_toolset` returns the default toolset with `terminal` +
`file_editor` wrapped and `task_tracker` + `browser` dropped, so **no unwitnessed
execution-capable tool remains** in the granted set (`apply_patch` /
`planning_file_editor` are wrapped for the presets that grant them). With that
toolset, OpenHands is **Full Execution Coverage**, scoped to the witnessed granted
set. A configuration that grants `browser` / `task_tracker` (i.e. does not use
`build_witnessed_toolset`) is **not** Full. See `COVERAGE.md` for the A–E evidence.

## Use (executor swap into an Agent)

```python
from witseal_openhands import build_witseal_terminal_tool, WitSealBridgeConfig
from witseal_openhands_files import build_witnessed_toolset

cfg = WitSealBridgeConfig(
    cli_entry="/abs/path/to/@witseal-cli/dist/src/cli/index.js",
    data_dir="/abs/path/to/witseal-data-dir",  # must contain policy-packs/
    mode="gate",  # deny-by-default
)

# Full Execution Coverage: terminal + file tools wrapped, browser + task_tracker
# dropped — no unwitnessed execution path remains in the granted set.
tools = build_witnessed_toolset(conv_state, cfg, build_witseal_terminal_tool)
# Use as Agent(tools=tools).
#
# For shell-only coverage, swap just the terminal tool instead:
#   terminal_tool = build_witseal_terminal_tool(conv_state, cfg)
#   # put `terminal_tool` in Agent(tools=[...]) IN PLACE OF the default TerminalTool.
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
