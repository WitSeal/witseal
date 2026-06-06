"""CrewAI L3 adapter — a WitSeal-authored tool whose execution IS witnessed.

CrewAI agents act through *tools* (``crewai.tools.BaseTool`` subclasses). The
agent decides; the tool's ``_run`` body is what actually touches the world.
This adapter ships a WitSeal-**authored** tool, ``WitSealCrewTool``, whose
``_run(command)`` does not shell out itself — it routes the command through the
WitSeal pipeline (classify -> policy -> mediate -> witness -> receipt), so the
tool's own execution produces a full, independently-verifiable execution
receipt. WitSeal *owns* this tool's execution (own-execute); the receipt id is
returned to the agent in the tool result.

Scope (honest, the OpenHands honesty ceiling): witnessing is scoped to **this
authored tool**. It does not witness CrewAI internals, the LLM, or any other
tool the crew is granted. To make "every command the agent can run is
witnessed" true, compose the granted toolset so this is the *only*
execution-capable tool (see COVERAGE.md). That is a configuration choice, not a
claim over arbitrary crews.

Cross-language bridge: CrewAI is Python; WitSeal's ``runExec`` is in the
TypeScript ``@witseal/cli``. The tool invokes the built CLI as a subprocess
(``node <dist>/src/cli/index.js --data-dir <dir> exec --mode <mode> -- /bin/sh
-c <command>``) — the same ``runExec`` pipeline the OpenCode adapter calls
directly. No global CLI install is required.

Mirrors ``src/adapters/openhands/witseal_openhands.py``: same bridge, same
receipt-footer parse, same ``WITSEAL_DENIED_EXIT = 100`` Gate-denial contract.
Self-contained (~30-line bridge + a thin ``BaseTool`` wrapper).
"""

from __future__ import annotations

import os
import re
import subprocess

from crewai.tools import BaseTool

# WitSeal's reserved exit code for a Gate denial (deny-by-default block).
WITSEAL_DENIED_EXIT = 100

# The witness footer WitSeal prints to stderr, e.g.
#   [witseal: event=evt_… receipt=rcpt_… risk=C3 outcome=allow]
_RECEIPT_RE = re.compile(r"receipt=(rcpt_[A-Za-z0-9]+)")
_EVENT_RE = re.compile(r"event=(evt_[A-Za-z0-9]+)")


def run_through_witseal(command: str) -> subprocess.CompletedProcess[str]:
    """Run a freeform shell command through the witseal CLI pipeline.

    The command is executed by WitSeal as ``/bin/sh -c "<command>"`` (mirroring
    the OpenCode / OpenHands adapters), never by a raw shell in this process, so
    it yields a full execution receipt. Configuration is read from the
    environment, exactly like the OpenHands adapter:

        WITSEAL_NODE       node binary (default "node")
        WITSEAL_CLI_ENTRY  absolute path to dist/src/cli/index.js (required)
        WITSEAL_DATA_DIR   WitSeal data dir (default ~/.witseal)
        WITSEAL_MODE       "gate" (deny-by-default) or "witness" (default gate)
    """
    cli_entry = os.environ["WITSEAL_CLI_ENTRY"]
    data_dir = os.environ.get("WITSEAL_DATA_DIR", os.path.expanduser("~/.witseal"))
    mode = os.environ.get("WITSEAL_MODE", "gate")
    return subprocess.run(
        [
            os.environ.get("WITSEAL_NODE", "node"),
            cli_entry,
            "--data-dir",
            data_dir,
            "exec",
            "--mode",
            mode,
            "--",
            "/bin/sh",
            "-c",
            command,
        ],
        capture_output=True,
        text=True,
        check=False,
    )


class WitSealCrewTool(BaseTool):
    """A CrewAI tool whose execution is witnessed by WitSeal (own-execute).

    Give this tool to an agent in place of a raw shell/command tool. When the
    agent calls it, ``BaseTool.run(command=...)`` validates the argument and
    dispatches to ``_run``; ``_run`` routes the command through WitSeal, so the
    tool's actual execution is inside the witness boundary and emits a receipt.

    The receipt id is appended to the tool's string result so a reviewer can
    ``witseal verify`` it. A Gate denial (exit ``100``) returns a clear
    "DENIED by policy" string and the command does **not** run.
    """

    name: str = "witnessed_shell"
    description: str = (
        "Run a shell command under WitSeal mediation. The command is executed by "
        "WitSeal (deny-by-default Gate), producing a verifiable execution receipt. "
        "Input: command (string)."
    )

    def _run(self, command: str) -> str:
        proc = run_through_witseal(command)
        receipt_m = _RECEIPT_RE.search(proc.stderr)
        event_m = _EVENT_RE.search(proc.stderr)
        receipt_id = receipt_m.group(1) if receipt_m else None
        event_id = event_m.group(1) if event_m else None

        if proc.returncode == WITSEAL_DENIED_EXIT:
            return (
                "[witseal] command DENIED by policy (deny-by-default); it did not "
                f"run. Recorded as evidence (event {event_id})."
            )

        footer = (
            f"\n[witseal: receipt={receipt_id} event={event_id} "
            f"exit={proc.returncode} — full execution receipt recorded; "
            f"verify with `witseal verify`]"
        )
        return (proc.stdout or "") + footer
