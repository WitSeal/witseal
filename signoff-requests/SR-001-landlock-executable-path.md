# Sign-Off Request SR-001 — Landlock: allow executable path in child ruleset

**Status:** Signed off — 2026-05-29 (Option B, ABI V1). See "Decision" below.
**Date filed:** 2026-05-25
**Requires sign-off from:** project maintainer

---

## Summary

`sandbox.rs::apply_in_child` grants `ReadFile` only within `cwd`, but does not add the spawned executable's path to the Landlock ruleset. This causes `execve("/bin/cat")` (and any other binary outside `cwd`) to be denied by Landlock with `EACCES` before the process ever starts. The sandbox is stricter than intended: the contract says "read-only within `cwd`", but the current behaviour also blocks execution of the tool binary itself.

The fix is a targeted, self-contained extension to the Landlock ruleset applied in the child. No public API changes are required; the affected surface is internal to the mediator crate.

---

## Affected files

| File | Role |
|---|---|
| `crates/witseal-mediator/src/sandbox.rs` | Landlock ruleset construction — needs change |
| `crates/witseal-mediator/tests/landlock_smoke.rs` | Smoke test — `landlock_allows_in_cwd_read` is `#[ignore]`; must be un-ignored after fix |

---

## Root cause (current code)

`apply_in_child` adds exactly one rule:

```rust
.add_rules(path_beneath_rules(&[cwd], AccessFs::from_read(abi)))
```

`AccessFs::from_read` on ABI V1 includes `ReadFile` and `ReadDir` for the `cwd` subtree only. When the kernel's ELF loader executes `execve("/bin/cat")`, it needs to read — and, for the dynamic loader and shared libraries, to map-as-executable — files outside `cwd`. Those paths have no rule, so Landlock denies them.

The handle-access line covers **all** `AccessFs` bits for the full filesystem:

```rust
.handle_access(AccessFs::from_all(abi))
```

Anything not explicitly allowed by a `path_beneath_rules` entry is therefore denied. The executable and loader paths have no entry, hence the deny.

---

## Decision (signed off — 2026-05-29)

**Option B, ABI V1.** The ruleset is extended to allow a fixed set of system
directories in addition to `cwd`, covering the dynamic loader and shared
libraries — not only the top-level binary.

### Correction 1 — system directories need READ **and EXECUTE**, not read-only

`ReadFile` alone is insufficient for dynamic linking. The loader maps shared
libraries with `mmap(PROT_EXEC)`; the kernel checks that mapping against
`LANDLOCK_ACCESS_FS_EXECUTE`. A read-only rule on the library directories
therefore still yields `EACCES` at load time. The system-directory rules must
grant **read + execute**. (Confirmed against kernel documentation and the
`landrun` project's practice.)

### Correction 2 — staying on ABI V1: the reason

The execute access bit (`LANDLOCK_ACCESS_FS_EXECUTE`) is present **already in
ABI V1**. ABI V2 adds `REFER` (cross-directory rename/link), **not** execute.
We stay on V1 because **V1 already provides both read and execute** — not to
avoid any newer-kernel requirement. Recording the correct reason so the false
premise ("execute needs V2 / kernel 5.19+") does not resurface.

### Path set (read + execute, unless noted)

- `cwd` — **read only** (unchanged; not touched).
- System set — **read + execute**: `/usr/bin`, `/bin`, `/usr/lib`,
  `/usr/lib64`, `/lib`, `/lib64`.
- `/etc/ld.so.cache` — **read only** (loader cache).
- No user directories outside `cwd`. **Write denied everywhere** (unchanged).

The exact minimal set is to be reconciled against the CI diagnosis report
before the PR is assembled — collapsing host-specific symlinks (e.g.
`/lib64` → `/usr/lib64`) so rules are not duplicated.

### This closes the three sign-off questions

- **Q1 (allow-list policy):** the system set covers the loader and shared
  libraries, not only the top-level binary.
- **Q2 (static vs dynamic `/bin/cat`):** irrelevant — the set covers dynamic
  linking either way.
- **Q3 (V1 vs V2 execute bit):** moot — the execute bit is already in V1.

---

## Behaviour change analysis

| Scenario | Before fix | After fix |
|---|---|---|
| `execve` of binary outside `cwd` (e.g. `/bin/cat`) | Denied by Landlock (`EACCES` at exec) | **Allowed to exec** via system-set read+execute, then restricted to `cwd` reads at runtime |
| Read of file inside `cwd` | Denied (exec fails before read) | Succeeds (intended behaviour) |
| Read of file outside `cwd` and outside system set (e.g. `/etc/passwd`) | Denied (exec fails before read) | Denied at read time (still blocked) |
| Write anywhere | Denied | Denied (no change) |

The sandbox becomes **less restrictive** in one narrow dimension: the executable, the dynamic loader, and shared libraries become readable and executable (required to start a dynamically linked process). No writable path outside `cwd` is opened, and no user data path outside `cwd` is opened.

---

## Why maintainer sign-off was required

1. **Security-adjacent behaviour change.** Relaxing any Landlock rule — even a narrow one — touches the threat model. The security contract is re-acknowledged by the owner.
2. **Scope of the allowed set.** The path set is fixed and minimal by intent; the exact list is reconciled against the CI diagnosis report before build.
3. **Dynamic loader coverage.** Dynamically linked executables need the loader and shared libraries reachable with read + execute (Correction 1).

---

## Next steps (after sign-off)

- [x] Maintainer confirms scope of executable path allowance — system set covering loader + libraries (Option B).
- [ ] Reconcile the exact minimal path list against the CI diagnosis report (collapse host symlinks; no duplicate rules).
- [ ] Implement changes across `sandbox.rs` and `lib.rs`: `cwd` read-only + system set read+execute + `/etc/ld.so.cache` read; query kernel ABI level and degrade gracefully on older kernels (do not panic).
- [ ] Remove `#[ignore]` from `landlock_allows_in_cwd_read`.
- [ ] Add a test: a dynamically linked binary (`/bin/cat`) executes under the sandbox; out-of-`cwd` read (`/etc/passwd`) stays blocked (`landlock_blocks_out_of_cwd_read` green).
- [ ] Run Linux CI to confirm the smoke tests pass.
- [ ] Merge to main via PR with maintainer approval. Rust-substrate hardening on the parallel hardened track, **not** a `0.1.0` release gate on the TS line.
