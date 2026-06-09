# SWE-agent adapter — Full Execution Coverage

Integrates WitSeal with [SWE-agent](https://github.com/SWE-agent/SWE-agent)
(the `sweagent` package, MIT) so the agent's **own** command execution runs
through WitSeal — every command becomes a full, independently-verifiable
execution receipt, not merely a witnessed decision alongside a separate tool.

This is the own-execute path ("Full Execution Coverage"): WitSeal **owns the
executor** behind the agent's command surface. It differs from the MCP
integration (where WitSeal is an additional `shell` tool *alongside* the
agent's built-in execution): here WitSeal replaces the executor the agent
already uses, so the host's native execution is inside the witness boundary.

## How it works (deployment / runtime swap)

SWE-agent runs the agent's shell through `EnvironmentConfig.deployment`, a
pluggable `DeploymentConfig` (the `swerex` deployment/runtime layer). The
deployment yields a runtime that owns command execution: the agent's command
tool ultimately calls the runtime's `run_in_session(BashAction) ->
BashObservation` (and `execute(Command) -> CommandResponse`). That executor is
*swappable* — the seam WitSeal uses to put the agent's actual execution under
the witness boundary.

`WitSealSwerexRuntime` implements that same contract, but routes each command
through WitSeal's pipeline (classify -> policy -> mediate -> witness ->
receipt) and surfaces the receipt id in the observation. `WitSealDeployment`
hands out that runtime; set it as `EnvironmentConfig.deployment` (or assign
`env.deployment = WitSealDeployment(cfg)`) and the agent's commands run
witnessed.

Cross-language bridge: `sweagent` / `swerex` are Python; WitSeal's `runExec`
is in the TypeScript `@witseal/cli`. The runtime invokes the built CLI as a
subprocess (`node <dist>/src/cli/index.js --data-dir <dir> exec --mode <m> --
/bin/sh -c <command>`) — the same `runExec` pipeline the OpenCode adapter calls
directly, and the same bridge shape the OpenHands adapter uses. No global CLI
install is required.

## Deny-by-default

SWE-agent's own command gate is **allow-by-default**. The deny-by-default
guarantee in this integration therefore comes from **WitSeal Gate mode**: a
`deny` decision (or, when no policy pack is loaded, the fail-closed default)
blocks the command before it runs and returns the reserved denial exit code
(`100`). The block is recorded as evidence; nothing executes.

## Coverage status (honest)

"Full Execution Coverage" means the agent's command execution flows through a
WitSeal-owned executor — there is no separate, unwitnessed native shell the
agent calls instead. The runtime swap covers the runtime's command surface
(`run_in_session` session commands and `execute` one-shot commands). Scope is
the WitSeal-mediated executor, not SWE-agent host internals.

| Surface | Status |
|---|---|
| `run_in_session` (session command) | **own-executed** — routed to `witseal exec`; live receipt -> `witseal verify` VALID |
| `execute` (one-shot command) | **own-executed** — routed to `witseal exec`; live receipt |
| Native raw-shell session (default deployment) | **replaced** — the agent uses `WitSealSwerexRuntime` instead; no bypass executor remains in the swapped deployment |

The claim is scoped to the swapped deployment/runtime. A configuration that
keeps the default deployment (no swap) is not covered — the swap is the
mechanism that removes the unwitnessed path.

## Use (deployment swap)

```python
from witseal_swe_agent import WitSealDeployment, WitSealBridgeConfig

cfg = WitSealBridgeConfig(
    cli_entry="/abs/path/to/@witseal-cli/dist/src/cli/index.js",
    data_dir="/abs/path/to/witseal-data-dir",  # must contain policy-packs/
    mode="gate",  # deny-by-default
)

# Route the agent's command execution through WitSeal:
env_config.deployment = WitSealDeployment(cfg)
# (equivalently, assign env.deployment = WitSealDeployment(cfg) on a built env.)
```

For a quick check without SWE-agent installed, the bridge is directly callable:

```python
from witseal_swe_agent import run_through_witseal, WitSealBridgeConfig
res = run_through_witseal("echo hello", cfg)   # res.receipt_id, res.exit_code
```

## Notes

- **Never bypasses WitSeal**: the command runs only via `runExec`. A Gate
  denial blocks execution (exit `100`) and is recorded as `denied_by_policy`
  (or `no_policy_configured` for the fail-closed default).
- The `swerex` base classes are imported lazily and optionally. When present,
  `WitSealSwerexRuntime` / `WitSealDeployment` subclass the real bases for
  drop-in compatibility; when absent (e.g. a CLI-only check) they remain
  duck-typed swap-ins and the bridge stays fully exercisable.
- This adapter is Python (SWE-agent is Python). It is source under
  `src/adapters/swe_agent/`; it is not shipped in the npm package (which is the
  TypeScript CLI). Packaging for distribution is a separate, later step.
- No wire-format / canon change: the adapter reuses the existing `witseal exec`
  / `runExec` primitive unchanged. The golden receipt stays byte-identical.
