"""Witnessed execution for Google ADK — WitSeal-authored ``before_tool_callback``.

Google ADK (``google-adk``) runs an agent's tool calls through
``google.adk.flows.llm_flows.functions``. Before the framework invokes a tool it
runs each ``before_tool_callback``; verified against google-adk **2.2.0**
(``functions.py`` Step 2 → Step 3): if a ``before_tool_callback`` returns a
**truthy dict**, ADK *breaks* the callback loop and then ``Step 3`` only calls
the real tool ``if function_response is None`` — so the returned dict is used as
the tool result and **the real tool body never runs**. That is the seam: a
WitSeal-authored callback owns the execution of the tool it guards.

This adapter ships a WitSeal-authored shell tool (``build_witnessed_shell_tool``)
plus the ``before_tool_callback`` (``witseal_before_tool_callback``) that mediates
it. The intended composition is an ``LlmAgent`` whose *granted toolset is exactly
that authored tool*: the callback intercepts the ``command`` argument, runs it
through WitSeal's pipeline (classify → policy → mediate → witness → receipt), and
returns the mediated result as the function response. WitSeal therefore **owns**
that tool's execution (own-execute) and emits a full, independently-verifiable
execution receipt — the OpenHands honesty ceiling: witnessing is scoped to the
authored tool, NOT to ADK internals, the LLM, or any other traffic.

Cross-language bridge: ``google-adk`` is Python; WitSeal's ``runExec`` is in the
TypeScript ``@witseal/cli``. The callback invokes the built CLI as a subprocess
(``node <dist>/src/cli/index.js --data-dir <dir> exec --mode <mode> -- /bin/sh -c
<command>``) — the same ``runExec`` pipeline the OpenCode adapter calls directly.
No global CLI install is required. Configuration is read from the environment,
exactly like the OpenHands adapter:

    WITSEAL_CLI_ENTRY  absolute path to dist/src/cli/index.js (required)
    WITSEAL_DATA_DIR   WitSeal data dir (default ~/.witseal)
    WITSEAL_MODE       gate (deny-by-default) | witness (default gate)
    WITSEAL_NODE       node binary (default "node")

See ``COVERAGE.md`` for the honest scope caveat and the live receipt id.
"""

from __future__ import annotations

import os
import re
import subprocess
from dataclasses import dataclass
from typing import Any

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

    Mirrors the OpenHands / OpenCode adapters: a freeform command is run as
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


def default_bridge_config_from_env() -> WitSealBridgeConfig:
    """Build a bridge config from environment (see module docstring)."""
    cli_entry = os.environ.get("WITSEAL_CLI_ENTRY", "")
    if not cli_entry:
        raise RuntimeError(
            "WITSEAL_CLI_ENTRY must point at the built dist/src/cli/index.js"
        )
    return WitSealBridgeConfig(
        cli_entry=cli_entry,
        data_dir=os.environ.get("WITSEAL_DATA_DIR", os.path.expanduser("~/.witseal")),
        node=os.environ.get("WITSEAL_NODE", "node"),
        mode=os.environ.get("WITSEAL_MODE", "gate"),
    )


def _result_to_function_response(
    result: WitSealRunResult, command: str
) -> dict[str, Any]:
    """Shape a WitSeal run result as an ADK tool function-response dict."""
    if result.denied:
        return {
            "status": "denied",
            "denied": True,
            "command": command,
            "exit_code": result.exit_code,
            "event_id": result.event_id,
            "receipt_id": result.receipt_id,
            "witseal": (
                "command DENIED by policy (deny-by-default); it did not run. "
                f"Recorded as evidence (event {result.event_id})."
            ),
        }
    return {
        "status": "ok" if result.exit_code == 0 else "error",
        "denied": False,
        "command": command,
        "exit_code": result.exit_code,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "receipt_id": result.receipt_id,
        "event_id": result.event_id,
        "witseal": (
            f"full execution receipt recorded (receipt={result.receipt_id} "
            f"event={result.event_id}); verify with `witseal verify`."
        ),
    }


