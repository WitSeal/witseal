# Cursor adapter (Level 2 — witness)

Integrates WitSeal with [Cursor](https://cursor.com) by recording its Shell tool
calls as evidence. Cursor runs tools with its own executor and does not let an
integration replace it, so WitSeal cannot own execution here. Instead it
**observes**: the `postToolUse` hook fires after a tool runs and carries the
real command and result. For the `Shell` tool, `tool_output` is a
JSON-stringified payload with the exit code and command output (the agent CLI
reports an `output` field; the IDE docs show `stdout` — both are accepted).
When the payload's `cwd` is empty, the workspace root is used. WitSeal records a
**Level-2 witness event** from that — evidence of what the Shell tool actually
did.

This is the honest floor of the ladder. Where the OpenCode, MCP, and framework
integrations own execution and produce a full Level-3 receipt, this one records
a witnessed result after the fact.

## What it does and does not do

- **Does:** record each `Shell` tool call (command + observed exit code/stdout)
  as a witness event in the evidence chain, with a policy annotation.
- **Does not block.** `postToolUse` runs *after* the command has executed, so
  this adapter cannot refuse a command — it witnesses the result. Cursor is
  gate-capable via a pre-execution hook (`beforeShellExecution`), but gating is
  out of scope here; this adapter is witness-only.
- **Only the `Shell` tool** is witnessed in this version. Other tools are
  skipped (the hook exits cleanly without recording).

## Install

1. `npm install -g @witseal/cli`
2. Add a `postToolUse` hook for the `Shell` tool in your Cursor hooks config
   (`~/.cursor/hooks.json` or project `<repo>/.cursor/hooks.json`):

```json
{
  "version": 1,
  "hooks": {
    "postToolUse": [
      { "command": "witseal-witness-cursor", "matcher": "Shell" }
    ]
  }
}
```

3. Add at least one policy pack under `<WITSEAL_DATA_DIR>/policy-packs/`. Policy
   here is **annotation only** — it records what policy would have decided; it
   does not enforce (the command already ran). With no policy pack, the event is
   recorded with outcome `no_policy_configured`.

## Configuration (environment only)

| Variable | Meaning | Default |
|---|---|---|
| `WITSEAL_DATA_DIR` | Data directory (chain, policy packs) | `~/.witseal` |
| `WITSEAL_SEGMENT` | Chain segment id | `default` |
| `WITSEAL_AGENT_ID` | Agent identifier recorded in the witness event | `cursor` |

## Outcomes

| Observed | Policy annotation | Recorded outcome |
|---|---|---|
| exit 0 | allow | `allowed_executed` |
| exit ≠ 0 | allow | `allowed_executed_with_error` |
| any | deny / require-approval | `witnessed_executed` (or `…_with_error`) |
| any | no policy pack | `no_policy_configured` |

A non-`allow` annotation is recorded as `witnessed_executed`, never
`denied_by_policy` — the command ran (Cursor executed it), and the witness
record reflects that honestly.

## Notes

- The hook always exits 0, so it never disrupts Cursor, even on a malformed
  payload or a record error (diagnostics go to stderr).
- The full observed output is captured in the witness event; review it with
  `witseal events list` / `witseal receipt show`.
