"""OpenHands full-L3 adapter — WitSeal file-tool executors (Stage B).

Stage 1 (``witseal_openhands.py``) put the agent's *shell* under witness by
swapping the terminal tool's executor. Stage B does the same for every
file-mutating tool the agent can be granted, routing the actual write through
WitSeal's ``file_write`` execution path (``witseal exec-file`` →
classify → policy → mediateFile → witness → receipt) so each mutation yields a
full, independently-verifiable execution receipt.

Bypass-free by construction: these executors are the ONLY writer — they compute
the resulting file content and hand it to ``witseal exec-file`` (content on
stdin); they never let the stock OpenHands editor touch the disk. Read-only
``view`` is delegated to the stock executor (non-mutating, nothing to witness).
Operations WitSeal's ``file_write`` model cannot honestly represent —
``file_editor`` ``undo_edit`` and ``apply_patch`` DELETE / MOVE — are REFUSED
with an explicit error, never silently bypassed (refusing a delete/rename is the
honest boundary; a witnessed delete/rename would be a new intent = a wire-format
/ canon change, out of scope here).

Verified against openhands-tools 1.21.0 (see README / status log):
- file_editor: FileEditorAction(command∈{view,create,str_replace,insert,undo_edit},
  path, file_text, old_str, new_str, insert_line, view_range);
  FileEditorObservation(command, path, prev_exist, old_content, new_content).
- planning_file_editor: PlanningFileEditor{Action,Observation} subclass
  file_editor, constrained to PLAN.md (allowed_edits_files=[plan_path]).
- apply_patch: ApplyPatchAction(patch:str); core.process_patch =
  identify_files_needed → load_files → text_to_patch → patch_to_commit →
  apply_commit. We stop BEFORE apply_commit and route the commit's per-path
  new_content through witseal instead.

CLI contract (Stage A, witseal exec-file):
  node <cli_entry> --data-dir <dir> --segment <id> exec-file
       --path <path> --agent <id> --write-mode <overwrite|append|create_only>
       --mode <gate|witness>          # file content on STDIN
  Witness footer on stderr: "[witseal: event=evt_… receipt=rcpt_… …]".
"""

from __future__ import annotations

import os
from dataclasses import dataclass

from openhands.sdk.tool import ToolExecutor
from openhands.tools.apply_patch import core as patch_core
from openhands.tools.apply_patch.definition import (
    ApplyPatchAction,
    ApplyPatchObservation,
    ApplyPatchTool,
)
from openhands.tools.file_editor.definition import (
    FileEditorAction,
    FileEditorObservation,
    FileEditorTool,
)
from openhands.tools.planning_file_editor.definition import (
    PlanningFileEditorAction,
    PlanningFileEditorObservation,
    PlanningFileEditorTool,
)

from witseal_openhands import (
    WITSEAL_DENIED_EXIT,
    WitSealBridgeConfig,
    WitSealRunResult,
    _EVENT_RE,
    _RECEIPT_RE,
)
import subprocess


def run_file_through_witseal(
    path: str, content: bytes, write_mode: str, cfg: WitSealBridgeConfig
) -> WitSealRunResult:
    """Write *content* to *path* through the witseal file_write pipeline.

    Invokes ``witseal exec-file`` with the content on stdin. Returns exit code,
    captured output, and the receipt / event ids parsed from the witness footer.
    """
    argv = [
        cfg.node,
        cfg.cli_entry,
        "--data-dir",
        cfg.data_dir,
        "exec-file",
        "--path",
        path,
        "--write-mode",
        write_mode,
        "--mode",
        cfg.mode,
    ]
    proc = subprocess.run(argv, input=content, capture_output=True, check=False)
    stderr = proc.stderr.decode("utf-8", "replace")
    stdout = proc.stdout.decode("utf-8", "replace")
    receipt_m = _RECEIPT_RE.search(stderr)
    event_m = _EVENT_RE.search(stderr)
    return WitSealRunResult(
        exit_code=proc.returncode,
        stdout=stdout,
        stderr=stderr,
        receipt_id=receipt_m.group(1) if receipt_m else None,
        event_id=event_m.group(1) if event_m else None,
    )


