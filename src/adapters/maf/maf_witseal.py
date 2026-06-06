"""Microsoft Agent Framework (MAF) witnessed-execution adapter.

Routes an MAF agent's *actual* command execution through WitSeal so every run
becomes a full, independently-verifiable execution receipt (classify -> policy
-> mediate -> witness -> receipt), instead of a raw local subprocess.

MAF Python (``pip install agent-framework``; module ``agent_framework``) exposes
two seams this adapter plugs into — and BOTH are provided here:

(A) **Author the tool.** ``@tool`` turns a function into a ``FunctionTool`` you
    hand to ``Agent(tools=[...])``. ``build_witseal_exec_tool`` returns such a
    tool whose body runs the command through the witseal pipeline. This is the
    WitSeal-authored execution tool the host routes through — the OpenHands
    precedent: WitSeal owns *this tool's* execution.

(B) **Function middleware.** ``FunctionMiddleware.process(context, call_next)``
    intercepts a tool invocation; setting ``context.result`` and **not** calling
    ``call_next()`` short-circuits the host's own execution. ``WitSealFunction
    Middleware`` re-routes the command-bearing tool's execution through witseal
    and overrides ``context.result`` with the witnessed output, so even a host
    or model-supplied command tool runs inside the witness boundary.

Cross-language bridge: MAF is Python; WitSeal's ``runExec`` is the TypeScript
``@witseal/cli``. The adapter invokes the built CLI as a subprocess
(``node <dist>/src/cli/index.js --data-dir <dir> exec --mode <mode> -- /bin/sh
-c <command>``) — the same ``runExec`` pipeline the shipped OpenCode / OpenHands
/ AutoGen adapters drive. No global install of the CLI is required. The CLI,
golden receipt, and wire-format are used unchanged (no new schema).

Honest scope (the OpenHands honesty ceiling): witnessing is scoped to *this
WitSeal-authored tool / the command the host routes through this middleware* —
WitSeal owns that tool's execution. It does **not** witness MAF framework
internals, the chat/LLM client, model traffic, or any other tool the agent may
also hold. See ``COVERAGE.md``.
"""

from __future__ import annotations

import os
import re
import subprocess
from dataclasses import dataclass
from typing import Annotated, Any, Awaitable, Callable, Optional

from agent_framework import (
    FunctionInvocationContext,
    FunctionMiddleware,
    FunctionTool,
    tool,
)

# WitSeal's reserved exit code for a Gate denial (deny-by-default block).
WITSEAL_DENIED_EXIT = 100

# The witness footer is emitted on stderr; ids appear in either order.
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

    Mirrors the OpenCode / OpenHands / AutoGen adapters: a freeform command is
    run as ``/bin/sh -c "<command>"``. Returns the exit code, captured output,
    and the receipt / event ids parsed from the witness footer (stderr).
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


def _format_observation(result: WitSealRunResult) -> str:
    """Render a witseal run as the tool/middleware return text (model-facing)."""
    if result.denied:
        return (
            "[witseal] command DENIED by policy (deny-by-default); it did not "
            f"run. Recorded as evidence (event {result.event_id})."
        )
    footer = (
        f"\n[witseal: receipt={result.receipt_id} event={result.event_id} "
        f"exit={result.exit_code} — full execution receipt recorded; verify "
        f"with `witseal verify`]"
    )
    return (result.stdout or "") + footer


# ---------------------------------------------------------------------------
# Seam (A): the WitSeal-authored execution tool.
# ---------------------------------------------------------------------------
def build_witseal_exec_tool(
    cfg: WitSealBridgeConfig,
    *,
    name: str = "witseal_exec",
    description: str = (
        "Run a shell command under WitSeal witnessed execution: the command is "
        "mediated by a deny-by-default policy and recorded as an independently "
        "verifiable execution receipt."
    ),
) -> FunctionTool:
    """Return a MAF ``FunctionTool`` whose execution runs through witseal.

    Hand the returned tool to ``Agent(tools=[build_witseal_exec_tool(cfg)])``
    (or ``ChatAgent(... tools=[...])``). When the agent calls it, the command is
    executed by WitSeal (full execution receipt), never by a raw subprocess the
    host owns. The receipt id is surfaced in the returned text so a reviewer can
    ``witseal verify`` it.
    """

    @tool(name=name, description=description)
    def witseal_exec(
        command: Annotated[str, "The shell command to run under WitSeal."],
    ) -> str:
        return _format_observation(run_through_witseal(command, cfg))

    return witseal_exec


# ---------------------------------------------------------------------------
# Seam (B): function middleware that re-routes execution through witseal.
# ---------------------------------------------------------------------------
def _extract_command(context: FunctionInvocationContext, arg_name: str) -> Optional[str]:
    """Pull the command string out of the invocation arguments (dict or model)."""
    args = context.arguments
    if args is None:
        return None
    if isinstance(args, dict):
        val = args.get(arg_name)
    else:  # pydantic BaseModel
        val = getattr(args, arg_name, None)
    return val if isinstance(val, str) else None


class WitSealFunctionMiddleware(FunctionMiddleware):
    """MAF ``FunctionMiddleware`` that puts a command tool under WitSeal.

    For any intercepted tool invocation that carries a command argument (default
    parameter name ``command``), the command is executed by WitSeal and
    ``context.result`` is overridden with the witnessed output; ``call_next()``
    is **not** invoked, so the host's own execution of that tool never runs —
    the witnessed path replaces it.

    Tools that do **not** carry the command argument are passed through
    untouched (``call_next()`` is awaited), and the middleware does not claim to
    witness them — consistent with the honesty ceiling (this layer owns only the
    command it routes through witseal).

    Use via ``Agent(..., middleware=[WitSealFunctionMiddleware(cfg)])`` (or the
    chat-client middleware list), naming the command tool's parameter
    ``command`` (or pass ``command_arg=...``).
    """

    def __init__(self, cfg: WitSealBridgeConfig, *, command_arg: str = "command") -> None:
        self.cfg = cfg
        self.command_arg = command_arg
        self.last_result: Optional[WitSealRunResult] = None

    async def process(
        self,
        context: FunctionInvocationContext,
        call_next: Callable[[], Awaitable[None]],
    ) -> None:
        command = _extract_command(context, self.command_arg)
        if command is None:
            # Not a command-bearing call: do not witness, do not interfere.
            await call_next()
            return
        result = run_through_witseal(command, self.cfg)
        self.last_result = result
        # Override the result and SHORT-CIRCUIT: the host's own execution of this
        # tool is replaced by the witnessed run (call_next is intentionally not
        # awaited), so the actual execution is inside the witness boundary.
        context.result = _format_observation(result)


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
