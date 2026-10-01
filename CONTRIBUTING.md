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
pnpm test                  # full unit suite
pnpm gate:legal && pnpm gate:first-glance && pnpm gate:names && pnpm gate:templates
pnpm gate:readability && pnpm gate:secrets && pnpm gate:routes && pnpm gate:claims
pnpm gate:env && pnpm gate:jurisdictions
pnpm exec supabase db reset && pnpm exec supabase test db   # fresh local database
```

Run these local checks before pushing a draft pull request. Configure
`NAME_DENYLIST_FILE` for the name gate and stage changes before the repository
and history secret scan. Database reset is only for the disposable local stack.

The complete hosted browser suite is required before merging or any guarded
production change. Six fresh, isolated browser jobs preserve whole fixture
groups; the required `checks` gate rejects failed, skipped, cancelled, missing,
duplicate or stale evidence. Use **Re-run all jobs** after a CI failure so every
job provides evidence from the same attempt.

`pnpm e2e` remains the optional complete local browser command against a
production build and local Supabase stack. The owner approved hosted full-suite
verification as the permanent pre-merge policy on 30 September 2026. The workflow
and its coverage safeguards are described in
[`docs/evidence/ci-browser-sharding.md`](docs/evidence/ci-browser-sharding.md).

## What we are looking for

Good places to start:

- **Report templates.** 120+ genotype-specific templates live in the seed data.
  Each needs citations (PMID/DOI), an evidence label, and honest "your file does
  not cover this variant" handling. New templates go through the human review
  queue — see the [changelog](https://inherit.bio/changelog).
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

Before a fresh database reset or test, run `pnpm gate:sql-includes`. It checks the complete tracked SQL/fixture include graph without database access, resolving every literal relative include from its containing file. Missing, escaping, dynamic or cyclic paths refuse the run. CI and the native browser bootstrap enforce this preflight before starting their database.
