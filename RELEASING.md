# Releasing WitSeal

WitSeal publishes the `@witseal/cli` package to npm with Sigstore signatures and
SLSA provenance. This runbook is the release procedure. It is deliberately
explicit and fail-closed: a release that would ship documentation out of sync
with the published version does not proceed.

## Version-consistency gate (fail-closed)

WitSeal dogfoods its own discipline. A release declares a version; the
**version-consistency gate** verifies — fact, not assumption — that every
user-facing version anchor agrees with `package.json` before anything is
published. If an anchor has drifted, the release is blocked. This is the
deny-by-default posture applied to publishing.

```bash
npm run check:versions
```

The gate (`scripts/check-version-consistency.mjs`) checks, against
`package.json` "version":

1. **`CHANGELOG.md`** — the latest released `## [x.y.z]` heading (`[Unreleased]`
   is skipped).
2. **`README.md`** — the `npm install -g @witseal/cli@x.y.z` install pin (and the
   "Install the `x.y.z` CLI" prose).
3. **`docs/CLAIM_BOUNDARY.md`** — the `Verified against: \`@witseal/cli@x.y.z\``
   anchor.
4. **Sweep** — every `npm install -g @witseal/cli@x.y.z` pin in tracked `*.md`
   files (templated `${{ }}` pins are skipped).

Exit codes: `0` consistent, `1` drift (release blocked), `2` script error.

The gate runs in three places so drift cannot reach a published artifact:

- **CI** (`.github/workflows/ci.yml`) on every pull request — drift never lands.
- **`prepublishOnly`** in `package.json` — `npm publish` / `npm pack` run it
  first.
- **Release workflow** (`.github/workflows/release.yml`) before the npm publish
  step — a tag build fails closed on drift.

## Release procedure

1. **Decide the version** (`x.y.z`, semver; pre-`1.0` minors may break).
2. **Bump `package.json`** `"version"` to `x.y.z`.
3. **Update `CHANGELOG.md`**: move the `[Unreleased]` entries under a new
   `## [x.y.z] - <date>` heading and refresh the compare links.
4. **Update the version anchors** to `x.y.z`:
   - `README.md` install pin and "Install the `x.y.z` CLI" prose;
   - `docs/CLAIM_BOUNDARY.md` `Verified against:` line (reconcile honestly — do
     not claim coverage that was not verified at `x.y.z`).
5. **Run the gate and the suite locally** — all must pass:
   ```bash
   npm run check:versions
   npm run typecheck
   npm test
   npm run build
   ```
6. **Open a pull request**; merge once CI is green (CI runs the gate).
7. **Tag the release** on `main`: `git tag vx.y.z && git push origin vx.y.z`.
   The tag triggers `.github/workflows/release.yml`, which runs the gate, then
   publishes to npm with provenance, signs the artifacts with Sigstore, generates
   SLSA provenance, and creates the GitHub release.

Tagging, npm publish, and GitHub release creation are irreversible publishing
actions and require the appropriate credentials (`NPM_TOKEN`) and authorization.

## If the gate fails

Align every anchor it reports to the `package.json` version (or correct
`package.json`), then re-run `npm run check:versions`. Historical references
(past `CHANGELOG.md` entries, RFC version mentions, schema provenance comments)
are not install pins and are not flagged.
