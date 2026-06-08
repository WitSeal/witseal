/**
 * `witseal connect` — the one-command MCP-client setup.
 *
 * The command's side-effecting shell (writing real config files, spawning the
 * `claude` CLI) is kept thin; the logic under test is the pure core:
 *   - idempotent, non-clobbering merge of the `witseal` MCP server entry,
 *   - per-platform client config paths,
 *   - the starter policy scaffold (create-once).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  upsertWitsealServer,
  witsealServerEntry,
  claudeDesktopConfigPath,
  cursorConfigPath,
  ensureStarterPolicy,
  targetsFor,
} from '../src/cli/connect.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const servers = (c: Record<string, unknown>): any => c['mcpServers'];

describe('witseal connect — config merge', () => {
  it('adds the witseal MCP server to an empty config', () => {
    const { config, existed } = upsertWitsealServer({}, 'witness');
    expect(existed).toBe(false);
    expect(servers(config).witseal).toEqual(witsealServerEntry('witness'));
  });

  it('preserves other MCP servers and top-level keys (non-clobbering)', () => {
    const before = { mcpServers: { other: { command: 'x' } }, theme: 'dark' };
    const { config, existed } = upsertWitsealServer(before, 'gate');
    expect(existed).toBe(false);
    expect(servers(config).other).toEqual({ command: 'x' });
    expect(servers(config).witseal.env.WITSEAL_MODE).toBe('gate');
    expect(config['theme']).toBe('dark');
  });

  it('is idempotent: re-run reports existed=true and updates the mode', () => {
    const once = upsertWitsealServer({}, 'witness').config;
    const { existed, config } = upsertWitsealServer(once, 'gate');
    expect(existed).toBe(true);
    expect(servers(config).witseal.env.WITSEAL_MODE).toBe('gate');
    expect(Object.keys(servers(config))).toEqual(['witseal']);
  });
});

describe('witseal connect — client config paths', () => {
  it('resolves Claude Desktop config on macOS', () => {
    expect(claudeDesktopConfigPath('/Users/u', 'darwin')).toBe(
      '/Users/u/Library/Application Support/Claude/claude_desktop_config.json',
    );
  });
  it('resolves Claude Desktop config on Linux', () => {
    expect(claudeDesktopConfigPath('/home/u', 'linux')).toContain(
      '/Claude/claude_desktop_config.json',
    );
  });
  it('resolves Cursor config', () => {
    expect(cursorConfigPath('/Users/u')).toBe('/Users/u/.cursor/mcp.json');
  });
});

describe('witseal connect — targets', () => {
  it('expands "all" to every supported client', () => {
    expect(targetsFor('all')).toEqual(['claude-desktop', 'claude-code', 'cursor']);
  });
  it('passes a single known client through', () => {
    expect(targetsFor('cursor')).toEqual(['cursor']);
  });
  it('returns [] for an unknown client', () => {
    expect(targetsFor('nope')).toEqual([]);
  });
});

describe('witseal connect — starter policy', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wsl-connect-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates a valid starter policy pack when none exists', () => {
    const p = ensureStarterPolicy(dir);
    expect(p).not.toBeNull();
    expect(existsSync(p as string)).toBe(true);
    const pack = JSON.parse(readFileSync(p as string, 'utf8')) as Record<string, unknown>;
    expect(pack['schema_version']).toBe('witseal.policy.v0.1');
    expect(pack['default_decision']).toBe('allow');
    expect(Array.isArray(pack['rules'])).toBe(true);
  });

  it('does not overwrite an existing policy pack', () => {
    const packs = join(dir, 'policy-packs');
    mkdirSync(packs, { recursive: true });
    writeFileSync(join(packs, 'mine.json'), '{"keep":true}');
    expect(ensureStarterPolicy(dir)).toBeNull();
    expect(readdirSync(packs)).toEqual(['mine.json']);
  });
});
