/**
 * `witseal verify` — verify the integrity of the chain.
 *
 * Walks the entire event log and verifies every hash linkage. Reports the
 * exact location of any tampering or corruption.
 */

import { EventLog } from '../witness/event-log.js';

export interface VerifyOptions {
  dataDir: string;
  segmentId: string;
}

export async function runVerify(opts: VerifyOptions): Promise<number> {
  const eventLog = new EventLog({ root: opts.dataDir, segmentId: opts.segmentId });
  const result = await eventLog.verifyAll();

  if (result.valid) {
    process.stdout.write(
      `witseal: chain verified ✓\n` +
        `         segment: ${opts.segmentId}\n` +
        `         events:  ${result.eventCount}\n`
    );
    return 0;
  }

  process.stderr.write(
    `witseal: chain verification FAILED ✗\n` +
      `         segment:   ${opts.segmentId}\n` +
      `         events:    ${result.eventCount}\n` +
      `         broken at: index ${result.brokenAt}\n` +
      `         reason:    ${result.reason}\n`
  );
  return 1;
}
