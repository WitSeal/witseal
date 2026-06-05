# Temporal adapter

Integrates WitSeal with [Temporal](https://temporal.io) so a workflow's shell
work passes through the WitSeal pipeline (classify → policy → mediate → witness
→ receipt). Two levels, matching what Temporal lets an integration do:

- **Level 3 (own-execute)** — `witnessedShell`, registered as an Activity. The
  cheap Level-3 path: an Activity is your own function, so its body runs the
  command through WitSeal and WitSeal **owns execution**. The call yields a
  **full execution receipt**, not merely a witnessed decision. Live-verified
  (2026-06-05): `witnessedShell` run as an Activity produced execution receipt
  `rcpt_mq1dxtszhOBzERBqPoKjcC` → `witseal verify` VALID (v0.1 receipt and v0.2
  signed evidence package). "Full" is scoped to this WitSeal-owned Activity.
- **Level 2 (observe)** — an `ActivityInboundCallsInterceptor` that witnesses an
  Activity you do **not** own (a shell step in a third-party Activity). WitSeal
  observes the result and records a Level-2 witness event; it does not execute.

## Why an Activity (and never a Workflow)

Temporal requires that *"Workflow code must be deterministic to support
replay,"* and that to handle non-deterministic operations *"like API calls …
and other external interactions, put them in Activities"* (Temporal docs,
*Workflow Definition*). Running a subprocess is non-deterministic, so witnessed
execution belongs in an **Activity**. The Level-2 interceptor likewise records
evidence from inside an **Activity** interceptor — never a Workflow interceptor,
which may not perform I/O.

## Model (Level 3 — WitSeal owns execution)

`witnessedShell` (in `activity.ts`) is a thin, Temporal-aware entry over the
shared framework mediation core (`../framework/mediate.ts`) — the same primitive
the LangGraph and OpenAI Agents SDK tool shims call. Register it as an Activity;
the command runs inside WitSeal's mediator, which captures the output and
records the outcome (`allowed_executed` / `denied_by_policy`).

## Model (Level 2 — observe, do not execute)

`recordActivityWitness` / `WitnessActivityInbound` (in `interceptor.ts`) consume
what an Activity already did — its arguments and result (or error) — and record
a Level-2 witness event. They witness **only** activities a caller-supplied
mapper recognizes as a shell execution (the same shape discipline as the Claude
Code adapter, which witnesses only the `Bash` tool); any other activity runs
untouched. Recording never changes the activity's result and never swallows its
error.

## Supported versions

| Component | Minimum supported | Verified against |
|---|---|---|
| `temporalio` (`@temporalio/worker`, `@temporalio/activity`, `@temporalio/workflow`) | `>= 1.0.0` (1.x stable line) | `1.17.2` |

The `ActivityInboundCallsInterceptor.execute(input, next)` contract and the
Activity model this integration relies on are stable across the Temporal
TypeScript SDK 1.x line. Interceptors are registered through
`interceptors.activity` (an array of factory functions); `interceptors.activityInbound`
is the older spelling and is deprecated in current releases. Both are shown
below so any 1.x release works.

## Install — Level 3 (witnessed Activity)

1. `npm install -g @witseal/cli` (or add `@witseal/cli` as a dependency)
2. Define a witnessed `shell` Activity:

```typescript
// activities.ts
import { Context } from '@temporalio/activity';
import { witnessedShell } from '@witseal/cli/adapters/temporal';

const dataDir = process.env.WITSEAL_DATA_DIR ?? `${process.env.HOME}/.witseal`;

export async function shell(command: string): Promise<{ exitCode: number; output: string }> {
  const { exitCode, output, denied, summary } = await witnessedShell(
    { command },
    { dataDir, info: Context.current().info } // info → correlation in agent_identifier
  );
  if (denied) throw new Error(summary); // a Gate denial fails the Activity
  return { exitCode, output };
}
```

3. Register the Activity on your Worker and call it from a Workflow as usual:

