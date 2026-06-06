# Coverage — Witnessed execution for GitHub Copilot SDK

**Scope: Full execution coverage of the witnessed toolset.**

This adapter ships one WitSeal-authored tool, a GitHub Copilot SDK `Tool`
(`createWitsealCopilotTool` → `{ name, description, parameters, handler }`)
whose `handler` routes every command through WitSeal's mediation pipeline
(classify → policy → mediate → witness → receipt). When you register **only**
this tool as the agent's execution path, every shell command the agent runs is
a real, independently verifiable witnessed execution. It reuses the existing
execution-result / witness schema (no new wire-format); the golden receipt is
untouched.

## What is and is not witnessed

WitSeal witnesses the **authored tool it owns and executes** (own-execute). This
is the same honesty ceiling as the OpenHands adapter: the witness boundary is the
tool body, not the framework, the host, and not the model.

In scope (witnessed):

- Every command the agent runs through this WitSeal-authored tool. The tool body
  is the execution path, so the bytes that run are the bytes WitSeal mediates,
  and each call yields a full execution receipt (`allowed_executed`, or
  `denied_by_policy` when a Gate denial blocks it).

Out of scope (NOT witnessed):

- GitHub Copilot SDK runtime internals, the model/LLM, prompt handling, the host
  process, and agent control flow.
- The SDK's **built-in** tools (e.g. `bash` and other `BuiltInTools`) and any
  **other** tool you also register. If you leave a built-in execution tool
  enabled, or add a second shell / code-exec / file-write tool, that tool opens
  an unattested execution path and the Full-coverage claim no longer holds.
- Side effects the command itself spawns out of band (e.g. a daemon it
  launches).

## How to keep coverage Full

Compose the registered toolset so the witnessed tool **is** the execution path:

- Register the witnessed tool and restrict the session's available tools so no
  unwitnessed execution-capable built-in remains (use the SDK's `ToolSet` /
  `availableTools` to scope built-ins; pair the witnessed tool with
  non-executing tools only).
- Do **not** also enable a raw shell / code-exec tool — that reintroduces an
  unwitnessed path.
- Run in `gate` mode (deny-by-default) for enforcement, or `witness` mode for
  observe-only attestation.

## Live verification receipt (this build)

The SDK shape was confirmed against the installed package `@github/copilot-sdk`
`1.0.0`: `defineTool(name, { description, parameters, handler })` accepts the
adapter's `Tool` object verbatim (handler and parameters pass through by
identity). The execution path was then exercised by invoking the authored
tool's `handler` **directly** (no LLM), with the SDK-shaped second argument
(`ToolInvocation`: `sessionId` / `toolCallId` / `toolName`), on a real command
`echo card-live-copilot-50341`, under a throwaway `/tmp` data dir with a single
allow-rule policy pack in Gate mode:

- handler result: `WitSeal-mediated execution finished with exit 0.` (captured
  output carried the marker)
- execution receipt: `rcpt_mq1laky3RzxGUJ6weihogF` (event
  `evt_mq1laky3oa8uqmw1V0HC7h`)
- witnessed action: `shell: /bin/sh -c echo card-live-copilot-50341` — risk
  `C3`, decision `allow`, outcome `allowed_executed`, exit `0`, mode `gate`

Chain verification (`witseal verify`, live chain over the run's data dir):

```
witseal: VALID ✓ (chain)
         segment: default
         events:  2
```

## Verdict

For the witnessed execution surface (commands through this WitSeal-authored
tool), coverage is **Full of the witnessed toolset** by fact: every executed
command is witnessed with a verifiable receipt, the tool never bypasses the
boundary (the command runs only via `runExec`), a Gate denial blocks and is
recorded rather than silently bypassed, and the live invocation produced a
receipt that `witseal verify` confirms **VALID**. The claim is scoped to a
session where this tool is the execution path — it is not a claim over a
configuration that also enables an unwitnessed built-in or custom execution
tool. The golden receipt is untouched and the CLI was used unchanged.
