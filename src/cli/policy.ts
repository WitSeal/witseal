/**
 * `witseal policy add` and `witseal policy list`.
 *
 * Phase 1 v0.1: policy packs are stored as files in <data-dir>/policy-packs/.
 * `add` validates the file against the schema and copies it in. `list`
 * enumerates loaded packs.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { PolicyPackSchema } from '../../schemas/policy.schema.js';

export interface PolicyAddOptions {
  path: string;
  dataDir: string;
}

export async function runPolicyAdd(opts: PolicyAddOptions): Promise<number> {
  if (!existsSync(opts.path)) {
    process.stderr.write(`witseal: policy file not found: ${opts.path}\n`);
    return 1;
  }
  const content = readFileSync(opts.path, 'utf8');
  let pack;
  try {
    pack = PolicyPackSchema.parse(JSON.parse(content));
  } catch (err: unknown) {
    process.stderr.write(`witseal: invalid policy pack: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  const dir = join(opts.dataDir, 'policy-packs');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const dest = join(dir, `${pack.pack_id}.json`);
  copyFileSync(opts.path, dest);
  process.stdout.write(`witseal: added policy pack ${pack.pack_id}@${pack.version} (${pack.rules.length} rules)\n`);
  process.stdout.write(`         stored at: ${dest}\n`);
  return 0;
}

export interface PolicyListOptions {
  dataDir: string;
}

export async function runPolicyList(opts: PolicyListOptions): Promise<number> {
  const dir = join(opts.dataDir, 'policy-packs');
  if (!existsSync(dir)) {
    process.stdout.write('witseal: no policy packs loaded\n');
    return 0;
  }

  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  if (files.length === 0) {
    process.stdout.write('witseal: no policy packs loaded\n');
    return 0;
  }

  process.stdout.write(`Active policy packs:\n`);
  for (const file of files) {
    const path = join(dir, file);
    try {
      const pack = PolicyPackSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
      process.stdout.write(
        `  ${pack.pack_id}@${pack.version}  (${pack.rules.length} rules)  default=${pack.default_decision}\n` +
          `    ${pack.description}\n`
      );
    } catch {
      process.stdout.write(`  ${basename(file)}  (INVALID)\n`);
    }
  }
  return 0;
}
