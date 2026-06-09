# Open Interpreter adapter — full execution coverage

Integrates WitSeal with [Open Interpreter](https://github.com/OpenInterpreter/open-interpreter)
(the `interpreter` package) so the agent's **own** code execution runs through
WitSeal — every code block the model runs becomes a full, independently
verifiable execution receipt (witnessed execution for Open Interpreter), not
just calls routed to a separate witnessed tool.

This is the own-execute path (Full Execution Coverage tier). It differs from the
MCP integration (where WitSeal is an additional `shell` tool *alongside* the
agent's built-in execution): here WitSeal **replaces the executor** behind the
agent's code-running registry, so the host's native execution is inside the
witness boundary.

## How it works (language-registry swap)

Open Interpreter drives the model's generated code through a mutable *language
registry*: `interpreter.computer.languages` is a list of language classes
(Python, Shell, JavaScript, …), each a `BaseLanguage` whose `run(code)` is a
generator that streams output chunks back to the agent loop. When the model
emits a code block, Open Interpreter looks up the language by name in that
registry and drives its `run`.

`register_witseal_executor(interpreter, cfg)` replaces the class registered for
the chosen language names with a witnessed one. The witnessed language keeps the
registry contract (a class with `name`/`aliases` and a `run(code)` generator
yielding `{"type","format","content"}` chunks) but its `run` routes the block
through WitSeal's pipeline (classify → policy → mediate → witness → receipt)
instead of a raw subprocess, and streams the receipt id back as a final console
chunk.

Cross-language bridge: Open Interpreter is Python; WitSeal's `runExec` is the
TypeScript `@witseal/cli`. The witnessed language invokes the built CLI as a
subprocess (`node <dist>/src/cli/index.js --data-dir <dir> exec --mode <m> --
<argv>`) — the same `runExec` pipeline the OpenCode adapter calls directly. No
global CLI install is required. A shell block runs as `/bin/sh -c <code>`; an
interpreted block runs via its interpreter (`python3 -c <code>`, `node -e
<code>`, …), all under one `witseal exec` mediation.

## License: adapter vs. fork (important)

Open Interpreter is licensed **AGPL-3.0**. This adapter is **separate WitSeal
code that shells out** to the WitSeal CLI; it does **not** import, vendor, or
incorporate any Open Interpreter source. Distributing this adapter therefore
does not pull Open Interpreter's AGPL obligations into WitSeal:

- **Calling** an unmodified, separately-installed Open Interpreter through its
  public registry API (what this adapter does) is ordinary use — it does not
  create a derivative of Open Interpreter and does not trigger AGPL copyleft on
  WitSeal.
- **Forking** Open Interpreter, or running a **modified** Open Interpreter as a
  network service, is what triggers AGPL-3.0 — and this adapter does neither.

The adapter deliberately imports nothing from `interpreter`: `BaseLanguage` is
discovered from the live registry at runtime and passed in, so the module is
importable (and the bridge is live-verifiable) without Open Interpreter present.
See `COVERAGE.md` for the full statement.

## Use (registry swap into a live interpreter)

```python
from interpreter import interpreter
from witseal_open_interpreter import register_witseal_executor, WitSealBridgeConfig

cfg = WitSealBridgeConfig(
    cli_entry="/abs/path/to/@witseal-cli/dist/src/cli/index.js",
    data_dir="/abs/path/to/witseal-data-dir",  # must contain policy-packs/
    mode="gate",  # deny-by-default
)

# Witness the languages the agent is allowed to run. After this call, every
# code block the model emits in these languages executes through `witseal exec`
# and yields a receipt.
register_witseal_executor(interpreter, cfg, languages=("shell", "python"))

# interpreter.chat("...")  # the agent's own execution is now witnessed
```

To witness a single language without a live interpreter (e.g. in a harness), use
`make_witseal_language(cfg, "shell", BaseLanguage)` and place it in the registry
directly, or call the bridge function `run_through_witseal(code, cfg)`.

## Coverage status (honest)

"Full Execution Coverage" means **every** execution-capable language in the
registry the agent is allowed to run is witnessed, with no bypass path — reached
here by *restricting the witnessed registry to the languages passed to*
`register_witseal_executor`.

| Surface | Status |
|---|---|
| Shell code blocks | **witnessed** — registry swap → `witseal exec`; live-proven (receipt → `witseal verify` VALID) |
| Python / JS / Ruby / AppleScript blocks | **witnessed** — run via their interpreter under one `witseal exec` mediation when their name is passed to `register_witseal_executor` |
| `computer.*` helper APIs (browser, files, vision, …) | separate surface — not the code-block executor; not covered by this swap |

A configuration that leaves an execution-capable language in the registry
unswapped (i.e. does not pass it to `register_witseal_executor`) is **not** Full
for that language. The claim is scoped to the witnessed registry above.

## Notes

- **Never bypasses WitSeal**: a block runs only via `runExec`. A Gate denial
  blocks execution (exit `100`) and is recorded as `denied_by_policy`; the
  witnessed language surfaces that the block did not run.
- Each block is a discrete witnessed execution — there is no persistent
  interactive session to interrupt; `stop`/`terminate` are best-effort no-ops
  for registry parity.
- This adapter is Python (Open Interpreter is Python). It is source under
  `src/adapters/open_interpreter/`; it is not shipped in the npm package (which
  is the TypeScript CLI). Packaging for distribution is a separate, later step.
