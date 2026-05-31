# Security Policy

## Reporting a Vulnerability

WitSeal is a trust-runtime product. Vulnerabilities in WitSeal undermine the trust property the product exists to provide. We take reports seriously.

### Report channel

Use the private GitHub Security Advisory form:

<https://github.com/WitSeal/witseal/security/advisories/new>

Include:

- A description of the vulnerability
- Steps to reproduce
- Affected version(s)
- Your name and contact info (for credit, optional)

A dedicated security email address and PGP key are not currently published for
Phase 1. Use the private advisory form for sensitive reports.

**Do not file a public GitHub issue for security vulnerabilities.**

### Response timeline

| Step | Target |
|---|---|
| Acknowledgement | within 72 hours |
| Initial assessment | within 7 days |
| Fix or mitigation | within 90 days for high/critical; within 180 days for medium/low |
| Public disclosure | 90 days from initial report (coordinated) or upon fix release, whichever is sooner |

We follow a **90-day coordinated disclosure window**. After that window, the reporter is free to disclose publicly regardless of fix status. We will request an extension only with strong justification (e.g., complex fix requiring coordinated upstream changes).

### Scope

In scope:
- The WitSeal CLI runtime and its core libraries
- Schema definitions (witness event, receipt, policy, approval, evidence package)
- Hash chain construction and verification
- Policy evaluation logic
- Adapter integrations published in this repository

Out of scope (in Phase 1):
- Vulnerabilities in dependencies (report to the dependency upstream; we'll coordinate)
- Issues in agent frameworks WitSeal integrates with (Claude Code, OpenCode, etc.)
- Social engineering against contributors
- DDoS / availability of any hosted service (no hosted service exists in Phase 1)

### Safe harbor

We will not pursue legal action against researchers who:

- Make a good-faith effort to avoid privacy violations and disruption to users
- Report vulnerabilities promptly
- Do not exploit vulnerabilities beyond what is necessary to demonstrate the issue
- Do not access, modify, or destroy data belonging to others

This is the standard `disclose.io` safe-harbor framing.

---

## Verifying releases

Starting with v0.1, every release is signed via [Sigstore Cosign](https://www.sigstore.dev/) using keyless OIDC signing through GitHub Actions. The signing identity is the GitHub workflow itself, recorded in the [Rekor transparency log](https://docs.sigstore.dev/rekor/overview/).

To verify a release:

```bash
gh release download v0.1.1 --repo WitSeal/witseal \
  --pattern 'witseal-v0.1.1.tgz' \
  --pattern 'witseal-v0.1.1.tgz.sig' \
  --pattern 'witseal-v0.1.1.tgz.crt'

# Release .crt assets are base64-wrapped PEM certificates.
openssl base64 -d -A \
  -in witseal-v0.1.1.tgz.crt \
  -out witseal-v0.1.1.tgz.pem

cosign verify-blob \
  --certificate-identity 'https://github.com/WitSeal/witseal/.github/workflows/release.yml@refs/tags/v0.1.1' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  --signature witseal-v0.1.1.tgz.sig \
  --certificate witseal-v0.1.1.tgz.pem \
  witseal-v0.1.1.tgz
```

Releases also include:

- **SLSA Level 2 provenance** (`*.intoto.jsonl`) generated via `slsa-github-generator`
- **CycloneDX SBOM** (`*.cdx.json`) listing all dependencies
- **SHA-256 checksums** (`SHA256SUMS`) for all artifacts

The exact verification commands are published in each release's notes.

---

## Cryptographic primitives

WitSeal uses the following cryptographic constructions:

| Use | Algorithm | Source |
|---|---|---|
| Event/receipt hash | SHA-256 | Node.js stdlib (`crypto`) |
| Canonicalization | RFC 8785 (JCS) | TBD library; vendored if no maintained Node implementation |
| Release signing | Cosign / Fulcio (keyless ECDSA-P256) | Sigstore |
| Transparency log | Rekor | Sigstore |
| TEE attestation | (Phase 5+) AMD SEV-SNP, Intel TDX | TBD |

Phase 1 does not include private-key cryptography in the local runtime — there are no keys to leak. Producer-side trust is bounded; see [`docs/threat-model.md`](./docs/threat-model.md).

---

## Threat model

The full threat model lives at [`docs/threat-model.md`](./docs/threat-model.md). Summary of what Phase 1 does and does not protect:

**Phase 1 protects against:**
- Silent tampering of the evidence chain by a non-producer (chain re-verification detects)
- Accidental execution of denied-by-policy actions (deny-by-default policy enforcement)
- Unrecorded approvals (every approval is recorded as evidence; silence is not consent)
- Replay-time inconsistency (RFC 8785 canonical hashing)

**Phase 1 does NOT protect against:**
- A malicious producer rewriting the entire chain (Phase 5: Sigstore + Rekor)
- Subprocess escapes via `LD_PRELOAD`, kernel modules, or unprivileged escalations (Phase 5: kernel-level mediation)
- Prompt injection or model-level jailbreak (out of scope; this is the model layer)
- Tampering with the WitSeal binary itself (verify via Sigstore before installing)
- Side-channel inference of policy decisions (timing, error messages — not in Phase 1 threat model)

Honest documentation of these limitations is itself a security posture.

---

## Disclosed vulnerabilities

A list of disclosed vulnerabilities, fixes, and reporters will be maintained at [`docs/security/disclosures.md`](./docs/security/disclosures.md). No disclosures yet (project is pre-release).

---

## Acknowledgements

We will publicly credit reporters who request credit, with a link to their profile or homepage of choice. Reporters who prefer anonymity will be credited as "anonymous researcher" or omitted entirely per their preference.

---

## Bug bounty

No formal bug bounty in Phase 1. Reporters are credited publicly (with consent) and may be invited as design partners. A formal bounty program may be introduced when WitSeal has commercial revenue (post-Phase 5).
