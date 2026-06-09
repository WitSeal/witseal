"""SWE-agent full-coverage adapter — WitSeal-side execution swap (deployment).

SWE-agent (the `sweagent` package, MIT) runs the agent's shell through an
`EnvironmentConfig.deployment`, which is a pluggable `DeploymentConfig`
(`swerex.deployment.*`). The deployment builds a runtime that owns command
execution: the agent's `bash`/command tool ultimately calls the runtime's
``run_in_session(BashAction) -> BashObservation`` (and ``execute(Command)``).
That executor is *swappable* — which is exactly the seam WitSeal needs to put
the agent's own execution under the witness boundary.

This module provides a witnessed runtime/deployment that routes every command
through WitSeal's pipeline (classify -> policy -> mediate -> witness -> receipt)
via the built witseal CLI, instead of running it in a raw shell/session. An
allowed command yields a full, independently-verifiable execution receipt; a
denied command does not run and is recorded as evidence.

Cross-language bridge (mirrors the OpenHands adapter
``witseal_openhands.py`` ``run_through_witseal``): ``sweagent`` / ``swerex`` are
Python; WitSeal's ``runExec`` is in the TypeScript ``@witseal/cli``. The bridge
invokes the built CLI as a subprocess —
``node <dist>/src/cli/index.js --data-dir <dir> exec --mode <m> -- /bin/sh -c
<command>`` — the same ``runExec`` pipeline the OpenCode adapter calls directly.
No global install of the CLI is required.

Deny-by-default: SWE-agent's own command gate is allow-by-default, so the
deny-by-default guarantee here comes from **WitSeal Gate mode** — a `deny`
decision (or, with no policy pack loaded, the fail-closed default) blocks the
command before it runs and returns the reserved denial exit code.

Integration points (use whichever your SWE-agent version exposes):

* ``WitSealSwerexRuntime`` — a runtime whose ``run_in_session`` /
  ``execute`` routes the command through the witseal CLI and returns a
  swerex-shaped observation. Swap it in where the deployment yields its runtime.
* ``WitSealDeployment`` — an ``AbstractDeployment``-shaped object that hands out
  a ``WitSealSwerexRuntime``. Set it as ``EnvironmentConfig.deployment`` (or
  assign ``env.deployment = WitSealDeployment(cfg)``) so the agent's commands
  run witnessed.

Both are built on the framework-neutral ``run_through_witseal`` bridge, so the
adapter is exercisable (and live-verifiable) even where the optional
``sweagent`` / ``swerex`` packages are not installed — the bridge is the
load-bearing execution path. The swerex base classes are imported lazily and
optionally; if absent, the runtime/deployment still work as duck-typed
swap-ins and the bridge remains fully testable.

See ``COVERAGE.md`` and the README for the witnessed-surface map and the live
receipt -> ``witseal verify`` proof.
"""

from __future__ import annotations

import os
import re
import subprocess
from dataclasses import dataclass

# WitSeal's reserved exit code for a Gate denial (deny-by-default block).
WITSEAL_DENIED_EXIT = 100

_RECEIPT_RE = re.compile(r"receipt=(rcpt_[A-Za-z0-9]+)")
_EVENT_RE = re.compile(r"event=(evt_[A-Za-z0-9]+)")


@dataclass
class WitSealBridgeConfig:
    """How to reach the witseal CLI and which data dir to witness into."""

    cli_entry: str  # absolute path to the built dist/src/cli/index.js
    data_dir: str  # WitSeal data directory (chain, policy packs, receipts)
    node: str = "node"
    mode: str = "gate"  # "gate" (deny-by-default) or "witness"


@dataclass
class WitSealRunResult:
    exit_code: int
    stdout: str
    stderr: str
    receipt_id: str | None
    event_id: str | None

    @property
    def denied(self) -> bool:
        return self.exit_code == WITSEAL_DENIED_EXIT


