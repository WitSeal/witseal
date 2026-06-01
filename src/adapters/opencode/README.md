# OpenCode adapter

Integrates WitSeal with [OpenCode](https://opencode.ai) so the agent's shell
actions pass through the WitSeal pipeline (classify → policy → mediate →
witness → receipt) before they run.

## Model (Level 3 — WitSeal owns execution)

OpenCode lets a plugin define a **custom tool** whose `execute` runs code and
returns a result, and a custom tool named the same as a built-in **shadows**
it. So WitSeal registers a custom `bash` tool that own-executes the command
through `runExec`. The result is a **full execution receipt** (not merely a
witnessed decision): the command runs inside WitSeal's mediator, which captures
its output and records `allowed_executed` / `denied_by_policy` accordingly.

`mediateOpenCodeBash` (in `mediate.ts`) is the framework-agnostic core. It maps
the OpenCode `bash` argument — a freeform shell command string — to a faithful
shell invocation (`/bin/sh -c "<command>"`). A freeform shell command is opaque
to structural classification, so the D8 shell-bypass rules correctly elevate it;
policy can still allow it.

## Install

1. `npm install -g @witseal/cli`
2. Create `~/.config/opencode/tools/bash.ts` (global) or `.opencode/tools/bash.ts`
   (project) — shadowing the built-in `bash` tool:

```typescript
import { tool } from '@opencode-ai/plugin';
import { mediateOpenCodeBash } from '@witseal/cli/adapters/opencode';

export default tool({
  description: 'Run a shell command, mediated and witnessed by WitSeal.',
  args: { command: tool.schema.string().describe('The shell command to run') },
  async execute(args) {
    const { exitCode, denied } = await mediateOpenCodeBash(
      { command: args.command },
      { dataDir: process.env.WITSEAL_DATA_DIR ?? `${process.env.HOME}/.witseal` }
    );
    if (denied) throw new Error(`WitSeal denied this command (policy). Exit ${exitCode}.`);
    return `WitSeal-mediated; exit ${exitCode}. See the execution receipt for captured output.`;
  },
});
```

## Notes

- **Never bypasses WitSeal**: the command runs only via `runExec`. A Gate denial
  blocks execution (exit `100`) and is recorded as `denied_by_policy`.
- The tool result is the mediation summary; the command's captured output lives
  in the execution receipt (`witseal receipt show`).
- M1 mediates the `bash` tool. File-edit (`file_write`/`file_read`) and the
  end-to-end demo are later milestones (M2–M4).
