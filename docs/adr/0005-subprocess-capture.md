# ADR-0005: Subprocess capture mechanism

## Status

accepted (2026-05-08)

## Context

When WitSeal mediates a `shell_command` action, it spawns a subprocess and captures stdout, stderr, exit code, and side-effect signals. Design questions:

1. **Spawn API:** `child_process.spawn` with pipes, `child_process.execFile`, or a PTY (pseudo-terminal)?
2. **Argument handling:** literal argv array, or `sh -c "command string"`?
3. **Output capture:** stream-and-store, hash-only, or both?
4. **Environment isolation:** inherit env, sanitize, or explicit allow-list?

Phase 1 constraints:
- Must capture exact arguments passed to the shell (no string interpolation that obscures argv)
- stdout/stderr can be large (multi-MB build outputs); cannot fit entirely in receipts
- Some commands require a TTY (interactive tools, color output, progress bars)
- Performance budget: spawn overhead < 10 ms; capture overhead proportional to output size

## Decision

**`child_process.spawn` with explicit argv. Pipe inheritance with streaming hash + size-bounded content capture. Optional PTY mode for explicit opt-in.**

### Default mode (pipe)

```typescript
const child = spawn(executable, args, {
  stdio: ['inherit', 'pipe', 'pipe'],
  env: filteredEnv,
});
```

- `argv` is an explicit array. **No `sh -c`.** The exact executable and arguments are recorded in the witness event.
- stdout and stderr are captured via pipes
- A streaming SHA-256 hash is computed over each stream as bytes flow
- The first 64 KB and last 64 KB of each stream are stored verbatim in the receipt; the middle is replaced with a `[truncated N bytes]` marker if applicable
- Exit code and signal (if killed by signal) are recorded

### PTY mode (opt-in via `--tty` flag or `mode: "tty"` in intent)

```typescript
import { spawn as ptySpawn } from 'node-pty';
const pty = ptySpawn(executable, args, { ... });
```

- Used when the agent's intent explicitly requests a TTY (e.g., for tools that detect `isatty` and refuse to run otherwise)
- A streaming SHA-256 hash is computed over the PTY output
- Content capture is the same 64 KB + 64 KB pattern
- ANSI escape sequences are preserved in the captured content (they are part of what was actually output)

### Argument recording

The witness event records:

```json
{
  "executable": "/usr/local/bin/curl",
  "executable_resolved_via": "PATH",
  "args": ["-fsSL", "https://example.com/script.sh"],
  "cwd": "/home/user/project",
  "env_inherited": false,
  "env_keys_passed": ["PATH", "HOME", "TERM"]
}
```

**`env_keys_passed` is a list of variable names**, not values. Values may contain secrets and must not appear in evidence. The hash of the full env (sorted, canonicalized) is also stored, allowing replay verification without leakage.

## Consequences

### Positive

- **No shell injection in the argv path.** Because WitSeal spawns with explicit argv, an agent cannot construct a command string that runs unintended shell features (`;`, `&&`, backticks, `$()`). If the agent wants to chain commands, it must propose multiple actions.
- **Faithful argument recording.** The witness event records exactly what was executed. Replay can reconstruct the spawn call.
- **Bounded receipt size.** 128 KB content + hashes per execution. Receipts stay ~150 KB max even for multi-megabyte outputs. The full content can be referenced by hash if needed (Phase 5 may add a content-addressable store).
- **Streaming hash is cheap.** SHA-256 streaming on output flow is sub-millisecond per MB on modern hardware. Adds negligible overhead.
- **Env is captured by reference, not value.** Secrets in environment variables (API keys, tokens) do not leak into the evidence chain. Replay can verify env was unchanged via hash; reviewers can see *which* keys were exposed without seeing values.
- **PTY mode is opt-in.** Most coding-agent actions don't need a TTY. PTY adds a native dependency (`node-pty`), so it is dynamically loaded only when used.

### Negative / Limitations

- **No syscall-level mediation.** WitSeal observes the subprocess from outside. A subprocess can fork children, write files, open network connections that WitSeal does not directly witness. WitSeal records that the subprocess ran and its top-level outputs; it does not record everything the subprocess did. This is the boundary at Section 5.3 of `ARCHITECTURE.md`. Phase 5 introduces eBPF/ptrace for kernel-level mediation on supported platforms.
- **Output truncation loses middle content.** If a command produces 10 MB of stdout, the middle ~9.9 MB is hashed but not stored. Reviewers see the start, the end, and the hash — sufficient to confirm content if they have the original, but not sufficient to reconstruct the full output from evidence alone. Mitigation in Phase 5: optional content-addressable store for full outputs, with retention policy.
- **PTY adds a native dependency.** `node-pty` requires platform-specific native modules. Mitigation: dynamic import; PTY mode is opt-in; fall back gracefully with a clear error if `node-pty` is not installed.
- **`isatty` semantics differ in pipe mode.** A subprocess running under WitSeal's pipe mode sees `isatty(stdout)` = false. Some tools (e.g., `git diff`, `less`) change behavior accordingly. Users can opt into PTY mode if needed.