def run_through_witseal(command: str, cfg: WitSealBridgeConfig) -> WitSealRunResult:
    """Run a freeform shell command through the witseal pipeline via the CLI.

    Mirrors the OpenHands adapter bridge: a freeform command is run as
    ``/bin/sh -c "<command>"``. Returns the exit code, captured output, and the
    receipt / event ids parsed from the witness footer (stderr).
    """
    argv = [
        cfg.node,
        cfg.cli_entry,
        "--data-dir",
        cfg.data_dir,
        "exec",
        "--mode",
        cfg.mode,
        "--",
        "/bin/sh",
        "-c",
        command,
    ]
    proc = subprocess.run(argv, capture_output=True, text=True, check=False)
    receipt_m = _RECEIPT_RE.search(proc.stderr)
    event_m = _EVENT_RE.search(proc.stderr)
    return WitSealRunResult(
        exit_code=proc.returncode,
        stdout=proc.stdout,
        stderr=proc.stderr,
        receipt_id=receipt_m.group(1) if receipt_m else None,
        event_id=event_m.group(1) if event_m else None,
    )


def witness_footer(result: WitSealRunResult) -> str:
    """A short, reviewer-facing footer naming the receipt to verify."""
    return (
        f"\n[witseal: receipt={result.receipt_id} event={result.event_id} "
        f"exit={result.exit_code} - witnessed execution for swe-agent; "
        f"verify with `witseal verify`]"
    )


# --------------------------------------------------------------------------
# swerex base classes (optional). SWE-agent's runtime/deployment live in the
# `swerex` package. We import them lazily so this module is usable (and the
# bridge live-verifiable) without the optional dependency installed. When
# present, the witnessed runtime/deployment subclass the real bases so they are
# drop-in swap-compatible; when absent, they remain duck-typed swap-ins with the
# same method names SWE-agent calls.
# --------------------------------------------------------------------------
try:  # pragma: no cover - exercised only when swerex is installed
    from swerex.runtime.abstract import (
        AbstractRuntime as _AbstractRuntime,
        BashAction as _BashAction,
        BashObservation as _BashObservation,
        Command as _Command,
        CommandResponse as _CommandResponse,
    )

    _HAVE_SWEREX_RUNTIME = True
except Exception:  # pragma: no cover - the common path in this build env
    _AbstractRuntime = object  # type: ignore[assignment,misc]
    _BashAction = None  # type: ignore[assignment]
    _BashObservation = None  # type: ignore[assignment]
    _Command = None  # type: ignore[assignment]
    _CommandResponse = None  # type: ignore[assignment]
    _HAVE_SWEREX_RUNTIME = False

try:  # pragma: no cover - exercised only when swerex is installed
    from swerex.deployment.abstract import AbstractDeployment as _AbstractDeployment

    _HAVE_SWEREX_DEPLOYMENT = True
except Exception:  # pragma: no cover
    _AbstractDeployment = object  # type: ignore[assignment,misc]
    _HAVE_SWEREX_DEPLOYMENT = False


def _command_text(action) -> str:
    """Extract the shell command string from a swerex BashAction / Command.

    Handles both the structured swerex objects (``.command``) and a bare
    string, so the runtime is robust across swerex versions and to direct
    string calls in tests.
    """
    if isinstance(action, str):
        return action
    cmd = getattr(action, "command", None)
    if cmd is not None:
        return cmd
    raise TypeError(f"cannot extract a command string from {action!r}")


def _make_bash_observation(result: WitSealRunResult):
    """Build a swerex BashObservation (or a plain shim) from a run result.

    On a denied command, the output is the denial notice; otherwise the captured
    stdout plus the witness footer naming the receipt to verify.
    """
    if result.denied:
        output = (
            "[witseal] command DENIED by policy / deny-by-default; it did not run. "
            f"Recorded as evidence (event {result.event_id})."
        )
        exit_code = result.exit_code
    else:
        output = (result.stdout or "") + witness_footer(result)
        exit_code = result.exit_code

    if _HAVE_SWEREX_RUNTIME and _BashObservation is not None:  # pragma: no cover
        return _BashObservation(output=output, exit_code=exit_code)
    return _PlainObservation(output=output, exit_code=exit_code)


def _make_command_response(result: WitSealRunResult):
    """Build a swerex CommandResponse (or a plain shim) from a run result."""
    if _HAVE_SWEREX_RUNTIME and _CommandResponse is not None:  # pragma: no cover
        return _CommandResponse(
            stdout=result.stdout or "",
            stderr=result.stderr or "",
            exit_code=-1 if result.exit_code is None else result.exit_code,
        )
    return _PlainCommandResponse(
        stdout=result.stdout or "",
        stderr=result.stderr or "",
        exit_code=-1 if result.exit_code is None else result.exit_code,
    )


