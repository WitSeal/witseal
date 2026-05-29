/**
 * `witseal receipt show <id>` — display a single execution receipt.
 *
 * DR-0019 grammar: noun + verb (`receipt show`), mirroring `events list`
 * and `evidence export`. `show` answers "What happened?" — it renders the
 * receipt's fields for a human. It does NOT verify (VALID/INVALID is
 * `witseal verify`) and is NOT forensics (`inspect` is reserved, out of
 * 0.1.0).
 *
 * ─── Where a receipt comes from ──────────────────────────────────────────────
 *
 * Receipts pair 1:1 with witness events and are NOT stored as standalone
 * files. There are two surfaces a receipt is materialized from:
 *
 *   1. The witness event journal (the live, always-present source). A v0.1
 *      receipt is reconstructed deterministically from its companion event
 *      via `generateReceipt(event)` (the same regeneration `witseal replay`
 *      relies on). This is the default source.
 *
 *   2. An exported evidence package (`--from <package.json>`). A package may
 *      carry v0.1 OR v0.2 receipts (v0.2 receipts are signed and only exist
 *      inside an export — they require a signing key, so they are never
 *      reconstructable from the bare event journal). When `--from` is given,
 *      the receipt is read verbatim from the package and displayed per its
 *      own `schema_version`.
 *
 * ─── Locating a receipt by id ────────────────────────────────────────────────
 *
 * The `<id>` argument is matched, in order, against:
 *   1. `receipt_id`        (`rcpt_…`) — the receipt's own id
 *   2. `witness_event_id`  (`evt_…`)  — the paired event id
 *   3. sequence number     (journal source only — packages do not re-key by
 *                            sequence, but their events carry it)
 *   4. a unique prefix of `receipt_id` or `witness_event_id`
 *
 * ─── Schema-version dispatch ─────────────────────────────────────────────────
 *
 * Display dispatches on `schema_version`: v0.1 renders the 9-field receipt;
 * v0.2 renders the full 17-field receipt (adds prev_hash, signature, the
 * build-provenance block — git_commit / artifact_digest / attestation_digest
 * / artifact_type / build_id — plus any populated Path-D optionals).
 */

import { existsSync, readFileSync } from 'node:fs';
import { EventLog } from '../witness/event-log.js';
import { generateReceipt } from '../receipts/generate.js';
import { ExecutionReceiptV02Schema } from '../../schemas/receipt-v0.2.schema.js';
import { WitnessEventSchema } from '../../schemas/witness-event.schema.js';
import type { ExecutionReceipt } from '../../schemas/receipt.schema.js';
import type { ExecutionReceiptV02 } from '../../schemas/receipt-v0.2.schema.js';
import type { WitnessEvent } from '../../schemas/witness-event.schema.js';

/** Either receipt shape `receipt show` knows how to render. Discriminated by
 *  `schema_version`. */
type AnyReceipt = ExecutionReceipt | ExecutionReceiptV02;

export interface ReceiptShowOptions {
  /** The id to look up: a `rcpt_…` receipt id, an `evt_…` event id, a bare
   *  sequence number, or a unique prefix of either id. */
  identifier: string;
  dataDir: string;
  segmentId: string;
  /** Optional path to an exported evidence package JSON. When set, the receipt
   *  is read from the package (which may carry v0.2 receipts) instead of being
   *  reconstructed from the event journal. */
  fromPackage?: string;
  /** Emit the raw receipt JSON instead of the human-readable rendering. */
  json?: boolean;
}

export async function runReceiptShow(opts: ReceiptShowOptions): Promise<number> {
  let receipt: AnyReceipt | null;
  let event: WitnessEvent | undefined;

  if (opts.fromPackage !== undefined) {
    const found = loadReceiptFromPackage(opts.fromPackage, opts.identifier);
    if (typeof found === 'string') {
      process.stderr.write(found);
      return 1;
    }
    receipt = found.receipt;
    event = found.event;
  } else {
    const eventLog = new EventLog({ root: opts.dataDir, segmentId: opts.segmentId });
    const events = await eventLog.readAllEvents();
    event = findEvent(events, opts.identifier);
    if (!event) {
      process.stderr.write(
        `witseal: no receipt found matching '${opts.identifier}' in segment '${opts.segmentId}'\n`
      );
      return 1;
    }
    // Reconstruct the v0.1 receipt from its companion event (same regeneration
    // `witseal replay` uses). v0.2 receipts are only available via --from.
    receipt = generateReceipt(event);
  }

  if (opts.json === true) {
    process.stdout.write(JSON.stringify(receipt, null, 2) + '\n');
    return 0;
  }

  process.stdout.write(renderReceipt(receipt, event));
  return 0;
}

/**
 * Load a receipt from an exported evidence package by id, returning the
 * receipt together with its paired event (used for the human-readable action
 * summary). Returns an error string (ready to write to stderr) on any failure.
 */