_WITNESS_FOOTER = (
    "\n[witseal: receipt={receipt} event={event} write_mode={mode} "
    "— full file_write receipt recorded; verify with `witseal verify`]"
)


def _denied_obs(
    obs_cls: type, command: str, path: str | None, result: WitSealRunResult
) -> FileEditorObservation:
    return obs_cls.from_text(
        text=(
            "[witseal] file write DENIED by policy (deny-by-default); it did not "
            f"run. Recorded as evidence (event {result.event_id})."
        ),
        is_error=True,
        command=command,
        path=path,
    )


def _refuse_obs(obs_cls: type, command: str, path: str | None, why: str):
    return obs_cls.from_text(
        text=(
            f"[witseal] '{why}' is not witnessable by the file_write model and is "
            "REFUSED (no silent bypass). A witnessed delete/rename would require a "
            "new intent type (a wire-format change), which is out of scope."
        ),
        is_error=True,
        command=command,
        path=path,
    )


def _compute_file_editor_write(
    action: FileEditorAction,
) -> tuple[str, bytes, str] | None:
    """Return (path, new_content_bytes, write_mode) for a mutating file_editor
    action, or ``None`` if the action is not a witnessed write (view/undo).

    Mirrors openhands-tools 1.21.0 file_editor semantics (editor.py): create →
    file_text (create_only); str_replace → single-occurrence replacement
    (overwrite); insert → insert new_str after insert_line (overwrite). The
    WitSeal executor is the only writer, so the resulting content is computed
    here without touching the disk.
    Raises ValueError with the stock error wording on an invalid edit.
    """
    cmd = action.command
    path = action.path
    if cmd == "create":
        if action.file_text is None:
            raise ValueError("Parameter `file_text` is required for command: create")
        return path, action.file_text.encode("utf-8"), "create_only"

    if cmd == "str_replace":
        if action.old_str is None:
            raise ValueError("Parameter `old_str` is required for command: str_replace")
        new_str = action.new_str or ""
        if new_str == action.old_str:
            raise ValueError("No replacement was performed. `new_str` equals `old_str`.")
        with open(path, encoding="utf-8") as fh:
            content = fh.read()
        count = content.count(action.old_str)
        if count == 0:
            raise ValueError(
                f"No replacement was performed; `old_str` `{action.old_str}` did not "
                "appear verbatim in the file."
            )
        if count > 1:
            raise ValueError(
                f"No replacement was performed. Multiple occurrences of `old_str` "
                f"`{action.old_str}`. Please ensure it is unique."
            )
        idx = content.find(action.old_str)
        new_content = content[:idx] + new_str + content[idx + len(action.old_str) :]
        return path, new_content.encode("utf-8"), "overwrite"

    if cmd == "insert":
        if action.insert_line is None:
            raise ValueError("Parameter `insert_line` is required for command: insert")
        new_str = action.new_str or ""
        with open(path, encoding="utf-8") as fh:
            content = fh.read()
        lines = content.split("\n")
        num_lines = len(lines)
        if action.insert_line < 0 or action.insert_line > num_lines:
            raise ValueError(
                f"insert_line {action.insert_line} out of range [0, {num_lines}]"
            )
        new_lines = lines[: action.insert_line] + new_str.split("\n") + lines[action.insert_line :]
        return path, "\n".join(new_lines).encode("utf-8"), "overwrite"

    # view / undo_edit are not witnessed writes.
    return None


