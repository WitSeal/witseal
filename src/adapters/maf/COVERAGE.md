# Microsoft Agent Framework — witnessed execution coverage map

Honest, fact-based coverage of a Microsoft Agent Framework (MAF) agent's
command-execution surface under WitSeal. Verified against `agent-framework`
**1.8.0** (`agent_framework`, Python 3.14) with the built `@witseal/cli`
(`dist/src/cli/index.js`).

## What is witnessed

MAF runs agent tool calls through `FunctionTool`s. A tool's execution can be
owned in two ways, and this adapter provides both:

- **(A) Authored tool** — `build_witseal_exec_tool(cfg)` returns a real
  `FunctionTool` (via `@tool`) whose body routes the command through WitSeal's
  pipeline (classify → policy → mediate → witness → receipt) via `witseal exec`
  (`runExec` → `mediateShell`). Hand it to `Agent(tools=[...])`. Every call is a
  full execution receipt.
- **(B) Function middleware** — `WitSealFunctionMiddleware` implements
  `FunctionMiddleware.process(context, call_next)`. For a command-bearing tool
  it runs the command through WitSeal, sets `context.result`, and does **not**
  await `call_next()` — so the host's own execution of that tool is replaced by
  the witnessed run (no bypass).

Reuses the existing execution-result / witness schema (no new wire-format);
golden receipt `8fc29592…` (1050 bytes) untouched; the CLI is used unchanged.

## Granted-execution-surface coverage

| Surface | Execution? | Status |
|---|---|---|
| Authored `witseal_exec` tool (seam A) | yes | **witnessed** — `@tool` body → `witseal exec`; full execution receipt per call |
| Command-bearing tool intercepted by the middleware (seam B) | yes | **witnessed** — `process()` runs `witseal exec`, sets `context.result`, short-circuits `call_next` (host execution replaced) |
| A tool with no `command` argument reaching the middleware | n/a here | **pass-through** — `call_next()` awaited; **not** claimed as witnessed (out of this layer's scope) |
| MAF framework internals / chat (LLM) client / model traffic | n/a | **not witnessed** (out of scope — honesty ceiling) |

## Scope caveat (honest)

- **Full Execution Coverage of the witnessed tool**: when the granted execution
  surface is the authored `witseal_exec` tool — or a command tool routed through
  `WitSealFunctionMiddleware` — every executed command is witnessed (full
  receipt) and none bypasses the boundary; the middleware replaces the host's
  execution rather than running alongside it.
- It is **not** a claim over a configuration that also grants an *unwitnessed*
  execution tool the middleware doesn't intercept (e.g. a tool whose command
  parameter is not named `command`, or a non-command tool). Those are outside
  the witnessed surface; the middleware passes non-command tools through and does
  not claim them.
- Witnessing is scoped to this authored tool / the routed command (the OpenHands
  honesty ceiling): WitSeal owns *this tool's* execution. It does **not** witness
  MAF framework internals, the chat/LLM client, or model/runtime traffic.
- A policy DENY (deny-by-default gate) surfaces WitSeal's reserved exit `100`;
  the command does not run and is recorded as evidence.

## Live proof (this build)

- Framework: `agent-framework` 1.8.0 in a throwaway `/tmp` venv (Python 3.14);
  CLI `dist/src/cli/index.js`; `WITSEAL_MODE=witness`.
- Both seams invoked **directly (no LLM)**:
  - **(A)** `build_witseal_exec_tool(cfg)` → `isinstance(tool, FunctionTool)` =
    `True`; `await tool.invoke(arguments={"command": "echo card-live-maf-tool-<pid>"},
    skip_parsing=True)` returned the marker + WitSeal footer.
    **Receipt `rcpt_mq1lbueoixLB062Bh6aCH2`** (event `evt_mq1lbueoD4FpolI0gNAMZj`).
  - **(B)** `WitSealFunctionMiddleware(cfg)` → `isinstance(mw, FunctionMiddleware)`
    = `True`; `await mw.process(ctx, call_next)` on a host `command` tool set
    `ctx.result` to the witnessed output. Asserted: `call_next` **not** awaited;
    the host tool's original body **did not run**; no unwitnessed output leaked.
    **Receipt `rcpt_mq1lbuh147SdFkWzt6jbap`** (event `evt_mq1lbuh17XdIPKClXjlFi8`),
    action `shell: /bin/sh -c echo card-live-maf-mw-<pid>`, decision `allow`,
    exit `0`.
- `node dist/src/cli/index.js --data-dir <dir> verify` →
  `witseal: VALID ✓ (chain)` (4 events: intent+execution pair per seam).

## Verdict

For the witnessed execution surface (the authored `witseal_exec` tool, and a
command tool routed through `WitSealFunctionMiddleware`), coverage is **Full of
the witnessed tool** by fact: every executed command is witnessed with a
verifiable receipt, the middleware replaces the host's execution (short-circuits
`call_next`, no silent bypass), non-command tools are passed through unclaimed,
and the live seams produced receipts that `witseal verify` confirms **VALID**.
golden `8fc29592` / 1050 bytes untouched; the CLI was used unchanged.
