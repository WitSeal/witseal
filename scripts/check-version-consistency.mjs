#!/usr/bin/env node
/**
 * Release version-consistency gate (fail-closed).
 *
 * WitSeal dogfoods its own discipline: a release declares a version, and this
 * check verifies — fact, not assumption — that every user-facing version anchor
 * agrees with package.json. If an anchor drifts, the release does not proceed.
 * This is the deny-by-default posture applied to publishing: consistent ->
 * release may proceed; drift -> release is blocked.
 *
 * Source of truth: package.json "version".
 *
 * Anchors checked (each must equal package.json version):
 *   1. CHANGELOG.md          - first released "## [x.y.z]" heading (skips [Unreleased]).
 *   2. README.md             - "npm install -g @witseal/cli@x.y.z" install pin
 *                              (and the "Install the `x.y.z` CLI" prose, if present).
 *   3. docs/CLAIM_BOUNDARY.md - "Verified against: `@witseal/cli@x.y.z`" anchor.
 *   4. Sweep                 - every "npm install -g @witseal/cli@x.y.z" pin in
 *                              tracked *.md files (templated pins containing
 *                              "${{ }}" are skipped, e.g. workflow tag interpolation).
 *
 * Usage:  node scripts/check-version-consistency.mjs
 * Exit:   0 - all anchors consistent
 *         1 - drift found (fail-closed; release must not proceed)
 *         2 - script error (missing/unreadable file, or no anchor where one is required)
 */

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const SEMVER = String.raw`\d+\.\d+\.\d+`;

function fail2(msg) {
  console.error(`x version-consistency: ${msg}`);
  process.exit(2);
}

function read(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (e) {
    return fail2(`cannot read ${path}: ${e.message}`);
  }
}

function firstMatch(text, re) {
  const m = text.match(re);
  return m ? m[1] : null;
}

const pkg = JSON.parse(read('package.json'));
const expected = pkg.version;
if (!new RegExp(`^${SEMVER}$`).test(expected)) {
  fail2(`package.json version "${expected}" is not x.y.z`);
}

const passed = [];
const problems = [];

function check(name, found, where, { required = true } = {}) {
  if (found === null || found === undefined) {
    if (required) problems.push(`${name}: no version anchor found in ${where}`);
    return;
  }
  if (found === expected) passed.push(`${name} = ${found}  (${where})`);
  else problems.push(`${name}: found ${found}, expected ${expected}  (${where})`);
}

// 1. CHANGELOG latest released heading (the first [x.y.z]; [Unreleased] is skipped).
check(
  'CHANGELOG latest released',
  firstMatch(read('CHANGELOG.md'), new RegExp(String.raw`^##\s*\[(${SEMVER})\]`, 'm')),
  'CHANGELOG.md',
);

// 2. README install pin + (optional) prose.
const readme = read('README.md');
check(
  'README install pin',
  firstMatch(readme, new RegExp(String.raw`npm install -g @witseal/cli@(${SEMVER})`)),
  'README.md',
);
check(
  'README install prose',
  firstMatch(readme, new RegExp(String.raw`Install the \`(${SEMVER})\` CLI`)),
  'README.md',
  { required: false },
);

// 3. CLAIM_BOUNDARY "Verified against" anchor (parsed from that line only).
check(
  'CLAIM_BOUNDARY Verified-against',
  firstMatch(
    read('docs/CLAIM_BOUNDARY.md'),
    new RegExp(String.raw`^Verified against:\s*\`@witseal/cli@(${SEMVER})\``, 'm'),
  ),
  'docs/CLAIM_BOUNDARY.md',
);

// 4. Sweep every tracked *.md install pin (skip templated workflow-style pins).
let mdFiles = [];
try {
  mdFiles = execSync('git ls-files "*.md"', { encoding: 'utf8' }).split('\n').filter(Boolean);
} catch (e) {
  fail2(`git ls-files failed: ${e.message}`);
}
for (const f of mdFiles) {
  for (const line of read(f).split('\n')) {
    if (line.includes('${{')) continue; // templated pin (e.g. release.yml tag interpolation)
    const re = new RegExp(String.raw`npm install -g @witseal/cli@(${SEMVER})`, 'g');
    let m;
    while ((m = re.exec(line)) !== null) {
      if (m[1] === expected) passed.push(`install pin = ${m[1]}  (${f})`);
      else problems.push(`install pin: found ${m[1]}, expected ${expected}  (${f})`);
    }
  }
}

// Report.
console.log(`version-consistency: package.json declares ${expected}`);
for (const p of passed) console.log(`  + ${p}`);

if (problems.length > 0) {
  console.error(`\nx ${problems.length} version-drift problem(s) - release blocked (fail-closed):`);
  for (const p of problems) console.error(`  x ${p}`);
  console.error(
    `\nFix: align every anchor above to package.json version ${expected} (or bump package.json),`,
  );
  console.error('then re-run. Historical references (changelog entries, RFCs) are not pins.');
  process.exit(1);
}

console.log(`\n+ all version anchors agree on ${expected}`);
process.exit(0);
