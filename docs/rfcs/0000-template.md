# RFC-NNNN: <Short descriptive title>

- **Status:** draft
- **Type:** schema | cryptographic | cli | policy | process
- **Author:** @your-github-handle
- **Created:** YYYY-MM-DD
- **Issue link:** Refs #N (the issue that motivated this RFC, if any)
- **Implementation:** N/A (separate PR after acceptance)

---

## Summary

One paragraph TL;DR. A reader should understand what this RFC is about
without reading further. If you can't summarize in a paragraph, the
proposal probably needs to be split into multiple RFCs.

## Motivation

Why are we doing this? What use case does it enable? What is currently
hard or impossible? Concrete is better than abstract.

If this RFC is responding to a specific user pain or design partner
feedback, name the workflow.

## Detailed design

The substance of the RFC. Specific enough that another maintainer
could implement it from this document in 6 months without asking the
author for clarification.

For schema changes:

- Show the current schema (or relevant subset)
- Show the proposed schema
- Show sample JSON for both
- Document field-by-field changes including rationale

For CLI changes:

- Show current invocation and output
- Show proposed invocation and output
- Document all new flags, removed flags, semantic changes

For cryptographic changes:

- Specify the algorithm and parameters
- Document why this construction (vs alternatives in the next section)
- Identify external standards being followed (RFCs, NIST publications, etc.)

For policy changes:

- Show example policy packs in the new format
- Show evaluation behavior on representative inputs

### Migration path

If this is a breaking change:

- What is the deprecation timeline?
- What version introduces the change?
- What version removes the old behavior?
- What tools or scripts help users migrate?

If this is forward-compatible (additive only):

- State explicitly that no migration is needed
- Document how older clients behave when receiving newer data

## Drawbacks

Why might we **not** want to do this? Every change has tradeoffs.
Consider:

- Implementation cost
- Maintenance cost
- Performance impact
- API surface area growth
- Cognitive load for users
- Integration burden for adapter authors

If you can't think of any drawbacks, you have not thought hard enough
about the proposal.

## Rationale and alternatives

- Why is this design the best in the space of possible designs?
- What other designs have been considered and what is the rationale
  for not choosing them?
- What is the impact of not doing this?

For each alternative considered, briefly:

- Describe the alternative
- Explain why it was rejected

The number of alternatives considered is itself a quality signal.

## Prior art

Discuss prior art, both the good and the bad, in relation to this
proposal. Examples include:

- How similar problems are solved in similar systems (Sigstore, Rekor,
  TUF, OpenSSF, OPA, in-toto, etc.)
- Academic papers
- Other RFCs (Rust RFCs, RFC 8785, etc.)
- Existing tools that overlap or compete

This section helps reviewers contextualize the proposal and avoid
re-litigating decisions already settled in the broader ecosystem.

## Unresolved questions

What parts of the design are still being decided? Maintain this section
during the open-for-comment period. Each item should be either:

- Resolved before final comment period, OR
- Explicitly marked as "out of scope; will be addressed in a follow-up RFC"

A draft RFC may have many unresolved questions. An accepted RFC should
have none, or only items explicitly deferred.

## Future possibilities

What this RFC opens up. What comes naturally next. This is not a
commitment to do those things — just a sketch of how this proposal
fits into the larger design.

If this RFC is intended as a step toward a larger goal, name the goal
explicitly.

---

## Implementation status

To be updated post-acceptance:

- [ ] Schema definitions added
- [ ] CLI changes implemented
- [ ] Tests added
- [ ] Documentation updated
- [ ] CHANGELOG entry added
- [ ] Released in version: X.Y.Z

## Comment period log

To be filled in by maintainers:

- Opened for comment: YYYY-MM-DD
- Final comment period started: YYYY-MM-DD
- Final disposition: accepted / rejected / withdrawn on YYYY-MM-DD
