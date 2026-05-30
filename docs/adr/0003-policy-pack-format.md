# ADR-0003: Policy pack format

## Status

accepted (2026-05-08)

## Context

A policy pack expresses what classes of action are allowed, denied, or require approval. It is the configuration unit users edit, share, version, and audit. Design questions:

1. **Format:** declarative data (JSON/YAML), declarative DSL (Rego, CUE), or general-purpose code (TypeScript, JavaScript)?
2. **Expressiveness:** minimum sufficient for Phase 1 vs maximum future-proofing?
3. **Inspectability:** must a human reading a policy pack understand what it does without running it?

Phase 1 constraints:
- Policy decisions must be deterministic and inspectable
- Policy evaluation in the hot path must be sub-millisecond
- Policy packs must be shareable (copy-paste, version control, registry)
- Reviewers (security engineers) must be able to read a pack and trust the analysis
- No remote policy fetch in the hot path

## Decision

**Declarative JSON, with a small constrained matcher language for fields. Schema-validated.**

A policy pack is a JSON document with this shape:

```json
{
  "schema_version": "witseal.policy.v0.1",
  "pack_id": "block-destructive",
  "version": "1.0.0",
  "description": "Blocks destructive shell commands (rm -rf, dd, mkfs).",
  "rules": [
    {
      "id": "no-rm-rf",
      "match": {
        "action_type": "shell_command",
        "command_matches": "^rm\\s+(-[rRf]+\\s+)+/"
      },
      "decision": "deny",
      "reason": "rm -rf on absolute paths is denied without explicit override"
    },
    {
      "id": "approval-for-network",
      "match": {
        "action_type": "shell_command",
        "command_matches": "(curl|wget|nc)\\s"
      },
      "decision": "require-approval",
      "reason": "Network egress requires human approval"
    }
  ],
  "default_decision": "allow"
}
```

Match conditions support:
- Exact equality on string/number/boolean fields (`action_type: "shell_command"`)
- Regex match on string fields (`command_matches`)
- Membership in a set (`risk_class_in: ["C3", "C4"]`)
- Logical composition: `all_of`, `any_of`, `not`

No loops, no variables, no function calls, no external lookups. Evaluation is total: every input produces a defined decision in O(rules) time.

Multiple policy packs may be active. Their rules are evaluated in pack-load order; the first matching rule decides. If no rule in any pack matches, the most-restrictive `default_decision` across all packs applies (deny > require-approval > allow).

## Consequences

### Positive

- **Inspectability.** A human reading the JSON understands what each rule does. No execution required.
- **Schema validation.** Policy packs are validated against `policy.schema.json` on load. Malformed packs fail loudly at startup, not at decision time.
- **Shareability.** A policy pack is a single file that can be committed to git, posted as a gist, included in a registry. No language runtime required to share.
- **Determinism.** No I/O, no nondeterminism. Same input always produces the same decision. Replay-friendly.
- **Performance.** Regex compilation happens at pack load; evaluation is regex-execute + field comparison per rule. Sub-millisecond for typical pack sizes (< 100 rules).
- **Auditability.** Policy decisions are recorded with the matched rule ID. An evidence package includes the policy pack content (or content hash + reference) used at chain time. Reviewers reconstruct exactly which rule fired.

### Negative / Limitations

- **Expressiveness ceiling.** Cannot express "only allow `npm install` on weekday business hours" or "deny if more than 5 destructive commands in the last hour." These require state or external context and are out of Phase 1 scope.
- **Regex pitfalls.** Users will write regexes that don't match what they think. Mitigation: every rule must have a `description` and ideally an `examples` field with positive/negative test cases (linted but not required in v0.1).
- **No abstraction or composition.** Each rule is independent. No "include other pack" semantics in v0.1 — packs are flat. Composition is achieved by loading multiple packs.
- **No type-safe rule definitions.** Rules are JSON; you can write nonsensical match conditions that pass schema validation. Mitigation: `witseal policy lint` (Phase 2) will type-check matches against the action schema.

### What this does NOT provide

- **No general-purpose computation.** A policy pack cannot fetch external data, call APIs, run subprocess, or maintain state across decisions. This is intentional — these capabilities make policies non-deterministic and hard to audit.
- **No conflict resolution beyond order.** If two rules match, the first wins. No precedence scoring, no rule weighting, no "most specific match" heuristics. Order is the policy author's responsibility.
- **No time-of-day or rate-limiting rules in v0.1.** These require state; deferred to Phase 2.

## Alternatives considered

### Rego (Open Policy Agent)

Industry-standard policy language. Used by Kubernetes admission controllers, Istio, etc.

**Why rejected for Phase 1:** Three issues. (1) Adds a dependency on the OPA runtime (~10 MB, Go-compiled, requires WASM or subprocess interop in Node.js). (2) Rego is a complete logic language — non-trivial to audit. A Rego policy can in principle do anything; reasoning about safety properties is hard. (3) The Phase 1 wedge is "deny dangerous things"; Rego's expressiveness is overkill. **Reconsider for Phase 4** when MCP tool governance may need richer rule semantics.

### CUE

Constraint-based configuration language. Strong types, declarative, deterministic.

**Why rejected:** CUE adds a non-trivial dependency and a learning curve. Its strengths (configuration unification, schema + values in one language) shine for large config bases, not single-file rule sets. Reconsider if WitSeal grows a configuration story in Phase 4+.

### TypeScript/JavaScript code

Each rule is a function: `(action) => Decision`.

**Why rejected:** Code is not auditable in the same way data is. A reviewer must read and reason about arbitrary code, including imports, control flow, and side effects. Sandboxing JS for safe evaluation is hard (vm2 has had multiple sandbox-escape CVEs). The flexibility gain does not justify the audit cost.

### Cedar (AWS policy language)

AWS's recent policy language for fine-grained authorization.

**Why rejected:** Newer than Rego, less industry adoption, and its expression of *action* policies (vs *resource* policies) is awkward. Reconsider when the language stabilizes and tooling matures.

### YAML instead of JSON

Same data model, more human-friendly syntax.

**Why rejected:** YAML's parser ambiguities (the Norway problem, version strings parsed as numbers, `1.10` vs `1.1`) create real attack surface in a security-critical config. JSON is unambiguous. Trading authoring ergonomics for parser safety is the right call for a trust product. (If users complain, we add a YAML→JSON conversion tool, but the canonical format remains JSON.)

## Schema versioning

Policy pack schema is versioned `witseal.policy.vMAJOR.MINOR`. A pack with `schema_version` newer than the runtime supports is rejected with a clear error. A pack older than the runtime is processed using the older semantics (forward compatibility).

Phase 1 ships `v0.1`. `v1.0` is targeted at end of Phase 5 alongside the rest of the schema freeze.

## Reference implementation

`src/policy/engine.ts` — pack loading, validation, evaluation.
`schemas/policy.schema.ts` — Zod schema for the pack format.
`examples/policy-packs/` — three reference packs (read-only-fs, no-network-egress, block-destructive).

A typical evaluation:

```typescript
const decision = engine.evaluate(classifiedIntent);
// decision = { outcome: 'deny', matched_rule: 'no-rm-rf', reason: '...' }
```

The matched rule and reason are propagated into the witness event for reconstruction.
