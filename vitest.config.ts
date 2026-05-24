import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    typecheck: { enabled: false },
    // Sets WITSEAL_UNSAFE_LOCKLESS=1 so the ChainLock fail-closed default
    // (P0-3, runtime-boundary audit 2026-05-25) does not break test files
    // that only use the lock as infrastructure. See tests/setup.ts.
    setupFiles: ['tests/setup.ts'],
  },
});
