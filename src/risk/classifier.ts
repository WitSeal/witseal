/**
 * Risk classifier for action intents.
 *
 * Assigns a RiskClass (C0..C4) based on the action's structural properties.
 * Pure function: same input always produces the same classification.
 * Versioned: changes to classifier rules bump CLASSIFIER_VERSION and produce
 * a chain-segment boundary.
 *
 * Phase 1 ruleset is deliberately conservative — when in doubt, classify higher.
 */

import type { Intent, RiskClass } from '../../schemas/intent.schema.js';

export const CLASSIFIER_VERSION = 'witseal-classifier-1.2';

export interface ClassificationResult {
  risk_class: RiskClass;
  reasons: string[];
}

/**
 * Conservative classifier.
 *
 * The escalation principle: if a command MIGHT be high-risk under any
 * reasonable interpretation, classify it high. Policy can still allow it.
 * The classifier's job is not to be permissive; it is to be honest about
 * what an action can do.
 */
export function classify(intent: Intent): ClassificationResult {
  switch (intent.action_type) {
    case 'shell_command':
      return classifyShell(intent);
    case 'file_write':
      return classifyFileWrite(intent);
    case 'file_read':
      return classifyFileRead(intent);
  }
}

// Patterns deliberately conservative. False-positives (rare actions classified
// too high) are acceptable — policy can override. False-negatives (dangerous
// actions classified too low) are NOT acceptable.

const C4_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  // \b (not ^): the match candidate is the joined argv, so an own-execute
  // wrapper `/bin/sh -c 'rm -rf /'` joins to `/bin/sh -c rm -rf /` and the rm is
  // not at the start of the string. Word-boundary anchoring fires for both the
  // direct and wrapped shapes (mirrors the example-pack command_matches fix).
  { pattern: /\brm\s+(-[rRf]+\s+)+(\/|\$HOME|~)/, reason: 'rm -rf on root or home' },
  { pattern: /\b(dd|mkfs|fdisk|parted|wipefs)\b/, reason: 'disk-level destructive utility' },
  { pattern: /\bsudo\b/, reason: 'privilege escalation via sudo' },
  { pattern: /:\(\)\s*\{/, reason: 'shell fork bomb pattern detected' },
  { pattern: /\bshutdown\b|\breboot\b|\bhalt\b/, reason: 'system shutdown command' },
  { pattern: /\biptables\b|\bnft\b/, reason: 'firewall modification' },
  // D8 shell-bypass: opaque remote/encoded execution is treated as catastrophic.
  { pattern: /\b(curl|wget|fetch)\b.*\|\s*(bash|sh|zsh|dash)\b/, reason: 'shell-bypass: network download piped to a shell (remote code execution)' },
  { pattern: /\bbase64\b.*\|\s*(bash|sh|zsh|dash)\b/, reason: 'shell-bypass: base64 payload piped to a shell (opaque execution)' },
];

const C3_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\b(curl|wget|nc|ncat|socat|httpie)\b/, reason: 'network egress utility' },
  { pattern: /\b(npm|pip|gem|cargo|go)\s+install\b/, reason: 'package installation' },
  { pattern: /\bgit\s+push\b/, reason: 'remote repository push' },
  { pattern: /\bdocker\s+(run|exec|push)\b/, reason: 'container execution or registry push' },
  { pattern: /\bssh\b/, reason: 'remote shell access' },
  { pattern: /\brm\s+-[rRf]/, reason: 'recursive removal' },
  // D8 shell-bypass: nested interpreters hide the real action from structural
  // classification, so the invocation itself is elevated (policy can still allow).
  { pattern: /\b(bash|sh|zsh|dash|ksh)\s+-[A-Za-z]*c\b/, reason: 'shell-bypass: nested shell -c invocation, opaque to classification' },
  { pattern: /\beval\b/, reason: 'shell-bypass: eval of a dynamic string' },
  { pattern: /\b(python3?|ruby|perl|node|deno|php)\s+-(c|e)\b/, reason: 'shell-bypass: inline interpreter code (-c/-e)' },
  { pattern: /\bnode\s+--eval\b/, reason: 'shell-bypass: node --eval inline code' },
  { pattern: /\|\s*(bash|sh|zsh|dash)\b/, reason: 'shell-bypass: command piped to a shell' },
];

const C2_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bgit\s+(commit|reset|rebase|merge)\b/, reason: 'git history modification' },
  { pattern: /\b(npm|pnpm|yarn)\s+(test|build|run)\b/, reason: 'build or test execution' },
  { pattern: /\bmake\b/, reason: 'make execution' },
  { pattern: /\bmv\b|\bcp\b/, reason: 'file move or copy' },
  { pattern: /\b(chmod|chown)\b/, reason: 'permissions modification' },
];

const C0_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /^\s*(echo|printf|true|false|cat|head|tail|wc|sort|uniq|grep|find|ls|pwd|stat|file|du|df)\b/, reason: 'informational command' },
  { pattern: /\b(node|python|python3|ruby|perl)\s+--?(version|help)\b/, reason: 'version/help check' },
];

function classifyShell(intent: Extract<Intent, { action_type: 'shell_command' }>): ClassificationResult {
  const fullCommand = `${intent.executable} ${intent.args.join(' ')}`;

  for (const { pattern, reason } of C4_PATTERNS) {
    if (pattern.test(fullCommand)) return { risk_class: 'C4', reasons: [reason] };
  }
  for (const { pattern, reason } of C3_PATTERNS) {
    if (pattern.test(fullCommand)) return { risk_class: 'C3', reasons: [reason] };
  }
  for (const { pattern, reason } of C2_PATTERNS) {
    if (pattern.test(fullCommand)) return { risk_class: 'C2', reasons: [reason] };
  }
  for (const { pattern, reason } of C0_PATTERNS) {
    if (pattern.test(fullCommand)) return { risk_class: 'C0', reasons: [reason] };
  }

  // Default for shell commands: C1 (low but not informational)
  return { risk_class: 'C1', reasons: ['shell command, no high-risk pattern matched'] };
}

function classifyFileWrite(intent: Extract<Intent, { action_type: 'file_write' }>): ClassificationResult {
  const path = intent.path;

  // C4: writes to system-critical paths
  if (/^\/(etc|usr|bin|sbin|boot|sys|proc|root)\b/.test(path)) {
    return { risk_class: 'C4', reasons: ['write to system-critical path'] };
  }
  // C3: writes to dotfiles or shell config in home
  if (/\/\.(bashrc|zshrc|profile|ssh\/|gnupg\/|aws\/|netrc)/.test(path)) {
    return { risk_class: 'C3', reasons: ['write to credentials or shell-config file'] };
  }
  // C2: overwrite of an existing file
  if (intent.mode === 'overwrite') {
    return { risk_class: 'C2', reasons: ['overwrite existing file'] };
  }
  // C1: append or create
  return { risk_class: 'C1', reasons: ['file write (non-overwrite, non-system)'] };
}

function classifyFileRead(intent: Extract<Intent, { action_type: 'file_read' }>): ClassificationResult {
  const path = intent.path;
  // C3: reading credentials or secrets
  if (/\/\.(ssh\/|gnupg\/|aws\/credentials|netrc)/.test(path)) {
    return { risk_class: 'C3', reasons: ['read from credentials file'] };
  }
  // C0: file reads are otherwise informational
  return { risk_class: 'C0', reasons: ['file read (non-credential)'] };
}
