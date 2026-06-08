# Changelog

All notable changes to WitSeal will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Pre-1.0 versions: schemas and CLI surface are unstable. Minor versions may introduce breaking changes; patch versions will not.

## [Unreleased]

### Added

- **`witseal connect`** — one-command MCP-client setup. Auto-configures Claude
  Desktop, Claude Code, or Cursor to use the WitSeal MCP server (the witnessed
  `shell` tool); idempotent (never clobbers other servers), witness-mode by
  default, and scaffolds a starter policy pack under the data dir. Use `--print`
  to preview and `--mode gate` to enforce.

## [0.4.0] - 2026-06-07

> Expanded adapter coverage and release-process hardening. WitSeal adds witnessed
> execution for a broad set of agent frameworks, a forward-compatible verifier,
> and a fail-closed version-consistency release gate. All additive over the
> existing pipeline — no wire-format change, golden receipt byte-identical, no
> schema-version bump.

### Added

- **New framework adapters** (Witnessed Execution, scoped to the witnessed tool):
  GitHub Copilot SDK, Microsoft Agent Framework (Python), Mastra, Kilo Code,
  CrewAI, PydanticAI, Google ADK, AWS Strands, and AutoGen. Each routes the
  WitSeal-authored tool through `runExec` and emits an independently verifiable
  receipt; coverage is scoped to that tool, not the framework's other execution.
- **Release version-consistency gate** (`npm run check:versions`,
  `scripts/check-version-consistency.mjs`): a fail-closed check that the README
  install pin, the `docs/CLAIM_BOUNDARY.md` "Verified against" anchor, the
  `CHANGELOG.md` latest release, `package.json`, and `package-lock.json` all
  agree. Wired into CI, `prepublishOnly`, and the release workflow. See
  [`RELEASING.md`](./RELEASING.md).

### Changed

- **Verifier preserves unknown additive fields** in the receipt hash preimage, so
  receipts that carry forward-compatible additive fields stay verifiable across
  versions. The golden receipt is unchanged.
- Documentation scopes framework "Full Execution Coverage" to the witnessed tool,
  with live-verified receipts cited; the SLSA level is unified to "SLSA Build
  Level 3".

### Docs

- Public-surface hygiene: competitive positioning generalized to neutral
  categories, the competitive-comparison document removed, and the public
  sanitary-barrier workflow scrubbed of internal markers.

## [0.3.0] - 2026-06-03

> File execution and full execution coverage. WitSeal can now mediate file
> writes (not only shell), the OpenHands adapter reaches full execution coverage
> of its default toolset, and the Cursor witness adapter ships. All additive over
> the existing pipeline — no wire-format change, golden receipt unchanged, no
> schema-version bump.

### Added

- **File execution path** (`witseal exec-file`). A `file_write` action is driven
  through the same pipeline as shell (classify → policy → mediate → witness →
  receipt) via the new `runFileExec` → `mediateFile`, reusing the existing
  execution-result and witness schemas. Write modes: `overwrite`, `append`,
  `create_only`; content is read from stdin. Additive only — no new wire-format,
  and the golden receipt is byte-identical.
- **OpenHands adapter — full execution coverage.** The agent's `terminal` and
  `file_editor` tools (plus `apply_patch` / `planning_file_editor` for presets
  that grant them) are wrapped to route through `witseal exec` / `witseal
  exec-file`, so WitSeal owns execution and emits a full receipt for the default
  granted toolset. `browser` and `task_tracker` are excluded from the witnessed
  set; `apply_patch` DELETE/MOVE and `file_editor` undo are refused (not silently
  bypassed), since file delete/rename is outside the file-write model.
- **Cursor witness adapter** — *Witness (Level 2)*. A `PostToolUse` hook
  (`witseal-witness-cursor`) records Cursor's host-reported execution as a
  witness event; observe-only, does not execute. Promotes Cursor from *planned*
  to shipped. Export `@witseal/cli/adapters/cursor`.

### Docs

- **Coverage terminology** (`docs/integrations.md`): the execution-coverage axis
  is framed as **Full Execution Coverage** (WitSeal owns execution → full
  receipt) versus **Tool-Scoped Coverage via MCP** (the host agent/runtime
  executes; only operations called through the WitSeal MCP tool are witnessed),
  with an explicit "who executes" line per surface. Adds the three-tier Witnessed
  Execution model, guidance on multiple surfaces over one evidence core, and
  orders the WitSeal MCP server first among own-execute integrations.

