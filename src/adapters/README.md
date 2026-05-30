# Agent Framework Adapters

This directory contains adapters that integrate WitSeal with specific AI coding agents and frameworks. An adapter's job is small but precise:

> Translate the agent's tool/action invocations into WitSeal `intent` calls, pass through results, and ensure every action passes through the WitSeal pipeline.

## Phase 1 status

- **OpenCode** — primary integration target; in development
- **Claude Code** — adapter sketched (Phase 1 stretch goal)
- **Cursor**, **Gemini CLI**, **OpenAI Agents SDK**, **LangGraph**, **CrewAI** — Phase 7

## Adapter contract

Every adapter must:

1. **Construct an `Intent`** from the agent's action proposal. No interpretation, no filtering — just structural translation.
2. **Pass the Intent to WitSeal** via the public API (`runExec` for shell, equivalents for other action types).
3. **Surface WitSeal's response** back to the agent in whatever protocol the agent expects.
4. **Never bypass WitSeal** — even on errors, the action must not execute outside the pipeline.

That is it. Adapters do not classify, evaluate policy, prompt for approval, or manage the chain. Those responsibilities belong to WitSeal core.

## What an adapter looks like

```typescript
import { runExec } from '@witseal/cli/exec';

// Pseudocode for an adapter to a hypothetical agent framework
agentFramework.onShellCommand(async (toolCall) => {
  const exitCode = await runExec({
    command: toolCall.executable,
    args: toolCall.args,
    agentId: agentFramework.identity,
    cwd: toolCall.cwd ?? process.cwd(),
    timeoutMs: toolCall.timeout ?? 0,
    dataDir: process.env.WITSEAL_DATA_DIR ?? `${process.env.HOME}/.witseal`,
    segmentId: 'default',
  });

  return { exit_code: exitCode };
});
```

The shape is intentionally boring. The interesting work happens inside `runExec` — classify, evaluate, mediate, witness, receipt. The adapter is just a thin translation layer.

## Writing a new adapter

1. **Open a tracking issue** with the title `Adapter: <framework name>` so others can coordinate.
2. **Read the framework's tool-call protocol** — most agent frameworks expose tool calls as a callable object, an event emitter, or an HTTP endpoint. Identify the exact entry point.
3. **Create a directory** under `src/adapters/<framework>/`.
4. **Implement the contract** above. Aim for less than 200 lines for a typical framework.
5. **Add tests** in `tests/adapters/<framework>.test.ts` that exercise:
   - Allowed action passes through
   - Denied action returns the framework's error/refusal mechanism
   - Approval-required action handles the approval correctly
   - Network or filesystem side effects do not occur on denial
6. **Document the integration** in `src/adapters/<framework>/README.md` with installation steps and any framework-specific gotchas.

## What adapters must NOT do

- Do not call `EventLog`, `PolicyEngine`, or `mediateShell` directly. Use the public `runExec` API.
- Do not maintain their own evidence state. The chain lives in WitSeal core.
- Do not embed policy logic. Policy belongs to policy packs, not adapter code.
- Do not catch `denied` outcomes silently and retry. A denial is a recorded event; treating it as a transient error breaks the trust property.

## License and attribution

Adapter contributions are accepted under Apache 2.0 (the project license). Contributors will be credited in `CHANGELOG.md` and (for major adapters) on the project website.
