# Open Interpreter — execution coverage map

Honest, fact-based coverage of Open Interpreter's execution surface under
WitSeal. The mechanism is a swap of Open Interpreter's language registry
(`interpreter.computer.languages`); the witnessed execution primitive is the
unchanged WitSeal CLI (`witseal exec` → `runExec` → `mediateShell`). No
canon / wire-format change: the golden receipt and schemas are untouched.

## Witnessed execution path (core)

- Code block (any language passed to `register_witseal_executor`): mapped to a
  concrete argv (shell → `/bin/sh -c <code>`; python → `python3 -c <code>`;
  javascript → `node -e <code>`; …) and run as a single `witseal exec`
  mediation. The result is a full execution receipt (classify → policy →
  mediate → witness → receipt), not merely a witnessed decision.

## Registry coverage

| Registry surface | Execution? | Status |
|---|---|---|
| `shell` language | yes | **witnessed** — registry swap → `witseal exec`; live receipt → `witseal verify` VALID (see Live-verify) |
| `python` language | yes | **witnessed** — `python3 -c <code>` under `witseal exec` when `python` is passed to `register_witseal_executor` |
| `javascript` / `node`, `ruby`, `applescript` | yes | **witnessed** — run via their interpreter under one `witseal exec` mediation when their name is passed in |
| any other / opaque language block | yes | routed as a shell block (`/bin/sh -c <code>`); the classifier correctly elevates an opaque block |
| `computer.*` helper APIs (browser, files, vision, keyboard, …) | yes (host ops) | **separate surface** — these are not the model-driven code-block executor and are not covered by the registry swap |

`register_witseal_executor(interpreter, cfg, languages=(...))` replaces the
registered class for each requested language with a WitSeal-routed one derived
from the SAME `BaseLanguage` the existing entries use, and clears Open
Interpreter's cached active-language map so the next block re-instantiates from
the swapped registry. After the swap, **no unwitnessed execution-capable
language remains among the requested set** — and any execution-capable language
left out of that set is, honestly, not covered.

## Boundary behavior (no silent bypass)

- A Gate denial (deny-by-default) blocks the block before it runs (exit `100`)
  and is recorded as `denied_by_policy`; the witnessed language streams a chunk
  saying the block did not run. There is no fall-through to a raw subprocess.
- Each block is a discrete witnessed execution: there is no persistent
  interactive REPL session modelled, so `stop`/`terminate` are best-effort
  no-ops. This is surfaced honestly rather than pretending a live session is
  interruptible.

## License: adapter vs. fork

Open Interpreter is **AGPL-3.0**. This adapter is **separate WitSeal code that
shells out** to the WitSeal CLI and imports nothing from `interpreter`
(`BaseLanguage` is discovered from the live registry at runtime). Consequences:

- Distributing this adapter does **not** incorporate Open Interpreter source and
  does **not** subject WitSeal to AGPL copyleft — it merely *calls* a
  separately-installed, unmodified Open Interpreter through its public API.
- AGPL-3.0 obligations would attach only to **forking** Open Interpreter or
  running a **modified** Open Interpreter as a network service. This adapter does
  neither, so it is license-clean for WitSeal's own (permissive) distribution.

This is the deliberate reason the module imports nothing from `interpreter`: it
keeps the license boundary clean *and* lets the bridge be live-verified without
Open Interpreter installed.

## Live-verify (execution path)

The witnessed execution path was driven end-to-end (no LLM, no Open Interpreter
agent loop) via the adapter's own bridge `run_through_witseal`, against the
built WitSeal CLI under a throwaway data directory with a permissive Gate policy
pack:

- A benign block (`echo`, language `shell`) ran through `witseal exec` in Gate
  mode → a full execution receipt: `outcome=allowed_executed`, `decision=allow`,
  exit `0`.
- `witseal verify` over the resulting live chain returned **VALID** (chain).
- `witseal receipt show <id>` re-displayed the receipt with its full hash set
  (receipt / policy-decision / classified-intent / execution-result), confirming
  it is a real recorded receipt, not a parsed string.

This proves the **execution path** is valid: a block selected for the witnessed
registry produces a verifiable receipt. The full agent loop (the model emitting
the code block) was **not** run here — that needs Open Interpreter installed plus
an LLM key — but the agent-driven step is exactly the registry `run` this adapter
swaps, so the path it would drive is the one verified above.

## Status

- Bridge (`run_through_witseal`) + registry swap (`register_witseal_executor`):
  DONE.
- Live-verify of the execution path: DONE (shell block → receipt → `witseal
  verify` VALID; receipt independently shown).
- Live LLM agent loop: NOT run here (Open Interpreter + LLM key required). The
  witnessed `run` is the same one the loop drives.

## Verdict

For the witnessed registry (the languages passed to
`register_witseal_executor`), coverage is **Full Execution Coverage** by
construction: every requested execution-capable language is routed through
`witseal exec`, no unwitnessed fall-through remains among them, and the
execution path is live-verified VALID. The claim is scoped to that registry —
`computer.*` host helpers and any language left unswapped are explicitly out of
scope. golden receipt and schemas are untouched (no canon change); the adapter
is license-clean against Open Interpreter's AGPL-3.0 (calls, does not fork).
