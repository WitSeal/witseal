/**
 * Failure mode tests for the safety-critical components.
 *
 * Per a third-party security audit §2:
 *   "A governance system's correctness under failure is more important than
 *    its correctness on happy paths."
 *
 * This file covers failure modes that are testable at the pure-function /
 * module-API level:
 *
 *   - Classifier: defensive defaults, conservative escalation
 *   - Policy engine: malformed pack → throws (caller decides what to do),
 *                    missing file → throws ENOENT,
 *                    no packs loaded → default 'allow' (current behavior;
 *                    a runtime warning is required here)
 *
 * Pipeline-level failure modes (classifier throw → denial event, malformed
 * policy file → fail-closed denial, missing data dir → prominent warning)
 * are exec.ts-level concerns that require exec.ts hardening before they
 * can be tested end-to-end. Those gaps are tracked separately; see the
 * "EXEC PIPELINE GAPS (NOT YET TESTABLE)" comment block at the bottom.
 */

import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classify } from '../src/risk/classifier.js';
import { PolicyEngine } from '../src/policy/engine.js';
import type { ClassifiedIntent, Intent } from '../schemas/intent.schema.js';

// ---------------------------------------------------------------------------
// Classifier failure mode coverage
// ---------------------------------------------------------------------------

describe('classifier — conservative-escalation invariant', () => {
  function shellIntent(executable: string, args: string[] = []): Intent {
    return { action_type: 'shell_command', executable, args, cwd: '/tmp', use_tty: false };
  }

  // The classifier's design principle: false-positives (rare commands
  // classified too high) are acceptable; false-negatives (dangerous commands
  // classified too low) are NOT. These tests pin down the floor of that
  // promise for every category that appears in the rules.

  it('shell defaults to C1 (not C0) for unknown executables', () => {
    expect(classify(shellIntent('xyzunknown')).risk_class).toBe('C1');
    expect(classify(shellIntent('totally-fake-tool', ['--help'])).risk_class).toBe('C1');
    expect(classify(shellIntent('random123')).risk_class).toBe('C1');
  });

  it('classifies all known disk-destructive utilities as C4', () => {
    const c4 = ['dd', 'mkfs.ext4', 'fdisk', 'parted', 'wipefs'];
    for (const exec of c4) {
      expect(classify(shellIntent(exec, ['/dev/sda'])).risk_class).toBe('C4');
    }
  });

  it('classifies system shutdown family as C4', () => {
    expect(classify(shellIntent('shutdown', ['-h', 'now'])).risk_class).toBe('C4');
    expect(classify(shellIntent('reboot')).risk_class).toBe('C4');
    expect(classify(shellIntent('halt')).risk_class).toBe('C4');
  });

  it('classifies firewall manipulation as C4', () => {
    expect(classify(shellIntent('iptables', ['-F'])).risk_class).toBe('C4');
    expect(classify(shellIntent('nft', ['flush', 'ruleset'])).risk_class).toBe('C4');
  });

  it('classifies fork bomb pattern as C4', () => {
    expect(classify(shellIntent('bash', ['-c', ':(){ :|:& };:'])).risk_class).toBe('C4');
  });

  it('classifies privilege escalation as C4 regardless of inner command', () => {
    expect(classify(shellIntent('sudo', ['ls'])).risk_class).toBe('C4');
    expect(classify(shellIntent('sudo', ['echo', 'safe'])).risk_class).toBe('C4');
  });

  it('classifies network egress utilities as C3', () => {
    const c3 = ['curl', 'wget', 'nc', 'ncat', 'socat', 'httpie'];
    for (const exec of c3) {
      expect(classify(shellIntent(exec, ['https://example.com'])).risk_class).toBe('C3');
    }
  });

  it('classifies package-install commands as C3 (supply-chain risk)', () => {
    expect(classify(shellIntent('npm', ['install', 'lodash'])).risk_class).toBe('C3');
    expect(classify(shellIntent('pip', ['install', 'requests'])).risk_class).toBe('C3');
    expect(classify(shellIntent('gem', ['install', 'rails'])).risk_class).toBe('C3');
    expect(classify(shellIntent('cargo', ['install', 'something'])).risk_class).toBe('C3');
    expect(classify(shellIntent('go', ['install', 'mod@latest'])).risk_class).toBe('C3');
  });

  it('classifies remote shell as C3', () => {
    expect(classify(shellIntent('ssh', ['user@host'])).risk_class).toBe('C3');
  });

  it('classifies docker run/exec/push as C3', () => {
    expect(classify(shellIntent('docker', ['run', 'alpine'])).risk_class).toBe('C3');
    expect(classify(shellIntent('docker', ['exec', '-it', 'c', 'sh'])).risk_class).toBe('C3');
    expect(classify(shellIntent('docker', ['push', 'image:tag'])).risk_class).toBe('C3');
  });

  it('returns reasons for every classification', () => {
    const result = classify(shellIntent('curl', ['https://example.com']));
    expect(result.reasons).toBeInstanceOf(Array);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.reasons[0]).toBeTypeOf('string');
  });

  it('is deterministic — same input twice produces same output', () => {
    const intent = shellIntent('curl', ['https://example.com', '-X', 'POST']);
    const a = classify(intent);
    const b = classify(intent);
    expect(a).toEqual(b);
  });
});

