"""Open Interpreter full-coverage adapter — WitSeal-side execution swap.

Open Interpreter (the ``interpreter`` package) runs the model's generated code
through a mutable *language registry*: ``interpreter.computer.languages`` is a
list of language classes (Python, Shell, JavaScript, ...), each a
``BaseLanguage`` whose ``run(code)`` is a generator that streams output chunks
back to the loop. When the model emits a code block, Open Interpreter looks up
the language by name in that registry and drives its ``run`` — so swapping the
class registered for a language name puts the agent's *actual* execution under a
new boundary, with no fork of Open Interpreter required.

This adapter registers a witnessed language whose ``run`` routes the code block
through WitSeal's pipeline (classify -> policy -> mediate -> witness -> receipt)
instead of a raw subprocess, so every executed block yields a full,
independently-verifiable execution receipt. It mirrors the OpenHands CLI-bridge
adapter (``run_through_witseal``): Open Interpreter is Python, WitSeal's
``runExec`` is the TypeScript ``@witseal/cli``, so the language invokes the built
CLI as a subprocess and parses the witness footer for the receipt id.

License note (important): this module is separate WitSeal code that *shells out*
to the WitSeal CLI. It does not import, vendor, or incorporate any Open
Interpreter source, so distributing this adapter does not pull Open Interpreter's
AGPL-3.0 obligations into WitSeal. Only forking Open Interpreter or running a
modified Open Interpreter as a network service triggers AGPL copyleft; calling
an unmodified, separately-installed Open Interpreter through its public registry
API does not. See COVERAGE.md for the full adapter-vs-fork distinction.

Provided here:

* ``run_through_witseal`` — run a code block through the WitSeal pipeline via the
  CLI and return exit code, captured output, and the receipt / event ids. Shell
  blocks run as ``/bin/sh -c <code>``; other languages run via their interpreter
  (``python3 -c <code>``, ...), all under one ``witseal exec`` mediation.
* ``make_witseal_language`` — build a ``BaseLanguage``-shaped class bound to a
  bridge config and a target language name, suitable for the registry.
* ``register_witseal_executor`` — swap the witnessed language into a live
  ``interpreter`` instance's ``computer.languages`` registry (replacing the
  built-in for that name), so the agent's own code execution is witnessed.
"""

from __future__ import annotations

import os
import re
import shlex
import subprocess
from dataclasses import dataclass, field

# WitSeal's reserved exit code for a Gate denial (deny-by-default block).
WITSEAL_DENIED_EXIT = 100

_RECEIPT_RE = re.compile(r"receipt=(rcpt_[A-Za-z0-9]+)")
_EVENT_RE = re.compile(r"event=(evt_[A-Za-z0-9]+)")

# How to turn a code block in language <name> into an argv the WitSeal CLI runs
# as a single mediated execution (after the ``-- `` separator). Shell is the
# faithful default; interpreted languages run via ``-c``. Unknown languages fall
# back to shell, which is honest: an opaque block is elevated by the classifier.
_LANGUAGE_ARGV = {
    "shell": lambda code: ["/bin/sh", "-c", code],
    "bash": lambda code: ["/bin/sh", "-c", code],
    "sh": lambda code: ["/bin/sh", "-c", code],
    "python": lambda code: ["python3", "-c", code],
    "javascript": lambda code: ["node", "-e", code],
    "node": lambda code: ["node", "-e", code],
    "ruby": lambda code: ["ruby", "-e", code],
    "applescript": lambda code: ["osascript", "-e", code],
}


def _argv_for(language: str, code: str) -> list[str]:
    builder = _LANGUAGE_ARGV.get(language.lower())
    if builder is None:
        # Opaque language -> run as a shell block; the classifier elevates it.
        return ["/bin/sh", "-c", code]
    return builder(code)