### What this does NOT provide

- **No sandboxing.** WitSeal does not run subprocesses inside namespaces, seccomp filters, or chroot. The subprocess has the same privileges as the WitSeal process. Sandboxing is out of Phase 1 scope; for high-risk actions, the *policy* should deny rather than rely on runtime containment.
- **No network capture.** Outbound HTTP requests from the subprocess are not recorded. Phase 5 may add an opt-in HTTP MITM proxy for this; very intrusive, scope-deferred.
- **No file-system-write tracking.** A subprocess that writes 50 files is recorded as one action with one witness event. The set of files modified is not enumerated. Phase 5 (kernel-level mediation) addresses this.
- **No detection of `LD_PRELOAD` or other subprocess hijack.** A malicious env can redirect dynamic linkage. WitSeal records the env keys passed; reviewers detect anomalies post-hoc, not at execution time.

These limitations are documented in `THREAT_MODEL.md`.

## Alternatives considered

### `child_process.exec` with shell string

`exec("rm -rf /tmp/foo")` — passes the string to `/bin/sh -c`.

**Why rejected:** Shell-string commands obscure argv, enable injection, and complicate replay. The witness event would record the string but not the actual argv parsed by the shell. Anti-pattern for a trust product.

### Always use PTY

Run every subprocess in a PTY for consistent `isatty` semantics.

**Why rejected:** PTY adds native dependency, has higher per-spawn overhead, and complicates output capture (PTY mixes stdout and stderr; some workflows need them separated). Pipe mode is the right default; PTY is opt-in.

### Capture full output, no truncation

Store every byte of stdout/stderr in the receipt.

**Why rejected:** Receipts can grow to hundreds of megabytes for build commands, making evidence packages unworkable. Truncation + hash is a sane tradeoff.

### Capture nothing, only hash

Record only the hash of stdout/stderr, no content.

**Why rejected:** Reviewers debugging an action need to see *some* output. The 64 KB head + 64 KB tail pattern is empirically sufficient for diagnosing most failures; full content is recoverable by replay if the original system is available.

### Use `posix_spawn` directly via FFI

Lower overhead than Node.js's `child_process`.

**Why rejected:** Adds FFI complexity for marginal performance gain. Node.js's `child_process.spawn` is already fast (sub-millisecond on modern systems); the bottleneck is `fsync` on the witness log, not spawn.

### Sandbox via `firejail` / `bubblewrap`

Wrap each subprocess in a sandbox.

**Why rejected for Phase 1:** Adds platform-specific dependencies and changes the semantics of what "the subprocess can do" — which is part of what WitSeal is recording. The policy layer (deny-by-default) is the right place for restriction in Phase 1, not runtime sandboxing. Phase 5+ may add optional sandbox modes.

## Implementation notes

Reference implementation: `src/execution/mediator.ts`.

The mediator's responsibility is narrow:

```typescript
async function mediate(intent: ClassifiedIntent): Promise<ExecutionResult> {
  const child = spawn(intent.executable, intent.args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    cwd: intent.cwd,
    env: filterEnv(intent.env),
  });

  const stdoutCapture = new BoundedStreamingCapture(64_000); // KB head + tail
  const stderrCapture = new BoundedStreamingCapture(64_000);

  child.stdout.pipe(stdoutCapture);
  child.stderr.pipe(stderrCapture);

  const exitCode = await new Promise<number>((resolve) => {
    child.on('exit', (code, signal) => resolve(code ?? -1));
  });

  return {
    exit_code: exitCode,
    stdout: stdoutCapture.summarize(),
    stderr: stderrCapture.summarize(),
    started_at: started,
    finished_at: new Date().toISOString(),
  };
}
```

`BoundedStreamingCapture` is the head+tail+hash data structure. ~50 lines.

Replay in Phase 1 does **not** re-execute commands; it reconstructs the chain head from recorded events. Re-executing would have side effects on the live system and is explicitly out of scope.
