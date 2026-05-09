# Changelog

All notable changes to WitSeal will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Pre-1.0 versions: schemas and CLI surface are unstable. Minor versions may introduce breaking changes; patch versions will not.

## [Unreleased]

## [0.1.0-pre] — 2026-05-12

Initial pre-release of the WitSeal Phase 1 wedge: the witnessed CLI runtime that mediates AI-agent shell actions on a single developer machine.

### Added

- CLI: `witseal exec`, `witseal verify`, `witseal replay`, `witseal events list`, `witseal policy add/list`, `witseal evidence export`
- Conservative risk classifier (C0–C4) with patterns for shell, file write, and file read intents
- Declarative policy pack format (JSON, schema-validated)
- Policy engine with `all_of` / `any_of` / `not` composition and regex matchers
- Append-only JSONL event log with fsync-on-write
- Linear hash-chain construction with RFC 8785 canonicalization (SHA-256)
- Subprocess mediator with bounded streaming capture (64 KB head + 64 KB tail + content hash)
- TUI approval prompt (`/dev/tty`); CI auto-deny mode with allow-list override
- Evidence package export (independently verifiable)
- 7 Zod-validated schemas (intent, witness-event, policy, approval, execution-result, receipt, evidence-package)
- 6 ADRs documenting Phase 1 architectural decisions
- Threat model mapping to OWASP Top 10 for Agentic Applications (December 2025)
- 3 reference policy packs: `read-only-fs`, `no-network-egress`, `block-destructive`
- Hello-witness 90-second walkthrough (`examples/hello-witness/`)
- 45 unit tests (hash-chain, classifier, policy engine)
- CI workflow (Node 20, 22 matrix; type-check; style-check; schema-lint)
- Release workflow with Sigstore Cosign signing, SLSA L2 provenance, CycloneDX SBOM

### Known limitations

Documented honestly in [`docs/threat-model.md`](docs/threat-model.md):

- No third-party signatures yet — Phase 5 (Sigstore + Rekor production)
- No kernel-level mediation — Phase 5 (eBPF / ptrace)
- No prompt-injection defense — out of scope (model-layer concern)
- No remote witness chain — Phase 6 (federation)
- No identity layer — out of scope (pair with Strata-style products)

### Schema versions

All schemas at `v0.1`. Stabilization to `v1.0` targeted at end of Phase 5.

[Unreleased]: https://github.com/WitSeal/witseal/compare/v0.1.0-pre...HEAD
[0.1.0-pre]: https://github.com/WitSeal/witseal/releases/tag/v0.1.0-pre
