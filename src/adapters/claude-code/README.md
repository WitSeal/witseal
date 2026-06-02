# Claude Code adapter (Level 2 — witness)

Integrates WitSeal with [Claude Code](https://claude.com/claude-code) by
recording its Bash tool calls as evidence. Claude Code runs tools with its own
executor and does not let an integration replace it, so WitSeal cannot own
execution here. Instead it **observes**: the `PostToolUse` hook fires after a
tool runs and carries the real exit code, stdout, and stderr. WitSeal records a
**Level-2 witness event** from that — evidence of what the Bash tool actually
did.

This is the honest floor of the ladder. Where the OpenCode, MCP, and framework
integrations own execution and produce a full Level-3 receipt, this one records
a witnessed result after the fact.

## What it does and does not do

- **Does:** record each `Bash` tool call (command + observed exit/stdout/stderr)
  as a witness event in the evidence chain, with a policy annotation.
- **Does not block.** `PostToolUse` runs *after* the command has executed, so
  this adapter cannot refuse a command — it witnesses the result. Gating Claude
  Code before a command runs would need a different hook and is out of scope.
- **Only the `Bash` tool** is witnessed in this version. Other tools are
  skipped (the hook exits cleanly without recording).

## Install

1. `npm install -g @witseal/cli`
2. Add a `PostToolUse` hook for the `Bash` tool in your Claude Code settings
   (`~/.claude/settings.json` or project `.claude/settings.json`):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "witseal-witness-claude-code" }
        ]
      }
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
| `WITSEAL_AGENT_ID` | Agent identifier recorded in the witness event | `claude-code` |

## Outcomes

| Observed | Policy annotation | Recorded outcome |
|---|---|---|
| exit 0 | allow | `allowed_executed` |
| exit ≠ 0 / interrupted | allow | `allowed_executed_with_error` |
| any | deny / require-approval | `witnessed_executed` (or `…_with_error`) |
| any | no policy pack | `no_policy_configured` |

A non-`allow` annotation is recorded as `witnessed_executed`, never
`denied_by_policy` — the command ran (Claude Code executed it), and the witness
record reflects that honestly.

## Notes

- The hook always exits 0, so it never disrupts Claude Code, even on a
  malformed payload or a record error (diagnostics go to stderr).
- The full observed output is captured in the witness event; review it with
  `witseal events list` / `witseal receipt show`.
