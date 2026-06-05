# Witnessed execution for CrewAI — coverage map

Honest, fact-based coverage of what is and is not under the WitSeal witness
boundary when an agent runs through this adapter. Verified live against the
installed `crewai` **1.14.6** (Python 3.11).

## What is witnessed (the authored tool)

CrewAI agents act through **tools** — `crewai.tools.BaseTool` subclasses whose
`_run` body is the code that actually touches the world. This adapter ships one
WitSeal-**authored** tool, `WitSealCrewTool` (`name="witnessed_shell"`). Its
`_run(command)` does not shell out in-process; it routes the command through the
WitSeal pipeline (classify → policy → mediate → witness → receipt) via the built
CLI. WitSeal **owns** this tool's execution (own-execute), so every call to it is
a full, independently-verifiable execution receipt.

| Surface | Witnessed? | Notes |
|---|---|---|
| `WitSealCrewTool._run` (this authored tool) | **yes** | own-execute → `witseal exec` (`runExec` → `mediateShell`); receipt id returned in the tool result |
| CrewAI internals / planning / memory | no | framework control flow, not execution this adapter owns |
| The LLM and its reasoning | no | out of scope (no execution receipt for token generation) |
| Any *other* tool the crew is granted | no | only the tool whose body WitSeal authored is witnessed |

This is the **OpenHands honesty ceiling**: the witness boundary is scoped to the
authored tool's execution, not to "all agent traffic." It is an honest L3 seam —
WitSeal owns the execution path of the tool it authored — not a blanket
interception of the framework.

## Seam (how the agent's call reaches WitSeal)

`tool.run(command=…)` → `BaseTool.run` validates the argument against the
`args_schema` it auto-derives from `_run`'s signature (a single `command: str`
field) → calls `_run` → `run_through_witseal(command)` → `node
dist/src/cli/index.js … exec --mode <mode> -- /bin/sh -c <command>`. A Gate
denial returns exit `100`; the command does **not** run and is recorded as
evidence.

## How to make coverage Full for a crew (compose the toolset)

"Full Execution Coverage" for a CrewAI agent is a **configuration**: grant the
agent `WitSealCrewTool` as the **only** execution-capable tool (no raw
`ShellTool` / `CodeInterpreterTool` / other command-running tool alongside it).
Then the witnessed tool is the agent's single execution path, and every command
it can run is witnessed. This adapter does not, and cannot, witness a crew that
*also* grants an unwitnessed execution tool — that is out of scope and is not
claimed.

## Live proof (this adapter, executed)

Exercised directly against real `crewai` 1.14.6, no LLM — the tool was invoked
the way CrewAI invokes it:

```
tool = WitSealCrewTool()
result = tool.run(command="echo card-live-crewai-<pid>")   # BaseTool.run → _run → WitSeal
```

- Receipt produced by the tool's own execution: **`rcpt_mq1j38csbBbmlxEXa3PjIw`**
  (event `evt_mq1j38csKWwC65cImkjQVI`).
- `receipt show` binds the exact command: `intent: shell: /bin/sh -c echo
  card-live-crewai-26675`, `decision: allow`, `exit: 0`.
- `node <cli> --data-dir <dir> verify` → `witseal: VALID ✓ (chain)` (segment
  `default`, 2 events).

Mode used for the live proof was `witness` (fresh data dir, no policy pack →
`outcome: no_policy_configured`); the default adapter mode is `gate`
(deny-by-default), which requires a policy pack under the data dir to allow.
The gate deny-by-default path was also exercised live: with `gate` mode and no
policy pack, `tool.run(command="echo should-be-denied")` returned the
"DENIED by policy" result and the command did not run (exit `100` contract).

## Invariants

The adapter uses the **unchanged** witseal CLI only; golden / canon / wire-format
untouched. It is Python source (CrewAI is Python); it is not part of the npm
package (the TypeScript CLI).
