/**
 * Vitest setup — runs once per test process before any test file is imported.
 *
 * On Node <24 (no `fs.flockSync`) `ChainLock` uses the fail-closed lockfile
 * shim (ADR-0006) — the correct default. Tests exercise the real shim lock
 * against their per-test tmpdir segments; no environment opt-out is required.
 *
 * (Historically this file set `WITSEAL_UNSAFE_LOCKLESS=1` to bypass the old
 * fail-closed-without-flock behavior on the Node 22 runner. The lockfile shim
 * replaces that fallback, so the opt-out is no longer set here. Tests that
 * specifically exercise the advisory opt-out set the env var within their own
 * scope.)
 */
export {};
