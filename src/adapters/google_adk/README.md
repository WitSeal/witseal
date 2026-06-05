# Witnessed execution for Google ADK (Level 3, own-execute)

Integrates WitSeal with [Google ADK](https://google.github.io/adk-docs/)
(`google-adk`) so that a **WitSeal-authored tool's** execution runs through
WitSeal: the command becomes a full, independently-verifiable execution
receipt. WitSeal owns that tool's execution (own-execute) — it is *not* a bare
"WitSeal Google ADK" gateway over all agent traffic. Witnessing is **receipt-first**
and scoped to the authored tool (the OpenHands honesty ceiling).

## How it works (before_tool_callback seam)

ADK runs each agent `before_tool_callback` **before** invoking a tool
(`google.adk.flows.llm_flows.functions`). Verified against **google-adk 2.2.0**
by reading the source: if a `before_tool_callback` returns a truthy dict, ADK
breaks the callback loop (Step 2) and then calls the real tool only
`if function_response is None` (Step 3). So returning a dict makes WitSeal the
execution path for the guarded tool — ADK uses WitSeal's mediated result and
**never runs the real tool body**.

This adapter provides:

- `make_witseal_before_tool_callback(cfg, *, tool_names=…)` — the WitSeal
  `before_tool_callback`. It extracts the `command` argument, routes it through
  WitSeal's pipeline (classify → policy → mediate → witness → receipt), and
  returns the mediated result (with `receipt_id`) as the function response.
- `build_witnessed_shell_tool(cfg)` — the WitSeal-authored shell `FunctionTool`.
  Its body is a **fail-closed sentinel**: if execution ever reaches it (i.e. the
  witnessing callback was bypassed) it refuses, so the only sanctioned
  execution path is the witnessed callback.
- `run_through_witseal(command, cfg)` — the self-contained cross-language bridge
  to the CLI (same shape as the OpenHands / OpenCode adapters).

```python
from google.adk.agents import LlmAgent
from google_adk_witseal import build_witnessed_shell_tool, make_witseal_before_tool_callback

agent = LlmAgent(
    model="gemini-2.0-flash",
    name="witnessed",
    tools=[build_witnessed_shell_tool()],          # granted set = the authored tool
    before_tool_callback=make_witseal_before_tool_callback(),
)
```

With the granted toolset being exactly the authored tool, the witnessed tool is
the agent's only execution path: every run yields a verifiable receipt.

## Cross-language bridge

`google-adk` is Python; WitSeal's `runExec` is in the TypeScript `@witseal/cli`.
The callback invokes the built CLI as a subprocess
(`node <dist>/src/cli/index.js --data-dir <dir> exec --mode <mode> -- /bin/sh -c
<command>`) — the same `runExec` pipeline the OpenCode adapter calls directly.
No global CLI install is required. Configuration is read from the environment:

| Env var | Meaning | Default |
|---|---|---|
| `WITSEAL_CLI_ENTRY` | absolute path to `dist/src/cli/index.js` | (required) |
| `WITSEAL_DATA_DIR` | WitSeal data dir (chain, policy, receipts) | `~/.witseal` |
| `WITSEAL_MODE` | `gate` (deny-by-default) or `witness` | `gate` |
| `WITSEAL_NODE` | node binary | `node` |

## Verified against

`google-adk` **2.2.0** (clean `/tmp` venv, Python 3.14). Live-proven through the
real ADK flow `handle_function_calls_async` (no LLM): a synthesized
`witnessed_shell` function-call produced receipt
`rcpt_mq1j4ir4FHKWYa9SoV04aO`; `witseal verify` → `VALID ✓ (chain)` and the
exported evidence package → `VALID ✓ (evidence-package.v0.1)`. A negative
control (no callback) confirmed the tool body fails closed, proving the
witnessed callback is the only execution path. See `COVERAGE.md` for the honest
scope caveat.

## Scope (honest)

Witnessing is scoped to the **WitSeal-authored tool**. The LLM/model, ADK
internals, and any *other* tool granted to the agent are **not** witnessed
unless they too route through this callback. Compose the granted toolset so the
witnessed tool is the execution path. golden `8fc29592` / 1050 bytes untouched —
this adapter only consumes the unchanged CLI.