```typescript
// worker.ts
import { Worker } from '@temporalio/worker';
import * as activities from './activities.js';

const worker = await Worker.create({
  taskQueue: 'witseal',
  workflowsPath: require.resolve('./workflows'),
  activities,
});
await worker.run();
```

```typescript
// workflows.ts
import { proxyActivities } from '@temporalio/workflow';

const { shell } = proxyActivities<typeof import('./activities.js')>({
  startToCloseTimeout: '1 minute',
});

export async function example(): Promise<{ exitCode: number; output: string }> {
  return shell('echo hello'); // witnessed: a full execution receipt is recorded
}
```

## Install — Level 2 (witness an Activity you do not own)

Register an inbound interceptor that maps the foreign Activity's args/result to a
shell observation and records it. The Activity runs itself; WitSeal observes.

```typescript
// interceptors.ts
import type {
  ActivityInboundCallsInterceptor,
  ActivityExecuteInput,
  Next,
} from '@temporalio/worker';
import { Context } from '@temporalio/activity';
import { recordActivityWitness } from '@witseal/cli/adapters/temporal';

const dataDir = process.env.WITSEAL_DATA_DIR ?? `${process.env.HOME}/.witseal`;

function witnessInbound(): ActivityInboundCallsInterceptor {
  return {
    async execute(input: ActivityExecuteInput, next: Next<ActivityInboundCallsInterceptor, 'execute'>) {
      const result = await next(input); // the foreign Activity executes itself
      const command = String(input.args[0] ?? '');
      const r = (result ?? {}) as { exitCode?: number; stdout?: string; stderr?: string };
      await recordActivityWitness(
        { command, exitCode: r.exitCode ?? 0, stdout: r.stdout, stderr: r.stderr },
        { dataDir, info: Context.current().info }
      );
      return result;
    },
  };
}

// worker.ts — register via interceptors.activity (current key)
const worker = await Worker.create({
  taskQueue: 'witseal',
  workflowsPath: require.resolve('./workflows'),
  activities,
  interceptors: { activity: [() => ({ inbound: witnessInbound() })] },
});
```

For a reusable, structured form, `WitnessActivityInbound` takes an `extract`
mapper and provides the `execute(input, next)` method directly:

```typescript
import { WitnessActivityInbound } from '@witseal/cli/adapters/temporal';

const witness = new WitnessActivityInbound({
  dataDir,
  extract: (args, result) => {
    const r = (result ?? {}) as { exitCode?: number; stdout?: string };
    return { command: String(args[0] ?? ''), exitCode: r.exitCode ?? 0, stdout: r.stdout };
  },
});
// interceptors: { activity: [() => ({ inbound: witness })] }
```

## Correlation (no new receipt field)

Temporal's identifiers — workflow id, activity type — are folded into the
existing `agent_identifier` field via `temporalAgentId(info)`
(`temporal:<workflowId>/<activityType>`). This keeps evidence correlatable back
to the workflow that produced it **without** changing the wire format. Embedding
Temporal ids as new receipt fields is a wire-format change and is out of scope
for this adapter.

## Notes

- **Never bypasses WitSeal (Level 3)**: the command runs only via `runExec`
  inside `witnessedShell`. A Gate denial blocks execution, is recorded as
  `denied_by_policy`, and surfaces as a thrown error so the Activity fails.
- **Observe-only (Level 2)**: `recordActivityWitness` records what was reported;
  it executes nothing. A policy decision that is not `allow` on an observed
  action is recorded as `witnessed_executed`, never `denied_by_policy` (which
  would imply the action did not run).
- **Do not stack the two.** If you authored the Activity with `witnessedShell`
  (Level 3), it already records a full receipt — do not also wrap it with the
  Level-2 interceptor, or the same action is recorded twice.
- Add at least one policy pack under `<WITSEAL_DATA_DIR>/policy-packs/`. With no
  policy pack, Gate mode fails closed (deny-by-default).
- A freeform shell command is opaque to structural classification, so the
  shell-bypass rules correctly elevate its risk; policy can still allow it.