class WitSealFileEditorExecutor(ToolExecutor):
    """Drop-in replacement for OpenHands' ``FileEditorExecutor``.

    Mutating commands (create / str_replace / insert) are routed through
    ``witseal exec-file`` (the WitSeal is the only writer). ``view`` is delegated
    to the stock executor (read-only). ``undo_edit`` is refused (not witnessable
    without a history model; no silent bypass).
    """

    _obs_cls = FileEditorObservation

    def __init__(self, cfg: WitSealBridgeConfig, stock_executor=None) -> None:
        self.cfg = cfg
        self.stock_executor = stock_executor
        self.last_result: WitSealRunResult | None = None

    def __call__(self, action: FileEditorAction, conversation=None):
        cmd = action.command
        if cmd == "view":
            if self.stock_executor is not None:
                return self.stock_executor(action, conversation)
            return self._obs_cls.from_text(
                text="[witseal] view requires the stock executor (read-only path).",
                is_error=True,
                command=cmd,
                path=action.path,
            )
        if cmd == "undo_edit":
            return _refuse_obs(self._obs_cls, cmd, action.path, "undo_edit")

        try:
            plan = _compute_file_editor_write(action)
        except (ValueError, OSError) as exc:
            return self._obs_cls.from_text(
                text=f"[witseal] {exc}", is_error=True, command=cmd, path=action.path
            )
        if plan is None:
            return _refuse_obs(self._obs_cls, cmd, action.path, cmd)

        path, content, write_mode = plan
        result = run_file_through_witseal(path, content, write_mode, self.cfg)
        self.last_result = result
        if result.denied:
            return _denied_obs(self._obs_cls, cmd, path, result)
        footer = _WITNESS_FOOTER.format(
            receipt=result.receipt_id, event=result.event_id, mode=write_mode
        )
        return self._obs_cls.from_text(
            text=f"[witseal] file_write OK ({cmd} -> {write_mode})" + footer,
            is_error=result.exit_code != 0,
            command=cmd,
            path=path,
            new_content=content.decode("utf-8", "replace"),
        )


class WitSealPlanningFileEditorExecutor(WitSealFileEditorExecutor):
    """WitSeal executor for ``planning_file_editor`` — edits constrained to the
    plan file. Mutations to any other path are refused; the plan write is
    witnessed via ``witseal exec-file`` like ``file_editor``."""

    _obs_cls = PlanningFileEditorObservation

    def __init__(
        self, cfg: WitSealBridgeConfig, plan_path: str, stock_executor=None
    ) -> None:
        super().__init__(cfg, stock_executor)
        self.plan_path = os.path.abspath(plan_path)

    def __call__(self, action: PlanningFileEditorAction, conversation=None):
        if action.command not in ("view",) and os.path.abspath(action.path) != self.plan_path:
            return _refuse_obs(
                self._obs_cls,
                action.command,
                action.path,
                f"edit outside the plan file {self.plan_path}",
            )
        return super().__call__(action, conversation)


class WitSealApplyPatchExecutor(ToolExecutor):
    """Drop-in replacement for OpenHands' ``ApplyPatchExecutor``.

    Computes the patch commit with openhands' own pure functions (no
    re-parsing), refuses any DELETE or MOVE op (not witnessable by file_write,
    no silent bypass), and routes each ADD/UPDATE file's resulting content
    through ``witseal exec-file``. The patch is applied atomically: if it
    contains any refused op, nothing is written.
    """

    def __init__(self, cfg: WitSealBridgeConfig, workspace_root: str) -> None:
        self.cfg = cfg
        self.workspace_root = os.path.abspath(workspace_root)
        self.last_results: list[WitSealRunResult] = []

    def _open_fn(self, path: str) -> str:
        with open(path, encoding="utf-8") as fh:
            return fh.read()

    def __call__(self, action: ApplyPatchAction, conversation=None) -> ApplyPatchObservation:
        try:
            paths = patch_core.identify_files_needed(action.patch)
            orig = patch_core.load_files(paths, self._open_fn)
            patch, fuzz = patch_core.text_to_patch(action.patch, orig)
            commit = patch_core.patch_to_commit(patch, orig)
        except patch_core.DiffError as exc:
            return ApplyPatchObservation.from_text(text=str(exc), is_error=True)

        # Refuse DELETE / MOVE before writing anything (atomic, no bypass).
        for path, change in commit.changes.items():
            if change.type == patch_core.ActionType.DELETE:
                return ApplyPatchObservation.from_text(
                    text=(
                        f"[witseal] DELETE of {path} is not witnessable by the "
                        "file_write model and is REFUSED (no silent bypass). The "
                        "patch was not applied."
                    ),
                    is_error=True,
                )
            if change.move_path is not None:
                return ApplyPatchObservation.from_text(
                    text=(
                        f"[witseal] MOVE/rename of {path} -> {change.move_path} is not "
                        "witnessable by the file_write model and is REFUSED (no silent "
                        "bypass). The patch was not applied."
                    ),
                    is_error=True,
                )

        # Witness each ADD/UPDATE via witseal exec-file.
        self.last_results = []
        receipts: list[str] = []
        for path, change in commit.changes.items():
            if change.new_content is None:
                continue
            write_mode = "create_only" if change.type == patch_core.ActionType.ADD else "overwrite"
            result = run_file_through_witseal(
                path, change.new_content.encode("utf-8"), write_mode, self.cfg
            )
            self.last_results.append(result)
            if result.denied:
                return ApplyPatchObservation.from_text(
                    text=(
                        f"[witseal] file write for {path} DENIED by policy "
                        f"(deny-by-default). event {result.event_id}."
                    ),
                    is_error=True,
                )
            if result.exit_code != 0:
                return ApplyPatchObservation.from_text(
                    text=(
                        f"[witseal] file write for {path} failed (exit "
                        f"{result.exit_code}). {result.stderr[:400]}"
                    ),
                    is_error=True,
                )
            if result.receipt_id:
                receipts.append(f"{path}={result.receipt_id}")

        return ApplyPatchObservation.from_text(
            text=(
                "[witseal] apply_patch OK — each file_write witnessed; receipts: "
                + ", ".join(receipts)
                + " — verify with `witseal verify`"
            ),
            is_error=False,
            message="Done!",
            fuzz=fuzz,
            commit=commit,
        )


