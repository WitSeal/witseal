/**
 * `witseal events list` — list witness events.
 */

import { EventLog } from '../witness/event-log.js';
import type { WitnessEvent } from '../../schemas/witness-event.schema.js';

export interface EventsListOptions {
  limit: number;
  decision: string | undefined;
  dataDir: string;
  segmentId: string;
}

export async function runEventsList(opts: EventsListOptions): Promise<number> {
  const eventLog = new EventLog({ root: opts.dataDir, segmentId: opts.segmentId });
  const events = await eventLog.readAllEvents();

  let filtered = events;
  if (opts.decision) {
    filtered = filtered.filter((e) => e.policy_decision.outcome === opts.decision);
  }

  const slice = filtered.slice(-opts.limit);

  if (slice.length === 0) {
    process.stdout.write('witseal: no events match the filter\n');
    return 0;
  }

  process.stdout.write(formatHeader());
  for (const e of slice) {
    process.stdout.write(formatRow(e));
  }
  process.stdout.write(`\nshown: ${slice.length} / ${events.length} total\n`);
  return 0;
}

function formatHeader(): string {
  return `${'SEQ'.padStart(5)}  ${'EVENT_ID'.padEnd(28)}  ${'RISK'.padEnd(4)}  ${'DECISION'.padEnd(18)}  OUTCOME\n`;
}

function formatRow(e: WitnessEvent): string {
  return (
    `${String(e.sequence).padStart(5)}  ` +
    `${e.event_id.padEnd(28)}  ` +
    `${e.classified_intent.risk_class.padEnd(4)}  ` +
    `${e.policy_decision.outcome.padEnd(18)}  ` +
    `${e.outcome}\n`
  );
}
