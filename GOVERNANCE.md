# Governance

This document describes how decisions get made in Inherit. It is deliberately
short and deliberately accurate: it describes the project as it is today, not as
it might be if it grows.

## Current state

Inherit is a **single-maintainer project**.
[@themariodiego](https://github.com/themariodiego) is the maintainer and holds
final say on what merges.

The project was created by [Plus Bio](https://www.plus.bio) as an open-source
project for the public good. Inherit operates as a legally separate concern from
Plus Bio's commercial product: accounts are separate, there is no SSO, and no
personal, health, or genetic data flows between Inherit and any Plus Bio service
in either direction. That separation is a product commitment, described on the
[About page](https://www.inherit.bio/about) and in the
[privacy policy](https://www.inherit.bio/privacy), and it is not subject to
change by a code review — see "Commitments that outrank the maintainer" below.

## How decisions are made

**Ordinary changes** — bug fixes, report templates, provider directory
corrections, format support, documentation. Open a pull request. The maintainer
reviews it. CI must be green, including the repository's gates.

**Architectural decisions** are recorded as ADRs in [`docs/adr/`](docs/adr/).
Anything that changes how the system handles user data, what leaves the browser,
or what the product claims needs an ADR before it needs code. Open an issue
proposing the ADR first. Disagreement is resolved in the issue, in public.

**Reversing a settled decision** — the non-goals in
[CONTRIBUTING.md](CONTRIBUTING.md) and the existing ADRs — requires a new ADR
that supersedes the old one and states plainly what changed and why. Settled
decisions are reversible. They are not reversible silently.

## Commitments that outrank the maintainer

Some properties of this project are load-bearing for the people who trust it with
their genome. They are enforced by tests and CI gates rather than by review, so
that no single commit — including one from the maintainer — can quietly remove
them:

- **Row Level Security on every table holding user data**, proven by a test that
  attacks the real PostgREST and Storage APIs (`e2e/rls.spec.ts`).
- **Zero third-party trackers or pixels**, enforced by a network audit over real
  rendered pages (`e2e/network-audit.spec.ts`).
- **User genotypes are never sent to a third-party annotation API**
  ([ADR-0005](docs/adr/0005-annotation-reference-store.md)).
- **Deletion deletes and export is complete**, both verified by test.
- **Legal pages contain no placeholder text**, enforced by the legal gate.

A change that removes one of these tests is a governance change, not a
refactor, and will be treated as one.

## Becoming a maintainer

There is no committee to join yet, and pretending otherwise would be dishonest.
The path is the ordinary one: contribute, review other people's contributions,
and demonstrate judgement about this project's constraints — particularly the
privacy commitments and the evidence standard for anything said about a variant.
A contributor who has done that consistently will be offered commit access, and
this document will be updated to name them and to describe how two or more
maintainers resolve disagreement.

## Change of control

Inherit carries a public change-of-control commitment, published as a product
surface rather than as a promise in a README. If the project or Plus Bio is
acquired, that commitment governs. See the
[privacy policy](https://www.inherit.bio/privacy).

## Contact

- General: hello@inherit.bio
- Security: security@inherit.bio (see [SECURITY.md](SECURITY.md))
- Code of Conduct reports: hello@inherit.bio
