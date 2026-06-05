# OpenAI Agents SDK adapter (JS)

Integrates WitSeal with the [OpenAI Agents SDK](https://openai.github.io/openai-agents-js/)
(JavaScript/TypeScript) by the cheapest Level-3 path: **author the tool**. The
function tool you register is your own code, so its `execute` body runs the
action through WitSeal. WitSeal owns execution (classify → policy → mediate →
witness → receipt), so the call produces a full execution receipt — not merely
a witnessed decision.

Live-verified (2026-06-05): invoking the authored tool's `execute` through
WitSeal produced execution receipt `rcpt_mq1dxdskTdRrdYxarTmEh0` → `witseal
verify` VALID (v0.1 receipt and v0.2 signed evidence package). "Full" is scoped
to this WitSeal-authored tool; execution the agent performs outside it is not
covered.

## Model (Level 3 — WitSeal owns execution)

`createWitsealShellTool` (in `tool.ts`) returns the config object the OpenAI
Agents SDK `tool({...})` helper expects, already wired: `execute` is the
witnessed tool body and `parameters` is the input schema. The body runs the
command through WitSeal's `runExec`, which captures the output and records the
outcome (`allowed_executed` / `denied_by_policy`). The shared schema and body
live in `../framework/tool.ts`; this directory only shapes them for the SDK.

The SDK's input/output validation features sit beside the model and would only
constrain an already-decided call (Level 2) — this shim authors the tool
instead, so WitSeal owns execution.

## Supported versions

| Component | Minimum supported | API confirmed against |
|---|---|---|
| `@openai/agents` (provides `tool`) | `^0.11.0` | `0.11.6` |

> The OpenAI Agents JS SDK is pre-1.0; the `tool({ name, description,
> parameters, execute })` shape is pinned to the `0.11.x` line. The signature was
> confirmed against the official documentation on 2026-06-01, and `0.11.6` was
> the current latest on npm that day. No `@openai` package is imported by the
> adapter — the listed version is what an integrator binds it to. Revisit the
> minimum when the SDK reaches 1.0.

## Install

1. `npm install -g @witseal/cli` (or add `@witseal/cli` as a dependency)
2. Build the witnessed `shell` function tool from the factory and pass it to your
   agent:

```typescript
import { Agent, tool } from '@openai/agents';
import { createWitsealShellTool } from '@witseal/cli/adapters/openai-agents';

export const witsealShell = tool(
  createWitsealShellTool({
    dataDir: process.env.WITSEAL_DATA_DIR ?? `${process.env.HOME}/.witseal`,
  })
);

export const agent = new Agent({
  name: 'witnessed-agent',
  instructions: 'Use the shell tool for any shell command.',
  tools: [witsealShell],
});
```

The tool's `execute` body — the part that runs the command through WitSeal — is
shipped and tested; the only line you write is the `tool(...)` binding.
`createWitsealShellTool` also accepts `segmentId`, `agentId` (default
`openai-agents`), `mode`, `timeoutMs`, and `name` / `description` overrides.

## Notes

- **Never bypasses WitSeal**: the command runs only via `runExec` inside
  `mediateShellCommand`. A Gate denial blocks execution and is recorded as
  `denied_by_policy`; the snippet surfaces it as a thrown error so the agent
  sees the action did not succeed.
- The command's captured output is returned to the model; the full evidence is
  in the execution receipt (`witseal receipt show`).
- Add at least one policy pack under `<WITSEAL_DATA_DIR>/policy-packs/`. With no
  policy pack, Gate mode fails closed (deny-by-default).
- A freeform shell command is opaque to structural classification, so the
  shell-bypass rules correctly elevate its risk; policy can still allow it.
