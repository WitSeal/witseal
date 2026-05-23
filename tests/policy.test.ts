import { describe, expect, it, beforeEach } from 'vitest';
import { PolicyEngine } from '../src/policy/engine.js';
import type { ClassifiedIntent } from '../schemas/intent.schema.js';

function makeIntent(overrides: Partial<ClassifiedIntent['intent']> & { action_type: 'shell_command' }): ClassifiedIntent {
  return {
    schema_version: 'witseal.intent.v0.1',
    intent_id: 'int_test0000000000000001',
    intent: {
      action_type: 'shell_command',
      executable: 'echo',
      args: ['hello'],
      cwd: '/tmp',
      use_tty: false,
      ...overrides,
    },
    risk_class: 'C1',
    classification_reasons: [],
    classifier_version: 'test-1.0',
  };
}

describe('PolicyEngine', () => {
  let engine: PolicyEngine;

  beforeEach(() => {
    engine = new PolicyEngine();
  });

  it('returns allow when no packs are loaded (default_decision precedence)', () => {
    // No packs at all => no defaults to compare => default 'allow'
    const decision = engine.evaluate(makeIntent({ action_type: 'shell_command' }));
    expect(decision.outcome).toBe('allow');
    expect(decision.matched_rule).toBe(null);
  });

  it('matches a rule by action_type', () => {
    engine.loadPack({
      schema_version: 'witseal.policy.v0.1',
      pack_id: 'test-pack',
      version: '1.0.0',
      description: 'test',
      rules: [
        {
          id: 'block-shell',
          match: { action_type: 'shell_command' },
          decision: 'deny',
          reason: 'shell commands blocked',
        },
      ],
      default_decision: 'allow',
    });

    const decision = engine.evaluate(makeIntent({ action_type: 'shell_command' }));
    expect(decision.outcome).toBe('deny');
    expect(decision.matched_rule?.rule_id).toBe('block-shell');
    expect(decision.reason).toBe('shell commands blocked');
  });

  it('matches a rule by command_matches regex', () => {
    engine.loadPack({
      schema_version: 'witseal.policy.v0.1',
      pack_id: 'no-curl',
      version: '1.0.0',
      description: 'block curl',
      rules: [
        {
          id: 'block-curl',
          match: { command_matches: '^curl\\s' },
          decision: 'deny',
          reason: 'curl is blocked',
        },
      ],
      default_decision: 'allow',
    });

    const denied = engine.evaluate(
      makeIntent({ action_type: 'shell_command', executable: 'curl', args: ['https://example.com'] })
    );
    expect(denied.outcome).toBe('deny');

    const allowed = engine.evaluate(
      makeIntent({ action_type: 'shell_command', executable: 'echo', args: ['curl is fine'] })
    );
    // 'echo curl is fine' starts with 'echo', not 'curl'
    expect(allowed.outcome).toBe('allow');
  });

  it('matches a rule by risk_class_in', () => {
    engine.loadPack({
      schema_version: 'witseal.policy.v0.1',
      pack_id: 'high-risk-pack',
      version: '1.0.0',
      description: 'require approval for high risk',
      rules: [
        {
          id: 'high-risk-approval',
          match: { risk_class_in: ['C3', 'C4'] },
          decision: 'require-approval',
          reason: 'high-risk action needs approval',
        },
      ],
      default_decision: 'allow',
    });

    const intent: ClassifiedIntent = {
      ...makeIntent({ action_type: 'shell_command' }),
      risk_class: 'C4',
    };
    expect(engine.evaluate(intent).outcome).toBe('require-approval');

    intent.risk_class = 'C1';
    expect(engine.evaluate(intent).outcome).toBe('allow');
  });

  it('first matching rule wins (within a pack)', () => {
    engine.loadPack({
      schema_version: 'witseal.policy.v0.1',
      pack_id: 'order-test',
      version: '1.0.0',
      description: 'test rule order',
      rules: [
        {
          id: 'first',
          match: { action_type: 'shell_command' },
          decision: 'allow',
          reason: 'first rule',
        },
        {
          id: 'second',
          match: { action_type: 'shell_command' },
          decision: 'deny',
          reason: 'second rule (should not match)',
        },
      ],
      default_decision: 'allow',
    });

    const decision = engine.evaluate(makeIntent({ action_type: 'shell_command' }));
    expect(decision.matched_rule?.rule_id).toBe('first');
  });

  it('first pack rule wins across packs', () => {
    engine.loadPack({
      schema_version: 'witseal.policy.v0.1',
      pack_id: 'pack-a',
      version: '1.0.0',
      description: 'first pack',
      rules: [{ id: 'a-allow', match: { command_matches: 'echo' }, decision: 'allow', reason: 'pack-a' }],
      default_decision: 'allow',
    });
    engine.loadPack({
      schema_version: 'witseal.policy.v0.1',
      pack_id: 'pack-b',
      version: '1.0.0',
      description: 'second pack',
      rules: [{ id: 'b-deny', match: { command_matches: 'echo' }, decision: 'deny', reason: 'pack-b' }],
      default_decision: 'deny',
    });

    const decision = engine.evaluate(makeIntent({ action_type: 'shell_command' }));
    expect(decision.matched_rule?.pack_id).toBe('pack-a');
  });

  it('uses most-restrictive default across packs when nothing matches', () => {
    engine.loadPack({
      schema_version: 'witseal.policy.v0.1',
      pack_id: 'allow-default',
      version: '1.0.0',
      description: 'allows by default',
      rules: [],
      default_decision: 'allow',
    });
    engine.loadPack({
      schema_version: 'witseal.policy.v0.1',
      pack_id: 'deny-default',
      version: '1.0.0',
      description: 'denies by default',
      rules: [],
      default_decision: 'deny',
    });

    const decision = engine.evaluate(makeIntent({ action_type: 'shell_command' }));
    expect(decision.outcome).toBe('deny');
    expect(decision.matched_rule).toBe(null);
  });

  it('logical composition: not', () => {
    engine.loadPack({
      schema_version: 'witseal.policy.v0.1',
      pack_id: 'not-test',
      version: '1.0.0',
      description: 'allow only echo',
      rules: [
        {
          id: 'block-non-echo',
          match: { not: { command_matches: '^echo\\s' } },
          decision: 'deny',
          reason: 'non-echo blocked',
        },
      ],
      default_decision: 'allow',
    });

    expect(engine.evaluate(makeIntent({ action_type: 'shell_command', executable: 'echo' })).outcome).toBe('allow');
    expect(engine.evaluate(makeIntent({ action_type: 'shell_command', executable: 'cat' })).outcome).toBe('deny');
  });

  it('logical composition: all_of', () => {
    engine.loadPack({
      schema_version: 'witseal.policy.v0.1',
      pack_id: 'all-of-test',
      version: '1.0.0',
      description: 'block C4 shell commands only',
      rules: [
        {
          id: 'block-shell-c4',
          match: { all_of: [{ action_type: 'shell_command' }, { risk_class: 'C4' }] },
          decision: 'deny',
          reason: 'C4 shell blocked',
        },
      ],
      default_decision: 'allow',
    });

    const c4: ClassifiedIntent = { ...makeIntent({ action_type: 'shell_command' }), risk_class: 'C4' };
    expect(engine.evaluate(c4).outcome).toBe('deny');

    const c1: ClassifiedIntent = { ...makeIntent({ action_type: 'shell_command' }), risk_class: 'C1' };
    expect(engine.evaluate(c1).outcome).toBe('allow');
  });

  it('logical composition: any_of', () => {
    engine.loadPack({
      schema_version: 'witseal.policy.v0.1',
      pack_id: 'any-of-test',
      version: '1.0.0',
      description: 'deny if either curl or wget',
      rules: [
        {
          id: 'deny-curl-or-wget',
          match: {
            any_of: [
              { command_matches: '^curl\\s' },
              { command_matches: '^wget\\s' },
            ],
          },
          decision: 'deny',
          reason: 'curl/wget blocked',
        },
      ],
      default_decision: 'allow',
    });

    expect(
      engine.evaluate(makeIntent({ action_type: 'shell_command', executable: 'curl', args: ['https://x'] })).outcome,
    ).toBe('deny');
    expect(
      engine.evaluate(makeIntent({ action_type: 'shell_command', executable: 'wget', args: ['https://x'] })).outcome,
    ).toBe('deny');
    expect(
      engine.evaluate(makeIntent({ action_type: 'shell_command', executable: 'echo' })).outcome,
    ).toBe('allow');
  });

  it('matches a rule by executable_matches regex on shell intents', () => {
    engine.loadPack({
      schema_version: 'witseal.policy.v0.1',
      pack_id: 'exec-match-test',
      version: '1.0.0',
      description: 'block /usr/bin/sudo by executable path',
      rules: [
        {
          id: 'block-sudo',
          match: { executable_matches: '/sudo$' },
          decision: 'deny',
          reason: 'sudo is forbidden',
        },
      ],
      default_decision: 'allow',
    });

    expect(
      engine.evaluate(
        makeIntent({ action_type: 'shell_command', executable: '/usr/bin/sudo', args: ['ls'] }),
      ).outcome,
    ).toBe('deny');
    // executable differs — should not match
    expect(
      engine.evaluate(
        makeIntent({ action_type: 'shell_command', executable: '/bin/echo', args: ['hi'] }),
      ).outcome,
    ).toBe('allow');
  });

  it('executable_matches returns false for non-shell action_type', () => {
    engine.loadPack({
      schema_version: 'witseal.policy.v0.1',
      pack_id: 'exec-nonshell-test',
      version: '1.0.0',
      description: 'deny any executable_matches rule — should NOT match file actions',
      rules: [
        {
          id: 'deny-all-exec',
          match: { executable_matches: '.*' },
          decision: 'deny',
          reason: 'shell only rule',
        },
      ],
      default_decision: 'allow',
    });

    // file_write intent should not be matched by executable_matches; falls through to default 'allow'.
    const fileIntent: ClassifiedIntent = {
      schema_version: 'witseal.intent.v0.1',
      intent_id: 'int_test_filewrite_00001',
      intent: {
        action_type: 'file_write',
        path: '/tmp/x',
        content_hash: 'a'.repeat(64),
        content_size_bytes: 0,
        mode: 'create_only',
      },
      risk_class: 'C1',
      classification_reasons: [],
      classifier_version: 'test-1.0',
    };
    const decision = engine.evaluate(fileIntent);
    expect(decision.outcome).toBe('allow');
    expect(decision.matched_rule).toBe(null);
  });

  it('command_matches returns false for non-shell action_type', () => {
    engine.loadPack({
      schema_version: 'witseal.policy.v0.1',
      pack_id: 'cmd-nonshell-test',
      version: '1.0.0',
      description: 'deny any command_matches rule — should NOT match file actions',
      rules: [
        {
          id: 'deny-all-cmd',
          match: { command_matches: '.*' },
          decision: 'deny',
          reason: 'shell only rule',
        },
      ],
      default_decision: 'allow',
    });

    // file_write intent should not be matched by command_matches; falls through to default 'allow'.
    const fileIntent: ClassifiedIntent = {
      schema_version: 'witseal.intent.v0.1',
      intent_id: 'int_test_filewrite_00002',
      intent: {
        action_type: 'file_write',
        path: '/tmp/y',
        content_hash: 'b'.repeat(64),
        content_size_bytes: 0,
        mode: 'create_only',
      },
      risk_class: 'C1',
      classification_reasons: [],
      classifier_version: 'test-1.0',
    };
    const decision = engine.evaluate(fileIntent);
    expect(decision.outcome).toBe('allow');
    expect(decision.matched_rule).toBe(null);
  });

  it('matches a rule by path_matches on file_write intents', () => {
    engine.loadPack({
      schema_version: 'witseal.policy.v0.1',
      pack_id: 'path-write-test',
      version: '1.0.0',
      description: 'deny writes under /etc',
      rules: [
        {
          id: 'deny-etc-write',
          match: { path_matches: '^/etc/' },
          decision: 'deny',
          reason: '/etc is system territory',
        },
      ],
      default_decision: 'allow',
    });

    const writeEtc: ClassifiedIntent = {
      schema_version: 'witseal.intent.v0.1',
      intent_id: 'int_test_etc_write_00001',
      intent: {
        action_type: 'file_write',
        path: '/etc/passwd',
        content_hash: 'b'.repeat(64),
        content_size_bytes: 12,
        mode: 'overwrite',
      },
      risk_class: 'C3',
      classification_reasons: [],
      classifier_version: 'test-1.0',
    };
    expect(engine.evaluate(writeEtc).outcome).toBe('deny');

    const writeTmp: ClassifiedIntent = {
      schema_version: 'witseal.intent.v0.1',
      intent_id: 'int_test_tmp_write_00001',
      intent: {
        action_type: 'file_write',
        path: '/tmp/data',
        content_hash: 'c'.repeat(64),
        content_size_bytes: 4,
        mode: 'overwrite',
      },
      risk_class: 'C1',
      classification_reasons: [],
      classifier_version: 'test-1.0',
    };
    expect(engine.evaluate(writeTmp).outcome).toBe('allow');
  });

  it('matches a rule by path_matches on file_read intents', () => {
    engine.loadPack({
      schema_version: 'witseal.policy.v0.1',
      pack_id: 'path-read-test',
      version: '1.0.0',
      description: 'deny reads of credentials',
      rules: [
        {
          id: 'deny-credentials',
          match: { path_matches: '\\.aws/credentials$' },
          decision: 'deny',
          reason: 'credentials are confidential',
        },
      ],
      default_decision: 'allow',
    });

    const readCreds: ClassifiedIntent = {
      schema_version: 'witseal.intent.v0.1',
      intent_id: 'int_test_creds_read_00001',
      intent: { action_type: 'file_read', path: '/home/u/.aws/credentials' },
      risk_class: 'C3',
      classification_reasons: [],
      classifier_version: 'test-1.0',
    };
    expect(engine.evaluate(readCreds).outcome).toBe('deny');
  });

  it('path_matches returns false for non-file action_type', () => {
    engine.loadPack({
      schema_version: 'witseal.policy.v0.1',
      pack_id: 'path-nonfile-test',
      version: '1.0.0',
      description: 'deny any path_matches rule — should NOT match shell intents',
      rules: [
        {
          id: 'deny-anything-path',
          match: { path_matches: '.*' },
          decision: 'deny',
          reason: 'file rule only',
        },
      ],
      default_decision: 'allow',
    });

    const shellIntent = makeIntent({ action_type: 'shell_command', executable: 'echo', args: ['hi'] });
    const decision = engine.evaluate(shellIntent);
    expect(decision.outcome).toBe('allow');
    expect(decision.matched_rule).toBe(null);
  });

  it('records active_pack_hashes for replay', () => {
    engine.loadPack({
      schema_version: 'witseal.policy.v0.1',
      pack_id: 'hash-test',
      version: '1.0.0',
      description: 'check hashes recorded',
      rules: [{ id: 'r1', match: {}, decision: 'allow', reason: 'always allow' }],
      default_decision: 'allow',
    });

    const decision = engine.evaluate(makeIntent({ action_type: 'shell_command' }));
    expect(decision.active_pack_hashes).toHaveLength(1);
    expect(decision.active_pack_hashes[0]?.pack_id).toBe('hash-test');
    expect(decision.active_pack_hashes[0]?.content_hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
