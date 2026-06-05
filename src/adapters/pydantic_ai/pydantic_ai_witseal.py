"""Witnessed execution for Pydantic AI — WitSeal-authored tool (own-execute).

Pydantic AI runs an agent's tools by calling the Python *function* registered
for each tool: ``FunctionToolset.call_tool`` ultimately invokes
``tool.call_func(args, ctx)``, which runs the body of whatever function was
passed to ``@agent.tool`` / ``@agent.tool_plain`` / ``Tool(fn)`` (verified
against pydantic-ai 1.106.0 — ``Tool(fn).function is fn``). There is no separate
"executor" object to swap; the function body *is* the execution.

So the cleanest way to put an agent's *actual* command execution under the
WitSeal witness boundary is to make WitSeal **author the tool**: this module
provides a shell tool whose body routes the command through WitSeal's pipeline
(classify -> policy -> mediate -> witness -> receipt) instead of a raw
``subprocess`` / ``os.system``. WitSeal owns that tool's execution (own-execute),
so every invocation yields a real, independently-verifiable execution receipt.

Honesty ceiling (per the OpenHands model): witnessing is scoped to the tool(s)
WitSeal authors here. It does NOT witness the framework's internals, the model,
or any *other* tool the agent was granted. To get full execution coverage, the
agent must be granted the witnessed tool as its execution path (see COVERAGE.md):
compose the toolset so the WitSeal-authored shell tool is the only shell/exec
tool the agent can call.

Cross-language bridge: pydantic-ai is Python; WitSeal's ``runExec`` pipeline is
in the TypeScript ``@witseal/cli``. The tool body invokes the built witseal CLI
as a subprocess — ``node <dist>/src/cli/index.js --data-dir <dir> exec --mode
<mode> -- /bin/sh -c <command>`` — the same pipeline the OpenHands / OpenCode
adapters drive. No global install of the CLI is required.

Public surface:

* ``run_through_witseal(command)`` — the self-contained bridge: run a freeform
  shell command through WitSeal and return ``(exit_code, stdout, stderr,
  receipt_id, event_id)``. Reads ``WITSEAL_CLI_ENTRY`` / ``WITSEAL_DATA_DIR`` /
  ``WITSEAL_NODE`` / ``WITSEAL_MODE`` from the environment, exactly like the
  OpenHands adapter.
* ``witseal_shell(command)`` — the tool *function body* (own-execute). Register
  it as a pydantic-ai tool; pydantic-ai will call this body to run the tool.
* ``register_witseal_shell_tool(agent)`` — convenience: register ``witseal_shell``
  on an ``Agent`` as a plain tool (``agent.tool_plain``) so it is the agent's
  witnessed execution path.
* ``build_witseal_shell_tool()`` — return a ``pydantic_ai.Tool`` wrapping the
  body, for ``Agent(tools=[...])`` composition.
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
    """Run a freeform shell command through the WitSeal pipeline via the CLI.

    Mirrors the OpenHands / OpenCode adapters: a freeform command is run as
    ``/bin/sh -c "<command>"``. Returns the exit code, captured output, and the
    receipt / event ids parsed from the witness footer (stderr).

    Environment (same contract as the OpenHands adapter):
      WITSEAL_CLI_ENTRY  absolute path to dist/src/cli/index.js (required)
      WITSEAL_DATA_DIR   WitSeal data dir (default ~/.witseal)
      WITSEAL_NODE       node binary (default "node")
      WITSEAL_MODE       gate (deny-by-default) | witness (default gate)
    """
    cli_entry = os.environ.get("WITSEAL_CLI_ENTRY", "")
    if not cli_entry:
        raise RuntimeError(
            "WITSEAL_CLI_ENTRY must point at the built dist/src/cli/index.js"
        )
    data_dir = os.environ.get("WITSEAL_DATA_DIR", os.path.expanduser("~/.witseal"))
    node = os.environ.get("WITSEAL_NODE", "node")
    mode = os.environ.get("WITSEAL_MODE", "gate")
    argv = [
        node,
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


def witseal_shell(command: str) -> str:
    """Run a shell command — WitSeal owns this execution (own-execute).

    This is the tool *function body*. Registered on a pydantic-ai ``Agent``
    (e.g. via ``@agent.tool_plain`` or ``Tool(witseal_shell)``), pydantic-ai
    calls this body to execute the tool, so the command runs through WitSeal's
    pipeline and produces a full, verifiable execution receipt — not a raw
    subprocess. The receipt id is surfaced in the returned text so a reviewer can
    ``witseal receipt show`` / ``witseal verify`` it.

    Args:
        command: A shell command to execute (run as ``/bin/sh -c "<command>"``).

    Returns:
        The command's stdout plus a WitSeal footer with the receipt/event ids,
        or a denial / boundary notice (no silent bypass).
    """
    result = run_through_witseal(command)

    if result.denied:
        return (
            "[witseal] command DENIED by policy (deny-by-default); it did not "
            f"run. Recorded as evidence (event {result.event_id})."
        )

    footer = (
        f"\n[witseal: receipt={result.receipt_id} event={result.event_id} "
        f"exit={result.exit_code} — full execution receipt recorded; "
        f"verify with `witseal verify`]"
    )
    return (result.stdout or "") + footer


def register_witseal_shell_tool(agent, name: str = "shell"):
    """Register the WitSeal-authored shell tool on a pydantic-ai ``Agent``.

    Registers ``witseal_shell`` as a *plain* tool (no ``RunContext`` needed) so
    it becomes the agent's witnessed execution path. Compose the agent so this
    is the only shell/exec tool it can call (see COVERAGE.md) to get full
    execution coverage of the granted toolset.

    Returns the ``agent`` for chaining.
    """
    agent.tool_plain(name=name)(witseal_shell)
    return agent


def build_witseal_shell_tool(name: str = "shell"):
    """Return a ``pydantic_ai.Tool`` wrapping the WitSeal-authored shell body.

    For ``Agent(tools=[build_witseal_shell_tool()])`` composition. pydantic-ai
    will call ``witseal_shell`` (this Tool's ``.function``) to execute the tool.
    """
    from pydantic_ai import Tool

    return Tool(witseal_shell, name=name, takes_ctx=False)
