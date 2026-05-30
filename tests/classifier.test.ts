import { describe, expect, it } from 'vitest';
import { classify } from '../src/risk/classifier.js';

function shellIntent(executable: string, args: string[] = []) {
  return {
    action_type: 'shell_command' as const,
    executable,
    args,
    cwd: '/tmp',
    use_tty: false,
  };
}

describe('classifier — shell commands', () => {
  it('classifies destructive rm -rf as C4', () => {
    expect(classify(shellIntent('rm', ['-rf', '/'])).risk_class).toBe('C4');
    expect(classify(shellIntent('rm', ['-rf', '/home/user'])).risk_class).toBe('C4');
  });

  it('classifies sudo as C4', () => {
    expect(classify(shellIntent('sudo', ['anything'])).risk_class).toBe('C4');
  });

  it('classifies disk utilities as C4', () => {
    expect(classify(shellIntent('dd', ['if=/dev/zero', 'of=/dev/sda'])).risk_class).toBe('C4');
    expect(classify(shellIntent('mkfs.ext4', ['/dev/sda1'])).risk_class).toBe('C4');
  });

  it('classifies network egress as C3', () => {
    expect(classify(shellIntent('curl', ['https://example.com'])).risk_class).toBe('C3');
    expect(classify(shellIntent('wget', ['https://example.com'])).risk_class).toBe('C3');
  });

  it('classifies package install as C3', () => {
    expect(classify(shellIntent('npm', ['install', 'lodash'])).risk_class).toBe('C3');
    expect(classify(shellIntent('pip', ['install', 'requests'])).risk_class).toBe('C3');
  });

  it('classifies git push as C3', () => {
    expect(classify(shellIntent('git', ['push', 'origin', 'main'])).risk_class).toBe('C3');
  });

  it('classifies build/test as C2', () => {
    expect(classify(shellIntent('npm', ['test'])).risk_class).toBe('C2');
    expect(classify(shellIntent('make', ['install'])).risk_class).toBe('C2');
  });

  it('classifies informational commands as C0', () => {
    expect(classify(shellIntent('echo', ['hello'])).risk_class).toBe('C0');
    expect(classify(shellIntent('ls', ['-la'])).risk_class).toBe('C0');
    expect(classify(shellIntent('cat', ['file.txt'])).risk_class).toBe('C0');
  });

  it('defaults unknown commands to C1 (not C0)', () => {
    expect(classify(shellIntent('frobnicate', ['x'])).risk_class).toBe('C1');
  });
});

describe('classifier — file writes', () => {
  it('classifies system-path writes as C4', () => {
    expect(
      classify({
        action_type: 'file_write',
        path: '/etc/passwd',
        content_hash: 'a'.repeat(64),
        content_size_bytes: 100,
        mode: 'overwrite',
      }).risk_class
    ).toBe('C4');
  });

  it('classifies credentials-file writes as C3', () => {
    expect(
      classify({
        action_type: 'file_write',
        path: '/home/user/.ssh/authorized_keys',
        content_hash: 'a'.repeat(64),
        content_size_bytes: 100,
        mode: 'append',
      }).risk_class
    ).toBe('C3');
  });

  it('classifies overwrites as C2', () => {
    expect(
      classify({
        action_type: 'file_write',
        path: '/tmp/output.txt',
        content_hash: 'a'.repeat(64),
        content_size_bytes: 100,
        mode: 'overwrite',
      }).risk_class
    ).toBe('C2');
  });

  it('classifies appends/creates as C1', () => {
    expect(
      classify({
        action_type: 'file_write',
        path: '/tmp/output.txt',
        content_hash: 'a'.repeat(64),
        content_size_bytes: 100,
        mode: 'create_only',
      }).risk_class
    ).toBe('C1');
  });
});

describe('classifier — file reads', () => {
  it('classifies credentials reads as C3', () => {
    expect(
      classify({
        action_type: 'file_read',
        path: '/home/user/.ssh/id_ed25519',
      }).risk_class
    ).toBe('C3');
  });

  it('classifies normal reads as C0', () => {
    expect(
      classify({
        action_type: 'file_read',
        path: '/home/user/project/README.md',
      }).risk_class
    ).toBe('C0');
  });
});