@dataclass
class _PlainObservation:
    """Fallback observation when swerex types are not importable."""

    output: str
    exit_code: int | None


@dataclass
class _PlainCommandResponse:
    """Fallback command response when swerex types are not importable."""

    stdout: str
    stderr: str
    exit_code: int


class WitSealSwerexRuntime(_AbstractRuntime):  # type: ignore[misc,valid-type]
    """A swerex-shaped runtime that witnesses every command via WitSeal.

    Same call contract SWE-agent drives —
    ``run_in_session(BashAction) -> BashObservation`` and
    ``execute(Command) -> CommandResponse`` — but each command is executed by
    WitSeal (full execution receipt), never by a raw shell/session. The receipt
    id is surfaced in the observation so a reviewer can ``witseal verify`` it.

    Async wrappers (``arun_in_session`` / ``aexecute``) are provided because
    swerex runtimes are awaited by SWE-agent; they delegate to the synchronous
    bridge (the witseal CLI subprocess is itself synchronous).
    """

    def __init__(self, cfg: WitSealBridgeConfig) -> None:
        self.cfg = cfg
        self.last_result: WitSealRunResult | None = None

    # -- synchronous contract ------------------------------------------------
    def run_in_session(self, action):
        """Route a session command through WitSeal. Returns a BashObservation."""
        command = _command_text(action)
        result = run_through_witseal(command, self.cfg)
        self.last_result = result
        return _make_bash_observation(result)

    def execute(self, command):
        """Route a one-shot command through WitSeal. Returns a CommandResponse."""
        text = _command_text(command)
        result = run_through_witseal(text, self.cfg)
        self.last_result = result
        return _make_command_response(result)

    # -- async contract (swerex awaits these) --------------------------------
    async def arun_in_session(self, action):
        return self.run_in_session(action)

    async def aexecute(self, command):
        return self.execute(command)

    # -- lifecycle no-ops (no live session to manage) ------------------------
    def is_alive(self, *args, **kwargs):
        return True

    async def ais_alive(self, *args, **kwargs):
        return True

    async def create_session(self, *args, **kwargs):
        return None

    async def close_session(self, *args, **kwargs):
        return None

    async def close(self, *args, **kwargs):
        return None


class WitSealDeployment(_AbstractDeployment):  # type: ignore[misc,valid-type]
    """A deployment that hands out a witnessed runtime.

    Set this as ``EnvironmentConfig.deployment`` (or assign
    ``env.deployment = WitSealDeployment(cfg)``) so the agent's command
    execution flows through ``WitSealSwerexRuntime`` -> witseal CLI -> receipt.
    SWE-agent's own command gate is allow-by-default; deny-by-default is enforced
    here by WitSeal Gate mode.
    """

    def __init__(self, cfg: WitSealBridgeConfig) -> None:
        self.cfg = cfg
        self._runtime = WitSealSwerexRuntime(cfg)

    @property
    def runtime(self) -> WitSealSwerexRuntime:
        return self._runtime

    async def start(self, *args, **kwargs):
        return None

    async def stop(self, *args, **kwargs):
        return None

    def is_alive(self, *args, **kwargs):
        return True

    async def ais_alive(self, *args, **kwargs):
        return True


def default_bridge_config_from_env() -> WitSealBridgeConfig:
    """Build a bridge config from environment.

    WITSEAL_CLI_ENTRY  absolute path to the built dist/src/cli/index.js (required)
    WITSEAL_DATA_DIR   data dir (default ~/.witseal)
    WITSEAL_MODE       gate | witness (default gate)
    """
    cli_entry = os.environ.get("WITSEAL_CLI_ENTRY", "")
    if not cli_entry:
        raise RuntimeError(
            "WITSEAL_CLI_ENTRY must point at the built dist/src/cli/index.js"
        )
    return WitSealBridgeConfig(
        cli_entry=cli_entry,
        data_dir=os.environ.get("WITSEAL_DATA_DIR", os.path.expanduser("~/.witseal")),
        mode=os.environ.get("WITSEAL_MODE", "gate"),
    )
