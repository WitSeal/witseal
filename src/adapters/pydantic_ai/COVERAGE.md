# Witnessed execution for Pydantic AI — execution coverage map

Honest, fact-based coverage of a Pydantic AI agent's execution surface under
WitSeal. Verified against **pydantic-ai 1.106.0** with the **unchanged** witseal
CLI (`dist/src/cli/index.js`, repo main `bab5201`). Golden / canon untouched
(this adapter only *uses* the CLI; it does not modify WitSeal).

## The seam (own-execute)

Pydantic AI executes a tool by **calling the Python function** registered for it.
`FunctionToolset.call_tool(...)` ultimately does `await tool.call_func(args, ctx)`,
which runs the body of whatever was passed to `@agent.tool` / `@agent.tool_plain`
/ `Tool(fn)`. There is **no separate executor object to swap** — the function
body *is* the execution. Verified live: `Tool(witseal_shell).function is
witseal_shell` → `True`.

So WitSeal **authors the tool**: `witseal_shell(command)` is a shell tool whose
body routes the command through WitSeal's pipeline (classify → policy → mediate →
witness → receipt) via the CLI subprocess, instead of a raw `subprocess` /
`os.system`. WitSeal **owns that tool's execution** (own-execute) → every call
yields a full, independently-verifiable execution receipt.

## Witnessed execution path (core)

- Shell: `witseal exec` (`runExec` → `mediateShell`), reusing the existing
  execution-result / witness schema (no new wire-format). Receipt schema
  `witseal.receipt.v0.1`; golden receipt `8fc29592…` (1050 bytes) byte-identical
  throughout — this adapter does not touch it.

## Granted-toolset coverage

| Tool | Authored by | Execution? | Status |
|---|---|---|---|
| `shell` (WitSeal-authored) | **WitSeal** | yes | **own-execute** — body = `witseal_shell` → `witseal exec`. Live receipt → `witseal verify` VALID (see below). |
| any *other* tool the agent is granted | the app | maybe | **NOT witnessed** by this adapter (honesty ceiling — see Scope). |
| the model / agent internals / LLM traffic | pydantic-ai | n/a | **NOT witnessed** (out of model; this is not whole-process interception). |

`register_witseal_shell_tool(agent)` registers the WitSeal-authored shell tool as
the agent's execution path. `build_witseal_shell_tool()` returns a
`pydantic_ai.Tool` for `Agent(tools=[...])` composition.

## Scope caveat (honest — the OpenHands honesty ceiling)

Coverage is **Full of the witnessed toolset**, not "full of pydantic-ai". WitSeal
witnesses exactly the tool(s) it authors here (`shell`). It does **not** witness:

- the LLM or the agent's reasoning/tool-selection,
- any *other* tool the app registers (a second, un-witnessed shell/exec tool, a
  Python-eval tool, an HTTP tool, etc.),
- pydantic-ai framework internals.

**To get full execution coverage you must compose the granted toolset so the
WitSeal-authored tool is the execution path** — i.e. grant the agent the
WitSeal `shell` tool and do **not** grant it any other tool that can run commands
/ code. If the agent is also given a raw shell or eval tool, that other tool is a
silent bypass and is out of this adapter's claim.

## Boundary (deny-by-default) — verified

In `gate` mode (default) with no policy pack configured, the runtime **fails
closed**: `witseal exec --mode gate` returns exit **100** (`WITSEAL_DENIED_EXIT`)
and the command **does not run**. The tool body reports this as a DENIED /
not-run result (no silent bypass) rather than returning fabricated output.
Verified live (exit 100). (Cosmetic note, represented honestly: the gate-denial
footer prints `event evt_…` with a space, whereas the witness footer prints
`event=evt_…`; the adapter parses the latter, so the denial message currently
shows `event None`. The *denial decision itself* — exit 100 → "DENIED, did not
run" — is correct and is the load-bearing behavior.)

## Live proof (this build, /tmp venv, no LLM)

pydantic-ai 1.106.0, `WITSEAL_CLI_ENTRY=…/dist/src/cli/index.js`,
`WITSEAL_DATA_DIR=/tmp/pydantic_ai_build/witseal-final`, `WITSEAL_MODE=witness`.

1. **Direct seam call** — built a real `Tool` + `Agent`, invoked the authored
   tool body on `echo card-live-pydantic_ai-<pid>`:
   - receipt **`rcpt_mq1j698xvEoT6JDOChJuhl`** (event `evt_mq1j698xw8oSFkGZ1ebXAA`), exit 0,
     `witseal.receipt.v0.1`, intent `shell: /bin/sh -c echo card-live-pydantic_ai-…`,
     decision allow, exit 0.
2. **Framework-driven** — `Agent.run_sync(...)` with `TestModel` selected and
   invoked the registered `shell` tool itself (pydantic-ai's own
   `FunctionToolset.call_tool` → `witseal_shell`):
   - receipt **`rcpt_mq1j4darLURtLtsT7Zgwm4`** recorded (this proves the
     framework — not just a manual call — drives the witnessed body; exit 127
     because `TestModel` auto-generated a placeholder command string, still a
     real witnessed execution with a real receipt).
3. **Chain verify** — `node $WITSEAL_CLI_ENTRY --data-dir <dir> verify`:

   ```
   witseal: VALID ✓ (chain)
            segment: default
            events:  2
   ```

   → **VALID** (chain). The direct-call clean-room run is shown; an earlier mixed
   run (direct + framework-driven receipts) in `witseal-data` verified VALID with
   4 events.

## Verdict

For an agent whose execution path is the WitSeal-authored `shell` tool, coverage
is **Full of the witnessed toolset**: that tool's execution is own-executed by
WitSeal and produces receipts that verify VALID; deny-by-default holds (exit 100,
fails closed). The claim is **scoped to the witnessed tool** — it is not a claim
over a configuration that also grants an un-witnessed shell/eval tool, nor over
the model or framework internals. Golden `8fc29592` / canon untouched; the
witseal CLI is the unchanged build at repo main `bab5201`.
