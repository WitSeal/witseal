# WitSeal MCP Witness — SPIKE technical note (github-mcp, one server, no-canon)

**Status: SPIKE (value probe). Not an MVP, not a product, not a shipped adapter.**
Branch only; not merged. No schema / receipt-canon / golden change.

## Question
Can WitSeal wrap a *real* MCP tool call and issue a *verifiable* receipt **without**
changing the receipt canon, the golden vector, or the roadmap?

## Answer: yes — demonstrated live against github-mcp.

## What was built
- `witness-github-mcp.mjs` — a minimal MCP **stdio client** to ONE downstream
  server (`ghcr.io/github/github-mcp-server`, official image). It performs ONE
  safe, **read-only** tool call (`get_me`), and emits a **hash-only** record of
  the MCP tool-call boundary (tool name, SHA-256 of canonical input, SHA-256 of
  canonical output, `is_error`, negotiated protocol). No payloads, no token, are
  printed or stored.
- The harness is run **through the existing `witseal exec`** pipeline, so WitSeal
  witnesses it as an ordinary `shell_command` execution and issues a normal
  **execution receipt**. The harness's exit code carries the MCP `isError`
  status (0 = ok, 1 = isError), so the receipt's outcome reflects the call.

No WitSeal source, schema, or test was modified. The harness lives under `spike/`.

## Result (live, this machine)
- Witnessed call: `get_me` on github-mcp v1.1.2, transport stdio, protocol `2025-06-18`.
- WitSeal outcome: **`allowed_executed`** (Gate mode, deny-by-default + an allow
  policy pack for `shell_command`).
- **`witseal verify` → VALID ✓** (chain; 2 events: `pending` → `execution_complete`).
- Receipt: `witseal.receipt.v0.1` — the **existing** 8-field execution receipt.
  No new fields. See `example-witnessed-call.json`.
- **golden `8fc29592…` (1050 bytes) byte-identical before and after.**

## Where the MCP metadata lives (the no-canon part)
Two premises in the order did not hold by fact, and the spike routed around both
without any canon change:
- **There is no `tool_call` intent** — it is only a *planned* comment
  (`schemas/intent.schema.ts:30`, "Future types: tool_call (Phase 4)"). The
  union is `shell_command` / `file_write` / `file_read`. The spike therefore
  represents the MCP call through the existing `shell_command` execution receipt.
- **There is no `metadata` / `experimental` field in any WitSeal schema.** Putting
  MCP metadata *inside* the canonical receipt would be a schema/canon change.
  Instead, `metadata.experimental.mcp` is emitted as a **hash-only SIDECAR**
  alongside the verbatim canonical receipt (`example-witnessed-call.json`) —
  explicitly **NOT canon**, never hashed, never affecting `receipt_hash` or verify.

## Honesty ceiling (do not overclaim)
The receipt witnesses the **MCP tool-call boundary** — which server (as
configured), which tool, the input hash, the output hash, and `isError` (what
passed through the WitSeal-driven client). It does **NOT** witness the github-mcp
server's internal execution (MCP servers cannot see into one another). The honest
claim is *"proof of the MCP tool call WitSeal mediated"*, not *"proof of what the
server did internally"* and not *"we see all your MCP traffic"* (only calls routed
through this client).

## Token / secret hygiene
The GitHub token is read from a `chmod 600` file (removed after the run); only the
file **path** appears in the receipt, never the token. WitSeal's mediator forwards
only an env allowlist (`PATH`, `HOME`, …) to mediated commands and does **not**
forward the token — confirming the receipt cannot capture it. Input/output are
hash-only.

## Conclusion — go to Gateway, or keep as candidate?
**Keep as a validated candidate; do not build the gateway yet.** The spike proves
the value question (a real MCP call yields a verifiable, tamper-evident receipt
with zero canon cost). The architectural consequences of going further:

1. **First-class MCP provenance in the receipt** (queryable `mcp_server` / tool /
   io fields) → a **receipt-canon change** (RFC + both-track signature + golden
   migration). The spike shows this is **not required** to deliver value — the
   sidecar suffices for a probe, and the existing receipt already proves the call.
2. **A cleaner intent shape** would use the planned `tool_call` intent (Phase 4) —
   additive and golden-safe (like `exec-file` reused `file_write`), but still a
   schema change requiring authorization.
3. **A real multi-server gateway (Model 1)** = a new subsystem (MCP *client* —
   WitSeal has only a server today — plus namespace aggregation and
   resources/prompts/sampling pass-through). That is the heavyweight step and is
   out of this spike's scope.

**Recommended next step (only under a real trigger — a design partner running MCP
agents against prod/payments/data, or MCP becoming the dominant tool path):** a
per-server **re-export wrapper (Model 2)** on github-mcp, deciding *then* whether
to (a) keep the experimental sidecar or (b) authorize the additive `tool_call`
intent. No canon change is needed to start.
