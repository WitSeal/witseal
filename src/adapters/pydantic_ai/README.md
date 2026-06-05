# Witnessed execution for Pydantic AI

A WitSeal demo-client adapter that gives a [Pydantic AI](https://ai.pydantic.dev)
agent a **witnessed shell tool**: WitSeal authors the tool, so when the agent
runs a command it goes through WitSeal's pipeline (classify → policy → mediate →
witness → receipt) and produces a real, independently-verifiable **execution
receipt** — not a raw subprocess.

> Naming: this is *witnessed execution for Pydantic AI* — a
> WitSeal-authored, receipt-producing tool. It is **not** a "gateway" and not a
> blanket interceptor of everything the agent does. See **Scope** below and
> `COVERAGE.md`.

## How it works (the seam)

Pydantic AI executes a tool by **calling the Python function** registered for it
(`FunctionToolset.call_tool` → `tool.call_func(args, ctx)` → your function body).
There is no executor object to swap — the **function body is the execution**. So
WitSeal supplies the body:

- `witseal_shell(command)` — the WitSeal-authored tool body. It runs the command
  through the witseal CLI and returns the output plus a `[witseal: receipt=… ]`
  footer. **WitSeal owns this execution** (own-execute).
- `run_through_witseal(command)` — the self-contained bridge it calls:
  `node <dist>/src/cli/index.js --data-dir <dir> exec --mode <mode> -- /bin/sh -c
  <command>`, parsing `receipt=rcpt_…` / `event=evt_…` from the witness footer.

## Usage

```python
from pydantic_ai import Agent
from pydantic_ai_witseal import register_witseal_shell_tool, build_witseal_shell_tool

# Option A — register on an existing agent (becomes its shell/execution tool):
agent = Agent(model="openai:gpt-4o")
register_witseal_shell_tool(agent)          # adds a witnessed `shell` tool

# Option B — compose a toolset:
agent = Agent(model="openai:gpt-4o", tools=[build_witseal_shell_tool()])
```

Configure the bridge via environment (same contract as the OpenHands adapter):

| Env var | Meaning | Default |
|---|---|---|
| `WITSEAL_CLI_ENTRY` | absolute path to `dist/src/cli/index.js` | **required** |
| `WITSEAL_DATA_DIR` | WitSeal data dir (chain, policy packs, receipts) | `~/.witseal` |
| `WITSEAL_NODE` | node binary | `node` |
| `WITSEAL_MODE` | `gate` (deny-by-default) or `witness` | `gate` |

The agent then calls `shell` like any tool; each call is witnessed and yields a
receipt you can inspect / verify:

```bash
node $WITSEAL_CLI_ENTRY --data-dir "$WITSEAL_DATA_DIR" receipt show <rcpt_…>
node $WITSEAL_CLI_ENTRY --data-dir "$WITSEAL_DATA_DIR" verify          # live chain → VALID ✓
```

## Modes

- **`witness`** — runs the command and records a full execution receipt.
- **`gate`** (default, deny-by-default) — fails closed when no policy permits the
  action: `witseal exec` returns exit `100` and the command **does not run**; the
  tool reports a DENIED / not-run result (no silent bypass).

## Scope (honest)

WitSeal witnesses exactly the tool(s) it authors here (the `shell` tool). It does
**not** witness the LLM, the agent's reasoning, framework internals, or any
*other* tool the app grants the agent. For **full execution coverage**, compose
the agent so the WitSeal-authored tool is its execution path and do **not** also
grant it a raw shell / eval tool (that would be a bypass). This is the OpenHands
honesty ceiling. Full details and the live receipt id are in `COVERAGE.md`.

## Verified

Live-verified against pydantic-ai 1.106.0 with the unchanged witseal CLI (repo
main `bab5201`): the authored tool body, invoked both directly and by pydantic-ai
itself (`Agent.run_sync` + `TestModel`), produced execution receipts; the chain
verifies **VALID ✓**. See `COVERAGE.md`.
