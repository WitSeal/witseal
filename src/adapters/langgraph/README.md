# LangGraph adapter (JS)

Integrates WitSeal with [LangGraph](https://docs.langchain.com) (JavaScript) by
the cheapest Level-3 path: **author the tool**. The tool you register is your
own code, so its body runs the action through WitSeal. WitSeal owns execution
(classify → policy → mediate → witness → receipt), so the call produces a full
execution receipt — not merely a witnessed decision.

## Model (Level 3 — WitSeal owns execution)

`mediateShellCommand` (in `../framework/mediate.ts`) is the framework-agnostic
core. A LangGraph tool's body calls it and returns its summary; the command
runs inside WitSeal's mediator, which captures the output and records the
outcome (`allowed_executed` / `denied_by_policy`).

## Supported versions

| Component | Minimum supported | Verified against |
|---|---|---|
| `@langchain/core` (provides `tool`) | `^1.0.0` | `1.1.48` |
| `@langchain/langgraph` | `^1.0.0` | `1.3.3` |

## Install

1. `npm install -g @witseal/cli` (or add `@witseal/cli` as a dependency)
2. Define a witnessed `shell` tool and bind it to your graph's model node:

```typescript
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { mediateShellCommand } from '@witseal/cli/adapters/framework';

const dataDir = process.env.WITSEAL_DATA_DIR ?? `${process.env.HOME}/.witseal`;

export const witsealShell = tool(
  async ({ command }: { command: string }) => {
    const { summary, output, denied } = await mediateShellCommand(
      { command },
      { dataDir, agentId: 'langgraph' }
    );
    if (denied) throw new Error(summary);
    return output.length > 0 ? `${summary}\n\n${output}` : summary;
  },
  {
    name: 'shell',
    description: 'Run a shell command, mediated and witnessed by WitSeal.',
    schema: z.object({
      command: z.string().describe('The shell command to run'),
    }),
  }
);
```

Bind it with `model.bindTools([witsealShell])` (or add it to your
`ToolNode`), exactly as you would any other LangGraph tool.

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
