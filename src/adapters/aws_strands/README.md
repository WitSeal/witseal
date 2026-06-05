# Witnessed execution for AWS Strands Agents

A WitSeal demo-client adapter that gives an [AWS Strands](https://github.com/strands-agents)
agent a **witnessed shell tool**: a `@tool` whose body routes each command
through WitSeal so the agent's execution produces an independently verifiable
receipt — receipt first, then the command runs.

This is **witnessed execution for Strands**, scoped to a WitSeal-authored tool.
It is not a blanket interception of the whole framework, the model, or all of
Strands' traffic — WitSeal owns and executes one tool, and that tool is the
agent's execution path. (See `COVERAGE.md` for the exact scope.)

## How it works

Strands runs a `@tool`-decorated function's body when the agent picks that tool.
`aws_strands_witseal.witnessed_shell` is such a tool; its body calls
`run_through_witseal(command)`, which invokes the built `@witseal/cli` as a
subprocess:

```
node <dist>/src/cli/index.js --data-dir <dir> exec --mode <mode> -- /bin/sh -c "<command>"
```

The receipt and event ids are parsed from the witness footer and surfaced in the
tool result, so a reviewer can replay or `witseal verify` them. `strands-agents`
is Python; the WitSeal pipeline is TypeScript — the subprocess bridge is
self-contained (no global CLI install required).

## Usage

```python
from strands import Agent
from aws_strands_witseal import build_witnessed_toolset

# Grant ONLY the witnessed tool so it is the agent's execution path.
agent = Agent(tools=build_witnessed_toolset())
# ... run the agent; every shell command it issues is a witnessed execution.
```

Configuration via environment (same contract as the OpenHands adapter):

| Variable            | Meaning                                              | Default      |
| ------------------- | ---------------------------------------------------- | ------------ |
| `WITSEAL_CLI_ENTRY` | absolute path to `dist/src/cli/index.js` (required)  | —            |
| `WITSEAL_DATA_DIR`  | WitSeal data dir (chain, policy packs, receipts)     | `~/.witseal` |
| `WITSEAL_MODE`      | `gate` (deny-by-default) or `witness` (observe-only) | `gate`       |
| `WITSEAL_NODE`      | node binary                                          | `node`       |

A denied command (Gate mode) does not run; the denial is recorded as evidence
and the tool returns a `[witseal] command DENIED ...` message
(`WITSEAL_DENIED_EXIT = 100`).

## Verify a receipt

```
node $WITSEAL_CLI_ENTRY --data-dir <dir> verify            # live chain
node $WITSEAL_CLI_ENTRY --data-dir <dir> receipt show <id> # one receipt
```

This build was live-verified on `strands-agents 1.42.0`; see `COVERAGE.md` for
the receipt ids and the `VALID` chain output.