function loadReceiptFromPackage(
  path: string,
  identifier: string
): { receipt: AnyReceipt; event: WitnessEvent | undefined } | string {
  if (!existsSync(path)) {
    return `witseal: evidence package not found: ${path}\n`;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err: unknown) {
    return `witseal: cannot parse evidence package ${path}: ${
      err instanceof Error ? err.message : String(err)
    }\n`;
  }

  // The package wire schema (`witseal.evidence-package.v0.1`) types `receipts`
  // as the v0.1 element schema. A v0.2-receipt package is structurally the
  // package minus that element constraint, so validate the package frame
  // loosely and re-validate each receipt by its own `schema_version` below.
  const obj = raw as { receipts?: unknown[]; events?: unknown[] };
  if (!obj || !Array.isArray(obj.receipts)) {
    return `witseal: ${path} is not a valid evidence package (no receipts array)\n`;
  }

  const receipt = findReceiptInList(obj.receipts, identifier);
  if (!receipt) {
    return `witseal: no receipt found matching '${identifier}' in ${path}\n`;
  }

  // Best-effort pairing to the in-package event for the action summary. Each
  // candidate event is validated against the canonical schema; a non-matching
  // or malformed events array is non-fatal (the receipt still renders without
  // the action block).
  let event: WitnessEvent | undefined;
  if (Array.isArray(obj.events)) {
    for (const candidate of obj.events) {
      const parsed = WitnessEventSchema.safeParse(candidate);
      if (parsed.success && parsed.data.event_id === receipt.witness_event_id) {
        event = parsed.data;
        break;
      }
    }
  }

  return { receipt, event };
}

/**
 * Find a receipt in a package's `receipts` array by id, validating the matched
 * element against the schema for its declared `schema_version`. Returns `null`
 * if no element matches or the matched element fails its schema.
 */
function findReceiptInList(receipts: unknown[], identifier: string): AnyReceipt | null {
  // Receipts in a package are keyed by id, not by sequence (sequence belongs to
  // the event journal). Match exact receipt_id / witness_event_id first, then a
  // unique prefix of either.
  const list = receipts as Array<Record<string, unknown>>;

  const exact = list.find(
    (r) => r['receipt_id'] === identifier || r['witness_event_id'] === identifier
  );
  if (exact) return parseReceiptByVersion(exact);

  if (identifier.length >= 4) {
    const prefixed = list.filter(
      (r) =>
        (typeof r['receipt_id'] === 'string' && r['receipt_id'].startsWith(identifier)) ||
        (typeof r['witness_event_id'] === 'string' &&
          r['witness_event_id'].startsWith(identifier))
    );
    if (prefixed.length === 1) return parseReceiptByVersion(prefixed[0]!);
  }

  return null;
}

/** Validate a raw receipt object against the schema for its `schema_version`. */
function parseReceiptByVersion(raw: Record<string, unknown>): AnyReceipt | null {
  if (raw['schema_version'] === 'witseal.receipt.v0.2') {
    const r = ExecutionReceiptV02Schema.safeParse(raw);
    return r.success ? r.data : null;
  }
  // Treat anything else (including v0.1) via the v0.1 schema. Import lazily to
  // avoid a hard dependency cycle is unnecessary here — use a structural cast
  // through the known v0.1 fields.
  const v01 = raw as ExecutionReceipt;
  if (v01.schema_version === 'witseal.receipt.v0.1') return v01;
  return null;
}

/**
 * Locate the witness event whose receipt the caller asked for. Match order
 * (mirrors `replay.ts`): exact sequence, exact receipt_id, exact event_id,
 * then a unique prefix of receipt_id or event_id.
 */
function findEvent(events: WitnessEvent[], id: string): WitnessEvent | undefined {
  const seqNum = asSequence(id);
  if (seqNum !== null) {
    const bySeq = events.find((e) => e.sequence === seqNum);
    if (bySeq) return bySeq;
  }
  const byReceiptId = events.find((e) => e.receipt_id === id);
  if (byReceiptId) return byReceiptId;
  const byEventId = events.find((e) => e.event_id === id);
  if (byEventId) return byEventId;
  if (id.length >= 4) {
    const prefixed = events.filter(
      (e) => e.receipt_id.startsWith(id) || e.event_id.startsWith(id)
    );
    if (prefixed.length === 1) return prefixed[0];
  }
  return undefined;
}

/** Parse `id` as a bare non-negative integer sequence, or return null. */
function asSequence(id: string): number | null {
  const n = parseInt(id, 10);
  if (Number.isFinite(n) && n >= 0 && String(n) === id.trim()) return n;
  return null;
}

// ───────────────────────────── Human rendering ──────────────────────────────

function renderReceipt(receipt: AnyReceipt, event: WitnessEvent | undefined): string {
  if (receipt.schema_version === 'witseal.receipt.v0.2') {
    return renderV02(receipt, event);
  }
  return renderV01(receipt, event);
}

