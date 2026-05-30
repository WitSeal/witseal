/**
 * `witseal unlock` — remove an orphaned chain lock left by a crashed process.
 *
 * Only relevant to the lockfile-shim backend (Node 20–23 without
 * `fs.flockSync`): a `SIGKILL`ed writer cannot run its release, so its lockfile
 * survives. The native flock backend (Node 24+) auto-releases on process exit,
 * so there is nothing to unlock there (this command reports "nothing to do").
 *
 * Safety: the lock is removed ONLY if its recorded holder is provably dead (no
 * such pid, or a reused pid whose process start-time differs). If the holder
 * looks alive, the command refuses and exits non-zero — it never breaks a live
 * writer's lock (T11 single-writer invariant).
 */

import { join } from 'node:path';
import { ChainLock } from '../integrity/lock.js';

export interface UnlockOptions {
  dataDir: string;
  segmentId: string;
}

export function runUnlock(opts: UnlockOptions): number {
  // Mirror EventLog's lock location: <dataDir>/events/<segment>.lock
  const lockPath = join(opts.dataDir, 'events', `${opts.segmentId}.lock`);
  const lock = new ChainLock(lockPath);
  const result = lock.forceUnlockIfDead();

  switch (result.status) {
    case 'absent':
      process.stdout.write(
        `witseal: no orphaned lock for segment '${opts.segmentId}'; nothing to do.\n`
      );
      return 0;
    case 'removed':
      process.stdout.write(
        `witseal: removed orphaned lock for segment '${opts.segmentId}'.\n` +
          `         former holder pid ${result.holder?.pid ?? '?'} is gone.\n` +
          `         ${result.lockfile}\n`
      );
      return 0;
    case 'held':
      process.stderr.write(
        `witseal: refusing to remove the lock for segment '${opts.segmentId}': ` +
          `its holder (pid ${result.holder?.pid ?? '?'}) appears to be alive.\n` +
          `         If you are certain no witseal process is running, remove\n` +
          `         ${result.lockfile}\n` +
          `         manually.\n`
      );
      return 1;
  }
}
