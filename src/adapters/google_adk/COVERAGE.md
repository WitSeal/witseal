# Witnessed execution for Google ADK — execution coverage map

Honest, fact-based coverage of what WitSeal witnesses when integrated with
Google ADK (`google-adk`). Verified against **google-adk 2.2.0** in a clean
`/tmp` venv (Python 3.14).

## Seam (own-execute)

WitSeal authors a shell `FunctionTool` (`build_witnessed_shell_tool`) and the
`before_tool_callback` (`make_witseal_before_tool_callback`) that mediates it.
ADK's tool-call flow (`google.adk.flows.llm_flows.functions`) runs each
`before_tool_callback` **before** the tool body, and — verified by reading the
2.2.0 source — Step 2 breaks the loop on a truthy return, then Step 3 calls the
real tool only `if function_response is None`:

```
# functions.py (2.2.0)
# Step 2:
if function_response is None:
  for callback in agent.canonical_before_tool_callbacks:
    function_response = callback(tool=tool, args=function_args, tool_context=tool_context)
    ...
    if function_response:
      break
# Step 3: Otherwise, proceed calling the tool normally.
if function_response is None:
  function_response = await __call_tool_async(tool, args=function_args, tool_context=tool_context)
```

So the WitSeal callback returning a dict **is** the execution: ADK skips the
real tool body and uses WitSeal's mediated result as the function response.
WitSeal owns that tool's execution and emits a full execution receipt.

## Witnessed execution path (core)

- Shell: `witseal exec` (`runExec` → `mediateShell`), invoked as a subprocess
  of the built TypeScript CLI. The execution-result / witness schema is reused
  unchanged (no new wire-format); golden receipt `8fc29592…` (1050 bytes)
  untouched — this adapter only *consumes* the unchanged CLI.

## Granted-toolset coverage

| Tool | Execution? | Status |
|---|---|---|
| `witnessed_shell` (the WitSeal-authored shell tool) | yes | **witnessed** — `before_tool_callback` → `run_through_witseal` → `witseal exec`; live receipt → `witseal verify` **VALID**. The tool body itself is a **fail-closed sentinel**: if ever reached it raises (raw execution refused), so the *only* execution path is the witnessed callback. |
| any other tool granted to the same agent | depends | **pass-through** by default mediation only matches tool args carrying a `command`/`cmd` string; with `tool_names=` the callback mediates only the named tool(s). Tools that are not the authored shell tool are **NOT** witnessed (honesty ceiling — see scope). |

**Compose the granted set so the witnessed tool is the execution path.** The
intended configuration is an `LlmAgent` whose granted toolset is *exactly*
`build_witnessed_shell_tool()`, with `before_tool_callback=make_witseal_before_tool_callback()`.
Then the witnessed tool is the agent's only execution surface and every run
yields a verifiable receipt. (`Full` is *Full of the witnessed toolset* — it is
not a claim over a configuration that also grants unwitnessed execution-capable
tools.)

## Scope caveat (honest — OpenHands honesty ceiling)

Witnessing is scoped to the **WitSeal-authored tool**, NOT to:

- ADK framework internals, the agent loop, or planner;
- the LLM / model traffic (`gemini-*` etc.) — not contacted by the seam and not
  witnessed;
- any *other* tool the operator adds to the same agent. If an agent is
  configured with additional execution-capable tools (e.g. a second shell tool,
  `BuiltInCodeExecutor`, an MCP toolset, arbitrary `FunctionTool`s), those run
  through their own paths and are **not** witnessed unless they too are routed
  through `before_tool_callback` and carry a mediated `command`.
- ADK's `plugin_manager` `before_tool_callback` runs **before** the agent-level
  callback (Step 1) and could pre-empt it; this adapter installs the
  agent-level callback (no plugin shadows it in the verified configuration).

This is the OpenHands ceiling: own-execute of the authored tool, not blanket
capture of all agent execution.

## Live verification (this build, 2026-06-05)

Driven through the **real ADK 2.2.0 flow** — not a mock. The live harness built
an `LlmAgent` with the authored tool + WitSeal callback, synthesized the
function-call `Event` the LLM would emit (`witnessed_shell(command="echo
card-live-google-adk-<pid>")`), and called
`google.adk.flows.llm_flows.functions.handle_function_calls_async`. No LLM was
contacted.

- Returned function-response: `status=ok`, `exit_code=0`,
  `stdout='card-live-google-adk-26830\n'`.
- **Live receipt id: `rcpt_mq1j4ir4FHKWYa9SoV04aO`** (witness event
  `evt_mq1j4ir4Z76ad29M2vrkE6`), receipt schema `witseal.receipt.v0.1`,
  intent `shell: /bin/sh -c echo card-live-google-adk-26830`, decision `allow`,
  exit `0`.
- `node $WITSEAL_CLI_ENTRY --data-dir <dir> verify` →
  `witseal: VALID ✓ (chain)` (2 events).
- `node $WITSEAL_CLI_ENTRY --data-dir <dir> verify <evidence.json>` (package
  containing the receipt) → `witseal: VALID ✓ (evidence-package.v0.1)` (2
  receipts verified).
- **Negative control**: an agent with **no** WitSeal callback drove the same
  function-call; ADK Step 3 ran the real tool body, which raised the
  fail-closed `RuntimeError` (raw execution refused). This proves the witnessed
  callback is the *only* sanctioned execution path — the seam is load-bearing,
  not incidental.

## Verdict

For an agent whose granted toolset is the WitSeal-authored shell tool,
execution coverage is **Full of that witnessed toolset**, live-proven through
the real ADK flow (receipt → `witseal verify` VALID). golden `8fc29592` / 1050
bytes untouched; the adapter only uses the unchanged CLI. The claim is scoped
to the authored tool (see caveat) — it is not a claim over the LLM, ADK
internals, or operator-added unwitnessed tools.
