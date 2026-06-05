# Witnessed execution for CrewAI (WitSeal-authored tool)

A WitSeal-authored CrewAI tool whose execution is itself witnessed. Give it to a
[CrewAI](https://crewai.com) agent and the command the agent runs **through this
tool** becomes a full, independently-verifiable WitSeal execution receipt — not a
log line, a receipt you can `witseal verify`.

This is receipt-first, role-qualified: it is *witnessed execution for CrewAI*
provided by a tool WitSeal authored — **not** a gateway in front of CrewAI and
not "WitSeal CrewAI." WitSeal owns the execution path of the one tool it
authored; it does not intercept the framework, the LLM, or other tools. (See
`COVERAGE.md` for the exact, honest scope.)

## How it works (authored tool, own-execute)

CrewAI agents act through tools — `crewai.tools.BaseTool` subclasses whose
`_run` body is the code that actually does the work. `WitSealCrewTool` subclasses
`BaseTool` and implements `_run(command)` so that, instead of shelling out
in-process, it routes the command through WitSeal's pipeline (classify → policy →
mediate → witness → receipt). The receipt id is returned to the agent in the tool
result.

When the agent calls the tool, `BaseTool.run(command=…)` validates the argument
against an `args_schema` CrewAI auto-derives from `_run`'s signature, then
dispatches to `_run` — so the tool's actual execution is inside the WitSeal
witness boundary.

Cross-language bridge: CrewAI is Python; WitSeal's `runExec` is the TypeScript
`@witseal/cli`. The tool invokes the built CLI as a subprocess
(`node <dist>/src/cli/index.js --data-dir <dir> exec --mode <mode> -- /bin/sh -c
<command>`) — the same `runExec` pipeline the OpenCode / OpenHands adapters use.
No global CLI install is required.

## Verified against

`crewai` **1.14.6** (Python 3.11). Live proof: `WitSealCrewTool().run(command=…)`
produced receipt `rcpt_mq1j38csbBbmlxEXa3PjIw`; `witseal verify` → **VALID ✓
(chain)**. Details in `COVERAGE.md`.

## Use

```python
from crewai import Agent
from crewai_witseal import WitSealCrewTool

# Configure the bridge via environment (read inside the tool):
#   WITSEAL_CLI_ENTRY  abs path to dist/src/cli/index.js   (required)
#   WITSEAL_DATA_DIR   WitSeal data dir (policy-packs/ for gate)  (default ~/.witseal)
#   WITSEAL_MODE       gate (deny-by-default) | witness     (default gate)
#   WITSEAL_NODE       node binary                          (default "node")

witnessed = WitSealCrewTool()

# Full coverage is a configuration choice: grant this as the agent's ONLY
# execution-capable tool, so every command it can run is witnessed.
agent = Agent(
    role="operator",
    goal="...",
    backstory="...",
    tools=[witnessed],   # no raw ShellTool / CodeInterpreterTool alongside
)
```

You can also drive the seam directly (no LLM), exactly as the live-verify does:

```python
tool = WitSealCrewTool()
print(tool.run(command="echo hello"))   # → stdout + [witseal: receipt=rcpt_… …]
```

## Notes

- **Never bypasses WitSeal**: the command runs only via the CLI's `runExec`. A
  Gate denial blocks execution (exit `100`) and returns a clear "DENIED by
  policy" result; the command does not run.
- **Honest scope**: only this authored tool is witnessed (the OpenHands honesty
  ceiling). It is not a claim over the whole crew unless this is the only
  execution tool granted. See `COVERAGE.md`.
- Python source under `src/adapters/crewai/`; not shipped in the npm package
  (which is the TypeScript CLI). Uses the unchanged CLI — golden / canon
  untouched.
