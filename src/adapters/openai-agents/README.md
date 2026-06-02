# OpenAI Agents SDK adapter (JS)

Integrates WitSeal with the [OpenAI Agents SDK](https://openai.github.io/openai-agents-js/)
(JavaScript/TypeScript) by the cheapest Level-3 path: **author the tool**. The
function tool you register is your own code, so its `execute` body runs the
action through WitSeal. WitSeal owns execution (classify → policy → mediate →
witness → receipt), so the call produces a full execution receipt — not merely
a witnessed decision.

## Model (Level 3 — WitSeal owns execution)

`mediateShellCommand` (in `../framework/mediate.ts`) is the framework-agnostic
core. A function tool's `execute` calls it and returns its summary; the command
runs inside WitSeal's mediator, which captures the output and records the
outcome (`allowed_executed` / `denied_by_policy`).

## Supported versions

| Component | Minimum supported | Verified against |
|---|---|---|
| `@openai/agents` (provides `tool`) | `^0.11.0` | `0.11.6` |

> The OpenAI Agents JS SDK is pre-1.0; the `tool({ name, description,
> parameters, execute })` shape is pinned to the `0.11.x` line. Revisit the
> minimum when the SDK reaches 1.0.

## Install

1. `npm install -g @witseal/cli` (or add `@witseal/cli` as a dependency)
2. Define a witnessed `shell` function tool and pass it to your agent:

```typescript
import { Agent, tool } from '@openai/agents';
import { z } from 'zod';
import { mediateShellCommand } from '@witseal/cli/adapters/framework';

const dataDir = process.env.WITSEAL_DATA_DIR ?? `${process.env.HOME}/.witseal`;

export const witsealShell = tool({
  name: 'shell',
  description: 'Run a shell command, mediated and witnessed by WitSeal.',
  parameters: z.object({
    command: z.string().describe('The shell command to run'),
  }),
  async execute({ command }) {
    const { summary, output, denied } = await mediateShellCommand(
      { command },
      { dataDir, agentId: 'openai-agents' }
    );
    if (denied) throw new Error(summary);
    return output.length > 0 ? `${summary}\n\n${output}` : summary;
  },
});

export const agent = new Agent({
  name: 'witnessed-agent',
  instructions: 'Use the shell tool for any shell command.',
  tools: [witsealShell],
});
```

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
