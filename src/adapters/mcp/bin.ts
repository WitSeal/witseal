#!/usr/bin/env node
/**
 * `witseal-mcp` — start the WitSeal MCP server on the stdio transport.
 *
 * An MCP client (e.g. Claude Desktop, Claude Code, Cursor) launches this as a
 * subprocess and speaks newline-delimited JSON-RPC over stdin/stdout. The
 * server exposes one tool, `shell`, which own-executes the command through the
 * witseal pipeline and records a full execution receipt.
 *
 * Configuration is environment-only (MCP clients set env in their server
 * config), so the binary takes no flags:
 *   WITSEAL_DATA_DIR   data directory            (default: ~/.witseal)
 *   WITSEAL_SEGMENT    chain segment id          (default: default)
 *   WITSEAL_MODE       gate | witness            (default: gate)
 *   WITSEAL_AGENT_ID   recorded agent identifier (default: mcp-client)
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { startMcpServer } from './server.js';
import type { McpMediateOptions } from './mediate.js';

const dataDir = process.env['WITSEAL_DATA_DIR'] ?? join(homedir(), '.witseal');
const segmentId = process.env['WITSEAL_SEGMENT'] ?? 'default';
const agentId = process.env['WITSEAL_AGENT_ID'] ?? 'mcp-client';
const mode: McpMediateOptions['mode'] =
  process.env['WITSEAL_MODE'] === 'witness' ? 'witness' : 'gate';

startMcpServer({ serverOptions: { dataDir, segmentId, agentId, mode } });
