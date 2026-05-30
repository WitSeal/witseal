/**
 * Vitest setup — runs once per test process before any test file is imported.
 *
 * Background — P0-3 (runtime-boundary audit 2026-05-25): production
 * `ChainLock` fails closed when the host Node runtime lacks `fs.flockSync`
 * (added in Node 24+). On the test runner (Node 22.x, where `flockSync` is
 * not yet stabilized) every test that touches an EventLog would otherwise
 * throw `ChainLockUnavailableError`.
 *
 * Tests are not the threat model the fail-closed default is protecting
 * (concurrent multi-writer corruption of the chain). They run single-process
 * against tmpdirs and never share a chain segment across processes. Treating
 * them as the explicit escape-hatch caller is correct.
 *
 * Tests that specifically exercise the fail-closed path (in
 * `tests/integrity-lock.test.ts`) explicitly unset this var inside their own
 * scope (`delete process.env.WITSEAL_UNSAFE_LOCKLESS`).
 */
process.env.WITSEAL_UNSAFE_LOCKLESS = '1';
