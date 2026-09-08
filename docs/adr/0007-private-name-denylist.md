# ADR 0007: Private comparator-name enforcement

- Status: Accepted
- Date: 2026-09-01

## Context

The repository must prohibit comparator names without committing the forbidden
list that defines those names. The scan must still cover the full working tree,
identifier-cased forms, external hosts, and post-baseline commit messages. The
provider directory remains a narrow factual exception.

## Decision

`pnpm gate:names` reads a newline-delimited denylist from the out-of-tree path
in `NAME_DENYLIST_FILE`. GitHub Actions writes the encrypted repository secret
to its runner-temporary directory and fails before the gate if the secret is
absent. A denylist match overrides the public external-name allowlist outside
the provider-directory carve-out.

The public allowlist contains only the permitted categories and reasons. The
gate derives provider names and hosts from the 16 sourced directory records,
checks every record's canonical source and verification date, and separately
enforces evaluative-token distance around provider names.

## Alternatives rejected

- A committed plaintext list was rejected because the repository would contain
  the exact material the gate exists to exclude.
- A committed hash list was rejected because a small candidate vocabulary is
  readily reversible and would provide obfuscation rather than exclusion.
- An optional local-only scan was rejected because a missing CI setting would
  silently weaken the release contract. The workflow therefore fails closed.

## Consequences

Local contributors need an operator-supplied denylist file outside the checkout.
CI needs the encrypted `NAME_DENYLIST` repository or organisation secret. The
public provider directory remains complete and factual, while the same denied
name fails in every non-carved-out file and every post-baseline commit message.

## URL classification correction · 2026-09-07

The external-host pass classifies a parsed hostname rather than treating URL
credentials, ports, queries or fragments as part of a provider name. Literal
SQL regex dot escapes are decoded narrowly; unknown authorities and other
backslash forms remain findings. IPv6 loopback and the reserved `.test` and
`.invalid` domains (including their subdomains) are local/synthetic reference
names, as listed by the [special-use domain registry](https://www.iana.org/assignments/special-use-domain-names).
This is solely external-name classification, not permission to connect to any
URL. Private denylist matching still scans original text, identifiers, paths
and post-baseline commit messages, including reserved-host URLs and userinfo.
The separate credential scanner still checks those fixtures. Tests retain
unknown-host, suffix-confusion, credential-authority and private-name rejection.

PR76 CI at `6fa1eaa` passed build and units, then stopped on 43 external-host
findings. They comprise these parsing/reserved-domain cases, existing citation
regex hosts, and the cited database documentation host now registered with
its actual evidence. No private denylist entry was removed or retrieved.
