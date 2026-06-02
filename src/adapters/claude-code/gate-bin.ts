#!/usr/bin/env node
/**
 * `witseal-gate-claude-code` — Claude Code PreToolUse hook entry.
 *
 * Configured as a Claude Code `PreToolUse` hook command for the `Bash` tool.
 * Claude Code pipes the hook payload as JSON on stdin; this evaluates policy
 * and, when witseal blocks or escalates, prints a `hookSpecificOutput` decision
 * to stdout (exit 0). For a policy allow or a non-Bash tool it prints nothing —
 * Claude Code's normal permission flow proceeds.
 *
 * Fail-closed: on a missing policy pack or any internal error, the gate blocks
 * (deny) rather than silently allowing — consistent with witseal's
 * deny-by-default invariant. This is the opposite of the PostToolUse witness
 * shim, which fails open (records nothing, never disrupts). Set
 * WITSEAL_UNSAFE_ALLOW_NO_POLICY=1 to operate advisory-only when no policy pack
 * is configured.
 *
 * Configuration is environment-only:
 *   WITSEAL_DATA_DIR   data directory            (default: ~/.witseal)
 *   WITSEAL_SEGMENT    chain segment id          (default: default)
 *   WITSEAL_AGENT_ID   recorded agent identifier (default: claude-code)
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  gateClaudeCodePreToolUse,
  type ClaudeCodeGateOptions,
  type PreToolUsePayload,
  type PermissionDecision,
} from './gate.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Print a PreToolUse decision in Claude Code's `hookSpecificOutput` form. */
function emitDecision(decision: PermissionDecision, reason: string): void {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
    }) + '\n'
  );
}

async function main(): Promise<void> {
  const opts: ClaudeCodeGateOptions = {
    dataDir: process.env['WITSEAL_DATA_DIR'] ?? join(homedir(), '.witseal'),
    segmentId: process.env['WITSEAL_SEGMENT'] ?? 'default',
    agentId: process.env['WITSEAL_AGENT_ID'] ?? 'claude-code',
  };

  let payload: PreToolUsePayload;
  try {
    payload = JSON.parse(await readStdin()) as PreToolUsePayload;
  } catch (e) {
    // Fail closed: a payload we cannot read is blocked, not allowed.
    process.stderr.write(
      `witseal-gate-claude-code: could not read/parse hook payload: ${e instanceof Error ? e.message : String(e)}; failing closed (deny)\n`
    );
    emitDecision('deny', 'witseal gate could not read the hook payload; failing closed');
    return;
  }

  try {
    const outcome = await gateClaudeCodePreToolUse(payload, opts);
    if (outcome.permissionDecision === null) {
      // No decision — let Claude Code's normal permission flow proceed.
      process.stderr.write(`witseal: no gate decision (${outcome.reason})\n`);
      return;
    }
    if (outcome.recorded) {
      process.stderr.write(
        `witseal: gate ${outcome.permissionDecision} — event=${outcome.recorded.eventId} outcome=${outcome.recorded.outcome}\n`
      );
    } else {
      process.stderr.write(`witseal: gate ${outcome.permissionDecision} (${outcome.reason})\n`);
    }
    emitDecision(outcome.permissionDecision, outcome.reason);
  } catch (e) {
    // Fail closed on any internal error — never silently allow.
    process.stderr.write(
      `witseal-gate-claude-code: gate error: ${e instanceof Error ? e.message : String(e)}; failing closed (deny)\n`
    );
    emitDecision('deny', 'witseal gate encountered an internal error; failing closed');
  }
}

void main();