@dataclass
class WitSealBridgeConfig:
    """How to reach the WitSeal CLI and which data dir to witness into."""

    cli_entry: str  # absolute path to dist/src/cli/index.js
    data_dir: str  # WitSeal data directory (chain, policy packs, receipts)
    node: str = "node"
    mode: str = "gate"  # "gate" (deny-by-default) or "witness"
    segment_id: str = "default"
    agent_id: str = "open-interpreter"
    extra_env: dict[str, str] = field(default_factory=dict)


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


def run_through_witseal(
    code: str, cfg: WitSealBridgeConfig, language: str = "shell"
) -> WitSealRunResult:
    """Run a code block through the WitSeal pipeline via the CLI.

    Mirrors the OpenHands adapter. The block for ``language`` is mapped to a
    concrete argv (shell: ``/bin/sh -c <code>``; python: ``python3 -c <code>``;
    ...), then handed to ``witseal exec`` as a single mediated execution. Returns
    the exit code, captured output, and the receipt / event ids parsed from the
    witness footer (stderr).
    """
    inner = _argv_for(language, code)
    argv = [
        cfg.node,
        cfg.cli_entry,
        "--data-dir",
        cfg.data_dir,
        "--segment",
        cfg.segment_id,
        "exec",
        "--mode",
        cfg.mode,
        "--agent",
        cfg.agent_id,
        "--",
        *inner,
    ]
    env = dict(os.environ)
    env.update(cfg.extra_env)
    proc = subprocess.run(argv, capture_output=True, text=True, check=False, env=env)
    receipt_m = _RECEIPT_RE.search(proc.stderr)
    event_m = _EVENT_RE.search(proc.stderr)
    return WitSealRunResult(
        exit_code=proc.returncode,
        stdout=proc.stdout,
        stderr=proc.stderr,
        receipt_id=receipt_m.group(1) if receipt_m else None,
        event_id=event_m.group(1) if event_m else None,
    )


def make_witseal_language(cfg: WitSealBridgeConfig, name: str, base):
    """Build a witnessed language class for the Open Interpreter registry.

    ``base`` is Open Interpreter's ``BaseLanguage`` (passed in so this module
    imports nothing from Open Interpreter — keeping it license-clean and
    importable without Open Interpreter installed). The returned subclass keeps
    the registry contract — a class with ``name``/``aliases`` and a
    ``run(code)`` generator yielding ``{"type","format","content"}`` chunks —
    but its ``run`` routes the code block through WitSeal instead of a raw
    subprocess, so each executed block is a full witnessed execution. The
    receipt id is streamed as a final console chunk so a reviewer can
    ``witseal receipt show`` / ``witseal verify`` it.
    """

    class WitsealLanguage(base):  # type: ignore[misc, valid-type]
        # Registry identity: Open Interpreter selects a language by these.
        name = name
        aliases = [name.lower()]

        def __init__(self, *args, **kwargs):
            try:
                super().__init__(*args, **kwargs)
            except Exception:
                # BaseLanguage.__init__ may be a no-op / vary by version.
                pass
            self._cfg = cfg
            self.last_result: WitSealRunResult | None = None

        def run(self, code):
            result = run_through_witseal(code, self._cfg, language=name)
            self.last_result = result

            if result.denied:
                yield {
                    "type": "console",
                    "format": "output",
                    "content": (
                        "[witseal] code block DENIED by policy "
                        "(deny-by-default); it did not run. Recorded as evidence "
                        f"(event {result.event_id})."
                    ),
                }
                return

            if result.stdout:
                yield {"type": "console", "format": "output", "content": result.stdout}
            if result.stderr and result.exit_code != 0:
                # Surface real stderr only on failure; the witness footer itself
                # is informational and parsed above, not shown as an error.
                yield {
                    "type": "console",
                    "format": "output",
                    "content": result.stderr,
                }
            yield {
                "type": "console",
                "format": "output",
                "content": (
                    f"\n[witseal: receipt={result.receipt_id} "
                    f"event={result.event_id} exit={result.exit_code} — full "
                    "execution receipt recorded; verify with `witseal verify`]"
                ),
            }

        def stop(self):
            # Each block is a discrete witnessed execution; there is no live
            # session to interrupt. Best-effort no-op for registry parity.
            pass

        def terminate(self):
            pass

    WitsealLanguage.__name__ = f"Witseal{name.capitalize()}Language"
    return WitsealLanguage


