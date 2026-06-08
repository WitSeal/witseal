/**
 * `witseal connect` — one-command setup that wires an MCP client (Claude
 * Desktop, Claude Code, Cursor) to the WitSeal MCP server, so the client gains
 * a witnessed `shell` tool (classify -> policy -> mediate -> witness -> receipt).
 *
 * Design goals: idempotent (never clobbers other MCP servers), safe-by-default
 * (witness mode records without blocking), and zero-prompt (the agent or user
 * runs one command). The core functions are pure/injectable so they are unit
 * tested without touching the real home directory.
 */
import { homedir, platform } from 'node:os';
import { join, dirname } from 'node:path';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';

export type ConnectMode = 'gate' | 'witness';
export type ClientId = 'claude-desktop' | 'claude-code' | 'cursor';

export interface ConnectResult {
  client: ClientId;
  ok: boolean;
  detail: string;
}

export interface RunConnectOptions {
  client: string; // claude-desktop | claude-code | cursor | all
  mode: ConnectMode;
  dataDir?: string;
  print: boolean;
}

export function resolveDataDir(override?: string): string {
  return override ?? process.env['WITSEAL_DATA_DIR'] ?? join(homedir(), '.witseal');
}

export function claudeDesktopConfigPath(
  home: string = homedir(),
  plat: NodeJS.Platform = platform(),
): string {
  if (plat === 'darwin') {
    return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  if (plat === 'win32') {
    const appData = process.env['APPDATA'] ?? join(home, 'AppData', 'Roaming');
    return join(appData, 'Claude', 'claude_desktop_config.json');
  }
  const xdg = process.env['XDG_CONFIG_HOME'] ?? join(home, '.config');
  return join(xdg, 'Claude', 'claude_desktop_config.json');
}

export function cursorConfigPath(home: string = homedir()): string {
  return join(home, '.cursor', 'mcp.json');
}

export function witsealServerEntry(mode: ConnectMode): {
  command: string;
  env: Record<string, string>;
} {
  return { command: 'witseal-mcp', env: { WITSEAL_MODE: mode } };
}

/**
 * Idempotently add or replace the `witseal` MCP server in a client config
 * object, preserving any other `mcpServers` entries. Returns the merged config
 * and whether a `witseal` entry already existed.
 */
export function upsertWitsealServer(
  config: Record<string, unknown>,
  mode: ConnectMode,
): { config: Record<string, unknown>; existed: boolean } {
  const existing =
    config['mcpServers'] && typeof config['mcpServers'] === 'object'
      ? (config['mcpServers'] as Record<string, unknown>)
      : {};
  const servers: Record<string, unknown> = { ...existing };
  const existed = Object.prototype.hasOwnProperty.call(servers, 'witseal');
  servers['witseal'] = witsealServerEntry(mode);
  return { config: { ...config, mcpServers: servers }, existed };
}

/** A safe, editable starter policy pack: allow by default, deny clearly destructive shell. */
export const STARTER_POLICY = {
  schema_version: 'witseal.policy.v0.1',
  pack_id: 'starter',
  version: '1.0.0',
  description:
    'Starter pack: allow by default; deny clearly destructive shell commands. Edit or replace under <data-dir>/policy-packs/.',
  rules: [
    {
      id: 'deny-rm-rf-absolute',
      match: { command_matches: '^rm\\s+(-[rRf]+\\s+)+(/|\\$HOME|~)' },
      decision: 'deny',
      reason: 'rm -rf on absolute paths is denied',
    },
    {
      id: 'deny-disk-utilities',
      match: { command_matches: '\\b(dd|mkfs(\\.[a-z0-9]+)?|fdisk|parted|wipefs)\\s' },
      decision: 'deny',
      reason: 'Disk-level destructive utility is denied',
    },
    {
      id: 'deny-sudo',
      match: { command_matches: '^sudo\\s' },
      decision: 'deny',
      reason: 'Privilege escalation (sudo) is denied',
    },
    {
      id: 'deny-shutdown',
      match: { command_matches: '^(shutdown|reboot|halt|poweroff)\\b' },
      decision: 'deny',
      reason: 'System shutdown command is denied',
    },
  ],
  default_decision: 'allow',
} as const;

function readJsonSafe(path: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function writeJson(path: string, obj: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(obj, null, 2)}\n`);
}

/**
 * Create the data dir and a starter policy pack if no pack exists yet.
 * Returns the created pack path, or null if a pack was already present.
 */
export function ensureStarterPolicy(dataDir: string): string | null {
  const dir = join(dataDir, 'policy-packs');
  mkdirSync(dir, { recursive: true });
  const hasPack = readdirSync(dir).some((f) => f.endsWith('.json'));
  if (hasPack) return null;
  const packPath = join(dir, 'starter.json');
  writeFileSync(packPath, `${JSON.stringify(STARTER_POLICY, null, 2)}\n`);
  return packPath;
}

function connectFileClient(
  client: ClientId,
  configPath: string,
  mode: ConnectMode,
  print: boolean,
): ConnectResult {
  const { config, existed } = upsertWitsealServer(readJsonSafe(configPath), mode);
  if (print) {
    console.log(`# ${configPath}`);
    console.log(JSON.stringify(config, null, 2));
    return { client, ok: true, detail: `would write ${configPath}` };
  }
  writeJson(configPath, config);
  return { client, ok: true, detail: `${existed ? 'updated' : 'added'} -> ${configPath}` };
}

