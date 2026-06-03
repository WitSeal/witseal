"""Stage-1 live proof: WitSeal terminal-executor swap for OpenHands.

Runs under the REAL openhands-sdk/tools 1.21.0 so the executor is exercised
against the genuine SDK types (ToolExecutor / TerminalAction / TerminalObservation),
not mocks. Proves, by fact, deterministically (no LLM):

  1. EXECUTOR BRIDGE — WitSealTerminalExecutor(TerminalAction) routes the command
     through the witseal CLI and yields a receipt id (full execution receipt),
     returning a valid TerminalObservation whose text carries the output.
  2. DENY PATH — under Gate with a deny rule, the command is refused (exit 100),
     not executed.
  3. CONTRACT — the executor is a real openhands ToolExecutor and returns a real
     TerminalObservation (so it is swap-compatible with TerminalTool).

The outer runner then calls `witseal verify` to confirm the receipt's chain is
independently VALID.

Env: WITSEAL_CLI_ENTRY, WITSEAL_DATA_DIR (with policy packs), WITSEAL_MODE.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from openhands.sdk.tool import ToolExecutor  # noqa: E402
from openhands.tools.terminal.definition import (  # noqa: E402
    TerminalAction,
    TerminalObservation,
)

from witseal_openhands import (  # noqa: E402
    WITSEAL_DENIED_EXIT,
    WitSealTerminalExecutor,
    default_bridge_config_from_env,
)


def main() -> int:
    cfg = default_bridge_config_from_env()
    print(f"[harness] cli_entry={cfg.cli_entry}")
    print(f"[harness] data_dir={cfg.data_dir} mode={cfg.mode}")

    executor = WitSealTerminalExecutor(cfg)
    assert isinstance(executor, ToolExecutor), "not a real openhands ToolExecutor"

    # 1. EXECUTOR BRIDGE (allowed) -----------------------------------------
    marker = "witseal-openhands-stage1-ok"
    obs = executor(TerminalAction(command=f"echo {marker}"))
    print("\n[1] EXECUTOR BRIDGE")
    print(f"    obs type={type(obs).__name__}")
    print(f"    exit_code={obs.exit_code} is_error={obs.is_error}")
    print(f"    receipt={executor.last_result.receipt_id}")
    print(f"    text={obs.text!r}")
    assert isinstance(obs, TerminalObservation), "did not return a TerminalObservation"
    assert obs.exit_code == 0, f"expected exit 0, got {obs.exit_code}"
    assert marker in obs.text, "command stdout not surfaced in observation text"
    assert executor.last_result.receipt_id is not None, "no receipt id produced"
    bridge_receipt = executor.last_result.receipt_id

    # 2. DENY PATH ----------------------------------------------------------
    obs_deny = executor(TerminalAction(command="rm -rf /tmp/witseal-stage1-deny"))
    print("\n[2] DENY PATH")
    print(f"    exit_code={obs_deny.exit_code} is_error={obs_deny.is_error}")
    print(f"    text={obs_deny.text!r}")
    assert obs_deny.exit_code == WITSEAL_DENIED_EXIT, "deny rule did not block"
    assert obs_deny.is_error is True

    # 3. CONTRACT (swap-compatibility) -------------------------------------
    print("\n[3] CONTRACT")
    print(f"    action_type={TerminalAction.__name__} obs_type={TerminalObservation.__name__}")
    print("    WitSealTerminalExecutor is a ToolExecutor returning TerminalObservation"
          " -> swap-compatible with TerminalTool(executor=...).")

    print("\n[harness] ALL STAGE-1 BRIDGE ASSERTIONS PASSED")
    print(f"[harness] VERIFY_RECEIPT={bridge_receipt}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
