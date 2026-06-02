/**
 * Temporal adapter — public surface.
 *
 * - Level 3 (own-execute): `witnessedShell` — register as a Temporal Activity.
 * - Level 2 (observe): `recordActivityWitness` / `WitnessActivityInbound` —
 *   witness an Activity you do not own via an `ActivityInboundCallsInterceptor`.
 *
 * See this directory's README for the registration shims and the canon note on
 * Temporal-id correlation (carried in `agent_identifier`, no new receipt field).
 */
export * from './activity.js';
export * from './interceptor.js';
