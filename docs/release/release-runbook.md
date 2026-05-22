# WitSeal Release Runbook

**Status:** DRAFT v0.1
**Date:** 2026-05-22
**Owner:** WitSeal PdM
**Scope:** Phase 1 three-artifact release procedure under RFC-003

## Purpose

This runbook defines the ordered procedure for publishing one WitSeal product
release across the Rust, TypeScript, and Python registries. It operationalizes
RFC-003 release ordering, build synchronization, founder-gated publication, and
partial-publication recovery.

## Sections

1. Release definition
2. Publication procedure
3. Rollback procedures
4. Partial publication and failure handling
5. Cross-references
6. Version history

## Release Definition

A WitSeal release at product version `X` consists of three registry artifacts at
the same version:

| Track | Artifact | Registry |
|---|---|---|
| Rust | `witseal-rs` cargo crate | crates.io |
| TypeScript | `@witseal/cli` npm package | npm |
| Python | `witseal-py` wheel and sdist | PyPI |

Each artifact has its own SLSA attestation from its own build pipeline. The
three attestations remain independent; the release is complete only when all
three version-`X` artifacts are published with their attestations.

Until that state is reached, version `X` is **in progress**, not a complete
WitSeal release. A release manager MUST NOT describe a one-artifact or
two-artifact publication as a complete WitSeal release.

## Publication Procedure

Follow this procedure for one product version `X`.

1. Establish the release candidate.
   - Record the product version `X`.
   - Confirm each track is preparing the same product version string.
   - Confirm each release note set states the supported wire-format schema
     version or versions for that artifact.
2. Confirm the release coordination gate.
   - Verify Rust, TypeScript, and Python CI are green.
   - Verify all three tracks passed the same conformance corpus version at
     product version `X`.
   - Verify the intended artifacts are built and the planned publication path
     will produce the required SLSA attestation for each artifact.
3. Obtain the founder release authorization before any publication command.
   - Request explicit founder authorization for "release version `X`".
   - Record that authorization in the release record before running
     `cargo publish`, `npm publish`, or any PyPI upload/publish command.
   - Stop if authorization is absent. DR-0007, DR-0008, and RFC-003 do not
     permit autonomous publication of a real release.
   - Do not confuse defensive namespace reservation with release publication;
     RFC-003 treats namespace reservation as separate from publishing a real
     release artifact.
4. Publish Rust first.
   - From the Rust release context, publish `witseal-rs` version `X` to
     crates.io with the authorized Rust publication procedure, including the
     `cargo publish` step.
   - Record the published crate version, registry result, artifact digest, and
     SLSA attestation reference.
   - Stop the ordered publication flow if Rust publication fails.
5. Re-run the TypeScript and Python release conformance checks against the
   published Rust corpus.
   - Use the corpus from the actually published Rust artifact, not only a
     pre-publication build.
   - Confirm the TypeScript result is green before npm publication.
   - Confirm the Python result is green before PyPI publication.
   - Stop if either check diverges. Fix the divergence before publishing the
     dependent artifact.
6. Publish TypeScript and Python after the Rust-corpus checks pass.
   - Publish `@witseal/cli` version `X` to npm through the authorized npm
     publication path, including the `npm publish` step used by that path.
   - Publish the `witseal-py` wheel and sdist for version `X` to PyPI through
     the authorized Python publication path.
   - TypeScript and Python MAY publish in either order after their checks pass.
7. Record the complete publication set.
   - Record the three registry URLs or package coordinates for version `X`.
   - Record each artifact digest and each SLSA attestation reference.
   - Confirm that the release record shows all three artifacts at the same
     product version.
8. Announce only after completion.
   - Confirm all three artifacts and attestations are present.
   - Confirm no partial-publication failure remains open.
   - Obtain or reference the founder authorization that covers the release
     announcement, then announce version `X`.

## Rollback Procedures

Registry rollback is not transactional. Use the procedure for the registry that
already received a version-`X` artifact, then return to the partial-publication
procedure below.

### crates.io

Use crates.io yanking when a published `witseal-rs` crate version must be
withdrawn from new resolution.

1. Confirm the affected crate and version `X`.
2. Yank the version with Cargo from an authenticated owner context:

   ```bash
   cargo yank witseal-rs@X
   ```

3. Record the yank result in the release record.
4. Publish a corrected version rather than attempting to overwrite version
   `X`.

Yanking removes the crate version from normal new dependency selection but does
not delete the crate data. Existing lockfiles and direct downloads may still
refer to the yanked version. If secrets were published, yanking is not a secret
revocation mechanism; rotate the affected secrets immediately and follow the
security incident path.

### npm

Use npm single-version unpublish only when the current npm unpublish policy
allows it for `@witseal/cli@X`.

1. Confirm the affected package and version `X`.
2. If npm policy permits unpublishing that version, unpublish the single version:

   ```bash
   npm unpublish @witseal/cli@X
   ```

3. Record the unpublish result. Do not expect version `X` to become reusable.
4. If npm policy does not permit unpublish, deprecate the bad version with a
   clear message and publish a corrected version:

   ```bash
   npm deprecate @witseal/cli@X "<withdrawal reason and replacement version>"
   ```

For the public npm registry policy checked for this draft, a newly created
package may be unpublished during the first 72 hours when no other public npm
package depends on it. After 72 hours, unpublish requires all currently stated
npm criteria: no dependents in the public registry, fewer than 300 downloads in
the previous week, and a single owner or maintainer. npm states that an
unpublished `package@version` cannot be reused and that unpublish cannot be
undone.

### PyPI

Prefer PyPI yanking for a bad `witseal-py` release.

1. Confirm the affected PyPI release version `X`.
2. Open the PyPI release management page for `witseal-py`.
3. Yank the entire version-`X` release and provide a clear yank reason.
4. Record the yank result and publish a corrected version when ready.

PyPI yanking is release-wide for the current PyPI behavior: it does not yank
individual files inside a release. A yanked release is ignored by installers
unless it is the only release that matches an exact `==` or `===` version
specifier. PyPI also exposes deletion actions, but deletion is permanent and
disruptive to pinned installations; use deletion only when the release manager
has explicitly chosen that destructive recovery path.

## Partial Publication And Failure Handling

A partial publication is a failed state, not a WitSeal release.

1. Stop any release announcement.
2. Record exactly which version-`X` artifacts reached which registries and
   which publication step failed.
3. Choose one recovery path:
   - Fix the failure and complete the remaining ordered publication steps for
     version `X`.
   - Withdraw the already-published artifact or artifacts through the registry
     rollback procedures above, then prepare and publish a corrected release
     version.
4. Preserve the release record for the failed partial state, including the
   founder authorization, registry results, rollback results, and follow-up
   version decision.

If Rust published but npm or PyPI publication fails, do not announce the Rust
artifact alone as a WitSeal release. If Rust must be withdrawn, use the
crates.io rollback procedure. If npm or PyPI published before the other
post-Rust artifact failed, use the matching npm or PyPI rollback procedure
before re-release unless the chosen recovery path is to fix and complete the
same version where registry rules still allow that path.

## Cross-References

- RFC-003, Cross-Track Build & Release, especially sections 4 through 6.
- DR-0007, WitSeal Public Launch, for public launch and release-governance
  context.
- DR-0008, Rust Parallel Implementation Track, especially D5 publication
  gates.
- D1 v0.3, Phase 1 Definition of Done, especially section 3.1 closure gate.

## Version History

| Version | Date | Author | Changes |
|---|---|---|---|
| v0.1 | 2026-05-22 | Codex | Initial draft of the RFC-003 three-artifact release runbook. |
