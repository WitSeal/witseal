"""Stage-E live proof: a REAL OpenHands LLM agent drives the witnessed tools.

Assembles a default agent (cli_mode → no browser), swaps the terminal and
file_editor executors for the WitSeal ones (so the agent's actual shell and
file writes are witnessed), runs a small task with a real LLM, and reports the
receipts the WitSeal executors produced. The outer runner then `witseal verify`s
the chain.

Env: WITSEAL_CLI_ENTRY, WITSEAL_DATA_DIR (policy-packs/), WITSEAL_MODE,
OPENAI_API_KEY, WITSEAL_E_MODEL (default gpt-5.5).
"""

from __future__ import annotations

import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from openhands.sdk import LLM, Conversation  # noqa: E402
from openhands.tools.preset.default import get_default_agent  # noqa: E402

from witseal_openhands import (  # noqa: E402
    WitSealTerminalExecutor,
    default_bridge_config_from_env,
)
from witseal_openhands_files import WitSealFileEditorExecutor  # noqa: E402


def main() -> int:
    cfg = default_bridge_config_from_env()
    model = os.environ.get("WITSEAL_E_MODEL", "gpt-5.5")
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("[harness] OPENAI_API_KEY missing", file=sys.stderr)
        return 3
    ws = tempfile.mkdtemp(prefix="witseal-oh-stageE-ws.")
    print(f"[harness] model={model} ws={ws} data_dir={cfg.data_dir} mode={cfg.mode}")

    llm = LLM(model=model, api_key=api_key, usage_id="agent")
    agent = get_default_agent(llm, cli_mode=True)
    conv = Conversation(agent=agent, workspace=ws)

    # Agent tools are resolved lazily; force readiness so tools_map exists,
    # then swap executors (init is idempotent, so the later run keeps our swap).
    conv._ensure_agent_ready()

    # Swap executors on the resolved tools so the agent's real execution is
    # witnessed. Keep references to read receipts after the run.
    term_exec = WitSealTerminalExecutor(cfg)
    file_exec = WitSealFileEditorExecutor(cfg)
    tools_map = conv.agent.tools_map
    swapped = []
    for name, ex in (("terminal", term_exec), ("file_editor", file_exec)):
        if name in tools_map:
            tools_map[name] = tools_map[name].set_executor(ex)
            swapped.append(name)
    # Drop task_tracker (writes its own TASKS.json) to keep the set witnessed.
    tools_map.pop("task_tracker", None)
    print(f"[harness] swapped executors: {swapped}; tools={list(tools_map.keys())}")

    conv.send_message(
        "Do exactly two things, then stop. "
        "1) Use the file_editor tool to create a file named report.txt in the "
        "working directory with the exact content: DONE. "
        "2) Use the terminal tool to run: echo finished"
    )
    conv.run()

    print("\n[harness] RESULTS")
    receipts = []
    for label, ex in (("file_editor", file_exec), ("terminal", term_exec)):
        r = ex.last_result
        if r is not None:
            print(f"    {label}: exit={r.exit_code} receipt={r.receipt_id} event={r.event_id}")
            if r.receipt_id:
                receipts.append(r.receipt_id)
        else:
            print(f"    {label}: NOT INVOKED by the agent")
    print("[harness] VERIFY_RECEIPTS=" + ",".join(receipts))
    return 0 if receipts else 1


if __name__ == "__main__":
    raise SystemExit(main())
