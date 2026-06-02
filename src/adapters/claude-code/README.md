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
- **The witness does not block.** `PostToolUse` runs *after* the command has
  executed, so the witness cannot refuse a command — it records the result.
  Blocking a command *before* it runs is a separate, opt-in **PreToolUse gate**
  (see [below](#optional-gate-before-a-command-runs-pretooluse)); the witness
  itself never blocks.
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

## Optional: gate before a command runs (PreToolUse)

The witness above is observe-only. If you also want WitSeal to **block** a
command *before* Claude Code runs it, add the companion `PreToolUse` gate. It
evaluates your policy packs and tells Claude Code to allow, block, or escalate —
**without executing the command** (Claude Code still runs it when allowed, so
this stays Level 2: WitSeal decides, it never owns execution).

The gate is **additive** — it can only make Claude Code *more* restrictive:

| Policy decision | Gate tells Claude Code | Evidence recorded |
|---|---|---|
| `deny` | block the call | `denied_by_policy` (witness event, `execution_result` null) |
| `require-approval` | escalate to the user (`ask`) | none yet — PostToolUse records it if it runs |
| `allow` | nothing; normal flow proceeds | none yet — PostToolUse records it when it runs |

**Fail-closed.** With no policy pack configured the gate **blocks** (and records
`no_policy_configured`), honoring WitSeal's deny-by-default stance — the opposite
of the witness, which fails open. Set `WITSEAL_UNSAFE_ALLOW_NO_POLICY=1` to run
advisory-only (no decision) when no pack is present. An internal error also
fails closed.

Add it alongside the witness hook in your Claude Code settings:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "witseal-gate-claude-code" }
        ]
      }
    ]
  }
}
```

The gate reads the same `WITSEAL_DATA_DIR` / `WITSEAL_SEGMENT` /
`WITSEAL_AGENT_ID` environment as the witness.

## Notes

- The hook always exits 0, so it never disrupts Claude Code, even on a
  malformed payload or a record error (diagnostics go to stderr).
- The full observed output is captured in the witness event; review it with
  `witseal events list` / `witseal receipt show`.
