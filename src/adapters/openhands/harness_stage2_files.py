"""Stage-B live proof: WitSeal file-tool executor swaps for OpenHands.

Runs under the REAL openhands-sdk/tools 1.21.0 so the executors are exercised
against genuine SDK types (FileEditorAction/Observation, ApplyPatchAction/
Observation, PlanningFileEditor*), not mocks. Deterministic (no LLM). Proves,
by fact, that each file-mutating tool, when its executor is the WitSeal one,
routes the actual write through `witseal exec-file` and yields a real execution
receipt — and that DELETE/MOVE/undo are refused (no silent bypass).

The outer runner then calls `witseal verify` on each receipt's data dir to
confirm the chain is independently VALID.

Env: WITSEAL_CLI_ENTRY, WITSEAL_DATA_DIR (with policy-packs/), WITSEAL_MODE.
"""

from __future__ import annotations

import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from openhands.sdk.tool import ToolExecutor  # noqa: E402
from openhands.tools.apply_patch.definition import (  # noqa: E402
    ApplyPatchAction,
    ApplyPatchObservation,
)
from openhands.tools.file_editor.definition import (  # noqa: E402
    FileEditorAction,
    FileEditorObservation,
)
from openhands.tools.planning_file_editor.definition import (  # noqa: E402
    PlanningFileEditorAction,
    PlanningFileEditorObservation,
)

from witseal_openhands import default_bridge_config_from_env  # noqa: E402
from witseal_openhands_files import (  # noqa: E402
    WitSealApplyPatchExecutor,
    WitSealFileEditorExecutor,
    WitSealPlanningFileEditorExecutor,
)

RECEIPTS: list[str] = []


def _record(r):
    if r and r.receipt_id:
        RECEIPTS.append(r.receipt_id)


def main() -> int:
    cfg = default_bridge_config_from_env()
    ws = tempfile.mkdtemp(prefix="witseal-oh-stageB-ws.")
    print(f"[harness] cli_entry={cfg.cli_entry}")
    print(f"[harness] data_dir={cfg.data_dir} mode={cfg.mode} ws={ws}")

    fe = WitSealFileEditorExecutor(cfg)
    assert isinstance(fe, ToolExecutor)

    # 1. file_editor create -------------------------------------------------
    p = os.path.join(ws, "note.txt")
    obs = fe(FileEditorAction(command="create", path=p, file_text="alpha\nbeta\n"))
    print("\n[1] file_editor create")
    print(f"    obs={type(obs).__name__} is_error={obs.is_error} receipt={fe.last_result.receipt_id}")
    print(f"    text={obs.text[:120]!r}")
    assert isinstance(obs, FileEditorObservation)
    assert not obs.is_error, obs.text
    assert open(p).read() == "alpha\nbeta\n", "create did not write expected content"
    assert fe.last_result.receipt_id, "no receipt for create"
    _record(fe.last_result)

    # 2. file_editor str_replace -------------------------------------------
    obs = fe(FileEditorAction(command="str_replace", path=p, old_str="beta", new_str="gamma"))
    print("\n[2] file_editor str_replace")
    print(f"    is_error={obs.is_error} receipt={fe.last_result.receipt_id}")
    assert not obs.is_error, obs.text
    assert open(p).read() == "alpha\ngamma\n", f"str_replace wrong: {open(p).read()!r}"
    _record(fe.last_result)

    # 3. file_editor insert -------------------------------------------------
    obs = fe(FileEditorAction(command="insert", path=p, insert_line=1, new_str="inserted"))
    print("\n[3] file_editor insert")
    print(f"    is_error={obs.is_error} receipt={fe.last_result.receipt_id}")
    assert not obs.is_error, obs.text
    assert open(p).read() == "alpha\ninserted\ngamma\n", f"insert wrong: {open(p).read()!r}"
    _record(fe.last_result)

    # 4. file_editor undo_edit -> REFUSED ----------------------------------
    obs = fe(FileEditorAction(command="undo_edit", path=p))
    print("\n[4] file_editor undo_edit (expect REFUSED)")
    print(f"    is_error={obs.is_error} text={obs.text[:100]!r}")
    assert obs.is_error and "REFUSED" in obs.text, "undo_edit was not refused"

    # 5. apply_patch ADD + UPDATE ------------------------------------------
    ap = WitSealApplyPatchExecutor(cfg, workspace_root=ws)
    add_path = os.path.join(ws, "added.py")
    patch_add = (
        "*** Begin Patch\n"
        f"*** Add File: {add_path}\n"
        "+print('hello from witnessed add')\n"
        "*** End Patch\n"
    )
    obs = ap(ApplyPatchAction(patch=patch_add))
    print("\n[5] apply_patch ADD")
    print(f"    obs={type(obs).__name__} is_error={obs.is_error} text={obs.text[:140]!r}")
    assert isinstance(obs, ApplyPatchObservation)
    assert not obs.is_error, obs.text
    # apply_patch's parser yields the added body without a trailing newline.
    assert open(add_path).read() == "print('hello from witnessed add')", (
        f"ADD content wrong: {open(add_path).read()!r}"
    )
    for r in ap.last_results:
        _record(r)
    assert ap.last_results and all(r.receipt_id for r in ap.last_results), "no receipt for ADD"

    # 6. apply_patch DELETE -> REFUSED (atomic; nothing written) -----------
    patch_del = (
        "*** Begin Patch\n"
        f"*** Delete File: {add_path}\n"
        "*** End Patch\n"
    )
    obs = ap(ApplyPatchAction(patch=patch_del))
    print("\n[6] apply_patch DELETE (expect REFUSED)")
    print(f"    is_error={obs.is_error} text={obs.text[:120]!r}")
    assert obs.is_error and "REFUSED" in obs.text, "DELETE was not refused"
    assert os.path.exists(add_path), "DELETE refusal must not remove the file"

    # 7. planning_file_editor on PLAN.md -----------------------------------
    plan = os.path.join(ws, "PLAN.md")
    pe = WitSealPlanningFileEditorExecutor(cfg, plan_path=plan)
    obs = pe(PlanningFileEditorAction(command="create", path=plan, file_text="# Plan\n- step 1\n"))
    print("\n[7] planning_file_editor create PLAN.md")
    print(f"    obs={type(obs).__name__} is_error={obs.is_error} receipt={pe.last_result.receipt_id}")
    assert isinstance(obs, PlanningFileEditorObservation)
    assert not obs.is_error, obs.text
    assert open(plan).read() == "# Plan\n- step 1\n"
    _record(pe.last_result)

    # 8. planning rejects edits outside the plan file ----------------------
    obs = pe(PlanningFileEditorAction(command="create", path=os.path.join(ws, "x.txt"), file_text="nope"))
    print("\n[8] planning_file_editor edit outside PLAN (expect REFUSED)")
    print(f"    is_error={obs.is_error} text={obs.text[:100]!r}")
    assert obs.is_error and "REFUSED" in obs.text, "off-plan edit not refused"

    print("\n[harness] ALL STAGE-B FILE-TOOL ASSERTIONS PASSED")
    print("[harness] VERIFY_RECEIPTS=" + ",".join(RECEIPTS))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
