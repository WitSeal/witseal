<!--
Thanks for contributing to WitSeal.

Before opening this PR, please make sure you have:
- Read CONTRIBUTING.md
- Discussed non-trivial changes in an issue or RFC first
- Run `npm test`, `npm run typecheck`, `node scripts/style-check.mjs` locally
-->

## What

<!-- One paragraph describing the change. -->

## Why

<!-- Link to the issue or RFC this addresses. -->

Refs / Fixes #

## How

<!-- Brief description of the approach taken. Skip if obvious from the diff. -->

## Checklist

- [ ] Tests added or updated (or explicitly N/A with reason)
- [ ] Documentation updated (README, ADR, or inline) if behavior changed
- [ ] `npm test` passes locally (45+ tests)
- [ ] `npm run typecheck` passes
- [ ] `node scripts/style-check.mjs` passes (vocabulary discipline)
- [ ] Commits follow [Conventional Commits](https://www.conventionalcommits.org/) format
- [ ] Commits are signed off (`git commit -s`) per DCO
- [ ] This change does **not** modify schemas, cryptographic primitives, or CLI surface (if it does, an RFC is required first per [docs/RFCS.md](../docs/RFCS.md))
- [ ] If this change has user-visible effects, [CHANGELOG.md](../CHANGELOG.md) is updated under `[Unreleased]`