## [0.2.0] - 2026-06-02

> This release is the integration wave: WitSeal gains first-class adapters across the agent
> ecosystem, all over the existing `runExec` pipeline with no wire-format change
> (golden receipt unchanged; no schema-version bump).

### Added

- **Integration adapters (the witnessed-execution wave).** Each brings an agent's
  shell actions through the WitSeal pipeline (classify → policy → mediate →
  witness → receipt) and is documented in `docs/integrations.md` with its level:
  - **OpenCode** — *Witnessed Execution (Level 3)*. A custom `bash` tool that
    shadows the built-in and own-executes via `runExec`; pinned to a tagged
    OpenCode release. Export `@witseal/cli/adapters/opencode`.
  - **WitSeal MCP server** (`witseal-mcp`) — *Witnessed Execution (Level 3),
    host-independent*. Exposes WitSeal's witnessed `shell` tool over the Model
    Context Protocol (newline-delimited JSON-RPC over stdio) so any MCP client
    gets witnessed execution. Export `@witseal/cli/adapters/mcp`.
  - **LangGraph** and **OpenAI Agents SDK** — *Witnessed Execution (Level 3)*.
    Author-the-tool shims over a shared `mediateShellCommand` core. Exports
    `@witseal/cli/adapters/langgraph`, `.../openai-agents`, `.../framework`.
  - **Temporal** — *Witnessed Execution (Level 3)* via a `witnessedShell`
    Activity that own-executes through `runExec`, plus an optional
    `ActivityInboundCallsInterceptor` for *Witness (Level 2)* observation of
    activities you do not own. Export `@witseal/cli/adapters/temporal`.
  - **Claude Code** — *Witness (Level 2)*. A `PostToolUse` hook
    (`witseal-witness-claude-code`) that records the host-reported result as a
    witness event; observe-only, does not execute. Export
    `@witseal/cli/adapters/claude-code`.
- New executables: `witseal-mcp`, `witseal-witness-claude-code`.
- New package export subpaths for every adapter (`./adapters/*`).

### Changed

- **Risk classifier shell-bypass hardening** (`CLASSIFIER_VERSION` `1.0` → `1.1`):
  nested interpreters (`sh -c`, `eval`, `python -c` / `node -e`) and pipe-to-shell
  are elevated so opaque execution is not under-classified. The classifier
  version is recorded in evidence and is decoupled from the golden receipt.

### Security

- Network/encoded payloads piped to a shell (`curl … | sh`, `base64 -d … | sh`)
  are now classified as remote/opaque execution (C4), closing a shell-bypass
  under-classification gap. Policy can still allow such commands explicitly.

### Docs

- **Integrations & capability matrix** (`docs/integrations.md`): the Gate /
  Witness / Witnessed Execution ladder, source-of-trust framing, and
  per-integration status for all seven adapters (Cursor and Codex listed as
  planned Witness integrations).
- Per-adapter READMEs under `src/adapters/*` with install shims and the
  never-bypass / deny-by-default notes.

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
- Release workflow with Sigstore Cosign signing, SLSA Build Level 3 provenance, CycloneDX SBOM

### Known limitations

Documented honestly in [`docs/threat-model.md`](docs/threat-model.md):

- No third-party signatures yet — Phase 5 (Sigstore + Rekor production)
- No kernel-level mediation — Phase 5 (eBPF / ptrace)
- No prompt-injection defense — out of scope (model-layer concern)
- No remote witness chain — Phase 6 (federation)
- No identity layer — out of scope (pair with identity gateway products)

### Schema versions

All schemas at `v0.1`. Stabilization to `v1.0` targeted at end of Phase 5.

[Unreleased]: https://github.com/WitSeal/witseal/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/WitSeal/witseal/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/WitSeal/witseal/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/WitSeal/witseal/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/WitSeal/witseal/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/WitSeal/witseal/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/WitSeal/witseal/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/WitSeal/witseal/compare/v0.1.0-pre.4...v0.1.0
[0.1.0-pre]: https://github.com/WitSeal/witseal/releases/tag/v0.1.0-pre
