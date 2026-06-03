"""OpenHands full-L3 adapter — WitSeal-side execution swap (Stage 1: terminal).

OpenHands (openhands-sdk) runs the agent's shell via a ``TerminalExecutor`` that
owns its own tmux/subprocess session (``openhands.tools.terminal``). That path
does NOT go through ``BaseWorkspace.execute_command`` — so the only way to put
the agent's *actual* execution under the WitSeal witness boundary is to swap the
tool's executor (tools-list / executor swap), exactly as the shipped OpenCode
adapter shadows the built-in shell tool rather than a workspace.

NOTE (recon correction, verified against installed openhands-sdk/tools 1.21.0):
the shell tool is ``openhands.tools.terminal`` — ``TerminalTool`` /
``TerminalExecutor`` / ``TerminalAction`` / ``TerminalObservation``. Earlier
recon referenced ``execute_bash`` / ``BashTool`` / ``BashExecutor``; that name is
stale for 1.21.0. The order said to re-verify by fact — done.

This module provides:

* ``WitSealTerminalExecutor`` — a real ``openhands.sdk.tool.ToolExecutor`` whose
  ``__call__(TerminalAction)`` routes the command through WitSeal's pipeline
  (classify -> policy -> mediate -> witness -> receipt) instead of a raw shell,
  so the call yields a full, independently-verifiable execution receipt.
* ``build_witseal_terminal_tool`` — takes the SDK's default ``TerminalTool``
  (from ``TerminalTool.create(conv_state)``) and replaces its ``.executor`` with
  the WitSeal executor, for use in ``Agent(tools=[...])`` via a tools-list swap
  (NOT a name override: a duplicate registry name only *warns* today).

Cross-language bridge: openhands-sdk is Python; WitSeal's ``runExec`` is in the
TypeScript ``@witseal/cli``. The executor invokes the built witseal CLI as a
subprocess — ``node <dist>/src/cli/index.js --data-dir <dir> exec -- /bin/sh -c
<command>`` — the same ``runExec`` pipeline the OpenCode adapter calls directly.
No global install of the CLI is required.

Stage 1 covers the terminal (shell) tool only. Full Execution Coverage also
requires wrapping every other execution-capable tool the agent is granted —
verified present in 1.21.0: ``file_editor``, ``apply_patch``,
``planning_file_editor``, ``browser_use`` — or restricting the toolset to
witnessed tools. See README.
"""

from __future__ import annotations

import os
import re
import subprocess
from dataclasses import dataclass

from openhands.sdk.llm import TextContent
from openhands.sdk.tool import ToolExecutor
from openhands.tools.terminal import TerminalTool
from openhands.tools.terminal.definition import TerminalAction, TerminalObservation
from openhands.tools.terminal.metadata import CmdOutputMetadata

# WitSeal's reserved exit code for a Gate denial (deny-by-default block).
WITSEAL_DENIED_EXIT = 100

_RECEIPT_RE = re.compile(r"receipt=(rcpt_[A-Za-z0-9]+)")
_EVENT_RE = re.compile(r"event=(evt_[A-Za-z0-9]+)")


@dataclass
class WitSealBridgeConfig:
    """How to reach the witseal CLI and which data dir to witness into."""

    cli_entry: str  # absolute path to dist/src/cli/index.js
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

    Mirrors the OpenCode adapter: a freeform command is run as
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


class WitSealTerminalExecutor(ToolExecutor):
    """Drop-in replacement for OpenHands' ``TerminalExecutor``.

    Same call contract — ``__call__(TerminalAction) -> TerminalObservation`` — but
    the command is executed by WitSeal (full execution receipt), never by a raw
    tmux/subprocess session. The receipt id is surfaced in the observation text so
    a reviewer can ``witseal receipt show`` / ``witseal verify`` it.
    """

    def __init__(self, cfg: WitSealBridgeConfig) -> None:
        self.cfg = cfg
        self.last_result: WitSealRunResult | None = None

    def __call__(
        self, action: TerminalAction, conversation=None
    ) -> TerminalObservation:
        # is_input / control sequences (C-c, ...) and reset target a live tmux
        # session WitSeal does not model; surface that honestly.
        if action.is_input or action.reset:
            return TerminalObservation.from_text(
                text=(
                    "[witseal] interactive stdin / control input / terminal reset "
                    "is not supported by the WitSeal-mediated executor (each "
                    "command is a discrete witnessed execution)."
                ),
                is_error=True,
                command=action.command,
                exit_code=None,
                metadata=CmdOutputMetadata(),
            )

        result = run_through_witseal(action.command, self.cfg)
        self.last_result = result

        if result.denied:
            return TerminalObservation.from_text(
                text=(
                    "[witseal] command DENIED by policy (deny-by-default); it did "
                    f"not run. Recorded as evidence (event {result.event_id})."
                ),
                is_error=True,
                command=action.command,
                exit_code=result.exit_code,
                metadata=CmdOutputMetadata(exit_code=result.exit_code),
            )

        footer = (
            f"\n[witseal: receipt={result.receipt_id} event={result.event_id} "
            f"exit={result.exit_code} — full execution receipt recorded; "
            f"verify with `witseal verify`]"
        )
        return TerminalObservation.from_text(
            text=(result.stdout or "") + footer,
            is_error=result.exit_code != 0,
            command=action.command,
            exit_code=result.exit_code,
            metadata=CmdOutputMetadata(exit_code=result.exit_code),
        )


def build_witseal_terminal_tool(conv_state, cfg: WitSealBridgeConfig) -> TerminalTool:
    """Build the SDK's TerminalTool but with the WitSeal executor swapped in.

    Use the returned tool in ``Agent(tools=[...])`` IN PLACE OF the default
    terminal tool. ``TerminalTool.create`` builds a default ``TerminalExecutor``
    (opening a real tmux session); we close it and replace ``.executor`` with the
    WitSeal one so the agent's shell calls are witnessed.
    """
    tools = TerminalTool.create(conv_state)
    tool = tools[0]
    try:
        if tool.executor is not None:
            tool.executor.close()
    except Exception:
        pass
    # ToolDefinition is a frozen pydantic model; bypass to swap the runtime field.
    object.__setattr__(tool, "executor", WitSealTerminalExecutor(cfg))
    return tool


def default_bridge_config_from_env() -> WitSealBridgeConfig:
    """Build a bridge config from environment.

    WITSEAL_CLI_ENTRY  absolute path to dist/src/cli/index.js (required)
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
