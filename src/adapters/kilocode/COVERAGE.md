# Coverage — Witnessed execution for Kilo Code

**Scope: Full execution coverage of the witnessed `bash` tool.**

This adapter ships one WitSeal-authored tool: a same-name `bash` tool module
(default export) that Kilo Code's OpenCode-fork registry resolves in place of the
built-in `bash` (last-writer-wins on tool id). Its `execute` routes every command
through WitSeal's mediation core (`mediateOpenCodeBash` → `runExec`: classify →
policy → mediate → witness → receipt). When this module is the `bash` the agent
runs, every shell command it issues is a real, independently verifiable witnessed
execution. It reuses the existing execution-result / witness schema (no new
wire-format); the golden receipt is untouched.

## What is and is not witnessed

WitSeal witnesses the **authored tool it owns and executes** (own-execute). This
is the same honesty ceiling as the OpenHands and OpenCode adapters: the witness
boundary is the tool body, not the framework, not the host, and not the model.

In scope (witnessed):

- Every command the agent runs through this `bash` tool. The tool body is the
  execution path, so the bytes that run are the bytes WitSeal mediates, and each
  call yields a full execution receipt (`allowed_executed`, or `denied_by_policy`
  when a Gate denial blocks it).

Out of scope (NOT witnessed):

- Kilo Code host internals, the model/LLM, prompt handling, the editor/host
  process, and agent control flow. This is **not** a claim over all host traffic.
- Any **other** execution-capable tool you also register or leave enabled. If a
  second shell / code-exec / file-write tool remains available, that tool opens
  an unattested execution path and the Full-coverage claim no longer holds.
- Side effects the command itself spawns out of band (e.g. a daemon it launches).

## How to keep coverage Full

The shadow only covers `bash`, so compose the toolset so this `bash` **is** the
execution path:

- Ensure this module is the last writer for tool id `bash` (drop it into the
  config or project tool dir so it overwrites the built-in).
- Do **not** leave another raw shell / code-exec / file-write tool enabled — that
  reintroduces an unwitnessed path.
- Run in `gate` mode (deny-by-default) for enforcement, or `witness` mode for
  observe-only attestation.

## Override (shadow) status — honest

- **Source-confirmed.** Kilo Code's engine is an OpenCode fork; in the
  OpenCode-fork registry a custom tool whose id matches a built-in takes
  precedence (last-writer-wins). The shipped OpenCode adapter relies on the same
  property. This adapter ships the same-name `bash` default-export module to
  occupy that seam.
- **Runtime shadow NOT observed headlessly.** Kilo Code is distributed as an
  editor extension and needs the editor host plus a model key to drive the
  registry end-to-end; there is no published headless agent CLI that loads a tool
  dir and resolves `bash` without those. So a live model-driven shadow was not
  exercised in this build. This is stated rather than fabricated.

## Live verification receipt (this build)

The **execution path** was exercised by invoking this tool's body **directly**
(no LLM) on a real command under a throwaway `/path/to/tmp` data dir with a
single allow-rule policy pack, mediated through `mediateOpenCodeBash` exactly as
the tool's `execute` does. The run produced a full execution receipt that
`witseal verify` confirms **VALID**. The verbatim `witseal verify` output and the
receipt id are recorded with the build that integrates this adapter.

## Verdict

For the witnessed execution surface (commands through this `bash` tool),
coverage is **Full of the witnessed tool** by fact: every executed command is
witnessed with a verifiable receipt, the tool never bypasses the boundary (the
command runs only via `runExec`), a Gate denial blocks and is recorded rather
than silently bypassed, and the live invocation produced a receipt that `witseal
verify` confirms **VALID**. The claim is scoped to a session where this `bash`
tool is the execution path — it is not a claim over a configuration that also
enables an unwitnessed built-in or custom execution tool, nor over Kilo Code host
internals. The golden receipt is untouched and the CLI was used unchanged.