def make_witseal_before_tool_callback(
    cfg: WitSealBridgeConfig | None = None,
    *,
    tool_names: set[str] | frozenset[str] | None = None,
    command_keys: tuple[str, ...] = ("command", "cmd"),
):
    """Build an ADK ``before_tool_callback`` that mediates the authored shell tool.

    Verified ADK 2.2.0 contract (``functions.py``): the callback is invoked as
    ``callback(tool=<BaseTool>, args=<dict>, tool_context=<ToolContext>)`` and a
    **truthy return breaks the loop**; the real tool then runs only
    ``if function_response is None`` — so returning a dict makes WitSeal the
    execution path for the guarded tool.

    Parameters
    ----------
    cfg:
        Bridge config; defaults to ``default_bridge_config_from_env()``.
    tool_names:
        If given, only tools whose ``name`` is in this set are mediated; other
        tools fall through (return ``None``) to their normal execution. Default
        ``None`` mediates **every** tool the callback is attached to — intended
        for an agent whose granted toolset is exactly the authored shell tool, so
        the witnessed tool is the only execution path.
    command_keys:
        Argument keys to look for the freeform command, in order.
    """
    resolved = cfg or default_bridge_config_from_env()

    def witseal_before_tool_callback(
        tool=None, args=None, tool_context=None, **_ignored
    ) -> dict[str, Any] | None:
        # Scope guard: only mediate the authored tool(s) we own.
        name = getattr(tool, "name", None)
        if tool_names is not None and name not in tool_names:
            return None

        args = args or {}
        command = None
        for key in command_keys:
            value = args.get(key)
            if isinstance(value, str) and value:
                command = value
                break
        if command is None:
            # Not a shell-style call we own; let ADK run it normally.
            return None

        result = run_through_witseal(command, resolved)
        # Returning a dict is the seam: ADK skips the real tool body and uses this
        # as the function response (functions.py Step 2 break → Step 3 skip).
        return _result_to_function_response(result, command)

    return witseal_before_tool_callback


# Convenience module-level callback bound to env config (lazy). Attach this to an
# LlmAgent as ``before_tool_callback=witseal_before_tool_callback`` when the env
# vars are set; for explicit config, prefer ``make_witseal_before_tool_callback``.
def witseal_before_tool_callback(tool=None, args=None, tool_context=None, **kw):
    return make_witseal_before_tool_callback()(
        tool=tool, args=args, tool_context=tool_context, **kw
    )


def build_witnessed_shell_tool(cfg: WitSealBridgeConfig | None = None):
    """Build the WitSeal-authored shell ``FunctionTool`` for an ADK agent.

    The tool's own body is a **fail-closed sentinel**: if it ever executed it
    would refuse, because the only sanctioned execution path is the WitSeal
    ``before_tool_callback`` (which intercepts the call and runs the command
    under the witness boundary). Compose an agent as::

        from google.adk.agents import LlmAgent
        agent = LlmAgent(
            model="...",
            name="witnessed",
            tools=[build_witnessed_shell_tool()],
            before_tool_callback=make_witseal_before_tool_callback(),
        )

    With the granted toolset being exactly this authored tool, the witnessed tool
    is the agent's only execution path: every run yields a verifiable receipt.
    """
    from google.adk.tools.function_tool import FunctionTool

    def witnessed_shell(command: str) -> dict:
        """Run a shell command under the WitSeal witness boundary.

        Args:
            command: The shell command to execute, e.g. ``echo hello``.

        Returns:
            A dict with the command's output and the WitSeal receipt id.
        """
        # Fail closed: this body must never be the execution path. WitSeal's
        # before_tool_callback intercepts and mediates the call; if control ever
        # reaches here, witnessing was bypassed — refuse rather than run raw.
        raise RuntimeError(
            "witseal: witnessed_shell must be mediated by the WitSeal "
            "before_tool_callback; raw execution is refused (fail-closed)."
        )

    tool = FunctionTool(func=witnessed_shell)
    # Carry the bridge config alongside the tool for callers that build a scoped
    # callback from it (kept simple; the env-based callback is the default).
    tool._witseal_cfg = cfg  # type: ignore[attr-defined]
    return tool
