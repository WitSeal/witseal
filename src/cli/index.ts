#!/usr/bin/env node
/**
 * WitSeal CLI entry point.
 *
 * Subcommands:
 *   witseal exec [-- <command> [args...]]  — mediated execution
 *   witseal verify [<segment>]             — verify the chain
 *   witseal replay <event-id|seq>          — replay a single action's evidence
 *   witseal events list                    — list witness events
 *   witseal events show <event-id>         — show one event
 *   witseal receipt show <id>              — show one receipt (v0.1/v0.2)
 *   witseal policy add <path>              — add a policy pack to the active set
 *   witseal policy list                    — list active policy packs
 *   witseal evidence export [--out <file>] — export an evidence package
 *
 * Phase 1 v0.1: exec, verify, events list, evidence export, receipt show are
 * functional. The remainder are stubs that surface "not yet implemented in v0.1".
 */

import { Command } from 'commander';
import { runExec } from './exec.js';
import { runVerify } from './verify.js';
import { runReplay } from './replay.js';
import { runEventsList } from './events.js';
import { runEvidenceExport } from './evidence.js';
import { runReceiptShow } from './receipt.js';
import { runPolicyAdd, runPolicyList } from './policy.js';

const program = new Command();

program
  .name('witseal')
  .description('Witnessed execution runtime for AI agents')
  .version('0.1.0-pre')
  .option('--data-dir <path>', 'WitSeal data directory', defaultDataDir())
  .option('--segment <id>', 'Chain segment ID', 'default');

program
  .command('exec')
  .description('Run a command through WitSeal mediation')
  .option('--agent <id>', 'Agent identifier', 'cli-user')
  .option('--cwd <path>', 'Working directory for the command', process.cwd())
  .option('--timeout <ms>', 'Execution timeout in milliseconds', '0')
  .argument('<command>', 'Executable to run')
  .argument('[args...]', 'Arguments to pass')
  .action(async (command: string, args: string[], opts, cmd) => {
    // RFC-002 §7.2: detect whether --agent was explicitly set by the
    // operator or is the CLI default. commander.getOptionValueSource()
    // returns 'default' when the option was not provided on the command
    // line; 'cli' (or 'env') when it was. This drives identity_origin
    // in the witness event so evidence consumers can distinguish a
    // configured agent identity from the runtime's built-in default.
    const agentSource = (cmd as { getOptionValueSource: (k: string) => string }).getOptionValueSource('agent');
    const identityOrigin = agentSource === 'default' ? 'fallback' : 'configured';
    const exitCode = await runExec({
      command,
      args,
      agentId: opts.agent as string,
      identityOrigin,
      cwd: opts.cwd as string,
      timeoutMs: parseInt(opts.timeout as string, 10) || 0,
      dataDir: program.opts()['dataDir'] as string,
      segmentId: program.opts()['segment'] as string,
    });
    process.exit(exitCode);
  });

program
  .command('verify')
  .description('Verify the integrity of the chain')
  .action(async () => {
    const exitCode = await runVerify({
      dataDir: program.opts()['dataDir'] as string,
      segmentId: program.opts()['segment'] as string,
    });
    process.exit(exitCode);
  });

program
  .command('replay')
  .description('Replay an action from its evidence')
  .argument('<event-id-or-seq>', 'Event ID or sequence number')
  .action(async (id: string) => {
    const exitCode = await runReplay({
      identifier: id,
      dataDir: program.opts()['dataDir'] as string,
      segmentId: program.opts()['segment'] as string,
    });
    process.exit(exitCode);
  });

const events = program.command('events').description('Inspect witness events');
events
  .command('list')
  .description('List witness events')
  .option('--limit <n>', 'Maximum number to show', '20')
  .option('--decision <outcome>', 'Filter by outcome (allow|deny|approval)')
  .action(async (opts) => {
    const exitCode = await runEventsList({
      limit: parseInt(opts.limit, 10) || 20,
      decision: opts.decision as string | undefined,
      dataDir: program.opts()['dataDir'] as string,
      segmentId: program.opts()['segment'] as string,
    });
    process.exit(exitCode);
  });

