/**
 * Execution Result schema.
 *
 * The captured outcome of a mediated execution. See ADR-0005 for the
 * subprocess capture mechanism.
 *
 * Schema version: witseal.execution.v0.1
 */

import { z } from 'zod';

/**
 * Bounded output capture: head + tail of the stream, with a hash of the full
 * stream and the total byte count. See ADR-0005 for rationale.
 */
export const StreamCaptureSchema = z.object({
  /** Total bytes in the original stream. */
  total_bytes: z.number().int().nonnegative(),
  /** SHA-256 hash of the full stream (lowercase hex). */
  content_hash: z.string().regex(/^[a-f0-9]{64}$/),
  /** First N bytes, UTF-8 decoded with replacement. May be 'null' if total_bytes is 0. */
  head: z.string().nullable(),
  /** Last N bytes, UTF-8 decoded with replacement. null if total_bytes < head_size + tail_size. */
  tail: z.string().nullable(),
  /** Bytes captured in head; <= total_bytes. */
  head_bytes: z.number().int().nonnegative(),
  /** Bytes captured in tail; <= total_bytes - head_bytes. */
  tail_bytes: z.number().int().nonnegative(),
  /** True if any content was truncated. */
  truncated: z.boolean(),
});

export type StreamCapture = z.infer<typeof StreamCaptureSchema>;

export const ExecutionResultSchema = z.object({
  schema_version: z.literal('witseal.execution.v0.1'),
  /** ISO 8601 UTC timestamp; when execution started. */
  started_at: z.string().datetime({ offset: false }),
  /** ISO 8601 UTC timestamp; when execution completed (or was killed). */
  finished_at: z.string().datetime({ offset: false }),
  /** Process exit code. -1 if killed by signal; signal name in 'signal' field. */
  exit_code: z.number().int(),
  /** Signal name if process was killed by signal (e.g. 'SIGKILL'). null otherwise. */
  signal: z.string().nullable(),
  /** Captured stdout. */
  stdout: StreamCaptureSchema,
  /** Captured stderr. */
  stderr: StreamCaptureSchema,
  /** Resolved absolute path of the executable. */
  executable_resolved: z.string(),
  /** Hash of the env keys passed (sorted, joined). Values are NOT recorded. */
  env_keys_hash: z.string().regex(/^[a-f0-9]{64}$/),
  /** Whether execution failed before producing a meaningful exit (e.g., spawn error). */
  spawn_error: z.string().nullable(),
});

export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;
