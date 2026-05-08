/**
 * Evidence package export.
 *
 * Bundles a contiguous range of witness events, their receipts, and the
 * policy packs in effect into an exportable, independently-verifiable
 * artifact.
 */

import { generateReceipt } from '../receipts/generate.js';
import type { EventLog } from '../witness/event-log.js';
import type { EvidencePackage } from '../../schemas/evidence-package.schema.js';
import type { PolicyPack } from '../../schemas/policy.schema.js';
import type { WitnessEvent } from '../../schemas/witness-event.schema.js';
import { generateId } from '../cli/id.js';
import { WITSEAL_RUNTIME_VERSION } from '../witness/emit.js';

export interface ExportRange {
  startSequence?: number;
  endSequence?: number;
}

export async function exportEvidencePackage(
  eventLog: EventLog,
  policyPacks: PolicyPack[],
  classifierVersion: string,
  range: ExportRange = {}
): Promise<EvidencePackage> {
  const allEvents = await eventLog.readAllEvents();
  if (allEvents.length === 0) {
    throw new Error('Cannot export evidence: chain is empty');
  }

  const startSeq = range.startSequence ?? allEvents[0]!.sequence;
  const endSeq = range.endSequence ?? allEvents[allEvents.length - 1]!.sequence;

  const inRange = allEvents.filter(
    (ev) => ev.sequence >= startSeq && ev.sequence <= endSeq
  );

  if (inRange.length === 0) {
    throw new Error(`No events found in range [${startSeq}, ${endSeq}]`);
  }

  const headBefore = findHashBefore(allEvents, startSeq);
  const headAfter = inRange[inRange.length - 1]!.event_hash;

  const receipts = inRange.map((ev) => generateReceipt(ev));

  return {
    schema_version: 'witseal.evidence-package.v0.1',
    package_id: generateId('pkg', 22),
    exported_at: toIsoZ(new Date()),
    chain_segment_id: inRange[0]!.chain_segment_id,
    range: {
      start_sequence: startSeq,
      end_sequence: endSeq,
    },
    chain_head_before_range: headBefore,
    chain_head_after_range: headAfter,
    events: inRange,
    receipts,
    policy_packs: policyPacks,
    classifier_version: classifierVersion,
    witseal_runtime_version: WITSEAL_RUNTIME_VERSION,
  };
}

function findHashBefore(allEvents: WitnessEvent[], startSeq: number): string | null {
  if (startSeq === 0) return null;
  const prev = allEvents.find((ev) => ev.sequence === startSeq - 1);
  return prev ? prev.event_hash : null;
}

function toIsoZ(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
