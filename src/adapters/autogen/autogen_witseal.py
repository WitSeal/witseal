"""AutoGen witnessed-execution adapter — WitSeal owns the code executor.

AutoGen (``autogen-core`` / ``autogen-agentchat``) runs agent-authored code
through a ``CodeExecutor``: the agent emits one or more ``CodeBlock`` s and the
executor's ``execute_code_blocks`` runs them and returns a ``CodeResult``
(``exit_code`` + ``output``). That executor IS the execution surface for code
the agent decides to run.

This adapter swaps the executor: ``WitSealCommandLineCodeExecutor`` is a real
``autogen_core.code_executor.CodeExecutor`` whose ``execute_code_blocks`` routes
each shell ``CodeBlock`` through WitSeal's pipeline (classify -> policy ->
mediate -> witness -> receipt) via the built ``@witseal/cli``, instead of a raw
local subprocess. Every block becomes an independently verifiable execution
receipt. Hand this executor to an agent / team (e.g. ``CodeExecutorAgent`` or a
``ToolAgent`` that owns a code-execution tool) IN PLACE OF the default
``LocalCommandLineCodeExecutor`` and the agent's actual code execution is the
witnessed path.

Cross-language bridge: AutoGen is Python; WitSeal's ``runExec`` is in the
TypeScript ``@witseal/cli``. The executor invokes the built CLI as a subprocess
(``node <dist>/src/cli/index.js --data-dir <dir> exec --mode <mode> -- /bin/sh
-c <command>``) — the same ``runExec`` pipeline the shipped OpenCode / OpenHands
adapters drive. No global install of the CLI is required.

Scope (honest): this witnesses the *shell* code path — ``CodeBlock`` languages
that are run as a shell command (``sh`` / ``bash`` / ``shell``). The default
``LocalCommandLineCodeExecutor`` also writes a script file for ``python`` etc.
and then runs it; here a non-shell block is REFUSED rather than silently run
unwitnessed (no bypass). Compose the granted execution surface so the
witnessed executor is the execution path (shell blocks). See ``COVERAGE.md``.
"""

from __future__ import annotations

import os
import re
import subprocess
from dataclasses import dataclass
from typing import List, Optional

from autogen_core import CancellationToken
from autogen_core.code_executor import CodeBlock, CodeExecutor, CodeResult

# WitSeal's reserved exit code for a Gate denial (deny-by-default block).
WITSEAL_DENIED_EXIT = 100

# Languages we treat as "run this as a shell command".
_SHELL_LANGS = {"sh", "shell", "bash", "powershell", "pwsh"}

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
    receipt_id: Optional[str]
    event_id: Optional[str]

    @property
    def denied(self) -> bool:
        return self.exit_code == WITSEAL_DENIED_EXIT


def run_through_witseal(command: str, cfg: WitSealBridgeConfig) -> WitSealRunResult:
    """Run a freeform shell command through the witseal pipeline via the CLI.

    A freeform command is run as ``/bin/sh -c "<command>"`` (mirroring the
    OpenCode / OpenHands adapters). Returns the exit code, captured output, and
    the receipt / event ids parsed from the witness footer (stderr).
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


class WitSealCommandLineCodeExecutor(CodeExecutor):
    """Drop-in ``CodeExecutor`` whose code execution is owned by WitSeal.

    Same call contract as AutoGen's ``LocalCommandLineCodeExecutor`` —
    ``async execute_code_blocks(code_blocks, cancellation_token) -> CodeResult``
    — but each shell ``CodeBlock`` is executed by WitSeal (full execution
    receipt), never by a raw local subprocess. Receipt / event ids are appended
    to the aggregated output so a reviewer can ``witseal verify`` them.

    ``exit_code`` follows AutoGen convention: ``0`` only if every block exited
    ``0``; otherwise the first non-zero block's exit code. A policy DENY surfaces
    WitSeal's reserved ``100``.
    """

    def __init__(self, cfg: Optional[WitSealBridgeConfig] = None) -> None:
        self.cfg = cfg or default_bridge_config_from_env()
        self.last_results: List[WitSealRunResult] = []

    async def execute_code_blocks(
        self, code_blocks: List[CodeBlock], cancellation_token: CancellationToken
    ) -> CodeResult:
        self.last_results = []
        outputs: List[str] = []
        exit_code = 0
        for block in code_blocks:
            lang = (block.language or "").lower().strip()
            if lang not in _SHELL_LANGS:
                # Do not silently run a non-shell block unwitnessed.
                outputs.append(
                    f"[witseal] language {block.language!r} is not run by the "
                    "WitSeal-mediated executor (only shell blocks are witnessed "
                    "as discrete executions). Block refused."
                )
                if exit_code == 0:
                    exit_code = 1
                continue

            result = run_through_witseal(block.code, self.cfg)
            self.last_results.append(result)

            if result.denied:
                outputs.append(
                    "[witseal] code block DENIED by policy (deny-by-default); it "
                    f"did not run. Recorded as evidence (event {result.event_id})."
                )
                if exit_code == 0:
                    exit_code = result.exit_code
                continue

            footer = (
                f"\n[witseal: receipt={result.receipt_id} event={result.event_id} "
                f"exit={result.exit_code} — full execution receipt recorded; "
                f"verify with `witseal verify`]"
            )
            outputs.append((result.stdout or "") + footer)
            if result.exit_code != 0 and exit_code == 0:
                exit_code = result.exit_code

        return CodeResult(exit_code=exit_code, output="\n".join(outputs))

    # ---- lifecycle (no persistent resource; each block is discrete) ----

    async def start(self) -> None:  # noqa: D401
        """No persistent session to open (each block is a discrete execution)."""
        return None

    async def stop(self) -> None:
        """No persistent session to close."""
        return None

    async def restart(self) -> None:
        """Reset is a no-op: there is no carried-over executor state."""
        self.last_results = []
        return None