describe('classifier — file_write conservative-escalation', () => {
  function fileWrite(path: string, mode: 'overwrite' | 'append' | 'create_only' = 'overwrite'): Intent {
    return {
      action_type: 'file_write',
      path,
      content_hash: 'a'.repeat(64),
      content_size_bytes: 100,
      mode,
    };
  }

  it('classifies all system-critical path prefixes as C4', () => {
    const c4Paths = [
      '/etc/passwd', '/etc/sudoers',
      '/usr/bin/python', '/usr/lib/x86_64-linux-gnu/libc.so.6',
      '/bin/ls', '/sbin/init',
      '/boot/grub/grub.cfg', '/sys/class/net/eth0',
      '/proc/sys/kernel/panic', '/root/.ssh/authorized_keys',
    ];
    for (const path of c4Paths) {
      expect(classify(fileWrite(path)).risk_class).toBe('C4');
    }
  });

  it('classifies all known credentials/shell-config writes as C3', () => {
    const c3Paths = [
      '/home/user/.bashrc',
      '/home/user/.zshrc',
      '/home/user/.profile',
      '/home/user/.ssh/authorized_keys',
      '/home/user/.gnupg/private-keys-v1.d/key.key',
      '/home/user/.aws/credentials',
      '/home/user/.netrc',
    ];
    for (const path of c3Paths) {
      expect(classify(fileWrite(path)).risk_class).toBe('C3');
    }
  });

  it('classifies overwrite of non-system, non-credential paths as C2', () => {
    expect(classify(fileWrite('/tmp/scratch.txt', 'overwrite')).risk_class).toBe('C2');
    expect(classify(fileWrite('/home/user/project/output.txt', 'overwrite')).risk_class).toBe('C2');
  });

  it('classifies append or create_only of non-system, non-credential paths as C1', () => {
    expect(classify(fileWrite('/tmp/log.txt', 'append')).risk_class).toBe('C1');
    expect(classify(fileWrite('/tmp/new.txt', 'create_only')).risk_class).toBe('C1');
  });
});

