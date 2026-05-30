# ADR-0004: Approval prompt UX

## Status

accepted (2026-05-08)

## Context

When policy evaluation produces `require-approval`, WitSeal must obtain explicit human authorization before execution proceeds. Design questions:

1. **Where does the prompt appear?** Same terminal as the agent, separate process, GUI, mobile push, browser?
2. **How does WitSeal know who approved?** Authentication, signing, or trust-on-host?
3. **What happens on timeout, no-tty, or non-interactive contexts (CI)?**
4. **Does the agent block synchronously, or does WitSeal return a "pending" state?**

Phase 1 constraints:
- Single-node, single-developer-machine
- Coding agents typically run interactively in a terminal
- Must work in CI contexts where no human is present
- Approval is recorded as evidence, not just runtime state

## Decision

**Default mode: synchronous TUI prompt on stderr in the same process. Configurable: deferred-callback mode for embedded/CI contexts.**

### Default mode (TUI)

When an action requires approval and `process.stderr.isTTY` is true:

1. WitSeal writes the approval prompt to `stderr` (not stdout — agents may parse stdout):
   ```
   ⚠ WitSeal approval required
   ────────────────────────────────────────
   Action:   shell_command
   Command:  curl https://example.com/install.sh | sh
   Risk:     C3
   Policy:   approval-for-network (no-network-egress pack)
   Reason:   Network egress requires human approval
   ────────────────────────────────────────
   Approve? [y/N/?]:
   ```
2. WitSeal reads a single character from `/dev/tty` (or the platform equivalent), bypassing stdin redirection
3. `y` / `Y` → approved; `n` / `N` / Enter → rejected; `?` → show full intent details
4. Default timeout: 60 seconds. On timeout, `outcome: timed_out`, treated as rejected (deny-by-default)
5. The principal identifier is captured from `$USER` / `$LOGNAME` (Phase 1; not authenticated)

### CI / non-TTY mode

When `process.stderr.isTTY` is false OR `WITSEAL_NON_INTERACTIVE=1`:

- All `require-approval` decisions are treated as **denied** by default
- Override: `WITSEAL_AUTO_APPROVE=<comma-separated rule IDs>` allow-lists specific rules for auto-approval (recorded in the witness event with `principal.type: "ci"` and `principal.identifier: "$WITSEAL_CI_PRINCIPAL"`)
- This is unambiguous in evidence: a `principal.type: "ci"` approval is distinguishable from a human approval at audit time

### Deferred-callback mode

