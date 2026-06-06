# Witnessed execution for GitHub Copilot SDK (JS)

Integrates WitSeal with the [GitHub Copilot SDK](https://www.npmjs.com/package/@github/copilot-sdk)
(`@github/copilot-sdk`, JavaScript/TypeScript, Node ≥ 20) by the cheapest
Level-3 path: **author the tool**. The tool you register is your own code, so
its `handler` body runs the action through WitSeal. WitSeal owns execution
(classify → policy → mediate → witness → receipt), so the call produces a full
execution receipt — not merely a witnessed decision.

Live-verified (2026-06-05): invoking the authored tool's `handler` through
WitSeal produced execution receipt `rcpt_mq1laky3RzxGUJ6weihogF` (risk `C3`,
outcome `allowed_executed`, exit `0`) → `witseal verify` `VALID ✓ (chain)`.
"Full" is scoped to this WitSeal-authored tool; execution the agent performs
outside it is not covered (see `COVERAGE.md`).

## Model (Level 3 — WitSeal owns execution)

`createWitsealCopilotTool` (in `tool.ts`) returns the `Tool` object the GitHub
Copilot SDK consumes — `{ name, description, parameters, handler }` — already
wired: `handler` is the witnessed tool body and `parameters` is the input
schema. The body runs the command through WitSeal's `runExec`, which captures
the output and records the outcome (`allowed_executed` / `denied_by_policy`).
The shared schema and body live in `../framework/tool.ts`; this directory only
shapes them for the SDK.

The SDK's permission prompts and pre/post tool-use hooks sit beside the model
and would only observe or gate an already-decided call (Level 2) — this shim
authors the tool instead, so WitSeal owns execution.

## Supported versions

| Component | Minimum supported | API confirmed against |
|---|---|---|
| `@github/copilot-sdk` (provides `defineTool` / `createSession`) | `^1.0.0` | `1.0.0` |

> The `defineTool(name, { description, parameters, handler })` shape and the
> `Tool` object (`{ name, description, parameters, handler }`) were confirmed
> against the installed package `@github/copilot-sdk` `1.0.0` on 2026-06-05
> (`ToolHandler<TArgs> = (args, invocation) => Promise<unknown> | unknown`). No
> `@github/copilot-sdk` package is imported by the adapter — the listed version
> is what an integrator binds it to.

## Install

1. `npm install -g @witseal/cli` (or add `@witseal/cli` as a dependency)
2. Build the witnessed `shell` tool from the factory and register it with your
   session:

```typescript
import { CopilotClient, defineTool } from '@github/copilot-sdk';
import { createWitsealCopilotTool } from '@witseal/cli/adapters/copilot';

const witsealShell = createWitsealCopilotTool({
  dataDir: process.env.WITSEAL_DATA_DIR ?? `${process.env.HOME}/.witseal`,
});

const client = new CopilotClient(/* ... */);
const session = await client.createSession({
  // The Tool object is consumed directly; defineTool(name, t) is equivalent
  // and adds handler-argument type inference.
  tools: [defineTool(witsealShell.name, witsealShell)],
});
```

The tool's `handler` body — the part that runs the command through WitSeal — is
shipped and tested; the only line you write is the registration.
`createWitsealCopilotTool` also accepts `segmentId`, `agentId` (default
`github-copilot-sdk`), `mode`, `timeoutMs`, and `name` / `description`
overrides.

> Schema note: the SDK reads `parameters.toJSONSchema()` to advertise the tool
> to the model, which the Zod the SDK ships (Zod 4) provides. The witnessed
> body validates and runs the command regardless of how the schema is
> serialized; if you bind against an older Zod, pass a JSON-schema object for
> `parameters` instead (the SDK accepts `ZodSchema | Record<string, unknown>`).

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
