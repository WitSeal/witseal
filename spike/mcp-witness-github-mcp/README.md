# spike/mcp-witness-github-mcp

**Experimental SPIKE — not a product, not a shipped adapter, not wired into the CLI or package.**

A value probe: can WitSeal wrap one real MCP tool call (github-mcp, read-only
`get_me`) and issue a verifiable receipt with **no receipt-canon, schema, or
golden change**? See `TECHNICAL-NOTE.md` for the result and conclusion.

Files:
- `witness-github-mcp.mjs` — minimal MCP stdio client → github-mcp, hash-only,
  meant to be run through `witseal exec`.
- `example-witnessed-call.json` — the verbatim WitSeal execution receipt plus a
  hash-only `metadata.experimental.mcp` sidecar (NOT canon).
- `TECHNICAL-NOTE.md` — technical note + conclusion.

Run (local; needs Docker + a GitHub token):
```
TF=$(mktemp); (umask 077; gh auth token > "$TF")
witseal --data-dir /tmp/spike exec --mode gate --agent mcp-witness-spike -- \
  node spike/mcp-witness-github-mcp/witness-github-mcp.mjs get_me --token-file "$TF"
rm -f "$TF"
witseal --data-dir /tmp/spike verify
```
(Gate mode needs an allow policy pack for `shell_command` under
`/tmp/spike/policy-packs/`.)
