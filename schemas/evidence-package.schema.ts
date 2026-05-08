/**
 * Evidence Package schema.
 *
 * An EvidencePackage is the exportable bundle: events, receipts, chain root,
 * policies in effect, classifier version. It is independently verifiable —
 * a third party with the package alone can reconstruct and verify the
 * chain head.
 *
 * Schema version: witseal.evidence-package.v0.1
 */

import { z } from 'zod';
import { WitnessEventSchema } from './witness-event.schema.js';
import { ExecutionReceiptSchema } from './receipt.schema.js';
import { PolicyPackSchema } from './policy.schema.js';

export const EvidencePackageSchema = z.object({
  schema_version: z.literal('witseal.evidence-package.v0.1'),
  package_id: z.string().regex(/^pkg_[0-9a-zA-Z]{20,}$/),
  /** When this package was produced. */
  exported_at: z.string().datetime({ offset: false }),
  /** Chain segment included in the package. */
  chain_segment_id: z.string(),
  /** First and last event sequence numbers (inclusive). */
  range: z.object({
    start_sequence: z.number().int().nonnegative(),
    end_sequence: z.number().int().nonnegative(),
  }),
  /** The chain head before the first event in range (null if range starts at genesis). */
  chain_head_before_range: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  /** The chain head after the last event in range. */
  chain_head_after_range: z.string().regex(/^[a-f0-9]{64}$/),
  /** All witness events in range. */
  events: z.array(WitnessEventSchema),
  /** All receipts in range, paired by witness_event_id. */
  receipts: z.array(ExecutionReceiptSchema),
  /** Full content of all policy packs referenced by events in range. */
  policy_packs: z.array(PolicyPackSchema),
  /** Classifier version used for events in range. */
  classifier_version: z.string(),
  /** Runtime version that produced events in range. */
  witseal_runtime_version: z.string(),
});

export type EvidencePackage = z.infer<typeof EvidencePackageSchema>;
