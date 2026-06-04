#!/usr/bin/env node
/**
 * WitSeal MCP Witness — SPIKE (value probe, NOT a product, NOT an adapter).
 *
 * Minimal MCP stdio client to ONE downstream server (github-mcp) that performs
 * ONE safe, read-only tool call and emits a HASH-ONLY provenance record of the
 * MCP tool-call boundary. It is meant to be run *through* `witseal exec`, so
 * WitSeal witnesses this process as an ordinary shell execution and issues a
 * normal execution receipt — no new receipt canon, no schema change, golden
 * untouched. The MCP-specific metadata is emitted as an `experimental.mcp`
 * SIDECAR (explicitly NOT canon).
 *
 * Honesty ceiling: this witnesses the MCP tool-call BOUNDARY (server, tool,
 * input hash, output hash, isError — what passed through the client), NOT the
 * upstream server's internal execution (MCP cannot see into another server).
 *
 * Safety: never prints or stores the token or any payload — only SHA-256
 * hashes of the canonical input/output and the boolean status.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';

// Args: <tool> [--token-file <path>]. The token is read from a file (or env) so
// it never appears in the process argv / the witnessing receipt — only the
// (non-sensitive) file PATH does. WitSeal's mediator does not forward arbitrary
// env to mediated commands (secret hygiene), so a file is the clean channel.
const rawArgs = process.argv.slice(2);
let tokenFile = null;
const positional = [];
for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === '--token-file') tokenFile = rawArgs[++i];
  else positional.push(rawArgs[i]);
}
let TOKEN = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
if (!TOKEN && tokenFile) {
  try { TOKEN = readFileSync(tokenFile, 'utf8').trim(); } catch { /* fall through */ }
}
if (!TOKEN) {
  process.stderr.write('spike: token required (env GITHUB_PERSONAL_ACCESS_TOKEN or --token-file)\n');
  process.exit(2);
}

const SERVER_IMAGE = 'ghcr.io/github/github-mcp-server';
const PROTOCOL = '2025-06-18';
const TOOL = positional[0] || 'get_me'; // read-only, no params
const ARGS = {};

/** Deterministic canonical JSON (sorted keys, no whitespace) for hashing. */
function canon(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (typeof v === 'object')
    return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort()
      .map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

const child = spawn(
  'docker',
  ['run', '-i', '--rm', '-e', 'GITHUB_PERSONAL_ACCESS_TOKEN', SERVER_IMAGE, 'stdio'],
  { env: { ...process.env, GITHUB_PERSONAL_ACCESS_TOKEN: TOKEN }, stdio: ['pipe', 'pipe', 'inherit'] }
);

const rl = createInterface({ input: child.stdout });
const pending = new Map();
rl.on('line', (line) => {
  const t = line.trim();
  if (!t) return;
  let msg;
  try { msg = JSON.parse(t); } catch { return; }
  if (msg.id !== undefined && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
const send = (obj) => child.stdin.write(JSON.stringify(obj) + '\n');
const rpc = (id, method, params) =>
  new Promise((res) => { pending.set(id, res); send({ jsonrpc: '2.0', id, method, params }); });

const killTimer = setTimeout(() => {
  process.stderr.write('spike: timeout waiting for github-mcp\n');
  child.kill();
  process.exit(3);
}, 45000);

try {
  const init = await rpc(1, 'initialize', {
    protocolVersion: PROTOCOL,
    capabilities: {},
    clientInfo: { name: 'witseal-mcp-witness-spike', version: '0.0.0' },
  });
  const negotiated = init.result?.protocolVersion ?? '?';
  const serverInfo = init.result?.serverInfo ?? {};
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  const inputHash = sha256(canon({ name: TOOL, arguments: ARGS }));
  const call = await rpc(2, 'tools/call', { name: TOOL, arguments: ARGS });
  const result = call.result ?? call.error ?? null;
  const isError = call.error ? true : call.result?.isError === true;
  const outputHash = sha256(canon(result));

  clearTimeout(killTimer);
  child.stdin.end();
  child.kill();

  // experimental.mcp SIDECAR — hash-only, NOT canon. No payload, no token.
  const sidecar = {
    metadata: {
      experimental: {
        mcp: {
          note: 'experimental — NOT receipt canon. Witnesses the MCP tool-call boundary, not the server internal execution.',
          server_image: SERVER_IMAGE,
          server_name: serverInfo.name ?? null,
          transport: 'stdio',
          negotiated_protocol: negotiated,
          tool: TOOL,
          input_sha256: inputHash,
          output_sha256: outputHash,
          is_error: isError,
        },
      },
    },
  };
  // Captured by `witseal exec` into the execution receipt's stdout (non-sensitive).
  process.stdout.write('WITSEAL-MCP-WITNESS-SPIKE ' + JSON.stringify(sidecar) + '\n');
  process.exit(isError ? 1 : 0);
} catch (e) {
  clearTimeout(killTimer);
  process.stderr.write('spike: error ' + (e?.message ?? String(e)) + '\n');
  child.kill();
  process.exit(4);
}
