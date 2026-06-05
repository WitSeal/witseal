# Contributing to WitSeal

Thanks for considering a contribution. WitSeal is in the early stages of becoming a useful piece of trust infrastructure for AI agents, and outside contributions help shape what it becomes.

This document is the operational guide. The project's positioning, vocabulary, and architectural principles live in [STYLE.md](./STYLE.md) and [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — please skim those first.

---

## Table of contents

- [Before you start](#before-you-start)
- [What we accept](#what-we-accept)
- [What we don't accept](#what-we-dont-accept)
- [Workflow](#workflow)
- [Development setup](#development-setup)
- [Tests, lint, type-check](#tests-lint-type-check)
- [Vocabulary discipline](#vocabulary-discipline)
- [Commit messages](#commit-messages)
- [Security disclosures](#security-disclosures)
- [Recognition](#recognition)
- [Becoming a maintainer](#becoming-a-maintainer)

---

## Before you start

For non-trivial changes, **open an issue first** to discuss the approach. This avoids the situation where you write 500 lines of code that we then ask to be reshaped.

For schema changes, cryptographic primitives, CLI surface, or process changes, **open an RFC** instead of an issue. See [docs/RFCS.md](./docs/RFCS.md). The pull request template will ask you to confirm.

For trivial changes (typo fixes, doc improvements, dependency bumps), open a PR directly.

---

## What we accept

- **Bug fixes** — with a regression test
- **Documentation improvements** — corrections, clarifications, missing examples
- **Performance improvements** — with benchmark numbers and reproducible methodology
- **New adapters** for AI coding agents (see [`src/adapters/README.md`](./src/adapters/README.md))
- **Reference policy packs** — for common scenarios not yet covered by existing examples
- **Translations** of user-facing text (after the API stabilizes; not yet)
- **Test coverage** for under-tested areas

---

## What we don't accept

- **Speculative features** without a concrete user need. Open an issue first.
- **Vendor-specific integrations** that lock WitSeal to a single provider. WitSeal is provider-independent by design.
- **Changes that broaden the wedge** — autonomous orchestration, multi-agent coordination, browser automation. These are explicitly out of scope (see [STYLE.md](./STYLE.md)).
- **Refactors without behavioral motivation** — we accept refactors when they enable a feature or fix; refactor-for-refactor's-sake creates merge conflicts and review overhead.
- **Dependencies for a single use case.** WitSeal Phase 1 has three runtime dependencies. Adding a fourth requires justification.
- **AI-generated PRs without human review** — we welcome AI-assisted contributions, but the contributor is responsible for the result. PRs that show signs of unreviewed AI generation (subtle hallucinations, fabricated APIs) will be closed.

---

## Workflow

1. **Fork the repository** and create a feature branch from `main`
2. **Make your change**, with tests where applicable
3. **Run `npm test` and `npm run typecheck` locally** — both must pass
4. **Run `npm run style-check`** to verify vocabulary discipline (see below)
5. **Open a pull request** against `main` with a clear description and a link to the related issue/RFC
6. **Respond to review feedback** — most PRs go through 1-2 review rounds
7. **Squash commits before merge** if asked — we prefer one logical commit per merged PR

CI runs on every PR (see `.github/workflows/ci.yml`):

- Tests on Node 20 and Node 22
- TypeScript strict-mode check
- Vocabulary linter (`scripts/style-check.mjs`)
- Version-consistency gate (`scripts/check-version-consistency.mjs`)
- Schema validation for example policy packs

A PR that fails CI will not be merged.

---

## Development setup

WitSeal requires **Node.js 20+**. Node 22 is recommended.

```bash
git clone https://github.com/WitSeal/witseal.git
cd witseal
npm install
npm test
```

If `npm test` passes, your environment is ready.

To run the CLI from source during development:

```bash
npx tsx src/cli/index.ts exec -- echo "hello, witness"
```

To rebuild the production bundle:

```bash
npm run build
node dist/src/cli/index.js exec -- echo "hello, witness"
```

WitSeal stores its evidence chain at `~/.witseal/` by default. Set `WITSEAL_DATA_DIR` to use a different location during development:

```bash
export WITSEAL_DATA_DIR=/tmp/witseal-dev
```

---

## Tests, lint, type-check

| Command | What it does |
|---|---|
| `npm test` | Run the full test suite (Vitest) |
| `npm run test:watch` | Watch mode |
| `npm run test:coverage` | With coverage report |
| `npm run typecheck` | TypeScript strict-mode check, no emit |
| `npm run lint` | ESLint over `src/` and `tests/` |
| `npm run lint:fix` | ESLint with auto-fix |
| `npm run format` | Prettier over `src/`, `tests/`, `schemas/` |
| `npm run style-check` | Vocabulary discipline linter |
| `npm run check:versions` | Version-consistency gate (release fail-closed) |

All of these must pass before opening a PR.

For new tests, place them in `tests/` and follow the existing naming pattern: `<module>.test.ts`. Use Vitest conventions (`describe`, `it`, `expect`).

---

## Vocabulary discipline

WitSeal is creating a category, and category creation requires consistent language. We maintain a list of canonical and avoided terms in [STYLE.md](./STYLE.md).

The `style-check` script runs in CI and on PRs. It scans Markdown files for terms in the "Avoid" column and warns. False positives happen (e.g., when quoting a competitor) — wrap them in:

```html
<!-- style-allow -->
...text containing the avoided term, e.g. discussing how a competitor positions itself...
<!-- /style-allow -->
```

Use this sparingly. The point of the linter is to catch drift, not to be defeated.

---

## Commit messages

We follow the [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>(<optional scope>): <description>

<optional body>

<optional footer>
```

Types we use:

- `feat` — new functionality
- `fix` — bug fix
- `docs` — documentation only
- `test` — test additions or corrections
- `refactor` — code change that doesn't change behavior
- `perf` — performance improvement
- `chore` — build, CI, deps, tooling
- `style` — formatting, no code change
- `revert` — reverting a previous commit

Examples:

```
feat(policy): add path_matches negation support
fix(hash-chain): handle null previous_event_hash on genesis
docs(adr): add ADR-0007 for SLSA Build Level 3 reproducible builds
test(classifier): cover edge cases in shell pattern matching
```

Keep the description under 72 characters. The body, if present, explains *why*, not *what*.

---

## Security disclosures

**Do not file public GitHub issues for security vulnerabilities.** See [SECURITY.md](./SECURITY.md) for the disclosure policy and contact channels. We follow a 90-day coordinated disclosure window.

---

## Recognition

Every accepted contributor is recognized in [CHANGELOG.md](./CHANGELOG.md) for the version where their change shipped.

Significant contributors (3+ merged PRs, or a major feature/RFC) are listed in a future `MAINTAINERS.md` and considered for maintainer rights.

We do not currently offer monetary bug bounties, but reporters of significant vulnerabilities may be invited as design partners.

---

## Becoming a maintainer

The path to maintainership is the boring one:

1. Land a few PRs that improve the project
2. Engage with reviews and discussions thoughtfully
3. Help triage incoming issues
4. Take ownership of an area (an adapter, a subsystem, a doc area)
5. Be invited

We are looking for maintainers who will be active for the long haul, not drive-by contributors. WitSeal is infrastructure — the half-life of the right decisions is years, not weeks.

If you're interested in becoming more involved earlier, open a discussion in the [Discussions](https://github.com/WitSeal/witseal/discussions) tab and tell us what you'd like to work on.

---

## Releasing

Releases follow [`RELEASING.md`](./RELEASING.md). Before a release is cut, the
**version-consistency gate** (`npm run check:versions`) must pass: the README
install pin, the `docs/CLAIM_BOUNDARY.md` "Verified against" anchor, and the
latest `CHANGELOG.md` entry must all agree with `package.json`. The gate is
fail-closed — it runs in CI, in `prepublishOnly`, and in the release workflow, so
a version drift blocks the release rather than shipping stale docs.

---

## Code of Conduct

By participating in this project, you agree to abide by the [Code of Conduct](./CODE_OF_CONDUCT.md).

---

## Questions?

For questions about contributing, open a [Discussion](https://github.com/WitSeal/witseal/discussions). For specific bugs or features, open an issue.
