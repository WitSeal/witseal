"""WitSeal-witnessed execution for AWS Strands Agents (``strands-agents``).

Strands lets you give an agent native Python tools via the ``@tool`` decorator
(``from strands import tool``). The agent's model picks a tool, and the runtime
runs that tool's *body* — ``DecoratedFunctionTool`` calls the underlying function
through ``stream(tool_use, ...)`` (the path used when the LLM emits a tool_use)
and through ``__call__`` (a direct in-process call). Either way, the bytes that
actually execute the agent's shell work are the bytes inside the tool body.

So the WitSeal seam here is an **own-execute, WitSeal-authored tool**: this module
ships a ``@tool``-decorated shell tool whose body routes the command through
WitSeal's pipeline (classify -> policy -> mediate -> witness -> receipt) instead
of running a raw subprocess. When that tool is the execution path granted to the
agent, every command the agent runs through it yields a real, independently
verifiable execution receipt.

Honesty ceiling (same as the OpenHands adapter): WitSeal witnesses the **authored
tool it owns**, not Strands' internals, the model, or any other tool you also
grant the agent. Compose the toolset so the witnessed tool *is* the execution
path — see ``COVERAGE.md``.

Cross-language bridge: ``strands-agents`` is Python; WitSeal's ``runExec``
pipeline is the TypeScript ``@witseal/cli``. The tool body invokes the built
witseal CLI as a subprocess — ``node <dist>/src/cli/index.js --data-dir <dir>
exec --mode <mode> -- /bin/sh -c <command>`` — so no global CLI install is
needed. Configuration is read from the environment, exactly like the OpenHands
adapter:

    WITSEAL_CLI_ENTRY  absolute path to dist/src/cli/index.js (required)
    WITSEAL_DATA_DIR   WitSeal data dir (default ~/.witseal)
    WITSEAL_MODE       gate (deny-by-default) | witness   (default gate)
    WITSEAL_NODE       node binary (default "node")
"""

from __future__ import annotations

import os
import re
import subprocess
from dataclasses import dataclass

from strands import tool

# WitSeal's reserved exit code for a Gate denial (deny-by-default block).
WITSEAL_DENIED_EXIT = 100

_RECEIPT_RE = re.compile(r"receipt=(rcpt_[A-Za-z0-9]+)")
_EVENT_RE = re.compile(r"event=(evt_[A-Za-z0-9]+)")


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


def run_through_witseal(command: str) -> WitSealRunResult:
    """Run ``command`` through the witseal CLI pipeline (self-contained bridge).

    Reads ``WITSEAL_CLI_ENTRY`` / ``WITSEAL_DATA_DIR`` / ``WITSEAL_MODE`` /
    ``WITSEAL_NODE`` from the environment, runs the command as ``/bin/sh -c
    "<command>"`` under WitSeal mediation, and parses the receipt / event ids
    from the witness footer (stderr).
    """
    cli_entry = os.environ.get("WITSEAL_CLI_ENTRY")
    if not cli_entry:
        raise RuntimeError(
            "WITSEAL_CLI_ENTRY must point at the built dist/src/cli/index.js"
        )
    data_dir = os.environ.get("WITSEAL_DATA_DIR", os.path.expanduser("~/.witseal"))
    mode = os.environ.get("WITSEAL_MODE", "gate")
    node = os.environ.get("WITSEAL_NODE", "node")

    proc = subprocess.run(
        [node, cli_entry, "--data-dir", data_dir, "exec", "--mode", mode,
         "--", "/bin/sh", "-c", command],
        capture_output=True, text=True, check=False,
    )
    receipt_m = _RECEIPT_RE.search(proc.stderr)
    event_m = _EVENT_RE.search(proc.stderr)
    return WitSealRunResult(
        exit_code=proc.returncode,
        stdout=proc.stdout,
        stderr=proc.stderr,
        receipt_id=receipt_m.group(1) if receipt_m else None,
        event_id=event_m.group(1) if event_m else None,
    )


@tool(name="witnessed_shell")
def witnessed_shell(command: str) -> str:
    """Run a shell command under WitSeal witnessed execution.

    Use this tool whenever you need to run a shell command. The command is
    executed under WitSeal's mediation pipeline, which produces an independently
    verifiable execution receipt instead of running a raw, unattested subprocess.

    Args:
        command: The shell command to run, e.g. "ls -la" or "echo hi".

    Returns:
        The command's stdout followed by a WitSeal footer carrying the receipt
        and event ids (verify with ``witseal verify``). If the command is denied
        by policy (deny-by-default Gate mode), it does not run and the denial is
        recorded as evidence.
    """
    result = run_through_witseal(command)

    if result.denied:
        return (
            "[witseal] command DENIED by policy (deny-by-default); it did not run. "
            f"Recorded as evidence (event={result.event_id})."
        )

    footer = (
        f"\n[witseal: receipt={result.receipt_id} event={result.event_id} "
        f"exit={result.exit_code} — full execution receipt recorded; "
        f"verify with `witseal verify`]"
    )
    return (result.stdout or "") + footer


def build_witnessed_toolset() -> list:
    """Return the granted toolset whose execution path is fully WitSeal-witnessed.

    Pass this to ``Agent(tools=build_witnessed_toolset())``. It contains only the
    WitSeal-authored ``witnessed_shell`` tool, so every command the agent runs is
    a witnessed execution. Adding non-witnessed tools (e.g. an unwrapped
    ``shell``/``python_repl``) reopens an unattested execution path and breaks the
    Full-coverage claim — see ``COVERAGE.md``.
    """
    return [witnessed_shell]
