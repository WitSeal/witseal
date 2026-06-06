# Coverage — Witnessed execution for Mastra

**Scope: Full execution coverage of the witnessed toolset.**

This adapter ships one WitSeal-authored tool, a Mastra tool config
(`createWitsealMastraTool` → `{ id, description, inputSchema, execute }`) whose
`execute` routes every command through WitSeal's mediation pipeline (classify →
policy → mediate → witness → receipt). When you register **only** this tool as
the agent's execution path, every shell command the agent runs is a real,
independently verifiable witnessed execution. It reuses the existing
execution-result / witness schema (no new wire-format); the golden receipt is
untouched and the CLI is used unchanged.

## What is and is not witnessed

WitSeal witnesses the **authored tool it owns and executes** (own-execute). This
is the same honesty ceiling as the OpenHands adapter: the witness boundary is
the tool body, not the framework, not the host, and not the model.

In scope (witnessed):

- Every command the agent runs through this WitSeal-authored tool. The tool body
  is the execution path, so the bytes that run are the bytes WitSeal mediates,
  and each call yields a full execution receipt (`allowed_executed`, or
  `denied_by_policy` when a Gate denial blocks it).

Out of scope (NOT witnessed):

- Mastra runtime internals, the model/LLM, prompt handling, memory, workflows,
  the host process, and agent control flow.
- Any **other** tool you also register. If you add a second shell / code-exec /
  file-write tool, that tool opens an unattested execution path and the
  Full-coverage claim no longer holds.
- Side effects the command itself spawns out of band (e.g. a daemon it
  launches).

## How to keep coverage Full

Compose the registered toolset so the witnessed tool **is** the execution path:

- Register the witnessed `shell` tool and do **not** also register a raw shell /
  code-exec / file-write tool — that reintroduces an unwitnessed path. Pair the
  witnessed tool with non-executing tools only.
- Run in `gate` mode (deny-by-default) for enforcement, or `witness` mode for
  observe-only attestation.

## Live verification receipt (this build)

The SDK shape was confirmed against the installed package `@mastra/core`
`1.41.0`: `createTool({ id, description, inputSchema, execute })` (exported from
`@mastra/core/tools`) accepted the adapter's config verbatim — `createTool(cfg)`
returned a `Tool` instance without error (`id` `shell`, `execute` and
`inputSchema` carried through by identity). The execution path was then
exercised by invoking the authored tool's `execute` **directly** (no LLM) on a
real command `echo card-live-mastra-263929692`, under a throwaway `/tmp` data
dir with a single allow-default policy pack in Gate mode:

- execute result: `WitSeal-mediated execution finished with exit 0.` (captured
  output carried the marker)
- execution receipt: `rcpt_mq1p7xs79L42AJdPFe4xtg` (event
  `evt_mq1p7xs7rErBU6frh1Xa93`)
- witnessed action: `shell: /bin/sh -c echo card-live-mastra-263929692` — risk
  `C3`, decision `allow`, outcome `allowed_executed`, exit `0`, mode `gate`

Chain verification (`witseal verify`, live chain over the run's data dir, CLI
used unchanged):

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
configuration that also registers an unwitnessed execution tool. The golden
receipt is untouched and the CLI was used unchanged.
