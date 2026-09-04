# Contributing to Inherit

Inherit is an open-source consumer genomics platform, created by
[Plus Bio](https://www.plus.bio) as an open-source project for the public good.
Contributions are welcome.

Everyone participating is expected to follow the
[Code of Conduct](CODE_OF_CONDUCT.md). It carries one project-specific rule
worth repeating here: **never post another person's genome file, variant call,
report, or account data** in an issue, pull request, or commit. Use the
synthetic fixtures in `data/samples/`.

## Getting set up

```bash
pnpm install
pnpm supabase start        # local Postgres/Auth/Storage stack (Docker)
cp .env.example .env.local # fill in values printed by supabase start
pnpm seed                  # providers, report templates, PRS weights
pnpm dev
```

Full details, including the self-host path, are in
[`docs/self-hosting.md`](docs/self-hosting.md) and
[`docs/architecture.md`](docs/architecture.md).

## Before you open a pull request

```bash
pnpm typecheck
pnpm lint
pnpm test                  # unit tests
pnpm e2e                   # Playwright: RLS proof, network audit, upload/report flows
```

`pnpm e2e` runs against a production build and the local Supabase stack. CI runs
all of the above plus the repository's gates — the legal placeholder gate, the
no-comparator name gate, and the template integrity gate. A pull request that
trips a gate will not merge, so it is cheaper to run them locally first.

## What we are looking for

Good places to start:

- **Report templates.** 120+ genotype-specific templates live in the seed data.
  Each needs citations (PMID/DOI), an evidence label, and honest "your file does
  not cover this variant" handling. New templates go through the human review
  queue — see the [changelog](https://www.inherit.bio/changelog).
- **Provider directory accuracy.** Prices with capture dates, sequencing depth,
  the raw files a provider actually returns, shipping coverage. If a listing is
  stale, a correction with a source link is a genuinely useful contribution.
- **Ingestion formats.** Array exports and VCF/gVCF are handled; new consumer
  formats are welcome.
- **Privacy and security engineering.** See [SECURITY.md](SECURITY.md) for
  anything exploitable — report it privately rather than opening an issue.

## What we will not merge

These are settled decisions, recorded as ADRs in [`docs/adr/`](docs/adr/):

- **Imputation** — see [ADR-0003](docs/adr/0003-no-imputation.md).
- **Sequencing sales.** Inherit never takes payment for sequencing.
- **Third-party trackers or pixels.** A CI network audit
  (`e2e/network-audit.spec.ts`) enforces this over real rendered pages.
- **Sending user genotypes to third-party annotation APIs** — see
  [ADR-0005](docs/adr/0005-annotation-reference-store.md).
- **Diagnosis, treatment, or medical-advice framing.** Inherit is informational
  and says so on every report.

If you want to change one of these, open an issue proposing a new ADR before
writing code. Decisions are reversible; they are just not reversible silently.

## Conventions

- TypeScript throughout; see [`docs/coding-guidelines.md`](docs/coding-guidelines.md).
- Architectural decisions are recorded as ADRs in [`docs/adr/`](docs/adr/).
- Keep changes surgical. Touch what the change needs and no more.
- Every user-facing claim needs a source. This is a genomics product; unsourced
  assertions about what a variant means do not merge.

## Licensing

Inherit is [AGPL-3.0](LICENSE). By contributing, you agree that your
contributions are licensed under the same terms.
