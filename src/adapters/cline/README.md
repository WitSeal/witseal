# Witnessed execution for Cline

Integrates WitSeal with [Cline](https://github.com/cline/cline) (the
open-source, Apache-2.0 VS Code agent) by the cheapest Level-3 path: **author
the tool**. The tool you register is your own code, so its `execute` body runs
the action through WitSeal. WitSeal owns execution (classify → policy → mediate
→ witness → receipt), so the call produces a full execution receipt — not
merely a witnessed decision.

Live-verified (2026-06-08): invoking the authored tool's `execute` through
WitSeal produced execution receipt `rcpt_mq5wa0c5zfCfsMpHELZLjS` (risk `C3`,
outcome `allowed_executed`, exit `0`) → `witseal verify` `VALID ✓ (chain)`.
"Full" is scoped to this WitSeal-authored tool; execution the agent performs
outside it is not covered (see `COVERAGE.md`).

## Model (Level 3 — WitSeal owns execution)

`createWitsealClineTool` (in `tool.ts`) returns the tool object Cline's
plugin/tool SDK consumes — `{ name, description, inputSchema, execute }` —
already wired: `execute` is the witnessed tool body and `inputSchema` is the
input schema. The body runs the command through WitSeal's `runExec`, which
captures the output and records the outcome (`allowed_executed` /
`denied_by_policy`). The shared schema and body live in `../framework/tool.ts`;
this directory only shapes them for the SDK.

Cline's approval prompts and auto-approve settings sit beside the model and
would only observe or gate an already-decided call (Level 2) — this shim
authors the tool instead, so WitSeal owns execution.

## Supported versions

| Component | Minimum supported | API shape |
|---|---|---|
| Cline plugin/tool SDK (provides `createTool` / `AgentPlugin.setup(api).registerTool`) | current | `createTool({ name, description, inputSchema, execute })` |

> The `createTool({ name, description, inputSchema, execute })` shape and the
> `AgentPlugin.setup(api) { api.registerTool(tool) }` registration entry point
> are what an integrator binds the adapter to. No Cline package is imported by
> the adapter — `createWitsealClineTool` returns a plain object that
> `createTool` consumes and `registerTool` accepts, so the witseal runtime
> keeps its minimal dependency set.

## Install

1. `npm install -g @witseal/cli` (or add `@witseal/cli` as a dependency)
2. Build the witnessed `shell` tool from the factory and register it from your
   plugin's `setup`:

```typescript
import { createTool, type AgentPlugin } from 'cline';
import { createWitsealClineTool } from '@witseal/cli/adapters/cline';

const witsealShell = createTool(
  createWitsealClineTool({
    dataDir: process.env.WITSEAL_DATA_DIR ?? `${process.env.HOME}/.witseal`,
  })
);

export const plugin: AgentPlugin = {
  name: 'witseal-witnessed-shell',
  setup(api) {
    api.registerTool(witsealShell);
  },
};
```

The tool's `execute` body — the part that runs the command through WitSeal — is
shipped and tested; the only line you write is the registration.
`createWitsealClineTool` also accepts `segmentId`, `agentId` (default `cline`),
`mode`, `timeoutMs`, and `name` / `description` overrides.

> Envelope note: Cline calls a registered tool's `execute` with a context
> envelope whose `input` field carries the validated arguments (plus
> task / tool-call ids and an abort signal). The shipped body accepts that
> envelope and a bare input alike, so it runs the command regardless of how the
> host passes the arguments.

## Notes

- **Never bypasses WitSeal**: the command runs only via `runExec` inside
  `mediateShellCommand`. A Gate denial blocks execution and is recorded as
  `denied_by_policy`; the body surfaces it as a thrown error so the agent sees
  the action did not succeed.
- The command's captured output is returned to the model; the full evidence is
  in the execution receipt (`witseal receipt show`).
- Add at least one policy pack under `<WITSEAL_DATA_DIR>/policy-packs/`. With no
  policy pack, Gate mode fails closed (deny-by-default).
- A freeform shell command is opaque to structural classification, so the
  shell-bypass rules correctly elevate its risk; policy can still allow it.
- Honesty ceiling and how to keep coverage Full: see `COVERAGE.md`.
