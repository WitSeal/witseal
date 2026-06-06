# Coverage — Witnessed execution for AWS Strands Agents

**Scope: Full execution coverage of the witnessed toolset.**

This adapter ships one WitSeal-authored tool, `witnessed_shell`, a Strands
`@tool` whose body routes every command through WitSeal's mediation pipeline
(classify -> policy -> mediate -> witness -> receipt). When you grant the agent
**only** this tool as its execution path — `Agent(tools=build_witnessed_toolset())`
— every shell command the agent runs is a real, independently verifiable
witnessed execution.

## What is and is not witnessed

WitSeal witnesses the **authored tool it owns and executes** (own-execute). This
is the same honesty ceiling as the OpenHands adapter: the witness boundary is the
tool body, not the framework.

In scope (witnessed):

- Every command the agent runs through the `witnessed_shell` tool. The tool body
  is the execution path, so the bytes that run are the bytes WitSeal mediates,
  and each call yields an execution receipt.

Out of scope (NOT witnessed):

- Strands runtime internals, the model/LLM, prompt handling, and agent control flow.
- Any **other** tool you also grant the agent. If you add an unwrapped `shell`,
  `python_repl`, `file_write`, or a custom tool that shells out, that tool opens
  an unattested execution path and the Full-coverage claim no longer holds.
- Side effects the command itself spawns out of band (e.g. a daemon it launches).

## How to keep coverage Full

Compose the granted toolset so the witnessed tool **is** the execution path:

- Grant `build_witnessed_toolset()` (only `witnessed_shell`), or include
  `witnessed_shell` alongside non-executing tools only.
- Do **not** also grant a raw shell / code-exec tool — that reintroduces an
  unwitnessed path.
- Run the tool in `gate` mode (`WITSEAL_MODE=gate`, deny-by-default) for
  enforcement, or `witness` mode for observe-only attestation.

## Live verification receipt (this build)

Exercised on `strands-agents 1.42.0` by driving the genuine framework tool path
(`DecoratedFunctionTool.stream` with a constructed `tool_use` — the same call the
Agent makes for an LLM-emitted tool use) on a real command
`echo card-live-aws-strands-26603`:

- toolResult status: `success`
- receipt id (framework `stream` path): `rcpt_mq1j2vipaec2IBrjVvTwCB`
- receipt id (direct `__call__` path):  `rcpt_mq1j2vl3ukuaFB9lJB5j7N`
- witnessed action: `shell: /bin/sh -c echo card-live-aws-strands-26603` — decision `allow`, exit `0`

Chain verification (`witseal verify`, live chain over the run's data dir):

```
witseal: VALID ✓ (chain)
         segment: default
         events:  4
```
