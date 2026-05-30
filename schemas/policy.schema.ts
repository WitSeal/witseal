/**
 * Policy schema.
 *
 * A PolicyPack is a declarative JSON document that expresses what classes
 * of action are allowed, denied, or require approval. See ADR-0003.
 *
 * Schema version: witseal.policy.v0.1
 */

import { z } from 'zod';
import { ActionTypeSchema, RiskClassSchema } from './intent.schema.js';

/**
 * Match conditions for a rule. All conditions in a single match block must
 * match (logical AND). Use any_of for OR; not for negation.
 */
export interface RuleMatch {
  action_type?: 'shell_command' | 'file_write' | 'file_read' | undefined;
  risk_class?: 'C0' | 'C1' | 'C2' | 'C3' | 'C4' | undefined;
  risk_class_in?: Array<'C0' | 'C1' | 'C2' | 'C3' | 'C4'> | undefined;
  executable_matches?: string | undefined;
  command_matches?: string | undefined;
  path_matches?: string | undefined;
  all_of?: RuleMatch[] | undefined;
  any_of?: RuleMatch[] | undefined;
  not?: RuleMatch | undefined;
}

export const RuleMatchSchema: z.ZodType<RuleMatch> = z.lazy(() =>
  z.object({
    /** Match by action type. */
    action_type: ActionTypeSchema.optional(),
    /** Match by risk class. */
    risk_class: RiskClassSchema.optional(),
    risk_class_in: z.array(RiskClassSchema).optional(),
    /** Regex match on the shell command's executable. */
    executable_matches: z.string().optional(),
    /** Regex match on the joined argv (executable + args, space-separated). */
    command_matches: z.string().optional(),
    /** Regex match on filesystem path (for file_* action types). */
    path_matches: z.string().optional(),
    /** Logical composition. */
    all_of: z.array(RuleMatchSchema).optional(),
    any_of: z.array(RuleMatchSchema).optional(),
    not: RuleMatchSchema.optional(),
  })
);

/**
 * A single rule in a policy pack.
 */
export const PolicyRuleSchema = z.object({
  id: z.string().min(1),
  match: RuleMatchSchema,
  decision: z.enum(['allow', 'deny', 'require-approval']),
  reason: z.string().min(1),
  /** Optional positive/negative test cases. Used by `witseal policy lint`. */
  examples: z
    .object({
      should_match: z.array(z.unknown()).optional(),
      should_not_match: z.array(z.unknown()).optional(),
    })
    .optional(),
});

export type PolicyRule = z.infer<typeof PolicyRuleSchema>;

/**
 * A Policy Pack — the unit of distribution and configuration.
 */
export const PolicyPackSchema = z.object({
  schema_version: z.literal('witseal.policy.v0.1'),
  pack_id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'kebab-case identifier'),
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+(-[a-z0-9.-]+)?$/, 'must be semver'),
  description: z.string().min(1),
  rules: z.array(PolicyRuleSchema),
  default_decision: z.enum(['allow', 'deny', 'require-approval']).default('allow'),
});

export type PolicyPack = z.infer<typeof PolicyPackSchema>;

/**
 * The decision produced by evaluating a classified intent against the
 * loaded policy packs. Recorded in the witness event.
 */
export const PolicyDecisionSchema = z.object({
  schema_version: z.literal('witseal.policy.v0.1'),
  outcome: z.enum(['allow', 'deny', 'require-approval']),
  /** ID of the rule that matched, or null if default_decision applied. */
  matched_rule: z
    .object({
      pack_id: z.string(),
      pack_version: z.string(),
      rule_id: z.string(),
    })
    .nullable(),
  /** Human-readable reason from the rule (or default). */
  reason: z.string(),
  /** Hashes of the active policy pack contents at decision time. For replay. */
  active_pack_hashes: z.array(
    z.object({
      pack_id: z.string(),
      version: z.string(),
      content_hash: z.string().regex(/^[a-f0-9]{64}$/),
    })
  ),
});

export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;
