/**
 * Intent schema.
 *
 * An Intent is the agent's proposed action. It is untrusted input —
 * the agent's LLM may have been prompt-injected, jailbroken, or simply
 * wrong. WitSeal evaluates *what* is proposed, not *why*.
 *
 * The classified intent extends the raw intent with risk classification
 * results (see src/risk/classifier.ts).
 *
 * Schema version: witseal.intent.v0.1
 */

import { z } from 'zod';

/**
 * Risk classification levels.
 *
 *   C0 — informational (e.g., reading a file, listing a directory)
 *   C1 — low risk (e.g., creating a new file, fetching a public URL)
 *   C2 — moderate risk (e.g., modifying an existing file, running tests)
 *   C3 — high risk (e.g., network egress, package install, git push)
 *   C4 — critical risk (e.g., destructive shell, sudo, delete repository)
 */
export const RiskClassSchema = z.enum(['C0', 'C1', 'C2', 'C3', 'C4']);
export type RiskClass = z.infer<typeof RiskClassSchema>;

/**
 * Action type discriminator. Phase 1 supports shell_command and file_write.
 * Future types: tool_call (Phase 4), http_request (Phase 4+), git_op (Phase 3).
 */
export const ActionTypeSchema = z.enum([
  'shell_command',
  'file_write',
  'file_read',
]);

export type ActionType = z.infer<typeof ActionTypeSchema>;

/**
 * A shell command intent. Note: argv is explicit (no shell-string).
 * See ADR-0005.
 */
export const ShellCommandIntentSchema = z.object({
  action_type: z.literal('shell_command'),
  executable: z.string().min(1),
  args: z.array(z.string()),
  cwd: z.string().min(1),
  env_keys_passed: z.array(z.string()).optional(),
  /** Optional opt-in TTY mode. See ADR-0005. */
  use_tty: z.boolean().default(false),
});

export const FileWriteIntentSchema = z.object({
  action_type: z.literal('file_write'),
  path: z.string().min(1),
  /** Hash of the content to write — full content captured separately. */
  content_hash: z.string(),
  content_size_bytes: z.number().int().nonnegative(),
  mode: z.enum(['overwrite', 'append', 'create_only']),
});

export const FileReadIntentSchema = z.object({
  action_type: z.literal('file_read'),
  path: z.string().min(1),
});

/**
 * The Intent discriminated union.
 */
export const IntentSchema = z.discriminatedUnion('action_type', [
  ShellCommandIntentSchema,
  FileWriteIntentSchema,
  FileReadIntentSchema,
]);

export type Intent = z.infer<typeof IntentSchema>;

/**
 * A ClassifiedIntent is an Intent with risk classification attached.
 */
export const ClassifiedIntentSchema = z.object({
  schema_version: z.literal('witseal.intent.v0.1'),
  intent_id: z.string().regex(/^int_[0-9a-zA-Z]{20,}$/),
  intent: IntentSchema,
  risk_class: RiskClassSchema,
  /** Reasoning for the assigned risk class. Used in audits and policy decisions. */
  classification_reasons: z.array(z.string()).default([]),
  /** Version of the classifier ruleset that produced this classification. */
  classifier_version: z.string(),
});

export type ClassifiedIntent = z.infer<typeof ClassifiedIntentSchema>;
