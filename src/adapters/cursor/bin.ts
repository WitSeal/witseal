#!/usr/bin/env node
/**
 * `witseal-witness-cursor` — Cursor postToolUse hook entry.
 *
 * Configured as a Cursor `postToolUse` hook command (in `.cursor/hooks.json`).
 * Cursor pipes the hook payload as JSON on stdin; this reads it, records a
 * Level-2 witness event for `Shell` tool calls, and always exits 0 so the hook
 * never disrupts Cursor. Diagnostics go to stderr.
 *
 * Configuration is environment-only:
 *   WITSEAL_DATA_DIR   data directory            (default: ~/.witseal)
 *   WITSEAL_SEGMENT    chain segment id          (default: default)
 *   WITSEAL_AGENT_ID   recorded agent identifier (default: cursor)
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  witnessCursorPostToolUse,
  type CursorWitnessOptions,
  type CursorPostToolUsePayload,
} from './witness.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  const opts: CursorWitnessOptions = {
    dataDir: process.env['WITSEAL_DATA_DIR'] ?? join(homedir(), '.witseal'),
    segmentId: process.env['WITSEAL_SEGMENT'] ?? 'default',
    agentId: process.env['WITSEAL_AGENT_ID'] ?? 'cursor',
  };

  let payload: CursorPostToolUsePayload;
  try {
    const raw = await readStdin();
    payload = JSON.parse(raw) as CursorPostToolUsePayload;
  } catch (e) {
    process.stderr.write(
      `witseal-witness-cursor: could not read/parse hook payload: ${e instanceof Error ? e.message : String(e)}\n`
    );
    return; // exit 0 — never disrupt Cursor
  }

  try {
    const outcome = await witnessCursorPostToolUse(payload, opts);
    if (outcome.recorded) {
      process.stderr.write(
        `witseal: witnessed Shell tool use — event=${outcome.result.eventId} ` +
          `receipt=${outcome.result.receiptId} outcome=${outcome.result.outcome}\n`
      );
    } else {
      process.stderr.write(`witseal: not witnessed (${outcome.reason})\n`);
    }
  } catch (e) {
    process.stderr.write(
      `witseal-witness-cursor: record failed: ${e instanceof Error ? e.message : String(e)}\n`
    );
  }
}

void main();