describe('classifier — file_read conservative-escalation', () => {
  function fileRead(path: string): Intent {
    return { action_type: 'file_read', path };
  }

  it('classifies credentials/secrets reads as C3', () => {
    expect(classify(fileRead('/home/user/.ssh/id_rsa')).risk_class).toBe('C3');
    expect(classify(fileRead('/home/user/.ssh/id_ed25519')).risk_class).toBe('C3');
    expect(classify(fileRead('/home/user/.gnupg/secring.gpg')).risk_class).toBe('C3');
    expect(classify(fileRead('/home/user/.aws/credentials')).risk_class).toBe('C3');
    expect(classify(fileRead('/home/user/.netrc')).risk_class).toBe('C3');
  });

  it('classifies non-credential reads as C0', () => {
    expect(classify(fileRead('/home/user/project/README.md')).risk_class).toBe('C0');
    expect(classify(fileRead('/tmp/output.log')).risk_class).toBe('C0');
    expect(classify(fileRead('/etc/passwd')).risk_class).toBe('C0');
    // ^ Note: this is a C0 read because the classifier reasons about
    // *intent to write*, not read-side disclosure. Read-side disclosure
    // risk lives in policy, not classifier.
  });
});

// ---------------------------------------------------------------------------
// Policy engine failure mode coverage
// ---------------------------------------------------------------------------