function connectClaudeCode(mode: ConnectMode, print: boolean): ConnectResult {
  const json = JSON.stringify(witsealServerEntry(mode));
  const manual = `claude mcp add-json witseal '${json}' -s user`;
  if (print) {
    console.log(`# claude-code: ${manual}`);
    return { client: 'claude-code', ok: true, detail: `would run: ${manual}` };
  }
  try {
    execFileSync('claude', ['mcp', 'add-json', 'witseal', json, '-s', 'user'], { stdio: 'pipe' });
    return { client: 'claude-code', ok: true, detail: 'registered via `claude mcp add-json`' };
  } catch {
    return { client: 'claude-code', ok: false, detail: `\`claude\` CLI not found — run: ${manual}` };
  }
}

export function targetsFor(client: string): ClientId[] {
  if (client === 'all') return ['claude-desktop', 'claude-code', 'cursor'];
  if (client === 'claude-desktop' || client === 'claude-code' || client === 'cursor') {
    return [client];
  }
  return [];
}

export async function runConnect(opts: RunConnectOptions): Promise<number> {
  const mode: ConnectMode = opts.mode === 'gate' ? 'gate' : 'witness';
  const dataDir = resolveDataDir(opts.dataDir);
  const targets = targetsFor(opts.client);
  if (targets.length === 0) {
    console.error(`Unknown client "${opts.client}". Use: claude-desktop | claude-code | cursor | all`);
    return 2;
  }

  if (!opts.print) {
    const created = ensureStarterPolicy(dataDir);
    console.log(
      created
        ? `WitSeal data dir: ${dataDir}  (starter policy created: ${created})`
        : `WitSeal data dir: ${dataDir}`,
    );
    console.log('');
  }

  const results: ConnectResult[] = [];
  for (const c of targets) {
    if (c === 'claude-desktop') {
      results.push(connectFileClient('claude-desktop', claudeDesktopConfigPath(), mode, opts.print));
    } else if (c === 'cursor') {
      results.push(connectFileClient('cursor', cursorConfigPath(), mode, opts.print));
    } else {
      results.push(connectClaudeCode(mode, opts.print));
    }
  }

  if (!opts.print) {
    for (const r of results) console.log(`${r.ok ? '✓' : '!'} ${r.client}: ${r.detail}`);
    console.log('');
    console.log(
      `Mode: ${mode}${
        mode === 'witness'
          ? ' (records, does not block — re-run with --mode gate to enforce)'
          : ' (deny-by-default; uses the policy packs under your data dir)'
      }`,
    );
    console.log('Next: restart the client, ask it to run a shell command through WitSeal, then:');
    console.log('  witseal receipt show');
    console.log('  witseal verify');
  }

  return results.every((r) => r.ok) ? 0 : 1;
}
