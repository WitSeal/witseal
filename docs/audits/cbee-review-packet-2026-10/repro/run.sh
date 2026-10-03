#!/usr/bin/env bash
# Reproduces the evidence behind the main wording corrections of the
# CBEE self-audit (docs/audits/CBEE-SELF-AUDIT-2026-10.md).
#
# Requires a WitSeal CLI. By default it uses `witseal` from PATH
# (npm install -g @witseal/cli@0.4.2); set WITSEAL="node <path>/dist/src/cli/index.js"
# to use a local build. Everything runs in a fresh temporary directory; no
# command here touches files outside it. Nothing is sent over the network.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
W="${WITSEAL:-witseal}"
WORK="$(mktemp -d)"
cd "$WORK"
export WITSEAL_DATA_DIR="$WORK/data"
say() { printf '\n=== %s\n' "$*"; }

cat > policy.json <<'JSON'
{
  "schema_version": "witseal.policy.v0.1",
  "pack_id": "quickstart",
  "version": "1.0.0",
  "description": "Quickstart: allow by default; deny rm -rf on absolute paths.",
  "rules": [
    {
      "id": "deny-rm-rf-absolute",
      "match": { "command_matches": "^rm\\s+(-[rRf]+\\s+)+(/|\\$HOME|~)" },
      "decision": "deny",
      "reason": "rm -rf on absolute paths is denied"
    }
  ],
  "default_decision": "allow"
}
JSON
$W policy add ./policy.json >/dev/null

say "A1. allowed command (Gate Mode)"
$W exec -- echo hello; echo "exit=$?"
say "A2. denied command (Gate Mode) - it does not run"
# The quickstart rule denies rm -rf on any absolute path; the target does not
# exist, so nothing would be removed even if the rule were missing.
$W exec -- rm -rf /nonexistent/witseal-demo-target; echo "exit=$?"
say "A3. allowed command whose executable does not exist"
$W exec -- /nonexistent/witseal-demo-binary; echo "exit=$?"

say "A4. every witness event, with its outcome (each has a receipt id)"
$W events list --limit 20

say "A5. receipts exist for a pending precursor and for a denial"
$W receipt show 0 | sed -n '1,8p'
$W receipt show 2 | sed -n '1,8p'

say "A6. the 'executed_with_error' event: spawn_error is set, nothing ran"
sed -n '5p' "$WITSEAL_DATA_DIR/events/default.jsonl" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const e=JSON.parse(s);console.log("outcome:",e.outcome,"| exit_code:",e.execution_result.exit_code,"| spawn_error:",e.execution_result.spawn_error)})'

say "B1. export; the CLI prints the head of the exported range"
$W evidence export --out ./pkg.json 2> export.log; cat export.log
HEAD_AT_EXPORT="$(sed -n 's/^ *head: *//p' export.log)"
$W verify ./pkg.json; echo "exit=$?"

say "B2. edit one field without re-hashing (the CLAIM_BOUNDARY QA edit)"
node -e "const fs=require('node:fs');const j=JSON.parse(fs.readFileSync('pkg.json','utf8'));j.events[1].agent_identifier='tampered';fs.writeFileSync('pkg-naive.json',JSON.stringify(j,null,2));"
$W verify ./pkg-naive.json; echo "exit=$? (expected 1)"

say "B3. the same edit, then re-hash every later event and receipt"
node "$HERE/rehash.mjs" package pkg.json pkg-rehashed.json agent:1:tampered
$W verify ./pkg-rehashed.json; echo "exit=$? (0 means the edit is NOT detected by verify alone)"

say "B4. drop the newest two events and re-hash"
node "$HERE/rehash.mjs" package pkg.json pkg-truncated.json drop-tail:2
$W verify ./pkg-truncated.json; echo "exit=$? (0 means the truncation is NOT detected by verify alone)"

say "B5. the anchor: compare chain_head_after_range with the head printed at export"
for f in pkg.json pkg-rehashed.json pkg-truncated.json; do
  h="$(node -e "console.log(require('./$f').chain_head_after_range)")"
  if [ "$h" = "$HEAD_AT_EXPORT" ]; then echo "$f: head matches export"; else echo "$f: head DIFFERS from export -> change detected"; fi
done

say "B6. export a sub-range that leaves out the denial (sequence 2)"
$W evidence export --start 3 --end 4 --out ./pkg-range.json 2>/dev/null
$W verify ./pkg-range.json; echo "exit=$? (0: a package does not show what it leaves out)"

say "C1. live chain: same edit, re-hashed in the data directory"
node "$HERE/rehash.mjs" live "$WITSEAL_DATA_DIR/events/default.jsonl" agent:1:tampered
$W verify; echo "exit=$? (0 means the rewrite is NOT detected by verify alone)"

say "done (work dir: $WORK)"