describe('PolicyEngine — load failure modes', () => {
  it('rejects a syntactically invalid JSON pack', () => {
    const engine = new PolicyEngine();
    expect(() => engine.loadPack('{ this is not json')).toThrow();
  });

  it('rejects a pack missing required schema_version', () => {
    const engine = new PolicyEngine();
    expect(() =>
      engine.loadPack({
        pack_id: 'broken',
        version: '1.0.0',
        description: 'missing schema_version',
        rules: [],
        default_decision: 'allow',
      })
    ).toThrow();
  });

  it('rejects a pack with wrong schema_version literal', () => {
    const engine = new PolicyEngine();
    expect(() =>
      engine.loadPack({
        schema_version: 'witseal.policy.v9.9',
        pack_id: 'wrong-version',
        version: '1.0.0',
        description: 'wrong literal',
        rules: [],
        default_decision: 'allow',
      })
    ).toThrow();
  });

  it('rejects a pack with non-kebab-case pack_id', () => {
    const engine = new PolicyEngine();
    expect(() =>
      engine.loadPack({
        schema_version: 'witseal.policy.v0.1',
        pack_id: 'NotKebab_Case',
        version: '1.0.0',
        description: 'bad id',
        rules: [],
        default_decision: 'allow',
      })
    ).toThrow();
  });

  it('rejects a pack with non-semver version', () => {
    const engine = new PolicyEngine();
    expect(() =>
      engine.loadPack({
        schema_version: 'witseal.policy.v0.1',
        pack_id: 'bad-version',
        version: 'not-semver',
        description: 'x',
        rules: [],
        default_decision: 'allow',
      })
    ).toThrow();
  });

  it('rejects a rule with unknown decision verb', () => {
    const engine = new PolicyEngine();
    expect(() =>
      engine.loadPack({
        schema_version: 'witseal.policy.v0.1',
        pack_id: 'bad-decision',
        version: '1.0.0',
        description: 'x',
        rules: [
          { id: 'r1', match: {}, decision: 'maybe-allow', reason: 'x' },
        ],
        default_decision: 'allow',
      } as unknown)
    ).toThrow();
  });

  it('loadPackFromFile throws ENOENT for missing path', () => {
    const engine = new PolicyEngine();
    const missingPath = join(tmpdir(), 'witseal-does-not-exist-' + Date.now() + '.json');
    expect(() => engine.loadPackFromFile(missingPath)).toThrow(/ENOENT|no such file/i);
  });

  it('loadPackFromFile throws on malformed JSON content', () => {
    const dir = mkdtempSync(join(tmpdir(), 'witseal-bad-pack-'));
    try {
      const path = join(dir, 'malformed.json');
      writeFileSync(path, '{ "not valid json');
      const engine = new PolicyEngine();
      expect(() => engine.loadPackFromFile(path)).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('PolicyEngine — evaluation invariants under degenerate inputs', () => {
  function makeIntent(risk_class: 'C0'|'C1'|'C2'|'C3'|'C4' = 'C1'): ClassifiedIntent {
    return {
      schema_version: 'witseal.intent.v0.1',
      intent_id: 'int_test00000000000001ab',
      intent: { action_type: 'shell_command', executable: 'echo', args: ['hi'], cwd: '/tmp', use_tty: false },
      risk_class,
      classification_reasons: [],
      classifier_version: 'test-1.0',
    };
  }

  it('with NO packs loaded, evaluates to "allow" (needs runtime warning)', () => {
    // Documents current behavior. This should also produce
    // a prominent warning at policy-evaluation time so misconfigured
    // deployments do not silently permit everything. The warning is
    // a separate work item.
    const engine = new PolicyEngine();
    const decision = engine.evaluate(makeIntent());
    expect(decision.outcome).toBe('allow');
    expect(decision.matched_rule).toBe(null);
    expect(decision.active_pack_hashes).toEqual([]);
  });

  it('with empty rules array and default_decision=deny, evaluates to "deny"', () => {
    const engine = new PolicyEngine();
    engine.loadPack({
      schema_version: 'witseal.policy.v0.1',
      pack_id: 'deny-default',
      version: '1.0.0',
      description: 'denies by default',
      rules: [],
      default_decision: 'deny',
    });
    const decision = engine.evaluate(makeIntent());
    expect(decision.outcome).toBe('deny');
  });

  it('with empty rules array and default_decision=require-approval, evaluates to "require-approval"', () => {
    const engine = new PolicyEngine();
    engine.loadPack({
      schema_version: 'witseal.policy.v0.1',
      pack_id: 'approval-default',
      version: '1.0.0',
      description: 'requires approval by default',
      rules: [],
      default_decision: 'require-approval',
    });
    const decision = engine.evaluate(makeIntent());
    expect(decision.outcome).toBe('require-approval');
  });

  it('most-restrictive-wins: deny default beats allow default beats nothing', () => {
    const engine = new PolicyEngine();
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
      pack_id: 'approval-default',
      version: '1.0.0',
      description: 'requires approval by default',
      rules: [],
      default_decision: 'require-approval',
    });
    expect(engine.evaluate(makeIntent()).outcome).toBe('require-approval');

    engine.loadPack({
      schema_version: 'witseal.policy.v0.1',
      pack_id: 'deny-default',
      version: '1.0.0',
      description: 'denies by default',
      rules: [],
      default_decision: 'deny',
    });
    expect(engine.evaluate(makeIntent()).outcome).toBe('deny');
  });

  it('decision always carries a non-empty reason string', () => {
    const engine = new PolicyEngine();
    expect(engine.evaluate(makeIntent()).reason.length).toBeGreaterThan(0);

    engine.loadPack({
      schema_version: 'witseal.policy.v0.1',
      pack_id: 'rule-with-reason',
      version: '1.0.0',
      description: 'x',
      rules: [{ id: 'r1', match: {}, decision: 'deny', reason: 'specific-reason' }],
      default_decision: 'allow',
    });
    const decision = engine.evaluate(makeIntent());
    expect(decision.reason).toBe('specific-reason');
  });

  it('decision always carries active_pack_hashes — even when no rule matched', () => {
    const engine = new PolicyEngine();
    engine.loadPack({
      schema_version: 'witseal.policy.v0.1',
      pack_id: 'allow-default',
      version: '1.0.0',
      description: 'x',
      rules: [],
      default_decision: 'allow',
    });
    const decision = engine.evaluate(makeIntent());
    expect(decision.active_pack_hashes).toHaveLength(1);
    expect(decision.active_pack_hashes[0]?.pack_id).toBe('allow-default');
    expect(decision.active_pack_hashes[0]?.content_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('a require-approval rule for C3/C4 fires before fall-through default', () => {
    const engine = new PolicyEngine();
    engine.loadPack({
      schema_version: 'witseal.policy.v0.1',
      pack_id: 'high-risk-approval',
      version: '1.0.0',
      description: 'require approval for high risk',
      rules: [
        { id: 'high-risk', match: { risk_class_in: ['C3', 'C4'] }, decision: 'require-approval', reason: 'high risk' },
      ],
      default_decision: 'allow',
    });
    expect(engine.evaluate(makeIntent('C4')).outcome).toBe('require-approval');
    expect(engine.evaluate(makeIntent('C0')).outcome).toBe('allow');
  });

  it('an "always deny" rule with empty match block fires for every intent', () => {
    // The "default rule" pattern: an empty match block matches everything.
    // This is the recommended deny-by-default safety pattern.
    const engine = new PolicyEngine();
    engine.loadPack({
      schema_version: 'witseal.policy.v0.1',
      pack_id: 'deny-everything',
      version: '1.0.0',
      description: 'safety net deny',
      rules: [
        { id: 'r-allow-echo', match: { command_matches: '^echo\\b' }, decision: 'allow', reason: 'echo ok' },
        { id: 'r-deny-rest', match: {}, decision: 'deny', reason: 'safety net' },
      ],
      default_decision: 'deny',
    });
    expect(engine.evaluate(makeIntent()).outcome).toBe('allow'); // echo matches first
    const cat = {
      ...makeIntent(),
      intent: { action_type: 'shell_command' as const, executable: 'cat', args: ['/etc/passwd'], cwd: '/tmp', use_tty: false },
    };
    expect(engine.evaluate(cat).outcome).toBe('deny'); // safety net fires
    expect(engine.evaluate(cat).matched_rule?.rule_id).toBe('r-deny-rest');
  });
});

// ---------------------------------------------------------------------------
// EXEC PIPELINE GAPS (NOT YET TESTABLE)
// ---------------------------------------------------------------------------
//
// The following failure modes from the third-party audit §2 are NOT yet testable at
// integration level because src/cli/exec.ts does not currently wrap the
// failure paths in protective error handling. Implementing the safety
// behavior is required before tests can be written. These gaps should be
// hardened in a separate work item.
//
// 1. Classifier throws unexpectedly during exec
//    Current: src/cli/exec.ts:41 calls `classify(intent)` without try/catch.
//    A classifier exception propagates out of runExec as an unhandled error.
//    Required: catch → produce C4 denial witness event with outcome
//      'denied_by_classification_failure' (already in the enum).
//
// 2. Policy file malformed → fail closed
//    Current: src/cli/exec.ts:54-60 calls `engine.loadPackFromFile(...)` in a
//    bare for-loop. A ZodError or JSON parse error escapes as unhandled.
//    Required: catch → log + produce denial event + non-zero exit. No
//    execution proceeds.
//
// 3. Policy directory missing → silent default-allow
//    Current: src/cli/exec.ts:54 guards with `existsSync(policyDir)`. Missing
//    directory results in zero packs loaded → default 'allow' fires silently.
//    Required: prominent runtime warning before evaluation.
//
// 4. Chain advance fails (e.g., disk full) → read-only mode on next startup
//    Current: not implemented.
//    Required: detection of broken-tail condition + refusal to advance until
//    operator intervention.
//
// 5. Two processes write concurrently → chain remains valid
//    Current: src/integrity/lock.ts uses fs.flockSync if available (Node 22+
//    on a recent version), else advisory-only warning. macOS Node 22.22.2
//    appears to lack flockSync (stabilized in Node 24), so concurrent writes
//    are not protected.
//    Required: real OS-level exclusive lock OR documented Node version floor.
//
// 6. Receipt generated but chain advance crashes → unsealed state recoverable
//    Current: chain advance + receipt are tightly coupled in emit path; partial
//    failure not modeled.
//    Required: two-phase commit semantics (Phase 2 work).
//
// 7. Approval times out → ApprovalRecord records 'timed_out' outcome
//    Coverage status: src/cli/approval.ts is the home for this; needs its own
//    test file (the approval module is currently untested).
//
// These gaps are tracked separately for prioritization. Items 1-3 are
// the highest-impact for Phase 1 closure and warrant tightening exec.ts
// regardless of whether the integration tests land in this stream or a
// follow-up.
