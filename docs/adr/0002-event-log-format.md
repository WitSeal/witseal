# ADR-0002: Event log format

## Status

accepted (2026-05-08)

## Context

The witness event log is the canonical state of WitSeal evidence. Every action produces exactly one event; the chain head is derived from the log. Design questions:

1. **File format:** JSON Lines (JSONL), binary (e.g., Protobuf, MessagePack), or a database (SQLite)?
2. **Storage layout:** single file, multiple files per segment, or per-day rotation?
3. **Append semantics:** how is append-only enforced at the filesystem layer?

Phase 1 constraints:
- Single-node, local-first
- No daemon, no server, no DB process
- Verifier must read the log without WitSeal-specific tooling (curl, cat, jq)
- Append-only by design (see ADR-0001)
- Performance budget: log write contributes < 5 ms to p99 mediation

## Decision

**JSON Lines (JSONL) in a single append-only file per chain segment.**

- One event per line, terminated by `\n`
- Each line is a complete, self-contained JSON object conforming to the `WitnessEvent` schema
- File path: `~/.witseal/events/<chain-segment-id>.jsonl`
- Default chain segment ID is `default`; multiple segments are allowed (forward-compatible with Phase 6 federation)
- File is opened in append mode (`O_APPEND`) and `fsync`-ed after each write
- File is never edited or rewritten — segment rotation produces a new file

The chain head is **derived from the log**, not stored separately. On startup, WitSeal reads the last line of the log to determine the current chain head. A small head cache (`~/.witseal/events/<segment-id>.head`) is maintained for performance but is verifiable against the log.

## Consequences

### Positive

- **Universal toolability.** `cat`, `tail`, `jq`, `grep`, `wc -l`, `head` all work. Anyone debugging WitSeal can use standard Unix tools without learning a binary format.
- **Streamable verification.** A verifier reads line-by-line, hashes each, advances the chain. No format-specific parser needed.
- **No database lock contention.** A single append-only file with `O_APPEND` is the simplest concurrency primitive in POSIX. (Concurrency itself is restricted to single-writer; see ADR-0006.)
- **Backup-friendly.** `cp`, `rsync`, snapshots all work without coordination.
- **Append is atomic on POSIX** for writes ≤ `PIPE_BUF` (typically 4096 bytes). Most witness events fit; oversized events use a write-then-rename pattern (see implementation notes).
- **Schema-validated.** Every line is parsed and validated against the `WitnessEvent` Zod schema on read. Corrupted or schema-violating lines fail loudly.
- **Forward-compatible with future phases.** JSONL → ndjson → JSON-LD is a natural progression if semantic web integration becomes valuable. Binary formats lock in early.

### Negative / Limitations

- **Storage size.** JSONL is verbose vs Protobuf (~3-5x larger). Acceptable for Phase 1 — a developer logging 10K events/day at ~1 KB each consumes ~10 MB/day, ~3.6 GB/year. Disk is cheap; verification simplicity wins.
- **No structured indexing.** To find "all events with risk_class=C4 in March," you scan the file. Acceptable for Phase 1 single-developer workloads. Phase 4+ may add SQLite as a derived index (the JSONL log remains canonical).
- **Per-line parsing cost.** ~50-100 µs per line for JSON parse + Zod validation. Within budget; not a bottleneck.
- **Atomic-append assumption.** Writes >`PIPE_BUF` bytes are not guaranteed atomic. Mitigation: events are bounded to ~4 KB by schema. Larger payloads (stdout, stderr) are content-addressed by hash, not embedded.

### What this does NOT provide

- **No mid-log redaction.** Once an event is written, it cannot be removed without breaking the chain. This is intentional — silence is not consent — but it has GDPR implications for any field containing personal data. Schema design must avoid PII fields; if PII appears in stdout/stderr, the *hash* is in the receipt, not the content. A separate "evidence redaction" workflow may be needed in Phase 5+ for regulated environments.
- **No automatic compression.** Files grow linearly. Compression is left to the OS (filesystem-level) or to off-line archival of old segments.

## Alternatives considered

### SQLite database

A single `events.db` file with one row per event.

**Why rejected:** SQLite adds a binary dependency (~1 MB), introduces lock semantics that complicate concurrency reasoning, and makes the log no longer trivially inspectable with Unix tools. The benefit (queryable index) is not needed in Phase 1. Reconsider for Phase 4 as a *derived* index on top of the canonical JSONL.

### Protobuf / MessagePack

Binary serialization for compactness and speed.

**Why rejected:** Loss of toolability. A verifier needs WitSeal-specific tooling to read the log. For a *trust* product, opacity is anti-pattern. The 3-5x size reduction is not worth it for Phase 1 workloads.

### Single events file with mtime-based rotation (per-day files)

`~/.witseal/events/2026-05-08.jsonl`, rotated daily.

**Why rejected:** Rotation introduces chain-segment boundary semantics that complicate verification (which file contains the previous_event_hash for the first event after rotation?). Phase 1 uses a single file; rotation, if added, must be an explicit `witseal rotate` operation that produces a sealed segment + new genesis event.

### Hybrid: JSONL events + SQLite derived index

Both a JSONL file (canonical) and a SQLite index (queryable).

**Why rejected for Phase 1:** Two storage layers means two consistency models. The risk of index drift (where the SQLite says X but the log says Y) is exactly the failure mode WitSeal exists to prevent. Build the index in Phase 4 if and only if query workloads demand it.

### Append to a transparency log directly (Rekor-style)

Skip local storage; every event goes straight to Sigstore Rekor.

**Why rejected:** Network dependency in the hot path violates the "no network calls in mediation" constraint. Phase 5 will *additionally* upload chain segments to Rekor for transparency, but the local JSONL remains canonical and online-independent.

## Implementation notes

Reference implementation: `src/witness/event-log.ts`.

Key invariants enforced by the implementation:

```typescript
// Open with O_APPEND so writes are at end-of-file even with concurrent readers
const fd = fs.openSync(path, 'a');

// Write the line, fsync, only then update the in-memory chain head
fs.writeSync(fd, JSON.stringify(event) + '\n');
fs.fsyncSync(fd);
```

`fsync` is non-negotiable: without it, a power loss between `write` and the OS flush can produce a file shorter than the in-memory chain head, breaking the invariant that the log is the source of truth.

Read path is forward-only:

```typescript
async function* readEvents(path: string): AsyncIterable<WitnessEvent> {
  const stream = createReadStream(path);
  const rl = readline.createInterface({ input: stream });
  for await (const line of rl) {
    if (line.trim()) yield WitnessEventSchema.parse(JSON.parse(line));
  }
}
```

Schema validation is performed on read, not write — write-side validation is the caller's responsibility (the code that constructed the event), and the canonical type system enforces it at compile time.

## Recovery semantics

On startup, WitSeal performs:

1. Read the last line of the log; this is the recorded chain head.
2. Read the head cache file; if present, compare to recorded head.
3. If they match, proceed normally.
4. If they don't match, the head cache is stale or corrupted. Recompute by reading the entire log. If the recomputed head doesn't match either side, the runtime starts in **read-only mode** and surfaces an integrity error.

This is the failure mode described in `ARCHITECTURE.md` Section 7.4.
