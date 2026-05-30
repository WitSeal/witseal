/**
 * Single source of truth for the WitSeal version.
 *
 * The version is read from the package's own `package.json` at module load, so
 * it can never drift from the published package version. (Historical drift bug:
 * the CLI `--version` string and the `witseal_runtime` witness stamp were each
 * a hardcoded '0.1.0-pre' literal; both silently diverged from package.json on
 * the 0.1.0 release.)
 *
 * Layout-robust resolution. The consuming module sits at a different depth
 * depending on how the code runs:
 *   - dev (tsx):         src/version.ts                          → ../package.json
 *   - built (this repo): dist/src/version.js                     → ../../package.json
 *   - installed dep:     node_modules/@witseal/cli/dist/src/...  → package root
 * A fixed relative path is correct for only one of these. Instead we walk up
 * from this module's directory to the nearest `package.json` carrying a
 * `version` field — correct in all three layouts. There is no intermediate
 * package.json between the build output and the package root, so the first one
 * found is always the package's own.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function resolveVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  // src→root or dist/src→root is 1–3 hops; the loop also stops at the FS root.
  for (let i = 0; i < 12; i++) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
        version?: unknown;
      };
      if (typeof pkg.version === 'string' && pkg.version.length > 0) {
        return pkg.version;
      }
    } catch {
      // No package.json here (or unreadable/unparseable) — keep walking up.
    }
    const parent = dirname(dir);
    if (parent === dir) break; // reached the filesystem root
    dir = parent;
  }
  throw new Error(
    'WitSeal: unable to resolve version from package.json (walked up from the module directory)'
  );
}

/**
 * The resolved WitSeal package version (e.g. `0.1.1`). Single source of truth
 * for both the CLI `--version` output and the `witseal_runtime` witness stamp.
 */
export const WITSEAL_VERSION: string = resolveVersion();
