# Witnessed execution for AutoGen

A WitSeal demo-client adapter that puts an **AutoGen** agent's code execution
under the WitSeal witness boundary by owning AutoGen's `CodeExecutor`. Each shell
code block the agent runs becomes an independently verifiable **execution
receipt** (`witseal verify`).

This is a **receipt-first, role-qualified** integration: WitSeal *witnesses the
code-executor tool* it authors here. It is not a gateway in front of AutoGen and
does not witness the framework's internals, the LLM, or model traffic — only the
execution of the executor it owns (the OpenHands honesty ceiling).

## How it works

AutoGen runs agent-authored code through a `CodeExecutor`
(`autogen_core.code_executor.CodeExecutor`): the agent emits `CodeBlock`s and the
executor's `execute_code_blocks(...)` runs them and returns a `CodeResult`.

`WitSealCommandLineCodeExecutor` is a real `CodeExecutor` subclass whose
`execute_code_blocks` routes each shell `CodeBlock` through WitSeal's pipeline
(classify → policy → mediate → witness → receipt) via the built `@witseal/cli`
subprocess (`node dist/src/cli/index.js … exec --mode <mode> -- /bin/sh -c
<code>`), instead of a raw local subprocess. The receipt / event ids are appended
to the executor's returned output so a reviewer can verify them.

Cross-language bridge: AutoGen is Python; WitSeal's `runExec` is TypeScript. The
adapter shells out to the built CLI (no global install needed) — the same
`runExec` pipeline the shipped OpenCode / OpenHands adapters drive.

## Use it

Hand the executor to an agent / team **in place of**
`LocalCommandLineCodeExecutor`:

```python
from autogen_agentchat.agents import CodeExecutorAgent
from autogen_witseal import (
    WitSealCommandLineCodeExecutor,
    default_bridge_config_from_env,
)

executor = WitSealCommandLineCodeExecutor(default_bridge_config_from_env())
agent = CodeExecutorAgent("coder", code_executor=executor)
# the agent's shell code execution is now the witnessed path
```

Or drive the seam directly (what the live-verify harness does, no LLM):

```python
import asyncio
from autogen_core import CancellationToken
from autogen_core.code_executor import CodeBlock

async def main():
    executor = WitSealCommandLineCodeExecutor(default_bridge_config_from_env())
    async with executor:
        result = await executor.execute_code_blocks(
            [CodeBlock(code="echo hello", language="sh")], CancellationToken()
        )
    print(result.output)  # carries [witseal: receipt=rcpt_… …]

asyncio.run(main())
```

## Configuration (env)

| Variable | Meaning | Default |
|---|---|---|
| `WITSEAL_CLI_ENTRY` | absolute path to the built `dist/src/cli/index.js` | **required** |
| `WITSEAL_DATA_DIR` | WitSeal data directory (chain, policy packs, receipts) | `~/.witseal` |
| `WITSEAL_MODE` | `gate` (deny-by-default) or `witness` | `gate` |

## Behavior

- **Shell blocks** (`sh`/`bash`/`shell`/`powershell`/`pwsh`): witnessed via
  `witseal exec`; full execution receipt per block.
- **Non-shell blocks** (`python`, …): **refused** (not silently run
  unwitnessed); a `[witseal]` notice is returned with a non-zero exit.
- **Policy DENY** (gate mode, deny-by-default): exit `100`; the block does not
  run and is recorded as evidence.
- `CodeResult.exit_code` is `0` only if every block exited `0`, else the first
  non-zero block's exit code.

## Verify

```sh
node "$WITSEAL_CLI_ENTRY" --data-dir "$WITSEAL_DATA_DIR" verify          # live chain
node "$WITSEAL_CLI_ENTRY" --data-dir "$WITSEAL_DATA_DIR" verify <receipt-json>
```

## Live status

Built and live-verified against `autogen-core` / `autogen-agentchat` **0.7.5**,
CLI **0.3.0** (in a throwaway `/tmp` venv): the seam was invoked directly, a real
execution receipt was produced (`rcpt_mq1j2n29JRFRxZvZS1uGWI`), and
`witseal verify` reported **`VALID ✓ (chain)`**. See `COVERAGE.md` for the scope
caveat (witnessed surface = shell code blocks; non-shell blocks refused; not a
claim over a config that also grants an unwitnessed executor).
