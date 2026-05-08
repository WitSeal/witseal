# WitSeal

> A witnessed execution runtime for AI agents.

WitSeal classifies AI-agent actions, enforces authority boundaries, records witness events, generates hash-chained receipts, and maintains tamper-evident evidence chains. Run any AI coding agent through `witseal exec` and every significant action becomes verifiable.

```
Agents generate intentions. WitSeal governs execution.
```

---

## Status

**Phase 0 → Phase 1 transition.** Pre-release. APIs, schemas, and CLI surface are unstable until v1.0.

This is **not yet** a product anyone should rely on. The repository is open for design partners and OSS contributors who want to shape the runtime.

---

## What WitSeal does

When an AI coding agent runs `rm -rf` on your project, three questions matter:

1. What did it do?
2. Was it allowed to do it?
3. Can you prove what happened?

WitSeal answers all three by making every agent action a *witnessed execution* — classified, mediated, receipted, and hash-linked into an evidence chain.

```bash
witseal exec -- npm test
witseal exec -- rm -rf /tmp/build
witseal verify ~/.witseal/events/default.jsonl
witseal replay <receipt-id>
```

Every action produces a structured **execution receipt** linked to the previous receipt by a SHA-256 hash. The chain is replayable, exportable, and independently verifiable.

---

## What WitSeal is not

- **Not** an AI coding agent
- **Not** a chat assistant
- **Not** a model router
- **Not** a generic workflow automation tool
- **Not** a full observability platform
- **Not** an enterprise GRC dashboard
- **Not** a blockchain project

For how WitSeal compares to other products in the space, see [`docs/competitive-comparison.md`](./docs/competitive-comparison.md).

---

## Quick start

> ⚠️ Phase 1 implementation in progress. The commands below describe the target Phase 1 surface; not all are functional yet.

### Install

```bash
npm install -g @witseal/cli   # planned
# or
brew install witseal          # planned
```

### Hello, witness

```bash
# Run a benign command through WitSeal
witseal exec -- echo "hello, witness"

# Inspect the witness event log
witseal events list

# Verify the chain
witseal verify

# Show a specific receipt
witseal receipt show <receipt-id>
```

A 90-second walkthrough lives in [`examples/hello-witness/`](./examples/hello-witness/).

### Apply a policy pack

```bash
witseal policy add ./examples/policy-packs/block-destructive.json

# Now this fails with a deny decision and a witness event recording the denial
witseal exec -- rm -rf /

# Verify the denial is in the chain
witseal events list --decision deny
```

---

## Architecture at a glance

The runtime pipeline:

```
intent → classification → policy → approval → execution → witness → receipt → hash-chain → evidence package
```

For the full architecture (state machines, trust boundaries, schema relationships, failure modes), see [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

---

## Design decisions

Every non-trivial architectural decision is recorded as an ADR in [`docs/adr/`](./docs/adr/). The Phase 1 set:

- [ADR-0001](./docs/adr/0001-hash-chain-construction.md) — Hash-chain construction (linear chain, SHA-256, RFC 8785 canonicalization)
- [ADR-0002](./docs/adr/0002-event-log-format.md) — Event log format (JSONL, append-only, fsync-on-write)
- [ADR-0003](./docs/adr/0003-policy-pack-format.md) — Policy pack format (declarative JSON, schema-validated)
- [ADR-0004](./docs/adr/0004-approval-prompt-ux.md) — Approval prompt UX (TUI default, CI auto-deny, deferred-callback mode)
- [ADR-0005](./docs/adr/0005-subprocess-capture.md) — Subprocess capture (explicit argv, streaming hash, bounded content)
- [ADR-0006](./docs/adr/0006-concurrency-model.md) — Concurrency model (single-writer per chain, `flock`, no daemon)

---

## What WitSeal does NOT yet do (honest)

Phase 1 limitations, documented in `docs/threat-model.md`:

- No third-party signatures (Phase 5 — Sigstore + Rekor integration)
- No kernel-level mediation (Phase 5 — eBPF/ptrace)
- No prompt-injection defense (out of scope; pair with a model-layer gateway)
- No remote witness chain (Phase 6 — federation)
- No identity layer (out of scope; pair with Strata-style identity products)

These limitations are not weaknesses — they are honest scope boundaries. Phase 1 is the developer-laptop wedge.

---

## Project structure

```
.
├── docs/
│   ├── ARCHITECTURE.md        # Phase 1 runtime architecture
│   ├── STYLE.md               # Vocabulary discipline
│   ├── threat-model.md        # What Phase 1 protects against (and what it doesn't)
│   ├── competitive-comparison.md  # How WitSeal compares to other products
│   └── adr/                   # Architectural decision records
├── schemas/                    # Zod schemas (witness, receipt, policy, approval, evidence)
├── src/
│   ├── cli/                   # CLI entry points (exec, verify, replay)
│   ├── risk/                  # Risk classifier (C0..C4)
│   ├── policy/                # Policy engine
│   ├── execution/             # Execution mediator (subprocess, filesystem)
│   ├── witness/               # Witness event emission, append-only log
│   ├── receipts/              # Receipt generation
│   ├── integrity/             # Hash chain, file lock
│   ├── evidence/              # Evidence package export
│   └── adapters/              # Agent framework adapters (OpenCode, Claude Code, ...)
├── examples/
│   ├── hello-witness/
│   └── policy-packs/
└── tests/
```

---

## Status of integrations

Phase 1 wedge is **OpenCode**. Phase 7 expands to:

| Framework | Status |
|---|---|
| OpenCode | in development (Phase 1) |
| Claude Code | adapter sketched (Phase 1 stretch) |
| Cursor | planned (Phase 7) |
| Gemini CLI | planned (Phase 7) |
| OpenAI Agents SDK | planned (Phase 7) |
| LangGraph | planned (Phase 7) |
| CrewAI | planned (Phase 7) |

External contributors who want to write an adapter for their preferred framework are welcome — see `src/adapters/README.md`.

---

## Security

WitSeal is a security-relevant project. Please report vulnerabilities responsibly per [`SECURITY.md`](./SECURITY.md). 90-day coordinated disclosure window.

Releases are signed via Sigstore Cosign starting from v0.1. Verification one-liner is in `SECURITY.md`.

---

## License

Apache License 2.0 — see [`LICENSE`](./LICENSE).

---

## Related projects

WitSeal is the operational product wedge in a three-layer architecture:

- **WitSeal** — operational runtime (this repo)
- **PAI-TrustAgents** — category and ecosystem (deferred to month 18+)
- **PAI-Kernel** — constitutional substrate (deferred to month 30+)

The relationship: PAI-Kernel defines authority. WitSeal operationalizes authority.

For the full strategic framework, see the founder's strategic document (private — request via security@witseal contact).

---

## Contributing

WitSeal is in active early-stage development. The maintainers are looking for design partners — AI infra engineers, OSS maintainers, or AI security engineers actively running coding agents in production workflows. Open an issue with the `design-partner` label or email contact@witseal.

For code contributions, please:

1. Read [`docs/STYLE.md`](./docs/STYLE.md) — vocabulary discipline matters
2. Read the relevant ADR before changing core behavior
3. Open an RFC for any change that affects schemas, the runtime pipeline, or the public CLI surface
4. Run `npm test` and `npm run lint` before submitting

---

## The one-line summary

> When AI agents gain operational power, their actions must become permissioned, witnessed, and accountable. WitSeal is the runtime that makes this possible.
