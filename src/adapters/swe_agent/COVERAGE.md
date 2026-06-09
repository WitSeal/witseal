# SWE-agent — execution coverage map

Honest, fact-based coverage of the SWE-agent agent's execution surface under
WitSeal. The adapter mirrors the OpenHands Python CLI-bridge
(`run_through_witseal`); the witnessed execution path is the load-bearing,
live-verified element.

## Witnessed execution path (core)

- Shell / command: `witseal exec` (`runExec` -> `mediateShell` -> `runExec`
  pipeline), invoked as `node <dist>/src/cli/index.js --data-dir <dir> exec
  --mode <m> -- /bin/sh -c <command>`.
- No new wire-format: reuses the existing execution-result / witness schema.
  The golden receipt stays byte-identical; no canon change.

## Integration seam

SWE-agent's `EnvironmentConfig.deployment` is a pluggable `DeploymentConfig`
(`swerex` deployment/runtime). The deployment yields a runtime whose
`run_in_session(BashAction)` / `execute(Command)` owns command execution. That
executor is swappable, so replacing it with a witnessed runtime puts the
agent's *own* execution under the witness boundary (own-execute, not a
side-channel tool).

| Surface | Execution? | Status |
|---|---|---|
| `run_in_session` (session command) | yes | **own-executed** — `WitSealSwerexRuntime.run_in_session` -> `witseal exec`; live receipt -> `witseal verify` VALID |
| `execute` (one-shot command) | yes | **own-executed** — `WitSealSwerexRuntime.execute` -> `witseal exec`; live receipt |
| async `arun_in_session` / `aexecute` | yes | delegate to the synchronous bridge (the CLI subprocess is synchronous) |
| default raw-shell session deployment | yes | **replaced** by the witnessed deployment; no unwitnessed executor remains in the swapped configuration |

`WitSealDeployment` hands out `WitSealSwerexRuntime`, so once it is set as
`EnvironmentConfig.deployment`, no unwitnessed execution path remains in the
agent's command surface for that configuration.

## Deny-by-default (provenance)

SWE-agent's own command gate is **allow-by-default**. Deny-by-default in this
integration is enforced by **WitSeal Gate mode**, not by SWE-agent:

- A policy `deny` decision blocks the command (exit `100`, `denied_by_policy`).
- With no policy pack loaded, Gate mode fails closed (exit `100`,
  `no_policy_configured`) — the command does not run and the block is recorded
  as evidence.

Both are recorded; nothing executes on a denial.

## Boundary / scope (no overclaim)

- Scope is the WitSeal-mediated executor (the swapped runtime/deployment), not
  SWE-agent host internals. A configuration that keeps the default deployment
  (no swap) is not covered.
- Interactive stdin / control sequences are not modelled — each command is a
  discrete witnessed execution.
- File mutations performed by the agent as shell commands (`echo > f`, editor
  invocations spawned as commands) flow through the same `witseal exec` path and
  are witnessed as commands. A structured file-write intent type is not added
  here (that would be a separate surface).

## Live proof status

- Execution path (own-execute): **DONE, live.** The adapter module's
  `WitSealSwerexRuntime` was driven on real commands (no LLM):
  `run_in_session("echo …")` and `execute("echo …")` each produced a full
  execution receipt via `witseal exec`, and `witseal verify` reported
  `VALID (chain)`. Deny-by-default was proven separately: under Gate mode with
  no policy pack, a command returned exit `100`, did not run, and was recorded
  as evidence (chain still VALID).
- Full agent loop (the LLM emitting the command): **NOT run here** — that needs
  the `sweagent` / `swerex` packages plus a model key, neither present in this
  build environment. The runtime/deployment implement the exact swerex call
  contract (`run_in_session` / `execute`, sync + async) so they are drop-in
  when those packages are installed; the execution-path VALID above is the
  baseline guarantee.

## Verdict

For the swapped deployment, coverage is **Full Execution Coverage** by
construction: the agent's command execution is owned by a WitSeal-mediated
runtime (`run_in_session` + `execute` both routed to `witseal exec`,
live-proven receipt -> `witseal verify` VALID), deny-by-default supplied by
WitSeal Gate mode, no unwitnessed executor remaining in the swap. No
wire-format / canon change: the adapter reuses the unchanged `witseal exec` /
`runExec` primitive; the golden receipt stays byte-identical.