def register_witseal_executor(
    interpreter, cfg: WitSealBridgeConfig, languages=("shell", "python")
):
    """Swap witnessed languages into a live ``interpreter`` instance.

    For each name in ``languages``, replace the class registered in
    ``interpreter.computer.languages`` with a WitSeal-routed one built from the
    SAME ``BaseLanguage`` the existing entries derive from (so nothing from Open
    Interpreter is imported here). After this call, when the model emits a code
    block in one of those languages, Open Interpreter drives the witnessed
    ``run`` -> the block executes through ``witseal exec`` and yields a receipt.

    Returns the interpreter for chaining. Raises if the registry shape is
    unexpected (fail loud rather than silently leave execution unwitnessed).
    """
    registry = interpreter.computer.languages
    if not registry:
        raise RuntimeError(
            "interpreter.computer.languages is empty; cannot determine the "
            "BaseLanguage to derive witnessed languages from."
        )

    # Derive the common base from an existing entry's MRO (its BaseLanguage).
    sample = registry[0]
    base = None
    for klass in sample.__mro__:
        if klass.__name__ == "BaseLanguage":
            base = klass
            break
    if base is None:
        # Fall back to the immediate parent; still avoids importing OI here.
        base = sample.__mro__[1] if len(sample.__mro__) > 1 else object

    wanted = {n.lower() for n in languages}
    new_registry = []
    replaced: set[str] = set()
    for klass in registry:
        names = {getattr(klass, "name", "").lower()}
        names |= {a.lower() for a in getattr(klass, "aliases", [])}
        target = names & wanted
        if target:
            canonical = getattr(klass, "name", next(iter(target)))
            new_registry.append(make_witseal_language(cfg, canonical, base))
            replaced |= target
        else:
            new_registry.append(klass)

    # Any requested language not already present is added fresh.
    for missing in wanted - replaced:
        new_registry.append(make_witseal_language(cfg, missing, base))

    interpreter.computer.languages = new_registry
    # Open Interpreter caches instantiated languages on the terminal; clear it so
    # the next block re-instantiates from the swapped registry.
    try:
        interpreter.computer.terminal._active_languages = {}
    except Exception:
        pass
    return interpreter


def default_bridge_config_from_env() -> WitSealBridgeConfig:
    """Build a bridge config from environment.

    WITSEAL_CLI_ENTRY  absolute path to dist/src/cli/index.js (required)
    WITSEAL_DATA_DIR   data dir (default ~/.witseal)
    WITSEAL_MODE       gate | witness (default gate)
    WITSEAL_SEGMENT    chain segment id (default "default")
    WITSEAL_AGENT_ID   agent identifier (default "open-interpreter")
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
        segment_id=os.environ.get("WITSEAL_SEGMENT", "default"),
        agent_id=os.environ.get("WITSEAL_AGENT_ID", "open-interpreter"),
    )


if __name__ == "__main__":
    # Minimal bridge self-check (no Open Interpreter, no LLM): run one block
    # through WitSeal and print the receipt id. Used by COVERAGE live-verify.
    import sys

    cfg = default_bridge_config_from_env()
    lang = sys.argv[1] if len(sys.argv) > 1 else "shell"
    code = sys.argv[2] if len(sys.argv) > 2 else "echo witnessed-open-interpreter"
    res = run_through_witseal(code, cfg, language=lang)
    print(f"exit={res.exit_code} receipt={res.receipt_id} event={res.event_id}")
    print(res.stdout, end="")
    # Echo the shlex-safe argv for transparency in logs.
    print("argv:", " ".join(shlex.quote(a) for a in _argv_for(lang, code)))
    sys.exit(0 if not res.denied else WITSEAL_DENIED_EXIT)
