// Re-derives every hash in a WitSeal v0.1 evidence package or live event log
// after an edit, using only the public hashing rule (JCS + SHA-256).
// Usage:
//   node rehash.mjs package <in.json> <out.json> <edit>
//   node rehash.mjs live <events.jsonl> <edit>
// <edit> = "agent:<index>:<value>" | "drop-tail:<n>"
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// RFC 8785 subset sufficient for WitSeal v0.1 objects (same rule as ADR-0001).
function canon(v) {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
}
const sha = (v) => createHash('sha256').update(canon(v), 'utf8').digest('hex');

function applyEdit(events, edit) {
  const [kind, a, b] = edit.split(':');
  if (kind === 'agent') events[Number(a)].agent_identifier = b;
  else if (kind === 'drop-tail') events.splice(events.length - Number(a));
  else throw new Error('unknown edit ' + edit);
}

function rechain(events, headBefore) {
  let prev = headBefore;
  for (const ev of events) {
    ev.previous_event_hash = prev;
    const { event_hash, ...draft } = ev;
    ev.event_hash = sha(draft);
    prev = ev.event_hash;
  }
  return prev;
}

const [mode, inPath, a3, a4] = process.argv.slice(2);
if (mode === 'package') {
  const pkg = JSON.parse(readFileSync(inPath, 'utf8'));
  applyEdit(pkg.events, a4);
  pkg.chain_head_after_range = rechain(pkg.events, pkg.chain_head_before_range);
  const keep = new Set(pkg.events.map((e) => e.event_id));
  pkg.receipts = pkg.receipts.filter((r) => keep.has(r.witness_event_id));
  for (const r of pkg.receipts) {            // v0.1 receipts are unsigned
    const { receipt_hash, ...draft } = r;
    r.receipt_hash = sha(draft);
  }
  writeFileSync(a3, JSON.stringify(pkg, null, 2));
} else if (mode === 'live') {
  const events = readFileSync(inPath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  applyEdit(events, a3);
  rechain(events, null);
  writeFileSync(inPath, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
} else {
  throw new Error('mode must be package|live');
}
