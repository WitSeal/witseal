#!/usr/bin/env node
/**
 * `witseal-witness-claude-code` — Claude Code PostToolUse hook entry.
 *
 * Configured as a Claude Code `PostToolUse` hook command. Claude Code pipes the
 * hook payload as JSON on stdin; this reads it, records a Level-2 witness event
 * for `Bash` tool calls, and always exits 0 so the hook never disrupts Claude
 * Code. Diagnostics go to stderr.
 *
 * Configuration is environment-only:
 *   WITSEAL_DATA_DIR   data directory            (default: ~/.witseal)
 *   WITSEAL_SEGMENT    chain segment id          (default: default)
 *   WITSEAL_AGENT_ID   recorded agent identifier (default: claude-code)
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  witnessClaudeCodePostToolUse,
  type ClaudeCodeWitnessOptions,
  type PostToolUsePayload,
} from './witness.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  const opts: ClaudeCodeWitnessOptions = {
    dataDir: process.env['WITSEAL_DATA_DIR'] ?? join(homedir(), '.witseal'),
    segmentId: process.env['WITSEAL_SEGMENT'] ?? 'default',
    agentId: process.env['WITSEAL_AGENT_ID'] ?? 'claude-code',
  };

  let payload: PostToolUsePayload;
  try {
    const raw = await readStdin();
    payload = JSON.parse(raw) as PostToolUsePayload;
  } catch (e) {
    process.stderr.write(
      `witseal-witness-claude-code: could not read/parse hook payload: ${e instanceof Error ? e.message : String(e)}\n`
    );
    return; // exit 0 — never disrupt Claude Code
  }

  try {
    const outcome = await witnessClaudeCodePostToolUse(payload, opts);
    if (outcome.recorded) {
      process.stderr.write(
        `witseal: witnessed Bash tool use — event=${outcome.result.eventId} ` +
          `receipt=${outcome.result.receiptId} outcome=${outcome.result.outcome}\n`
      );
    } else {
      process.stderr.write(`witseal: not witnessed (${outcome.reason})\n`);
    }
  } catch (e) {
    process.stderr.write(
      `witseal-witness-claude-code: record failed: ${e instanceof Error ? e.message : String(e)}\n`
    );
  }
}

void main();
