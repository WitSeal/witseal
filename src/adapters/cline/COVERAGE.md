# Coverage — Witnessed execution for Cline

**Scope: Full execution coverage of the witnessed `shell` tool.**

This adapter ships one WitSeal-authored tool, a Cline tool object
(`createWitsealClineTool` → `{ name, description, inputSchema, execute }`) whose
`execute` routes every command through WitSeal's mediation pipeline (classify →
policy → mediate → witness → receipt). When you register **only** this tool as
the agent's execution path, every shell command the agent runs is a real,
independently verifiable witnessed execution. It reuses the existing
execution-result / witness schema (no new wire-format); the golden receipt is
untouched.

## What is and is not witnessed

WitSeal witnesses the **authored tool it owns and executes** (own-execute). This
is the same honesty ceiling as the OpenHands and Copilot adapters: the witness
boundary is the tool body, not the framework, not the host, and not the model.

In scope (witnessed):

- Every command the agent runs through this WitSeal-authored tool. The tool body
  is the execution path, so the bytes that run are the bytes WitSeal mediates,
  and each call yields a full execution receipt (`allowed_executed`, or
  `denied_by_policy` when a Gate denial blocks it).

Out of scope (NOT witnessed):

- Cline host internals, the model/LLM, prompt handling, the editor/host process,
  and agent control flow. This is **not** a claim over all host traffic.
- Cline's **built-in** execution tools (e.g. its native command/terminal tool)
  and any **other** tool you also register. If you leave a built-in execution
  tool enabled, or add a second shell / code-exec / file-write tool, that tool
  opens an unattested execution path and the Full-coverage claim no longer
  holds.
- Side effects the command itself spawns out of band (e.g. a daemon it
  launches).

## How to keep coverage Full

Compose the registered toolset so the witnessed tool **is** the execution path:

- Register the witnessed tool from your plugin's `setup` and restrict the
  agent's available execution tools so no unwitnessed execution-capable built-in
  remains (pair the witnessed tool with non-executing tools only).
- Do **not** also enable a raw shell / terminal / code-exec tool — that
  reintroduces an unwitnessed path.
- Run in `gate` mode (deny-by-default) for enforcement, or `witness` mode for
  observe-only attestation.

## Override status — honest

- **API-shape confirmed.** The shim is a plain object accepted by Cline's
  `createTool({ name, description, inputSchema, execute })` helper and registered
  through `AgentPlugin.setup(api) { api.registerTool(tool) }`. `execute` and
  `inputSchema` pass through by identity; the registration is the only line the
  integrator writes.
- **Execution path live-verified (2026-06-08).** The path was exercised by
  building the tool with `createWitsealClineTool` and invoking its `execute`
  **directly** (no LLM), with Cline's context envelope (`{ input }`, plus
  `taskId` / `toolCallId`), on a real command. It produced a full execution
  receipt that `witseal verify` confirms VALID (below). What was **not** run is
  the full Cline agent loop with the model emitting the tool call — that needs a
  running Cline host and an LLM key; the execution-path VALID is the baseline.

## Live verification receipt (this build)

The execution path was exercised by invoking the authored tool's `execute`
**directly** (no LLM), with the SDK-shaped context envelope (`{ input }`, plus
`taskId` / `toolCallId`), on a real command `echo card-live-cline-50341`, under
a throwaway temp data dir with a single allow-rule policy pack in Gate mode
(default-deny):

- execute result: `WitSeal-mediated execution finished with exit 0.` (captured
  output carried the marker)
- execution receipt: `rcpt_mq5wa0c5zfCfsMpHELZLjS` (event
  `evt_mq5wa0c5oDaq1fzFYoSf1P`)
- witnessed action: `shell: /bin/sh -c echo card-live-cline-50341` — risk `C3`,
  decision `allow`, outcome `allowed_executed`, exit `0`, mode `gate`

Chain verification (`witseal verify`, live chain over the run's data dir):

```
witseal: VALID ✓ (chain)
         segment: default
         events:  2
```

## Verdict

For the witnessed execution surface (commands through this WitSeal-authored
tool), coverage is **Full of the witnessed tool** by fact: every executed
command is witnessed with a verifiable receipt, the tool never bypasses the
boundary (the command runs only via `runExec`), a Gate denial blocks and is
recorded rather than silently bypassed, and the live invocation produced a
receipt that `witseal verify` confirms **VALID**. The claim is scoped to a
session where this tool is the execution path — it is not a claim over a
configuration that also enables an unwitnessed built-in or custom execution
tool, nor over Cline host internals. The golden receipt is untouched and the CLI
was used unchanged.
