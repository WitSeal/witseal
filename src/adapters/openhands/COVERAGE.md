# OpenHands full-L3 — execution coverage map

Honest, fact-based coverage of the OpenHands agent's execution surface under
WitSeal. Verified against openhands-sdk / openhands-tools 1.21.0.

## Witnessed execution path (core)

- Shell: `witseal exec` (`runExec` → `mediateShell`).
- File write: `witseal exec-file` (`runFileExec` → `mediateFile`), reusing the
  existing execution-result / witness schema (no new wire-format). golden
  receipt `8fc29592…` (1050 bytes) byte-identical throughout.

## Granted-toolset coverage

| Tool (1.21.0) | Execution? | Status |
|---|---|---|
| `terminal` (shell) | yes | **wrapped** — `WitSealTerminalExecutor` → `witseal exec`; live receipt → `witseal verify` VALID (Stage 1) |
| `file_editor` | yes (file mutation) | **wrapped** — `WitSealFileEditorExecutor` → `witseal exec-file`. create→create_only, str_replace/insert→overwrite. view delegated (read-only). undo_edit REFUSED. Live receipts; verify VALID (Stage B) |
| `apply_patch` | yes (file mutation) | **wrapped** — `WitSealApplyPatchExecutor`: ADD→create_only, UPDATE→overwrite via `witseal exec-file`; DELETE / MOVE REFUSED atomically (no silent bypass). Live receipt; verify VALID (Stage B) |
| `planning_file_editor` | yes (file mutation, PLAN.md) | **wrapped** — `WitSealPlanningFileEditorExecutor` → `witseal exec-file`; off-plan edits REFUSED. Live receipt; verify VALID (Stage B) |
| `task_tracker` | yes (writes `TASKS.json` to persistence_dir) | **EXCLUDED** from the witnessed toolset (its only write is internal task bookkeeping; excluded to keep the granted set fully witnessed; could be wrapped via the file path in a follow-up) |
| `browser_use` / `browser_tool_set` | yes (browser ops) | **EXCLUDED** (`cli_mode` ⇒ `enable_browser=False`; no witseal browser primitive) |
| `grep`, `glob` | subprocess, **read-only** search | pass-through (non-mutating; not a state-changing execution; reads are not witnessed in this model) |

`build_witnessed_toolset()` returns the default toolset with terminal +
file_editor wrapped and task_tracker + browser dropped. Default granted set
under cli_mode is `[terminal, file_editor, task_tracker]`; after WitSeal
restriction it is `[witseal-terminal, witseal-file_editor]` — **no unwrapped
execution-capable tool remains** (apply_patch / planning_file_editor are not in
the default set; both are wrapped for the presets that grant them).

## Stage D — programmatic `workspace.execute_command`

Fact (1.21.0): **no tool** routes through `BaseWorkspace.execute_command` — the
terminal tool owns its own session (which we swap), and no tool calls
`.execute_command()`. `execute_command` is reachable only **programmatically**
(SDK skills `sdk/skills/execute.py`, git `sdk/git/utils.py`, `workspace/repo.py`).
This is a separate surface from the agent's granted tools; it is not driven by
the witnessed toolset above. If an agent is configured to use those
programmatic skills, a witnessing `BaseWorkspace` subclass would be required to
cover that path. For the granted-tool execution surface (this order's scope),
no subclass is needed: the tool layer does not bypass via `execute_command`.

## Boundary refusals (no silent bypass)

`file_editor` undo_edit, `apply_patch` DELETE, and `apply_patch` MOVE/rename are
**refused**, not silently bypassed: WitSeal's `file_write` model represents only
content writes. A witnessed delete/rename would be a new intent type — a
wire-format / canon change — and is out of scope (would require founder
authorization + a schema decision).

## Status

- Stage A (file_write core): DONE, live (`witseal exec-file` → receipt → verify VALID).
- Stage B (file-tool wrappers): DONE, live deterministic proof (`harness_stage2_files.py`
  under real openhands 1.21.0; receipts for create/str_replace/insert/apply_patch-ADD/
  planning; undo/DELETE/off-plan refused; `witseal verify` VALID).
- Stage C (toolset restriction): DONE (`build_witnessed_toolset`; granted set reduced to
  witnessed tools; browser + task_tracker excluded; grounded by fact).
- Stage D (programmatic path): ANALYZED — separate surface; no tool-layer bypass.
- Stage E (live LLM agent driving each wrapped tool end-to-end, gpt-5.5): the deterministic
  harness proves each executor against the real SDK types + real receipts; the LLM-driven
  end-to-end run is the remaining proof. Runnable via the harnesses with a gpt-5.5 agent
  assembled from `build_witnessed_toolset`.

No merge — branch only. Card move to Full Execution Coverage is founder-authorized
after the live-LLM end-to-end (Stage E) closes.
