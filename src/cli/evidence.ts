/**
 * `witseal evidence export` — export an evidence package.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { exportEvidencePackage } from '../evidence/package.js';
import { EventLog } from '../witness/event-log.js';
import { CLASSIFIER_VERSION } from '../risk/classifier.js';
import { PolicyPackSchema, type PolicyPack } from '../../schemas/policy.schema.js';

export interface EvidenceExportOptions {
  outPath?: string;
  startSequence?: number;
  endSequence?: number;
  dataDir: string;
  segmentId: string;
}

export async function runEvidenceExport(opts: EvidenceExportOptions): Promise<number> {
  const eventLog = new EventLog({ root: opts.dataDir, segmentId: opts.segmentId });
  const packs = loadActivePacks(opts.dataDir);

  let pkg;
  try {
    pkg = await exportEvidencePackage(eventLog, packs, CLASSIFIER_VERSION, {
      ...(opts.startSequence !== undefined ? { startSequence: opts.startSequence } : {}),
      ...(opts.endSequence !== undefined ? { endSequence: opts.endSequence } : {}),
    });
  } catch (err: unknown) {
    process.stderr.write(`witseal: evidence export failed: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  const json = JSON.stringify(pkg, null, 2);
  if (opts.outPath) {
    writeFileSync(opts.outPath, json + '\n', { encoding: 'utf8' });
    process.stderr.write(
      `witseal: exported ${pkg.events.length} events to ${opts.outPath}\n` +
        `         range:  ${pkg.range.start_sequence}..${pkg.range.end_sequence}\n` +
        `         head:   ${pkg.chain_head_after_range}\n`
    );
  } else {
    process.stdout.write(json + '\n');
  }
  return 0;
}

function loadActivePacks(dataDir: string): PolicyPack[] {
  const dir = join(dataDir, 'policy-packs');
  if (!existsSync(dir)) return [];
  const out: PolicyPack[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const pack = PolicyPackSchema.parse(JSON.parse(readFileSync(join(dir, file), 'utf8')));
      out.push(pack);
    } catch {
      // ignore invalid packs at export time
    }
  }
  return out;
}
