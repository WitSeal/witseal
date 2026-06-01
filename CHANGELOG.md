# Changelog

All notable changes to WitSeal will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Pre-1.0 versions: schemas and CLI surface are unstable. Minor versions may introduce breaking changes; patch versions will not.

## [Unreleased]

## [0.1.3] - 2026-05-31

### Security

- **Crash-recovery integrity fix (TypeScript and Rust).** A torn final journal
  line (a write interrupted by a crash, leaving no trailing newline) is now
  healed — truncated to the last complete record — before the next append.
  Previously a torn tail followed by a subsequent append could concatenate into
  an unparseable line and invalidate the hash chain. Repeated crash-injection
  now keeps the chain valid.

### Changed

- Witness outcome model reconciliation (RFC-0003): the `no_policy_configured`
  outcome placement is clarified, and the `pending` / `execution_lost` outcomes
  are deprecated for emission by current runtimes while remaining verifiable in
  historical receipts (forward-deprecation; no schema-version bump).
- `witseal receipt show` now displays the execution mode (Gate or Witness).

### Docs

- Witness-first onboarding narrative in the README (Witness then Understand then
  Enforce), with Gate Mode reaffirmed as the deny-by-default CLI default.
- Schema-portability principle added to the claim boundary: historical receipts
  remain verifiable; future runtimes may stop emitting deprecated outcomes.

## [0.1.2] - 2026-05-31

### Added

- **Witness Mode** (`witseal exec --mode witness`): executes an action the
  policy would deny and records it under a distinct outcome `witnessed_executed`
  (or `witnessed_executed_with_error`), never conflated with a blocked
  `denied_by_policy`. Gate Mode remains the default (deny-by-default). See
  RFC-0002.
- `--mode` flag on `witseal exec`, selecting `gate` (default) or `witness`.

### Changed

- The witness-event outcome enum gains `witnessed_executed` and
  `witnessed_executed_with_error` — an additive change within
  `witseal.witness.v0.1`, with no schema-version bump; existing receipts and
  compatibility chains are unaffected (RFC-0002).
- Packaging: the npm package now ships `docs/CLAIM_BOUNDARY.md` and the starter
  `examples/policy-packs/`.

### Docs

- Claim boundary documents both execution modes (Gate and Witness); broader
  public-surface documentation hygiene.

## [0.1.1] - 2026-05-30

### Fixed

- `witseal --version` and the `witseal_runtime` field recorded in receipts now
  derive from a single source of truth (`package.json`), fixing a version-string
  drift where the published CLI could report a stale version.

### Changed

- Manifest and release-workflow hygiene: repository URL case, package `bin`
  path, npm dist-tag, and the checkout action version.

## [0.1.0] - 2026-05-30

First general-availability release of the WitSeal Phase 1 CLI, published to npm
as `@witseal/cli@0.1.0` with Sigstore Cosign signatures and SLSA provenance.

### Added

- `witseal receipt show` — display a single execution receipt (v0.1 or v0.2).
- `witseal unlock` — remove an orphaned chain lock left by a crashed process.
- Signed execution receipts (`witseal.receipt.v0.2`): Ed25519 signature plus
  build-provenance fields, alongside the existing v0.1 receipts.
- Named tamper detection over the hash chain, classifying `content`, `linkage`,
  and `sequence` divergence, surfaced through `witseal verify`.

### Changed

- `witseal verify` discriminates receipt schema version (v0.1 / v0.2) and
  evidence packages; v0.2 verification checks the Ed25519 signature, with
  `--public-key` for the verifying key.
- README quickstart corrected to the canonical `witseal exec` invocation and an
  honest deny-by-default walkthrough.

### Fixed

- Lockfile compatibility shim for Node 20 through 23.

## [0.1.0-pre] - 2026-05-12

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

[Unreleased]: https://github.com/WitSeal/witseal/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/WitSeal/witseal/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/WitSeal/witseal/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/WitSeal/witseal/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/WitSeal/witseal/compare/v0.1.0-pre.4...v0.1.0
[0.1.0-pre]: https://github.com/WitSeal/witseal/releases/tag/v0.1.0-pre