const receipt = program.command('receipt').description('Inspect execution receipts');
receipt
  .command('show')
  .description('Show a single execution receipt (v0.1 or v0.2)')
  .argument('<id>', 'Receipt id (rcpt_…), witness event id (evt_…), sequence, or unique prefix')
  .option('--from <package>', 'Read the receipt from an exported evidence package JSON (supports v0.2 receipts)')
  .option('--json', 'Emit the raw receipt JSON instead of the human-readable view')
  .action(async (id: string, opts) => {
    const exitCode = await runReceiptShow({
      identifier: id,
      ...(opts.from ? { fromPackage: opts.from as string } : {}),
      ...(opts.json ? { json: true } : {}),
      dataDir: program.opts()['dataDir'] as string,
      segmentId: program.opts()['segment'] as string,
    });
    process.exit(exitCode);
  });

const policy = program.command('policy').description('Manage policy packs');
policy
  .command('add')
  .description('Add a policy pack')
  .argument('<path>', 'Path to policy pack JSON file')
  .action(async (path: string) => {
    const exitCode = await runPolicyAdd({
      path,
      dataDir: program.opts()['dataDir'] as string,
    });
    process.exit(exitCode);
  });
policy
  .command('list')
  .description('List active policy packs')
  .action(async () => {
    const exitCode = await runPolicyList({
      dataDir: program.opts()['dataDir'] as string,
    });
    process.exit(exitCode);
  });

const evidence = program.command('evidence').description('Evidence package operations');
evidence
  .command('export')
  .description('Export an evidence package')
  .option('--out <file>', 'Output file path (default: stdout)')
  .option('--start <seq>', 'Start sequence (inclusive)')
  .option('--end <seq>', 'End sequence (inclusive)')
  .option(
    '--receipt-version <v>',
    'Receipt schema version: v0.1 (default) or v0.2 (signed)',
    'v0.1'
  )
  .option('--signing-key <path|hex>', 'Ed25519 signing key (PEM/DER path or 64-char raw-seed hex); required for v0.2')
  .option('--git-commit <sha1>', 'v0.2 build provenance: bare 40-hex git commit')
  .option('--artifact-digest <sha256>', 'v0.2 build provenance: sha256:<hex> artifact digest')
  .option('--attestation-digest <sha256>', 'v0.2 build provenance: sha256:<hex> attestation digest')
  .option('--artifact-type <type>', 'v0.2 build provenance: kebab-case artifact type')
  .option('--build-id <id>', 'v0.2 build provenance: free-form build identifier')
  .action(async (opts) => {
    const receiptVersion = normalizeReceiptVersion(opts.receiptVersion as string);
    const exitCode = await runEvidenceExport({
      ...(opts.out ? { outPath: opts.out as string } : {}),
      ...(opts.start ? { startSequence: parseInt(opts.start, 10) } : {}),
      ...(opts.end ? { endSequence: parseInt(opts.end, 10) } : {}),
      receiptVersion,
      ...(opts.signingKey ? { signingKeyPath: opts.signingKey as string } : {}),
      ...(opts.gitCommit ? { gitCommit: opts.gitCommit as string } : {}),
      ...(opts.artifactDigest ? { artifactDigest: opts.artifactDigest as string } : {}),
      ...(opts.attestationDigest ? { attestationDigest: opts.attestationDigest as string } : {}),
      ...(opts.artifactType ? { artifactType: opts.artifactType as string } : {}),
      ...(opts.buildId ? { buildId: opts.buildId as string } : {}),
      dataDir: program.opts()['dataDir'] as string,
      segmentId: program.opts()['segment'] as string,
    });
    process.exit(exitCode);
  });

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`witseal: error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(2);
});

function defaultDataDir(): string {
  return process.env['WITSEAL_DATA_DIR'] ?? `${process.env['HOME'] ?? '.'}/.witseal`;
}

/**
 * Map the `--receipt-version` flag (accepting `v0.1`/`v0.2` shorthand or the
 * full `witseal.receipt.vX.Y` literal) to the canonical schema-version string.
 * Unknown values fall back to v0.1 (the backward-compatible default).
 */
function normalizeReceiptVersion(
  v: string
): 'witseal.receipt.v0.1' | 'witseal.receipt.v0.2' {
  const norm = v.trim().toLowerCase();
  if (norm === 'v0.2' || norm === '0.2' || norm === 'witseal.receipt.v0.2') {
    return 'witseal.receipt.v0.2';
  }
  return 'witseal.receipt.v0.1';
}
