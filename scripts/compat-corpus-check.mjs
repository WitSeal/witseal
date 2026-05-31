/**
 * §9 cross-track parity gate.
 *
 * Usage: node --import tsx scripts/compat-corpus-check.mjs <chains-dir>
 *
 * For each subdirectory found under <chains-dir>:
 *   1. Reads chain.jsonl (one WitnessEvent per line)
 *   2. Reads chain.expected.json (verdict + metadata)
 *   3. Runs verifyChain from src/integrity/hash-chain.ts
 *   4. Compares result against expected.valid
 *   5. Checks event_count matches the number of lines in chain.jsonl
 *   6. Fails loudly (non-zero exit) on any mismatch or missing file
 *
 * The chain_head_before_range for every corpus chain is null (genesis).
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { verifyChain } from '../src/integrity/hash-chain.js';

const chainsDir = process.argv[2];
if (!chainsDir) {
  console.error('ERROR: Usage: node --import tsx scripts/compat-corpus-check.mjs <chains-dir>');
  process.exit(1);
}

if (!existsSync(chainsDir)) {
  console.error(`ERROR: chains directory not found: ${chainsDir}`);
  process.exit(1);
}

const chainDirs = readdirSync(chainsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => join(chainsDir, d.name))
  .sort();

if (chainDirs.length === 0) {
  console.error(`ERROR: no chain subdirectories found under ${chainsDir}`);
  process.exit(1);
}

console.log(`Found ${chainDirs.length} chain(s) under ${chainsDir}\n`);

let failed = 0;

for (const dir of chainDirs) {
  const name = basename(dir);
  const chainJsonl = join(dir, 'chain.jsonl');
  const expectedJson = join(dir, 'chain.expected.json');

  process.stdout.write(`  ${name} ... `);

  // --- validate required files ---
  if (!existsSync(chainJsonl)) {
    console.log('FAIL');
    console.error(`    ERROR: missing chain.jsonl in ${dir}`);
    failed++;
    continue;
  }
  if (!existsSync(expectedJson)) {
    console.log('FAIL');
    console.error(`    ERROR: missing chain.expected.json in ${dir}`);
    failed++;
    continue;
  }

  // --- parse chain.jsonl ---
  let events;
  try {
    const lines = readFileSync(chainJsonl, 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0);
    events = lines.map((line, i) => {
      try {
        return JSON.parse(line);
      } catch (e) {
        throw new Error(`chain.jsonl line ${i + 1}: ${e.message}`);
      }
    });
  } catch (e) {
    console.log('FAIL');
    console.error(`    ERROR: could not read/parse chain.jsonl: ${e.message}`);
    failed++;
    continue;
  }

  // --- parse chain.expected.json ---
  let expected;
  try {
    expected = JSON.parse(readFileSync(expectedJson, 'utf8'));
  } catch (e) {
    console.log('FAIL');
    console.error(`    ERROR: could not parse chain.expected.json: ${e.message}`);
    failed++;
    continue;
  }

  // --- run verifyChain ---
  let result;
  try {
    result = verifyChain(events, null);
  } catch (e) {
    console.log('FAIL');
    console.error(`    ERROR: verifyChain threw: ${e.message}`);
    failed++;
    continue;
  }

  // --- verdict check ---
  if (result.valid !== expected.valid) {
    console.log('FAIL');
    console.error(
      `    VERDICT MISMATCH: expected valid=${expected.valid}, got valid=${result.valid}` +
        (result.reason ? ` (reason: ${result.reason})` : '')
    );
    failed++;
    continue;
  }

  // --- event_count check ---
  if (typeof expected.event_count === 'number' && events.length !== expected.event_count) {
    console.log('FAIL');
    console.error(
      `    EVENT_COUNT MISMATCH: expected ${expected.event_count} events, chain.jsonl has ${events.length}`
    );
    failed++;
    continue;
  }

  // --- chain-head check (only when valid=true and chain is non-empty) ---
  if (result.valid && result.chainHeadAfter !== undefined) {
    const lastEvent = events[events.length - 1];
    if (result.chainHeadAfter !== lastEvent.event_hash) {
      console.log('FAIL');
      console.error(
        `    CHAIN-HEAD MISMATCH: verifyChain chainHeadAfter=${result.chainHeadAfter}, last event_hash=${lastEvent.event_hash}`
      );
      failed++;
      continue;
    }
  }

  console.log('ok');
}

console.log('');

if (failed > 0) {
  console.error(`FAIL: ${failed} of ${chainDirs.length} chain(s) failed parity check.`);
  process.exit(1);
} else {
  console.log(`ok: all ${chainDirs.length} chain(s) passed parity check.`);
}
