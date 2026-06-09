# Coverage — Witnessed execution for Pi

**Scope: Full execution coverage of the witnessed toolset.**

This adapter ships one WitSeal-authored tool, a Pi tool definition
(`createWitsealPiTool` → `{ name, label, description, parameters, execute }`)
whose `execute` routes every command through WitSeal's mediation pipeline
(classify → policy → mediate → witness → receipt). When you register **only**
this tool as the agent's execution path, every shell command the agent runs is a
real, independently verifiable witnessed execution. It reuses the existing
execution-result / witness schema (no new wire-format); the golden receipt is
untouched and the CLI is used unchanged.

## What is and is not witnessed

WitSeal witnesses the **authored tool it owns and executes** (own-execute). The
witness boundary is the tool body, not the framework, not the host, and not the
model.

In scope (witnessed):

- Every command the agent runs through this WitSeal-authored tool. The tool body
  is the execution path, so the bytes that run are the bytes WitSeal mediates,
  and each call yields a full execution receipt (`allowed_executed`, or
  `denied_by_policy` when a Gate denial blocks it).

Out of scope (NOT witnessed):

- Pi runtime internals, the model/LLM, prompt handling, sessions, extensions,
  the host process, and agent control flow.
- Pi's own **built-in** `bash` / `read` / `write` / `edit` tools, if you leave
  them enabled. Pi selects its built-in toolset via a `tools` array; any
  execution-capable built-in you keep is an unattested execution path.
- Any **other** tool you also register. If you add a second shell / code-exec /
  file-write tool, that tool opens an unattested execution path and the
  Full-coverage claim no longer holds.
- Side effects the command itself spawns out of band (e.g. a daemon it
  launches).

## How to keep coverage Full

Compose the registered toolset so the witnessed tool **is** the execution path:

- Register the witnessed `shell` tool and restrict Pi's built-in toolset to
  non-executing tools — i.e. do **not** leave the built-in `bash` (or any
  write/edit) tool enabled alongside it, and do not register a second raw shell /
  code-exec / file-write tool. Pair the witnessed tool with read-only tools only.
- Run in `gate` mode (deny-by-default) for enforcement, or `witness` mode for
  observe-only attestation.

> Alternative own-execute route (also Full, not used here): Pi's built-in `bash`
> tool accepts `createBashTool(cwd, { spawnHook })`, and the `spawnHook` can
> rewrite the spawned `{ command, cwd, env }`. Routing that hook through WitSeal
> would witness the built-in `bash` path itself. This adapter instead registers
> its own tool body (reusing the shared `runShellTool`), which is the same
> Level-3 own-execute guarantee with one less moving part.

## Live verification receipt (this build)

The tool shape was confirmed against Pi's extension docs and SDK examples on
2026-06-08: a custom tool is `pi.registerTool({ name, label, description,
parameters, execute })`, `parameters` is a TypeBox schema (a JSON-Schema object
at runtime), and `execute(toolCallId, params, …)` returns `{ content: [{ type:
'text', text }], details }`. The factory produces exactly that object (`name`
`shell`, a JSON-Schema `parameters` mirroring the shared input schema, and an
`execute` that wraps the shared witnessed body). The execution path was then
exercised by invoking the authored tool's `execute` **directly** (no LLM) on a
real command `echo card-live-pi-3198118131`, under a throwaway data dir with a
single allow-default policy pack in Gate mode:

- execute result: `{ content: [{ type: 'text', text: "WitSeal-mediated
  execution finished with exit 0. …\n\ncard-live-pi-3198118131\n" }], details: {} }`
  (captured output carried the marker)
- execution receipt: `rcpt_mq5wba3ekLx2l3VKnwDD69` (event
  `evt_mq5wba3ePeLEc5QSeZwSDc`)
- witnessed action: `shell: /bin/sh -c echo card-live-pi-3198118131` — risk
  `C3`, decision `allow`, outcome `allowed_executed`, exit `0`, mode `gate`

Chain verification (`witseal verify`, live chain over the run's data dir, CLI
used unchanged):

```
witseal: VALID ✓ (chain)
         segment: default
         events:  2
```

Deny-by-default path (separate run, deny-default policy pack, Gate mode): the
same `execute` on a command the policy denies returned Pi's error-shaped result
(`{ …, isError: true }`, text "WitSeal denied this command by policy (exit 100).
It was recorded as evidence and did not run.") and the event recorded
`outcome=denied_by_policy` (decision `deny`, risk `C4`); that evidence chain also
verified `VALID ✓ (chain)`. The command did not run — the denial is real
enforcement, not a post-hoc note.

## Verdict

For the witnessed execution surface (commands through this WitSeal-authored
tool), coverage is **Full of the witnessed toolset** by fact: every executed
command is witnessed with a verifiable receipt, the tool never bypasses the
boundary (the command runs only via `runExec`), a Gate denial blocks and is
recorded rather than silently bypassed, and the live invocation produced a
receipt that `witseal verify` confirms **VALID**. The claim is scoped to a
session where this tool is the execution path — it is not a claim over a
configuration that also leaves Pi's built-in `bash` enabled or registers another
unwitnessed execution tool. The golden receipt is untouched and the CLI was used
unchanged.
