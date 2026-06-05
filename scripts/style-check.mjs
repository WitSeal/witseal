#!/usr/bin/env node
/**
 * Vocabulary discipline linter.
 *
 * Scans tracked Markdown files for terms in the STYLE.md "Avoid" column and
 * reports them. Not a hard block (false positives happen — e.g. quoting another
 * product), but a friction layer that catches drift.
 *
 * File set = `git ls-files` (tracked files only), so gitignored local content
 * (e.g. coordination/) is never scanned — matching the sanitary barrier.
 *
 * Usage:
 *   node scripts/style-check.mjs [--fix-suggestions] [paths...]
 *
 * Exit codes:
 *   0 — no avoided terms found, or only inside <!-- style-allow --> blocks
 *   1 — avoided terms found in unguarded text (warning, not error)
 *   2 — script failure
 */

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

// Avoided terms with their canonical replacements.
// Keep in sync with STYLE.md Section 2.
const AVOID = [
  { bad: /\bAI[ -]monitoring\b/gi, good: 'witnessed execution' },
  { bad: /\bAI[ -]observability\b/gi, good: 'witnessed execution / evidence chain' },
  { bad: /\bAI[ -]safety\b/gi, good: 'operational trust' },
  { bad: /\bAI[ -]governance\b/gi, good: 'Agentic Trust Infrastructure' },
  { bad: /\baudit\s+log\b/gi, good: 'evidence chain' },
  { bad: /\baudit\s+trail\b/gi, good: 'evidence chain' },
  { bad: /\bpermission\s+system\b/gi, good: 'authority boundary' },
  { bad: /\btelemetry\b/gi, good: 'execution evidence' },
  { bad: /\bwrapper\b/gi, good: 'trust runtime' },
  { bad: /\bAI[ -]security\s+platform\b/gi, good: 'Agentic Trust Infrastructure' },
];

// Specific files that legitimately contain avoided terms (STYLE.md defines them).
const IGNORE_FILES = new Set(['STYLE.md']);

const MD_EXT = /\.md$/;

const FILES_FROM_ARGS = process.argv.slice(2).filter((a) => !a.startsWith('--'));

// Tracked files only (respects .gitignore), via `git ls-files -z`.
function trackedFiles() {
  try {
    return execSync('git ls-files -z', { encoding: 'utf8' }).split('\0').filter(Boolean);
  } catch (e) {
    console.error(`x style-check: git ls-files failed: ${e.message}`);
    process.exit(2);
  }
}

function isAllowed(content, matchIndex) {
  // Look back for a recent <!-- style-allow --> marker (scoped to one paragraph).
  const before = content.slice(0, matchIndex);
  const lastOpen = before.lastIndexOf('<!-- style-allow -->');
  const lastClose = before.lastIndexOf('<!-- /style-allow -->');
  return lastOpen > lastClose;
}

function scanFile(path) {
  const findings = [];
  const filename = path.split('/').pop();
  if (IGNORE_FILES.has(filename)) return findings;
  if (!MD_EXT.test(path)) return findings;
  let content;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    return findings;
  }
  for (const { bad, good } of AVOID) {
    const re = new RegExp(bad.source, bad.flags);
    let m;
    while ((m = re.exec(content)) !== null) {
      if (isAllowed(content, m.index)) continue;
      const line = content.slice(0, m.index).split('\n').length;
      findings.push({ path, line, match: m[0], suggestion: good });
    }
  }
  return findings;
}

function main() {
  const targets = FILES_FROM_ARGS.length > 0 ? FILES_FROM_ARGS : trackedFiles();
  const allFindings = [];
  for (const path of targets) {
    if (!MD_EXT.test(path)) continue;
    allFindings.push(...scanFile(path));
  }

  if (allFindings.length === 0) {
    console.log('✓ No avoided terms found in tracked Markdown.');
    process.exit(0);
  }

  console.warn(`✗ Found ${allFindings.length} avoided term(s):`);
  for (const f of allFindings) {
    console.warn(`  ${f.path}:${f.line}  "${f.match}"  →  use: "${f.suggestion}"`);
  }
  console.warn('');
  console.warn('See STYLE.md for the canonical vocabulary.');
  console.warn('To suppress (e.g., when quoting a competitor):');
  console.warn('  <!-- style-allow -->');
  console.warn('  ...text containing the avoided term...');
  console.warn('  <!-- /style-allow -->');
  process.exit(1);
}

main();
