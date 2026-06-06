# Witnessed execution for Mastra (TS)

Integrates WitSeal with [Mastra](https://mastra.ai) (`@mastra/core`,
TypeScript/Node) by the cheapest Level-3 path: **author the tool**. The tool you
register with `createTool` is your own code, so its `execute` body runs the
action through WitSeal. WitSeal owns execution (classify → policy → mediate →
witness → receipt), so the call produces a full execution receipt — not merely a
witnessed decision.

Live-verified (2026-06-05): `createTool({...})` accepted the adapter's config
verbatim (a `Tool` constructed without error), then invoking the authored tool's
`execute` directly (no LLM) through WitSeal produced execution receipt
`rcpt_mq1p7xs79L42AJdPFe4xtg` (risk `C3`, outcome `allowed_executed`, exit `0`) →
`witseal verify` `VALID ✓ (chain)`. "Full" is scoped to this WitSeal-authored
tool; execution the agent performs outside it is not covered (see
[`COVERAGE.md`](./COVERAGE.md)).

## Model (Level 3 — WitSeal owns execution)

`createWitsealMastraTool` (in `tool.ts`) returns the config object the Mastra
`createTool({...})` helper expects — `{ id, description, inputSchema, execute }`
— already wired: `execute` is the witnessed tool body and `inputSchema` is the
input schema. The body runs the command through WitSeal's `runExec`, which
captures the output and records the outcome (`allowed_executed` /
`denied_by_policy`). The shared schema and body live in `../framework/tool.ts`;
this directory only shapes them for the SDK (the openai-agents shim is the
sibling pattern — `name` → `id`, `parameters` → `inputSchema`).

Mastra's input/output schema validation sits beside the model and would only
constrain an already-decided call (Level 2) — this shim authors the tool
instead, so WitSeal owns execution.

## Supported versions

| Component | Minimum supported | API confirmed against |
|---|---|---|
| `@mastra/core` (provides `createTool`) | `^1.41.0` | `1.41.0` |

> The `createTool({ id, description, inputSchema, execute })` shape was confirmed
> against the installed package `@mastra/core` `1.41.0` on 2026-06-05:
> `createTool` is exported from `@mastra/core/tools`, `inputSchema` is a Zod
> schema, and `execute` is the local async fn the tool runs. No `@mastra`
> package is imported by the adapter — the listed version is what an integrator
> binds it to.

## Install

1. `npm install -g @witseal/cli` (or add `@witseal/cli` as a dependency)
2. Build the witnessed `shell` tool from the factory and pass its config to
   `createTool`, then register it with your agent:

```typescript
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { createWitsealMastraTool } from '@witseal/cli/adapters/mastra';

export const witsealShell = createTool(
  createWitsealMastraTool({
    dataDir: process.env.WITSEAL_DATA_DIR ?? `${process.env.HOME}/.witseal`,
  })
);

export const agent = new Agent({
  name: 'witnessed-agent',
  instructions: 'Use the shell tool for any shell command.',
  model: /* your model */ undefined as never,
  tools: { shell: witsealShell },
});
```

The tool's `execute` body — the part that runs the command through WitSeal — is
shipped and tested; the only line you write is the `createTool(...)` binding.
`createWitsealMastraTool` also accepts `segmentId`, `agentId` (default
`mastra`), `mode`, `timeoutMs`, and `name` (the tool `id`) / `description`
overrides.

> Invocation note: Mastra calls a tool's `execute` with an execution-context
> envelope whose `context` field carries the validated input. The adapter's
> `execute` accepts that envelope (and a bare input, for a direct call) and
> unwraps it before mediation, so the command is read from `context.command`
> regardless of how Mastra invokes it.

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
