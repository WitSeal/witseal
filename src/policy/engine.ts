/**
 * Policy engine.
 *
 * Loads policy packs and evaluates classified intents against them.
 * See ADR-0003 for the format rationale.
 *
 * Evaluation is deterministic and total: every input produces a defined
 * decision in O(rules) time. No I/O during evaluation; all packs loaded
 * upfront.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  PolicyPackSchema,
  PolicyDecisionSchema,
  type PolicyPack,
  type PolicyRule,
  type PolicyDecision,
  type RuleMatch,
} from '../../schemas/policy.schema.js';
import type { ClassifiedIntent } from '../../schemas/intent.schema.js';

interface CompiledRule extends Omit<PolicyRule, 'match'> {
  matchFn: (intent: ClassifiedIntent) => boolean;
}

interface CompiledPack {
  pack: PolicyPack;
  contentHash: string;
  rules: CompiledRule[];
}

export class PolicyEngine {
  private compiledPacks: CompiledPack[] = [];

  loadPack(packJson: string | object): void {
    const raw = typeof packJson === 'string' ? JSON.parse(packJson) : packJson;
    const pack = PolicyPackSchema.parse(raw);
    const contentHash = createHash('sha256')
      .update(JSON.stringify(pack))
      .digest('hex');

    const compiled: CompiledPack = {
      pack,
      contentHash,
      rules: pack.rules.map((rule) => ({
        ...rule,
        matchFn: compileMatch(rule.match),
      })),
    };

    this.compiledPacks.push(compiled);
  }

  loadPackFromFile(path: string): void {
    this.loadPack(readFileSync(path, 'utf8'));
  }

  evaluate(intent: ClassifiedIntent): PolicyDecision {
    const activePackHashes = this.compiledPacks.map((cp) => ({
      pack_id: cp.pack.pack_id,
      version: cp.pack.version,
      content_hash: cp.contentHash,
    }));

    // Evaluate packs in load order; first matching rule wins.
    for (const cp of this.compiledPacks) {
      for (const rule of cp.rules) {
        if (rule.matchFn(intent)) {
          return PolicyDecisionSchema.parse({
            schema_version: 'witseal.policy.v0.1',
            outcome: rule.decision,
            matched_rule: {
              pack_id: cp.pack.pack_id,
              pack_version: cp.pack.version,
              rule_id: rule.id,
            },
            reason: rule.reason,
            active_pack_hashes: activePackHashes,
          });
        }
      }
    }

    // No rule matched. Use the most-restrictive default across packs.
    // Precedence: deny > require-approval > allow.
    const defaults = this.compiledPacks.map((cp) => cp.pack.default_decision);
    const outcome = defaults.includes('deny')
      ? 'deny'
      : defaults.includes('require-approval')
        ? 'require-approval'
        : 'allow';

    return PolicyDecisionSchema.parse({
      schema_version: 'witseal.policy.v0.1',
      outcome,
      matched_rule: null,
      reason: `no matching rule; default_decision = ${outcome}`,
      active_pack_hashes: activePackHashes,
    });
  }
}

/**
 * Compile a RuleMatch into a predicate function.
 */
function compileMatch(match: RuleMatch): (intent: ClassifiedIntent) => boolean {
  // Logical composition first
  if ('not' in match && match.not !== undefined) {
    const inner = compileMatch(match.not);
    return (i) => !inner(i);
  }
  if ('all_of' in match && match.all_of !== undefined) {
    const inners = match.all_of.map(compileMatch);
    return (i) => inners.every((fn) => fn(i));
  }
  if ('any_of' in match && match.any_of !== undefined) {
    const inners = match.any_of.map(compileMatch);
    return (i) => inners.some((fn) => fn(i));
  }

  // Field matchers — compose all into AND
  const matchers: Array<(i: ClassifiedIntent) => boolean> = [];

  if (match.action_type) {
    const expected = match.action_type;
    matchers.push((i) => i.intent.action_type === expected);
  }

  if (match.risk_class) {
    const expected = match.risk_class;
    matchers.push((i) => i.risk_class === expected);
  }

  if (match.risk_class_in) {
    const set = new Set(match.risk_class_in);
    matchers.push((i) => set.has(i.risk_class));
  }

  if (match.executable_matches) {
    const re = new RegExp(match.executable_matches);
    matchers.push((i) => {
      if (i.intent.action_type !== 'shell_command') return false;
      return re.test(i.intent.executable);
    });
  }

  if (match.command_matches) {
    const re = new RegExp(match.command_matches);
    matchers.push((i) => {
      if (i.intent.action_type !== 'shell_command') return false;
      const fullCommand = `${i.intent.executable} ${i.intent.args.join(' ')}`;
      return re.test(fullCommand);
    });
  }

  if (match.path_matches) {
    const re = new RegExp(match.path_matches);
    matchers.push((i) => {
      if (i.intent.action_type !== 'file_write' && i.intent.action_type !== 'file_read') {
        return false;
      }
      return re.test(i.intent.path);
    });
  }

  // Empty match matches everything (the "default" rule pattern)
  if (matchers.length === 0) return () => true;

  return (i) => matchers.every((fn) => fn(i));
}
