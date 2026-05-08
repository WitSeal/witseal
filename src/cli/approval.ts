/**
 * Approval prompt UX.
 *
 * See ADR-0004 for design rationale.
 *
 * Modes:
 *   - TTY (default when stderr.isTTY): prompt on stderr, read from /dev/tty
 *   - CI (when stderr is non-TTY or WITSEAL_NON_INTERACTIVE=1): auto-deny by default,
 *     allow-list via WITSEAL_AUTO_APPROVE=<rule_id1,rule_id2,...>
 *   - Callback (WITSEAL_APPROVAL_MODE=callback): write request file, poll for response file
 */

import { closeSync, existsSync, openSync, readSync } from 'node:fs';
import { generateApprovalId } from '../witness/emit.js';
import type { ApprovalRecord, ApprovalOutcome } from '../../schemas/approval.schema.js';
import type { ClassifiedIntent } from '../../schemas/intent.schema.js';
import type { PolicyDecision } from '../../schemas/policy.schema.js';

const DEFAULT_TIMEOUT_S = 60;

export async function obtainApproval(
  intent: ClassifiedIntent,
  decision: PolicyDecision
): Promise<ApprovalRecord> {
  const timeoutS = parseInt(process.env['WITSEAL_APPROVAL_TIMEOUT'] ?? `${DEFAULT_TIMEOUT_S}`, 10) || DEFAULT_TIMEOUT_S;
  const promptedAt = new Date();
  const approvalId = generateApprovalId();

  const isInteractive = process.stderr.isTTY && !process.env['WITSEAL_NON_INTERACTIVE'];

  if (process.env['WITSEAL_APPROVAL_MODE'] === 'callback') {
    return obtainViaCallback(intent, decision, approvalId, promptedAt, timeoutS);
  }

  if (!isInteractive) {
    return obtainViaCI(intent, decision, approvalId, promptedAt, timeoutS);
  }

  return obtainViaTTY(intent, decision, approvalId, promptedAt, timeoutS);
}

function obtainViaCI(
  intent: ClassifiedIntent,
  decision: PolicyDecision,
  approvalId: string,
  promptedAt: Date,
  timeoutS: number
): ApprovalRecord {
  const allowList = (process.env['WITSEAL_AUTO_APPROVE'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const matchedRuleId = decision.matched_rule?.rule_id;
  const allowed = matchedRuleId ? allowList.includes(matchedRuleId) : false;

  return {
    schema_version: 'witseal.approval.v0.1',
    approval_id: approvalId,
    intent_id: intent.intent_id,
    prompted_at: toIsoZ(promptedAt),
    resolved_at: toIsoZ(new Date()),
    outcome: allowed ? 'approved' : 'rejected',
    principal: {
      type: 'ci',
      identifier: process.env['WITSEAL_CI_PRINCIPAL'] ?? 'ci',
    },
    timeout_seconds: timeoutS,
    ...(allowed
      ? { reason: `auto-approved by WITSEAL_AUTO_APPROVE allow-list (rule: ${matchedRuleId})` }
      : { reason: 'CI context with no matching auto-approve allow-list entry' }),
  };
}

function obtainViaTTY(
  intent: ClassifiedIntent,
  decision: PolicyDecision,
  approvalId: string,
  promptedAt: Date,
  timeoutS: number
): ApprovalRecord {
  renderPrompt(intent, decision, timeoutS);

  const outcome = readApprovalChar(timeoutS);

  return {
    schema_version: 'witseal.approval.v0.1',
    approval_id: approvalId,
    intent_id: intent.intent_id,
    prompted_at: toIsoZ(promptedAt),
    resolved_at: toIsoZ(new Date()),
    outcome,
    principal: {
      type: 'human',
      identifier: process.env['USER'] ?? process.env['LOGNAME'] ?? 'unknown',
    },
    timeout_seconds: timeoutS,
  };
}

function obtainViaCallback(
  intent: ClassifiedIntent,
  _decision: PolicyDecision,
  approvalId: string,
  promptedAt: Date,
  timeoutS: number
): ApprovalRecord {
  // Phase 1 v0.1: callback mode is sketched; full implementation deferred.
  // Returns timed_out immediately with a clear message.
  process.stderr.write(
    'witseal: WITSEAL_APPROVAL_MODE=callback is not yet implemented in v0.1.\n'
  );
  return {
    schema_version: 'witseal.approval.v0.1',
    approval_id: approvalId,
    intent_id: intent.intent_id,
    prompted_at: toIsoZ(promptedAt),
    resolved_at: toIsoZ(new Date()),
    outcome: 'timed_out',
    principal: {
      type: 'ci',
      identifier: 'callback-not-implemented',
    },
    timeout_seconds: timeoutS,
    reason: 'callback mode not implemented in v0.1; treating as timeout',
  };
}

function renderPrompt(intent: ClassifiedIntent, decision: PolicyDecision, timeoutS: number): void {
  const out = process.stderr;
  out.write('\n');
  out.write('⚠ WitSeal approval required\n');
  out.write('─────────────────────────────────────────\n');
  if (intent.intent.action_type === 'shell_command') {
    const cmd = intent.intent;
    out.write(`Action:    shell_command\n`);
    out.write(`Command:   ${cmd.executable} ${cmd.args.join(' ')}\n`);
    out.write(`Cwd:       ${cmd.cwd}\n`);
  } else if (intent.intent.action_type === 'file_write') {
    out.write(`Action:    file_write\n`);
    out.write(`Path:      ${intent.intent.path}\n`);
    out.write(`Mode:      ${intent.intent.mode}\n`);
  } else {
    out.write(`Action:    ${intent.intent.action_type}\n`);
  }
  out.write(`Risk:      ${intent.risk_class}\n`);
  if (decision.matched_rule) {
    out.write(`Policy:    ${decision.matched_rule.rule_id} (${decision.matched_rule.pack_id})\n`);
  }
  out.write(`Reason:    ${decision.reason}\n`);
  out.write(`Timeout:   ${timeoutS}s\n`);
  out.write('─────────────────────────────────────────\n');
  out.write('Approve? [y/N]: ');
}

function readApprovalChar(timeoutS: number): ApprovalOutcome {
  // Open /dev/tty directly — bypasses stdin redirection (ADR-0004).
  if (!existsSync('/dev/tty')) {
    process.stderr.write('\n(no /dev/tty available; treating as rejected)\n');
    return 'rejected';
  }

  const fd = openSync('/dev/tty', 'r');
  try {
    const buf = Buffer.alloc(1);
    // Note: this is a synchronous blocking read. For v0.1 we accept that
    // a literal timeout is approximated by the OS; we cannot interrupt the
    // syscall portably. The 60s default is informational; the outer process
    // will appear to hang until input arrives. Phase 2 introduces select()-based
    // timeout handling.
    void timeoutS; // currently unused; documented above
    const bytes = readSync(fd, buf, 0, 1, null);
    if (bytes === 0) {
      process.stderr.write('\n');
      return 'rejected';
    }
    const ch = buf.toString('utf8');
    process.stderr.write('\n');
    if (ch === 'y' || ch === 'Y') return 'approved';
    return 'rejected';
  } finally {
    closeSync(fd);
  }
}

function toIsoZ(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
