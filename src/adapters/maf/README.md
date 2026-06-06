# Microsoft Agent Framework adapter — witnessed execution

Integrates WitSeal with the [Microsoft Agent Framework](https://github.com/microsoft/agent-framework)
(MAF) Python SDK (`pip install agent-framework`, module `agent_framework`) so an
MAF agent's **own** command execution runs through WitSeal — every run becomes a
full, independently-verifiable execution receipt (classify → policy → mediate →
witness → receipt), not a raw local subprocess.

This is a thin layer (a self-contained CLI bridge), like the shipped OpenCode /
OpenHands / AutoGen adapters: it does not reimplement WitSeal, it routes the
agent's execution through the built `@witseal/cli`.

## Two seams (both provided)

MAF Python exposes two places to own a tool's execution; this adapter plugs into
**both**:

### (A) Author the execution tool — `build_witseal_exec_tool(cfg)`

MAF's `@tool` decorator turns a function into a `FunctionTool` you pass to
`Agent(tools=[...])` / `ChatAgent(... tools=[...])`. `build_witseal_exec_tool`
returns such a tool whose body runs the command through the witseal pipeline:

```python
from maf_witseal import build_witseal_exec_tool, default_bridge_config_from_env

cfg = default_bridge_config_from_env()  # reads WITSEAL_CLI_ENTRY / _DATA_DIR / _MODE
agent = ChatAgent(chat_client=..., tools=[build_witseal_exec_tool(cfg)])
```

When the agent calls `witseal_exec(command=...)`, WitSeal executes it and records
a receipt; the returned text carries the receipt id (`verify with witseal verify`).
This is the WitSeal-authored execution tool the host routes through.

### (B) Function middleware — `WitSealFunctionMiddleware(cfg)`

MAF's `FunctionMiddleware.process(context, call_next)` intercepts a tool
invocation. Setting `context.result` and **not** awaiting `call_next()`
short-circuits the host's own execution. `WitSealFunctionMiddleware` re-routes
the command-bearing tool's execution through witseal and overrides
`context.result` with the witnessed output:

```python
from maf_witseal import WitSealFunctionMiddleware, default_bridge_config_from_env

cfg = default_bridge_config_from_env()
agent = ChatAgent(chat_client=..., tools=[host_shell],         # parameter named `command`
                  middleware=[WitSealFunctionMiddleware(cfg)])
```

For any intercepted call carrying a `command` argument, the host's execution of
that tool is **replaced** by the witnessed run (`call_next()` is intentionally
not awaited). Tools without a `command` argument pass through untouched and are
not claimed as witnessed.

## How it works (cross-language bridge)

MAF is Python; WitSeal's `runExec` is the TypeScript `@witseal/cli`. The adapter
invokes the built CLI as a subprocess —

```
node <dist>/src/cli/index.js --data-dir <dir> exec --mode <mode> -- /bin/sh -c <command>
```

— the same `runExec` pipeline the OpenCode / OpenHands / AutoGen adapters drive.
No global CLI install is required. The CLI, the golden receipt
(`8fc29592…`, 1050 bytes), and the wire-format are used **unchanged** (no new
schema).

Configuration (`default_bridge_config_from_env`):

| Env var | Meaning | Default |
|---|---|---|
| `WITSEAL_CLI_ENTRY` | absolute path to `dist/src/cli/index.js` (required) | — |
| `WITSEAL_DATA_DIR` | WitSeal data dir (chain, policy packs, receipts) | `~/.witseal` |
| `WITSEAL_MODE` | `gate` (deny-by-default) or `witness` | `gate` |

A policy DENY (deny-by-default gate) surfaces WitSeal's reserved exit `100`; the
command does not run and is recorded as evidence.

## Verified against

`agent-framework` **1.8.0** (`agent_framework`, Python 3.14) with the built
`@witseal/cli` (`dist/src/cli/index.js`). API used: `tool` → `FunctionTool`
(`.invoke(arguments=…)`), `FunctionMiddleware.process(context, call_next)`,
`FunctionInvocationContext.result`.

## Coverage status (honest)

Witnessing is scoped to **this WitSeal-authored tool / the command this
middleware routes through** — WitSeal owns *that tool's* execution (the OpenHands
honesty ceiling). It does **not** witness MAF framework internals, the chat/LLM
client, model/runtime traffic, or other tools the agent may also hold. See
[`COVERAGE.md`](./COVERAGE.md).
