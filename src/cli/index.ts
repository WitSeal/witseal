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
 *   witseal receipt show <receipt-id>      — show one receipt
 *   witseal policy add <path>              — add a policy pack to the active set
 *   witseal policy list                    — list active policy packs
 *   witseal evidence export [--out <file>] — export an evidence package
 *
 * Phase 1 v0.1: exec, verify, events list, evidence export are functional.
 * The remainder are stubs that surface "not yet implemented in v0.1".
 */

import { Command } from 'commander';
import { runExec } from './exec.js';
import { runVerify } from './verify.js';
import { runReplay } from './replay.js';
import { runEventsList } from './events.js';
import { runEvidenceExport } from './evidence.js';
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
  .description('Verify the live chain, or a receipt / evidence-package file')
  .argument('[file]', 'Receipt or evidence-package JSON to verify (default: live chain)')
  .option('--public-key <path|hex>', 'Ed25519 public key (PEM/DER path or 64-char raw hex); required for v0.2 receipt verification')
  .action(async (file: string | undefined, opts) => {
    const exitCode = await runVerify({
      dataDir: program.opts()['dataDir'] as string,
      segmentId: program.opts()['segment'] as string,
      ...(file ? { artifactPath: file } : {}),
      ...(opts.publicKey ? { publicKeyPath: opts.publicKey as string } : {}),
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
  .action(async (opts) => {
    const exitCode = await runEvidenceExport({
      ...(opts.out ? { outPath: opts.out as string } : {}),
      ...(opts.start ? { startSequence: parseInt(opts.start, 10) } : {}),
      ...(opts.end ? { endSequence: parseInt(opts.end, 10) } : {}),
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