/** Render the v0.1 (9-field) receipt. */
function renderV01(receipt: ExecutionReceipt, event: WitnessEvent | undefined): string {
  const lines: string[] = [];
  lines.push(`Receipt ${receipt.receipt_id}`);
  lines.push(`  schema:          ${receipt.schema_version}`);
  lines.push(`  witness event:   ${receipt.witness_event_id}`);
  lines.push(`  chain segment:   ${receipt.chain_segment_id}`);
  lines.push(`  finalized at:    ${receipt.finalized_at}`);
  lines.push(`  outcome:         ${receipt.outcome}`);
  lines.push('');
  lines.push('  Hashes:');
  lines.push(`    receipt_hash:          ${receipt.receipt_hash}`);
  lines.push(`    policy_decision_hash:  ${receipt.policy_decision_hash}`);
  lines.push(`    classified_intent_hash:${receipt.classified_intent_hash}`);
  lines.push(`    execution_result_hash: ${receipt.execution_result_hash ?? '(none — no execution)'}`);
  lines.push(renderActionBlock(event));
  return lines.join('\n') + '\n';
}

/** Render the v0.2 (17-field) receipt, including provenance + signature. */
function renderV02(receipt: ExecutionReceiptV02, event: WitnessEvent | undefined): string {
  const lines: string[] = [];
  lines.push(`Receipt ${receipt.receipt_id ?? '(none — execution_lost)'}`);
  lines.push(`  schema:          ${receipt.schema_version}`);
  lines.push(`  witness event:   ${receipt.witness_event_id}`);
  lines.push(`  chain segment:   ${receipt.chain_segment_id}`);
  lines.push(`  finalized at:    ${receipt.finalized_at}`);
  lines.push(`  outcome:         ${receipt.outcome}`);
  lines.push('');
  lines.push('  Hashes:');
  lines.push(`    receipt_hash:          ${receipt.receipt_hash}`);
  lines.push(`    prev_hash:             ${receipt.prev_hash ?? '(none — chain-segment genesis)'}`);
  lines.push(`    policy_decision_hash:  ${receipt.policy_decision_hash}`);
  lines.push(`    classified_intent_hash:${receipt.classified_intent_hash}`);
  lines.push(`    execution_result_hash: ${receipt.execution_result_hash ?? '(none — no execution)'}`);
  lines.push('');
  lines.push('  Build provenance:');
  lines.push(`    git_commit:        ${receipt.git_commit}`);
  lines.push(`    artifact_type:     ${receipt.artifact_type}`);
  lines.push(`    artifact_digest:   ${receipt.artifact_digest}`);
  lines.push(`    attestation_digest:${receipt.attestation_digest}`);
  lines.push(`    build_id:          ${receipt.build_id}`);
  lines.push('');
  lines.push('  Signature:');
  lines.push(`    ${receipt.signature}`);
  // Path-D optionals — only shown when present (serialize-skip discipline).
  const optionals: string[] = [];
  if (receipt.sigstore_signature !== undefined) {
    optionals.push(`    sigstore_signature: ${receipt.sigstore_signature}`);
  }
  if (receipt.classifier_version !== undefined) {
    optionals.push(`    classifier_version: ${receipt.classifier_version}`);
  }
  if (receipt.shadow_mode !== undefined) {
    optionals.push(`    shadow_mode:        ${receipt.shadow_mode}`);
  }
  if (optionals.length > 0) {
    lines.push('');
    lines.push('  Optional fields:');
    lines.push(...optionals);
  }
  lines.push(renderActionBlock(event));
  return lines.join('\n') + '\n';
}

/**
 * Render the "what happened" action block from the paired witness event, when
 * available. This is descriptive context (the receipt itself carries only
 * hashes of the intent / decision / result), not a verification step.
 */
function renderActionBlock(event: WitnessEvent | undefined): string {
  if (!event) {
    return '';
  }
  const lines: string[] = ['', '  Action:'];
  lines.push(`    intent:    ${describeIntent(event.classified_intent.intent)}`);
  lines.push(`    risk:      ${event.classified_intent.risk_class}`);
  lines.push(`    decision:  ${event.policy_decision.outcome}`);
  if (event.approval) {
    lines.push(`    approval:  ${event.approval.outcome} by ${event.approval.principal.identifier}`);
  }
  if (event.execution_result) {
    let exit = `    exit:      ${event.execution_result.exit_code}`;
    if (event.execution_result.signal) exit += ` (signal=${event.execution_result.signal})`;
    lines.push(exit);
  }
  return '\n' + lines.join('\n');
}

function describeIntent(intent: import('../../schemas/intent.schema.js').Intent): string {
  switch (intent.action_type) {
    case 'shell_command':
      return `shell: ${intent.executable} ${intent.args.join(' ')}`;
    case 'file_write':
      return `file_write: ${intent.path} (${intent.mode})`;
    case 'file_read':
      return `file_read: ${intent.path}`;
  }
}