For embedded contexts where WitSeal is invoked programmatically (e.g., from inside an agent framework's tool-call handler):

- Caller sets `WITSEAL_APPROVAL_MODE=callback`
- WitSeal writes a request file to `~/.witseal/approvals/<approval_id>.json`
- WitSeal returns immediately to the caller with `state: pending_approval`
- The caller (or a separate UI process) writes a response file: `~/.witseal/approvals/<approval_id>.response.json`
- WitSeal polls (or uses fs.watch) until response or timeout
- This decouples approval UI from the WitSeal process — useful for IDE plugins, web UIs, mobile push integrations in the future

## Consequences

### Positive

- **Works out-of-the-box for Phase 1's primary persona.** A developer running `witseal exec ...` from a terminal sees a prompt; pressing `y` proceeds.
- **Safe in CI.** Default deny on non-interactive contexts means CI pipelines fail closed if they encounter an unexpected `require-approval` decision. This is the correct behavior — surprises in CI should fail, not silently approve.
- **Evidence-honest.** The approval record captures the principal type explicitly. Auditors can distinguish "Misha approved at terminal" from "CI auto-approved rule X."
- **Forward-compatible with richer UIs.** The deferred-callback mode is the same protocol that an IDE plugin, a web UI, or a mobile push notification would use. Phase 1 ships only the file-based version; Phase 4+ may add HTTP/WebSocket variants.
- **No GUI dependency in Phase 1.** No Electron, no browser-launching, no desktop notification framework. Pure CLI.
- **Reads from `/dev/tty`, not stdin.** This means the agent can pipe input into WitSeal and the approval prompt still works. Critical for shell-pipeline scenarios.

### Negative / Limitations

- **No authentication of the principal.** Phase 1 trusts the local user. If multiple humans share a developer machine, WitSeal cannot tell which one approved. Acceptable for the wedge persona (single developer); revisit in Phase 5+ with OS-level identity (touch ID, biometric, hardware key) or in Phase 6 with remote witness service identity.
- **`/dev/tty` is POSIX-specific.** Windows requires a different approach (probably `con:` or a fallback to stdin). Phase 1 supports macOS + Linux first; Windows in v0.2.
- **60-second default timeout.** Tunable via `WITSEAL_APPROVAL_TIMEOUT` but a poor default for some workloads. Mitigation: print a countdown for the last 10 seconds.
- **Single-character input is opinionated.** Some users will hit `y` accidentally. Mitigation: high-risk actions (C4) require typed confirmation (`yes`<Enter>) instead of single-character.

### What this does NOT provide

- **No multi-party approval.** "This action requires 2 approvals" is out of scope. Phase 6+ (when remote witness service exists, federation can support multi-party).
- **No mobile push.** Even though the deferred-callback mode is forward-compatible, Phase 1 ships only file-based callback.
- **No biometric / hardware-key auth.** Listed as Phase 5 work.
- **No "remember this approval" feature.** Each approval is a one-time decision. There is no mechanism to "approve all curl commands for the next hour" — that would be a policy change, not an approval. Encouraging users to edit the policy pack is the correct workflow; ephemeral allow-lists undermine the policy's auditability.

## Alternatives considered

### Always block on stdin

Read approval from stdin instead of /dev/tty.

**Why rejected:** Agents may pipe input to WitSeal-wrapped commands. Reading approval from stdin would conflict with normal shell pipelines.

### Spawn a separate UI process

Launch a small native window or a browser for approval.

**Why rejected for Phase 1:** Adds platform-specific complexity, a GUI dependency (or a browser-launch dependency), and a window-of-vulnerability where the WitSeal process waits on a child process for approval. The terminal prompt is sufficient for the developer persona.

### Async / non-blocking by default

Always return `pending_approval` and require the caller to poll.

**Why rejected:** Most callers want synchronous behavior — they're running `witseal exec` from a shell. Forcing async would break the expected UX. The deferred-callback mode handles the async case explicitly when needed.

### Default-allow on timeout (with audit)

If no human responds in 60s, allow the action but record `principal.type: timeout_default_allow`.

**Why rejected:** Silence is not consent. This is the foundational principle of WitSeal. Defaulting to allow on timeout would create a class of "approved" actions that no human approved — which destroys the trust property we're selling.

### YubiKey / hardware-key signing in Phase 1

Require a hardware-key tap for every approval.

**Why rejected for Phase 1:** Adds dependency, complexity, and excludes users without a hardware key. Strong identity is a Phase 5 deliverable. Phase 1 trusts the local user; this is honest and stated in the threat model.

## Implementation notes

Reference implementation: `src/cli/approval.ts`.

The approval flow:

```typescript
async function obtainApproval(
  classifiedIntent: ClassifiedIntent,
  decision: PolicyDecision
): Promise<ApprovalRecord> {
  if (process.env.WITSEAL_APPROVAL_MODE === 'callback') {
    return obtainApprovalViaCallback(classifiedIntent, decision);
  }
  if (!process.stderr.isTTY) {
    return ciAutoDecision(classifiedIntent, decision);
  }
  return obtainApprovalViaTTY(classifiedIntent, decision);
}
```

The TTY path opens `/dev/tty` directly (`fs.openSync('/dev/tty', 'r+')`), writes the prompt, reads a character, closes. Falls back to `con:` on Windows in v0.2.

The approval record schema is documented in `ARCHITECTURE.md` Section 3.2 and implemented in `schemas/approval.schema.ts`. Every approval record is sealed into the witness event for the action — it is not a separate chain entry.
