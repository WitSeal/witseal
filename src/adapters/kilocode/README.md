# Witnessed execution for Kilo Code

Integrates WitSeal with [Kilo Code](https://kilocode.ai) so the agent's shell
actions pass through the WitSeal pipeline (classify → policy → mediate →
witness → receipt) before they run.

## Model (B2 bash-shadow — WitSeal owns execution)

Kilo Code's engine is an OpenCode fork, so it resolves tools through the same
registry as OpenCode: a custom tool module whose id is `bash` — placed in a Kilo
tool directory — **overwrites** the built-in `bash` by last-writer-wins. This
adapter ships exactly that module: a same-name `bash` tool (the **default**
export) whose `execute` routes the command through the shipped OpenCode
mediation core (`mediateOpenCodeBash`). WitSeal own-executes the command via
`runExec`, so the result is a **full execution receipt** (`allowed_executed`, or
`denied_by_policy` when a Gate denial blocks it) — not merely a witnessed
decision.

The `bash` argument is a freeform shell command string, translated faithfully as
`/bin/sh -c "<command>"`. A freeform shell command is opaque to structural
classification, so the D8 shell-bypass rules correctly elevate it; policy can
still allow it.

This is a thin layer: it reuses the unchanged execution-result / witness schema
(no new wire-format) and the golden receipt is untouched.

## Install

1. `npm install -g @witseal/cli`
2. Drop a `bash.ts` tool module into Kilo Code's tool directory so it shadows the
   built-in `bash`. Use the global config tool dir
   (`$XDG_CONFIG_HOME/kilo/tool/bash.ts`, default `~/.config/kilo/tool/bash.ts`)
   or the project tool dir (`.kilo/tool/bash.ts`). Create it with the module
   below (it reuses WitSeal's shipped OpenCode mediation core — Kilo's engine is
   an OpenCode fork):

```typescript
import { tool } from '@opencode-ai/plugin';
import { mediateOpenCodeBash } from '@witseal/cli/adapters/opencode';

export default tool({
  description: 'Run a shell command, mediated and witnessed by WitSeal.',
  args: { command: tool.schema.string().describe('The shell command to run') },
  async execute(args) {
    const { exitCode, denied } = await mediateOpenCodeBash(
      { command: args.command, },
      {
        agentId: 'kilocode',
        dataDir: process.env.WITSEAL_DATA_DIR ?? `${process.env.HOME}/.witseal`,
      }
    );
    if (denied) throw new Error(`WitSeal denied this command (policy). Exit ${exitCode}.`);
    return `WitSeal-mediated execution finished with exit ${exitCode}. See the execution receipt for captured output.`;
  },
});
```

3. Point `WITSEAL_DATA_DIR` at your WitSeal data directory (or rely on the
   `~/.witseal` default), and load a policy pack into `<data-dir>/policy-packs/`.
   In Gate mode (default) WitSeal fails closed when no policy pack is loaded.

Because the custom tool's id matches the built-in `bash`, Kilo's registry
resolves `bash` to this module (last-writer-wins), so every shell command the
agent issues is mediated before it runs.

## Notes

- **Never bypasses WitSeal**: the command runs only via `runExec`. A Gate denial
  blocks execution (exit `100`) and is recorded as `denied_by_policy` — it is
  never silently caught and retried.
- The tool result is the mediation summary; the command's captured output lives
  in the execution receipt (`witseal receipt show <id>`).
- Run in `gate` mode (deny-by-default) for enforcement, or `witness` mode for
  observe-only attestation.
- Honesty ceiling and how to keep coverage Full: see `COVERAGE.md`.
