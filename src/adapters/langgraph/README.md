# LangGraph adapter (JS)

Integrates WitSeal with [LangGraph](https://docs.langchain.com) (JavaScript) by
the cheapest Level-3 path: **author the tool**. The tool you register is your
own code, so its body runs the action through WitSeal. WitSeal owns execution
(classify → policy → mediate → witness → receipt), so the call produces a full
execution receipt — not merely a witnessed decision.

## Model (Level 3 — WitSeal owns execution)

`createWitsealShellTool` (in `tool.ts`) returns the two arguments LangChain's
`tool(func, config)` expects, already wired: `func` is the witnessed tool body
and `config` carries the input schema, name, and description. The body runs the
command through WitSeal's `runExec`, which captures the output and records the
outcome (`allowed_executed` / `denied_by_policy`). The shared schema and body
live in `../framework/tool.ts`; this directory only shapes them for LangGraph.

LangGraph callbacks / `on_tool_end` would only observe an already-decided tool
call (Level 2) — this shim authors the tool instead, so WitSeal owns execution.

## Supported versions

| Component | Minimum supported | API confirmed against |
|---|---|---|
| `@langchain/core` (provides `tool`) | `^1.0.0` | `1.1.48` |
| `@langchain/langgraph` | `^1.0.0` | `1.3.3` |

> The `tool(func, { name, description, schema })` signature was confirmed
> against the official documentation on 2026-06-01; the versions above were the
> current latest on npm that day. No `@langchain` package is imported by the
> adapter — the listed versions are what an integrator binds it to.

## Install

1. `npm install -g @witseal/cli` (or add `@witseal/cli` as a dependency)
2. Build the witnessed `shell` tool from the factory and bind it to your graph's
   model node:

```typescript
import { tool } from '@langchain/core/tools';
import { createWitsealShellTool } from '@witseal/cli/adapters/langgraph';

const { func, config } = createWitsealShellTool({
  dataDir: process.env.WITSEAL_DATA_DIR ?? `${process.env.HOME}/.witseal`,
});

export const witsealShell = tool(func, config);
```

Bind it with `model.bindTools([witsealShell])` (or add it to your
`ToolNode`), exactly as you would any other LangGraph tool. The tool's body —
the part that runs the command through WitSeal — is the shipped, tested `func`;
the only line you write is the `tool(func, config)` binding.

`createWitsealShellTool` also accepts `segmentId`, `agentId` (default
`langgraph`), `mode`, `timeoutMs`, and `name` / `description` overrides.

## Notes

- **Never bypasses WitSeal**: the command runs only via `runExec` inside
  `mediateShellCommand`. A Gate denial blocks execution and is recorded as
  `denied_by_policy`; the snippet surfaces it as a thrown tool error so the
  graph sees the action did not succeed.
- The command's captured output is returned to the model; the full evidence is
  in the execution receipt (`witseal receipt show`).
- Add at least one policy pack under `<WITSEAL_DATA_DIR>/policy-packs/`. With no
  policy pack, Gate mode fails closed (deny-by-default).
- A freeform shell command is opaque to structural classification, so the
  shell-bypass rules correctly elevate its risk; policy can still allow it.