def _swap(tool, executor):
    """Return *tool* with its executor replaced (openhands ToolDefinition is a
    frozen pydantic model; use set_executor which returns a model_copy)."""
    try:
        if tool.executor is not None:
            tool.executor.close()
    except Exception:
        pass
    return tool.set_executor(executor)


def build_witseal_file_editor_tool(conv_state, cfg: WitSealBridgeConfig) -> FileEditorTool:
    """FileEditorTool with the WitSeal executor swapped in (keeps the stock
    executor for read-only ``view``)."""
    tool = FileEditorTool.create(conv_state)[0]
    stock = tool.executor
    return _swap(tool, WitSealFileEditorExecutor(cfg, stock_executor=stock))


def build_witseal_planning_file_editor_tool(
    conv_state, cfg: WitSealBridgeConfig, plan_path: str | None = None
) -> PlanningFileEditorTool:
    """PlanningFileEditorTool with the WitSeal executor swapped in."""
    tools = (
        PlanningFileEditorTool.create(conv_state, plan_path=plan_path)
        if plan_path is not None
        else PlanningFileEditorTool.create(conv_state)
    )
    tool = tools[0]
    stock = tool.executor
    resolved_plan = getattr(stock, "file_editor_executor", None)
    # Recover plan_path from the stock executor's allowed set when not supplied.
    plan = plan_path
    if plan is None and resolved_plan is not None:
        allowed = getattr(resolved_plan, "allowed_edits_files", None)
        if allowed:
            plan = str(next(iter(allowed)))
    if plan is None:
        plan = os.path.join(conv_state.workspace.working_dir, ".agents_tmp", "PLAN.md")
    return _swap(
        tool, WitSealPlanningFileEditorExecutor(cfg, plan_path=plan, stock_executor=stock)
    )


def build_witseal_apply_patch_tool(conv_state, cfg: WitSealBridgeConfig) -> ApplyPatchTool:
    """ApplyPatchTool with the WitSeal executor swapped in."""
    tool = ApplyPatchTool.create(conv_state)[0]
    workspace_root = conv_state.workspace.working_dir
    return _swap(tool, WitSealApplyPatchExecutor(cfg, workspace_root=workspace_root))


__all__ = [
    "WITSEAL_DENIED_EXIT",
    "WitSealApplyPatchExecutor",
    "WitSealFileEditorExecutor",
    "WitSealPlanningFileEditorExecutor",
    "build_witseal_apply_patch_tool",
    "build_witseal_file_editor_tool",
    "build_witseal_planning_file_editor_tool",
    "run_file_through_witseal",
]
