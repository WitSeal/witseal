# Witnessed execution for Pi (TS)

Integrates WitSeal with [Pi](https://github.com/earendil-works/pi)
(`@earendil-works/pi-coding-agent`, MIT) — a minimal, deeply customizable
TypeScript terminal coding agent (built-in tools `read` / `write` / `edit` /
`bash`) — by the cheapest Level-3 path: **author the tool**. Pi lets an extension
register its own tool with `registerTool`, so the tool you register is your own
code and its `execute` body runs the action through WitSeal. WitSeal owns
execution (classify → policy → mediate → witness → receipt), so the call produces
a full execution receipt — not merely a witnessed decision.

Live-verified (2026-06-08): the authored tool's `execute` was invoked directly
(no LLM) through WitSeal on a real command, producing execution receipt
`rcpt_mq5wba3ekLx2l3VKnwDD69` (risk `C3`, outcome `allowed_executed`, exit `0`) →
`witseal verify` `VALID ✓ (chain)`. A deny-by-default run on the same path
returned a Pi tool error and recorded `denied_by_policy` (the command did not
run). "Full" is scoped to this WitSeal-authored tool; execution the agent
performs outside it is not covered (see [`COVERAGE.md`](./COVERAGE.md)).

## Model (Level 3 — WitSeal owns execution)

`createWitsealPiTool` (in `tool.ts`) returns the tool-definition object Pi's
`pi.registerTool({...})` expects — `{ name, label, description, parameters,
execute }` — already wired: `execute` is the witnessed tool body and the command
is read from the validated `params`. The body runs the command through WitSeal's
`runExec`, which captures the output and records the outcome (`allowed_executed`
/ `denied_by_policy`). The shared schema and body live in `../framework/tool.ts`;
this directory only shapes them for Pi (the openai-agents and mastra shims are
the sibling pattern — here `parameters` is a TypeBox-compatible schema and
`execute` returns Pi's `{ content, details }` result).

Pi's built-in `bash` tool also exposes an executor seam — `createBashTool(cwd, {
spawnHook })`, whose `spawnHook({ command, cwd, env })` can rewrite the spawned
command before it runs. That is a second own-execute route; this adapter takes
the `registerTool` route because it gives the agent a witnessed execution path
directly and reuses the shared tool body unchanged. Either way WitSeal owns the
bytes that run (see [`COVERAGE.md`](./COVERAGE.md)).

## Supported versions

| Component | Minimum supported | API confirmed against |
|---|---|---|
| `@earendil-works/pi-coding-agent` (provides `registerTool` / SDK) | `^0.78.0` | `0.78.x` |

> The custom-tool shape — `pi.registerTool({ name, label, description,
> parameters: Type.Object({...}), execute(toolCallId, params, signal, onUpdate,
> ctx) })`, where `parameters` is a [TypeBox](https://github.com/sinclairzx81/typebox)
> schema and `execute` returns `{ content: [{ type: 'text', text }], details }` —
> was confirmed against the project's extension docs and SDK examples on
> 2026-06-08. No `@earendil-works` or TypeBox package is imported by the adapter;
> the listed version is what an integrator binds it to.

## Install

1. `npm install -g @witseal/cli` (or add `@witseal/cli` as a dependency)
2. In a Pi extension, build the witnessed tool from the factory and register it:

```typescript
import { createWitsealPiTool } from '@witseal/cli/adapters/pi';

// `pi` is the extension API Pi passes to your extension entrypoint.
export default function activate(pi) {
  pi.registerTool(
    createWitsealPiTool({
      dataDir: process.env.WITSEAL_DATA_DIR ?? `${process.env.HOME}/.witseal`,
    })
  );
}
```

The tool's `execute` body — the part that runs the command through WitSeal — is
shipped and tested; the only line you write is the `pi.registerTool(...)`
binding. `createWitsealPiTool` also accepts `segmentId`, `agentId` (default
`pi`), `mode`, `timeoutMs`, `name` (the tool name, default `shell`),
`description`, `label`, and a `parameters` override.

> Schema note: Pi requires its `parameters` field to be a TypeBox schema, and a
> TypeBox `Type.Object(...)` is a JSON-Schema object at runtime — so the factory
> emits an equivalent JSON-Schema object literal by default (mirroring the shared
> `shellToolSchema`: `command` required, `cwd` optional), with no TypeBox package
> imported. To hand in the schema built with your own installed TypeBox, pass
> `parameters: Type.Object({ ... })`.

## Notes

- **Never bypasses WitSeal**: the command runs only via `runExec` inside
  `mediateShellCommand`. A Gate denial blocks execution and is recorded as
  `denied_by_policy`; the adapter returns Pi's error-shaped result
  (`isError: true`) so the agent sees the action did not run.
- The command's captured output is returned to the model as a `text` content
  block; the full evidence is in the execution receipt (`witseal receipt show`).
- Add at least one policy pack under `<WITSEAL_DATA_DIR>/policy-packs/`. With no
  policy pack, Gate mode fails closed (deny-by-default).
- A freeform shell command is opaque to structural classification, so the
  shell-bypass rules correctly elevate its risk; policy can still allow it.
- Pi ships no built-in authority boundary (it relies on sandboxing). Registering
  the witnessed tool as the execution path adds a deny-by-default policy gate
  with a verifiable receipt on top of whatever sandbox Pi runs in.
