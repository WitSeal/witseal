/**
 * Validate a policy pack JSON file against the canonical Zod schema.
 *
 * Usage:
 *   node --import tsx scripts/validate-pack.mjs <path-to-pack.json>
 *
 * Exit codes:
 *   0 — pack is valid
 *   1 — pack is invalid, missing, or unparseable
 *
 * Used by CI to ensure example/policy-packs/*.json stay schema-correct.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PolicyPackSchema } from '../schemas/policy.schema.ts';

const argPath = process.argv[2];

if (!argPath) {
  console.error('error: expected path to policy pack JSON as first argument');
  console.error('usage: node --import tsx scripts/validate-pack.mjs <path>');
  process.exit(1);
}

const absPath = resolve(argPath);

let raw;
try {
  raw = readFileSync(absPath, 'utf8');
} catch (err) {
  console.error(`error: cannot read file: ${absPath}`);
  console.error(err.message);
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(raw);
} catch (err) {
  console.error(`error: file is not valid JSON: ${absPath}`);
  console.error(err.message);
  process.exit(1);
}

const result = PolicyPackSchema.safeParse(parsed);

if (!result.success) {
  console.error(`error: policy pack does not match schema: ${absPath}`);
  for (const issue of result.error.issues) {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    console.error(`  ${path}: ${issue.message}`);
  }
  process.exit(1);
}

console.log(`ok: ${argPath} (${result.data.rules.length} rules)`);
process.exit(0);
