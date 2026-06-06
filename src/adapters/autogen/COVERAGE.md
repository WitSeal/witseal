# AutoGen — witnessed execution coverage map

Honest, fact-based coverage of an AutoGen agent's code-execution surface under
WitSeal. Verified against `autogen-core` / `autogen-agentchat` **0.7.5** with the
built `@witseal/cli` **0.3.0** (`dist/src/cli/index.js`).

## What is witnessed

AutoGen runs agent-authored code through a `CodeExecutor`
(`autogen_core.code_executor.CodeExecutor`): the agent emits `CodeBlock`s and the
executor's `execute_code_blocks(code_blocks, cancellation_token) -> CodeResult`
runs them. That executor **is** the execution path for code the agent decides to
run (e.g. via `autogen_agentchat.agents.CodeExecutorAgent`, or a code-execution
tool an agent owns).

`WitSealCommandLineCodeExecutor` is a real `CodeExecutor` subclass that **owns**
this path: each shell `CodeBlock.code` is routed through WitSeal's pipeline
(classify → policy → mediate → witness → receipt) via `witseal exec`
(`runExec` → `mediateShell`), instead of a raw local subprocess. Every shell
block becomes an independently verifiable execution receipt. Reuses the existing
execution-result / witness schema (no new wire-format); golden receipt
`8fc29592…` (1050 bytes) untouched.

## Granted-execution-surface coverage

| Surface | Execution? | Status |
|---|---|---|
| Shell `CodeBlock` (`sh`/`bash`/`shell`/`powershell`/`pwsh`) | yes | **wrapped** — `WitSealCommandLineCodeExecutor.execute_code_blocks` → `witseal exec`; full execution receipt per block |
| Non-shell `CodeBlock` (`python`, etc.) | yes (script written + run by the default `LocalCommandLineCodeExecutor`) | **REFUSED** — not silently run unwitnessed; the block is rejected with a `[witseal]` notice and a non-zero exit (no bypass) |

The default `LocalCommandLineCodeExecutor` writes a script file for non-shell
languages and then runs it. This adapter does **not** wrap that file-writing
path; it witnesses the shell-command path only and refuses non-shell blocks
rather than running them outside the witness boundary. To get Full Execution
Coverage of the *granted* surface, compose the agent so the witnessed executor
is the execution path — i.e. grant shell code execution (the witnessed path),
not unwitnessed `python` script execution.

## Scope caveat (honest)

- **Full Execution Coverage of the witnessed toolset**: when the granted
  execution surface is shell code blocks through this executor, every executed
  block is witnessed (full receipt) — none bypasses the boundary.
- It is **not** a claim over a configuration that also grants an *unwitnessed*
  executor (e.g. a second `LocalCommandLineCodeExecutor`) or non-shell script
  execution. Those are out of the witnessed surface; non-shell blocks reaching
  this executor are refused, not silently run.
- Witnessing is scoped to this authored executor (the OpenHands honesty
  ceiling): WitSeal owns *this tool's* execution. It does **not** witness AutoGen
  framework internals, the LLM, or model/runtime traffic.
- A policy DENY (deny-by-default gate) surfaces WitSeal's reserved exit `100`
  and the block does not run; it is recorded as evidence.

## Live proof (this build)

- Framework: `autogen-core` / `autogen-agentchat` 0.7.5 in a throwaway `/tmp`
  venv; CLI `0.3.0`.
- Seam invoked **directly** (no LLM): instantiated
  `WitSealCommandLineCodeExecutor`, then `await execute_code_blocks([CodeBlock(
  code="echo card-live-autogen-<pid>", language="sh")], CancellationToken())`
  inside `async with executor:` (so `start()`/`stop()` ran too).
- `isinstance(executor, CodeExecutor)` → `True` (real subclass).
- `CodeResult.exit_code = 0`; witnessed output carried the marker plus the
  WitSeal footer.
- **Execution receipt: `rcpt_mq1j2n29JRFRxZvZS1uGWI`** (event
  `evt_mq1j2n29gKA0pNxlGFghXc`), action
  `shell: /bin/sh -c echo card-live-autogen-26571`, decision `allow`, exit `0`.
- `node dist/src/cli/index.js --data-dir <dir> verify` →
  `witseal: VALID ✓ (chain)` (2 events).

## Verdict

For the witnessed execution surface (shell code blocks through
`WitSealCommandLineCodeExecutor`), coverage is **Full of the witnessed toolset**
by fact: every executed shell block is witnessed with a verifiable receipt,
non-shell blocks are refused (no silent bypass), and the live seam produced a
receipt that `witseal verify` confirms **VALID**. golden `8fc29592` / 1050 bytes
untouched; the CLI was used unchanged.
