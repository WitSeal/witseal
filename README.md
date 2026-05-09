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

> ⚠️ Phase 1 pre-release. APIs and CLI surface are unstable until v1.0.

<!-- ASCIICAST_PLACEHOLDER: replace this comment with the asciinema embed once recorded -->
<!-- [![asciicast](https://asciinema.org/a/<id>.svg)](https://asciinema.org/a/<id>) -->

### Install

```bash
npm install -g @witseal/cli
```

### Verify the release before using (recommended)

Every release is signed via [Sigstore Cosign](https://www.sigstore.dev/) using
keyless OIDC signing through GitHub Actions, with inclusion in the public
[Rekor transparency log](https://docs.sigstore.dev/rekor/overview/).

```bash
cosign verify-blob \
  --certificate-identity-regexp 'https://github.com/WitSeal/witseal/.+' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  --signature witseal-v0.1.0-pre.tgz.sig \
  --certificate witseal-v0.1.0-pre.tgz.crt \
  witseal-v0.1.0-pre.tgz
```

The exact one-liner is published in each release's notes. See
[`SECURITY.md`](./SECURITY.md) for the full verification policy.

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

## Integrations

Phase 1 wedge integrates with **OpenCode**. The adapter contract is documented in [`src/adapters/README.md`](./src/adapters/README.md) — external contributors who want to write an adapter for their preferred framework are welcome.

Adapters for additional frameworks (Claude Code, Cursor, Gemini CLI, OpenAI Agents SDK, LangGraph, CrewAI) follow in subsequent phases as adapter SDK stabilizes.

---

## Security

WitSeal is a security-relevant project. Please report vulnerabilities responsibly per [`SECURITY.md`](./SECURITY.md). 90-day coordinated disclosure window.

Releases are signed via Sigstore Cosign starting from v0.1. Verification one-liner is in `SECURITY.md`.

---

## License

Apache License 2.0 — see [`LICENSE`](./LICENSE).

---

## Contributing

WitSeal is in active early-stage development. We are recruiting 5 design partners — AI infra engineers, OSS maintainers, or AI security engineers running coding agents in production-relevant workflows. Open the [design partner inquiry template](https://github.com/WitSeal/witseal/issues/new?template=design-partner.yml).

For code contributions, see [`CONTRIBUTING.md`](./CONTRIBUTING.md). In short:

1. Read [`STYLE.md`](./STYLE.md) — vocabulary discipline matters
2. Read the relevant [ADR](./docs/adr/) before changing core behavior
3. Open an [RFC](./docs/RFCS.md) for any change to schemas, cryptographic primitives, or CLI surface
4. Run `npm test`, `npm run typecheck`, and `node scripts/style-check.mjs` before submitting

Code is contributed under [Apache License 2.0](./LICENSE) with [DCO sign-off](https://developercertificate.org/) (`git commit -s`).

---

## The one-line summary

> When AI agents gain operational power, their actions must become permissioned, witnessed, and accountable. WitSeal is the runtime that makes this possible.
